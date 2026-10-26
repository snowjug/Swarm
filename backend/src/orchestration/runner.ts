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

export type ModelFactory = (onUsage: (usage: ModelUsage) => void) => ModelGateway;

export class Orchestrator {
  private readonly pending: string[] = [];
  private activeId: string | null = null;
  private activeTask: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopping = false;

  constructor(
    private readonly repository: Repository,
    private readonly config: ServerConfig,
    private readonly onFailure: (projectId: string, code: string) => void,
    private readonly createModel: ModelFactory = (onUsage) =>
      new ModelClient(config.provider, onUsage),
  ) {}

  state(): { active: string | null; pending: number } {
    return { active: this.activeId, pending: this.pending.length };
  }

  isBusy(id: string): boolean {
    return this.activeId === id || this.pending.includes(id);
  }

  enqueue(id: string): ReturnType<Repository['get']> {
    if (this.stopping) throw new AppError(503, 'SERVER_STOPPING', 'The backend is stopping.');
    const project = this.repository.get(id);
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
    this.pending.push(id);
    setImmediate(() => this.pump());
    return this.repository.get(id);
  }

  cancel(id: string): ReturnType<Repository['get']> {
    const project = this.repository.get(id);
    const pendingIndex = this.pending.indexOf(id);
    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1);
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
    const id = this.pending.shift();
    if (!id) return;
    this.activeId = id;
    this.controller = new AbortController();
    const controller = this.controller;
    this.activeTask = this.execute(id, controller)
      .catch((error: unknown) => this.onFailure(id, publicFailure(error).code))
      .finally(() => {
        this.activeTask = null;
        this.activeId = null;
        this.controller = null;
        this.pump();
      });
  }

  private progress(id: string, stage: Stage, progress: number, message: string): void {
    this.repository.update(id, { stage, progress });
    this.repository.addEvent(id, stage, message);
  }

  private async execute(id: string, controller: AbortController): Promise<void> {
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
      const safe = publicFailure(failure);
      const current = this.repository.get(id);
      this.repository.update(id, {
        status: safe.code === 'RUN_CANCELLED' ? 'cancelled' : 'failed',
        error: safe.message,
      });
      this.repository.addEvent(id, current.stage, `${safe.code}: ${safe.message}`);
      this.onFailure(id, safe.code);
    } finally {
      clearTimeout(deadline);
    }
  }

  async idle(): Promise<void> {
    while (this.pending.length || this.activeTask) {
      if (this.activeTask) await this.activeTask;
      else await yieldToLoop();
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const id of this.pending.splice(0)) {
      const project = this.repository.get(id);
      const error =
        'The backend stopped before this queued run started. Retry to start a new attempt.';
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
