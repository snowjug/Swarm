import type { Finding, SensitivityRow } from '../../../shared/analysis.js';
import type { BriefRefs, ValidationExperiment } from '../../../shared/brief.js';
import { effectiveTrait } from '../../../shared/signal.js';
import {
  EXTERNAL_RESPONDER_CATEGORIES,
  TRAIT_KEYS,
  type Actor,
  type StakeholderCategory,
  type TraitKey,
} from '../../../shared/stakeholders.js';
import type { Facts } from './facts.js';
import {
  aboutAdverseShare,
  groupShifts,
  type GroupShift,
  type VariantMeasure,
} from './measures.js';
import { OWNER_BY_CATEGORY, directionOfImpact, type Level } from './rules.js';
import { clip, embed } from './text.js';

/**
 * A real-world check that would settle one premise of the answer: a survey, interviews, a data pull,
 * an expert review or a staged rollout. A check is made of what it observes, what it is compared with,
 * how it is run, how long it takes, who runs it and a decision rule that is left for the person to
 * set, because nothing in the simulation gives a value for it. The wording is generic and is filled in
 * with the groups, the change and the sources of this analysis; nothing here belongs to a market or a
 * product. A check never asks the world to match an internal score or setting of the simulation: the
 * observation is what replaces the setting.
 */
export interface Check {
  question: string;
  /** What would be observed in the world, in words a person can collect it by. */
  measure: string;
  /** What it is compared with: a comparable group that is not exposed, or an earlier period. */
  comparison: string;
  method: string;
  /** The decision rule, which the person sets before the check starts. */
  decision: string;
  effort: Level;
  duration: string;
  /** A few words naming what the check settles, for the answer-first section. */
  gist: string;
}

/** What fills a template: the group, and the change and system in the scenario's own words, quoted. */
export interface Slots {
  group?: string;
  change?: string;
  system?: string;
  topic?: string;
  sources?: string;
  trigger?: string;
}

const FALLBACK: Required<Slots> = {
  group: 'the group concerned',
  change: 'the change',
  system: 'the system the change affects',
  topic: 'the matter in conflict',
  sources: 'the sources',
  trigger: 'the signal it watches passes its threshold',
};

export function fill(template: string, slots: Slots): string {
  return template.replace(
    /\{(group|change|system|topic|sources|trigger)\}/gu,
    (_match, key: keyof Slots) => slots[key] ?? FALLBACK[key],
  );
}

const SET_BY_YOU =
  'The simulation supplies no value for this: before the check starts, write down the difference that would lead you to proceed, to change the plan or to stop.';

/** The check of each trait an assumption can be about, in what could be observed of the group. */
export const TRAIT_CHECKS: Record<TraitKey, Check> = {
  priorStance: {
    question: 'Where does {group} stand on the change in {change} before it happens?',
    measure:
      'The proportion of {group} who say, in a short survey or in interviews, that they support it, oppose it or have no view, before any change.',
    comparison:
      'The same question put to a comparable group at the same time, and to {group} again after the change.',
    method: 'A short survey or a handful of interviews with members of the group.',
    decision: `${SET_BY_YOU} The measured starting position then replaces the one assumed.`,
    effort: 'low',
    duration: '1 to 2 weeks',
    gist: 'ask {group} where they stand before the change',
  },
  impact: {
    question: 'Is {group} harmed, helped or unaffected by the change in {change}, and by how much?',
    measure:
      'The proportion of {group} who, in the weeks after the change, start using an alternative to {system}, reduce their use of it or formally object (complain, appeal or ask for a reversal), and what they say they lose or gain.',
    comparison:
      'A comparable group of {group} that is not exposed to the change, or the same group in the weeks before it.',
    method:
      'A small, reversible rollout or staged introduction (an A/B test or a pilot), or a before-and-after read of existing records.',
    decision: `${SET_BY_YOU} The observed difference then replaces the simulated effect on {group}, and the comparison is run again.`,
    effort: 'medium',
    duration: '2 to 6 weeks',
    gist: 'how the change lands on {group}, measured against a comparable group',
  },
  influence: {
    question: 'How far do other groups follow what {group} does?',
    measure:
      'In past cases, the proportion of other groups, and of their members, who changed what they do within weeks of {group} changing.',
    comparison: 'Cases where {group} did not change.',
    method:
      'Expert review, plus a data pull of who follows or refers to the group (for example referrals, mentions or dependencies).',
    decision: `${SET_BY_YOU} Decide how much follow-through would make {group} the group to engage first.`,
    effort: 'medium',
    duration: '2 to 3 weeks',
    gist: 'how far others follow {group}',
  },
  openness: {
    question: 'How readily does {group} move toward what others do?',
    measure:
      'In past cases where others changed behaviour, the proportion of {group} who followed, and the number of weeks they took.',
    comparison: 'Cases where others changed and {group} did not follow.',
    method:
      'A data pull of past cases where others changed behaviour, plus a few interviews with members of the group.',
    decision: `${SET_BY_YOU} Decide how quickly a follow would count as ready.`,
    effort: 'medium',
    duration: '2 to 4 weeks',
    gist: 'how readily {group} follows what others do',
  },
  sensitivity: {
    question: 'How strongly does {group} respond to a change like the one in {change}?',
    measure:
      'The size of the reaction of {group} to comparable past changes, as the proportion who changed what they do for each step of change.',
    comparison: 'The same group in periods without a comparable change.',
    method:
      'A small staged rollout or an A/B test with a comparison group, or past data on reactions to comparable changes.',
    decision: `${SET_BY_YOU} The observed reaction then replaces the simulated sensitivity of {group}.`,
    effort: 'high',
    duration: '4 to 8 weeks',
    gist: 'how strongly {group} responds to a change like this',
  },
  riskTolerance: {
    question: 'How much uncertainty or loss is {group} ready to accept?',
    measure:
      'In past decisions taken under uncertainty, the proportion of {group} who took the riskier option.',
    comparison: 'Other groups facing the same choices.',
    method:
      'A survey with scenario questions, or interviews about past decisions taken under uncertainty.',
    decision: `${SET_BY_YOU} Decide which gap would change how {group} is approached.`,
    effort: 'low',
    duration: '1 to 3 weeks',
    gist: 'how much risk {group} accepts',
  },
  switchingCost: {
    question: 'How long and how costly is it for {group} to change what they use or do today?',
    measure:
      'The elapsed time and the out-of-pocket cost, from records of past moves by {group}, and the proportion who moved within a month.',
    comparison: 'Moves made by other groups of similar size, or by {group} in earlier years.',
    method:
      'A short survey and a few interviews with members of the group, backed by a data pull of how often and how quickly they changed in the past.',
    decision: `${SET_BY_YOU} The measured time and cost then replace the switching cost the simulation uses.`,
    effort: 'medium',
    duration: '2 to 4 weeks',
    gist: 'how long and how costly it is for {group} to switch',
  },
  trust: {
    question: 'How far does {group} trust the party making the change?',
    measure:
      'The answers of {group} to a standard trust question, and the complaint or support volumes from the group.',
    comparison:
      'The same measures before the change, or for another group served by the same party.',
    method:
      'A survey with a standard trust question, or a review of recent feedback and complaint data from the group.',
    decision: `${SET_BY_YOU} Decide what fall in trust would lead you to change how the change is made.`,
    effort: 'low',
    duration: '1 to 2 weeks',
    gist: 'how far {group} trusts the party making the change',
  },
  adoptionTendency: {
    question: 'How ready is {group} to take up something new?',
    measure:
      'The proportion of {group} who took up comparable changes within a set number of weeks of their start.',
    comparison: 'Other groups offered the same changes.',
    method: 'A data pull of past take-up of comparable changes, plus a few interviews.',
    decision: `${SET_BY_YOU} Decide what take-up would show the group to be ready.`,
    effort: 'low',
    duration: '1 to 2 weeks',
    gist: 'how readily {group} takes up something new',
  },
  authority: {
    question: 'How much power does {group} have to decide or act on its own?',
    measure:
      'The decision rights, contract terms and rules that let {group} act without the agreement of others, as written in documents.',
    comparison: 'The same documents for the other groups it is compared with.',
    method: 'An expert review of the decision rights, contracts and rules that apply to the group.',
    decision: `${SET_BY_YOU} Decide which rights would make {group} a decision-maker for this change.`,
    effort: 'low',
    duration: '1 to 2 weeks',
    gist: 'how much power {group} has to act on its own',
  },
  reactivity: {
    question: 'How quickly does {group} respond to what others do?',
    measure:
      'The number of weeks between a comparable event and the response of {group}, from records.',
    comparison: 'Events after which {group} did not respond.',
    method: 'A data pull of response times in comparable past situations, plus interviews.',
    decision: `${SET_BY_YOU} Decide how fast a response would have to be to matter for the timing of the change.`,
    effort: 'medium',
    duration: '2 to 3 weeks',
    gist: 'how quickly {group} responds',
  },
};

export const STRENGTH_CHECK: Check = {
  question:
    'How large is the change in {change} in practice, and how widely and how soon does it reach the groups it affects?',
  measure:
    'For each affected group, and first for the groups the answer names: what the change amounts to for them, the proportion of the group it reaches, and the weeks before they see it.',
  comparison:
    'What was assumed when the simulation was set up for the size, reach and timing of the change, written in the same terms.',
  method:
    'Ask the people who run the change what is delivered and when, and check it against a small, reversible rollout or the first weeks of delivery.',
  decision:
    'Before the check starts, decide how far the observed size, reach or timing may differ from what was assumed before the comparison is run again. Then set the strength and timing to what was delivered, not to the reaction seen, and compare reactions only for a group or period not used to set them.',
  effort: 'medium',
  duration: '1 to 4 weeks',
  gist: 'what size of change actually reaches the affected groups, and how soon',
};

export const SPREAD_CHECK: Check = {
  question: 'How much do members of {group} differ from one another in how they react?',
  measure:
    'The spread, across members of {group}, of the reaction to a comparable change: the proportion who react strongly against the proportion who hardly react.',
  comparison: 'The same measure for another group that experienced the same change.',
  method:
    'A data pull of past reactions by individual members or sub-groups, plus a few interviews.',
  decision: `${SET_BY_YOU} Decide how wide a spread would mean that {group} has to be treated as more than one group.`,
  effort: 'medium',
  duration: '2 to 3 weeks',
  gist: 'how much members of {group} differ in how they react',
};

export const POPULATION_CHECK: Check = {
  question: 'How many members does {group} have in fact?',
  measure: 'The number of members of {group}, from records or an independent count.',
  comparison: 'The size that was assumed when the simulation was set up.',
  method: 'A data pull from records or an independent count, in place of the assumed size.',
  decision:
    'Decide beforehand how large a difference from the assumed size would lead you to run the comparison again.',
  effort: 'low',
  duration: '1 week',
  gist: 'how many members {group} has',
};

export const CONFLICT_CHECK: Check = {
  question: 'Which figure holds for {topic}: {sources}?',
  measure:
    'For {topic}, the underlying figure in each source: what it counts, over which period and for which population.',
  comparison: 'The two sources against each other, and against a third record if one exists.',
  method:
    'Ask the owner of each source for the underlying data and its definition, and compare like with like; record which figure holds, or that the two measure different things.',
  decision:
    'Decide beforehand which figure is carried into the analysis if the two still differ after the owners have been asked, then run the comparison again.',
  effort: 'low',
  duration: '1 to 2 weeks',
  gist: 'get the underlying data for {topic} from the owners of both sources',
};

/** What a responder of each kind watches, in words, so that the check can ask what the real trigger is. */
const TRIGGER_BY_CATEGORY: Partial<Record<StakeholderCategory, string>> = {
  competitor: 'many members of the groups it watches are clearly against the change',
  substitute: 'many members of the groups it watches would switch',
  partner: 'many members of the groups it watches are clearly against the change',
  regulator:
    'members of the groups it watches who tolerate little risk are clearly against the change',
};

export const RESPONDER_CHECK: Check = {
  question: 'What would lead {group} to respond to the change in {change}, and how soon after?',
  measure:
    'Whether {group} changed its own offer, terms, statements or position in the weeks after comparable moves by others, and the number of weeks after the move that it did so.',
  comparison:
    'Comparable moves after which {group} did not respond, and periods with no such move.',
  method:
    'Desk research of public statements and past moves, and an expert review or a conversation with someone who has dealt with {group}. In the simulation it acts once {trigger}, at a threshold set from its assumed traits: the real trigger and delay are what the check looks for.',
  decision:
    'Decide beforehand how likely a response must look, from the cases found, before a prepared response is worth its cost. The cases found then replace the traits the simulation gives {group}, and the comparison is run again.',
  effort: 'low',
  duration: '1 to 2 weeks',
  gist: 'what would lead {group} to respond, and how soon',
};

export const REPEAT_CHECK: Check = {
  question: 'Does the unstable result hold when the analysis is run with more seeded runs?',
  measure:
    'The number of paired seeded runs, out of the total, in which the result holds, as the number of runs grows.',
  comparison: 'The same analysis with a different first seed.',
  method: 'Run the analysis again with more seeded runs, and again from another first seed.',
  decision:
    'Decide beforehand how many of the paired runs must agree before the result is relied on. The analysis calls a result repeatable when even the cautious end of its interval is four runs in five: a convention, not a threshold from the world.',
  effort: 'low',
  duration: 'under a day of computing',
  gist: 'repeat the analysis with more seeded runs',
};

/** The check that comes first when no stakeholder has an expected direction of impact. */
export const DIRECTION_CHECK: Check = {
  question: 'Who is helped and who is harmed by the change, and by how much?',
  measure:
    'For each key group, whether people who know it say the change helps, harms or does not affect it, and what it would lose or gain, in their own words.',
  comparison: 'The answers of people who know different groups, set side by side.',
  method:
    'Ask the stakeholders themselves, in interviews or a short survey, or someone who knows each group; record a direction for each group in the stakeholder review.',
  decision:
    'Decide beforehand how many key groups need a stated direction before the comparison, run again, is read as a result about the change.',
  effort: 'low',
  duration: '1 to 2 weeks',
  gist: 'ask who is helped and who is harmed',
};

const GAP_CHECKS: { categories: readonly StakeholderCategory[]; check: Check }[] = [
  {
    categories: ['regulator', 'governance'],
    check: {
      question:
        'Which rules and past decisions apply to {group} in the change in {change}, and how have they been applied?',
      measure:
        'The rules, past rulings and public filings that bear on the change, each with the passage that says so.',
      comparison: 'How the same rules were applied to comparable changes in the past.',
      method:
        'An expert review of the rules, past rulings and public filings that bear on the change.',
      decision:
        'Decide beforehand which finding would change the plan, for example a rule that bars or conditions the change.',
      effort: 'low',
      duration: '1 to 2 weeks',
      gist: 'find the rules and past decisions that apply to {group}',
    },
  },
  {
    categories: ['competitor', 'substitute'],
    check: {
      question: 'How has {group} reacted to comparable moves before?',
      measure:
        'Whether, and how many weeks after a comparable move, {group} changed its offer, terms or position, from public statements and past moves.',
      comparison: 'Comparable moves after which {group} did not react.',
      method: 'Desk research of public statements and past moves, or an expert review.',
      decision:
        'Decide beforehand how many documented reactions would count as a pattern, and cite each one.',
      effort: 'low',
      duration: '1 to 2 weeks',
      gist: 'how {group} reacted to comparable moves before',
    },
  },
];

export const GENERAL_GAP_CHECK: Check = {
  question: 'What do members of {group} actually think and need about the change in {change}?',
  measure:
    'What members of {group} report about the change: the proportion who say it helps, harms or does not affect them, with the quoted passages attached to the stakeholder record.',
  comparison: 'A comparable group that the change does not affect.',
  method: 'Interviews with a few members, followed by a short survey.',
  decision:
    'Decide beforehand which pattern of answers would change the plan, then attach the passages to the stakeholder record and run the analysis again.',
  effort: 'medium',
  duration: '2 to 4 weeks',
  gist: 'what members of {group} actually think and need',
};

export const gapCheckFor = (category: StakeholderCategory): Check =>
  GAP_CHECKS.find((entry) => entry.categories.includes(category))?.check ?? GENERAL_GAP_CHECK;

/** A check with the group, the change and the system of this analysis filled in, as a recommendation quotes it. */
export function filled(facts: Facts, check: Check, group?: Actor): Check {
  const slots: Slots = { ...wordsOf(facts), ...(group ? { group: embed(group.name, 60) } : {}) };
  return {
    ...check,
    question: fill(check.question, slots),
    measure: fill(check.measure, slots),
    comparison: fill(check.comparison, slots),
    method: fill(check.method, slots),
    decision: fill(check.decision, slots),
    gist: fill(check.gist, slots),
  };
}

/** The check of the assumption a sensitivity row moved. */
export function checkForRow(facts: Facts, row: SensitivityRow, actor: Actor | undefined): Check {
  if (row.target.kind === 'trait' && actor && TRAIT_KEYS.includes(row.target.trait as TraitKey)) {
    return filled(facts, TRAIT_CHECKS[row.target.trait as TraitKey], actor);
  }
  if (row.target.kind === 'population' && actor) return filled(facts, SPREAD_CHECK, actor);
  return filled(facts, STRENGTH_CHECK, actor);
}

/** The check that closes the evidence gap of an actor that nothing cited supports. */
export const checkForGap = (facts: Facts, actor: Actor): Check =>
  filled(facts, gapCheckFor(actor.category), actor);

// ---------------------------------------------------------------------------------------------
// What the plan is made from
// ---------------------------------------------------------------------------------------------

/** The unstable results the answer leans on: its own direction against the baseline, its groups and its threshold. */
export function headlineRelevant(facts: Facts, finding: Finding): boolean {
  const headline = facts.headline;
  if (!headline || finding.variantId !== headline.variant.variant.id) return false;
  if (finding.kind === 'direction-vs-baseline') return finding.actorId === null;
  if (finding.kind === 'threshold-crossing') return true;
  if (finding.kind === 'majority-response') {
    // Only a group whose largest response is the adverse one says anything about the share the answer leads with.
    return (
      aboutAdverseShare(finding) &&
      headline.groups.slice(0, 3).some((group) => group.actorId === finding.actorId)
    );
  }
  // An ordering of groups, which of two responses is the largest, or a single event describes the runs;
  // no decision rests on it.
  return false;
}

/** The headline-relevant results that disagree across seeded runs, the answer's own direction first. */
export function unstableFindings(facts: Facts): Finding[] {
  return facts.analysis.findings
    .filter((finding) => finding.classification === 'unstable' && headlineRelevant(facts, finding))
    .sort(
      (a, b) =>
        Number(b.kind === 'direction-vs-baseline') - Number(a.kind === 'direction-vs-baseline') ||
        (a.id < b.id ? -1 : 1),
    );
}

/** The headline-relevant results that seldom or never held: a different thing from one that disagrees. */
export function rareFindings(facts: Facts): Finding[] {
  return facts.analysis.findings
    .filter((finding) => finding.classification === 'rare' && headlineRelevant(facts, finding))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Key actors that no cited passage supports. */
export function unevidencedKeyActors(facts: Facts): Actor[] {
  const priority = new Map(
    facts.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder.priority]),
  );
  return facts.analysis.actors.filter(
    (actor) =>
      (actor.kind === 'key' || priority.get(actor.stakeholderId) === 'key') &&
      !facts.evidence.supports(actor),
  );
}

/** Repeated reactions of actors outside the organisation, the headline variant's first, the most repeatable first. */
export function repeatedResponders(facts: Facts): { actor: Actor; finding: Finding }[] {
  const headline = facts.headline?.variant.variant.id;
  const seen = new Set<string>();
  return facts.analysis.findings
    .filter(
      (finding) =>
        finding.kind === 'second-order-event' &&
        finding.actorId !== null &&
        (finding.classification === 'repeatable' || finding.classification === 'mostly-repeatable'),
    )
    .sort(
      (a, b) =>
        Number(b.variantId === headline) - Number(a.variantId === headline) ||
        b.interval.lo - a.interval.lo ||
        (a.id < b.id ? -1 : 1),
    )
    .flatMap((finding) => {
      const actor = facts.actorById.get(finding.actorId ?? '');
      if (!actor || !EXTERNAL_RESPONDER_CATEGORIES.includes(actor.category)) return [];
      if (seen.has(actor.id)) return [];
      seen.add(actor.id);
      return [{ actor, finding }];
    });
}

/** The open conflicts between sources, as the evidence ledger recorded them. */
export const openConflicts = (facts: Facts) =>
  (facts.ledger?.conflicts ?? []).filter(
    (conflict) => conflict.status === 'detected' || conflict.status === 'confirmed',
  );

/** Where an actor's impact came from, in words, since a default is not a measurement. */
export function impactOrigin(actor: Actor): string {
  const origin = actor.traits.impact.origin;
  if (origin === 'user') return 'set by a person';
  if (origin === 'model') return 'proposed by a model';
  if (origin === 'evidence') return 'a size labelled as resting on evidence';
  return 'a default filled in by Swarm';
}

const DIRECTION_WORDS = {
  harmed: 'assumed harmed',
  benefited: 'assumed helped',
  neutral: 'assumed unaffected',
} as const;

/**
 * The groups the answer names whose own effect from the change is a premise worth measuring: those
 * that moved most. An outside actor with no effect of its own (a competitor, a regulator) moved
 * because of what others did, which what triggers it already covers.
 */
export function impactLeads(facts: Facts, limit: number): Actor[] {
  return (facts.headline?.groups ?? [])
    .map((group) => facts.actorById.get(group.actorId))
    .filter(
      (actor): actor is Actor =>
        actor !== undefined &&
        !(
          EXTERNAL_RESPONDER_CATEGORIES.includes(actor.category) &&
          facts.directionIn(actor) === 'neutral'
        ),
    )
    .slice(0, limit);
}

/**
 * The groups the answer names that stand for a population nobody counted. The size is a setting of
 * the simulation, and it weighs how far a group sways the others, so a group the answer leans on is
 * worth counting.
 */
export function sizedLeads(facts: Facts, limit: number): Actor[] {
  return (facts.headline?.groups ?? [])
    .map((group) => facts.actorById.get(group.actorId))
    .filter(
      (actor): actor is Actor => actor !== undefined && actor.kind === 'cohort' && actor.size > 1,
    )
    .slice(0, limit);
}

const repeats = (finding: Finding): boolean =>
  finding.classification === 'repeatable' || finding.classification === 'mostly-repeatable';

/** A group that a scenario helps and whose members repeatably moved toward going along: what advice to build on rests on. */
export interface FavourableLead {
  actor: Actor;
  /** The finding that holds the move, the steadiest first. */
  finding: Finding;
  variant: VariantMeasure;
  shift: GroupShift;
}

/**
 * Whether a group is helped is read as the scenario that the finding is about ran it, and its own
 * stance has to have moved up, whatever its share looking for an alternative did.
 */
export function favourableLeads(facts: Facts, besides: string | null = null): FavourableLead[] {
  const { baseline, analysis } = facts;
  if (!baseline) return [];
  const found: FavourableLead[] = [];
  const seen = new Set<string>();
  const ordered = [...analysis.findings].sort(
    (a, b) => b.interval.lo - a.interval.lo || (a.id < b.id ? -1 : 1),
  );
  for (const finding of ordered) {
    if (finding.variantId === besides) continue;
    const actor = facts.actorById.get(finding.actorId ?? '');
    const variant = facts.measures.find((measure) => measure.variant.id === finding.variantId);
    if (!actor || !variant || variant.variant.kind !== 'alternative' || !repeats(finding)) {
      continue;
    }
    if (
      directionOfImpact(effectiveTrait(actor, variant.variant, 'impact')) !== 'benefited' ||
      seen.has(actor.id)
    ) {
      continue;
    }
    const shift = groupShifts(variant, baseline).find((entry) => entry.actorId === actor.id);
    if (!shift || shift.stanceDelta === null || shift.stanceDelta <= 0) continue;
    seen.add(actor.id);
    found.push({ actor, finding, variant, shift });
  }
  return found;
}

/** The scenario's own words for the change and the system it affects, quoted. */
export function wordsOf(facts: Facts): Pick<Slots, 'change' | 'system'> {
  const change = facts.scenario?.changes[0];
  const variant = facts.headline?.variant.variant;
  const name = change?.name || variant?.label || '';
  if (name === '') return {};
  const from = change?.from ? `from ${embed(change.from, 60)} ` : '';
  const to = change?.to ? `to ${embed(change.to, 60)}` : '';
  const detail = `${from}${to}`.trim();
  return {
    change: `${embed(name, 80)}${detail ? ` (${detail})` : ''}`,
    ...(facts.scenario?.system ? { system: embed(facts.scenario.system, 80) } : {}),
  };
}

export const MAX_EXPERIMENTS = 8;
/** The most results one check may be for: the same bound as the stored document's. */
const MAX_TARGETS = 6;
/** The longest a check's measure may be: the stored document's bound. */
const MEASURE_MAX = 400;

/**
 * What to observe for a group whose own evidence is quoted. The quotation is context and not the
 * outcome: a passage can state a worry, a gap in the data or a proposal, so someone who knows the group
 * has to say what to count before the check starts. The quotation is shortened to what the rest leaves.
 */
export function concernMeasure(group: string, concern: string): string {
  const frame = (quote: string): string =>
    `For ${group}: what the evidence for them points to, ${quote}, made into something countable by someone who knows the group before the check starts (a passage may state a worry, not an observation); and the proportion who start using an alternative, reduce their use or formally object.`;
  const room = MEASURE_MAX - frame('').length;
  return frame(embed(concern, Math.max(20, Math.min(100, room - 2))));
}

/** A check as the plan holds it, with what the rest of the brief needs to refer to it. */
export interface PlannedCheck extends ValidationExperiment {
  /** The premises it settles, as `kind:id`, so that the answer can point at the check that settles one. */
  keys: string[];
  refs: Partial<BriefRefs>;
  /** A few words naming what it settles. */
  gist: string;
}

interface Candidate {
  /** Which candidates survive when there are more than the plan holds: the lower the more necessary. */
  rank: number;
  /** Where in the plan it stands: the answer's premises first, then the evidence, then repeating runs. */
  place: number;
  check: Omit<PlannedCheck, 'id'>;
}

const PLACE = {
  direction: 0,
  strength: 1,
  impact: 2,
  trait: 3,
  spread: 4,
  population: 5,
  conflict: 6,
  responder: 7,
  gap: 8,
  repeat: 9,
} as const;

const merged = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined): T[] => [
  ...new Set([...(a ?? []), ...(b ?? [])]),
];

const mergeRefs = (a: Partial<BriefRefs>, b: Partial<BriefRefs>): Partial<BriefRefs> => ({
  evidence: merged(a.evidence, b.evidence),
  stakeholderIds: merged(a.stakeholderIds, b.stakeholderIds),
  findingIds: merged(a.findingIds, b.findingIds),
  sensitivityIds: merged(a.sensitivityIds, b.sensitivityIds),
  critiqueIds: merged(a.critiqueIds, b.critiqueIds),
  assumptions: merged(a.assumptions, b.assumptions),
  documentIds: merged(a.documentIds, b.documentIds),
  variantIds: merged(a.variantIds, b.variantIds),
});

interface Made {
  check: Check;
  slots: Slots;
  owner: string;
  targets: string[];
  keys: string[];
  refs: Partial<BriefRefs>;
}

function assemble({ check, slots, owner, targets, keys, refs }: Made): Omit<PlannedCheck, 'id'> {
  const say = (template: string, max: number): string => clip(fill(template, slots), max);
  return {
    // A step of a perturbation is written in words: a percent sign reads as a share of people.
    targets: targets
      .slice(0, MAX_TARGETS)
      .map((target) => clip(target.replace(/(\d+(?:\.\d+)?)\s*%/gu, '$1 per cent'), 120)),
    question: say(check.question, 300),
    method: say(check.method, 400),
    successSignal: say(check.decision, 300),
    effort: check.effort,
    duration: check.duration,
    measure: say(check.measure, MEASURE_MAX),
    comparison: say(check.comparison, 300),
    ownerFunction: clip(owner, 120),
    keys,
    refs,
    gist: say(check.gist, 160),
  };
}

const byShift = (a: SensitivityRow, b: SensitivityRow): number =>
  Math.abs(b.shift) - Math.abs(a.shift) || (a.id < b.id ? -1 : 1);

/**
 * The checks that would settle what the answer most depends on, in this order of necessity: the
 * premises of the headline decision that nothing measured (how large the change is in practice, how it
 * lands on the groups the answer names, the assumptions the runs were sensitive to), the open
 * conflicts between sources, what triggers the outside actors that repeatedly responded, the key
 * actors that nothing cited supports, and, only for a headline result that disagrees across seeded
 * runs, repeating the analysis. An ordering of groups or a single event is never a reason to repeat
 * runs. When no stakeholder has an expected direction of impact, the first check settles that.
 */
export function planChecks(facts: Facts): PlannedCheck[] {
  const { analysis } = facts;
  const state = facts.signal.state;
  const headline = facts.headline;
  const words = wordsOf(facts);
  const found = new Map<string, Candidate>();
  const add = (identity: string, rank: number, place: number, made: Made): void => {
    const next = assemble(made);
    const seen = found.get(identity);
    if (!seen) {
      found.set(identity, { rank, place, check: next });
      return;
    }
    seen.rank = Math.min(seen.rank, rank);
    seen.check = {
      ...seen.check,
      targets: merged(seen.check.targets, next.targets).slice(0, MAX_TARGETS),
      keys: merged(seen.check.keys, next.keys),
      refs: mergeRefs(seen.check.refs, next.refs),
    };
  };
  const ownerOf = (actor: Actor): string => OWNER_BY_CATEGORY[actor.category];
  const groupName = (actor: Actor): string => embed(actor.name, 60);

  if (state === 'no-direction' || facts.signal.undirected) {
    const { finding } = facts.signal;
    add('direction', 0, PLACE.direction, {
      check: DIRECTION_CHECK,
      slots: words,
      owner: 'research and analytics',
      targets: [
        finding && state === 'no-direction'
          ? `finding ${finding.id}: the comparison could not tell the change from no change`
          : 'assumption: the direction of impact of every stakeholder',
      ],
      keys: ['premise:direction'],
      refs: { findingIds: finding ? [finding.id] : [] },
    });
  }

  const lead = state === 'no-direction' ? [] : impactLeads(facts, 2);
  if (headline && headline.variant.variant.kind === 'alternative' && state !== 'no-direction') {
    const variant = headline.variant.variant;
    add('strength', 1, PLACE.strength, {
      check: STRENGTH_CHECK,
      slots: words,
      owner: OWNER_BY_CATEGORY['decision-maker'],
      targets: [`assumption: strength and timing of ${variant.label}, a setting of the simulation`],
      keys: ['premise:strength'],
      refs: {
        variantIds: [variant.id],
        assumptions: ['The strength and timing of a change are settings of the simulation.'],
      },
    });
  }
  // The groups the answer names for how far their share moved, then a group that the advice builds on
  // because it is helped: a benefit that nothing measured is not something to build on yet.
  const helped =
    state === 'clear' && headline
      ? favourableLeads(facts)
          .filter(
            (entry) =>
              entry.variant.variant.id === headline.variant.variant.id &&
              !lead.some((actor) => actor.id === entry.actor.id),
          )
          .slice(0, 1)
          .map((entry) => entry.actor)
      : [];
  [...lead, ...helped].forEach((actor, index) => {
    // What the evidence says about the group points to what to observe, so a group that worries about
    // something other than leaving is asked about that and not only about whether it switches. A
    // passage can state a worry, a gap or a proposal and not an outcome that was seen, so the quote is
    // context and someone who knows the group has to say what to count.
    const cited = facts.evidence.has(actor.stakeholderId)
      ? facts.evidence.forStakeholder(actor.stakeholderId)
      : facts.evidence.forActor(actor);
    const concern = (cited.find((ref) => ref.role === 'supports' && ref.quote) ?? cited[0])?.quote;
    add(`impact:${actor.id}`, index === 0 ? 2 : 5, PLACE.impact, {
      check: concern
        ? { ...TRAIT_CHECKS.impact, measure: concernMeasure(groupName(actor), concern) }
        : TRAIT_CHECKS.impact,
      slots: { ...words, group: groupName(actor) },
      owner: ownerOf(actor),
      targets: [
        `assumption: the effect of the change on ${actor.name}, ${DIRECTION_WORDS[facts.directionIn(actor)]} (${facts.impactSetByScenario(actor) ? 'set by the scenario that proposes the change' : impactOrigin(actor)})`,
      ],
      keys: [`premise:impact:${actor.id}`],
      refs: {
        stakeholderIds: [actor.stakeholderId],
        assumptions: [`Impact of the change on ${actor.name}`],
      },
    });
  });

  sizedLeads(facts, 1).forEach((actor) => {
    add(`population:${actor.id}`, 6, PLACE.population, {
      check: POPULATION_CHECK,
      slots: { ...words, group: groupName(actor) },
      owner: ownerOf(actor),
      targets: [`assumption: the size of ${actor.name}, assumed at ${actor.size} and not counted`],
      keys: [`premise:population:${actor.id}`],
      refs: {
        stakeholderIds: [actor.stakeholderId],
        assumptions: ['Population sizes are assumptions, not counts.'],
      },
    });
  });

  const sensitive = analysis.sensitivity
    .filter(
      (row) => row.classification === 'assumption-sensitive' && row.assumptionOrigin !== 'evidence',
    )
    .sort(byShift)
    .slice(0, 5);
  sensitive.forEach((row, index) => {
    const actor = row.target.actorId ? facts.actorById.get(row.target.actorId) : undefined;
    const target = `sensitivity ${row.id}: ${row.label}`;
    const refs: Partial<BriefRefs> = { sensitivityIds: [row.id] };
    const key = `sensitivity:${row.id}`;
    if (row.target.kind === 'intensity' && headline) {
      add('strength', 1, PLACE.strength, {
        check: STRENGTH_CHECK,
        slots: words,
        owner: OWNER_BY_CATEGORY['decision-maker'],
        targets: [target],
        keys: [key],
        refs: { ...refs, variantIds: [headline.variant.variant.id] },
      });
    } else if (!actor) {
      return;
    } else if (row.target.kind === 'population') {
      add(`spread:${actor.id}`, 13 + index, PLACE.spread, {
        check: SPREAD_CHECK,
        slots: { ...words, group: groupName(actor) },
        owner: ownerOf(actor),
        targets: [target],
        keys: [key],
        refs: { ...refs, stakeholderIds: [actor.stakeholderId] },
      });
    } else if (row.target.kind === 'trait' && TRAIT_KEYS.includes(row.target.trait as TraitKey)) {
      const trait = row.target.trait as TraitKey;
      add(
        trait === 'impact' ? `impact:${actor.id}` : `trait:${actor.id}:${trait}`,
        trait === 'impact' ? 2 : 6 + index,
        trait === 'impact' ? PLACE.impact : PLACE.trait,
        {
          check: TRAIT_CHECKS[trait],
          slots: { ...words, group: groupName(actor) },
          owner: ownerOf(actor),
          targets: [target],
          keys: [key],
          refs: { ...refs, stakeholderIds: [actor.stakeholderId] },
        },
      );
    }
  });

  openConflicts(facts)
    .slice(0, 2)
    .forEach((conflict, index) => {
      add(`conflict:${conflict.id}`, index === 0 ? 3 : 9, PLACE.conflict, {
        check: CONFLICT_CHECK,
        slots: {
          ...words,
          topic: embed(conflict.topic, 100),
          sources: `${embed(conflict.left.documentName, 50)} (${embed(conflict.leftValue ?? 'one position', 40)}) or ${embed(conflict.right.documentName, 50)} (${embed(conflict.rightValue ?? 'another', 40)})`,
        },
        owner: 'research and analytics',
        targets: [`conflict ${conflict.id}: ${conflict.topic}`],
        keys: [`conflict:${conflict.id}`],
        refs: { evidence: [conflict.left, conflict.right] },
      });
    });

  repeatedResponders(facts)
    .slice(0, 2)
    .forEach(({ actor, finding }, index) => {
      const trigger = TRIGGER_BY_CATEGORY[actor.category];
      add(`responder:${actor.id}`, index === 0 ? 4 : 10, PLACE.responder, {
        check: RESPONDER_CHECK,
        slots: { ...words, group: groupName(actor), ...(trigger ? { trigger } : {}) },
        owner: ownerOf(actor),
        targets: [`finding ${finding.id}: ${finding.statement}`],
        keys: [`responder:${actor.id}`, `gap:${actor.stakeholderId}`],
        refs: { findingIds: [finding.id], stakeholderIds: [actor.stakeholderId] },
      });
    });

  unevidencedKeyActors(facts)
    .slice(0, 2)
    .forEach((actor, index) => {
      // A responder that is also unsupported is one check, with the gap as another thing it settles.
      const identity = found.has(`responder:${actor.id}`)
        ? `responder:${actor.id}`
        : `gap:${actor.id}`;
      add(identity, index === 0 ? 7 : 12, PLACE.gap, {
        check: gapCheckFor(actor.category),
        slots: { ...words, group: groupName(actor) },
        owner: ownerOf(actor),
        targets: [`evidence gap ${actor.stakeholderId}: ${actor.name}`],
        keys: [`gap:${actor.stakeholderId}`],
        refs: { stakeholderIds: [actor.stakeholderId] },
      });
    });

  if (state !== 'no-direction') {
    const unstable = unstableFindings(facts).slice(0, 3);
    if (unstable.length > 0) {
      // When the answer's own direction disagrees across runs, nothing else in the plan matters before this.
      const rank = unstable.some((finding) => finding.kind === 'direction-vs-baseline') ? 0 : 8;
      add('repeat', rank, PLACE.repeat, {
        check: REPEAT_CHECK,
        slots: words,
        owner: 'research and analytics',
        targets: unstable.map((finding) => `finding ${finding.id}: ${finding.statement}`),
        keys: unstable.map((finding) => `finding:${finding.id}`),
        refs: { findingIds: unstable.map((finding) => finding.id) },
      });
    }
  }

  return [...found.values()]
    .sort((a, b) => a.rank - b.rank || a.place - b.place)
    .slice(0, MAX_EXPERIMENTS)
    .sort((a, b) => a.place - b.place || a.rank - b.rank)
    .map(({ check }, index): PlannedCheck => ({ ...check, id: `val-${index + 1}` }));
}

/** The plan as the stored brief holds it. */
export function validationPlan(facts: Facts): ValidationExperiment[] {
  return planChecks(facts).map(
    ({ keys: _keys, refs: _refs, gist: _gist, ...experiment }) => experiment,
  );
}
