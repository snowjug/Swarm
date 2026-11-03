import {
  CONSTRAINT_CATEGORY_LABELS,
  MAX_CLARIFICATIONS,
  MAX_OPEN_QUESTIONS,
  type Clarification,
  type Constraint,
  type ConstraintCategory,
} from '../../../shared/constraints.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { inspectText } from '../models/injection.js';
import { truncate } from '../stakeholders/names.js';
import type { Undecided } from './detect.js';
import type { ModelQuestion } from './model.js';
import { impliedBy, SITUATIONS } from './situation.js';
import type { DiscoveryContext } from './types.js';

/**
 * Kinds of limit that one answer covers for the other: a legal limit and a regulatory one are asked about
 * together, as are a limit on capacity and one on staffing, and a contract that binds the change and
 * something outside the project's control that it depends on, which are most often the same other party.
 */
const KIN: Readonly<Partial<Record<ConstraintCategory, readonly ConstraintCategory[]>>> = {
  legal: ['regulatory'],
  regulatory: ['legal'],
  capacity: ['staffing'],
  staffing: ['capacity'],
  contractual: ['dependency'],
  dependency: ['contractual'],
};

const generic = (category: ConstraintCategory): string =>
  `What is known about limits of this kind (${CONSTRAINT_CATEGORY_LABELS[category].toLowerCase()}) on this decision?`;

/**
 * The questions to add to those already asked, never more than three open at once in the whole set: what
 * a source says is not settled comes first, then what a model asked, then what the situation points to
 * (`situation.ts`): who is involved, what kind of change it is and what the sources are about, where
 * nothing in the project says whether a limit of that kind applies. Kinds every decision has (money,
 * time, undoing it) follow, so that a project the situation says nothing about is still asked the basics.
 * A category the project already holds a constraint for, or has asked about, is not asked again, so a
 * question the person answered, left unknown or turned away stays so; the ones that were not asked for
 * want of room are the next to be asked when there is.
 */
export function newQuestions(input: {
  context: DiscoveryContext;
  /** The passages that may be read: those withheld from reading are not evidence of anything. */
  passages: readonly EvidenceChunk[];
  undecided: readonly Undecided[];
  modelQuestions: readonly ModelQuestion[];
  constraints: readonly Constraint[];
  existing: readonly Clarification[];
}): Clarification[] {
  const taken = new Set<ConstraintCategory>();
  // What a source says is unsettled, or a model asks, is asked unless the category is held or asked; what only
  // the situation suggests is also not asked where a kin of the kind is held.
  const covered = new Set<ConstraintCategory>();
  const take = (category: ConstraintCategory): void => {
    taken.add(category);
    covered.add(category);
    for (const kin of KIN[category] ?? []) covered.add(kin);
  };
  for (const constraint of input.constraints) take(constraint.category);
  for (const question of input.existing) take(question.category);
  const open = input.existing.filter((question) => question.status === 'open').length;
  const room = Math.max(
    0,
    Math.min(MAX_OPEN_QUESTIONS - open, MAX_CLARIFICATIONS - input.existing.length),
  );
  const asked: Clarification[] = [];
  const ask = (
    category: ConstraintCategory,
    question: string,
    why: string,
    suggested = false,
  ): void => {
    if ((suggested ? covered : taken).has(category) || asked.length >= room) return;
    take(category);
    asked.push({
      id: `q-${category}`,
      category,
      question: truncate(question, 300),
      why: truncate(why, 300),
      status: 'open',
      answer: null,
      constraintId: null,
    });
  };
  const known = new Map(SITUATIONS.map((situation) => [situation.category, situation]));
  for (const unsettled of input.undecided) {
    ask(
      unsettled.category,
      known.get(unsettled.category)?.question ?? generic(unsettled.category),
      `A source says this is not settled: “${truncate(unsettled.quote, 160)}”`,
    );
  }
  for (const item of input.modelQuestions) {
    if (inspectText(`${item.question} ${item.why}`).suspicious) continue;
    ask(item.category, item.question, item.why);
  }
  const implied = impliedBy(input.context, input.passages);
  // What the situation points to, the most pointed to first; the kinds every decision has come after those.
  const ranked = [...implied].sort(
    (a, b) =>
      Number(a.situation.universal === true) - Number(b.situation.universal === true) ||
      b.points - a.points,
  );
  for (const item of ranked) {
    ask(
      item.situation.category,
      item.situation.question,
      item.reason ? `${item.reason} ${item.situation.why}` : item.situation.why,
      true,
    );
  }
  return asked;
}
