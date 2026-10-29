import { describe, expect, it } from 'vitest';
import type { EvidenceChunk } from '../../shared/types.js';
import {
  MAX_CONTRADICTIONS,
  detectContradictions,
  hasNegation,
  measurementsIn,
  splitSentences,
} from '../src/grounding/contradictions.js';
import { findQuote } from '../src/grounding/text.js';

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
});
