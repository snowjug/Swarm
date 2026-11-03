import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import {
  MAX_PROPOSED_LIVE,
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  ROLE_CATEGORIES,
  STAKEHOLDER_CATEGORIES,
} from '../../shared/stakeholders.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import { SAMPLE_SIZE } from '../src/stakeholders/actors.js';
import { MAX_AGENTS, MIN_AGENTS } from '../src/stakeholders/agents.js';
import { MAX_PER_ROLE, MAX_RULES_PARTICIPANTS } from '../src/stakeholders/participants/build.js';
import { RULE_CATALOGUE } from '../src/stakeholders/participants/validate.js';
import { CATEGORY_PRIORS, COHORT_SPREAD, IMPACT_VALUE } from '../src/stakeholders/priors.js';
import { MAX_DISCOVERED, MAX_KEY, PLACEHOLDER_SIZE } from '../src/stakeholders/rules.js';
import { PACK_TABLE_HEADER, packTableRows } from './support/pack-table.js';

// The page says what the numbers are. These checks hold it to the code, so that a number changed in one
// place and not the other fails here instead of misleading a reader.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string =>
  readFileSync(`${root}${path}`, 'utf8').replaceAll('\r\n', '\n');
const doc = read('docs/stakeholders.md');
const flat = doc.replace(/\s+/gu, ' ');

const TRAIT_ORDER = [
  'influence',
  'openness',
  'sensitivity',
  'riskTolerance',
  'switchingCost',
  'trust',
  'adoptionTendency',
  'authority',
  'reactivity',
] as const;

describe('docs/stakeholders.md and the code agree', () => {
  it('prints the category prior table of the code, category by category and trait by trait', () => {
    const rows = [...doc.matchAll(/^\|\s*([a-z-]+)\s*\|((?:\s*[\d.]+\s*\|){9})\s*$/gmu)].map(
      (match) => ({
        category: match[1]!,
        values: match[2]!
          .split('|')
          .map((cell) => cell.trim())
          .filter(Boolean)
          .map(Number),
      }),
    );
    expect(rows.map((row) => row.category)).toEqual([...STAKEHOLDER_CATEGORIES]);
    for (const row of rows) {
      const prior = CATEGORY_PRIORS[row.category as keyof typeof CATEGORY_PRIORS];
      expect(row.values, row.category).toHaveLength(TRAIT_ORDER.length);
      TRAIT_ORDER.forEach((trait, index) => {
        expect(row.values[index], `${row.category} ${trait}`).toBeCloseTo(prior.traits[trait], 5);
      });
    }
  });

  it('states the sizes, limits and spreads the code uses', () => {
    const claims = [
      `${PLACEHOLDER_SIZE.key} for a key actor, ${PLACEHOLDER_SIZE.standard} for a standard cohort, ${PLACEHOLDER_SIZE.background} for a background one`,
      `At most ${MAX_DISCOVERED} stakeholders are proposed`,
      `at most eight in all`,
      `at most ${SAMPLE_SIZE.standard} for a standard cohort and ${SAMPLE_SIZE.background} for a background one`,
      `(${COHORT_SPREAD} for every trait)`,
      `harmed −${Math.abs(IMPACT_VALUE.harmed)}, benefited +${IMPACT_VALUE.benefited}, mixed −${Math.abs(IMPACT_VALUE.mixed)}, unclear ${IMPACT_VALUE.unclear}`,
      `at most **${MAX_AGENTS.local}** agents in the local rules mode and **${MAX_AGENTS.llm}** in model mode`,
      `at least **${MIN_AGENTS}** agents`,
    ];
    expect(MAX_KEY).toBe(8);
    for (const claim of claims) expect(flat, claim).toContain(claim);
    // The limits of a proposal, as the code holds them.
    const words: Record<number, string> = { 6: 'six', 16: 'sixteen', 25: 'twenty-five' };
    expect(flat).toContain(`one role may hold at most ${words[MAX_PER_ROLE]}`);
    expect(flat).toContain(`the rules path keeps at most ${words[MAX_RULES_PARTICIPANTS]}`);
    expect(flat).toContain(`a model's proposal ${words[MAX_PROPOSED_LIVE]}`);
  });

  it('lists exactly the routes the server has, with the role each needs', () => {
    const rows = [
      ...doc.matchAll(
        /^\|\s*`(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z:/-]+)`\s*\|\s*(read|run|edit)\s*\|/gmu,
      ),
    ];
    expect(rows).toHaveLength(16);
    for (const [, method, path, capability] of rows) {
      const key = `${method} /api/projects/:id${path}`;
      expect(ROUTE_POLICY[key], key).toEqual({ kind: 'project', capability });
    }
    const served = Object.keys(ROUTE_POLICY).filter((key) =>
      /\/api\/projects\/:id\/(?:stakeholders|actors)/u.test(key),
    );
    expect(served).toHaveLength(16);
  });

  it('names only error codes that the code can answer with', () => {
    const section = doc.slice(
      doc.indexOf('## Routes and roles'),
      doc.indexOf('## What this does not do'),
    );
    const codes = [...section.matchAll(/`([A-Z][A-Z_]{5,})`/gu)].map((match) => match[1]!);
    expect(codes).toEqual(
      expect.arrayContaining([
        'ARTIFACT_CONFLICT',
        'STAKEHOLDERS_REVIEWED',
        'ACTORS_EDITED',
        'STAKEHOLDERS_NOT_APPROVED',
        'MODEL_NOT_AVAILABLE',
        'STAKEHOLDERS_TOO_FEW',
        'STAKEHOLDERS_BUSY',
        'PARTICIPANTS_INVALID',
        'PARTICIPANT_NOT_FOUND',
        'NO_DUPLICATES',
      ]),
    );
    const source = [
      'backend/src/routes/stakeholders.ts',
      'backend/src/stakeholders/review.ts',
      'backend/src/stakeholders/actors.ts',
      'backend/src/stakeholders/participants/operations.ts',
    ]
      .map(read)
      .join('\n');
    for (const code of codes) expect(source, code).toContain(`'${code}'`);
  });

  it('prints the rule catalogue of the code, rule by rule, with the severity of each for a proposed set and for an older one', () => {
    const rows = [
      ...doc.matchAll(
        /^\|\s*`([a-z-]+)`\s*\|\s*(blocking|advisory)\s*\|\s*(blocking|advisory|none)\s*\|/gmu,
      ),
    ].map((match) => [match[1], match[2], match[3]]);
    expect(rows).toEqual(
      Object.entries(RULE_CATALOGUE).map(([code, rule]) => [
        code,
        rule.strict,
        rule.legacy ?? 'none',
      ]),
    );
  });

  it('prints the roles of the taxonomy, with the category each starts as', () => {
    for (const role of PARTICIPANT_ROLES) {
      const label = PARTICIPANT_ROLE_LABELS[role].toLowerCase();
      const category = ROLE_CATEGORIES[role][0]!;
      const row = new RegExp(`^\\|\\s*${label}\\s*\\|\\s*${category}\\s*\\|`, 'mu');
      expect(doc, role).toMatch(row);
    }
  });

  it('prints what reading the text finds on each example, as the code finds it', async () => {
    // The table is made by running the discovery: if the reading, the examples or the chunker change what
    // is found, `npx tsx backend/test/support/print-pack-table.ts` prints the table to put here.
    const section = doc.slice(
      doc.indexOf('### What it finds on the examples'),
      doc.indexOf('## Categories are a lens'),
    );
    const table = [...section.matchAll(/^\|(.+)\|[ \t]*$/gmu)].map((match) =>
      match[1]!.split('|').map((cell) => cell.trim()),
    );
    expect(table[0], 'the header').toEqual([...PACK_TABLE_HEADER]);
    expect(table[1]?.every((cell) => /^-+$/u.test(cell))).toBe(true);
    expect(table.slice(2), 'one row for each example, as the code finds them').toEqual(
      await packTableRows(),
    );
    expect(table.slice(2)).toHaveLength(EXAMPLE_SCENARIOS.length);
  });

  it('says that the table is made by the code, and what the rules cannot do', () => {
    expect(flat).toContain('a test fails if this table and the code disagree');
    expect(flat).toContain('the words are counted, not understood');
    expect(flat).toContain('They do not find a group the sources describe without a role word');
  });
});
