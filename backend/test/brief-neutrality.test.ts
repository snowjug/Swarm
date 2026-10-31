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
      readFileSync(join(root, file), 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          DOMAIN.test(line.replaceAll('name="robots"', ''))
            ? [`${file}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
    expect(found).toEqual([]);
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
