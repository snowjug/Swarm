import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = new URL('../src/simulation/', import.meta.url);
const sources = readdirSync(directory)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(new URL(name, directory), 'utf8') }));

/**
 * The engine knows stakeholder categories and generic signals, and nothing about any market, product
 * or industry. This is a guard, not a proof: a new word that names a scenario belongs in a scenario.
 */
const SCENARIO_WORDS =
  /\b(?:AWS|Azure|Teams|Copilot|Microsoft|price|prices|pricing|checkout|customer|customers|e-?commerce|shop|shopper|retail|cart|subscriber|subscribers|subscription|churn|revenue|conversion|employee|employees|student|students|patient|patients|ferry|clinic|bus|bank|cloud|region|website|webpage)\b/iu;

describe('the simulator source', () => {
  it('has the modules the design names', () => {
    expect(sources.map((source) => source.name).sort()).toEqual([
      'dynamics.ts',
      'parameters.ts',
      'population.ts',
      'random.ts',
      'responders.ts',
      'response.ts',
      'signals.ts',
      'simulate.ts',
    ]);
  });

  it('contains no word that belongs to a scenario, in code, comments or messages', () => {
    for (const source of sources) {
      const found = SCENARIO_WORDS.exec(source.text)?.[0];
      expect(found, `${source.name} mentions "${found}"`).toBeUndefined();
    }
  });

  it('does not reach for the network, the file system, a clock or Math.random', () => {
    for (const source of sources) {
      expect(source.text, source.name).not.toMatch(
        /Math\.random|Date\.now|new Date|performance\.now|process\.env|from 'node:|fetch\(/u,
      );
    }
  });
});
