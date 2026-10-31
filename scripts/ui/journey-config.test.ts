import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('the live presentation config', () => {
  // `npm run demo:journey` runs this config against a server that is already up. The other specs in
  // e2e/journey (the themes, the report studio) start from the throwaway server and data of
  // playwright.config.ts and fail at once without them, so they must not be picked up here.
  const text = readFileSync(resolve(ROOT, 'playwright.journey.config.ts'), 'utf8');
  const pattern = /testMatch:\s*\/(.+?)\/u/u.exec(text)?.[1];

  it('says which spec it runs', () => {
    expect(pattern, 'playwright.journey.config.ts has a testMatch').toBeDefined();
  });

  it('runs the presentation and no other spec in the folder', () => {
    const matcher = new RegExp(pattern!, 'u');
    const specs = readdirSync(resolve(ROOT, 'e2e', 'journey')).filter((name) =>
      name.endsWith('.spec.ts'),
    );
    expect(specs).toContain('demo-journey.spec.ts');
    expect(specs.filter((name) => matcher.test(name))).toEqual(['demo-journey.spec.ts']);
  });
});
