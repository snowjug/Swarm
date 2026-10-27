import { describe, expect, it } from 'vitest';
import type { ChapterClaim, ClaimChecks, ClaimKind } from '../../shared/grounding.js';
import { buildApp } from '../src/app.js';
import {
  PARTIAL_OVERLAP,
  SUPPORTED_OVERLAP,
  checkClaim,
  decideVerdict,
  recordedFigures,
  type VerificationContext,
} from '../src/grounding/verify.js';
import { fixtureInput, testConfig } from './fixtures.js';

const SENTENCE =
  'The City Transit Office proposes a six-month electric bus pilot with lower fares.';
const context = (overrides: Partial<VerificationContext> = {}): VerificationContext => ({
  passages: new Map([
    ['S1', `${SENTENCE} Fares fall by 20% during the 6 months. The budget is 1,200 dollars.`],
    ['S2', 'Neighborhood groups ask for accessible stops and clear information.'],
  ]),
  memories: new Map([['M1', 'Proxy 3 replied to Proxy 1 and moved toward support of the pilot.']]),
  recorded: new Set(['0.35', '35', '4', '8', '12']),
  ...overrides,
});

const claim = (overrides: Partial<ChapterClaim> = {}): ChapterClaim => ({
  text: SENTENCE,
  kind: 'source-fact',
  sourceIds: ['S1'],
  memoryIds: [],
  quote: 'proposes a six-month electric bus pilot with lower fares',
  ...overrides,
});

const checks = (overrides: Partial<ClaimChecks> = {}): ClaimChecks => ({
  quote: null,
  overlap: null,
  numbers: null,
  entailment: null,
  ...overrides,
});

describe('checkClaim (deterministic checks)', () => {
  it('verifies a verbatim quote and the overlap of a source fact', () => {
    expect(checkClaim(claim(), context())).toEqual({
      quote: 'found',
      overlap: 1,
      numbers: null,
      entailment: null,
    });
  });

  it('reports a quote that is not in the cited passage, even if another passage has it', () => {
    const result = checkClaim(claim({ sourceIds: ['S2'] }), context());
    expect(result.quote).toBe('not-found');
  });

  it('reports no quote when none was supplied', () => {
    expect(checkClaim(claim({ quote: null }), context()).quote).toBeNull();
  });

  it('measures overlap against the cited passages only', () => {
    const lowOverlap = checkClaim(
      claim({ text: 'Quantum blockchain synergy unlocks galactic harmony.', quote: null }),
      context(),
    );
    expect(lowOverlap.overlap).toBe(0);
    expect(checkClaim(claim({ sourceIds: [], quote: null }), context()).overlap).toBe(0);
  });

  it('compares figures in a source claim with the cited passage', () => {
    expect(
      checkClaim(claim({ text: 'Fares fall by 20% during the 6 months.', quote: null }), context())
        .numbers,
    ).toBe('match');
    expect(
      checkClaim(claim({ text: 'Fares fall by 35% during the 6 months.', quote: null }), context())
        .numbers,
    ).toBe('mismatch');
    expect(
      checkClaim(claim({ text: 'The budget is 1200 dollars.', quote: null }), context()).numbers,
    ).toBe('match');
  });

  it('checks an analytical conclusion’s figures against the recorded simulation data', () => {
    const base = claim({ kind: 'analytical-conclusion', sourceIds: [], quote: null });
    expect(
      checkClaim({ ...base, text: 'The final mean was 0.35 after 8 rounds.' }, context()).numbers,
    ).toBe('match');
    expect(checkClaim({ ...base, text: 'Support rose by 73% overall.' }, context()).numbers).toBe(
      'mismatch',
    );
    expect(
      checkClaim({ ...base, text: 'Views diverged between the platforms.' }, context()).numbers,
    ).toBeNull();
  });

  it('checks a simulated event against the cited memory and the recorded figures', () => {
    const event = claim({
      kind: 'simulated-event',
      sourceIds: [],
      memoryIds: ['M1'],
      quote: null,
      text: 'Proxy 3 replied to Proxy 1 and moved toward support.',
    });
    const result = checkClaim(event, context());
    expect(result.overlap).toBeGreaterThanOrEqual(SUPPORTED_OVERLAP);
    expect(result.numbers).toBe('match');
    expect(checkClaim({ ...event, text: 'Proxy 3 gained 91 followers.' }, context()).numbers).toBe(
      'mismatch',
    );
  });

  it.each<ClaimKind>(['ai-hypothesis', 'user-assumption'])(
    'does not try to verify a %s',
    (kind) => {
      const result = checkClaim(
        claim({ kind, text: 'Maybe 99% of residents will love it.', sourceIds: [], quote: null }),
        context(),
      );
      expect(result).toEqual({ quote: null, overlap: null, numbers: null, entailment: null });
    },
  );
});

describe('decideVerdict (the decision table)', () => {
  type Row = [
    name: string,
    kind: ClaimKind,
    input: Partial<ClaimChecks>,
    expected: string,
    opts?: Partial<ChapterClaim>,
  ];
  const rows: Row[] = [
    ['an AI hypothesis is never verified', 'ai-hypothesis', {}, 'unchecked'],
    ['a user assumption is never verified', 'user-assumption', {}, 'unchecked'],
    [
      'a conclusion with no figure is an interpretation',
      'analytical-conclusion',
      { numbers: null },
      'unchecked',
    ],
    [
      'a conclusion whose figures are recorded',
      'analytical-conclusion',
      { numbers: 'match' },
      'supported',
    ],
    [
      'a conclusion with an unrecorded figure',
      'analytical-conclusion',
      { numbers: 'mismatch' },
      'unsupported',
    ],
    [
      'an event with no memory',
      'simulated-event',
      { overlap: 0.9 },
      'unsupported',
      { memoryIds: [] },
    ],
    [
      'an event matching its memory',
      'simulated-event',
      { overlap: 0.6 },
      'supported',
      { memoryIds: ['M1'] },
    ],
    [
      'an event partly matching its memory',
      'simulated-event',
      { overlap: 0.3 },
      'partial',
      { memoryIds: ['M1'] },
    ],
    [
      'an event not matching its memory',
      'simulated-event',
      { overlap: 0.1 },
      'unsupported',
      { memoryIds: ['M1'] },
    ],
    [
      'an event with an unrecorded figure',
      'simulated-event',
      { overlap: 0.6, numbers: 'mismatch' },
      'partial',
      { memoryIds: ['M1'] },
    ],
    [
      'a source fact with no source',
      'source-fact',
      { quote: 'found', overlap: 1 },
      'unsupported',
      { sourceIds: [] },
    ],
    [
      'a source fact, quote found, words match, model agrees',
      'source-fact',
      { quote: 'found', overlap: 0.9, entailment: 'supports' },
      'supported',
    ],
    [
      'a source fact verified by quote and words only',
      'source-fact',
      { quote: 'found', overlap: 0.9 },
      'supported',
    ],
    [
      'a source fact whose quote is not in the passage',
      'source-fact',
      { quote: 'not-found', overlap: 1, entailment: 'supports' },
      'unsupported',
    ],
    [
      'a source fact with no quote at all',
      'source-fact',
      { quote: null, overlap: 1, entailment: 'supports' },
      'partial',
    ],
    [
      'a source fact the model says is contradicted',
      'source-fact',
      { quote: 'found', overlap: 1, entailment: 'contradicts' },
      'contradicted',
    ],
    [
      'a source fact the model says is not addressed',
      'source-fact',
      { quote: 'found', overlap: 1, entailment: 'not-supported' },
      'unsupported',
    ],
    [
      'a source fact only partly confirmed',
      'source-fact',
      { quote: 'found', overlap: 1, entailment: 'partial' },
      'partial',
    ],
    [
      'a source fact with a wrong figure',
      'source-fact',
      { quote: 'found', overlap: 1, numbers: 'mismatch' },
      'partial',
    ],
    [
      'a source fact with a wrong figure and low overlap',
      'source-fact',
      { quote: 'found', overlap: 0.3, numbers: 'mismatch' },
      'unsupported',
    ],
    ['a paraphrase with strong overlap', 'extracted-claim', { overlap: 0.7 }, 'supported'],
    [
      'a paraphrase with moderate overlap, unchecked by a model',
      'extracted-claim',
      { overlap: 0.3 },
      'partial',
    ],
    [
      'a paraphrase with moderate overlap confirmed by the model',
      'extracted-claim',
      { overlap: 0.3, entailment: 'supports' },
      'supported',
    ],
    ['a paraphrase with little overlap', 'extracted-claim', { overlap: 0.1 }, 'unsupported'],
    [
      'a paraphrase with a fabricated quote',
      'extracted-claim',
      { quote: 'not-found', overlap: 0.9 },
      'unsupported',
    ],
    [
      'a paraphrase the model contradicts',
      'extracted-claim',
      { overlap: 0.9, entailment: 'contradicts' },
      'contradicted',
    ],
    [
      'a paraphrase with partial model support',
      'extracted-claim',
      { overlap: 0.9, entailment: 'partial' },
      'partial',
    ],
  ];

  it.each(rows)('%s -> %s', (_name, kind, input, expected, opts) => {
    const subject = { kind, sourceIds: ['S1'], memoryIds: [] as string[], ...opts };
    expect(decideVerdict(subject, checks(input)).verdict).toBe(expected);
  });

  it('gives a human-readable reason for every verdict', () => {
    for (const [, kind, input, , opts] of rows) {
      const { reason } = decideVerdict(
        { kind, sourceIds: ['S1'], memoryIds: [], ...opts },
        checks(input),
      );
      expect(reason.length).toBeGreaterThan(15);
      expect(reason).toMatch(/[.]$/);
    }
  });

  it('never lets a model judgement create support without any lexical anchor', () => {
    for (const kind of ['source-fact', 'extracted-claim'] as const) {
      const decision = decideVerdict(
        { kind, sourceIds: ['S1'], memoryIds: [] },
        checks({
          quote: kind === 'source-fact' ? 'found' : null,
          overlap: 0,
          entailment: 'supports',
        }),
      );
      expect(decision.verdict).not.toBe('supported');
      expect(decision.reason).toContain('shares few words');
    }
  });

  it('says plainly when no model check ran', () => {
    const decision = decideVerdict(
      { kind: 'extracted-claim', sourceIds: ['S1'], memoryIds: [] },
      checks({ overlap: 0.8 }),
    );
    expect(decision.verdict).toBe('supported');
    expect(decision.reason).toContain('no independent model check ran');
  });

  it('uses the documented overlap thresholds', () => {
    expect(SUPPORTED_OVERLAP).toBe(0.5);
    expect(PARTIAL_OVERLAP).toBe(0.25);
    const at = (overlap: number) =>
      decideVerdict(
        { kind: 'extracted-claim', sourceIds: ['S1'], memoryIds: [] },
        checks({ overlap }),
      ).verdict;
    expect(at(0.5)).toBe('supported');
    expect(at(0.4999)).toBe('partial');
    expect(at(0.25)).toBe('partial');
    expect(at(0.2499)).toBe('unsupported');
  });
});

describe('recordedFigures', () => {
  it('contains the recorded metrics in the ways a writer would render them, and nothing invented', async () => {
    const instance = await buildApp({ config: testConfig() });
    try {
      const project = instance.repository.create(fixtureInput());
      instance.jobs.enqueue(project.id);
      await instance.jobs.idle();
      const finished = instance.repository.get(project.id);
      const metrics = finished.report!.metrics;
      const figures = recordedFigures(finished, metrics);
      const has = (value: string) => figures.has(value.replace(/0+$/u, '').replace(/\.$/u, ''));
      expect(has(Math.abs(metrics.finalMean).toFixed(2))).toBe(true);
      expect(has((metrics.finalSupport * 100).toFixed(0))).toBe(true);
      expect(figures.has(String(metrics.totalInteractions))).toBe(true);
      expect(figures.has(String(finished.settings.agentCount))).toBe(true);
      // Round and proxy numbers appear in prose ("round 3") and are not statistics.
      expect(figures.has('3')).toBe(true);
      expect(figures.has('9137')).toBe(false);
    } finally {
      await instance.app.close();
    }
  });
});
