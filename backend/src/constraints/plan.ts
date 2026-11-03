import { planRuns } from '../../../shared/analysis-plan.js';
import type { Variant } from '../../../shared/analysis.js';
import type { AnalysisReadiness } from '../../../shared/analysis-plan.js';
import {
  provisionalLabel,
  type ConstraintCoverage,
  type ConstraintSet,
} from '../../../shared/constraints.js';
import type { AnalysisConstraints } from '../../../shared/constraint-effects.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import type { ActorSet } from '../../../shared/stakeholders.js';
import { planImpacts } from '../analysis/constraint-impact.js';
import { AppError } from '../errors.js';
import { compileConstraints } from './enforce.js';
import type { GateWorld } from './gate.js';
import { refreshSet } from './refresh.js';

/** What the gate and the comparison read of the rest of the project. */
export interface ProjectRecords {
  scenario: { data: ScenarioFrame; revision: number } | null;
  actors: { data: Pick<ActorSet, 'actors' | 'relations'>; revision: number } | null;
}

/** The gate's world for a set of scenarios: the alternatives to try, the cast and the assumptions. */
export function gateWorldOf(
  set: Pick<ConstraintSet, 'scenarioRevision' | 'actorsRevision'>,
  records: ProjectRecords,
  variants: readonly Variant[],
): GateWorld {
  return {
    alternatives: variants
      .filter((variant) => variant.kind === 'alternative')
      .map(({ id, label }) => ({ id, label })),
    variantIds: new Set(variants.map((variant) => variant.id)),
    actors: (records.actors?.data.actors ?? []).map(({ id, name }) => ({ id, name })),
    assumptionIds: new Set(
      records.scenario?.data.assumptions.map((assumption) => assumption.id) ?? [],
    ),
    stale: {
      scenario: set.scenarioRevision !== (records.scenario?.revision ?? 0),
      actors: set.actorsRevision !== (records.actors?.revision ?? 0),
    },
  };
}

const CLEAR_LABEL = 'No constraint was left unconfirmed when this comparison started.';

/** What a comparison records of the constraints it was started under, and what the gate said. */
export interface ConstraintRunPlan {
  revision: number;
  coverage: ConstraintCoverage;
  recorded: Omit<AnalysisConstraints, 'impacts'>;
}

/**
 * Works out whether a comparison may start under the project's constraints, and what it records of
 * them. With no constraints at all the answer is null and the comparison runs as it always did. A
 * blocked gate, or constraints no person has been through, refuse it with a sentence that says what to
 * do; a provisional gate lets it run and puts its label on the comparison.
 */
export function planConstraints(
  record: { data: ConstraintSet; revision: number } | null,
  records: ProjectRecords,
  variants: readonly Variant[],
  now: Date,
): ConstraintRunPlan | null {
  if (!record) return null;
  const world = gateWorldOf(record.data, records, variants);
  const set = refreshSet(record.data, world, now);
  const coverage = set.coverage as ConstraintCoverage;
  const first = coverage.blockedBy[0];
  if (first) {
    throw new AppError(
      409,
      'CONSTRAINTS_BLOCKED',
      `The constraints stop this comparison: ${first.text} Open the Map, go to Constraints and settle it, then run the simulation.`.slice(
        0,
        600,
      ),
    );
  }
  if (!coverage.reviewed) {
    const waiting = set.constraints.filter((constraint) => constraint.review === 'proposed').length;
    throw new AppError(
      409,
      'CONSTRAINTS_UNREVIEWED',
      waiting > 0
        ? `${waiting} ${waiting === 1 ? 'constraint is' : 'constraints are'} still waiting for your decision. Open the Map, go to Constraints, accept or change each one and confirm the review, then run the simulation.`
        : 'The constraints have not been confirmed as reviewed. Open the Map, go to Constraints, check them and confirm the review, then run the simulation.',
    );
  }
  const compiled = compileConstraints(set.constraints, {
    actorIds: new Set(world.actors.map((actor) => actor.id)),
    variantIds: world.variantIds,
  });
  const status = coverage.status === 'provisional' ? 'provisional' : 'clear';
  return {
    revision: record.revision,
    coverage,
    recorded: {
      revision: record.revision,
      status,
      label:
        status === 'provisional'
          ? (coverage.label ??
            provisionalLabel({
              unvalidated: 0,
              assumed: 0,
              unknown: 0,
              missing: 0,
              conflicting: 0,
              notModelledHard: 0,
            }))
          : CLEAR_LABEL,
      reasons: coverage.reasons.slice(0, 12),
      applied: compiled.applied,
      notApplied: compiled.notApplied,
    },
  };
}

/**
 * What the constraints say about the next comparison, for the page that offers it. It never throws:
 * a blocked or unreviewed set is reported as such, and the refusal itself is `planConstraints`'.
 */
export function readinessOf(
  record: { data: ConstraintSet; revision: number } | null,
  records: ProjectRecords,
  variants: readonly Variant[],
  now: Date,
  runsPerVariant: number,
): AnalysisReadiness['constraints'] | undefined {
  if (!record) return undefined;
  const world = gateWorldOf(record.data, records, variants);
  const set = refreshSet(record.data, world, now);
  const coverage = set.coverage as ConstraintCoverage;
  const compiled = compileConstraints(set.constraints, {
    actorIds: new Set(world.actors.map((actor) => actor.id)),
    variantIds: world.variantIds,
  });
  const pairs = planImpacts(compiled.applied, variants).length;
  const extraRuns =
    planRuns({
      variants: variants.length,
      runsPerVariant,
      sensitivity: false,
      perturbations: 0,
      constraintPairs: pairs,
    }).constraintRuns ?? 0;
  const counts = {
    applied: new Set(compiled.applied.map((item) => item.constraintId)).size,
    notApplied: compiled.notApplied.length,
  };
  if (coverage.blockedBy.length > 0) {
    return {
      status: 'blocked',
      ...counts,
      extraRuns: 0,
      message: coverage.blockedBy[0]?.text ?? 'The constraints stop the comparison.',
    };
  }
  if (!coverage.reviewed) {
    return {
      status: 'unreviewed',
      ...counts,
      extraRuns,
      message:
        'The constraints have not been reviewed yet. Open the Map, go to Constraints and confirm them before running the simulation.',
    };
  }
  return {
    status: coverage.status === 'provisional' ? 'provisional' : 'clear',
    ...counts,
    extraRuns,
    message: coverage.label ?? 'Every constraint is confirmed.',
  };
}
