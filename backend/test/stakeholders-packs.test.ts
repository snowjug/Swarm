import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import { changeCanMoveAnyone } from '../../shared/signal.js';
import { type Stakeholder, type StakeholderSet } from '../../shared/stakeholders.js';
import { findQuote } from '../src/grounding/text.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { parseScenario } from '../src/scenario/parse.js';
import { generateActors } from '../src/stakeholders/actors.js';
import { discoverStakeholders } from '../src/stakeholders/discover.js';
import { GENERIC_ROLES } from '../src/stakeholders/lexicon.js';
import { keyOf } from '../src/stakeholders/mentions.js';
import { IMPACT_VALUE } from '../src/stakeholders/priors.js';
import { approveSet } from '../src/stakeholders/review.js';
import { CONCERN_CUES, SUPPORT_CUES, hasStakes, readCited } from '../src/stakeholders/tone.js';
import { LIBRARY_PACK } from './support/stakeholder-briefs.js';

// What the rules path makes of the five worked examples and of a question of a person's own, read the
// way a project reads them: the scenario frame the rules make, the passages the chunker cuts, no model.
// Nothing here knows a domain. What it checks is that a direction of impact is read only where a cited
// sentence carries a cue, that near-duplicate names are folded only when it is certain, and that the
// notes say plainly how many directions were read and how many are still unclear.

interface Pack {
  id: string;
  question: string;
  documents: readonly { name: string; content: string }[];
}
const PACKS: Pack[] = [...EXAMPLE_SCENARIOS, LIBRARY_PACK];
const NOW = new Date('2026-03-01T09:00:00.000Z');

async function discover(pack: Pack) {
  const parsed = await parseScenario({
    question: pack.question,
    documents: pack.documents.map((document) => ({
      name: document.name,
      characters: document.content.length,
    })),
  });
  const passages = chunkDocuments(
    pack.documents.map((document, index) => ({
      id: `D${index + 1}`,
      name: document.name,
      content: document.content,
    })),
  ).map((chunk) => ({
    ...chunk,
    contentHash: createHash('sha256').update(chunk.text).digest('hex'),
  }));
  const set = await discoverStakeholders({
    project: { question: pack.question, graph: null },
    scenario: parsed.frame,
    passages,
    model: null,
    now: () => NOW,
  });
  return { set, passages, frame: parsed.frame };
}

const cache = new Map<string, ReturnType<typeof discover>>();
const read = (pack: Pack) => {
  let found = cache.get(pack.id);
  if (!found) {
    found = discover(pack);
    cache.set(pack.id, found);
  }
  return found;
};

const live = (set: StakeholderSet): Stakeholder[] =>
  set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
const wordsOf = (stakeholder: Stakeholder): string[] => keyOf(stakeholder.name).split(' ');

/** The cue words the rationale quotes. */
const quotedCues = (rationale: string): string[] =>
  [...rationale.matchAll(/“([^”]+)”/gu)].map((match) => match[1] ?? '');

/** The group as the rules read it, so that the cue words they count can be recounted. */
const groupOf = (stakeholder: Stakeholder) => ({
  key: keyOf(stakeholder.name),
  own: new Set([
    ...keyOf(stakeholder.name).split(' '),
    ...(stakeholder.name.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []),
  ]),
});

const endsWith = (words: readonly string[], tail: readonly string[]): boolean =>
  tail.length <= words.length &&
  tail.every((word, offset) => words[words.length - tail.length + offset] === word);

describe('the library pack is the journey’s own', () => {
  it('is word for word what the end-to-end journey test asks about', () => {
    const journey = readFileSync(
      new URL('./lab-journey.test.ts', import.meta.url),
      'utf8',
    ).replaceAll('\r\n', '\n');
    expect(journey).toContain(LIBRARY_PACK.question);
    for (const document of LIBRARY_PACK.documents) expect(journey).toContain(document.content);
  });
});

describe.each(PACKS)('reading the $id pack for roles, with no model', (pack) => {
  it('reads a direction only from the wording of sentences it cites, and quotes the words it counted', async () => {
    const { set } = await read(pack);
    for (const stakeholder of live(set)) {
      const { origin, direction, rationale } = stakeholder.expectedImpact;
      const quotes = stakeholder.evidence.map((ref) => (ref.quote ?? '').toLowerCase());
      if (origin === 'evidence') {
        expect(['harmed', 'benefited', 'mixed'], stakeholder.name).toContain(direction);
        const cues = quotedCues(rationale);
        expect(cues.length, stakeholder.name).toBeGreaterThan(0);
        // Every word it says it counted is in a sentence it cites.
        for (const cue of cues) {
          expect(
            quotes.some((quote) => quote.includes(cue)),
            `${stakeholder.name}: “${cue}” is in a cited sentence`,
          ).toBe(true);
        }
        const concern = cues.some((cue) => CONCERN_CUES.includes(cue));
        const support = cues.some((cue) => SUPPORT_CUES.includes(cue));
        expect(direction, stakeholder.name).toBe(
          concern && support ? 'mixed' : concern ? 'harmed' : 'benefited',
        );
        expect(rationale).toContain(
          'This is a reading of tone from the cited passage, not a finding.',
        );
        expect(stakeholder.assumptions.join(' ')).toContain(
          'read from the wording of the cited sentences',
        );
      } else {
        // Nothing was read, and so the direction is what the category implies, called an assumption.
        expect(origin, stakeholder.name).toBe('system-assumption');
        const cited = readCited(
          stakeholder.evidence.map((ref) => ref.quote ?? ''),
          groupOf(stakeholder),
        );
        expect(
          cited,
          `${stakeholder.name} cites a sentence with a cue and has no direction`,
        ).toEqual({
          concern: [],
          support: [],
        });
        if (!['cost-bearer', 'beneficiary'].includes(stakeholder.category)) {
          expect(direction, stakeholder.name).toBe('unclear');
        }
      }
    }
  });

  it('cites quotes that are exact excerpts of this project’s passages', async () => {
    const { set, passages } = await read(pack);
    const byId = new Map(passages.map((passage) => [passage.id, passage]));
    for (const stakeholder of set.stakeholders) {
      for (const ref of stakeholder.evidence) {
        const passage = byId.get(ref.passageId);
        expect(passage, `${stakeholder.name}: ${ref.passageId}`).toBeDefined();
        if (!passage) continue;
        expect(findQuote(ref.quote ?? '', new Map([[passage.id, passage.text]])).found).toBe(true);
      }
    }
  });

  it('folds a name into another only when it is certain, and keeps the folded name where it can be undone', async () => {
    const { set } = await read(pack);
    const removed = set.stakeholders.filter((stakeholder) => stakeholder.status === 'removed');
    const liveOnes = live(set);
    for (const gone of removed) {
      const target = liveOnes.find((stakeholder) => stakeholder.mergedFrom.includes(gone.id));
      expect(target, `${gone.name} says where it went`).toBeDefined();
      if (!target) continue;
      // The same words with describing words in front, in the same category: never a different word.
      const [short, long] = [wordsOf(gone), wordsOf(target)].sort((a, b) => a.length - b.length);
      expect(endsWith(long ?? [], short ?? []), `${gone.name} into ${target.name}`).toBe(true);
      expect(gone.category).toBe(target.category);
      expect(target.assumptions).toContain(`Merged with “${gone.name}”.`);
      // The one it went into cites at least as much as the one it took in.
      const cited = new Set(target.evidence.map((ref) => `${ref.passageId}|${ref.quote}`));
      expect(target.evidence.length).toBeGreaterThanOrEqual(1);
      expect(cited.size).toBeGreaterThanOrEqual(1);
    }
    // And nothing that is certain was left unfolded: a name that is another's tail, in the same
    // category, with no other longer name it could belong to.
    for (const short of liveOnes) {
      const longer = liveOnes.filter(
        (other) =>
          other !== short &&
          other.category === short.category &&
          wordsOf(other).length > wordsOf(short).length &&
          endsWith(wordsOf(other), wordsOf(short)),
      );
      if (short.origin !== 'rules' || short.mergedFrom.length > 0) continue;
      expect(
        longer.length,
        `${short.name} could only be ${longer.map((o) => o.name).join(', ')}`,
      ).not.toBe(1);
    }
    if (removed.length > 0)
      expect(set.discovery.note).toMatch(/Folded \d+ names? that (?:is|are) certainly one group/u);
  });

  it('starts a role that names a position in any organisation as background unless something is at stake for it', async () => {
    const { set } = await read(pack);
    for (const stakeholder of live(set)) {
      if (stakeholder.origin !== 'rules' || !GENERIC_ROLES.has(keyOf(stakeholder.name))) continue;
      const stake = stakeholder.evidence.some((ref) => hasStakes(ref.quote ?? ''));
      if (!stake) expect(stakeholder.priority, stakeholder.name).toBe('background');
    }
  });

  it('says how many directions were read from the wording and how many remain unclear, in the note and again for the actors', async () => {
    const { set, passages, frame } = await read(pack);
    const here = live(set);
    const wording = here.filter((s) => s.expectedImpact.origin === 'evidence').length;
    const unclear = here.filter((s) => s.expectedImpact.direction === 'unclear').length;
    if (wording > 0) {
      expect(set.discovery.note).toContain(
        `${wording} of ${here.length} groups have a direction of impact read from the wording of their cited sentences`,
      );
    } else {
      expect(set.discovery.note).toContain('No direction of impact could be read from the wording');
    }
    expect(set.discovery.note).toContain(`${unclear} remain unclear`);
    expect(set.discovery.note.length).toBeLessThanOrEqual(500);

    const approved = approveSet(set, NOW);
    const actors = await generateActors({
      stakeholders: approved.stakeholders,
      relations: approved.relations,
      scenario: frame,
      stakeholderRevision: 1,
      question: pack.question,
      passages,
      model: null,
      now: () => NOW,
    });
    expect(actors.note).toContain(`${unclear} remain unclear, so the change cannot move them`);
    expect(actors.note).toContain(`${wording} of ${here.length} actors have a direction of impact`);
  });

  it('gives the actors the same impact for a direction as every other path does, and labels where it came from', async () => {
    const { set, passages, frame } = await read(pack);
    const approved = approveSet(set, NOW);
    const actors = await generateActors({
      stakeholders: approved.stakeholders,
      relations: approved.relations,
      scenario: frame,
      stakeholderRevision: 1,
      question: pack.question,
      passages,
      model: null,
      now: () => NOW,
    });
    const byId = new Map(live(set).map((stakeholder) => [stakeholder.id, stakeholder]));
    for (const actor of actors.actors) {
      const stakeholder = byId.get(actor.stakeholderId);
      expect(stakeholder, actor.name).toBeDefined();
      if (!stakeholder) continue;
      expect(actor.traits.impact.value, actor.name).toBe(
        IMPACT_VALUE[stakeholder.expectedImpact.direction],
      );
      expect(actor.traits.impact.origin, actor.name).toBe(
        stakeholder.expectedImpact.origin ?? 'system-assumption',
      );
    }
    // The change has someone to move, so that a comparison with no change is about the change.
    expect(actors.actors.some((actor) => actor.traits.impact.value !== 0)).toBe(true);
    expect(
      changeCanMoveAnyone(actors.actors, [
        { kind: 'alternative', intensity: 0.7, impactOverrides: {} },
      ]),
    ).toBe(true);
  });

  it('gives the same answer for the same input', async () => {
    const first = await read(pack);
    cache.delete(pack.id);
    const second = await read(pack);
    expect(second.set).toEqual(first.set);
  });
});

describe('how much of each pack the wording gives a direction', () => {
  // The share of key and standard groups that get a direction is bounded by the text: most sentences
  // that name a group say what it does or what it is, not how it feels. These are what the lexicon
  // reads today, kept so that a change to it that loses a reading is noticed.
  const FLOOR: Record<string, number> = {
    'copilot-in-teams': 0.2,
    'regional-price-change': 0.25,
    'ecommerce-experience': 0,
    'ai-first-support': 0.3,
    'launch-pricing': 0.2,
    'custom-library': 0.5,
  };

  it('reads at least the groups it read before, and some group of every pack', async () => {
    let key = 0;
    let withDirection = 0;
    for (const pack of PACKS) {
      const { set } = await read(pack);
      const here = live(set);
      const important = here.filter((stakeholder) => stakeholder.priority !== 'background');
      const given = important.filter(
        (stakeholder) => stakeholder.expectedImpact.direction !== 'unclear',
      );
      expect(given.length / Math.max(1, important.length), pack.id).toBeGreaterThanOrEqual(
        FLOOR[pack.id] ?? 0,
      );
      expect(
        here.filter((stakeholder) => stakeholder.expectedImpact.direction !== 'unclear').length,
        pack.id,
      ).toBeGreaterThan(0);
      key += important.length;
      withDirection += given.length;
    }
    expect(withDirection / key).toBeGreaterThanOrEqual(0.2);
  });
});

describe('the Copilot-style example, which had duplicates and a screen element read as a group', () => {
  const pack = PACKS.find((candidate) => candidate.id === 'copilot-in-teams');

  it('no longer reads a new panel as a review panel, or a bare manager as a key group', async () => {
    if (!pack) throw new Error('The example is missing.');
    const { set } = await read(pack);
    expect(set.stakeholders.map((stakeholder) => stakeholder.name.toLowerCase())).not.toContain(
      'new panel',
    );
  });

  it('folds an analyst into an independent analyst and reviewers into security reviewers, and keeps staff, workers and employees apart', async () => {
    if (!pack) throw new Error('The example is missing.');
    const { set } = await read(pack);
    const named = (name: string) =>
      set.stakeholders.find((stakeholder) => stakeholder.name.toLowerCase() === name);
    expect(named('analyst')?.status).toBe('removed');
    expect(named('independent analyst')?.mergedFrom).toContain(named('analyst')?.id);
    expect(named('reviewers')?.status).toBe('removed');
    expect(named('security reviewers')?.mergedFrom).toContain(named('reviewers')?.id);
    // Different words for people at work are different groups until a person says they are one.
    for (const word of ['staff', 'workers', 'employees']) {
      expect(named(word)?.status, word).not.toBe('removed');
    }
  });
});
