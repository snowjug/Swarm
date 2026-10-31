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
import type { ContextCue } from './lexicon.js';
import { categoryOfName, findMentions, keyOf, occurrencesOf, type Occurrence } from './mentions.js';
import { capitalise, plural, slugify, truncate, uniqueId } from './names.js';
import { CATEGORY_DIRECTNESS, CATEGORY_IMPACT, CATEGORY_RELEVANCE } from './priors.js';

/** The most stakeholders the rules path proposes. */
export const MAX_DISCOVERED = 25;
/** The most that become individual actors; the rest are cohorts. */
export const MAX_KEY = 8;
const MAX_QUOTES = 4;
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
  quotes: Occurrence[];
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
    if (candidate.quotes.length < MAX_QUOTES) candidate.quotes.push(occurrence);
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
    if (candidate.quotes.length < MAX_QUOTES) {
      candidate.quotes.push({ passageId: mention.passageId, quote: mention.quote });
    }
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
    const { found, sentences } = occurrencesOf(passages, name, MAX_QUOTES);
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
    const { found, sentences } = occurrencesOf(passages, name, 2);
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
  stakeholders: Stakeholder[];
  /** What was read, for the note: passages, and role mentions found. */
  read: { passages: number; groups: number };
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

/**
 * Stakeholders found by reading the text, with no model: the scenario's own words, role nouns in the
 * passages, and the people and organisations in the source graph. The same input always gives the
 * same output. It is honest about what it is: a reading for roles, with gaps.
 */
export function discoverByRules(context: DiscoveryContext): RulesResult {
  const { passages } = context;
  const candidates = fromMentions(passages);
  addSeeds(candidates, context.scenario, passages);
  addGraphEntities(candidates, context.graph, passages);

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
      .filter((candidate) => candidate.sentences >= 2)
      .sort((a, b) => b.sentences - a.sentences || a.name.localeCompare(b.name))
      .slice(0, 2),
  );
  const isImportant = (candidate: Candidate): boolean => {
    const category = final.get(candidate) ?? candidate.category;
    return (
      category === 'decision-maker' ||
      category === 'regulator' ||
      category === 'competitor' ||
      topMentioned.has(candidate)
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
      : candidate.sentences >= 2 || candidate.origin === 'scenario'
        ? 'standard'
        : 'background';

  const byPassage = new Map(passages.map((passage) => [passage.id, passage]));
  const used = new Set<string>();
  const stakeholders = ordered.map((candidate): Stakeholder => {
    const category = final.get(candidate) ?? candidate.category;
    const priority = priorityOf(candidate);
    const shifted = category === candidate.category ? null : topCue(candidate);
    const refs: EvidenceRef[] = [];
    for (const occurrence of candidate.quotes) {
      const verified = verifiedEvidence(byPassage, occurrence.passageId, occurrence.quote);
      if (verified) refs.push(verified.ref);
    }
    return stakeholderSchema.parse({
      id: uniqueId(slugify(candidate.name), used),
      name: truncate(candidate.name, 120),
      category,
      description: describe(candidate),
      relevance: `${CATEGORY_RELEVANCE[category]} Category default; why it matters here has not been analysed.`,
      directness: CATEGORY_DIRECTNESS[category],
      priority,
      populationSize: PLACEHOLDER_SIZE[priority],
      expectedImpact: impactFor(category, shifted),
      evidence: uniqueEvidence(refs, MAX_QUOTES),
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
      ],
      uncertainty: uncertaintyFor(
        candidate.sentences,
        candidate.passageIds.size,
        candidate.origin === 'scenario',
      ),
      origin: candidate.origin,
      status: 'proposed',
      mergedFrom: [],
    });
  });

  const order = (stakeholder: Stakeholder): number =>
    ['key', 'standard', 'background'].indexOf(stakeholder.priority);
  stakeholders.sort(
    (a, b) =>
      order(a) - order(b) ||
      STAKEHOLDER_CATEGORIES.indexOf(a.category) - STAKEHOLDER_CATEGORIES.indexOf(b.category) ||
      a.name.localeCompare(b.name),
  );
  return {
    stakeholders,
    read: { passages: passages.length, groups: stakeholders.length },
    notices: injectionNotice(passages),
  };
}
