import {
  CATEGORY_DEFAULT_ROLE,
  PARTICIPANT_ROLE_MEANINGS,
  PROPOSED_PARTICIPANTS_VERSION,
  ROLE_CATEGORIES,
  type ParticipantRole,
  type ProposedParticipant,
  type ProposedParticipants,
  type Stakeholder,
} from '../../../../shared/stakeholders.js';
import type { ScenarioFrame } from '../../../../shared/scenario.js';
import { capitalise, slugify, truncate, uniqueId } from '../names.js';
import { CATEGORY_PURPOSE } from '../priors.js';
import { deriveRelations } from '../relations.js';
import { PLACEHOLDER_SIZE, discoverByRules } from '../rules.js';
import { keyOf } from '../mentions.js';
import { readCited } from '../tone.js';
import type { ProposalContext } from './context.js';
import { isGenericName, nameTokens, normaliseLine, wordsIn } from './language.js';
import { ROLE_DEFAULTS } from './taxonomy.js';

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

const LEADING: ReadonlySet<string> = new Set(
  'a an the one this that particular certain selected specific given some any another our their its'.split(
    ' ',
  ),
);

/** The scenario's system in a few words, for naming a participant that the sources only call "staff" or "users". */
export function shortSystem(scenario: ScenarioFrame | null): string | null {
  const raw = scenario?.system.trim();
  if (!raw) return null;
  const head = raw.split(/[,;(]| of | in | for | at | on /iu)[0] ?? raw;
  const words = head.split(/\s+/u).filter(Boolean);
  while (words[0] && LEADING.has(words[0].toLowerCase())) words.shift();
  const kept = words.slice(0, 4).join(' ');
  return kept === '' ? null : kept;
}

/** A generic name made specific by the system it belongs to: "Users" in a scenario about "Online store". */
export function qualifyName(name: string, scenario: ScenarioFrame | null): string | null {
  const system = shortSystem(scenario);
  if (!system) return null;
  return truncate(`${capitalise(system)} ${name.toLowerCase()}`, 120);
}

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

function roleFor(legacy: Stakeholder, scenario: ScenarioFrame | null): ParticipantRole {
  if (
    legacy.origin === 'scenario' &&
    legacy.category === 'other' &&
    opensDecision(legacy.name, scenario)
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

const ROLE_DEFAULTS_NOTE =
  'Influence, authority, information access and plausible actions are defaults for this role, not findings.';

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

/** A participant that rests on a role pattern alone: nothing quoted, said so in its own words. */
function templated(
  role: ParticipantRole,
  name: string,
  id: string,
  why: string,
  basisNote: string,
): ProposedParticipant {
  const defaults = ROLE_DEFAULTS[role];
  const category = ROLE_CATEGORIES[role][0] ?? 'other';
  return {
    id,
    name,
    role,
    category,
    whyTheyMatter: truncate(`${PARTICIPANT_ROLE_MEANINGS[role]} ${why}`, 600),
    description: '',
    objective: CATEGORY_PURPOSE[category],
    incentives: [],
    pressures: [],
    constraints: [],
    concerns: [],
    influence: defaults.influence,
    decisionAuthority: defaults.decisionAuthority,
    directness: defaults.directness,
    impact: {
      direction: 'unclear',
      rationale: 'No direction is assumed for a role added from a pattern.',
    },
    informationAccess: defaults.informationAccess,
    plausibleActions: defaults.plausibleActions,
    prohibitedClaims: defaults.prohibitedClaims,
    evidence: [],
    assumptions: [basisNote, ROLE_DEFAULTS_NOTE],
    uncertainty: { level: 'high', reason: 'No passage names this role; it is a role pattern.' },
    confidenceBasis: 'category-pattern',
    priority: role === 'decision-owner' ? 'key' : 'standard',
    populationSize: PLACEHOLDER_SIZE[role === 'decision-owner' ? 'key' : 'standard'],
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
  const found = discoverByRules({
    question: context.question,
    scenario: context.scenario,
    graph: safeGraph,
    passages: context.passages,
  });
  side.notes.push(...found.notices);

  const used = new Set<string>();
  const ids = new Map<string, string>();
  const participants: ProposedParticipant[] = [];
  const live = found.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
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
    const id = uniqueId(slugify(name), used);
    ids.set(legacy.id, id);
    side.legacy.set(id, legacy);
    participants.push(
      composed(legacy, normaliseLine(name, 120), id, roleFor(legacy, context.scenario)),
    );
  }

  // A decision has someone who makes it and a change lands on someone, so the proposal always has both.
  const topic = shortSystem(context.scenario) ?? 'this change';
  if (!participants.some((participant) => participant.role === 'decision-owner')) {
    const name = normaliseLine(`Decision owner for ${topic}`, 120);
    participants.push(
      templated(
        'decision-owner',
        name,
        uniqueId(slugify(name), used),
        'A decision has someone who makes it; no passage names who.',
        'Added because every decision has an owner; no passage names who it is.',
      ),
    );
  }
  if (participants.length < 2) {
    const name = normaliseLine(`Those directly affected by ${topic}`, 120);
    participants.push(
      templated(
        'directly-affected',
        name,
        uniqueId(slugify(name), used),
        'A change lands on someone; no passage names who.',
        'Added because a change lands on someone; no passage names who.',
      ),
    );
  }

  const relations = deriveRelations(live)
    .flatMap((relation) => {
      const from = ids.get(relation.from);
      const to = ids.get(relation.to);
      return from && to && from !== to ? [{ ...relation, from, to }] : [];
    })
    .slice(0, 120);

  return {
    version: PROPOSED_PARTICIPANTS_VERSION,
    participants: participants.slice(0, 30),
    relations,
    gaps: [],
  };
}
