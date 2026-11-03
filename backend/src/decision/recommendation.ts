import {
  RECOMMENDATION_PARTS,
  type ActorReading,
  type ApprovalPoint,
  type ConstraintRow,
  type CritiqueReading,
  type DecisionCanvas,
  type DecisionStatusReading,
  type Labelled,
  type LensReading,
  type Part,
  type RecommendationCard,
  type RecommendationPart,
  type StopCondition,
  type ValidationItem,
} from '../../../shared/decision.js';
import { labelOf } from '../../../shared/decision.js';
import type { Flip, StatusOption } from './status.js';
import type { ConsequentialScope } from './scope.js';
import { reviewersOf } from './scope-words.js';
import { Guard, embed, listed } from './words.js';

/**
 * The recommendation, in every status. Where the status names an option it recommends taking it
 * forward in checked steps; where it does not, it recommends the next move that would let it. Either way
 * it states the same ten things, and a part with nothing to say is shown as missing and never left out:
 * what is recommended, for whom, under which assumptions and constraints, what supports it, what weakens
 * it, what would invalidate it, what to test next, whether it can be reversed, and what a person has to
 * approve. Swarm recommends; it never executes anything or contacts anyone.
 */

export interface CardInput {
  status: DecisionStatusReading;
  scope: ConsequentialScope;
  options: readonly StatusOption[];
  preferred: StatusOption | null;
  /** The options at the top that cannot be told apart, or that lead on different lenses. */
  contenders: readonly StatusOption[];
  owners: readonly ActorReading[];
  affected: readonly ActorReading[];
  flips: readonly Flip[];
  flippingAssumptions: readonly {
    label: string;
    origin: 'evidence' | 'user' | 'system-assumption' | 'model' | 'scenario';
  }[];
  statedAssumptions: readonly { text: string; origin: 'user' | 'system' }[];
  strengthSetBy: 'you' | 'system' | null;
  hard: readonly ConstraintRow[];
  soft: readonly ConstraintRow[];
  gateStatus: DecisionCanvas['constraints']['gate'];
  gateLabel: string | null;
  evidence: DecisionCanvas['evidence'];
  lenses: readonly LensReading[];
  critiques: readonly CritiqueReading[];
  validation: readonly ValidationItem[];
  stops: readonly StopCondition[];
  reversibility: DecisionCanvas['reversibility'];
  approvals: readonly ApprovalPoint[];
}

const part = (items: Labelled[], missing: string): Part =>
  items.length > 0 ? { items: items.slice(0, 8), missing: null } : { items: [], missing };

const optionName = (option: StatusOption | undefined): string =>
  embed(option?.label ?? 'the option', 60);

export function buildRecommendation(input: CardInput, guard: Guard): RecommendationCard {
  const { status, preferred } = input;
  const baseline = input.options.find((option) => option.kind === 'baseline');
  let kind: RecommendationCard['kind'];
  let what: string;
  switch (status.status) {
    case 'robust-option':
    case 'conditional-option': {
      const keep = preferred?.kind === 'baseline';
      kind = keep ? 'keep-no-change' : 'proceed';
      const conditional = status.status === 'conditional-option';
      what = keep
        ? `Keep ${optionName(preferred ?? baseline)}: on the lenses Swarm computed, no alternative came out ahead of it${conditional ? ', on the conditions listed' : ''}. Do not change course until the checks below are done and a named approver agrees.`
        : `Take ${optionName(preferred ?? undefined)} forward${conditional ? ', only on the conditions listed,' : ''} in steps that can be checked, once the high-priority checks below are done and a named approver agrees.`;
      break;
    }
    case 'multiple-plausible-options':
      kind = 'hold';
      what = `Do not choose between ${listed(input.contenders.slice(0, 3).map((option) => optionName(option)))} on this result. Test what separates them first, in a small and reversible way.`;
      break;
    case 'insufficient-evidence':
      kind = 'gather-evidence';
      what =
        'Do not act on this result. Gather the evidence listed below, then run the comparison again.';
      break;
    case 'blocked-by-hard-constraint':
      kind = 'resolve-constraint';
      what =
        'Do not go past the hard constraint. Settle it first with its owner: confirm it, correct it or set it aside, then run the comparison again.';
      break;
    case 'needs-human-decision':
      if (status.rule === 'individual-decision') {
        kind = 'qualified-person';
        what =
          'A qualified person decides this; here is what the exploration can and cannot tell them.';
        break;
      }
      kind = 'decide';
      what =
        input.contenders.length > 1
          ? `Take the choice to the decision owner with the trade-off in front of them: ${listed(input.contenders.slice(0, 3).map((option) => optionName(option)))} lead on different lenses.`
          : 'Take the conflicting hard constraints to their owners and settle which one gives way.';
      break;
  }

  const forWhom: Labelled[] = [
    ...(status.rule === 'individual-decision'
      ? [
          guard.statement(
            `A qualified person decides this: ${reviewersOf(input.scope.domains)}, a real person and not a simulated role.`,
            'validation-requirement',
            'scope:decider',
          ),
        ]
      : []),
    ...input.owners
      .slice(0, 2)
      .map((actor) =>
        guard.statement(
          `The decision owner: ${embed(actor.name, 60)}, a simulated role. A real person in that role makes the decision.`,
          'model-inference',
          'participant:position',
        ),
      ),
    ...input.affected
      .slice(0, 3)
      .map((actor) =>
        guard.statement(
          `It lands most on ${embed(actor.name, 60)}: in the simulation this role moves toward ${actor.moves === 'toward-support' ? 'support' : 'resistance'}.`,
          'simulation-event',
          'run:actor-shift',
        ),
      ),
  ];

  const assumptions: Labelled[] = [
    ...input.flippingAssumptions
      .slice(0, 3)
      .map((row) =>
        guard.statement(
          `The answer depends on ${embed(row.label, 120)}.`,
          labelOf('sensitivity-origin', row.origin),
          `sensitivity-origin:${row.origin}`,
        ),
      ),
    ...input.statedAssumptions
      .slice(0, 3)
      .map((row) =>
        guard.statement(embed(row.text, 200), 'assumption', `scenario-assumption:${row.origin}`),
      ),
  ];
  if (input.strengthSetBy) {
    assumptions.push(
      guard.statement(
        `How strongly and when the change lands was ${input.strengthSetBy === 'you' ? 'set by you' : 'set by Swarm as a default'}; the simulation did not measure it.`,
        'assumption',
        'variant:strength',
      ),
    );
  }
  assumptions.push(
    guard.statement(
      'Any trait of a simulated actor that no cited passage backs is an assumption set by a person or by Swarm.',
      'assumption',
      'trait-origin',
    ),
  );

  const constraints: Labelled[] = input.hard
    .slice(0, 3)
    .map((row) =>
      guard.statement(
        `${row.validation === 'confirmed' ? 'Confirmed hard constraint' : 'Hard constraint, not confirmed'}: ${embed(row.statement, 140)}`,
        row.label,
        `constraint:${row.id}`,
      ),
    );
  if (input.gateStatus === 'provisional' && input.gateLabel) {
    constraints.push(guard.statement(input.gateLabel, 'model-inference', 'gate:provisional'));
  }
  if (input.gateStatus === 'none') {
    constraints.push(
      guard.statement(
        'No constraints were reviewed for this decision, so what limits it is not stated.',
        'validation-requirement',
        'gate:none',
      ),
    );
  } else if (input.hard.length === 0 && input.soft.length === 0) {
    constraints.push(
      guard.statement(
        'No constraints were identified. That is what was found, not proof that none exist.',
        'validation-requirement',
        'gate:empty',
      ),
    );
  }

  const supporting: Labelled[] = [
    ...input.evidence.statements
      .filter((line) => line.label === 'fact' || line.label === 'source-claim')
      .slice(0, 3),
    ...(preferred
      ? input.lenses
          .filter((lens) => lens.computable && lens.leaderId === preferred.id)
          .slice(0, 2)
          .map((lens) =>
            guard.statement(
              `On ${embed(lens.name, 70)} ${optionName(preferred)} was clearly ahead of the other options across the seeded runs of the simulation.`,
              'simulation-event',
              `lens:${lens.id}`,
            ),
          )
      : []),
  ];

  const weakening: Labelled[] = [
    ...input.evidence.reasons
      .slice(0, 2)
      .map((reason) => guard.statement(reason, 'validation-requirement', 'evidence:reason')),
    ...input.critiques
      .filter((critique) => critique.severity === 'blocking' || critique.severity === 'major')
      .slice(0, 2)
      .map((critique) => critique.objection),
  ];

  const invalidated: Labelled[] = [
    ...input.flips
      .slice(0, 3)
      .map((flip) =>
        guard.statement(
          `It could stop leading if ${flip.text}`,
          'simulation-event',
          `flip:${flip.kind}`,
        ),
      ),
    ...input.stops
      .slice(0, 2)
      .map((stop) => guard.statement(stop.when, 'validation-requirement', stop.id)),
  ];

  const testNext: Labelled[] = input.validation
    .slice(0, 3)
    .map((item) => guard.statement(item.what, 'validation-requirement', item.id));

  const approval: Labelled[] = input.approvals
    .filter((point) => point.stage === 'before-acting')
    .slice(0, 3)
    .map((point) => guard.statement(point.text, 'validation-requirement', point.id));

  const parts = {
    forWhom: part(forWhom, 'No decision owner or affected group is identified in the cast.'),
    assumptions: part(assumptions, 'No assumption is recorded for this result.'),
    constraints: part(constraints, 'No constraint is recorded for this result.'),
    supportingEvidence: part(
      supporting,
      'Nothing cited and nothing in the simulation supports it yet.',
    ),
    weakeningEvidence: part(
      weakening,
      'No evidence that weakens it was found. That does not show that none exists.',
    ),
    invalidatedBy: part(invalidated, 'Nothing that would invalidate it was identified.'),
    testNext: part(testNext, 'No check was derived for it.'),
    approval: part(approval, 'No approval point was recorded.'),
  } satisfies Record<RecommendationPart, Part>;

  return {
    kind,
    what: guard.statement(what, 'recommendation', `status:${status.status}`),
    ...parts,
    reversibility: input.reversibility,
    missing: RECOMMENDATION_PARTS.filter((name) => parts[name].missing !== null),
  };
}
