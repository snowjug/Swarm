import { describe, expect, it } from 'vitest';
import { validateEntry } from '../lib/entryValidation';
import { sampleInput } from './sample';

// The sample is made the way any exploration is made, on the engine that needs no model.

describe('the sample project', () => {
  it('is a valid new exploration on the rules engine, guided like any other, with invented evidence and nothing else', () => {
    const input = sampleInput();
    expect(validateEntry(input).error).toBeUndefined();
    expect(input.settings).toMatchObject({ mode: 'local', agentCount: 12, rounds: 8, seed: 42 });
    expect(input.workflow).toBe('guided');
    expect(input.name).toBe('Sample: Launch pricing');
    expect(input.name.length).toBeLessThanOrEqual(100);
    expect(input.documents.length).toBeGreaterThan(0);
    expect(input).not.toHaveProperty('scenario');
    expect(input).not.toHaveProperty('research');
    for (const document of input.documents) {
      expect(document.provenance).toMatchObject({ kind: 'sample' });
    }
  });
});
