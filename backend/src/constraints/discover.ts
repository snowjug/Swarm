import {
  CONSTRAINT_CATEGORY_LABELS,
  DEFAULT_APPROVAL_THRESHOLD,
  type ConstraintCategory,
} from '../../../shared/constraints.js';
import type { Actor, StakeholderCategory } from '../../../shared/stakeholders.js';
import { suspiciousPassageIds } from '../models/injection.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { wordsOf } from '../stakeholders/mentions.js';
import { plural, truncate } from '../stakeholders/names.js';
import { categoryOf, detectIn, type Candidate, type Origin, type Undecided } from './detect.js';
import type { DiscoveryContext, Proposal } from './types.js';

/** The most a reading of the text proposes: more would be a form to fill in, not a list to review. */
export const MAX_PROPOSED = 16;
const MAX_PER_CATEGORY = 3;
const MAX_UNDECIDED = 6;

const AUTHORITIES: readonly StakeholderCategory[] = ['regulator', 'governance', 'decision-maker'];
const AUTHORITY_WORDS: readonly (readonly [RegExp, StakeholderCategory])[] = [
  [/\b(?:regulat\w+|authority|agency|watchdog)\b/iu, 'regulator'],
  [/\b(?:board|committee|council|governance|review panel|compliance|counsel)\b/iu, 'governance'],
  [/\b(?:executives?|leadership|director|sponsor)\b/iu, 'decision-maker'],
];

interface Mentions {
  actors: Actor[];
  alternatives: string[];
}

function mentionsIn(text: string, context: DiscoveryContext): Mentions {
  const bases = new Set(wordsOf(text).map((word) => word.base));
  const lower = text.toLowerCase();
  return {
    actors: context.actors.filter((actor) => {
      const name = wordsOf(actor.name).map((word) => word.base);
      return name.length > 0 && name.every((base) => bases.has(base));
    }),
    alternatives: context.alternatives
      .filter(
        (alternative) =>
          alternative.label.length >= 4 && lower.includes(alternative.label.toLowerCase()),
      )
      .map((alternative) => alternative.id),
  };
}

/**
 * Who a sentence asks for an approval from, when it can be told: the one authority it names, or the
 * only actor of the kind of authority the sentence speaks of. Two possibilities are none: guessing the
 * approver would put a limit on the wrong actor.
 */
function approverOf(
  sentence: string,
  mentioned: readonly Actor[],
  context: DiscoveryContext,
): Actor | null {
  const named = mentioned.filter((actor) => AUTHORITIES.includes(actor.category));
  if (named.length === 1) return named[0] ?? null;
  if (named.length > 1) return null;
  for (const [words, category] of AUTHORITY_WORDS) {
    if (!words.test(sentence)) continue;
    const of = context.actors.filter((actor) => actor.category === category);
    return of.length === 1 ? (of[0] ?? null) : null;
  }
  return null;
}

function proposalOf(candidate: Candidate, context: DiscoveryContext, rank: number): Proposal {
  const mentioned = mentionsIn(candidate.quote, context);
  const approver = candidate.approval
    ? approverOf(candidate.quote, mentioned.actors, context)
    : null;
  const askedForApproval = candidate.approval && candidate.where.kind !== 'actor';
  const notes = [
    approver
      ? `It asks for an approval from ${approver.name.slice(0, 60)}. The simulation applies it with a stance of ${DEFAULT_APPROVAL_THRESHOLD} as the line, which is an assumption.`
      : askedForApproval
        ? 'It asks for an approval, but no single actor could be named as the approver, so it is read and not run.'
        : '',
    candidate.guessed
      ? 'Its words do not name what is limited, so its category is a guess from how the sentence is worded.'
      : '',
  ].filter(Boolean);
  return {
    category: candidate.category,
    statement: candidate.statement,
    hardness: candidate.hardness,
    origin: candidate.where,
    quotes:
      candidate.where.kind === 'passage'
        ? [{ passageId: candidate.where.passageId, quote: candidate.quote }]
        : [],
    affectedActorIds: mentioned.actors
      .filter((actor) => actor.id !== approver?.id)
      .map((actor) => actor.id),
    affectedAlternativeIds: mentioned.alternatives,
    windowText: candidate.windowText,
    effects: approver
      ? [
          {
            kind: 'require-approval',
            approverActorId: approver.id,
            threshold: DEFAULT_APPROVAL_THRESHOLD,
          },
        ]
      : [],
    assumptionId: candidate.where.kind === 'assumption' ? candidate.where.assumptionId : null,
    rank: rank - candidate.score / 100,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
}

/** The sentences of the person's own words, which are the first thing that limits the decision. */
function userTexts(context: DiscoveryContext): { text: string; where: Origin }[] {
  const { scenario } = context;
  const texts: { text: string; where: Origin }[] = [
    { text: context.question, where: { kind: 'question' } },
  ];
  if (!scenario) return texts;
  const field = (name: string, text: string | null | undefined): void => {
    if (text) texts.push({ text, where: { kind: 'scenario', field: name } });
  };
  field('decision', scenario.decision);
  field('system', scenario.system);
  field('baseline', scenario.baseline);
  field('requested decision', scenario.requestedDecision);
  field('desired output', scenario.desiredOutput);
  for (const change of scenario.changes) field('change', change.note);
  for (const alternative of scenario.alternatives) field('alternative', alternative.description);
  for (const assumption of scenario.assumptions) {
    texts.push({
      text: assumption.text,
      where: {
        kind: 'assumption',
        assumptionId: assumption.id,
        fromUser: assumption.origin === 'user',
      },
    });
  }
  return texts;
}

/**
 * The passages that may be read for constraints, by rules or by a model, and the ones that may not: a
 * passage that is addressed to an AI, or that research set aside. Text in a source never becomes a limit
 * by telling a reader to make it one, so such a passage is neither read nor shown to a model, and a model
 * cannot cite it.
 */
export function readablePassages(context: DiscoveryContext): {
  readable: EvidenceChunk[];
  withheld: EvidenceChunk[];
} {
  const flagged = new Set(suspiciousPassageIds(context.passages));
  const readable: EvidenceChunk[] = [];
  const withheld: EvidenceChunk[] = [];
  for (const passage of context.passages) {
    const held = flagged.has(passage.id) || context.setAsideDocuments?.has(passage.documentId);
    (held ? withheld : readable).push(passage);
  }
  return { readable, withheld };
}

/** What the sources, as far as they are read, say about limits. */
export function passageProposals(context: DiscoveryContext): {
  proposals: Proposal[];
  undecided: Undecided[];
  skipped: number;
} {
  const { readable, withheld } = readablePassages(context);
  const proposals: Proposal[] = [];
  const undecided: Undecided[] = [];
  for (const passage of readable) {
    const found = detectIn(passage.text, { kind: 'passage', passageId: passage.id });
    for (const candidate of found.candidates) {
      proposals.push(proposalOf(candidate, context, candidate.hardness === 'hard' ? 2 : 3));
    }
    undecided.push(...found.undecided);
  }
  return { proposals, undecided, skipped: withheld.length };
}

const names = (actors: readonly Actor[]): string =>
  actors
    .slice(0, 3)
    .map((actor) => actor.name.slice(0, 60))
    .join(', ');

interface Prompt {
  category: ConstraintCategory;
  statement: string;
  affects: Actor[];
}

/** What who is involved suggests might limit the change. These are suggestions: nothing in a source or from a person says they hold. */
function structuralPrompts(context: DiscoveryContext): Prompt[] {
  const of = (...categories: StakeholderCategory[]): Actor[] =>
    context.actors.filter((actor) => categories.includes(actor.category));
  const prompts: Prompt[] = [];
  const regulators = of('regulator');
  if (regulators.length > 0) {
    prompts.push({
      category: 'regulatory',
      statement: `Regulatory involvement (${names(regulators)}) suggests the change may have to meet a regulatory requirement.`,
      affects: regulators,
    });
  }
  const governance = of('governance');
  if (governance.length > 0) {
    prompts.push({
      category: 'organizational',
      statement: `Governance or compliance involvement (${names(governance)}) suggests an internal approval or policy limit may apply.`,
      affects: governance,
    });
  }
  const depended = new Set(
    context.actorRelations
      .filter((relation) => relation.type === 'depends-on' || relation.type === 'supplies')
      .flatMap((relation) => [relation.from, relation.to]),
  );
  const suppliers = [...of('partner'), ...context.actors.filter((actor) => depended.has(actor.id))];
  const unique = [...new Map(suppliers.map((actor) => [actor.id, actor])).values()];
  if (unique.length > 0) {
    prompts.push({
      category: 'dependency',
      statement: `The change may depend on parties it does not control (${names(unique)}).`,
      affects: unique,
    });
  }
  const operators = of('operations');
  if (operators.length > 0) {
    prompts.push({
      category: 'capacity',
      statement: `Those who carry the change out (${names(operators)}) may be limited in what they can take on, which limits how fast it can go.`,
      affects: operators,
    });
  }
  return prompts;
}

export interface RulesDiscovery {
  proposals: Proposal[];
  undecided: Undecided[];
  notes: string[];
}

/**
 * Reads the question, the scenario, the sources and the cast for limits, with no model. Everything it
 * proposes is a proposal for a person to review: what is in the person's own words is theirs, what a
 * source says is a quote that can be found in it, and what only follows from who is involved is a
 * suggestion, labelled so.
 */
export function discoverByRules(context: DiscoveryContext): RulesDiscovery {
  const proposals: Proposal[] = [];
  const undecided: Undecided[] = [];
  const notes: string[] = [];

  for (const { text, where } of userTexts(context)) {
    const found = detectIn(text, where);
    for (const candidate of found.candidates) {
      const proposal = proposalOf(candidate, context, where.kind === 'assumption' ? 1 : 0);
      proposals.push(proposal);
    }
    undecided.push(...found.undecided);
  }
  const { scenario } = context;
  // What the person already said the decision is limited to is a limit they gave, in their own words.
  for (const [field, category, text] of [
    [
      'geography',
      'geographic',
      scenario?.geography ? `Geography given for the decision: ${scenario.geography}.` : null,
    ],
    [
      'horizon',
      'time',
      scenario?.horizon ? `Horizon given for the decision: ${scenario.horizon}.` : null,
    ],
  ] as const) {
    if (!text) continue;
    proposals.push({
      category,
      statement: truncate(text, 400),
      hardness: 'soft',
      origin: { kind: 'scenario', field },
      quotes: [],
      affectedActorIds: [],
      affectedAlternativeIds: [],
      windowText: field === 'horizon' ? truncate(scenario?.horizon ?? '', 120) : '',
      effects: [],
      assumptionId: null,
      rank: 0.5,
    });
  }

  const read = passageProposals(context);
  proposals.push(...read.proposals);
  undecided.push(...read.undecided);
  if (read.skipped > 0) {
    notes.push(
      `${plural(read.skipped, 'passage')} ${read.skipped === 1 ? 'was' : 'were'} not read for constraints: ${read.skipped === 1 ? 'it is' : 'they are'} addressed to an AI or ${read.skipped === 1 ? 'was' : 'were'} set aside by research.`,
    );
  }

  for (const actor of context.actors) {
    for (const statement of actor.constraints) {
      const named = categoryOf(statement)?.category ?? 'organizational';
      proposals.push({
        category: named,
        statement: truncate(statement, 400),
        hardness: 'soft',
        origin: { kind: 'actor', actorId: actor.id },
        quotes: [],
        affectedActorIds: [actor.id],
        affectedAlternativeIds: [],
        windowText: '',
        effects: [],
        assumptionId: null,
        rank: 4,
      });
    }
  }

  const covered = new Set(proposals.map((proposal) => proposal.category));
  for (const prompt of structuralPrompts(context)) {
    if (covered.has(prompt.category)) continue;
    proposals.push({
      category: prompt.category,
      statement: truncate(prompt.statement, 400),
      hardness: 'soft',
      origin: {
        kind: 'category',
        reason: `${CONSTRAINT_CATEGORY_LABELS[prompt.category]} is suggested by who is involved.`,
      },
      quotes: [],
      affectedActorIds: prompt.affects.map((actor) => actor.id),
      affectedAlternativeIds: [],
      windowText: '',
      effects: [],
      assumptionId: null,
      rank: 5,
    });
  }

  return {
    proposals: select(proposals),
    undecided: undecided.slice(0, MAX_UNDECIDED),
    notes,
  };
}

/** The best of the proposals, once each, no category crowding the rest: the person's words first, then what sources say. */
export function select(proposals: readonly Proposal[]): Proposal[] {
  const kept: Proposal[] = [];
  const perCategory = new Map<ConstraintCategory, number>();
  const words = (text: string): string => text.toLowerCase().replace(/\s+/gu, ' ').trim();
  const ordered = proposals
    .map((proposal, at) => ({ proposal, at }))
    .sort((a, b) => a.proposal.rank - b.proposal.rank || a.at - b.at);
  for (const { proposal } of ordered) {
    const said = words(proposal.statement);
    // Passages overlap, so one sentence can be read twice, once whole and once from its middle.
    if (
      kept.some(
        (other) => words(other.statement).includes(said) || said.includes(words(other.statement)),
      )
    ) {
      continue;
    }
    const count = perCategory.get(proposal.category) ?? 0;
    // The person's own words are never crowded out by a category that sources talk about more.
    if (count >= MAX_PER_CATEGORY && proposal.rank >= 1) continue;
    perCategory.set(proposal.category, count + 1);
    kept.push(proposal);
    if (kept.length >= MAX_PROPOSED) break;
  }
  return kept;
}
