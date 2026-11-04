import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { MAX_ROUNDS, type Analysis, type Simulator } from '../../../shared/analysis.js';
import {
  DEFAULT_ROUNDS,
  DEFAULT_RUNS_PER_VARIANT,
  MAX_RUNS_PER_VARIANT,
  MAX_STORED_ANALYSES,
  MAX_VARIANTS,
  MIN_RUNS_PER_VARIANT,
  startAnalysisSchema,
  type AnalysisList,
  type AnalysisReadiness,
  type AnalysisSummary,
} from '../../../shared/analysis-plan.js';
import { directionNotice } from '../../../shared/signal.js';
import { planConstraints, readinessOf } from '../constraints/plan.js';
import { AppError } from '../errors.js';
import type { Revisions } from '../lab/lineage.js';
import { simulateEachSpecOnce, SimulationInputError } from '../simulation/simulate.js';
import type { ArtifactRecord } from '../storage/artifacts.js';
import type { Repository } from '../storage/repository.js';
import { productSignals } from '../telemetry/product-signals.js';
import {
  FIDELITY_LABEL,
  RULES_CAVEATS,
  runAnalysis,
  validateInputs,
  type AnalysisInputs,
} from './runset.js';
import { planPerturbations } from './sensitivity.js';
import { round4 } from './stats.js';
import { attributeSettings, autoVariants } from './variants.js';

export interface AnalysisServiceOptions {
  /** The engine that runs one scenario on one seed: the population simulator, unless a test supplies another. */
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

const SCENARIO_FIELDS: Record<string, string> = {
  label: 'its name has to be from 1 to 120 characters',
  description: 'its description is longer than 600 characters',
  intensity: 'its intensity has to be a number from 0 to 1',
  round: `the round it starts in has to be a whole number from 1 to ${MAX_ROUNDS}`,
  kind: 'it has to be the baseline or an alternative',
  id: 'its id has to be lower-case letters, digits and hyphens',
};

/**
 * What a request that does not fit the limits says to the person who sent it: the limit, in a sentence.
 * The schema's own words name fields and quote what was sent, so they are not passed on.
 */
export function refusalOf(error: ZodError): AppError {
  const issue = error.issues[0];
  const [field, at, inner] = issue?.path ?? [];
  let message =
    'The settings of the comparison were not accepted. Check the number of runs, the scenarios and the rounds.';
  if (issue?.code === 'unrecognized_keys') {
    message = 'The settings of the comparison include something this server does not use.';
  } else if (field === 'runsPerVariant') {
    message = `Choose a whole number of seeded runs for each scenario, from ${MIN_RUNS_PER_VARIANT} to ${MAX_RUNS_PER_VARIANT}.`;
  } else if (field === 'rounds') {
    message = `A run has a whole number of rounds from 3 to ${MAX_ROUNDS}.`;
  } else if (field === 'baseSeed') {
    message = 'The first seed has to be a whole number from 1 to 2,147,483,647.';
  } else if (field === 'sensitivity') {
    message = 'Whether to test sensitivity has to be yes or no.';
  } else if (field === 'variants' && typeof at === 'number') {
    const clause = typeof inner === 'string' ? SCENARIO_FIELDS[inner] : undefined;
    message = `Scenario ${at + 1} was not accepted${clause ? `: ${clause}` : ''}.`;
  } else if (field === 'variants') {
    message = `Compare between 2 and ${MAX_VARIANTS} scenarios: a baseline and at least one alternative, or leave the scenarios out to use the suggested ones.`;
  }
  return new AppError(400, 'INVALID_INPUT', message);
}
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
    ...(analysis.constraints
      ? {
          constraints: {
            status: analysis.constraints.status,
            applied: new Set(analysis.constraints.applied.map((item) => item.constraintId)).size,
            notApplied: analysis.constraints.notApplied.length,
          },
        }
      : {}),
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
    this.simulator = options.simulator ?? simulateEachSpecOnce();
    this.yieldNow =
      options.yieldNow ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
    this.now = options.now ?? Date.now;
    this.maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT;
    this.progressEvery = options.progressEvery ?? { runs: 5, ms: 500 };
  }

  private cast(projectId: string) {
    return this.repository.artifacts.get(projectId, 'actors')?.data ?? null;
  }

  /**
   * The cast is simulated only while it matches the stakeholders a person approved. A set that was
   * found again, or edited, after the actors were made is no longer approved and the cast is out of
   * date: starting from it would simulate a group a person has since removed or never approved.
   */
  private requireCurrentCast(
    actors: ArtifactRecord<'actors'>,
    stakeholders: ArtifactRecord<'stakeholders'> | null,
  ): void {
    if (!stakeholders) return;
    if (stakeholders.data.approvedAt === null) {
      throw new AppError(
        409,
        'STAKEHOLDERS_NOT_APPROVED',
        'The stakeholders are not approved: they were found again or changed after the simulated actors were made. Approve them and make the actors again (on the Map), then run the simulation.',
      );
    }
    if (actors.data.stakeholderRevision !== stakeholders.revision) {
      throw new AppError(
        409,
        'ACTORS_OUT_OF_DATE',
        'The stakeholders changed after the simulated actors were made, so the comparison would simulate a cast that no longer matches them. Make the actors again from the approved stakeholders (on the Map), then run the simulation.',
      );
    }
  }

  readiness(projectId: string, mayRun: boolean): AnalysisReadiness {
    const cast = this.cast(projectId);
    if (!cast) {
      return {
        actors: null,
        suggestedVariants: [],
        perturbations: 0,
        rounds: DEFAULT_ROUNDS,
        warnings: [],
        may: { run: mayRun },
      };
    }
    const scenario = this.repository.artifacts.get(projectId, 'scenario')?.data ?? null;
    const suggestedVariants = autoVariants(scenario);
    const notice = directionNotice(cast.actors, suggestedVariants);
    const constraints = readinessOf(
      this.repository.artifacts.get(projectId, 'constraints'),
      {
        scenario: this.repository.artifacts.get(projectId, 'scenario'),
        actors: this.repository.artifacts.get(projectId, 'actors'),
      },
      suggestedVariants,
      new Date(this.now()),
      DEFAULT_RUNS_PER_VARIANT,
    );
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
      // A warning, not a refusal: with nobody given a direction, a comparison shows how the assumptions play out, not who gains or loses.
      warnings: [
        ...(notice === null ? [] : [notice]),
        ...(constraints && constraints.status !== 'clear' ? [constraints.message] : []),
      ],
      ...(constraints ? { constraints } : {}),
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

  private accepted(body: unknown) {
    const parsed = startAnalysisSchema.safeParse(body ?? {});
    if (!parsed.success) throw refusalOf(parsed.error);
    return parsed.data;
  }

  /**
   * Checks the request, saves the comparison as running together with the record that it started, and
   * only then starts it without waiting for it. The two are saved in one transaction, so that a
   * comparison that could not be recorded is not left behind as one that is running.
   */
  start(projectId: string, body: unknown, actorId: string): Analysis {
    const input = this.accepted(body);
    const { saved, inputs } = this.repository.atomic(() => {
      const { artifacts } = this.repository;
      const actors = artifacts.get(projectId, 'actors');
      if (!actors) {
        throw new AppError(
          409,
          'ACTORS_REQUIRED',
          'There are no simulated actors yet. Approve the stakeholders and create the actors (on the Map), then run the simulation.',
        );
      }
      const stakeholders = artifacts.get(projectId, 'stakeholders');
      this.requireCurrentCast(actors, stakeholders);
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
      const scenario = artifacts.get(projectId, 'scenario');
      const variants =
        input.variants === 'auto'
          ? autoVariants(scenario?.data ?? null)
          : attributeSettings(input.variants, scenario?.data ?? null);
      // With constraints, a blocked gate or a set nobody has reviewed refuses the start, in words that say what to do.
      const constraints = artifacts.get(projectId, 'constraints');
      const constrained = planConstraints(
        constraints,
        { scenario, actors },
        variants,
        new Date(this.now()),
      );
      const planned: AnalysisInputs = {
        id: randomUUID(),
        createdAt: new Date(this.now()).toISOString(),
        actors: actors.data.actors,
        relations: actors.data.relations,
        variants,
        ...(constrained ? { constraints: constrained.recorded } : {}),
        runsPerVariant: input.runsPerVariant,
        baseSeed: input.baseSeed ?? this.repository.get(projectId).settings.seed,
        rounds: input.rounds ?? DEFAULT_ROUNDS,
        sensitivity: input.sensitivity,
      };
      const { plan } = validateInputs(planned);
      const record = artifacts.put(
        projectId,
        'analysis',
        planned.id,
        this.pending(planned, plan.totalRuns, {
          scenario: scenario?.revision ?? 0,
          stakeholders: stakeholders?.revision ?? 0,
          actors: actors.revision,
          // Recorded only where there are constraints, so that a comparison without them is the record it always was.
          ...(constraints ? { constraints: constraints.revision } : {}),
        }),
      );
      this.repository.audit.record({
        actor: actorId,
        action: 'analysis.started',
        targetType: 'project',
        targetId: projectId,
        projectId,
        detail: {
          analysis: planned.id,
          scenarios: planned.variants.length,
          runsPerVariant: planned.runsPerVariant,
          plannedRuns: plan.totalRuns,
          sensitivity: planned.sensitivity,
          ...(constrained
            ? {
                constraints: new Set(constrained.recorded.applied.map((item) => item.constraintId))
                  .size,
                provisional: constrained.recorded.status === 'provisional',
              }
            : {}),
        },
      });
      return { saved: record, inputs: planned };
    });
    try {
      this.launch(projectId, saved.data, inputs);
    } catch {
      // Nothing is running, so the saved comparison is ended here rather than left to look as if it were.
      this.active.delete(keyOf(projectId, inputs.id));
      const refusal = new AppError(
        503,
        'ANALYSIS_NOT_STARTED',
        'The comparison could not be started, and nothing was run. Start it again.',
      );
      this.save(projectId, this.failed(saved.data, saved.data.progress, refusal));
      throw refusal;
    }
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
    // The audit comes first: a stop that could not be recorded is refused, and the comparison goes on.
    this.repository.audit.record({
      actor: actorId,
      action: 'analysis.cancelled',
      targetType: 'project',
      targetId: projectId,
      projectId,
      detail: { analysis: analysisId, completedRuns: stored.progress.completedRuns },
    });
    run.cancelled = true;
    productSignals.cancellation('simulation');
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

  private pending(inputs: AnalysisInputs, totalRuns: number, inputRevisions: Revisions): Analysis {
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
      inputRevisions,
      ...(inputs.constraints ? { constraints: { ...inputs.constraints, impacts: [] } } : {}),
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
    // The monitoring's own clock, so that the injected one is read exactly as often as it was.
    const began = performance.now();
    let ended: Analysis['status'];
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
        ended = this.finish(projectId, base, {
          ...result,
          crossCheck: this.crossCheck(projectId, result),
        });
      } else if (run.cancelled) {
        ended = this.finish(projectId, base, { ...result, status: 'cancelled' });
      } else {
        ended = this.finish(projectId, base, {
          ...result,
          status: 'interrupted',
          completedAt: null,
          error: INTERRUPTED,
        });
      }
    } catch (error) {
      ended = this.finish(projectId, base, this.failed(base, progress, error));
    }
    // One record for each comparison that ended, by how it ended. One that the server stopped is not
    // one: the process is going, and the comparison is marked interrupted at the next start.
    if (ended === 'completed' || ended === 'failed' || ended === 'cancelled') {
      productSignals.simulationDuration({
        durationMs: Math.round(performance.now() - began),
        outcome: ended,
      });
    }
  }

  private failed(base: Analysis, progress: Analysis['progress'], error: unknown): Analysis {
    // The engine refusing the cast or a scenario is something a person can act on; it is said without
    // the engine's own words, which name fields and may quote what they wrote.
    const refused = error instanceof ZodError || error instanceof SimulationInputError;
    const known = error instanceof AppError;
    if (!known) this.options.onFault?.(refused ? 'SPEC_NOT_ACCEPTED' : 'ANALYSIS_FAILED');
    return {
      ...base,
      status: 'failed',
      completedAt: new Date(this.now()).toISOString(),
      progress,
      error: refused
        ? {
            code: 'SPEC_NOT_ACCEPTED',
            message:
              'The simulation engine did not accept the actors or one of the scenarios. Check the actors on the Map and the scenarios here, then run it again.',
          }
        : {
            code: known ? error.code : 'ANALYSIS_FAILED',
            message: known
              ? error.message.slice(0, 400)
              : 'The comparison stopped because of an internal error. Run it again: the same seeds give the same runs.',
          },
    };
  }

  /**
   * Saves the end state; one that cannot be saved (too large, say) is saved as a failure that says why.
   * Returns how the comparison ended, as far as the person can tell.
   */
  private finish(projectId: string, base: Analysis, document: Analysis): Analysis['status'] {
    // The engine knows nothing of the project's other documents: what the comparison was made from is kept.
    const ended: Analysis = { ...document, inputRevisions: base.inputRevisions };
    if (this.save(projectId, ended)) return ended.status;
    if (ended.status === 'failed') return 'failed';
    this.save(
      projectId,
      this.failed(
        base,
        ended.progress,
        new AppError(
          500,
          'ANALYSIS_NOT_SAVED',
          'The finished comparison could not be saved. Run it again with fewer runs or scenarios.',
        ),
      ),
    );
    return 'failed';
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

  /**
   * Keeps a project's saved comparisons to a bounded number by removing its oldest finished ones, but
   * never the one the decision brief or the independent review was made from: without it they could
   * not draw their charts or be checked against what they say.
   */
  private prune(projectId: string, keep: string): void {
    try {
      const all = this.repository.artifacts.list(projectId, 'analysis');
      const used = new Set(
        [
          this.repository.artifacts.get(projectId, 'brief')?.data.analysisId,
          this.repository.artifacts.get(projectId, 'critiques')?.data.analysisId,
        ].filter((id): id is string => typeof id === 'string'),
      );
      let excess = all.length - MAX_STORED_ANALYSES;
      for (const record of all) {
        if (excess <= 0) break;
        if (record.key === keep || used.has(record.key) || running(record.data.status)) continue;
        if (this.active.has(keyOf(projectId, record.key))) continue;
        this.repository.artifacts.delete(projectId, 'analysis', record.key);
        excess -= 1;
      }
    } catch {
      this.options.onFault?.('ANALYSIS_PRUNE_FAILED');
    }
  }
}
