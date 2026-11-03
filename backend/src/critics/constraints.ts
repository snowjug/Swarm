import {
  CONSTRAINT_CATEGORY_LABELS,
  effectPhrase,
  isHighStakes,
  SOURCE_LABELS,
  VALIDATION_LABELS,
  type ConstraintCategory,
} from '../../../shared/constraints.js';
import type { AnalysisConstraints } from '../../../shared/constraint-effects.js';
import type { Critique } from '../../../shared/critique.js';
import { clip, draft, fixed, names, plural, signed, stableId, whole } from './text.js';
import type { Resolved, RoleCritic } from './types.js';

/**
 * What a comparison rests on, as far as limits go: which constraints it ran under, which it only read,
 * and which of those nobody has confirmed. It reads only what the comparison recorded of them
 * (`analysis.constraints`), says nothing for a comparison that was run without a reviewed set, and
 * raises its objections under the assumption role (what is leaned on without being confirmed) and the
 * methodology role (what the simulation could not test). Pure: the same record gives the same critiques.
 */

const MAX_DRIVERS = 5;
const MAX_LISTED = 4;

const highStakes = (category: string): boolean => isHighStakes(category as ConstraintCategory);

const labelOf = (category: string): string =>
  (CONSTRAINT_CATEGORY_LABELS[category as ConstraintCategory] ?? category).toLowerCase();

/** "Budget: Spending is capped" for each of the first few, so that a person can find the constraint. */
const listed = (items: readonly { category: string; statement: string }[]): string[] =>
  items
    .slice(0, MAX_LISTED)
    .map((item) => clip(`${labelOf(item.category)}: ${item.statement}`, 190));

function provisional(input: Resolved, record: AnalysisConstraints): Critique[] {
  if (record.status !== 'provisional') return [];
  const everything = [...record.applied, ...record.notApplied];
  const hardUnsettled = everything.some(
    (item) =>
      item.hardness === 'hard' &&
      (item.validation === 'unvalidated' || item.validation === 'assumed'),
  );
  const applied = new Set(record.applied.map((item) => item.constraintId)).size;
  return [
    draft(input.now, {
      id: 'constraints-provisional',
      role: 'assumption',
      target: whole(input.analysis.id),
      severity: hardUnsettled ? 'major' : 'minor',
      objection:
        'This comparison was run while the constraints it rests on were not all confirmed, so what it shows holds only if they do.',
      basis: [
        `The gate said: ${record.label}`,
        ...record.reasons.slice(0, 3),
        `Constraints applied: ${applied}; read and not applied: ${record.notApplied.length}.`,
        `Constraint set: revision ${record.revision}.`,
      ],
      impact:
        'If this stands, the headline result is conditional on constraints that may not hold; present it as provisional until they are confirmed.',
      action:
        'Confirm, change or set aside each constraint that is not yet validated, then run the comparison again.',
    }),
  ];
}

function drivers(input: Resolved, record: AnalysisConstraints): Critique[] {
  const byId = new Map(record.applied.map((item) => [item.constraintId, item]));
  const strongest = new Map<string, (typeof record.impacts)[number]>();
  for (const impact of record.impacts) {
    if (impact.classification !== 'material') continue;
    const held = strongest.get(impact.constraintId);
    if (!held || Math.abs(impact.withoutShift) > Math.abs(held.withoutShift)) {
      strongest.set(impact.constraintId, impact);
    }
  }
  return [...strongest.values()]
    .flatMap((impact) => {
      const constraint = byId.get(impact.constraintId);
      if (!constraint || constraint.validation === 'confirmed') return [];
      const variant = input.analysis.config.variants.find((item) => item.id === impact.variantId);
      const inferred = constraint.source === 'inferred';
      const assumed = constraint.validation === 'assumed';
      return [
        {
          impact,
          critique: draft(input.now, {
            id: stableId('constraints-driver', constraint.constraintId),
            role: 'assumption',
            target: whole(input.analysis.id),
            severity: inferred || assumed ? 'major' : 'minor',
            objection: `The simulated result moves when the ${labelOf(constraint.category)} constraint “${clip(constraint.statement, 160)}” is taken away, and nobody has confirmed it${
              inferred
                ? ': it was inferred from who is involved, not found in a source'
                : assumed
                  ? ': it is an assumption'
                  : ': a source says so, and no person has checked it'
            }.`,
            basis: [
              `Tested: taking the constraint away for “${clip(variant?.label ?? impact.variantId, 80)}”, on ${impact.seeds} paired seeds.`,
              `${impact.metric}; shift ${signed(impact.withoutShift)} with standard error ${fixed(impact.standardError)}, from a simulated mean of ${fixed(impact.withMean)} with it.`,
              `Where it came from: ${SOURCE_LABELS[constraint.source].toLowerCase()}; validation: ${VALIDATION_LABELS[constraint.validation].toLowerCase()}.`,
              `What the simulation did with it: ${effectPhrase(constraint.effect)}.`,
            ],
            impact:
              'If this stands, the headline result leans on a constraint nobody has confirmed; say so wherever the result is used, and confirm the constraint before relying on it.',
            action:
              'Confirm the constraint, change it, or set it aside, then run the comparison again.',
          }),
        },
      ];
    })
    .sort(
      (a, b) =>
        Math.abs(b.impact.withoutShift) - Math.abs(a.impact.withoutShift) ||
        a.critique.id.localeCompare(b.critique.id),
    )
    .slice(0, MAX_DRIVERS)
    .map((item) => item.critique);
}

function notModelled(input: Resolved, record: AnalysisConstraints): Critique[] {
  const hard = record.notApplied.filter(
    (item) => item.reason === 'interpretive' && item.hardness === 'hard',
  );
  if (hard.length === 0) return [];
  const stakes = hard.some((item) => highStakes(item.category));
  const many = hard.length !== 1;
  return [
    draft(input.now, {
      id: 'constraints-hard-not-modelled',
      role: 'methodology',
      target: whole(input.analysis.id),
      severity: stakes ? 'major' : 'minor',
      objection: `${plural(hard.length, 'hard constraint')} ${many ? 'were' : 'was'} read and not tested: the simulation has no way to apply ${many ? 'them' : 'it'}, so the result says nothing about whether any alternative meets ${many ? 'them' : 'it'}.`,
      basis: [
        ...listed(hard),
        ...(hard.length > MAX_LISTED ? [`And ${hard.length - MAX_LISTED} more.`] : []),
      ],
      impact:
        'If this stands, the alternative that comes out ahead may break a hard limit that this comparison did not test; check each alternative against it before relying on the result.',
      action: 'Check each alternative against these limits outside the simulation.',
    }),
  ];
}

function unknownLeftOut(input: Resolved, record: AnalysisConstraints): Critique[] {
  const unknown = record.notApplied.filter((item) => item.reason === 'unknown');
  if (unknown.length === 0) return [];
  const many = unknown.length !== 1;
  return [
    draft(input.now, {
      id: 'constraints-unknown-left-out',
      role: 'assumption',
      target: whole(input.analysis.id),
      severity: unknown.some((item) => item.hardness === 'hard' || highStakes(item.category))
        ? 'major'
        : 'minor',
      objection: `${plural(unknown.length, 'constraint')} ${many ? 'were' : 'was'} marked unknown and left out of the runs, which treats ${many ? 'them' : 'it'} as absent, not as false.`,
      basis: listed(unknown),
      impact:
        'If this stands, the result describes a project where these limits do not apply; where one of them does, the result is more favourable to the change than the constraints allow.',
      action:
        'Find out whether each holds, or assume one and say so, then run the comparison again.',
    }),
  ];
}

function notNamed(input: Resolved, record: AnalysisConstraints): Critique[] {
  const gone = record.notApplied.filter(
    (item) => item.reason === 'dangling' || item.reason === 'over-limit',
  );
  if (gone.length === 0) return [];
  const many = gone.length !== 1;
  return [
    draft(input.now, {
      id: 'constraints-not-applied-names',
      role: 'methodology',
      target: whole(input.analysis.id),
      severity: 'minor',
      objection: `${plural(gone.length, 'constraint')} could not be applied: ${many ? 'they name' : 'it names'} an actor or a scenario that is not in this comparison, or came after the most effects a comparison applies.`,
      basis: listed(gone),
      impact:
        'If this stands, the runs leave out limits the constraint list holds; the list and the comparison do not describe the same project.',
      action:
        'Update the constraints to the actors and scenarios there are, then run the comparison again.',
    }),
  ];
}

function effectSizes(input: Resolved, record: AnalysisConstraints): Critique[] {
  if (record.applied.length === 0) return [];
  const kinds = [...new Set(record.applied.map((item) => item.effect.kind))].sort();
  return [
    draft(input.now, {
      id: 'constraints-effect-sizes',
      role: 'methodology',
      target: whole(input.analysis.id),
      severity: 'note',
      objection:
        'Where a source states a limit in words, the size of its effect on the simulated actors is a modelling choice, not a measurement.',
      basis: [
        `Effects the simulation applied: ${names(kinds, 8)}.`,
        ...record.applied
          .slice(0, 2)
          .map((item) => `${clip(item.statement, 120)}: ${effectPhrase(item.effect)}.`),
        'A source rarely says by how much a limit changes what people do; the amount in each effect is stated by the person or set by Swarm.',
      ],
      impact:
        'If this stands, the direction of an effect follows from the constraint, and its size is a setting that the simulated result depends on.',
    }),
  ];
}

export const constraintCritic: RoleCritic = (input) => {
  const record = input.analysis.constraints;
  if (!record) return [];
  return [
    ...provisional(input, record),
    ...drivers(input, record),
    ...notModelled(input, record),
    ...unknownLeftOut(input, record),
    ...notNamed(input, record),
    ...effectSizes(input, record),
  ];
};
