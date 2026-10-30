import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { Stage } from '../../../shared/types.js';
import {
  ACTOR_CONCURRENCY,
  actorCallBudget,
  actorRound,
  createKnowledgeIndex,
  type PlatformSpec,
} from '../agents/actor.js';
import { createLocalAgents, localRound } from '../agents/local.js';
import { modelGraph, modelPersonas, modelReport } from '../agents/model.js';
import { buildLocalReport } from '../agents/report.js';
import type { ServerConfig } from '../config.js';
import { AppError, publicFailure, throwIfAborted } from '../errors.js';
import { buildLocalGraph } from '../knowledge/graph.js';
import { createLimiter } from '../limiter.js';
import { ModelClient } from '../models/client.js';
import type { ModelFactory } from '../models/factory.js';
import { jobLease, type Job, type JobKind, type JobLease, type JobState } from '../storage/jobs.js';
import type { Repository } from '../storage/repository.js';
import type { ExecutionStep } from '../../../shared/guided.js';
import { readCheckpoint } from '../guided/checkpoint.js';
import { GuidedWorkflow } from '../guided/workflow.js';
import {
  failStage,
  requireConsole,
  stepStage,
  updateConsole,
  validateStep,
} from '../guided/state.js';

export type { ModelFactory } from '../models/factory.js';

/** How many jobs may wait for a worker before a request to queue another is refused. */
export const MAX_WAITING_JOBS = 3;

/**
 * Provider trouble that may pass. A simulation that has saved rounds and fails with one of these is
 * tried again after a delay, from its last saved round, instead of waiting for a person to click.
 */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'MODEL_UNREACHABLE',
  'MODEL_TIMEOUT',
  'MODEL_RATE_LIMIT',
]);

export interface OrchestratorOptions {
  /** `api` only queues jobs; `all` and `worker` also run them. */
  role?: ServerConfig['role'];
  /** Names this worker in the leases it holds. */
  workerId?: string;
  leaseMs?: number;
  /** How often a running job renews its lease. */
  heartbeatMs?: number;
  /** How often the queue is checked for work that is due, abandoned, or too old. */
  pollMs?: number;
  /** A job that waited this long for a worker is expired, not run late. */
  expireAfterMs?: number;
  retryCodes?: ReadonlySet<string>;
  /** Told of trouble with the queue itself (not with a run). */
  onFault?: (code: string) => void;
  /** False in a test that drives the heartbeat and the polling by hand. */
  timers?: boolean;
}

interface ActiveJob {
  job: Job;
  controller: AbortController;
  /** The backend is stopping: hand the job back to the queue rather than fail it. */
  releasing: boolean;
}

type Outcome =
  | { kind: 'completed' }
  | { kind: 'paused' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: string }
  | { kind: 'retry'; code: string }
  | { kind: 'released' }
  | { kind: 'lost' };

const pausedBy = (): AppError =>
  new AppError(409, 'RUN_PAUSED', 'The simulation was paused at its last saved round.');
const cancelledBy = (): AppError =>
  new AppError(409, 'RUN_CANCELLED', 'The run was cancelled by the user.');

export interface QueueSummary {
  role: ServerConfig['role'];
  counts: Record<JobState, number>;
  oldestWaitingMs: number | null;
}

export class Orchestrator {
  private readonly guided: GuidedWorkflow;
  private readonly role: ServerConfig['role'];
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly expireAfterMs: number;
  private readonly retryCodes: ReadonlySet<string>;
  private readonly onFault: (code: string) => void;
  private active: ActiveJob | null = null;
  private activeTask: Promise<void> | null = null;
  private poll: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(
    private readonly repository: Repository,
    private readonly config: ServerConfig,
    private readonly onFailure: (projectId: string, code: string) => void,
    private readonly createModel: ModelFactory = (onUsage, options) =>
      new ModelClient(config.provider, onUsage, undefined, options?.maxCalls ?? 16),
    private readonly options: OrchestratorOptions = {},
  ) {
    this.guided = new GuidedWorkflow(repository, this.createModel);
    this.role = options.role ?? config.role;
    this.workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.leaseMs = options.leaseMs ?? config.jobLeaseMs;
    this.heartbeatMs = options.heartbeatMs ?? Math.max(250, Math.floor(this.leaseMs / 4));
    this.expireAfterMs = options.expireAfterMs ?? 2 * 60 * 60_000;
    this.retryCodes = options.retryCodes ?? RETRYABLE_CODES;
    this.onFault = options.onFault ?? (() => undefined);
    if (options.timers !== false && this.role !== 'api') {
      this.poll = setInterval(() => this.maintain(), options.pollMs ?? 2_000);
      this.poll.unref();
    }
  }

  /** What this worker is running, and how many jobs wait for any worker. */
  state(): { active: string | null; pending: number } {
    return { active: this.active?.job.projectId ?? null, pending: this.repository.jobs.waiting() };
  }

  /** The state of the whole queue, whoever is working on it. */
  summary(): QueueSummary {
    return {
      role: this.role,
      counts: this.repository.jobs.counts(),
      oldestWaitingMs: this.repository.jobs.oldestWaitingMs(),
    };
  }

  isBusy(id: string): boolean {
    return this.repository.jobs.live(id) !== null;
  }

  /** The caller sent this key before: the work is already queued, and asking again changes nothing. */
  private repeated(id: string, key: string | undefined): boolean {
    return key !== undefined && this.repository.jobs.byIdempotencyKey(id, key) !== null;
  }

  enqueue(id: string, options: { idempotencyKey?: string } = {}): ReturnType<Repository['get']> {
    if (this.stopping) throw new AppError(503, 'SERVER_STOPPING', 'The backend is stopping.');
    const project = this.repository.get(id);
    if (project.workflow === 'guided') {
      throw new AppError(
        409,
        'GUIDED_STEP_REQUIRED',
        'Use the guided stage controls to inspect and prepare each phase before continuing.',
      );
    }
    if (this.repeated(id, options.idempotencyKey)) return project;
    if (this.isBusy(id))
      throw new AppError(409, 'RUN_ACTIVE', 'This experiment already has active or stopping work.');
    if (!['draft', 'failed', 'cancelled'].includes(project.status)) {
      throw new AppError(
        409,
        'RUN_NOT_RESTARTABLE',
        'Create a new experiment to preserve this completed result.',
      );
    }
    if (project.mode === 'llm' && !this.config.provider.configured) {
      throw new AppError(503, 'MODEL_NOT_CONFIGURED', this.config.provider.reason);
    }
    if (this.repository.jobs.waiting() >= MAX_WAITING_JOBS)
      throw new AppError(
        429,
        'QUEUE_FULL',
        'The local queue is full (three waiting runs). Wait or cancel one.',
      );
    const jobId = randomUUID();
    // The run and its job are saved together: a queued run without a job would wait for ever.
    this.repository.atomic(() => {
      this.repository.update(id, {
        status: 'queued',
        stage: 'knowledge',
        progress: 0,
        currentRound: 0,
        error: null,
        graph: null,
        agents: [],
        rounds: [],
        report: null,
        execution: {
          provider: project.mode === 'local' ? 'none' : this.config.provider.name,
          model: project.mode === 'local' ? null : this.config.provider.model,
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      });
      this.repository.addEvent(
        id,
        'knowledge',
        'Run queued. One local worker processes at most three waiting runs.',
      );
      // A run that restarts from nothing cannot be repeated halfway, so it has one attempt.
      this.repository.jobs.enqueue({
        id: jobId,
        projectId: id,
        kind: 'quick',
        idempotencyKey: options.idempotencyKey ?? jobId,
        maxAttempts: 1,
      });
    });
    setImmediate(() => this.pump());
    return this.repository.get(id);
  }

  enqueueStep(
    id: string,
    step: ExecutionStep,
    resume = false,
    options: { idempotencyKey?: string } = {},
  ): ReturnType<Repository['get']> {
    if (this.stopping) throw new AppError(503, 'SERVER_STOPPING', 'The backend is stopping.');
    const project = this.repository.get(id);
    if (this.repeated(id, options.idempotencyKey)) return project;
    if (this.isBusy(id))
      throw new AppError(409, 'RUN_ACTIVE', 'This scenario already has active or stopping work.');
    validateStep(project, step, resume);
    if (project.mode === 'llm') {
      if (!this.config.provider.configured)
        throw new AppError(503, 'MODEL_NOT_CONFIGURED', this.config.provider.reason);
      if (
        project.execution &&
        (project.execution.provider !== this.config.provider.name ||
          project.execution.model !== this.config.provider.model)
      ) {
        throw new AppError(
          409,
          'MODEL_CHANGED',
          'Restore the provider/model used for this scenario, or duplicate its inputs before sending them to another provider.',
        );
      }
    }
    if (this.repository.jobs.waiting() >= MAX_WAITING_JOBS)
      throw new AppError(429, 'QUEUE_FULL', 'The local queue is full (three waiting runs).');
    requireConsole(project);
    const jobId = randomUUID();
    this.repository.atomic(() => {
      updateConsole(this.repository, id, (state) => ({
        ...state,
        activeStep: step,
        steps: { ...state.steps, [step]: 'queued' },
      }));
      this.repository.update(id, {
        status: 'queued',
        stage: stepStage[step],
        error: null,
        execution: project.execution || {
          provider: project.mode === 'local' ? 'none' : this.config.provider.name,
          model: project.mode === 'local' ? null : this.config.provider.model,
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      });
      this.repository.addEvent(
        id,
        stepStage[step],
        resume
          ? `${step} resume queued from the last saved round.`
          : `${step} queued for the bounded local worker.`,
      );
      this.repository.jobs.enqueue({
        id: jobId,
        projectId: id,
        kind: step,
        resume,
        idempotencyKey: options.idempotencyKey ?? jobId,
      });
    });
    setImmediate(() => this.pump());
    return this.repository.get(id);
  }

  pause(id: string): ReturnType<Repository['get']> {
    const job = this.repository.jobs.live(id);
    if (job && job.kind !== 'simulation')
      throw new AppError(409, 'RUN_NOT_PAUSABLE', 'Only a simulation can be paused.');
    if (!job || job.state === 'cancelling')
      throw new AppError(
        409,
        'RUN_NOT_PAUSABLE',
        'Only a queued or running simulation can be paused.',
      );
    const asked = this.repository.jobs.requestPause(job.id);
    if (asked?.state === 'paused') {
      // It had not started: nothing is running, so the project is settled here.
      this.settleFailure(id, 'simulation', pausedBy());
    } else if (asked) {
      // Running: this worker stops at once; another is told through its next heartbeat.
      if (this.active?.job.id === job.id) this.active.controller.abort(pausedBy());
      this.repository.addEvent(
        id,
        'simulation',
        'Pause requested. The in-flight round is discarded; saved rounds are kept.',
      );
    } else {
      throw new AppError(
        409,
        'RUN_NOT_PAUSABLE',
        'Only a queued or running simulation can be paused.',
      );
    }
    return this.repository.get(id);
  }

  cancel(id: string): ReturnType<Repository['get']> {
    const project = this.repository.get(id);
    const job = this.repository.jobs.live(id);
    const asked = job ? this.repository.jobs.requestCancel(job.id) : null;
    if (!job || !asked) {
      throw new AppError(
        409,
        'RUN_NOT_ACTIVE',
        'Only a queued or running experiment can be cancelled.',
      );
    }
    if (asked.state === 'cancelled') {
      // It had not started, so there is nothing to wait for.
      if (job.kind !== 'quick')
        failStage(
          this.repository,
          id,
          job.kind,
          new AppError(409, 'RUN_CANCELLED', 'Cancelled before processing started.'),
        );
      this.repository.update(id, {
        status: 'cancelled',
        error: 'Cancelled before processing started.',
      });
      this.repository.addEvent(id, project.stage, 'Queued run cancelled.');
    } else {
      if (this.active?.job.id === job.id) this.active.controller.abort(cancelledBy());
      this.repository.addEvent(
        id,
        project.stage,
        'Cancellation requested. Waiting for in-flight work to stop.',
      );
    }
    return this.repository.get(id);
  }

  /** Takes the next due job, if this process runs jobs and is not busy. */
  private pump(): void {
    if (this.stopping || this.activeTask || this.role === 'api') return;
    let job: Job | null;
    try {
      job = this.repository.jobs.claim(this.workerId, this.leaseMs);
    } catch (error) {
      this.onFault(publicFailure(error).code);
      return;
    }
    if (!job) return;
    const { projectId } = job;
    this.activeTask = this.run(job)
      .catch((error: unknown) => this.onFailure(projectId, publicFailure(error).code))
      .finally(() => {
        this.activeTask = null;
        this.active = null;
        this.pump();
      });
  }

  /**
   * The upkeep of the queue, done by every process that runs jobs: hand on the jobs of workers
   * that stopped, end jobs that waited too long, and take work that is due. A test calls it directly.
   */
  maintain(): void {
    if (this.stopping) return;
    try {
      for (const { job, outcome } of this.repository.jobs.reap()) this.afterReap(job, outcome);
      for (const job of this.repository.jobs.expireStale(this.expireAfterMs)) {
        this.repository.interrupt(
          job.projectId,
          'No worker took this run before it expired, so it was not started late.',
        );
        this.onFailure(job.projectId, 'JOB_EXPIRED');
      }
      this.pump();
    } catch (error) {
      this.onFault(publicFailure(error).code);
    }
  }

  private afterReap(job: Job, outcome: 'retrying' | 'failed' | 'cancelled'): void {
    const id = job.projectId;
    if (outcome === 'retrying') {
      this.requeue(
        job,
        `The worker running this stage stopped responding. It will be started again (attempt ${job.attempt + 1} of ${job.maxAttempts}).`,
      );
    } else if (outcome === 'cancelled') {
      this.settleFailure(id, job.kind, cancelledBy());
      this.onFailure(id, 'RUN_CANCELLED');
    } else {
      this.repository.interrupt(
        id,
        job.maxAttempts > 1
          ? 'The worker running this stage stopped responding on every attempt, so it was set aside.'
          : 'The worker running this stage stopped responding.',
      );
      this.onFailure(id, job.errorCode ?? 'JOB_INTERRUPTED');
    }
  }

  /** Puts a project whose job goes back in the queue into the state of waiting for a worker. */
  private requeue(job: Job, message: string): void {
    const id = job.projectId;
    const step = job.kind;
    if (step !== 'quick') {
      updateConsole(this.repository, id, (state) => ({
        ...state,
        steps: { ...state.steps, [step]: 'queued' },
        traces: state.traces.map((trace) =>
          trace.status === 'running'
            ? { ...trace, status: 'failed', completedAt: new Date().toISOString(), error: message }
            : trace,
        ),
      }));
    }
    this.repository.update(id, { status: 'queued', error: null });
    this.repository.addEvent(id, this.repository.get(id).stage, message);
  }

  /** Renews the lease of the running job and learns whether anyone asked it to stop. */
  heartbeat(): void {
    const run = this.active;
    if (!run) return;
    try {
      const beat = this.repository.jobs.heartbeat(run.job.id, this.workerId, this.leaseMs);
      if (beat.lost) {
        run.controller.abort(
          new AppError(409, 'LEASE_LOST', 'This job was handed to another worker.'),
        );
      } else if (beat.cancel) run.controller.abort(cancelledBy());
      else if (beat.pause) run.controller.abort(pausedBy());
    } catch {
      // The database cannot be reached. Keep working: if the lease lapses meanwhile, the next write
      // is refused and this run stops; if it does not, nothing was lost.
    }
  }

  private async run(job: Job): Promise<void> {
    const controller = new AbortController();
    const run: ActiveJob = { job, controller, releasing: false };
    this.active = run;
    const lease: JobLease = { jobId: job.id, owner: this.workerId };
    const deadline = setTimeout(() => {
      controller.abort(
        new AppError(
          504,
          'RUN_TIMEOUT',
          'The run exceeded its 15-minute resource budget. Reduce rounds or use a faster model.',
        ),
      );
    }, 15 * 60_000);
    deadline.unref();
    const beat =
      this.options.timers === false ? null : setInterval(() => this.heartbeat(), this.heartbeatMs);
    beat?.unref();
    let outcome: Outcome;
    try {
      // Everything the run writes to the repository is checked against the lease, in this context.
      outcome = await jobLease.run(lease, () => this.execute(run));
    } catch (error) {
      outcome = { kind: 'failed', code: publicFailure(error).code };
    } finally {
      clearTimeout(deadline);
      if (beat) clearInterval(beat);
    }
    this.record(run, outcome);
  }

  /** Writes the outcome into the job, which is only possible while this worker holds its lease. */
  private record(run: ActiveJob, outcome: Outcome): void {
    const { job } = run;
    const jobs = this.repository.jobs;
    switch (outcome.kind) {
      case 'completed':
        jobs.complete(job.id, this.workerId, 'completed');
        return;
      case 'paused':
        jobs.settle(job.id, this.workerId, 'paused', 'RUN_PAUSED');
        return;
      case 'cancelled':
        jobs.settle(job.id, this.workerId, 'cancelled', 'RUN_CANCELLED');
        return;
      case 'released':
        jobs.release(job.id, this.workerId);
        return;
      case 'lost':
        return;
      case 'retry':
        if (jobs.fail(job.id, this.workerId, outcome.code, true) === 'failed') {
          // The attempts ran out between the decision and the write: this is the end of it.
          this.settleFailure(job.projectId, job.kind, new AppError(502, outcome.code, 'Failed.'));
        }
        return;
      case 'failed': {
        const kept = this.keptRounds(job);
        if (kept) jobs.settle(job.id, this.workerId, 'partial', outcome.code);
        else jobs.fail(job.id, this.workerId, outcome.code, false);
      }
    }
  }

  /** True when a simulation stopped with rounds saved: some of its work is kept. */
  private keptRounds(job: Job): boolean {
    if (job.kind !== 'simulation') return false;
    try {
      return readCheckpoint(this.repository.get(job.projectId)) !== null;
    } catch {
      return false;
    }
  }

  private progress(id: string, stage: Stage, progress: number, message: string): void {
    this.repository.update(id, { stage, progress });
    this.repository.addEvent(id, stage, message);
  }

  /** Does the work of a job and says how it ended. It does not throw. */
  private async execute(run: ActiveJob): Promise<Outcome> {
    const { job, controller } = run;
    const { signal } = controller;
    try {
      await this.perform(job, signal);
      return { kind: 'completed' };
    } catch (error) {
      const failure = signal.aborted && signal.reason instanceof AppError ? signal.reason : error;
      const code = publicFailure(failure).code;
      try {
        if (code === 'LEASE_LOST') return { kind: 'lost' };
        if (code === 'RUN_INTERRUPTED' && run.releasing) {
          this.requeue(
            job,
            'The backend stopped during this run. It is queued again and continues when a worker is available.',
          );
          return { kind: 'released' };
        }
        if (this.willRetry(job, code)) {
          this.requeue(
            job,
            `${code}: the model provider did not answer. Attempt ${job.attempt + 1} of ${job.maxAttempts} will continue from the last saved round.`,
          );
          return { kind: 'retry', code };
        }
        const settled = this.settleFailure(job.projectId, job.kind, failure);
        if (settled !== 'RUN_PAUSED') this.onFailure(job.projectId, settled);
        if (settled === 'RUN_PAUSED') return { kind: 'paused' };
        if (settled === 'RUN_CANCELLED') return { kind: 'cancelled' };
        return { kind: 'failed', code: settled };
      } catch (handlerError) {
        // Handing the failure to the project needs the lease too, and it may have been lost since.
        if (publicFailure(handlerError).code === 'LEASE_LOST') return { kind: 'lost' };
        throw handlerError;
      }
    }
  }

  private willRetry(job: Job, code: string): boolean {
    return (
      job.attempt < job.maxAttempts &&
      this.retryCodes.has(code) &&
      this.keptRounds(job) &&
      !this.stopping
    );
  }

  private async perform(job: Job, signal: AbortSignal): Promise<void> {
    const id = job.projectId;
    if (job.kind !== 'quick') {
      // Asked to resume, or started again after an attempt that was cut off: continue from the last
      // saved round when there is one, rather than computing the rounds again.
      const resume =
        job.resume ||
        (job.kind === 'simulation' &&
          job.repeat &&
          readCheckpoint(this.repository.get(id)) !== null);
      await this.guided.execute(id, job.kind, signal, resume);
      return;
    }
    this.repository.update(id, { status: 'running' });
    this.progress(
      id,
      'knowledge',
      5,
      'Building source-linked knowledge from the indexed passages.',
    );
    const initial = this.repository.get(id);
    const chunks = this.repository.chunks(id);
    const model =
      initial.mode === 'llm'
        ? this.createModel(
            (usage) => this.repository.recordUsage(id, usage.inputTokens, usage.outputTokens),
            {
              maxCalls: actorCallBudget(initial.settings.agentCount, 1, initial.settings.rounds),
            },
          )
        : null;
    throwIfAborted(signal);
    const graph = model
      ? await modelGraph(model, initial, chunks, signal)
      : buildLocalGraph(chunks, initial.question);
    throwIfAborted(signal);
    this.repository.update(id, { graph });
    this.progress(
      id,
      'personas',
      24,
      `${graph.nodes.length} knowledge nodes recorded. Creating explicitly fictional stakeholder proxies.`,
    );
    const agents = model
      ? await modelPersonas(model, this.repository.get(id), graph, chunks, signal)
      : createLocalAgents(graph, initial.settings);
    throwIfAborted(signal);
    this.repository.update(id, { agents });
    this.progress(
      id,
      'simulation',
      35,
      `${agents.length} proxies ready. Starting ${initial.settings.rounds} simultaneous-update rounds.`,
    );
    const knowledge = createKnowledgeIndex(chunks, initial.question);
    const limit = createLimiter(ACTOR_CONCURRENCY);
    const platform: PlatformSpec =
      initial.settings.network === 'broadcast'
        ? { id: 'plaza', label: 'Info Plaza', network: 'broadcast' }
        : { id: 'community', label: 'Topic Community', network: 'community' };
    for (let round = 1; round <= initial.settings.rounds; round += 1) {
      throwIfAborted(signal);
      const current = this.repository.get(id);
      const result = model
        ? await actorRound({
            model,
            question: current.question,
            agents: current.agents,
            previousActions: current.rounds.at(-1)?.actions ?? [],
            knowledge,
            round,
            totalRounds: current.settings.rounds,
            platform,
            simulatedMinute: round * 60,
            seedPosts: [],
            intervention:
              current.settings.intervention?.round === round ? current.settings.intervention : null,
            limit,
            signal,
          })
        : localRound(current.agents, current.settings, round);
      throwIfAborted(signal);
      this.repository.update(id, {
        agents: result.agents,
        rounds: [...current.rounds, result.snapshot],
        currentRound: round,
        progress: 35 + Math.floor((round / initial.settings.rounds) * 48),
      });
      this.repository.addEvent(
        id,
        'simulation',
        `Round ${round}/${initial.settings.rounds}: ${result.snapshot.activityCount} state/action updates, ${result.snapshot.interactions} peer references, mean inclination ${result.snapshot.meanOpinion.toFixed(3)}.`,
      );
      await yieldToLoop(undefined, { signal });
    }
    this.progress(
      id,
      'report',
      88,
      'Reviewing modeling limitations and synthesizing recorded results with source provenance.',
    );
    const report = model
      ? await modelReport(model, this.repository.get(id), chunks, signal)
      : buildLocalReport(this.repository.get(id), chunks);
    throwIfAborted(signal);
    this.repository.update(id, { report, status: 'completed', stage: 'complete', progress: 100 });
    this.repository.addEvent(
      id,
      'complete',
      'Report persisted. Source inspection and follow-up interaction are available.',
    );
  }

  /** Records a stopped run; a pause with saved rounds is a resumable state, not an error. */
  private settleFailure(id: string, step: JobKind, failure: unknown): string {
    const safe = publicFailure(failure);
    if (step !== 'quick') failStage(this.repository, id, step, failure);
    const current = this.repository.get(id);
    if (safe.code === 'RUN_PAUSED' && current.console?.steps.simulation === 'paused') {
      this.repository.update(id, { status: 'ready', stage: 'simulation', error: null });
      this.repository.addEvent(
        id,
        'simulation',
        `Simulation paused after round ${current.rounds.length}. Saved rounds are intact: resume, schedule an intervention, or branch.`,
      );
      return safe.code;
    }
    const message =
      safe.code === 'RUN_PAUSED'
        ? 'Paused before any round was saved, so nothing was kept. Start the simulation again.'
        : safe.message;
    this.repository.update(id, {
      status: safe.code === 'RUN_CANCELLED' || safe.code === 'RUN_PAUSED' ? 'cancelled' : 'failed',
      error: message,
    });
    this.repository.addEvent(id, current.stage, `${safe.code}: ${message}`);
    return safe.code;
  }

  /** Resolves when this process has no job running and none is due for it to take. */
  async idle(): Promise<void> {
    let idleTurns = 0;
    for (;;) {
      if (this.activeTask) {
        await this.activeTask;
        idleTurns = 0;
        continue;
      }
      if (this.role === 'api' || this.stopping || !this.repository.jobs.hasDue()) return;
      this.pump();
      // A job that is due but cannot be taken (the database is failing) must not hold a caller for ever.
      if (!this.activeTask && ++idleTurns > 50) return;
      await yieldToLoop();
    }
  }

  /**
   * Stops taking work and stops the job in hand. The job goes back to the queue with its attempt
   * returned, so that a restart (or another worker) continues it from its last saved round; jobs that
   * are waiting stay in the queue.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.poll) clearInterval(this.poll);
    const run = this.active;
    if (run) {
      run.releasing = true;
      run.controller.abort(
        new AppError(
          503,
          'RUN_INTERRUPTED',
          'The backend stopped during this run. Retry to start a new attempt.',
        ),
      );
    }
    if (this.activeTask) await this.activeTask;
  }
}
