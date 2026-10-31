import { describe, expect, it } from 'vitest';
import type { ExampleScenario } from '../../../shared/example-scenarios';
import type { AppConfig } from '../../../shared/types';
import {
  PIPELINE,
  POSITIONING_STATEMENT,
  WHAT_IF_LINE,
  exampleEvidence,
  urlIngestionEnabled,
} from './product';

const example = (kinds: ('sample' | 'url' | 'historical')[]): ExampleScenario => ({
  id: 'example',
  title: 'An example',
  blurb: 'A short line about the example.',
  question: 'What could happen if the example changes?',
  documents: kinds.map((kind, index) => ({
    name: `evidence-${index}.md`,
    content: 'Synthetic evidence text, long enough to stand for a document in this test.',
    provenance: { kind },
  })),
});

describe('what the entry screen says about the product', () => {
  it('states in the exact words that Swarm explores and does not guarantee or predict', () => {
    expect(POSITIONING_STATEMENT).toBe(
      'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
    );
  });

  it('leads with the question the product answers', () => {
    expect(WHAT_IF_LINE).toBe('What could happen if…?');
  });

  it('draws the path from evidence to a decision in order', () => {
    expect(PIPELINE.map((step) => step.label)).toEqual([
      'Evidence',
      'Scenario',
      'Stakeholders',
      'Actors',
      'Interactions',
      'Alternative outcomes',
      'Analysis',
      'Decision',
    ]);
  });

  it('describes each step in a few words, and never promises a real-world outcome', () => {
    for (const step of PIPELINE) {
      expect(step.caption.length).toBeGreaterThan(8);
      expect(step.caption.length).toBeLessThan(45);
      expect(step.caption).not.toMatch(/predict|forecast|guarantee|will happen/iu);
    }
    expect(PIPELINE.find((step) => step.label === 'Actors')?.caption).toMatch(/never real people/u);
  });
});

describe('what an example brings, in words', () => {
  it('counts the documents and names where the evidence comes from, once each', () => {
    expect(exampleEvidence(example(['sample']))).toBe('1 document · sample evidence');
    expect(exampleEvidence(example(['sample', 'url', 'sample']))).toBe(
      '3 documents · sample evidence, public web page',
    );
    expect(exampleEvidence(example(['historical']))).toBe('1 document · historical record');
  });
});

describe('whether the page may offer to fetch a public web page', () => {
  const config = (extra: object): AppConfig => extra as AppConfig;

  it('does only when the server says so', () => {
    expect(urlIngestionEnabled(config({ urlIngestion: true }))).toBe(true);
    expect(urlIngestionEnabled(config({ urlIngestion: false }))).toBe(false);
  });

  it('does not when the server says nothing, or there is no configuration yet', () => {
    expect(urlIngestionEnabled(config({}))).toBe(false);
    expect(urlIngestionEnabled(config({ urlIngestion: 'yes' }))).toBe(false);
    expect(urlIngestionEnabled(null)).toBe(false);
  });
});
