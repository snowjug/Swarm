import {
  CATEGORY_DEFAULT_ROLE,
  MAX_PROPOSED_PARTICIPANTS,
  PARTICIPANT_ROLE_MEANINGS,
  PROPOSED_PARTICIPANTS_VERSION,
  ROLE_CATEGORIES,
  type ParticipantRole,
  type ProposedParticipant,
  type ProposedParticipants,
  type Stakeholder,
} from '../../../../shared/stakeholders.js';
import type { ScenarioFrame } from '../../../../shared/scenario.js';
import { slugify, truncate, uniqueId } from '../names.js';
import { CATEGORY_PURPOSE } from '../priors.js';
import { deriveRelations } from '../relations.js';
import { PLACEHOLDER_SIZE, discoverByRules } from '../rules.js';
import { keyOf } from '../mentions.js';
import { readCited } from '../tone.js';
import type { ProposalContext } from './context.js';
import { MAX_RULES_PARTICIPANTS, compareRank } from './build.js';
import {
  compareNames,
  isGenericName,
  nameProblem,
  nameTokens,
  normaliseLine,
  partyProblem,
  wordsIn,
} from './language.js';
import { readMentions } from './reader.js';
import { ROLE_DEFAULTS_NOTE, scaffold } from './scaffold.js';
import { ROLE_DEFAULTS } from './taxonomy.js';
import { qualifyName } from './topic.js';

/**
 * What the rules path leaves out of the proposal and what it read along the way, kept beside the
 * proposal because the proposal's own shape has no room for either. The builder reads `legacy` so that
 * what rules found (the quotes, the direction read from their wording) is carried as found and is not
 * derived a second time.
 */
export interface ProposalSide {
  legacy: Map<string, Stakeholder>;
  dropped: { name: string; reason: string }[];
  notes: string[];
}

export const newSide = (): ProposalSide => ({ legacy: new Map(), dropped: [], notes: [] });

const APPROVAL_CUE =
  /\b(?:approv|sign[- ]?off|authori[sz]|consent|clearance|permit|licen[cs])\w*/iu;

/** Whether a name the question gave is the one that makes the decision: it opens the decision's own words. */
function opensDecision(name: string, scenario: ScenarioFrame | null): boolean {
  const opening = new Set(
    wordsIn(scenario?.decision ?? '')
      .slice(0, 8)
      .map((word) => nameTokens(word)[0]),
  );
  const tokens = nameTokens(name);
  return tokens.length > 0 && tokens.every((token) => opening.has(token));
}

/** Kinds of party that can be the one who decides: an organisation, a body or a person in a position, not a population. */
const CAN_DECIDE: ReadonlySet<Stakeholder['category']> = new Set([
  'decision-maker',
  'other',
  'channel',
  'partner',
  'governance',
  'regulator',
  'operations',
]);

function roleFor(
  legacy: Stakeholder,
  scenario: ScenarioFrame | null,
  deciders: ReadonlySet<string>,
): ParticipantRole {
  if (
    CAN_DECIDE.has(legacy.category) &&
    (deciders.has(legacy.id) ||
      (legacy.origin === 'scenario' && opensDecision(legacy.name, scenario)))
  ) {
    return 'decision-owner';
  }
  if (
    legacy.category === 'governance' &&
    legacy.evidence.some((ref) => APPROVAL_CUE.test(ref.quote ?? ''))
  ) {
    return 'approvers';
  }
  return CATEGORY_DEFAULT_ROLE[legacy.category];
}

/**
 * How many groups the reading hands on to be ranked. The list the person sees is cut to
 * `MAX_RULES_PARTICIPANTS` by the builder, which knows the roles; cutting earlier, by how often a group
 * is named, would drop a group that was named once and matters.
 */
const MAX_CANDIDATES = 60;

/**
 * Why a participant is on the list when nothing but its role and the sources are known: what the role is, and the
 * passage that names it, quoted as it stands and set into the sentence so that its own full stop is not doubled.
 */
export function reasonFromSources(
  role: ParticipantRole,
  quote: string | undefined,
  origin: Stakeholder['origin'],
): string {
  const clipped = quote ? truncate(quote, 130) : '';
  const cited = clipped
    ? ` A cited passage reads “${clipped}”${/[.!?…]$/u.test(clipped) ? '' : '.'}`
    : origin === 'scenario'
      ? ' Your question names this group.'
      : ' No passage names this group; it is here because of its role.';
  return truncate(`${PARTICIPANT_ROLE_MEANINGS[role]}${cited}`, 600);
}

function composed(
  legacy: Stakeholder,
  name: string,
  id: string,
  role: ParticipantRole,
): ProposedParticipant {
  const defaults = ROLE_DEFAULTS[role];
  const category = ROLE_CATEGORIES[role].includes(legacy.category)
    ? legacy.category
    : (ROLE_CATEGORIES[role][0] ?? legacy.category);
  const quotes = legacy.evidence.flatMap((ref) =>
    ref.quote ? [{ passageId: ref.passageId, quote: ref.quote }] : [],
  );
  const group = {
    key: keyOf(legacy.name),
    own: new Set([...keyOf(legacy.name).split(' '), ...wordsIn(legacy.name)]),
  };
  const concerns = quotes
    .filter((item) => readCited([item.quote], group).concern.length > 0)
    .slice(0, 2)
    .map((item) => `Raised in a cited passage: “${truncate(item.quote, 150)}”`);
  const level =
    legacy.priority === 'key'
      ? 'high'
      : legacy.priority === 'background'
        ? 'low'
        : defaults.influence;
  return {
    id,
    name,
    role,
    category,
    whyTheyMatter: reasonFromSources(role, quotes[0]?.quote, legacy.origin),
    description: legacy.description,
    objective: CATEGORY_PURPOSE[category],
    incentives: [],
    pressures: [],
    constraints: [],
    concerns,
    influence: level,
    decisionAuthority: defaults.decisionAuthority,
    directness: legacy.directness,
    impact: {
      direction: legacy.expectedImpact.direction,
      rationale: legacy.expectedImpact.rationale,
    },
    informationAccess: defaults.informationAccess,
    plausibleActions: defaults.plausibleActions,
    prohibitedClaims: defaults.prohibitedClaims,
    evidence: quotes,
    assumptions: [ROLE_DEFAULTS_NOTE, ...legacy.assumptions]
      .map((line) => truncate(line, 300))
      .slice(0, 8),
    uncertainty: {
      level: legacy.uncertainty.level,
      // The tone of a fixed sentence of ours, kept free of a forecast's wording like every other line.
      reason: legacy.uncertainty.reason.replace(/\bwill react\b/gu, 'might react'),
    },
    confidenceBasis:
      quotes.length > 0
        ? 'source-quote'
        : legacy.origin === 'scenario'
          ? 'scenario-statement'
          : 'category-pattern',
    priority: role === 'decision-owner' ? 'key' : legacy.priority,
    populationSize: role === 'decision-owner' ? PLACEHOLDER_SIZE.key : legacy.populationSize,
    synthetic: true,
  };
}

/** What the rules path proposes: the lexical discovery, held to the role taxonomy and to the same checks as a model's reply. */
export function rulesProposal(context: ProposalContext, side: ProposalSide): ProposedParticipants {
  // A person named in the sources is never a participant: the role is, and the rules read roles.
  const safeGraph = context.graph && {
    ...context.graph,
    nodes: context.graph.nodes.filter((node) => node.kind !== 'person'),
  };
  // A heading, a menu item or the product under change is no party, and it is left out before the rules join
  // names that contain one another: "Acme" in the question must not be swallowed by "Acme Rooms".
  const notParties = new Map<string, string>();
  const partiesOnly = (passages: Parameters<typeof readMentions>[0]) =>
    readMentions(passages).filter((mention) => {
      const problem = partyProblem(mention.surface, context.scenario);
      if (problem && !notParties.has(mention.surface)) notParties.set(mention.surface, problem);
      return problem === null;
    });
  const found = discoverByRules({
    question: context.question,
    scenario: context.scenario,
    graph: safeGraph,
    passages: context.passages,
    mentions: partiesOnly,
    names: 'specific',
    limit: MAX_CANDIDATES,
  });
  side.notes.push(...found.notices);
  for (const [surface, problem] of notParties) {
    side.dropped.push({
      name: truncate(surface, 120),
      reason: `Left out of the proposal: ${problem}.`,
    });
  }

  const used = new Set<string>();
  const ids = new Map<string, string>();
  const participants: ProposedParticipant[] = [];
  const live = found.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
  // The group the text most often says starts the change is who decides; another that proposes something
  // of its own (an operator's fare, a firm's offer) is not.
  const deciders = new Set(found.deciders.slice(0, 1));
  for (const legacy of live) {
    let name = legacy.name;
    if (isGenericName(name)) {
      const qualified = qualifyName(name, context.scenario);
      if (!qualified || isGenericName(qualified)) {
        side.dropped.push({
          name: truncate(name, 120),
          reason: qualified
            ? 'Too generic to simulate, even with the scenario’s system put before it.'
            : 'Too generic to simulate, and the scenario names no system to say which one is meant.',
        });
        continue;
      }
      name = qualified;
    }
    const problem = nameProblem(name, context.personLabels) ?? partyProblem(name, context.scenario);
    if (problem) {
      side.dropped.push({
        name: truncate(name, 120),
        reason: `Left out of the proposal: ${problem}.`,
      });
      continue;
    }
    // The same words in another order ("Customers in Marlow", "Marlow customers") are one group, and the
    // checks a proposal is held to refuse it twice. Its relations go to the one that stays.
    const twin = participants.find((held) => compareNames(held.name, name) === 'same');
    if (twin) {
      ids.set(legacy.id, twin.id);
      side.dropped.push({
        name: truncate(name, 120),
        reason: `Left out of the proposal: it names the same group as “${truncate(twin.name, 60)}”.`,
      });
      continue;
    }
    const id = uniqueId(slugify(name), used);
    ids.set(legacy.id, id);
    side.legacy.set(id, legacy);
    participants.push(
      composed(legacy, normaliseLine(name, 120), id, roleFor(legacy, context.scenario, deciders)),
    );
  }

  // A proposal holds at most `MAX_PROPOSED_PARTICIPANTS`: what is held back is what the builder would have
  // cut first, in the order it cuts, so that a group named once and matters is not lost to the alphabet.
  // A group the person named, in the scenario they read or by adding it, is not held back for one a source names.
  const ownedBy = (participant: ProposedParticipant): boolean => {
    const origin = side.legacy.get(participant.id)?.origin;
    return origin === 'scenario' || origin === 'user';
  };
  const ranked = [...participants].sort((a, b) =>
    compareRank(
      { ...a, quotes: a.evidence.map((item) => item.quote), own: ownedBy(a) },
      { ...b, quotes: b.evidence.map((item) => item.quote), own: ownedBy(b) },
    ),
  );
  const assumed = scaffold(context, ranked, used, MAX_RULES_PARTICIPANTS - ranked.length);
  const relations = deriveRelations(live)
    .flatMap((relation) => {
      const from = ids.get(relation.from);
      const to = ids.get(relation.to);
      return from && to && from !== to ? [{ ...relation, from, to }] : [];
    })
    .slice(0, 120);

  return {
    version: PROPOSED_PARTICIPANTS_VERSION,
    participants: [...ranked.slice(0, MAX_PROPOSED_PARTICIPANTS - assumed.length), ...assumed],
    relations,
    gaps: [],
  };
}
