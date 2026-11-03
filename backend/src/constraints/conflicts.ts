import { isLive, conflictToken, type Constraint } from '../../../shared/constraints.js';

/**
 * Pairs of constraints that cannot both hold, found from what they state and nothing else. Only a limit
 * stated as a number is compared: two ceilings for one thing, two floors, a ceiling below a floor, two
 * exact amounts. Two constraints of one kind that merely differ in words are not called a conflict, and
 * a conflict found here is a possible one: a person settles it by setting one of them aside or editing it.
 */
export interface Conflict {
  ids: [string, string];
  basis: string;
}

type Comparator = 'max' | 'min' | 'exact';

interface Quantity {
  comparator: Comparator;
  value: number;
  unit: string;
}

const COMPARATORS: readonly (readonly [RegExp, Comparator])[] = [
  [
    /\b(?:no\s+more\s+than|at\s+most|up\s+to|not\s+(?:to\s+)?exceed|maximum(?:\s+of)?|capped\s+at|cap\s+of|ceiling\s+of)\s*$/iu,
    'max',
  ],
  [/\b(?:at\s+least|no\s+less\s+than|minimum(?:\s+of)?|floor\s+of)\s*$/iu, 'min'],
  [/\b(?:exactly|precisely|fixed\s+at)\s*$/iu, 'exact'],
];

const MULTIPLIER: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

const NUMBER =
  /(?<currency>[$€£])?\s*(?<digits>\d[\d,]*(?:\.\d+)?)\s*(?<multiplier>thousand|million|billion|k|m)?\s*(?<unit>%|per\s?cent|percent|days?|weeks?|months?|quarters?|years?|hours?|people|staff|users?|customers?|seats?|rounds?)?/giu;

const UNIT_OF: Record<string, string> = {
  '%': '%',
  percent: '%',
  'per cent': '%',
};

function unitOf(currency: string | undefined, unit: string | undefined): string {
  if (currency) return currency;
  if (!unit) return '';
  const lower = unit.toLowerCase().replace(/\s+/gu, ' ');
  return UNIT_OF[lower] ?? lower.replace(/s$/u, '');
}

/** The limits a statement states as a number, each with its comparator, in the order they are written. */
export function quantitiesIn(statement: string): Quantity[] {
  const found: Quantity[] = [];
  for (const match of statement.matchAll(NUMBER)) {
    const before = statement.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    const comparator = COMPARATORS.find(([pattern]) => pattern.test(before))?.[1];
    if (!comparator) continue;
    const groups = match.groups ?? {};
    const value = Number((groups.digits ?? '').replaceAll(',', ''));
    if (!Number.isFinite(value)) continue;
    const scale = MULTIPLIER[(groups.multiplier ?? '').toLowerCase()] ?? 1;
    const unit = unitOf(groups.currency, groups.unit);
    // A bare number with no unit is as likely a count of anything: it is compared only with another bare number.
    found.push({ comparator, value: value * scale, unit });
  }
  return found;
}

function sharesScope(a: Constraint, b: Constraint): boolean {
  const overlap = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === 0 || y.length === 0 || x.some((id) => y.includes(id));
  return (
    overlap(a.affectedActorIds, b.affectedActorIds) &&
    overlap(a.affectedAlternativeIds, b.affectedAlternativeIds)
  );
}

function clash(a: Quantity, b: Quantity): string | null {
  if (a.unit !== b.unit) return null;
  const unit = a.unit ? ` ${a.unit}` : '';
  if (a.comparator === b.comparator && a.value !== b.value) {
    const word =
      a.comparator === 'max' ? 'ceilings' : a.comparator === 'min' ? 'floors' : 'amounts';
    return `They state two different ${word}: ${a.value}${unit} and ${b.value}${unit}.`;
  }
  const [max, min] = a.comparator === 'max' ? [a, b] : [b, a];
  if (max.comparator === 'max' && min.comparator === 'min' && max.value < min.value) {
    return `One caps it at ${max.value}${unit} and the other asks for at least ${min.value}${unit}.`;
  }
  return null;
}

/** The possible conflicts among the constraints a review has not set aside, each pair once, in a stable order. */
export function detectConflicts(constraints: readonly Constraint[]): Conflict[] {
  const live = constraints
    .filter(isLive)
    .map((constraint) => ({ constraint, quantities: quantitiesIn(constraint.statement) }))
    .filter((entry) => entry.quantities.length > 0);
  const found: Conflict[] = [];
  for (let at = 0; at < live.length; at += 1) {
    for (let other = at + 1; other < live.length; other += 1) {
      const first = live[at];
      const second = live[other];
      if (!first || !second || first.constraint.category !== second.constraint.category) continue;
      if (!sharesScope(first.constraint, second.constraint)) continue;
      for (const a of first.quantities) {
        const basis = second.quantities.map((b) => clash(a, b)).find((said) => said !== null);
        if (basis) {
          const ids = [first.constraint.id, second.constraint.id].sort() as [string, string];
          if (!found.some((conflict) => conflict.ids[0] === ids[0] && conflict.ids[1] === ids[1])) {
            found.push({ ids, basis });
          }
          break;
        }
      }
    }
  }
  return found.sort((a, b) => a.ids[0].localeCompare(b.ids[0]) || a.ids[1].localeCompare(b.ids[1]));
}

/** The constraints with `conflict` worked out again: each names the others it cannot hold with. */
export function withConflicts(constraints: readonly Constraint[]): Constraint[] {
  const conflicts = detectConflicts(constraints);
  return constraints.map((constraint) => ({
    ...constraint,
    conflict: conflicts
      .filter((conflict) => conflict.ids.includes(constraint.id))
      .map((conflict) => conflictToken(conflict.ids.find((id) => id !== constraint.id) ?? ''))
      .slice(0, 10),
  }));
}
