import { randomUUID } from 'node:crypto';
import type { Analysis, Simulator } from '../../../shared/analysis.js';
import {
  DEFAULT_ROUNDS,
  MAX_STORED_ANALYSES,
  startAnalysisSchema,
  type AnalysisList,
  type AnalysisReadiness,
  type AnalysisSummary,
} from '../../../shared/analysis-plan.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';
import {
  FIDELITY_LABEL,
  RULES_CAVEATS,
  runAnalysis,
  validateInputs,
  type AnalysisInputs,
} from './runset.js';
import { planPerturbations } from './sensitivity.js';
import { round4 } from './stats.js';
import { unwiredSimulator } from './unwired.js';
import { autoVariants } from './variants.js';

export interface AnalysisServiceOptions {
  /** The engine that runs one scenario on one seed. Until one is connected, a comparison fails saying so. */
  simulator?: Simulator;
  /** Awaited after every run. The default hands the event loop a turn; a test may hold a run here. */
  yieldNow?: () => Promise<void>;
  now?: () => number;
  /** How many comparisons this server runs at once. */
  maxConcurrent?: number;
  /** How seldom progress is saved: at least this many runs and this many milliseconds apart. */
  progressEvery?: { runs: number; ms: number };
  /** Told a code (never a message or any content) when a comparison could not be saved or failed unexpectedly. */
  onFault?: (code: string) => void;
}

const MAX_CONCURRENT = 2;

const INTERRUPTED = {
  code: 'INTERRUPTED',
  message:
    'The server stopped before this comparison finished. It can be reproduced exactly from its seeds: run it again with the same settings.',
};

interface ActiveRun {
  projectId: string;
  /** A person asked to stop it. */
  cancelled: boolean;
  /** The server is shutting down. */
  stopping: boolean;
  done: Promise<void>;
}

const keyOf = (projectId: string, analysisId: string): string => `${projectId}/${analysisId}`;
const running = (status: Analysis['status']): boolean =>
  status === 'running' || status === 'queued';

export function summarise(analysis: Analysis): AnalysisSummary {
  return {
    id: analysis.id,
    status: analysis.status,
    createdAt: analysis.createdAt,
    completedAt: analysis.completedAt,
    runsPerVariant: analysis.config.runsPerVariant,
    variants: analysis.config.variants.map((variant) => ({ id: variant.id, label: variant.label })),
    sensitivity: analysis.config.sensitivity,
    progress: analysis.progress,
    findings: analysis.findings.length,
    sensitivityRows: analysis.sensitivity.length,
    cost: analysis.cost,
    fidelityLabel: analysis.fidelity.label,
    error: analysis.error,
  };
}

/**
 * Runs comparisons of scenarios in this process, one asynchronous task for each, and keeps them in
 * the project's artifacts: the person starts one, watches its progress, may stop it, and reads it
 * when it is done. A comparison that the server stopped part way is marked as such at the next start
 * and can be run again: it is reproducible from its seeds.
 */
export class AnalysisService {
  private readonly simulator: Simulator;
  private readonly yieldNow: () => Promise<void>;
  private readonly now: () => number;
  private readonly maxConcurrent: number;
  private readonly progressEvery: { runs: number; ms: number };
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly repository: Repository,
    private readonly options: AnalysisServiceOptions = {},
  ) {
    this.simulator = options.simulator ?? unwiredSimulator;
    this.yieldNow =
      options.yieldNow ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
    this.now = options.now ?? Date.now;
    this.maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT;
    this.progressEvery = options.progressEvery ?? { runs: 5, ms: 500 };
  }

  private cast(projectId: string) {
    return this.repository.artifacts.get(projectId, 'actors')?.data ?? null;
  }

  readiness(projectId: string, mayRun: boolean): AnalysisReadiness {
    const cast = this.cast(projectId);
    if (!cast) {
      return {
        actors: null,
        suggestedVariants: [],
        perturbations: 0,
        rounds: DEFAULT_ROUNDS,
        may: { run: mayRun },
      };
    }
    const scenario = this.repository.artifacts.get(projectId, 'scenario')?.data ?? null;
    const suggestedVariants = autoVariants(scenario);
    return {
      actors: {
        count: cast.actors.length,
        members: cast.actors.reduce(
          (sum, actor) => sum + (actor.kind === 'key' ? 1 : actor.sampleSize),
          0,
        ),
      },
      suggestedVariants,
      perturbations: planPerturbations(
        cast.actors,
        suggestedVariants.find((variant) => variant.kind === 'alternative'),
      ).length,
      rounds: DEFAULT_ROUNDS,
      may: { run: mayRun },
    };
  }

  list(projectId: string, mayRun: boolean): AnalysisList {
    const analyses = this.repository.artifacts
      .list(projectId, 'analysis')
      .map((record) => summarise(record.data))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { analyses, readiness: this.readiness(projectId, mayRun) };
  }

  get(projectId: string, analysisId: string): Analysis {
    const record = this.repository.artifacts.get(projectId, 'analysis', analysisId);
    if (!record) throw new AppError(404, 'ANALYSIS_NOT_FOUND', 'This comparison does not exist.');
    return record.data;
  }

  /** Checks the request, saves the comparison as running, and starts it without waiting for it. */
  start(projectId: string, body: unknown, actorId: string): Analysis {
    const input = startAnalysisSchema.parse(body ?? {});
    const cast = this.cast(projectId);
    if (!cast) {
      throw new AppError(
        409,
        'ACTORS_REQUIRED',
        'There are no simulated actors yet. Approve the stakeholders and create the actors (the Env Setup step), then compare scenarios.',
      );
    }
    if ([...this.active.values()].some((run) => run.projectId === projectId)) {
      throw new AppError(
        409,
        'ANALYSIS_RUNNING',
        'A comparison of scenarios is already running for this project. Wait for it to finish, or cancel it.',
      );
    }
    if (this.active.size >= this.maxConcurrent) {
      throw new AppError(
        429,
        'ANALYSIS_BUSY',
        'This server is already comparing scenarios for other projects. Try again in a minute.',
      );
    }
    const scenario = this.repository.artifacts.get(projectId, 'scenario')?.data ?? null;
    const inputs: AnalysisInputs = {
      id: randomUUID(),
      createdAt: new Date(this.now()).toISOString(),
      actors: cast.actors,
      relations: cast.relations,
      variants: input.variants === 'auto' ? autoVariants(scenario) : input.variants,
      runsPerVariant: input.runsPerVariant,
      baseSeed: input.baseSeed ?? this.repository.get(projectId).settings.seed,
      rounds: input.rounds ?? DEFAULT_ROUNDS,
      sensitivity: input.sensitivity,
    };
    const { plan } = validateInputs(inputs);
    const pending = this.pending(inputs, plan.totalRuns);
    const saved = this.repository.artifacts.put(projectId, 'analysis', inputs.id, pending);
    this.repository.audit.record({
      actor: actorId,
      action: 'analysis.started',
      targetType: 'project',
      targetId: projectId,
      projectId,
      detail: {
        analysis: inputs.id,
        scenarios: inputs.variants.length,
        runsPerVariant: inputs.runsPerVariant,
        plannedRuns: plan.totalRuns,
        sensitivity: inputs.sensitivity,
      },
    });
    this.launch(projectId, saved.data, inputs);
    this.prune(projectId, inputs.id);
    return saved.data;
  }

  /** Asks a running comparison to stop at its next run. It is marked cancelled when it has. */
  cancel(projectId: string, analysisId: string, actorId: string): Analysis {
    const stored = this.get(projectId, analysisId);
    const run = this.active.get(keyOf(projectId, analysisId));
    if (!run) {
      throw new AppError(
        409,
        'ANALYSIS_NOT_RUNNING',
        running(stored.status)
          ? 'This comparison is no longer running, because the server stopped. Run it again.'
          : 'This comparison has already finished.',
      );
    }
    run.cancelled = true;
    this.repository.audit.record({
      actor: actorId,
      action: 'analysis.cancelled',
      targetType: 'project',
      targetId: projectId,
      projectId,
      detail: { analysis: analysisId, completedRuns: stored.progress.completedRuns },
    });
    return stored;
  }

  /** Marks every comparison that a stopped server left running as interrupted. Returns how many. */
  recoverInterrupted(): number {
    const left = this.repository.artifacts
      .listAll('analysis', {
        matching: (payload) =>
          payload.includes('"status":"running"') || payload.includes('"status":"queued"'),
      })
      .filter((record) => running(record.data.status));
    let marked = 0;
    for (const record of left) {
      try {
        this.repository.artifacts.put(record.projectId, 'analysis', record.key, {
          ...record.data,
          status: 'interrupted',
          error: INTERRUPTED,
        });
        marked += 1;
      } catch {
        this.options.onFault?.('ANALYSIS_RECOVERY_FAILED');
      }
    }
    return marked;
  }

  /** Stops what is running, so that the database can be closed: each comparison is marked interrupted. */
  async stop(): Promise<void> {
    const runs = [...this.active.values()];
    for (const run of runs) run.stopping = true;
    await Promise.all(runs.map((run) => run.done));
  }

  private pending(inputs: AnalysisInputs, totalRuns: number): Analysis {
    return {
      id: inputs.id,
      status: 'running',
      createdAt: inputs.createdAt,
      completedAt: null,
      config: {
        runsPerVariant: inputs.runsPerVariant,
        baseSeed: inputs.baseSeed,
        rounds: inputs.rounds,
        variants: inputs.variants,
        sensitivity: inputs.sensitivity,
      },
      actors: inputs.actors,
      relations: inputs.relations,
      fidelity: {
        engine: 'rules',
        keyActors: 'rules',
        cohorts: 'rules',
        repeatedRuns: inputs.runsPerVariant,
        modelRepeats: 0,
        label: FIDELITY_LABEL,
        caveats: [...RULES_CAVEATS],
      },
      progress: { completedRuns: 0, totalRuns },
      variants: [],
      findings: [],
      sensitivity: [],
      representativeRun: null,
      crossCheck: null,
      cost: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        simulatedRuns: 0,
        simulatedMembers: 0,
        wallMs: 0,
      },
      error: null,
    };
  }

  private launch(projectId: string, base: Analysis, inputs: AnalysisInputs): void {
    const run: ActiveRun = {
      projectId,
      cancelled: false,
      stopping: false,
      done: Promise.resolve(),
    };
    const key = keyOf(projectId, base.id);
    this.active.set(key, run);
    run.done = this.execute(projectId, base, inputs, run).finally(() => this.active.delete(key));
  }

  private async execute(
    projectId: string,
    base: Analysis,
    inputs: AnalysisInputs,
    run: ActiveRun,
  ): Promise<void> {
    const { runs, ms } = this.progressEvery;
    let savedRuns = 0;
    let savedAt = this.now();
    let progress = base.progress;
    try {
      const result = await runAnalysis(inputs, this.simulator, {
        shouldCancel: () => run.cancelled || run.stopping,
        yieldNow: this.yieldNow,
        now: this.now,
        onProgress: (update) => {
          progress = update;
          const at = this.now();
          if (update.completedRuns - savedRuns < runs || at - savedAt < ms) return;
          savedRuns = update.completedRuns;
          savedAt = at;
          // A project that has gone has nothing to save to: stop wasting the run.
          if (!this.save(projectId, { ...base, progress: update })) run.cancelled = true;
        },
      });
      if (result.status === 'completed') {
        this.finish(projectId, base, {
          ...result,
          crossCheck: this.crossCheck(projectId, result),
        });
      } else if (run.cancelled) {
        this.finish(projectId, base, { ...result, status: 'cancelled' });
      } else {
        this.finish(projectId, base, {
          ...result,
          status: 'interrupted',
          completedAt: null,
          error: INTERRUPTED,
        });
      }
    } catch (error) {
      this.finish(projectId, base, this.failed(base, progress, error));
    }
  }

  private failed(base: Analysis, progress: Analysis['progress'], error: unknown): Analysis {
    const known = error instanceof AppError;
    if (!known) this.options.onFault?.('ANALYSIS_FAILED');
    return {
      ...base,
      status: 'failed',
      completedAt: new Date(this.now()).toISOString(),
      progress,
      error: {
        code: known ? error.code : 'ANALYSIS_FAILED',
        message: known
          ? error.message.slice(0, 400)
          : 'The comparison stopped because of an internal error. Run it again: the same seeds give the same runs.',
      },
    };
  }

  /** Saves the end state; one that cannot be saved (too large, say) is saved as a failure that says why. */
  private finish(projectId: string, base: Analysis, document: Analysis): void {
    if (this.save(projectId, document)) return;
    if (document.status === 'failed') return;
    this.save(
      projectId,
      this.failed(
        base,
        document.progress,
        new AppError(
          500,
          'ANALYSIS_NOT_SAVED',
          'The finished comparison could not be saved. Run it again with fewer runs or scenarios.',
        ),
      ),
    );
  }

  private save(projectId: string, document: Analysis): boolean {
    try {
      if (!this.repository.ownership(projectId)) return false;
      this.repository.artifacts.put(projectId, 'analysis', document.id, document);
      return true;
    } catch (error) {
      this.options.onFault?.(error instanceof AppError ? error.code : 'ANALYSIS_SAVE_FAILED');
      return false;
    }
  }

  /** Whether the project's own deep-dive run, when there is one, agrees with the spread of these runs. */
  private crossCheck(projectId: string, analysis: Analysis): Analysis['crossCheck'] {
    const stance = this.deepDiveStance(projectId);
    if (stance === null) return null;
    const primary = round4(Math.min(1, Math.max(-1, stance)));
    const proposed = analysis.config.variants.find((variant) => variant.kind === 'alternative');
    const band = proposed
      ? analysis.variants.find((result) => result.variantId === proposed.id)?.trajectory.at(-1)
      : undefined;
    if (!proposed || !band) {
      return {
        primaryStanceMean: primary,
        withinEnsembleRange: null,
        note: 'There is no spread of runs to compare the deep-dive run with.',
      };
    }
    const within = primary >= band.p10 && primary <= band.p90;
    const note = `The deep-dive run’s final mean stance (${primary}) is ${within ? 'inside' : 'outside'} the range from the 10th to the 90th percentile (${band.p10} to ${band.p90}) of the ${analysis.config.runsPerVariant} seeded runs of “${proposed.label}”. The two use different engines, so this is a plausibility check, not a validation.`;
    return { primaryStanceMean: primary, withinEnsembleRange: within, note: note.slice(0, 400) };
  }

  /** The final mean stance of the project's completed deep-dive run, or null when it has none. */
  private deepDiveStance(projectId: string): number | null {
    try {
      const project = this.repository.get(projectId);
      if (project.status !== 'completed') return null;
      const last = [...project.rounds].sort((a, b) => a.round - b.round).at(-1);
      return last ? last.meanOpinion : null;
    } catch {
      return null;
    }
  }

  /** Keeps a project's saved comparisons to a bounded number by removing its oldest finished ones. */
  private prune(projectId: string, keep: string): void {
    try {
      const all = this.repository.artifacts.list(projectId, 'analysis');
      let excess = all.length - MAX_STORED_ANALYSES;
      for (const record of all) {
        if (excess <= 0) break;
        if (record.key === keep || running(record.data.status)) continue;
        if (this.active.has(keyOf(projectId, record.key))) continue;
        this.repository.artifacts.delete(projectId, 'analysis', record.key);
        excess -= 1;
      }
    } catch {
      this.options.onFault?.('ANALYSIS_PRUNE_FAILED');
    }
  }
}
