import type { EvidenceRef } from '../../../shared/evidence.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import {
  STAKEHOLDER_CATEGORIES,
  STAKEHOLDER_CATEGORY_LABELS,
  stakeholderSchema,
  type Stakeholder,
  type StakeholderCategory,
  type Uncertainty,
} from '../../../shared/stakeholders.js';
import type { EvidenceChunk, KnowledgeGraph } from '../../../shared/types.js';
import { suspiciousPassageIds } from '../models/injection.js';
import { uniqueEvidence, verifiedEvidence } from './evidence.js';
import { GENERIC_ROLES, type ContextCue } from './lexicon.js';
import { categoryOfName, findMentions, keyOf, occurrencesOf, type Occurrence } from './mentions.js';
import { capitalise, plural, slugify, truncate, uniqueId } from './names.js';
import { CATEGORY_DIRECTNESS, CATEGORY_IMPACT, CATEGORY_RELEVANCE } from './priors.js';
import {
  directionOf,
  hasStakes,
  readCited,
  readTone,
  toneRationale,
  type Group,
  type Tone,
} from './tone.js';

/** The most stakeholders the rules path proposes. */
export const MAX_DISCOVERED = 25;
/** The most that become individual actors; the rest are cohorts. */
export const MAX_KEY = 8;
const MAX_QUOTES = 4;
/** The most excerpts kept for one group while the cited few are chosen from them. */
const MAX_KEPT = 200;
/** What a cohort's size is before anyone says otherwise: a placeholder, not a count. */
export const PLACEHOLDER_SIZE = { key: 1, standard: 100, background: 25 } as const;

/** What discovery reads: the question, the scenario if there is one, the graph if built, the passages. */
export interface DiscoveryContext {
  question: string;
  scenario: ScenarioFrame | null;
  graph: KnowledgeGraph | null;
  passages: readonly EvidenceChunk[];
}

interface Candidate {
  key: string;
  name: string;
  category: StakeholderCategory;
  origin: 'rules' | 'scenario';
  /** Sentences of the evidence that name this group. */
  sentences: number;
  passageIds: Set<string>;
  /** Every excerpt that names the group, in reading order; the cited few are chosen from these. */
  quotes: Occurrence[];
  /** The sentences those excerpts come from, so that two names for one group count each once. */
  marks: Set<string>;
  /** Names that were folded into this one because they are certainly the same group. */
  absorbed: Candidate[];
  cues: Record<ContextCue, number>;
  graphKind: 'person' | 'organization' | 'group' | null;
}

const newCandidate = (
  key: string,
  name: string,
  category: StakeholderCategory,
  origin: Candidate['origin'],
): Candidate => ({
  key,
  name,
  category,
  origin,
  sentences: 0,
  passageIds: new Set(),
  quotes: [],
  marks: new Set(),
  absorbed: [],
  cues: { cost: 0, benefit: 0, risk: 0 },
  graphKind: null,
});

const cleanName = (text: string): string =>
  capitalise(
    text
      .replace(/^(?:the|a|an|our|their|its)\s+/iu, '')
      .replace(/[\s.,;:!?]+$/u, '')
      .trim(),
  );

function addOccurrences(candidate: Candidate, found: Occurrence[], sentences: number): void {
  for (const occurrence of found) {
    candidate.passageIds.add(occurrence.passageId);
    if (candidate.quotes.length < MAX_KEPT) candidate.quotes.push(occurrence);
  }
  candidate.sentences = Math.max(candidate.sentences, sentences);
}

/** Groups named in the passages by a role noun, each under one key whatever the plural or case. */
function fromMentions(passages: readonly EvidenceChunk[]): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();
  const surfaces = new Map<string, Map<string, string>>();
  const tallies = new Map<string, Map<string, number>>();
  for (const mention of findMentions(passages)) {
    let candidate = candidates.get(mention.key);
    if (!candidate) {
      candidate = newCandidate(mention.key, '', mention.category, 'rules');
      candidates.set(mention.key, candidate);
    }
    candidate.sentences += 1;
    candidate.passageIds.add(mention.passageId);
    if (candidate.quotes.length < MAX_KEPT) {
      candidate.quotes.push({ passageId: mention.passageId, quote: mention.quote });
    }
    candidate.marks.add(mention.quote.toLowerCase());
    if (mention.cue) candidate.cues[mention.cue] += 1;
    const lower = mention.surface.toLowerCase();
    const tally = tallies.get(mention.key) ?? new Map<string, number>();
    tally.set(lower, (tally.get(lower) ?? 0) + 1);
    tallies.set(mention.key, tally);
    const written = surfaces.get(mention.key) ?? new Map<string, string>();
    if (!written.has(lower)) written.set(lower, mention.surface);
    surfaces.set(mention.key, written);
  }
  for (const [key, candidate] of candidates) {
    const best = [...(tallies.get(key) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;
    candidate.name = capitalise(surfaces.get(key)?.get(best) ?? key);
  }
  return candidates;
}

/** An end user whose sentences keep speaking of paying, gaining or being exposed is read as such. */
function topCue(candidate: Candidate): ContextCue | null {
  const [top, next] = (Object.entries(candidate.cues) as [ContextCue, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  return top && top[1] >= 2 && (!next || next[1] < top[1]) ? top[0] : null;
}

function categoryFrom(candidate: Candidate): StakeholderCategory {
  const cue = candidate.category === 'end-user' ? topCue(candidate) : null;
  if (!cue) return candidate.category;
  return cue === 'cost' ? 'cost-bearer' : cue === 'benefit' ? 'beneficiary' : 'risk-bearer';
}

function addSeeds(
  candidates: Map<string, Candidate>,
  scenario: ScenarioFrame | null,
  passages: readonly EvidenceChunk[],
): void {
  for (const seed of scenario?.likelyStakeholders ?? []) {
    const name = cleanName(seed);
    const key = keyOf(name);
    if (!key) continue;
    const existing = candidates.get(key);
    if (existing) {
      existing.origin = 'scenario';
      continue;
    }
    const { found, sentences } = occurrencesOf(passages, name, MAX_KEPT);
    // The question says "regulator" and the text says "regional regulator": one group, named by both.
    const specific =
      sentences === 0
        ? [...candidates.values()]
            .filter((candidate) => candidate.key.endsWith(` ${key}`))
            .sort((a, b) => b.sentences - a.sentences)[0]
        : undefined;
    if (specific) {
      specific.origin = 'scenario';
      continue;
    }
    const candidate = newCandidate(key, name, categoryOfName(name), 'scenario');
    addOccurrences(candidate, found, sentences);
    candidates.set(key, candidate);
  }
}

function addGraphEntities(
  candidates: Map<string, Candidate>,
  graph: KnowledgeGraph | null,
  passages: readonly EvidenceChunk[],
): void {
  const byId = new Map(passages.map((passage) => [passage.id, passage]));
  for (const node of graph?.nodes ?? []) {
    if (node.kind === 'topic') continue;
    const name = cleanName(node.label);
    const key = keyOf(name);
    if (!key) continue;
    let candidate = candidates.get(key);
    if (!candidate) {
      const category = categoryOfName(name);
      candidate = newCandidate(
        key,
        name,
        category === 'other' ? categoryOfName(node.entityType ?? '') : category,
        'rules',
      );
      candidates.set(key, candidate);
    }
    candidate.graphKind ??= node.kind;
    const { found, sentences } = occurrencesOf(passages, name, MAX_KEPT);
    addOccurrences(candidate, found, sentences);
    if (node.quote) {
      for (const id of node.sourceIds) {
        const verified = verifiedEvidence(byId, id, node.quote);
        if (!verified) continue;
        addOccurrences(candidate, [{ passageId: id, quote: verified.ref.quote ?? node.quote }], 1);
        break;
      }
    }
  }
}

/** The shared reading of how much the evidence says about a group: how many sentences, in how many passages. */
export function uncertaintyFor(
  sentences: number,
  passageCount: number,
  named: boolean,
): Uncertainty {
  if (sentences === 0) {
    return {
      level: 'high',
      reason: named
        ? 'Named in the question, but no passage mentions this group.'
        : 'No passage mentions this group.',
    };
  }
  if (sentences === 1) {
    return {
      level: 'high',
      reason: 'Mentioned in one sentence of the evidence, so it rests on a single mention.',
    };
  }
  const where = passageCount > 1 ? `${passageCount} passages` : 'one passage';
  if (sentences >= 4 && passageCount >= 2) {
    return {
      level: 'low',
      reason: `Mentioned in ${sentences} sentences across ${where}. That supports that the group is in the evidence, not what it wants or how it will react.`,
    };
  }
  return { level: 'medium', reason: `Mentioned in ${sentences} sentences of ${where}.` };
}

const CUE_WORDS: Record<ContextCue, string> = {
  cost: 'paying or cost',
  benefit: 'gains or savings',
  risk: 'exposure or loss',
};

export function impactFor(category: StakeholderCategory, shifted: ContextCue | null = null) {
  const direction = CATEGORY_IMPACT[category];
  const lead = shifted
    ? `Wording cue: the sentences naming this group speak of ${CUE_WORDS[shifted]}. `
    : '';
  const rationale =
    direction === 'harmed'
      ? 'Category default: a group that bears cost is assumed to be harmed by the change.'
      : direction === 'benefited'
        ? 'Category default: a group that benefits is assumed to gain from the change.'
        : 'Category default: this category implies no direction, so none is assumed.';
  return {
    direction,
    rationale: truncate(`${lead}${rationale} This is not a finding from the sources.`, 400),
    origin: 'system-assumption' as const,
  };
}

function describe(candidate: Candidate): string {
  const parts: string[] = [];
  if (candidate.sentences > 0) {
    parts.push(
      `Found by reading the text for roles: named in ${plural(candidate.sentences, 'sentence')} of ${plural(candidate.passageIds.size, 'passage')}.`,
    );
  } else if (candidate.origin === 'scenario') {
    parts.push('Named in the question as a likely stakeholder; no passage names this group.');
  }
  if (candidate.graphKind === 'person') {
    parts.push(
      'The sources name this as a person. It is modelled as the role, not as that individual.',
    );
  } else if (candidate.graphKind) {
    parts.push(
      `The sources’ graph names this as ${candidate.graphKind === 'group' ? 'a group' : 'an organisation'}.`,
    );
  }
  return truncate(parts.join(' '), 600);
}

export interface RulesResult {
  /** The groups found, then any that were folded into another and are kept as removed, so that it can be undone. */
  stakeholders: Stakeholder[];
  /** What was read, for the note: passages, and role mentions found. */
  read: { passages: number; groups: number };
  /** The names that were folded into another because they are certainly the same group. */
  merges: { from: string; into: string }[];
  /** Plain notices, such as passages that speak to an AI system. */
  notices: string[];
}

/** A notice for the person when sources contain text addressed to an AI system, which is ignored. */
export function injectionNotice(passages: readonly { id: string; text: string }[]): string[] {
  const ids = suspiciousPassageIds(passages);
  if (ids.length === 0) return [];
  const shown = ids.slice(0, 3).join(', ');
  const more = ids.length > 3 ? ` and ${ids.length - 3} more` : '';
  return [
    `Text addressed to an AI system in ${shown}${more} was ignored; check those sources before relying on the list.`,
  ];
}

const groupOf = (candidate: Candidate): Group => ({
  key: candidate.key,
  own: new Set([
    ...candidate.key.split(' '),
    ...(candidate.name.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []),
  ]),
});

/** What each sentence was read as, remembered so that no sentence is read twice in one discovery. */
function remembered(): (sentence: string) => Tone {
  const seen = new Map<string, Tone>();
  return (sentence) => {
    let tone = seen.get(sentence);
    if (!tone) {
      tone = readTone(sentence);
      seen.set(sentence, tone);
    }
    return tone;
  };
}

/**
 * The few excerpts to cite for a group. Those that carry a cue come first, one of each kind before
 * more of either, so that the direction read from them can be seen in what is cited; then the rest,
 * with sentences that are only headings last.
 */
function chooseQuotes(candidate: Candidate, read: (sentence: string) => Tone): Occurrence[] {
  const group = groupOf(candidate);
  const readings = candidate.quotes.map((occurrence) => ({
    occurrence,
    ...readCited([occurrence.quote], group, read),
  }));
  type Reading = (typeof readings)[number];
  const carries = (reading: Reading): boolean =>
    reading.concern.length + reading.support.length > 0;
  const picked: Reading[] = [];
  const take = (reading: Reading | undefined): void => {
    if (reading && !picked.includes(reading) && picked.length < MAX_QUOTES) picked.push(reading);
  };
  take(readings.find((reading) => reading.concern.length > 0));
  take(readings.find((reading) => reading.support.length > 0));
  readings.filter(carries).forEach(take);
  readings.filter((reading) => !/^\s*#/u.test(reading.occurrence.quote)).forEach(take);
  readings.forEach(take);
  return readings
    .filter((reading) => picked.includes(reading))
    .map((reading) => reading.occurrence);
}

const endsWith = (words: readonly string[], tail: readonly string[]): boolean =>
  tail.every((word, offset) => words[words.length - tail.length + offset] === word);

/**
 * Folds a group named two ways into one, but only when it is certain they are the same: one name is
 * the other with describing words in front ("Analyst" and "Independent analyst"), both are in the
 * same category, and there is no other longer name it could belong to. Different words for one idea
 * ("Staff", "Workers", "Employees") stay apart: only a person can say they are one group. The name
 * that is written in more sentences is kept, and on a tie the more specific one.
 */
function mergeNames(
  candidates: Map<string, Candidate>,
  categoryOf: (candidate: Candidate) => StakeholderCategory,
): void {
  const pool = [...candidates.values()].filter(
    (candidate) =>
      candidate.origin === 'rules' && candidate.graphKind === null && candidate.marks.size > 0,
  );
  const wordsOfKey = (candidate: Candidate): string[] => candidate.key.split(' ');
  const gone = new Set<Candidate>();
  const shortestFirst = [...pool].sort(
    (a, b) => wordsOfKey(a).length - wordsOfKey(b).length || a.key.localeCompare(b.key),
  );
  for (const short of shortestFirst) {
    if (gone.has(short)) continue;
    const longer = pool.filter(
      (other) =>
        other !== short &&
        !gone.has(other) &&
        wordsOfKey(other).length > wordsOfKey(short).length &&
        categoryOf(other) === categoryOf(short) &&
        endsWith(wordsOfKey(other), wordsOfKey(short)),
    );
    const only = longer.length === 1 ? longer[0] : undefined;
    if (!only) continue;
    const keep = short.sentences > only.sentences ? short : only;
    const drop = keep === short ? only : short;
    for (const mark of drop.marks) keep.marks.add(mark);
    keep.sentences = keep.marks.size;
    for (const id of drop.passageIds) keep.passageIds.add(id);
    const known = new Set(keep.quotes.map((item) => `${item.passageId}|${item.quote}`));
    for (const item of drop.quotes) {
      if (keep.quotes.length < MAX_KEPT && !known.has(`${item.passageId}|${item.quote}`)) {
        keep.quotes.push(item);
      }
    }
    for (const cue of Object.keys(keep.cues) as ContextCue[]) keep.cues[cue] += drop.cues[cue];
    keep.absorbed.push(drop, ...drop.absorbed);
    gone.add(drop);
  }
  for (const candidate of gone) candidates.delete(candidate.key);
}

/**
 * Stakeholders found by reading the text, with no model: the scenario's own words, role nouns in the
 * passages, and the people and organisations in the source graph. The same input always gives the
 * same output. It is honest about what it is: a reading for roles, with gaps.
 *
 * Each group's direction of impact is read from the wording of the sentences cited for it (see
 * tone.ts), and a group that is certainly the same as another is folded into it (see mergeNames).
 */
export function discoverByRules(context: DiscoveryContext): RulesResult {
  const { passages } = context;
  const candidates = fromMentions(passages);
  addSeeds(candidates, context.scenario, passages);
  addGraphEntities(candidates, context.graph, passages);
  mergeNames(candidates, categoryFrom);
  const read = remembered();

  /** A role that names a position in any organisation, mentioned with nothing at stake for it. */
  const stakes = new Map<Candidate, boolean>();
  const genericAlone = (candidate: Candidate): boolean => {
    if (candidate.origin !== 'rules' || candidate.graphKind !== null) return false;
    if (!GENERIC_ROLES.has(candidate.key)) return false;
    let found = stakes.get(candidate);
    if (found === undefined) {
      found = candidate.quotes.some((item) => hasStakes(item.quote, read));
      stakes.set(candidate, found);
    }
    return !found;
  };

  const ordered = [...candidates.values()]
    .sort(
      (a, b) =>
        Number(b.origin === 'scenario') - Number(a.origin === 'scenario') ||
        b.sentences - a.sentences ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_DISCOVERED);

  const final = new Map(ordered.map((candidate) => [candidate, categoryFrom(candidate)]));
  const topMentioned = new Set(
    [...ordered]
      .filter((candidate) => candidate.sentences >= 2 && !genericAlone(candidate))
      .sort((a, b) => b.sentences - a.sentences || a.name.localeCompare(b.name))
      .slice(0, 2),
  );
  const isImportant = (candidate: Candidate): boolean => {
    const category = final.get(candidate) ?? candidate.category;
    return (
      !genericAlone(candidate) &&
      (category === 'decision-maker' ||
        category === 'regulator' ||
        category === 'competitor' ||
        topMentioned.has(candidate))
    );
  };
  const keyOnes = new Set(
    ordered
      .filter(isImportant)
      .sort((a, b) => b.sentences - a.sentences || a.name.localeCompare(b.name))
      .slice(0, MAX_KEY),
  );
  const priorityOf = (candidate: Candidate): Stakeholder['priority'] =>
    keyOnes.has(candidate)
      ? 'key'
      : genericAlone(candidate)
        ? 'background'
        : candidate.sentences >= 2 || candidate.origin === 'scenario'
          ? 'standard'
          : 'background';

  const byPassage = new Map(passages.map((passage) => [passage.id, passage]));
  const used = new Set<string>();
  const build = (
    candidate: Candidate,
    status: Stakeholder['status'],
    folded: readonly Candidate[],
    foldedIds: readonly string[],
  ): Stakeholder => {
    const category = final.get(candidate) ?? categoryFrom(candidate);
    const priority = priorityOf(candidate);
    const shifted = category === candidate.category ? null : topCue(candidate);
    const refs: EvidenceRef[] = [];
    for (const occurrence of chooseQuotes(candidate, read)) {
      const verified = verifiedEvidence(byPassage, occurrence.passageId, occurrence.quote);
      if (verified) refs.push(verified.ref);
    }
    const evidence = uniqueEvidence(refs, MAX_QUOTES);
    // The direction is read only from the sentences cited, so that what is cited shows what was counted.
    const cited = readCited(
      evidence.map((ref) => ref.quote ?? ''),
      groupOf(candidate),
      read,
    );
    const direction = directionOf(cited.concern.length, cited.support.length);
    return stakeholderSchema.parse({
      id: uniqueId(slugify(candidate.name), used),
      name: truncate(candidate.name, 120),
      category,
      description: describe(candidate),
      relevance: `${CATEGORY_RELEVANCE[category]} Category default; why it matters here has not been analysed.`,
      directness: CATEGORY_DIRECTNESS[category],
      priority,
      populationSize: PLACEHOLDER_SIZE[priority],
      expectedImpact:
        direction === 'unclear'
          ? impactFor(category, shifted)
          : {
              direction,
              rationale: truncate(toneRationale(cited.concern, cited.support), 400),
              origin: 'evidence' as const,
            },
      evidence,
      assumptions: [
        ...(priority === 'key'
          ? []
          : [
              `Population size ${PLACEHOLDER_SIZE[priority]} is a placeholder for modelling, not a count.`,
            ]),
        ...(shifted
          ? [
              `Placed among the ${STAKEHOLDER_CATEGORY_LABELS[category].toLowerCase()} groups from wording, not from a statement in the sources.`,
            ]
          : []),
        ...(direction === 'unclear'
          ? []
          : [
              'The direction of impact is read from the wording of the cited sentences, not stated in the sources.',
            ]),
        ...folded.map((other) => truncate(`Merged with “${other.name}”.`, 300)),
      ].slice(0, 8),
      uncertainty: uncertaintyFor(
        candidate.sentences,
        candidate.passageIds.size,
        candidate.origin === 'scenario',
      ),
      origin: candidate.origin,
      status,
      mergedFrom: foldedIds.slice(0, 10),
    });
  };

  const stakeholders: Stakeholder[] = [];
  const folded: Stakeholder[] = [];
  for (const candidate of ordered) {
    // Names folded into this one are kept as removed, so that the merge can be seen and undone.
    const gone = candidate.absorbed.map((other) => build(other, 'removed', [], []));
    folded.push(...gone);
    stakeholders.push(
      build(
        candidate,
        'proposed',
        candidate.absorbed,
        gone.map((item) => item.id),
      ),
    );
  }

  const order = (stakeholder: Stakeholder): number =>
    ['key', 'standard', 'background'].indexOf(stakeholder.priority);
  stakeholders.sort(
    (a, b) =>
      order(a) - order(b) ||
      STAKEHOLDER_CATEGORIES.indexOf(a.category) - STAKEHOLDER_CATEGORIES.indexOf(b.category) ||
      a.name.localeCompare(b.name),
  );
  folded.sort((a, b) => a.name.localeCompare(b.name));
  return {
    stakeholders: [...stakeholders, ...folded],
    read: { passages: passages.length, groups: stakeholders.length },
    merges: ordered.flatMap((candidate) =>
      candidate.absorbed.map((other) => ({ from: other.name, into: candidate.name })),
    ),
    notices: injectionNotice(passages),
  };
}
