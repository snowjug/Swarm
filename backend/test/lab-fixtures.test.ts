import { describe, expect, it } from 'vitest';
import { actorSetSchema, stakeholderSetSchema } from '../../shared/stakeholders.js';
import { analysisSchema } from '../../shared/analysis.js';
import {
  actorSetFixture,
  analysisFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../shared/lab-fixtures.js';
import { artifactSchemas } from '../../shared/artifacts.js';

describe('the shared fixtures', () => {
  it('are valid for every schema they stand for, and fresh on every call', () => {
    expect(() => artifactSchemas.scenario.parse(scenarioFixture())).not.toThrow();
    expect(() => stakeholderSetSchema.parse(stakeholderSetFixture())).not.toThrow();
    expect(() => actorSetSchema.parse(actorSetFixture())).not.toThrow();
    expect(() => analysisSchema.parse(analysisFixture())).not.toThrow();
    const one = analysisFixture();
    one.findings.length = 0;
    expect(analysisFixture().findings.length).toBeGreaterThan(0);
  });

  it('keep every response share set at a total of one', () => {
    for (const run of analysisFixture().variants.flatMap((variant) => variant.runs)) {
      const total = Object.values(run.responseShares).reduce((sum, share) => sum + share, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });
});
