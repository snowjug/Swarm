import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { ChapterClaim } from '../../shared/grounding.js';
import { AppError } from '../src/errors.js';
import {
  ENTAILMENT_INSTRUCTIONS,
  judgeClaims,
  validateEntailment,
  type EntailmentItem,
} from '../src/grounding/entailment.js';
import {
  BODY_COVERAGE,
  reviewClaims,
  splitCoveredClaims,
  validateChapterClaims,
  type ChapterForReview,
} from '../src/grounding/review.js';
import type { VerificationContext } from '../src/grounding/verify.js';
import { ModelClient, type JsonOptions, type ModelGateway } from '../src/models/client.js';
import { testConfig } from './fixtures.js';
import { chatCompletion, entailmentBrain } from './support/model-brain.js';

const SENTENCE =
  'The City Transit Office proposes a six-month electric bus pilot with lower fares.';
const SECOND =
  'Neighborhood groups ask for accessible stops and clear information about the pilot.';
const QUOTE = 'proposes a six-month electric bus pilot with lower fares';

const context = (): VerificationContext => ({
  passages: new Map([
    ['S1', `${SENTENCE} Fares fall by 20 percent.`],
    ['S2', SECOND],
  ]),
  memories: new Map([['M1', 'Proxy 3 replied to Proxy 1 and moved toward support.']]),
  recorded: new Set(['0.35', '35', '4', '8']),
});

const claim = (overrides: Partial<ChapterClaim> = {}): ChapterClaim => ({
  text: SENTENCE,
  kind: 'source-fact',
  sourceIds: ['S1'],
  memoryIds: [],
  quote: QUOTE,
  ...overrides,
});

const chapter = (overrides: Partial<ChapterForReview> = {}): ChapterForReview => ({
  title: 'Evidence',
  body: `${SENTENCE} ${SECOND} Recorded platform views differ under their interaction rules.`,
  sourceIds: ['S1', 'S2'],
  memoryIds: [],
  claims: [claim()],
  ...overrides,
});

const noAbort = () => new AbortController().signal;

/** A gateway that answers with whatever `answer` returns and applies the caller's validator. */
function gateway(answer: (data: unknown) => unknown, calls: unknown[] = []): ModelGateway {
  return {
    async json<T>(
      schema: z.ZodType<T>,
      _instructions: string,
      data: unknown,
      _signal: AbortSignal,
      _maxTokens?: number,
      options?: JsonOptions<T>,
    ): Promise<T> {
      calls.push(data);
      const parsed = schema.parse(answer(data));
      options?.validate?.(parsed);
      return parsed;
    },
  };
}

describe('validateChapterClaims', () => {
  const ok = (value: Partial<ChapterForReview> = {}) =>
    validateChapterClaims({ ...chapter(), ...value }, context());

  it('accepts well-formed claims of every kind', () => {
    expect(() =>
      ok({
        claims: [
          claim(),
          claim({
            kind: 'extracted-claim',
            text: SECOND,
            quote: 'ask for accessible stops and clear information',
            sourceIds: ['S2'],
          }),
          claim({
            kind: 'simulated-event',
            text: 'Recorded platform views differ under their interaction rules.',
            sourceIds: [],
            memoryIds: ['M1'],
            quote: null,
          }),
          claim({
            kind: 'ai-hypothesis',
            text: 'Recorded platform views differ under their interaction rules.',
            sourceIds: [],
            quote: null,
          }),
        ],
      }),
    ).not.toThrow();
  });

  it.each<[string, Partial<ChapterClaim>, RegExp]>([
    ['an unknown passage', { sourceIds: ['S9'] }, /valid passage IDs: S1, S2/],
    ['an unknown memory', { memoryIds: ['M9'], kind: 'simulated-event' }, /valid memory IDs: M1/],
    ['a source fact with no quote', { quote: null }, /verbatim/],
    [
      'a quote that is not in the passage',
      { quote: 'proposes a twelve-month electric tram pilot' },
      /not verbatim/,
    ],
    ['a quote from a passage that was not cited', { sourceIds: ['S2'] }, /not verbatim/],
    [
      'a paraphrase that cites nothing',
      { kind: 'extracted-claim', sourceIds: [], quote: null },
      /at least one supplied passage/,
    ],
    [
      'an event that cites no memory',
      { kind: 'simulated-event', sourceIds: [], quote: null, memoryIds: [] },
      /simulation memory/,
    ],
  ])('rejects %s with an instruction the model can act on', (_name, override, message) => {
    expect(() => ok({ claims: [claim(override)] })).toThrow(AppError);
    expect(() => ok({ claims: [claim(override)] })).toThrow(message);
  });

  it('never echoes the model’s own claim text in the error', () => {
    const text = 'Quantum blockchain synergy unlocks galactic harmony.';
    try {
      ok({ claims: [claim({ text, kind: 'extracted-claim', sourceIds: [], quote: null })] });
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as Error).message).not.toContain('Quantum');
      expect((error as Error).message).toMatch(/^claims\[0\] \(extracted-claim\)/);
    }
  });

  it('does not reject a claim for being loosely related to the chapter: that is a disclosed split', () => {
    const unrelated = claim({
      text: 'Quantum blockchain synergy unlocks galactic harmony.',
      kind: 'ai-hypothesis',
      sourceIds: [],
      quote: null,
    });
    expect(() => ok({ claims: [unrelated] })).not.toThrow();
  });

  it('requires claims to be covered by the body at the documented threshold', () => {
    expect(BODY_COVERAGE).toBe(0.5);
  });

  describe('splitCoveredClaims', () => {
    const loose = claim({
      text: 'Quantum blockchain synergy unlocks galactic harmony.',
      kind: 'ai-hypothesis',
      sourceIds: [],
      quote: null,
    });

    it('keeps statements that restate the chapter and counts the ones it leaves out', () => {
      const kept = claim();
      const result = splitCoveredClaims(chapter({ claims: [kept, loose, loose] }));
      expect(result.kept).toEqual([kept]);
      expect(result.dropped).toBe(2);
    });

    it('leaves a chapter with no listed statements as it is', () => {
      expect(splitCoveredClaims(chapter({ claims: [] }))).toEqual({ kept: [], dropped: 0 });
    });

    it('measures the share of the statement’s own words found in the body, boundary included', () => {
      const statement = claim({
        text: 'Transit pilot lower fares galactic harmony synergy blockchain.',
        kind: 'ai-hypothesis',
        sourceIds: [],
        quote: null,
      });
      // Four of the statement's eight distinct words are in the body: exactly the threshold, kept.
      expect(
        splitCoveredClaims({
          body: 'Transit pilot lower fares were discussed.',
          claims: [statement],
        }).kept,
      ).toHaveLength(1);
      // Three of eight is below it, so the statement is left out.
      expect(
        splitCoveredClaims({ body: 'Transit pilot lower were discussed.', claims: [statement] }),
      ).toEqual({ kept: [], dropped: 1 });
    });
  });

  describe('the review says what it left out', () => {
    const run = (droppedClaims?: number) =>
      reviewClaims({
        model: null,
        signal: noAbort(),
        chapters: [chapter({ ...(droppedClaims === undefined ? {} : { droppedClaims }) })],
        context: context(),
        now: new Date('2026-01-01T00:00:00Z'),
      });

    it('names the chapter and the number of statements left out', async () => {
      expect((await run(1)).notes).toContain(
        '1 listed statement in “Evidence” did not restate that chapter’s text and was left out of the review.',
      );
      expect((await run(3)).notes).toContain(
        '3 listed statements in “Evidence” did not restate that chapter’s text and were left out of the review.',
      );
    });

    it('says nothing when nothing was left out', async () => {
      for (const dropped of [undefined, 0]) {
        const { notes } = await run(dropped);
        expect(notes.some((note) => note.includes('left out of the review'))).toBe(false);
      }
    });
  });

  // Captured from a real model (gpt-4.1-mini on Azure): it extrapolated memory IDs from their naming
  // pattern, kept a quote it had paraphrased, and put interview IDs in memoryIds. Reporting only the
  // first problem meant each correction revealed the next one and the stage ran out of repairs.
  describe('when a real model gets several claims wrong at once', () => {
    const message = (claims: ChapterClaim[], memories = context().memories): string => {
      try {
        validateChapterClaims(chapter({ claims }), { passages: context().passages, memories });
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('expected a rejection');
    };
    const several = (): ChapterClaim[] => [
      claim({ kind: 'simulated-event', sourceIds: [], quote: null, memoryIds: ['M-guessed-9'] }),
      claim({ kind: 'extracted-claim', sourceIds: [], quote: null }),
      claim({ kind: 'extracted-claim', quote: 'proposes a twelve-month electric tram pilot' }),
      claim({ kind: 'source-fact', quote: null }),
    ];

    it('names every problem in one message so the model can fix them together', () => {
      const text = message(several());
      for (const label of [
        'claims[0] (simulated-event) cites a simulation memory that was not supplied',
        'claims[1] (extracted-claim) must cite at least one supplied passage',
        'claims[2] (extracted-claim) has a quote that is not verbatim',
        'claims[3] (source-fact) needs a quote copied verbatim',
      ]) {
        expect(text).toContain(label);
      }
    });

    it('lists the valid identifiers once, and says where each kind of identifier belongs', () => {
      const text = message(several());
      expect(text.match(/valid memory IDs/g)).toHaveLength(1);
      expect(text).toContain('valid passage IDs: S1, S2; valid memory IDs: M1');
      expect(text).toContain('a claim cannot cite a fictional interview');
    });

    it('lists every valid identifier a chapter may cite, up to a bound, never a silent cut', () => {
      const memories = new Map(
        Array.from({ length: 30 }, (_, index) => [`M-${index + 1}`, 'A recorded post.'] as const),
      );
      const text = message(
        [claim({ kind: 'simulated-event', sourceIds: [], quote: null, memoryIds: ['M-x'] })],
        memories,
      );
      expect(text).toContain('M-1, M-2');
      expect(text).toContain('M-24 (and 6 more)');
      expect(text).not.toContain('M-25');
    });

    it('does not repeat identifier lists when no identifier is wrong', () => {
      const text = message([claim({ kind: 'extracted-claim', sourceIds: [], quote: null })]);
      expect(text).toContain('must cite at least one supplied passage');
      expect(text).not.toContain('valid passage IDs');
    });

    it('names at most eight problems and counts the rest', () => {
      const text = message(
        Array.from({ length: 10 }, () =>
          claim({ kind: 'extracted-claim', sourceIds: [], quote: null }),
        ),
      );
      expect(text.match(/claims\[\d+\]/g)).toHaveLength(8);
      expect(text).toContain('(and 2 more problems)');
    });

    it('never echoes an identifier or text the model invented', () => {
      const text = message([
        claim({
          kind: 'simulated-event',
          sourceIds: [],
          quote: null,
          memoryIds: ['M-ceommunity-1-agent-3'],
        }),
        claim({ sourceIds: ['S-invented-77'], quote: 'a quote the model made up entirely' }),
      ]);
      for (const echoed of ['ceommunity', 'S-invented-77', 'made up entirely']) {
        expect(text).not.toContain(echoed);
      }
    });
  });
});

describe('validateEntailment', () => {
  const items: EntailmentItem[] = [
    { claimId: 'C1', claim: SENTENCE, passages: new Map([['S1', `${SENTENCE} More text.`]]) },
    { claimId: 'C2', claim: SECOND, passages: new Map([['S2', SECOND]]) },
  ];
  const good = {
    judgements: [
      { claimId: 'C1', label: 'supports' as const, evidenceQuote: QUOTE },
      { claimId: 'C2', label: 'not_supported' as const, evidenceQuote: null },
    ],
  };

  it('accepts one grounded judgement per claim', () => {
    expect(() => validateEntailment(good, items)).not.toThrow();
  });

  it.each([
    [
      'an unknown claim id',
      { judgements: [{ claimId: 'C9', label: 'not_supported' as const, evidenceQuote: null }] },
      /claimId must be one of: C1, C2/,
    ],
    [
      'a repeated claim id',
      { judgements: [good.judgements[0]!, good.judgements[0]!] },
      /exactly one judgement/,
    ],
    ['a missing claim', { judgements: [good.judgements[0]!] }, /one judgement for every claimId/],
    [
      'a quote that is not in the passage',
      {
        judgements: [
          {
            claimId: 'C1',
            label: 'supports' as const,
            evidenceQuote: 'this sentence is not there at all',
          },
          good.judgements[1]!,
        ],
      },
      /copied exactly/,
    ],
    [
      'a quote from another claim’s passage',
      {
        judgements: [
          {
            claimId: 'C1',
            label: 'contradicts' as const,
            evidenceQuote: 'accessible stops and clear information',
          },
          good.judgements[1]!,
        ],
      },
      /copied exactly/,
    ],
    [
      'a positive judgement without a quote',
      {
        judgements: [
          { claimId: 'C1', label: 'partial' as const, evidenceQuote: null },
          good.judgements[1]!,
        ],
      },
      /copied exactly/,
    ],
  ])('rejects %s', (_name, reply, message) => {
    expect(() => validateEntailment(reply, items)).toThrow(message);
  });
});

describe('judgeClaims', () => {
  const items: EntailmentItem[] = [
    { claimId: 'C1', claim: SENTENCE, passages: new Map([['S1', `${SENTENCE} More text.`]]) },
    { claimId: 'C2', claim: SECOND, passages: new Map([['S1', `${SENTENCE} More text.`]]) },
  ];

  it('treats passages and claims as untrusted data and sends each passage once', async () => {
    const calls: unknown[] = [];
    const labels = await judgeClaims(
      gateway((data) => entailmentBrain(data), calls),
      items,
      noAbort(),
    );
    expect(labels.get('C1')).toBe('supports');
    const sent = calls[0] as { passages: { id: string }[]; items: { passageIds: string[] }[] };
    expect(sent.passages.map((passage) => passage.id)).toEqual(['S1']);
    expect(sent.items.map((item) => item.passageIds)).toEqual([['S1'], ['S1']]);
    expect(ENTAILMENT_INSTRUCTIONS).toContain('UNTRUSTED DATA');
    expect(ENTAILMENT_INSTRUCTIONS).toContain('never use outside knowledge');
  });

  it('maps every label and does no work for an empty batch', async () => {
    expect(
      (
        await judgeClaims(
          gateway(() => ({})),
          [],
          noAbort(),
        )
      ).size,
    ).toBe(0);
    for (const [label, expected] of [
      ['supports', 'supports'],
      ['partial', 'partial'],
      ['contradicts', 'contradicts'],
      ['not_supported', 'not-supported'],
    ] as const) {
      const labels = await judgeClaims(
        gateway((data) => entailmentBrain(data, label)),
        items,
        noAbort(),
      );
      expect([...labels.values()]).toEqual([expected, expected]);
    }
  });

  it('repairs a fabricated evidence quote once through the real model client', async () => {
    const config = testConfig({
      AI_PROVIDER: 'openai',
      AI_MODEL: 'fixture-model',
      OPENAI_API_KEY: 'test-placeholder-only',
    });
    const replies = [
      {
        judgements: items.map((item) => ({
          claimId: item.claimId,
          label: 'supports',
          evidenceQuote: 'a quote the model simply made up',
        })),
      },
    ];
    let call = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[];
      };
      const user = body.messages.find((message) => message.role === 'user')!.content;
      const data = (JSON.parse(user) as { untrustedScenarioData: unknown }).untrustedScenarioData;
      call += 1;
      return chatCompletion(replies[call - 1] ?? entailmentBrain(data));
    });
    const client = new ModelClient(config.provider, () => undefined, fetcher, 5);
    const labels = await judgeClaims(client, items, noAbort());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect([...labels.values()]).toEqual(['supports', 'supports']);
  });
});

describe('reviewClaims', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const review = (over: Partial<Parameters<typeof reviewClaims>[0]> = {}) =>
    reviewClaims({
      model: gateway((data) => entailmentBrain(data)),
      signal: noAbort(),
      chapters: [chapter()],
      context: context(),
      now,
      ...over,
    });

  it('verifies deterministically and with the independent check, and says which ran', async () => {
    const result = await review();
    expect(result.method).toBe('deterministic+model');
    expect(result.checkedAt).toBe(now.toISOString());
    expect(result.claims).toEqual([
      expect.objectContaining({
        id: 'C1',
        section: 'Evidence',
        kind: 'source-fact',
        verdict: 'supported',
        quote: QUOTE,
        checks: { quote: 'found', overlap: 1, numbers: null, entailment: 'supports' },
      }),
    ]);
    expect(result.counts).toEqual({
      supported: 1,
      partial: 0,
      unsupported: 0,
      contradicted: 0,
      unchecked: 0,
    });
    expect(result.notes.join(' ')).toContain('Only the statements the writer listed');
    expect(result.notes.join(' ')).toContain('not that the source is true');
  });

  it('surfaces a contradiction found by the independent check', async () => {
    const result = await review({ model: gateway((data) => entailmentBrain(data, 'contradicts')) });
    expect(result.claims[0]?.verdict).toBe('contradicted');
    expect(result.claims[0]?.reason).toContain('conflicts');
    expect(result.counts.contradicted).toBe(1);
  });

  it('keeps going when the independent check fails, and says so instead of hiding it', async () => {
    const failing: ModelGateway = {
      async json<T>(): Promise<T> {
        throw new AppError(502, 'MODEL_HTTP_ERROR', 'Provider returned HTTP 500.');
      },
    };
    const result = await review({ model: failing });
    expect(result.method).toBe('deterministic');
    expect(result.notes.join(' ')).toContain('did not complete (MODEL_HTTP_ERROR)');
    expect(result.claims[0]?.checks.entailment).toBeNull();
    expect(result.claims[0]?.verdict).toBe('supported');
    expect(result.claims[0]?.reason).toContain('no independent model check ran');
  });

  it.each(['RUN_CANCELLED', 'RUN_PAUSED', 'RUN_TIMEOUT'])(
    'never swallows a %s cancellation',
    async (code) => {
      const cancelled: ModelGateway = {
        async json<T>(): Promise<T> {
          throw new AppError(409, code, 'stopped');
        },
      };
      await expect(review({ model: cancelled })).rejects.toMatchObject({ code });
    },
  );

  it('rethrows when the run signal is aborted, whatever error surfaced', async () => {
    const controller = new AbortController();
    const model: ModelGateway = {
      async json<T>(): Promise<T> {
        controller.abort();
        throw new Error('socket closed');
      },
    };
    await expect(review({ model, signal: controller.signal })).rejects.toThrow('socket closed');
  });

  it('runs only the deterministic checks when no model is available', async () => {
    const result = await review({ model: null });
    expect(result.method).toBe('deterministic');
    expect(result.notes[0]).toContain('No model was available');
    expect(result.claims[0]?.verdict).toBe('supported');
  });

  it('sends only source-backed statements to the independent check', async () => {
    const calls: unknown[] = [];
    const result = await review({
      model: gateway((data) => entailmentBrain(data), calls),
      chapters: [
        chapter({
          claims: [
            claim(),
            claim({ kind: 'ai-hypothesis', sourceIds: [], quote: null }),
            claim({ kind: 'analytical-conclusion', sourceIds: [], quote: null }),
            claim({ kind: 'simulated-event', sourceIds: [], memoryIds: ['M1'], quote: null }),
          ],
        }),
      ],
    });
    expect(calls).toHaveLength(1);
    expect(
      (calls[0] as { items: { claimId: string }[] }).items.map((item) => item.claimId),
    ).toEqual(['C1']);
    expect(result.claims.map((item) => item.verdict)).toEqual([
      'supported',
      'unchecked',
      'unchecked',
      'unsupported',
    ]);
  });

  it('does not call the model at all when nothing needs it', async () => {
    const calls: unknown[] = [];
    const result = await review({
      model: gateway(() => ({}), calls),
      chapters: [
        chapter({ claims: [claim({ kind: 'ai-hypothesis', sourceIds: [], quote: null })] }),
      ],
    });
    expect(calls).toHaveLength(0);
    expect(result.method).toBe('deterministic');
    expect(result.notes[0]).toContain('No source-backed statement');
  });

  it('numbers claims across chapters and caps how many are checked', async () => {
    const many = Array.from({ length: 4 }, () => claim());
    const chapters = Array.from({ length: 9 }, (_, index) =>
      chapter({ title: `Chapter ${index + 1}`, claims: many }),
    );
    const result = await review({ model: null, chapters });
    expect(result.claims).toHaveLength(30);
    expect(result.claims[0]?.id).toBe('C1');
    expect(result.claims[29]?.id).toBe('C30');
    expect(result.claims[4]?.section).toBe('Chapter 2');
    expect(result.notes.join(' ')).toContain('6 further listed statements were not checked');
  });

  it('flags figures in prose that nothing stands behind, and ignores backed ones', async () => {
    const result = await review({
      chapters: [
        chapter({
          title: 'Trajectory',
          body: `${SENTENCE} Support rose by 73 percent, from 0.35 to 4 and fares fall by 20 percent in 8 rounds.`,
        }),
      ],
    });
    expect(result.unverifiedFigures).toEqual([{ section: 'Trajectory', figures: ['73'] }]);
  });

  it('reports no unverified figures when every number is recorded or cited', async () => {
    const result = await review();
    expect(result.unverifiedFigures).toEqual([]);
  });

  it('is a pure function of its inputs apart from the model call', async () => {
    const a = await review();
    const b = await review();
    expect(a).toEqual(b);
  });
});
