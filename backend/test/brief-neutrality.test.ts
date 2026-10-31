import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The brief is domain-neutral: nothing it says, draws or documents belongs to a market, a product or
// an industry. The example scenarios are only inputs for the same engine. This reads the brief's own
// source (never its tests, which use abstract fixtures) and refuses a word that would tie it to one.
const root = fileURLToPath(new URL('../../', import.meta.url));

function filesIn(path: string): string[] {
  const full = join(root, path);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full).flatMap((entry) => filesIn(`${path}/${entry}`));
}

const OWN_SOURCE = [
  'backend/src/brief',
  'backend/src/routes/brief.ts',
  'shared/brief.ts',
  'frontend/src/components/brief',
  'frontend/src/api/brief.ts',
  'frontend/src/hooks/useBrief.ts',
  'frontend/src/styles/brief.css',
  'docs/analysis/brief.md',
]
  .flatMap(filesIn)
  .filter((file) => !/\.test\.tsx?$/u.test(file));

const DOMAIN_WORDS = [
  'price',
  'pricing',
  'fare',
  'tariff',
  'churn',
  'subscri',
  'checkout',
  'shopping',
  'e-?commerce',
  'retail',
  'copilot',
  'microsoft',
  'azure',
  'aws',
  'amazon',
  'clinic',
  'patient',
  'hospital',
  'student',
  'parking',
  'ferry',
  'transit',
  'warehouse',
  'robot',
  'library',
  'mortgage',
  'insurance',
  'airline',
];
const DOMAIN = new RegExp(`\\b(?:${DOMAIN_WORDS.join('|')})`, 'iu');

// The wording guard has to name the measures of the real world that it refuses a figure beside, and
// the people such a figure would count. Those words are its subject and not a domain, so the two lists
// that hold them (and nothing else in the file) are not read as the brief's own words.
const GUARD_VOCABULARY =
  /^export const (REAL_WORLD_MEASURES|REAL_PEOPLE)\b[^\n]*=\s*\[\n[\s\S]*?^\];$/gmu;
const sourceOf = (file: string): string => {
  const source = readFileSync(join(root, file), 'utf8');
  // Blanked, not cut out, so that a line is reported under its own number.
  return file === 'backend/src/brief/lint.ts'
    ? source.replace(GUARD_VOCABULARY, (list) => list.replace(/[^\n]/gu, ''))
    : source;
};

describe('the brief belongs to no domain', () => {
  it('finds the files it is meant to guard', () => {
    for (const expected of [
      'backend/src/brief/build.ts',
      'backend/src/brief/lint.ts',
      'backend/src/brief/recommend.ts',
      'backend/src/brief/validation.ts',
      'backend/src/brief/export.ts',
      'backend/src/routes/brief.ts',
      'shared/brief.ts',
      'frontend/src/components/brief/DecisionBriefView.tsx',
      'frontend/src/api/brief.ts',
      'frontend/src/styles/brief.css',
      'docs/analysis/brief.md',
    ]) {
      expect(OWN_SOURCE, expected).toContain(expected);
    }
    expect(OWN_SOURCE.length).toBeGreaterThan(20);
  });

  it('uses no word that belongs to one market, product, industry or vendor', () => {
    // The standard `robots` meta name of an HTML page is markup, not a subject.
    const found = OWN_SOURCE.flatMap((file) =>
      sourceOf(file)
        .split('\n')
        .flatMap((line, index) =>
          DOMAIN.test(line.replaceAll('name="robots"', ''))
            ? [`${file}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
    expect(found).toEqual([]);
  });

  it('lets the wording guard name the measures of the real world it refuses a figure beside, in its two lists and nowhere else', () => {
    const file = 'backend/src/brief/lint.ts';
    const lists = [...readFileSync(join(root, file), 'utf8').matchAll(GUARD_VOCABULARY)];
    expect(lists.map((list) => list[1])).toEqual(['REAL_WORLD_MEASURES', 'REAL_PEOPLE']);
    // What is left of the guard has no such word in it, and neither has the rest of the brief.
    expect(DOMAIN.test(sourceOf(file))).toBe(false);
    // The lists are for a measure and the people it counts: of the market words they may hold only those.
    const inside = lists.flatMap((list) =>
      [...list[0].matchAll(new RegExp(DOMAIN.source, 'giu'))].map((word) => word[0].toLowerCase()),
    );
    expect(inside.length).toBeGreaterThan(0);
    for (const word of inside) {
      expect(['churn', 'subscri', 'patient', 'student'], word).toContain(word);
    }
  });

  it('writes its recommendations and checks from generic lenses, never from a list of answers for one case', () => {
    const recommend = readFileSync(join(root, 'backend/src/brief/recommend.ts'), 'utf8');
    const validation = readFileSync(join(root, 'backend/src/brief/validation.ts'), 'utf8');
    // The only things that vary are the trait and the kind of stakeholder, both generic taxonomies.
    expect(recommend).toContain('OWNER_BY_CATEGORY');
    expect(validation).toContain('TRAIT_CHECKS');
    expect(validation).toContain('gapCheckFor');
  });
});
