import { describe, expect, it } from 'vitest';
import type { ContradictionRecord } from '../../shared/evidence.js';
import type { EvidenceChunk, SourceDocument } from '../../shared/types.js';
import {
  MAX_CONTRADICTIONS,
  completeSentences,
  detectContradictions,
  hasNegation,
  measurementsIn,
  splitSentences,
} from '../src/grounding/contradictions.js';
import { findQuote } from '../src/grounding/text.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';

const NOW = new Date('2026-10-29T10:00:00.000Z');

function passage(id: string, text: string, documentId = id.replace('S', 'D')): EvidenceChunk {
  return { id, documentId, documentName: `${documentId}.md`, text, start: 0, end: text.length };
}

describe('measurementsIn', () => {
  it('reads currency, percentages, scaled and comma-grouped figures', () => {
    const { measurements } = measurementsIn(
      'The plan costs $3.5 million, serves 412,000 riders and 58% of residents back it.',
    );
    expect(measurements.map((m) => [m.unit, m.value])).toEqual([
      ['currency', 3_500_000],
      ['count', 412_000],
      ['percent', 58],
    ]);
  });

  it('treats a year as a time qualifier, never as a measurement', () => {
    const { measurements, times } = measurementsIn('In 2024 the ferry carried 412,000 riders.');
    expect(measurements.map((m) => m.value)).toEqual([412_000]);
    expect(times.has('2024')).toBe(true);
  });

  it('reads quarters and months as time qualifiers', () => {
    const { times } = measurementsIn('In Q3 and again in March the ferry was late.');
    expect(times.has('q3')).toBe(true);
    expect(times.has('march')).toBe(true);
  });

  it('reads a currency word that follows the figure', () => {
    expect(measurementsIn('The fare rose to 12 dollars per trip.').measurements[0]?.unit).toBe(
      'currency',
    );
  });
});

describe('splitSentences', () => {
  it('returns exact slices, so a quoted sentence is verbatim by construction', () => {
    const text =
      'The council met on Monday and approved the plan. Residents responded with concern about the timetable.';
    for (const sentence of splitSentences(text)) expect(text.includes(sentence)).toBe(true);
    expect(splitSentences(text)).toHaveLength(2);
  });

  it('ignores fragments too short to carry a claim', () => {
    expect(
      splitSentences('Yes. OK. The council approved the electric ferry trial for next winter.'),
    ).toHaveLength(1);
  });
});

describe('hasNegation', () => {
  it('detects negations and contractions, and not look-alike words', () => {
    expect(hasNegation('The council does not support the plan.')).toBe(true);
    expect(hasNegation('Residents won’t accept a shorter timetable.')).toBe(true);
    expect(hasNegation('The council supports the plan and the nothing-to-hide principle.')).toBe(
      false,
    );
  });
});

describe('detectContradictions', () => {
  const council = passage(
    'S1',
    'Annual ferry ridership reached 412,000 passengers in 2024 according to the council. The council supports the electric ferry plan for the island route.',
  );
  const operator = passage(
    'S2',
    'Annual ferry ridership was 365,000 passengers in 2024 according to the operator. The operator reports it will deliver the island route plan.',
  );

  it('finds two sources that give different figures for the same measure', () => {
    const found = detectContradictions([council, operator], NOW);
    expect(found).toHaveLength(1);
    const [hit] = found;
    expect(hit).toMatchObject({
      id: 'X1',
      kind: 'numeric',
      status: 'detected',
      detectedBy: 'deterministic-v1',
    });
    expect([hit?.leftValue, hit?.rightValue].sort()).toEqual(['365,000', '412,000']);
    expect(hit?.topic).toContain('ridership');
  });

  it('quotes both sides exactly, so each can be checked against its passage', () => {
    const [hit] = detectContradictions([council, operator], NOW);
    for (const side of [hit?.left, hit?.right]) {
      const source = [council, operator].find((p) => p.id === side?.passageId);
      expect(side?.quote).toBeTruthy();
      expect(source?.text.includes(side?.quote ?? '')).toBe(true);
      expect(
        findQuote(side?.quote ?? '', new Map([[source?.id ?? '', source?.text ?? '']])).found,
      ).toBe(true);
      expect(side?.contentHash).toHaveLength(64);
    }
  });

  it('finds a conflicting percentage', () => {
    const a = passage(
      'S1',
      'The island survey found that 61% of residents support the electric ferry timetable change.',
    );
    const b = passage(
      'S2',
      'The operator survey found that 58% of residents support the electric ferry timetable change.',
    );
    expect(detectContradictions([a, b], NOW)[0]?.kind).toBe('numeric');
  });

  it('does not flag the same figure written in two ways', () => {
    const a = passage(
      'S1',
      'The island ferry carried 1.2 million passengers across the full operating year.',
    );
    const b = passage(
      'S2',
      'Across the full operating year the island ferry carried 1,200,000 passengers overall.',
    );
    expect(detectContradictions([a, b], NOW)).toEqual([]);
  });

  it('does not pair statements about different periods', () => {
    const a = passage(
      'S1',
      'Annual ferry ridership reached 365,000 passengers in 2023 according to the operator.',
    );
    const b = passage(
      'S2',
      'Annual ferry ridership reached 412,000 passengers in 2024 according to the council.',
    );
    expect(detectContradictions([a, b], NOW)).toEqual([]);
  });

  it('does not pair two sentences from the same passage', () => {
    const both = passage(
      'S1',
      'Annual ferry ridership reached 412,000 passengers in 2024 according to the council. Annual ferry ridership was 365,000 passengers in 2024 according to the operator.',
    );
    expect(detectContradictions([both], NOW)).toEqual([]);
  });

  it('does not pair sentences about different things that merely contain figures', () => {
    const a = passage(
      'S1',
      'The harbour authority employs 40 engineers across the winter maintenance programme.',
    );
    const b = passage(
      'S2',
      'The council approved a budget of 900,000 for the library refurbishment programme next year.',
    );
    expect(detectContradictions([a, b], NOW)).toEqual([]);
  });

  it('skips a sentence with several figures of one kind rather than guess which to compare', () => {
    const a = passage(
      'S1',
      'Ferry ridership was 400,000 in the summer and 300,000 in the winter for the island route.',
    );
    const b = passage(
      'S2',
      'Ferry ridership was 350,000 in the summer and 250,000 in the winter for the island route.',
    );
    expect(detectContradictions([a, b], NOW)).toEqual([]);
  });

  it('flags one source affirming what another denies, with lower confidence than a numeric conflict', () => {
    const a = passage(
      'S1',
      'The island council supports the proposed electric ferry plan for the route.',
    );
    const b = passage(
      'S2',
      'The island council does not support the proposed electric ferry plan for the route.',
    );
    const found = detectContradictions([a, b], NOW);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('polarity');
    expect(found[0]?.confidence).toBeLessThanOrEqual(0.7);
    expect(found[0]?.leftValue).toBeNull();
  });

  it('does not flag two sources that agree', () => {
    const a = passage(
      'S1',
      'The island council supports the proposed electric ferry plan for the route.',
    );
    const b = passage(
      'S2',
      'The island council supports the proposed electric ferry plan for the route entirely.',
    );
    expect(detectContradictions([a, b], NOW)).toEqual([]);
  });

  describe('short sentences that count the same thing over the same period', () => {
    const council = passage('S1', 'Council counts show 412,000 one-way crossings in 2025.');
    const operator = passage(
      'S2',
      'Our ticketing system recorded 365,000 one-way crossings in 2025.',
    );

    it('pairs them even though they share only the words that name the measure', () => {
      const found = detectContradictions([council, operator], NOW);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ kind: 'numeric', status: 'detected' });
      expect([found[0]?.leftValue, found[0]?.rightValue].sort()).toEqual(['365,000', '412,000']);
    });

    it('does not pair them when the periods differ', () => {
      const earlier = passage(
        'S2',
        'Our ticketing system recorded 365,000 one-way crossings in 2024.',
      );
      expect(detectContradictions([council, earlier], NOW)).toEqual([]);
    });

    it('does not treat a missing period as agreement', () => {
      const undated = passage('S2', 'Our ticketing system recorded 365,000 one-way crossings.');
      expect(detectContradictions([council, undated], NOW)).toEqual([]);
    });

    it('does not pair them when the figures count different things', () => {
      const other = passage('S2', 'Our ticketing system recorded 365,000 complaints in 2025.');
      expect(detectContradictions([council, other], NOW)).toEqual([]);
    });

    it('does not flag the same figure written in two ways', () => {
      const same = passage('S2', 'Our ticketing system recorded 412000 one-way crossings in 2025.');
      expect(detectContradictions([council, same], NOW)).toEqual([]);
    });

    it('records what each figure counts', () => {
      expect(
        measurementsIn('Council counts show 412,000 one-way crossings in 2025.').measurements[0]
          ?.phrase,
      ).toBe('one-way crossings');
    });
  });

  it('is deterministic, with stable ids, regardless of passage order', () => {
    const forward = detectContradictions([council, operator], NOW);
    const backward = detectContradictions([operator, council], NOW);
    expect(forward.map((c) => c.kind)).toEqual(backward.map((c) => c.kind));
    expect(detectContradictions([council, operator], NOW)).toEqual(forward);
    expect(forward.map((c) => c.id)).toEqual(['X1']);
  });

  it('caps the number of results and orders them by confidence', () => {
    const passages: EvidenceChunk[] = [];
    for (let i = 0; i < 30; i += 1) {
      passages.push(
        passage(
          `S${i * 2 + 1}`,
          `Measure ${'alpha'.repeat(1)} bravo charlie delta echo number ${i} reached ${1_000 + i} units for the programme.`,
        ),
      );
      passages.push(
        passage(
          `S${i * 2 + 2}`,
          `Measure alpha bravo charlie delta echo number ${i} reached ${5_000 + i} units for the programme.`,
        ),
      );
    }
    const found = detectContradictions(passages, NOW);
    expect(found.length).toBeLessThanOrEqual(MAX_CONTRADICTIONS);
    const confidences = found.map((c) => c.confidence);
    expect([...confidences].sort((x, y) => y - x)).toEqual(confidences);
  });

  it('stays fast on a large corpus', () => {
    const passages = Array.from({ length: 200 }, (_, i) =>
      passage(
        `S${i + 1}`,
        `Programme ${i} describes harbour operations, winter maintenance and crew scheduling in detail for the island route. Budget line ${i} is ${i + 10} thousand for item ${i}.`,
      ),
    );
    const started = performance.now();
    detectContradictions(passages, NOW);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  // Passages overlap by 120 characters, and the overlap begins wherever it begins: often in the
  // middle of a word. The first "sentence" of the next passage is then the tail of a sentence the
  // previous passage holds whole, with a negation or the front of a figure cut off. It must never be
  // set against the sentence it came from, nor against anything else.
  describe('a document that agrees with itself, cut into passages', () => {
    // The negation comes after the cut can fall: the head of this sentence, cut before "did not",
    // reads as an affirmation of the same thing the whole sentence denies.
    const HEAD_CUT =
      'The harbour board approved the revised timetable at its meeting in March, but did not publish the minutes.';
    const NEGATED =
      'The ferry committee did not approve the revised fare schedule at its meeting in March.';
    const COUNTED =
      'Council counts show 412,000 one-way crossings between the island and the mainland in 2025.';
    // Neutral filler: no figures, no negation, nothing the detector could pair.
    const FILLER = 'Residents use the harbour road every morning and evening. ';

    /** One document in which the same three sentences sit at a different offset for each `pad`. */
    function selfConsistent(pad: number): SourceDocument {
      const content = [
        `The harbour notes begin here ${'x'.repeat(pad)}.`,
        FILLER.repeat(11).trim(),
        HEAD_CUT,
        NEGATED,
        COUNTED,
        FILLER.repeat(12).trim(),
      ].join(' ');
      return { id: 'D1', name: 'notes.md', content };
    }

    const pads = Array.from({ length: 600 }, (_, pad) => pad);

    /** Where the first passage ends and the second begins, and where a sentence sits in the document. */
    function placement(pad: number, sentence: string) {
      const document = selfConsistent(pad);
      const [first, second] = chunkDocuments([document]);
      const at = document.content.indexOf(sentence);
      return { first: first!, second: second!, at, end: at + sentence.length };
    }
    type Placement = ReturnType<typeof placement>;
    // The next passage begins inside the sentence: a cut tail.
    const tail = ({ second, at, end }: Placement) => second.start > at && second.start < end;
    // The passage before ends inside the sentence: a cut head.
    const head = ({ first, at, end }: Placement) => first.end > at && first.end < end;
    // Both passages hold the whole sentence, because it sits in the overlap.
    const both = ({ first, second, at, end }: Placement) => second.start <= at && end <= first.end;

    it('puts the cut, the head cut and the overlap on each sentence for some offsets, so the tests mean something', () => {
      const count = (test: (p: Placement) => boolean, sentence: string) =>
        pads.filter((pad) => test(placement(pad, sentence))).length;
      for (const sentence of [HEAD_CUT, NEGATED, COUNTED]) {
        expect(count(tail, sentence), `tail of ${sentence}`).toBeGreaterThan(20);
      }
      expect(count(head, HEAD_CUT)).toBeGreaterThan(20);
      expect(count(both, COUNTED)).toBeGreaterThan(10);
    });

    it('reports no conflict at any offset', () => {
      const falseAlarms = pads
        .map((pad) => ({
          pad,
          found: detectContradictions(chunkDocuments([selfConsistent(pad)]), NOW),
        }))
        .filter(({ found }) => found.length > 0)
        .map(({ pad, found }) => `${pad}: ${found.map((c) => c.id + ' ' + c.kind).join(', ')}`);
      expect(falseAlarms).toEqual([]);
    });

    describe('against a document that really disagrees', () => {
      const other: SourceDocument = {
        id: 'D2',
        name: 'memo.md',
        content: [
          `The operator's memo begins here.`,
          FILLER.repeat(12).trim(),
          'Our ticketing system recorded 365,000 one-way crossings between the island and the mainland in 2025.',
          FILLER.repeat(12).trim(),
        ].join(' '),
      };

      it('finds the one conflict at every offset, and reports it once', () => {
        // A sentence shorter than the overlap is whole in at least one passage wherever the cut
        // falls, so being careful about cut sentences must cost no recall on ordinary sentences. A
        // sentence that sits in the overlap is in two passages and is still one sentence.
        const wrong = pads
          .map((pad) => ({
            pad,
            found: detectContradictions(chunkDocuments([selfConsistent(pad), other]), NOW),
          }))
          .filter(({ found }) => found.length !== 1 || found[0]?.kind !== 'numeric')
          .map(({ pad, found }) => `${pad}: ${found.length}`);
        expect(wrong).toEqual([]);
      });

      it('cites the earlier passage when the sentence sits in the overlap and is held by both', () => {
        const pad = pads.find((candidate) => both(placement(candidate, COUNTED)));
        expect(pad).toBeDefined();
        const found = detectContradictions(chunkDocuments([selfConsistent(pad!), other]), NOW);
        expect(found).toHaveLength(1);
        const ours = [found[0]!.left, found[0]!.right].find(
          (ref) => ref.documentName === 'notes.md',
        );
        expect(ours?.passageId).toBe('S1');
      });

      it('gives the same answer whatever order the passages arrive in, at every offset', () => {
        // Which side of a conflict is called left follows the input order, so compare the pair.
        const canonical = (found: ContradictionRecord[]) =>
          found.map((conflict) => ({
            id: conflict.id,
            kind: conflict.kind,
            confidence: conflict.confidence,
            sides: [
              `${conflict.left.passageId}: ${conflict.left.quote}`,
              `${conflict.right.passageId}: ${conflict.right.quote}`,
            ].sort(),
          }));
        const differing = pads.filter((pad) => {
          const passages = chunkDocuments([selfConsistent(pad), other]);
          return (
            JSON.stringify(canonical(detectContradictions([...passages].reverse(), NOW))) !==
            JSON.stringify(canonical(detectContradictions(passages, NOW)))
          );
        });
        expect(differing).toEqual([]);
      });
    });
  });

  describe('completeSentences', () => {
    const DOCUMENT =
      'The first sentence is whole and ends here. The second sentence runs across the place where the passage is cut. The third sentence closes the document.';
    const FIRST = 'The first sentence is whole and ends here.';
    const SECOND = 'The second sentence runs across the place where the passage is cut.';
    const THIRD = 'The third sentence closes the document.';
    const slice = (from: number, to: number): EvidenceChunk => ({
      id: `S${from}`,
      documentId: 'D1',
      documentName: 'd.md',
      text: DOCUMENT.slice(from, to),
      start: from,
      end: to,
    });
    const texts = (found: { text: string }[]) => found.map((sentence) => sentence.text);
    const second = DOCUMENT.indexOf(SECOND);
    const third = DOCUMENT.indexOf(THIRD);

    it('keeps the sentences a passage holds whole, and drops the head and the tail it cut', () => {
      const first = slice(0, second + 30);
      const last = slice(second + 10, DOCUMENT.length);
      const both = [first, last];
      expect(texts(completeSentences(first, both))).toEqual([FIRST]);
      expect(texts(completeSentences(last, both))).toEqual([THIRD]);
    });

    it('says where each sentence sits in the document, not in the passage', () => {
      const last = slice(second, DOCUMENT.length);
      expect(completeSentences(last, [slice(0, second + 5), last])).toEqual([
        { text: SECOND, start: second },
        { text: THIRD, start: third },
      ]);
    });

    it('keeps a first sentence that begins exactly where a sentence begins, or in the space before it', () => {
      const before = slice(0, second + 5);
      for (const from of [second, second - 1]) {
        const later = slice(from, DOCUMENT.length);
        expect(texts(completeSentences(later, [before, later])), `from ${from}`).toEqual([
          SECOND,
          THIRD,
        ]);
      }
    });

    it('does not trust a first sentence when nothing says what came before the passage', () => {
      expect(texts(completeSentences(slice(second, DOCUMENT.length), []))).toEqual([THIRD]);
    });

    it('keeps the last sentence of a document that has no final stop', () => {
      const body = 'The council met on Monday and approved the plan. The vote was unanimous';
      const only: EvidenceChunk = {
        id: 'S1',
        documentId: 'D1',
        documentName: 'd.md',
        text: body,
        start: 0,
        end: body.length,
      };
      expect(texts(completeSentences(only, [only]))).toEqual([
        'The council met on Monday and approved the plan.',
        'The vote was unanimous',
      ]);
    });

    it('treats a blank line, and a list item, as the end of a sentence and the start of the next', () => {
      const body =
        'Fares for the winter timetable\n\nThe council will review fares each spring\n\n- Fares rise by 12% in winter\n- Fares are capped at 5% in summer\n\nThe review follows the budget cycle';
      const cutAt = body.indexOf('- Fares rise');
      const head: EvidenceChunk = {
        id: 'S1',
        documentId: 'D1',
        documentName: 'd.md',
        text: body.slice(0, cutAt),
        start: 0,
        end: cutAt,
      };
      const tail: EvidenceChunk = {
        id: 'S2',
        documentId: 'D1',
        documentName: 'd.md',
        text: body.slice(cutAt),
        start: cutAt,
        end: body.length,
      };
      // Neither passage ends or begins mid-sentence: each cut is at a blank line or a list marker.
      expect(texts(completeSentences(head, [head, tail]))).toEqual([
        'Fares for the winter timetable',
        'The council will review fares each spring',
      ]);
      expect(texts(completeSentences(tail, [head, tail]))).toEqual([
        '- Fares rise by 12% in winter',
        '- Fares are capped at 5% in summer',
        'The review follows the budget cycle',
      ]);
    });
  });
});
