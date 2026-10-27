import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { Stage } from '../../../shared/types.js';
import { createLocalAgents, localRound } from '../agents/local.js';
import { modelGraph, modelPersonas, modelReport, modelRound } from '../agents/model.js';
import { buildLocalReport } from '../agents/report.js';
import type { ServerConfig } from '../config.js';
import { AppError, publicFailure, throwIfAborted } from '../errors.js';
import { buildLocalGraph } from '../knowledge/graph.js';
import { ModelClient, type ModelGateway, type ModelUsage } from '../models/client.js';
import type { Repository } from '../storage/repository.js';
import type { ExecutionStep } from '../../../shared/guided.js';
import { GuidedWorkflow } from '../guided/workflow.js';
import {
  failStage,
  requireConsole,
  stepStage,
  updateConsole,
  validateStep,
} from '../guided/state.js';

export type ModelFactory = (
  onUsage: (usage: ModelUsage) => void,
  options?: { maxCalls: number },
) => ModelGateway;
interface QueuedTask {
  id: string;
  step: ExecutionStep | 'quick';
  resume: boolean;
}

export class Orchestrator {
  private readonly pending: QueuedTask[] = [];
  private readonly guided: GuidedWorkflow;
  private activeId: string | null = null;
  private activeStep: QueuedTask['step'] | null = null;
  private activeTask: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopping = false;

  constructor(
    private readonly repository: Repository,
    private readonly config: ServerConfig,
    private readonly onFailure: (projectId: string, code: string) => void,
    private readonly createModel: ModelFactory = (onUsage, options) =>
      new ModelClient(config.provider, onUsage, undefined, options?.maxCalls ?? 16),
  ) {
    this.guided = new GuidedWorkflow(repository, this.createModel);
  }

  state(): { active: string | null; pending: number } {
    return { active: this.activeId, pending: this.pending.length };
  }

  isBusy(id: string): boolean {
    return this.activeId === id || this.pending.some((task) => task.id === id);
  }

  enqueue(id: string): ReturnType<Repository['get']> {
    if (this.stopping) throw new AppError(503, 'SERVER_STOPPING', 'The backend is stopping.');
    const project = this.repository.get(id);
    if (project.workflow === 'guided') {
      throw new AppError(
        409,
        'GUIDED_STEP_REQUIRED',
        'Use the guided stage controls to inspect and prepare each phase before continuing.',
      );
    }
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
    if (this.pending.length >= 3)
      throw new AppError(
        429,
        'QUEUE_FULL',
        'The local queue is full (three waiting runs). Wait or cancel one.',
      );
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
    this.pending.push({ id, step: 'quick', resume: false });
    setImmediate(() => this.pump());
    return this.repository.get(id);
  }

  enqueueStep(id: string, step: ExecutionStep, resume = false): ReturnType<Repository['get']> {
    if (this.stopping) throw new AppError(503, 'SERVER_STOPPING', 'The backend is stopping.');
    const project = this.repository.get(id);
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
    if (this.pending.length >= 3)
      throw new AppError(429, 'QUEUE_FULL', 'The local queue is full (three waiting runs).');
    requireConsole(project);
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
    this.pending.push({ id, step, resume });
    setImmediate(() => this.pump());
    return this.repository.get(id);
  }

  pause(id: string): ReturnType<Repository['get']> {
    const pausedBy = new AppError(
      409,
      'RUN_PAUSED',
      'The simulation was paused at its last saved round.',
    );
    const pendingIndex = this.pending.findIndex((task) => task.id === id);
    if (pendingIndex >= 0) {
      const task = this.pending[pendingIndex];
      if (task?.step !== 'simulation')
        throw new AppError(409, 'RUN_NOT_PAUSABLE', 'Only a simulation can be paused.');
      this.pending.splice(pendingIndex, 1);
      this.settleFailure(id, 'simulation', pausedBy);
    } else if (this.activeId === id && this.controller && this.activeStep === 'simulation') {
      this.controller.abort(pausedBy);
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
    const pendingIndex = this.pending.findIndex((task) => task.id === id);
    if (pendingIndex >= 0) {
      const [task] = this.pending.splice(pendingIndex, 1);
      if (task && task.step !== 'quick')
        failStage(
          this.repository,
          id,
          task.step,
          new AppError(409, 'RUN_CANCELLED', 'Cancelled before processing started.'),
        );
      this.repository.update(id, {
        status: 'cancelled',
        error: 'Cancelled before processing started.',
      });
      this.repository.addEvent(id, project.stage, 'Queued run cancelled.');
    } else if (this.activeId === id && this.controller) {
      this.controller.abort(
        new AppError(409, 'RUN_CANCELLED', 'The run was cancelled by the user.'),
      );
      this.repository.addEvent(
        id,
        project.stage,
        'Cancellation requested. Waiting for in-flight work to stop.',
      );
    } else {
      throw new AppError(
        409,
        'RUN_NOT_ACTIVE',
        'Only a queued or running experiment can be cancelled.',
      );
    }
    return this.repository.get(id);
  }

  private pump(): void {
    if (this.stopping || this.activeTask) return;
    const task = this.pending.shift();
    if (!task) return;
    const { id } = task;
    this.activeId = id;
    this.activeStep = task.step;
    this.controller = new AbortController();
    const controller = this.controller;
    this.activeTask = this.execute(task, controller)
      .catch((error: unknown) => this.onFailure(id, publicFailure(error).code))
      .finally(() => {
        this.activeTask = null;
        this.activeId = null;
        this.activeStep = null;
        this.controller = null;
        this.pump();
      });
  }

  private progress(id: string, stage: Stage, progress: number, message: string): void {
    this.repository.update(id, { stage, progress });
    this.repository.addEvent(id, stage, message);
  }

  private async execute(task: QueuedTask, controller: AbortController): Promise<void> {
    const { id } = task;
    const { signal } = controller;
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
    try {
      if (task.step !== 'quick') {
        await this.guided.execute(id, task.step, signal, task.resume);
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
          ? this.createModel((usage) =>
              this.repository.recordUsage(id, usage.inputTokens, usage.outputTokens),
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
      for (let round = 1; round <= initial.settings.rounds; round += 1) {
        throwIfAborted(signal);
        const current = this.repository.get(id);
        const result = model
          ? await modelRound(model, current, chunks, round, signal)
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
    } catch (error) {
      const failure = signal.aborted && signal.reason instanceof AppError ? signal.reason : error;
      const code = this.settleFailure(id, task.step, failure);
      if (code !== 'RUN_PAUSED') this.onFailure(id, code);
    } finally {
      clearTimeout(deadline);
    }
  }

  /** Records a stopped run; a pause with saved rounds is a resumable state, not an error. */
  private settleFailure(id: string, step: QueuedTask['step'], failure: unknown): string {
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

  async idle(): Promise<void> {
    while (this.pending.length || this.activeTask) {
      if (this.activeTask) await this.activeTask;
      else await yieldToLoop();
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const task of this.pending.splice(0)) {
      const { id } = task;
      const project = this.repository.get(id);
      const error =
        'The backend stopped before this queued run started. Retry to start a new attempt.';
      if (task.step !== 'quick')
        failStage(this.repository, id, task.step, new AppError(503, 'RUN_INTERRUPTED', error));
      this.repository.update(id, { status: 'failed', error });
      this.repository.addEvent(id, project.stage, error);
    }
    this.controller?.abort(
      new AppError(
        503,
        'RUN_INTERRUPTED',
        'The backend stopped during this run. Retry to start a new attempt.',
      ),
    );
    if (this.activeTask) await this.activeTask;
  }
}
