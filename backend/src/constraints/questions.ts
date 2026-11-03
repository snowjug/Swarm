import {
  CONSTRAINT_CATEGORY_LABELS,
  MAX_CLARIFICATIONS,
  type Clarification,
  type Constraint,
  type ConstraintCategory,
} from '../../../shared/constraints.js';
import { inspectText } from '../models/injection.js';
import { truncate } from '../stakeholders/names.js';
import type { Undecided } from './detect.js';
import type { ModelQuestion } from './model.js';
import type { DiscoveryContext } from './types.js';

/** The most questions one reading adds: a person is asked three at a time, so more would only queue. */
const MAX_NEW = 6;

interface QuestionSpec {
  category: ConstraintCategory;
  question: string;
  /** What it could change. Swarm's words about a kind of limit, not a finding of any source. */
  why: string;
  relevant: (context: DiscoveryContext, text: string) => boolean;
}

const hasActor = (context: DiscoveryContext, ...categories: string[]): boolean =>
  context.actors.some((actor) => categories.includes(actor.category));

/**
 * What can limit a decision and so is worth asking about, in the order it is asked. Each is asked only
 * where something in the question, the scenario or the cast gives a reason to, and never when the
 * project already holds a constraint of its kind, which is then reviewed instead of asked again.
 */
const TABLE: readonly QuestionSpec[] = [
  {
    category: 'regulatory',
    question: 'Does a law, a regulation or a required approval limit this change?',
    why: 'A legal or regulatory limit can rule an alternative out altogether.',
    relevant: (context, text) =>
      hasActor(context, 'regulator', 'governance') ||
      /\b(?:law|legal|regulat\w*|complian\w*|licen[cs]\w*|permit\w*|approv\w*)\b/iu.test(text),
  },
  {
    category: 'budget',
    question: 'Is there a budget or a spending limit on this decision? If so, what is it?',
    why: 'A spending limit can rule an alternative out or slow it down.',
    relevant: () => true,
  },
  {
    category: 'time',
    question: 'Is there a deadline, or a date before which nothing can start?',
    why: 'Timing decides when the change reaches people and who can respond first.',
    relevant: () => true,
  },
  {
    category: 'capacity',
    question: 'Who has to carry the change out, and is there a limit on how much they can take on?',
    why: 'A limit on capacity can delay the change or leave part of it undone.',
    relevant: (context, text) =>
      hasActor(context, 'operations', 'channel') ||
      /\b(?:capacit\w*|workload|staff\w*|team|handle)\b/iu.test(text),
  },
  {
    category: 'privacy',
    question: 'Does the change touch personal or confidential data?',
    why: 'Rules on personal data can limit what may be kept, shared or automated.',
    relevant: (_context, text) =>
      /\b(?:personal|privacy|confidential|transcript\w*|records?|data)\b/iu.test(text),
  },
  {
    category: 'contractual',
    question: 'Do any contracts or commitments bind the change?',
    why: 'A contract can fix terms, prices or notice periods that the change has to respect.',
    relevant: (context, text) =>
      hasActor(context, 'partner', 'channel') ||
      /\b(?:contract\w*|agreement|commitment|notice period|renewal)\b/iu.test(text),
  },
  {
    category: 'dependency',
    question:
      'Does the change depend on something outside your control, such as a supplier or another team?',
    why: 'If something it depends on is not ready, the change cannot go ahead as planned.',
    relevant: (context, text) =>
      hasActor(context, 'partner', 'channel') ||
      context.actorRelations.some(
        (relation) => relation.type === 'depends-on' || relation.type === 'supplies',
      ) ||
      /\b(?:depend\w*|supplier|vendor|third[- ]party)\b/iu.test(text),
  },
  {
    category: 'reversibility',
    question: 'Could the change be undone if it goes badly?',
    why: 'If it cannot be undone, being wrong costs more.',
    relevant: () => true,
  },
];

function textOf(context: DiscoveryContext): string {
  const { scenario } = context;
  return [
    context.question,
    scenario?.decision,
    scenario?.system,
    scenario?.baseline,
    ...(scenario?.alternatives.map((alternative) => alternative.description) ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

const generic = (category: ConstraintCategory): string =>
  `What is known about limits of this kind (${CONSTRAINT_CATEGORY_LABELS[category].toLowerCase()}) on this decision?`;

/**
 * The questions to add to those already asked: what a source says is not settled comes first, then what
 * a model asked, then what the table suggests. A category the project already holds a constraint for, or
 * has asked about, is not asked again, so a question the person answered, left unknown or turned away stays so.
 */
export function newQuestions(input: {
  context: DiscoveryContext;
  undecided: readonly Undecided[];
  modelQuestions: readonly ModelQuestion[];
  constraints: readonly Constraint[];
  existing: readonly Clarification[];
}): Clarification[] {
  const taken = new Set<ConstraintCategory>([
    ...input.constraints.map((constraint) => constraint.category),
    ...input.existing.map((question) => question.category),
  ]);
  const room = Math.max(0, Math.min(MAX_NEW, MAX_CLARIFICATIONS - input.existing.length));
  const asked: Clarification[] = [];
  const ask = (category: ConstraintCategory, question: string, why: string): void => {
    if (taken.has(category) || asked.length >= room) return;
    taken.add(category);
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
  const table = new Map(TABLE.map((spec) => [spec.category, spec]));
  for (const open of input.undecided) {
    ask(
      open.category,
      table.get(open.category)?.question ?? generic(open.category),
      `A source says this is not settled: “${truncate(open.quote, 160)}”`,
    );
  }
  for (const item of input.modelQuestions) {
    if (inspectText(`${item.question} ${item.why}`).suspicious) continue;
    ask(item.category, item.question, item.why);
  }
  const text = textOf(input.context);
  for (const spec of TABLE) {
    if (spec.relevant(input.context, text)) ask(spec.category, spec.question, spec.why);
  }
  return asked;
}
