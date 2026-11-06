import { DEFAULT_ROUNDS, CONSTRAINT_IMPACT_SEEDS } from '../../../shared/analysis-plan.js';
import type { Simulator, Variant } from '../../../shared/analysis.js';
import {
  CONSTRAINT_SCHEMA_VERSION,
  openQuestions,
  type ConstraintCoverage,
  type ConstraintImpact,
  type ConstraintReviewAction,
  type ConstraintSet,
  type ConstraintsView,
  type CounterfactualSet,
  type CounterfactualsView,
  type GateView,
  type ProposeConstraintsInput,
  type PutConstraintsBody,
} from '../../../shared/constraints.js';
import type { ModelAvailability } from '../../../shared/stakeholders.js';
import type { ProjectDetail } from '../../../shared/types.js';
import { measureImpacts, planImpacts } from '../analysis/constraint-impact.js';
import { autoVariants } from '../analysis/variants.js';
import type { ProviderConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { ModelFactory } from '../models/factory.js';
import { modelIdentity } from '../models/identity.js';
import { simulateEachSpecOnce } from '../simulation/simulate.js';
import type { ArtifactRecord } from '../storage/artifacts.js';
import type { Repository } from '../storage/repository.js';
import { productSignals } from '../telemetry/product-signals.js';
import { emptySet } from './build.js';
import { COUNTERFACTUAL_SEEDS, runCounterfactuals } from './counterfactuals.js';
import { compileConstraints } from './enforce.js';
import { gateWorldOf, type ProjectRecords } from './plan.js';
import { proposeConstraints } from './propose.js';
import { refreshSet, type Considered } from './refresh.js';
import { applyPut, applyReview, type ReviewWorld } from './review.js';

const KEY = 'default';
const COUNTERFACTUAL_KEY = 'default';
/** Reading sources for constraints may wait for a model; it does not wait for ever. */
export const MODEL_TIMEOUT_MS = 170_000;
const MODEL_CALLS = 3;

const conflict = (): AppError =>
  new AppError(
    409,
    'ARTIFACT_CONFLICT',
    'The constraints changed while you were looking at them. Reload them and make your change again.',
  );

export interface ConstraintServiceOptions {
  createModel: ModelFactory;
  provider: Pick<ProviderConfig, 'configured' | 'reason' | 'model' | 'name'>;
  now?: () => Date;
  /** The engine the gate and the views run: the population simulator, unless a test supplies another. */
  simulator?: Simulator;
  yieldNow?: () => Promise<void>;
}

const countsOf = (set: ConstraintSet) => {
  const live = set.constraints.filter(
    (constraint) =>
      constraint.review !== 'removed' &&
      constraint.review !== 'excluded' &&
      constraint.validation !== 'rejected',
  );
  return {
    constraints: set.constraints.length,
    live: live.length,
    hard: live.filter((constraint) => constraint.hardness === 'hard').length,
    waiting: set.constraints.filter((constraint) => constraint.review === 'proposed').length,
    open: set.clarifications.filter((question) => question.status === 'open').length,
    status: set.coverage?.status ?? 'clear',
  };
};

/**
 * The constraints of a project: reading them, proposing them, changing them, the gate and the
 * counterfactual views. Every change is written with its audit entry in one transaction, and the audit
 * entry holds counts and a status, never a statement or a quote.
 */
export class ConstraintService {
  private readonly now: () => Date;
  private readonly simulator: () => Simulator;
  private readonly busy = new Set<string>();
  private readonly sensitivity = new Map<string, ConstraintImpact | null>();

  constructor(
    private readonly repository: Repository,
    private readonly options: ConstraintServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.simulator = () => options.simulator ?? simulateEachSpecOnce();
  }

  private availability(project: ProjectDetail): ModelAvailability {
    if (project.mode !== 'llm') {
      return {
        available: false,
        reason:
          'This project runs without a model, so nothing is sent to one. Constraints are read from the text by rules.',
      };
    }
    return this.options.provider.configured
      ? { available: true, reason: null }
      : { available: false, reason: this.options.provider.reason };
  }

  private records(projectId: string): ProjectRecords {
    const { artifacts } = this.repository;
    return {
      scenario: artifacts.get(projectId, 'scenario'),
      actors: artifacts.get(projectId, 'actors'),
    };
  }

  private variants(records: ProjectRecords): Variant[] {
    return autoVariants(records.scenario?.data ?? null);
  }

  private reviewWorld(records: ProjectRecords, variants: readonly Variant[]): ReviewWorld {
    return {
      actorIds: new Set(records.actors?.data.actors.map((actor) => actor.id) ?? []),
      alternativeIds: new Set(
        variants.filter((variant) => variant.kind === 'alternative').map((variant) => variant.id),
      ),
      assumptionIds: new Set(
        records.scenario?.data.assumptions.map((assumption) => assumption.id) ?? [],
      ),
    };
  }

  /** Where the constraints were taken into account in the rest of the project, for the labels a person reads. */
  private considered(projectId: string, revision: number): Considered {
    const { artifacts } = this.repository;
    const inAnalysis = new Set<string>();
    let reviewed = false;
    try {
      const newest = artifacts
        .list(projectId, 'analysis')
        .filter(
          (record) =>
            record.data.status === 'completed' &&
            record.data.inputRevisions?.constraints === revision,
        )
        .sort((a, b) => (b.data.completedAt ?? '').localeCompare(a.data.completedAt ?? ''))[0];
      if (newest?.data.constraints) {
        for (const item of newest.data.constraints.applied) inAnalysis.add(item.constraintId);
        for (const item of newest.data.constraints.notApplied) inAnalysis.add(item.constraintId);
        reviewed = artifacts.get(projectId, 'critiques')?.data.analysisId === newest.data.id;
      }
    } catch {
      // What was recorded elsewhere is only a label here: a record that cannot be read says nothing.
    }
    const inCounterfactual = new Set<string>();
    const views = this.readCounterfactualSet(projectId);
    if (views?.current) {
      for (const view of views.set.views)
        for (const id of view.driverConstraintIds) inCounterfactual.add(id);
    }
    return { inAnalysis, reviewed, inCounterfactual };
  }

  private readCounterfactualSet(
    projectId: string,
  ): { set: CounterfactualSet; current: boolean } | null {
    const { artifacts } = this.repository;
    const stored = artifacts.get(projectId, 'constraint-counterfactuals', COUNTERFACTUAL_KEY);
    if (!stored) return null;
    const records = this.records(projectId);
    const constraints = artifacts.get(projectId, 'constraints');
    const { inputs } = stored.data;
    return {
      set: stored.data,
      current:
        inputs.constraints === (constraints?.revision ?? 0) &&
        inputs.actors === (records.actors?.revision ?? 0) &&
        inputs.scenario === (records.scenario?.revision ?? 0),
    };
  }

  view(projectId: string, may: ConstraintsView['may']): ConstraintsView {
    const project = this.repository.get(projectId);
    const record = this.repository.artifacts.get(projectId, 'constraints');
    const records = this.records(projectId);
    const variants = this.variants(records);
    const set = record
      ? refreshSet(
          record.data,
          gateWorldOf(record.data, records, variants),
          this.now(),
          this.considered(projectId, record.revision),
        )
      : null;
    return {
      constraints: set,
      revision: record?.revision ?? null,
      gate: set?.coverage ?? null,
      open: openQuestions(set),
      stale: set
        ? {
            scenario: set.scenarioRevision !== (records.scenario?.revision ?? 0),
            actors: set.actorsRevision !== (records.actors?.revision ?? 0),
          }
        : { scenario: false, actors: false },
      alternatives: variants
        .filter((variant) => variant.kind === 'alternative')
        .map(({ id, label }) => ({ id, label })),
      actors: (records.actors?.data.actors ?? []).map(({ id, name, category }) => ({
        id,
        name,
        category,
      })),
      assumptions: (records.scenario?.data.assumptions ?? []).map(({ id, text }) => ({ id, text })),
      model: this.availability(project),
      may,
    };
  }

  /** The gate, worked out now, with the constraint whose removal moves the headline share the most. */
  async gate(projectId: string): Promise<GateView> {
    const record = this.repository.artifacts.get(projectId, 'constraints');
    if (!record) return { gate: null, revision: null };
    const records = this.records(projectId);
    const variants = this.variants(records);
    const set = refreshSet(record.data, gateWorldOf(record.data, records, variants), this.now());
    const coverage = set.coverage as ConstraintCoverage;
    // Where the gate stands, as this page asked for it; the sensitivity below does not change it.
    productSignals.constraintGate(coverage.status);
    return {
      gate: {
        ...coverage,
        largestSensitivity: await this.largest(projectId, record.revision, set, records, variants),
      },
      revision: record.revision,
    };
  }

  private async largest(
    projectId: string,
    revision: number,
    set: ConstraintSet,
    records: ProjectRecords,
    variants: readonly Variant[],
  ): Promise<ConstraintImpact | null> {
    const actors = records.actors?.data.actors ?? [];
    const proposed = variants.find((variant) => variant.kind === 'alternative');
    if (!proposed || actors.length === 0) return null;
    const key = `${projectId}|${revision}|${records.scenario?.revision ?? 0}|${records.actors?.revision ?? 0}`;
    if (this.sensitivity.has(key)) return this.sensitivity.get(key) ?? null;
    const compiled = compileConstraints(set.constraints, {
      actorIds: new Set(actors.map((actor) => actor.id)),
      variantIds: new Set(variants.map((variant) => variant.id)),
    });
    const pairs = planImpacts(compiled.applied, [proposed]);
    let best: ConstraintImpact | null = null;
    if (pairs.length > 0) {
      const seed = this.repository.get(projectId).settings.seed;
      const impacts = await measureImpacts({
        actors,
        relations: records.actors?.data.relations ?? [],
        rounds: DEFAULT_ROUNDS,
        applied: compiled.applied,
        pairs,
        seeds: Array.from({ length: CONSTRAINT_IMPACT_SEEDS }, (_, at) => seed + at),
        simulator: this.simulator(),
        ...(this.options.yieldNow ? { yieldNow: this.options.yieldNow } : {}),
      });
      best =
        (impacts ?? []).reduce<ConstraintImpact | null>(
          (top, impact) =>
            !top || Math.abs(impact.withoutShift) > Math.abs(top.withoutShift) ? impact : top,
          null,
        ) ?? null;
    }
    if (this.sensitivity.size >= 64) this.sensitivity.clear();
    this.sensitivity.set(key, best);
    return best;
  }

  /** Writes a change with its audit entry, and answers with the view as it now is. */
  private save(
    projectId: string,
    existing: { revision: number } | null,
    next: ConstraintSet,
    actorId: string,
    action: string,
    detail: Record<string, string | number | boolean | null>,
    may: ConstraintsView['may'],
  ): ConstraintsView {
    this.repository.atomic(() => {
      this.repository.artifacts.put(projectId, 'constraints', KEY, next, {
        expectedRevision: existing?.revision ?? 0,
      });
      this.repository.audit.record({
        actor: actorId,
        action,
        targetType: 'project',
        targetId: projectId,
        projectId,
        detail: { ...detail, ...countsOf(next) },
      });
    });
    return this.view(projectId, may);
  }

  private base(
    projectId: string,
    expectedRevision: number,
  ): { existing: ArtifactRecord<'constraints'> | null; set: ConstraintSet } {
    const existing = this.repository.artifacts.get(projectId, 'constraints');
    if ((existing?.revision ?? 0) !== expectedRevision) throw conflict();
    const records = this.records(projectId);
    return {
      existing,
      set:
        existing?.data ??
        emptySet(this.now(), 'user', {
          scenario: records.scenario?.revision ?? 0,
          actors: records.actors?.revision ?? 0,
        }),
    };
  }

  put(
    projectId: string,
    input: PutConstraintsBody,
    actorId: string,
    may: ConstraintsView['may'],
  ): ConstraintsView {
    this.repository.get(projectId);
    const { existing, set } = this.base(projectId, input.expectedRevision);
    const records = this.records(projectId);
    const variants = this.variants(records);
    const next = applyPut(set, input, this.reviewWorld(records, variants), this.now());
    const refreshed = refreshSet(next, gateWorldOf(next, records, variants), this.now());
    return this.save(
      projectId,
      existing,
      refreshed,
      actorId,
      'constraints.edited',
      { via: 'put' },
      may,
    );
  }

  review(
    projectId: string,
    input: ConstraintReviewAction,
    actorId: string,
    may: ConstraintsView['may'],
  ): ConstraintsView {
    this.repository.get(projectId);
    const { existing, set } = this.base(projectId, input.expectedRevision);
    if (!existing && input.action !== 'add') {
      throw new AppError(
        409,
        'CONSTRAINTS_NOT_FOUND',
        'There are no constraints yet. Propose them first, or add one yourself.',
      );
    }
    const records = this.records(projectId);
    const variants = this.variants(records);
    let next = applyReview(set, input, this.reviewWorld(records, variants), this.now());
    // Confirming that the set has been checked is also saying it was checked against the scenario and the cast as they are.
    if (input.action === 'confirm-set') {
      next = {
        ...next,
        scenarioRevision: records.scenario?.revision ?? 0,
        actorsRevision: records.actors?.revision ?? 0,
      };
    }
    const refreshed = refreshSet(next, gateWorldOf(next, records, variants), this.now());
    return this.save(
      projectId,
      existing,
      refreshed,
      actorId,
      'constraints.reviewed',
      { action: input.action },
      may,
    );
  }

  private exclusive<T>(projectId: string): { run: (work: () => Promise<T>) => Promise<T> } {
    return {
      run: async (work) => {
        if (this.busy.has(projectId)) {
          throw new AppError(
            409,
            'CONSTRAINTS_BUSY',
            'Constraints are already being proposed or measured for this project. Wait for that to finish.',
          );
        }
        this.busy.add(projectId);
        try {
          return await work();
        } finally {
          this.busy.delete(projectId);
        }
      },
    };
  }

  /** Documents whose text must not be read for constraints, and documents that are examples, as far as the project says. */
  private provenance(projectId: string): { setAside: Set<string>; examples: Set<string> } {
    const setAside = new Set<string>();
    const examples = new Set<string>();
    try {
      for (const record of this.repository.artifacts.list(projectId, 'research')) {
        for (const source of record.data.sources) {
          if (source.documentId && (source.injectionFlagged || source.outcome === 'quarantined')) {
            setAside.add(source.documentId);
          }
        }
      }
    } catch {
      // Automatic research is read defensively: a record that cannot be read sets nothing aside.
    }
    for (const document of this.repository.get(projectId).documents) {
      const kind = document.provenance?.kind;
      if (kind === 'sample' || kind === 'historical') examples.add(document.id);
    }
    return { setAside, examples };
  }

  async propose(
    projectId: string,
    input: ProposeConstraintsInput,
    actorId: string,
    signal: AbortSignal,
    may: ConstraintsView['may'],
  ): Promise<ConstraintsView> {
    const project = this.repository.get(projectId);
    const mode = input.mode ?? 'rules';
    const model = this.availability(project);
    if (mode === 'model' && !model.available) {
      throw new AppError(
        409,
        'MODEL_NOT_AVAILABLE',
        model.reason ?? 'No model is available for this project.',
      );
    }
    return this.exclusive<ConstraintsView>(projectId).run(async () => {
      const existing = this.repository.artifacts.get(projectId, 'constraints');
      const records = this.records(projectId);
      const variants = this.variants(records);
      const { setAside, examples } = this.provenance(projectId);
      const result = await proposeConstraints({
        existing: existing?.data ?? null,
        context: {
          question: project.question,
          scenario: records.scenario?.data ?? null,
          actors: records.actors?.data.actors ?? [],
          actorRelations: records.actors?.data.relations ?? [],
          alternatives: variants
            .filter((variant) => variant.kind === 'alternative')
            .map(({ id, label }) => ({ id, label })),
          passages: this.repository.chunks(projectId),
          setAsideDocuments: setAside,
          exampleDocuments: examples,
        },
        mode,
        model:
          mode === 'model'
            ? this.options.createModel(this.repository.modelUse(project.id), {
                maxCalls: MODEL_CALLS,
              })
            : null,
        modelName: mode === 'model' ? modelIdentity(this.options.provider).model : null,
        signal,
        revisions: {
          scenario: records.scenario?.revision ?? 0,
          actors: records.actors?.revision ?? 0,
        },
        assumptionIds: new Set(
          records.scenario?.data.assumptions.map((assumption) => assumption.id) ?? [],
        ),
        now: this.now(),
      });
      const refreshed = refreshSet(
        result.set,
        gateWorldOf(result.set, records, variants),
        this.now(),
      );
      const saved = this.save(
        projectId,
        existing,
        refreshed,
        actorId,
        'constraints.proposed',
        {
          asked: mode,
          mode: result.set.mode,
          fellBack: result.failure !== null,
          addedConstraints: result.added.constraints,
          addedQuestions: result.added.questions,
        },
        may,
      );
      // Once the proposal is kept: where it came from, and how many constraints it added.
      productSignals.constraintProposal({
        origin: mode === 'rules' ? 'rules' : result.modelUsed ? 'model' : 'fallback',
        count: result.added.constraints,
      });
      return saved;
    });
  }

  readCounterfactuals(projectId: string, may: { run: boolean }): CounterfactualsView {
    this.repository.get(projectId);
    const found = this.readCounterfactualSet(projectId);
    return { counterfactuals: found?.set ?? null, current: found?.current ?? false, may };
  }

  /** Runs the counterfactual views of the proposed change against the constraints as they are, and keeps them. */
  async runCounterfactuals(
    projectId: string,
    actorId: string,
    may: { run: boolean },
  ): Promise<CounterfactualsView> {
    const project = this.repository.get(projectId);
    const records = this.records(projectId);
    const record = this.repository.artifacts.get(projectId, 'constraints');
    if (!records.actors || !record) {
      throw new AppError(
        409,
        'COUNTERFACTUALS_NOT_READY',
        'The views need actors and constraints. Make the actors, propose or add constraints, then try again.',
      );
    }
    const variants = this.variants(records);
    const proposed = variants.find((variant) => variant.kind === 'alternative');
    if (!proposed) {
      throw new AppError(409, 'COUNTERFACTUALS_NOT_READY', 'There is no proposed change to vary.');
    }
    return this.exclusive<CounterfactualsView>(projectId).run(async () => {
      const set = refreshSet(record.data, gateWorldOf(record.data, records, variants), this.now());
      const seed = project.settings.seed;
      const views = await runCounterfactuals({
        actors: records.actors!.data.actors,
        relations: records.actors!.data.relations,
        rounds: DEFAULT_ROUNDS,
        variant: proposed,
        variantIds: new Set(variants.map((variant) => variant.id)),
        constraints: set.constraints,
        seeds: Array.from({ length: COUNTERFACTUAL_SEEDS }, (_, at) => seed + at),
        simulator: this.simulator(),
        inputs: {
          constraints: record.revision,
          actors: records.actors!.revision,
          scenario: records.scenario?.revision ?? 0,
        },
        now: this.now(),
        yieldNow:
          this.options.yieldNow ?? (() => new Promise<void>((resolve) => setImmediate(resolve))),
      });
      this.repository.atomic(() => {
        this.repository.artifacts.put(projectId, 'constraint-counterfactuals', COUNTERFACTUAL_KEY, {
          ...views,
          version: CONSTRAINT_SCHEMA_VERSION,
        });
        this.repository.audit.record({
          actor: actorId,
          action: 'constraints.counterfactuals.run',
          targetType: 'project',
          targetId: projectId,
          projectId,
          detail: {
            views: views.views.length,
            applicable: views.views.filter((view) => view.applicable).length,
            seeds: views.seeds,
          },
        });
      });
      return this.readCounterfactuals(projectId, may);
    });
  }
}
