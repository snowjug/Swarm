import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenarioFrameSchema } from '../../shared/scenario.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { discoverStakeholders } from '../src/stakeholders/discover.js';
import { BRIEFS } from './support/stakeholder-briefs.js';

// Stakeholder discovery has to work for any subject. Nothing in the code that does it, and nothing it
// shows, may be written for one market, product or industry: the roles it knows are the roles any
// organisation has, and every name it produces comes from the text it was given.

const root = join(import.meta.dirname, '..', '..');

/** Everything this feature is made of that a person or a model reads or runs, tests excluded. */
const SOURCES = [
  'backend/src/stakeholders',
  'backend/src/routes/stakeholders.ts',
  'shared/stakeholders.ts',
  'frontend/src/components/stakeholders',
  'frontend/src/api/stakeholders.ts',
  'frontend/src/api/stakeholderFlows.ts',
  'frontend/src/hooks/useStakeholders.ts',
  'frontend/src/styles/stakeholders.css',
];

function filesOf(path: string): string[] {
  const full = join(root, path);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesOf(join(path, entry.name))
      : /\.(?:ts|tsx|css)$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)
        ? [join(full, entry.name)]
        : [],
  );
}

const BANNED_ANYWHERE = /\b(?:aws|azure|copilot|checkout|e-?commerce|pric(?:e|es|ed|ing))\b/iu;
const BANNED_AS_PRODUCT = /\bTeams\b/u;

describe('the code that finds stakeholders is written for no market or product', () => {
  const files = SOURCES.flatMap(filesOf);

  it('looks at a feature’s worth of files, and its patterns do catch what they are for', () => {
    expect(files.length).toBeGreaterThan(25);
    for (const word of [
      'AWS',
      'an Azure service',
      'Copilot',
      'checkout page',
      'e-commerce',
      'pricing',
    ]) {
      expect(word).toMatch(BANNED_ANYWHERE);
    }
    expect('Teams meeting').toMatch(BANNED_AS_PRODUCT);
    expect('operations teams').not.toMatch(BANNED_AS_PRODUCT);
  });

  it('names no product, platform, shop or pricing term in any of them', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const where = relative(root, file);
      expect(text, where).not.toMatch(BANNED_ANYWHERE);
      expect(text, where).not.toMatch(BANNED_AS_PRODUCT);
    }
  });

  it('writes no name of an organisation into its role lexicon: every entry is a lower-case common word', () => {
    const lexicon = readFileSync(join(root, 'backend/src/stakeholders/lexicon.ts'), 'utf8');
    const entries = [...lexicon.matchAll(/'([^'\n]{3,})'/gu)].map((match) => match[1]!);
    expect(entries.length).toBeGreaterThan(10);
    for (const entry of entries) {
      for (const word of entry.split(/[\s,;:()/-]+/u).filter(Boolean)) {
        expect(word, `${entry}: ${word}`).not.toMatch(/^\p{Lu}[\p{L}\p{N}]+$/u);
      }
    }
  });
});

describe('every name it produces comes from the text it was given', () => {
  const stems = (text: string): string[] =>
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .map((word) => word.replace(/s$/u, ''))
      .filter(Boolean);

  const found = BRIEFS.map(async (brief) => {
    const set = await discoverStakeholders({
      project: { question: brief.question, graph: null },
      scenario: scenarioFrameSchema.parse({
        decision: 'd',
        system: 's',
        baseline: 'b',
        likelyStakeholders: brief.hints,
        origin: 'user',
      }),
      passages: chunkDocuments([{ id: 'D1', name: 'brief.md', content: brief.document }]),
      model: null,
      now: () => new Date('2026-03-02T10:00:00.000Z'),
    });
    return { brief, names: set.stakeholders.map((stakeholder) => stakeholder.name) };
  });

  it.each(BRIEFS.map((brief, index) => [brief.id, index] as const))(
    'uses only words of the %s brief in the names of its stakeholders',
    async (_id, index) => {
      const { brief, names } = (await Promise.all(found))[index]!;
      const own = new Set(stems([brief.question, ...brief.hints, brief.document].join(' ')));
      expect(names.length, 'something was found').toBeGreaterThanOrEqual(2);
      for (const name of names) {
        for (const stem of stems(name)) expect(own, `${name}: ${stem}`).toContain(stem);
      }
    },
  );

  it('finds different stakeholders for different subjects: no name is common to all of the briefs', async () => {
    const all = (await Promise.all(found)).map(
      ({ names }) => new Set(names.map((name) => name.toLowerCase())),
    );
    expect(all.length).toBeGreaterThanOrEqual(5);
    const everywhere = [...(all[0] ?? [])].filter((name) => all.every((names) => names.has(name)));
    expect(everywhere).toEqual([]);
    const distinct = new Set(all.flatMap((names) => [...names]));
    expect(distinct.size).toBeGreaterThan(20);
  });
});
