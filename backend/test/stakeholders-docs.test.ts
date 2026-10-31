import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAKEHOLDER_CATEGORIES } from '../../shared/stakeholders.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import { SAMPLE_SIZE } from '../src/stakeholders/actors.js';
import { MAX_AGENTS, MIN_AGENTS } from '../src/stakeholders/agents.js';
import { CATEGORY_PRIORS, COHORT_SPREAD, IMPACT_VALUE } from '../src/stakeholders/priors.js';
import { MAX_DISCOVERED, MAX_KEY, PLACEHOLDER_SIZE } from '../src/stakeholders/rules.js';

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
  });

  it('lists exactly the routes the server has, with the role each needs', () => {
    const rows = [
      ...doc.matchAll(/^\|\s*`(GET|POST|PUT)\s+(\/[a-z/]+)`\s*\|\s*(read|run|edit)\s*\|/gmu),
    ];
    expect(rows).toHaveLength(7);
    for (const [, method, path, capability] of rows) {
      const key = `${method} /api/projects/:id${path}`;
      expect(ROUTE_POLICY[key], key).toEqual({ kind: 'project', capability });
    }
    const served = Object.keys(ROUTE_POLICY).filter((key) =>
      /\/api\/projects\/:id\/(?:stakeholders|actors)/u.test(key),
    );
    expect(served).toHaveLength(7);
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
      ]),
    );
    const source = [
      'backend/src/routes/stakeholders.ts',
      'backend/src/stakeholders/review.ts',
      'backend/src/stakeholders/actors.ts',
    ]
      .map(read)
      .join('\n');
    for (const code of codes) expect(source, code).toContain(`'${code}'`);
  });
});
