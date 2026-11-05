import type { Analysis } from '../../../shared/analysis.js';
import {
  effectPhrase,
  isLive,
  missingConstraintsSentence,
  sourceLabel,
  type Constraint,
  type ConstraintCoverage,
  type ConstraintSet,
} from '../../../shared/constraints.js';
import {
  labelOfConstraint,
  type ConstraintRow,
  type DecisionCanvas,
} from '../../../shared/decision.js';
import { CONSTRAINTS_FALLBACK_LABEL, withoutRulesUsed } from '../../../shared/model-failure.js';
import { clip, listed } from './words.js';

/**
 * The material constraints of the decision, read from the constraints as they stand now (the gate is
 * worked out again whenever they are read) and from what the comparison recorded of the ones it ran
 * under. A constraint that is only read is shown as read-only: the simulation did not test it.
 */

const MAX_ROWS = 20;

export interface ConstraintReading {
  gate: DecisionCanvas['constraints']['gate'];
  section: DecisionCanvas['constraints'];
  /** Alternative id to the statements of the hard constraints that rule it out and are confirmed. */
  confirmedViolations: Map<string, string[]>;
  /** The same for hard constraints that nobody has confirmed. */
  unconfirmedViolations: Map<string, string[]>;
  /** Conflicts between live hard constraints, in the gate’s words. */
  hardConflicts: string[];
  rows: ConstraintRow[];
  coverage: ConstraintCoverage | null;
}

const isHard = (constraint: Constraint): boolean => constraint.hardness === 'hard';

/** What the canvas says of how the constraints were made: see `constraintOrigin`. */
export type ConstraintOrigin = DecisionCanvas['constraints']['origin'];

/**
 * How the constraints were made, or why there are none, for the canvas to say beside them. A set that rules made
 * after a model was asked and could not be used is `rules-fallback`, with the failure in the server’s own words, and
 * is never read as the model’s. Where nobody read any constraints it says whether a model could have been asked:
 * "Not reviewed" with no reason would leave a person to guess whether the step failed or was never run.
 */
export function constraintOrigin(
  set: ConstraintSet | null,
  projectMode?: 'llm' | 'local',
): ConstraintOrigin {
  if (!set) {
    return {
      source: 'none',
      label: 'No constraints were proposed',
      detail:
        projectMode === 'llm'
          ? 'The constraints step was not run, so the model was never asked to propose any. Open the Map, choose Constraints, and ask the model to read them.'
          : projectMode === 'local'
            ? 'The constraints step was not run, and this project runs without a model. Open the Map, choose Constraints, and read your sources.'
            : 'The constraints step was not run. Open the Map, choose Constraints, and read your sources, or ask the model when the project is model-assisted.',
    };
  }
  const reviewed = set.reviewedAt
    ? 'A person has been through them.'
    : 'A person has not reviewed them yet.';
  if (set.mode === 'user') {
    return {
      source: 'user',
      label: 'Constraints added by a person',
      detail: 'A person wrote these. Swarm did not propose them.',
    };
  }
  if (set.modelFailure) {
    return {
      source: 'rules-fallback',
      label: CONSTRAINTS_FALLBACK_LABEL,
      detail: clip(
        `${withoutRulesUsed(set.modelFailure.detail)} Rules read the constraints instead, so no model proposed them. ${reviewed}`,
        400,
      ),
    };
  }
  if (set.mode === 'model') {
    return {
      source: 'model',
      label: 'Constraints proposed by a model',
      detail: clip(
        `${set.model ? `The model ${set.model}` : 'A model'} read your sources, and so did the rules. ${reviewed}`,
        400,
      ),
    };
  }
  return {
    source: 'rules',
    label: 'Constraints read by rules',
    detail: clip(
      `No model was used: rules read your words, your sources and who is involved. ${reviewed}`,
      400,
    ),
  };
}

function rowOf(
  constraint: Constraint,
  violatedBy: readonly string[],
  recorded: { applied: ReadonlySet<string>; notApplied: ReadonlySet<string>; known: boolean },
): ConstraintRow {
  const enforced = constraint.enforcement === 'enforced';
  return {
    id: constraint.id,
    statement: clip(constraint.statement, 400),
    category: constraint.category,
    hardness: constraint.hardness,
    source: sourceLabel(constraint),
    label: labelOfConstraint(constraint),
    validation: constraint.validation,
    enforcement: enforced ? 'enforced' : 'read-only',
    inComparison: !recorded.known
      ? 'unknown'
      : recorded.applied.has(constraint.id)
        ? 'applied'
        : recorded.notApplied.has(constraint.id)
          ? 'read-only'
          : 'not-in-comparison',
    effects: constraint.effects.slice(0, 3).map((effect) => clip(effectPhrase(effect), 200)),
    provisional: isHard(constraint) && constraint.validation !== 'confirmed',
    violatedBy: [...violatedBy].slice(0, 8),
  };
}

export function readConstraints(
  set: ConstraintSet | null,
  analysis: Pick<Analysis, 'constraints'>,
  projectMode?: 'llm' | 'local',
): ConstraintReading {
  const comparison = analysis.constraints ?? null;
  const coverage = set?.coverage ?? null;
  const live = set ? set.constraints.filter(isLive) : [];
  const byId = new Map(live.map((constraint) => [constraint.id, constraint]));
  const violations = new Map<string, string[]>();
  for (const violation of coverage?.violations ?? []) {
    for (const id of violation.constraintIds) {
      violations.set(id, [...(violations.get(id) ?? []), violation.alternativeId]);
    }
  }
  const confirmedViolations = new Map<string, string[]>();
  const unconfirmedViolations = new Map<string, string[]>();
  for (const violation of coverage?.violations ?? []) {
    for (const id of violation.constraintIds) {
      const constraint = byId.get(id);
      if (!constraint) continue;
      const target =
        constraint.validation === 'confirmed' ? confirmedViolations : unconfirmedViolations;
      target.set(violation.alternativeId, [
        ...(target.get(violation.alternativeId) ?? []),
        constraint.statement,
      ]);
    }
  }
  // An alternative one confirmed constraint rules out is ruled out, whatever else is only assumed.
  for (const id of confirmedViolations.keys()) unconfirmedViolations.delete(id);

  const recorded = {
    known: comparison !== null,
    applied: new Set((comparison?.applied ?? []).map((item) => item.constraintId)),
    notApplied: new Set((comparison?.notApplied ?? []).map((item) => item.constraintId)),
  };
  const ordered = [...live].sort(
    (a, b) =>
      Number(isHard(b)) - Number(isHard(a)) ||
      Number(a.validation === 'confirmed') - Number(b.validation === 'confirmed') ||
      a.id.localeCompare(b.id),
  );
  const rows = ordered.map((constraint) =>
    rowOf(constraint, violations.get(constraint.id) ?? [], recorded),
  );
  const hard = rows.filter((row) => row.hardness === 'hard').slice(0, MAX_ROWS);
  const soft = rows.filter((row) => row.hardness === 'soft').slice(0, MAX_ROWS);

  const hardIds = new Set(live.filter(isHard).map((constraint) => constraint.id));
  const hardConflicts = (coverage?.conflicting ?? [])
    .filter((conflict) => conflict.ids.length >= 2 && conflict.ids.every((id) => hardIds.has(id)))
    .map((conflict) => clip(conflict.basis, 300));

  const gate: DecisionCanvas['constraints']['gate'] = coverage ? coverage.status : 'none';
  const openQuestions = coverage?.missing ?? [];
  const notModelled = (coverage?.interpretive ?? [])
    .filter((ref) => ref.hardness === 'hard')
    .slice(0, 8)
    .map((ref) => clip(ref.statement, 200));
  const comparisonStatus = comparison?.status ?? 'none';
  const provisional = comparisonStatus === 'provisional' || gate === 'provisional';
  const note =
    gate === 'none'
      ? 'No constraints were reviewed for this decision, so the picture does not say what limits it. To read them, open the Map, choose Constraints, and read the sources, or ask the model when the project is model-assisted.'
      : live.length === 0
        ? 'No constraints were identified. That is what was found, not proof that none exist.'
        : `${listed([`${hard.length} hard`, `${soft.length} soft`])} ${live.length === 1 ? 'constraint' : 'constraints'} stand${live.length === 1 ? 's' : ''} behind this answer. ${comparison ? 'The comparison ran under the ones marked applied.' : 'The comparison recorded none of them.'}`;
  return {
    gate,
    coverage,
    confirmedViolations,
    unconfirmedViolations,
    hardConflicts,
    rows,
    section: {
      gate,
      gateSummary: clip(coverage?.summary ?? 'No constraints were reviewed.', 300),
      comparisonStatus,
      provisional,
      provisionalLabel: provisional
        ? clip(
            (comparisonStatus === 'provisional' ? comparison?.label : coverage?.label) ??
              coverage?.label ??
              'Provisional: some constraints are not confirmed.',
            300,
          )
        : null,
      reviewed: coverage?.reviewed ?? false,
      hard,
      soft,
      missing:
        openQuestions.length > 0
          ? [
              missingConstraintsSentence(Math.min(openQuestions.length, 3)),
              ...openQuestions.slice(0, 5).map((question) => clip(question.text, 300)),
            ]
          : [],
      notModelled,
      note: clip(note, 500),
      origin: constraintOrigin(set, projectMode),
    },
  };
}
