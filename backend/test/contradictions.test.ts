import { describe, expect, it } from 'vitest';
import type { ContradictionRecord } from '../../shared/evidence.js';
import type { EvidenceChunk, SourceDocument } from '../../shared/types.js';
import {
  MAX_CANDIDATES_PER_SENTENCE,
  MAX_CONTRADICTIONS,
  MAX_HELD_CONFLICTS,
  MAX_POSTING_LENGTH,
  type ContradictionScanStats,
  completeSentences,
  detectContradictions,
  hasNegation,
  measurementsIn,
  reconcileConflicts,
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

  describe('a number that names a release note, an article or a product', () => {
    it.each([
      ['a roadmap ID in brackets', 'Copilot connectors are rolling out (Roadmap ID 502533).'],
      ['an ID after a colon', 'Roadmap ID: 502533 covers Copilot connectors from Microsoft.'],
      ['a message-centre code', 'Copilot connectors from Microsoft are tracked as MC502533.'],
      ['a knowledge-base number', 'The Copilot app is fixed by update KB5012345 for everyone.'],
      ['an article number', 'The Copilot app from Microsoft is described in article 566318.'],
      ['a number in brackets alone', 'The Copilot app from Microsoft is rolling out now (566318).'],
      ['a feature number', 'The Copilot app from Microsoft is feature 566318 on the roadmap.'],
      ['a release number', 'Release 502533 adds Copilot connectors from Microsoft.'],
      [
        'a number in a link',
        'Copilot connectors from Microsoft are listed at aka.ms/502533 today.',
      ],
      ['a hash number', 'Roadmap #502533 covers Copilot connectors from Microsoft.'],
      ['the 365 of Microsoft 365', 'Copilot connectors work across Microsoft 365 apps for admins.'],
      [
        'the number of a version',
        'The admin centre now runs on Windows 11 and Android 14 devices.',
      ],
      ['a number inside a hyphenated name', 'The pandemic, COVID-19, changed the timetable a lot.'],
      ['a number glued to a letter', 'The model gpt-5 answered while v2.0 of the app was in use.'],
    ])('is not read as a figure: %s', (_label, sentence) => {
      expect(measurementsIn(sentence).measurements).toEqual([]);
    });

    it.each([
      ['a figure after the word "figure"', 'The official figure: 412,000 passengers.', ['412,000']],
      ['a count of what is built or released', 'The council will build 200 homes.', ['200']],
      ['a count after the first word of a sentence', 'Added 3 new connectors.', ['3']],
      ['a count after a quantifier', 'Over 400 ferries ran in the spring.', ['400']],
      ['a long number that is a count', 'Ridership reached 412000 last year.', ['412000']],
      ['a long number that counts something', '412000 passengers rode the ferry.', ['412000']],
      ['an amount after a currency code', 'The council paid USD500 for the lease.', ['500']],
      ['a percentage after a hyphen', 'Ridership rose by up-to-40% last year.', ['40%']],
      [
        'a figure beside a route number',
        'Passengers on Route 7 numbered 412,000 last winter.',
        ['412,000'],
      ],
    ])('is still read as a figure: %s', (_label, sentence, raw) => {
      expect(measurementsIn(sentence).measurements.map((m) => m.raw)).toEqual(raw);
    });
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

  it('does not flag one source affirming a thing while another denies something else about the same subject', () => {
    // "Who may create a channel" and "what owners may see of one" share a subject and not a claim.
    const a = passage('S1', 'Only team owners can create a shared channel.');
    const b = passage(
      'S2',
      "Team owners can't see the files, the conversations or the member list of a shared channel unless they are members of that shared channel.",
    );
    expect(detectContradictions([a, b], NOW)).toEqual([]);
  });

  it('does not read the "No" of a table cell as a source denying what a sentence says', () => {
    const table = passage(
      'S1',
      [
        '| Action | Team owner | Team member | Shared channel owner |',
        '| --- | --- | --- | --- |',
        '| Create shared channel | Admin controlled | Admin and team owner controlled | N/A |',
        '| Delete shared channel | Yes | No | Yes |',
        '| Add members to a shared channel | No | N/A | Yes |',
      ].join('\n'),
    );
    const prose = passage(
      'S2',
      'A shared channel owner can add members to a shared channel and delete the shared channel.',
    );
    expect(detectContradictions([table, prose], NOW)).toEqual([]);
  });

  it('still reads a figure in a table row against a figure in a sentence', () => {
    const table = passage(
      'S1',
      '| Plan | Price |\n| --- | --- |\n| Premium licence monthly price | $12 |\n',
    );
    const prose = passage('S2', 'The Premium licence monthly price is $7 for education customers.');
    expect(detectContradictions([table, prose], NOW)).toHaveLength(1);
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

  describe('a release-note or article number that is not a figure', () => {
    const connectors = passage(
      'S1',
      'Copilot connectors from Microsoft work across Microsoft 365 apps.',
    );
    const app = passage('S1', 'The Copilot app from Microsoft is included in Microsoft 365 plans.');

    it('is not set against the 365 of Microsoft 365: "connectors copilot microsoft" with "365" and "502533"', () => {
      const roadmap = passage(
        'S2',
        'Copilot connectors from Microsoft are rolling out (Roadmap ID 502533).',
      );
      expect(detectContradictions([connectors, roadmap], NOW)).toEqual([]);
    });

    it('is not set against the 365 of Microsoft 365: "app copilot microsoft" with "365" and "566318"', () => {
      const article = passage(
        'S2',
        'The Copilot app from Microsoft is described in article 566318.',
      );
      expect(detectContradictions([app, article], NOW)).toEqual([]);
    });

    it.each([
      [
        'a roadmap ID',
        'The Copilot app from Microsoft is rolling out to tenants (Roadmap ID 566318).',
      ],
      [
        'an article number',
        'The Copilot app from Microsoft is described for tenants in article 566318.',
      ],
      ['a code', 'The Copilot app from Microsoft is tracked as MC566318 for tenants.'],
      [
        'a knowledge-base number',
        'The Copilot app from Microsoft is fixed by update KB566318 for tenants.',
      ],
      [
        'a number in brackets',
        'The Copilot app from Microsoft is rolling out to tenants now (566318).',
      ],
      ['a feature number', 'The Copilot app from Microsoft is feature 566318 for tenants.'],
    ])('is not set against a real figure, whatever its shape: %s', (_label, text) => {
      const figure = passage(
        'S1',
        'The Copilot app from Microsoft is used by 412,000 tenants today.',
      );
      expect(detectContradictions([figure, passage('S2', text)], NOW)).toEqual([]);
    });

    it('is not set against another one: two items of one roadmap are not a disagreement', () => {
      const first = passage(
        'S1',
        'The Copilot app from Microsoft is rolling out as Roadmap ID 566318.',
      );
      const second = passage(
        'S2',
        'The Copilot app from Microsoft is rolling out as Roadmap ID 502533.',
      );
      expect(detectContradictions([first, second], NOW)).toEqual([]);
    });

    it('still finds two sources that give different figures for the same measure', () => {
      const a = passage('S1', 'The Copilot app from Microsoft reached 412,000 tenants last year.');
      const b = passage('S2', 'The Copilot app from Microsoft reached 365,000 tenants last year.');
      const [hit] = detectContradictions([a, b], NOW);
      expect([hit?.leftValue, hit?.rightValue].sort()).toEqual(['365,000', '412,000']);
    });

    it('finds the figures that sentences with a number of their own were hiding', () => {
      const a = passage(
        'S1',
        'Roadmap ID 502533: the Copilot app from Microsoft reached 412,000 tenants last year.',
      );
      const b = passage(
        'S2',
        'Roadmap ID 566318: the Copilot app from Microsoft reached 365,000 tenants last year.',
      );
      const found = detectContradictions([a, b], NOW);
      expect(found).toHaveLength(1);
      expect([found[0]?.leftValue, found[0]?.rightValue].sort()).toEqual(['365,000', '412,000']);
    });

    it('still finds a percentage that differs beside an ID', () => {
      const a = passage(
        'S1',
        'The Copilot app from Microsoft (Roadmap ID 502533) is used by 61% of tenants.',
      );
      const b = passage(
        'S2',
        'The Copilot app from Microsoft (Roadmap ID 566318) is used by 48% of tenants.',
      );
      const found = detectContradictions([a, b], NOW);
      expect(found).toHaveLength(1);
      expect([found[0]?.leftValue, found[0]?.rightValue].sort()).toEqual(['48%', '61%']);
    });
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

describe('what a ledger holds after a fresh scan', () => {
  const side = (documentId: string, quote: string) => ({
    passageId: `S-${documentId}`,
    documentId,
    documentName: `${documentId}.md`,
    start: 0,
    end: quote.length,
    quote,
    contentHash: 'h'.repeat(64),
    role: 'contradicts' as const,
  });
  const record = (
    id: string,
    a: string,
    b: string,
    status: ContradictionRecord['status'] = 'detected',
  ) =>
    ({
      id,
      kind: 'numeric',
      topic: 'permits',
      left: side('D1', a),
      right: side('D2', b),
      leftValue: '1',
      rightValue: '2',
      confidence: 0.9,
      status,
      note: status === 'detected' ? null : 'decided',
      detectedBy: 'deterministic-v1',
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:00:00.000Z',
    }) satisfies ContradictionRecord;

  it('keeps what it holds, with what was decided, and adds a candidate it does not hold after the last', () => {
    const held = [
      record('X1', 'Alpha 1.', 'Beta 2.', 'dismissed'),
      record('X7', 'Gamma 1.', 'Delta 2.'),
    ];
    const found = [record('X1', 'Gamma 1.', 'Delta 2.'), record('X2', 'Eps 1.', 'Zeta 2.')];
    const merged = reconcileConflicts(held, found);
    expect(merged.map((entry) => [entry.id, entry.status])).toEqual([
      ['X1', 'dismissed'],
      ['X7', 'detected'],
      ['X8', 'detected'],
    ]);
    expect(merged[2]?.left.quote).toBe('Eps 1.');
  });

  it('knows a pair again whichever side comes first, and adds a pair only once', () => {
    const held = [record('X1', 'Alpha 1.', 'Beta 2.')];
    const swapped = {
      ...record('X1', 'Beta 2.', 'Alpha 1.'),
      left: side('D2', 'Beta 2.'),
      right: side('D1', 'Alpha 1.'),
    };
    const fresh = record('X2', 'Eps 1.', 'Zeta 2.');
    expect(reconcileConflicts(held, [swapped, fresh, { ...fresh, id: 'X3' }])).toHaveLength(2);
  });

  it('holds no more than the bound, and an empty ledger takes whatever the scan found', () => {
    const many = Array.from({ length: MAX_HELD_CONFLICTS + 10 }, (_, i) =>
      record(`X${i + 1}`, `Quote ${i} a.`, `Quote ${i} b.`),
    );
    expect(reconcileConflicts([], many)).toHaveLength(MAX_HELD_CONFLICTS);
    expect(reconcileConflicts([], [])).toEqual([]);
    expect(reconcileConflicts([], many.slice(0, 3)).map((entry) => entry.id)).toEqual([
      'X1',
      'X2',
      'X3',
    ]);
  });
});

describe('a scan of a great deal of evidence', () => {
  const emptyStats = (): ContradictionScanStats => ({
    sentences: 0,
    skippedLists: 0,
    postingVisits: 0,
    pairsCompared: 0,
    cappedSentences: 0,
  });

  /** A name that is one word and different for every number: no stop word, no digit. */
  const token = (n: number): string => {
    let name = '';
    for (let rest = n; rest >= 0; rest = Math.floor(rest / 26) - 1) {
      name = String.fromCharCode(97 + (rest % 26)) + name;
    }
    return `zq${name}`;
  };

  /** One passage per sentence, so that no two sentences share a passage. */
  const apart = (sentences: string[]): EvidenceChunk[] =>
    sentences.map((text, i) => passage(`S${i + 1}`, text));

  /** Sentences that all say the same thing, each with a figure of its own: every one pairs with every other. */
  const saidAgain = (count: number, family = 'harbour'): string[] =>
    Array.from(
      { length: count },
      (_, i) =>
        `The ${family} ferry carried ${100_000 + i * 37} passengers across the island route according to the council.`,
    );

  it('does not read a list of sentences that is longer than the limit allows', () => {
    const stats = emptyStats();
    detectContradictions(apart(saidAgain(MAX_POSTING_LENGTH + 100)), NOW, stats);
    // Every word is held by more sentences than that, so none is used to look for a partner. Read in
    // full, the lists make 600 sentences compare with each other: about 180,000 pairs.
    expect(stats.skippedLists).toBeGreaterThan(0);
    expect(stats.postingVisits).toBe(0);
    expect(stats.pairsCompared).toBe(0);
  });

  it('reads a list of 512 sentences and skips one of 513, whatever the exported limits are', () => {
    const read = emptyStats();
    detectContradictions(apart(saidAgain(512)), NOW, read);
    expect(read.skippedLists).toBe(0);
    expect(read.postingVisits).toBeGreaterThan(0);
    const skipped = emptyStats();
    detectContradictions(apart(saidAgain(513)), NOW, skipped);
    expect(skipped.skippedLists).toBeGreaterThan(0);
    expect(skipped.postingVisits).toBe(0);
    expect(skipped.pairsCompared).toBe(0);
  });

  it('compares a sentence with 128 partners at most: 129 alike are all compared, 130 lose one pair', () => {
    const within = emptyStats();
    detectContradictions(apart(saidAgain(129)), NOW, within);
    expect(within.cappedSentences).toBe(0);
    expect(within.pairsCompared).toBe((129 * 128) / 2);
    const over = emptyStats();
    detectContradictions(apart(saidAgain(130)), NOW, over);
    expect(over.cappedSentences).toBe(1);
    expect(over.pairsCompared).toBe((130 * 129) / 2 - 1);
  });

  it('compares a sentence with no more than the limit of its partners', () => {
    const families = ['alpha', 'bravo', 'charlie', 'delta'];
    const stats = emptyStats();
    const sentences = families.flatMap((family) => saidAgain(450, family));
    detectContradictions(apart(sentences), NOW, stats);
    // Each family is a list of 450, which is read; the words all families share are not.
    expect(stats.skippedLists).toBeGreaterThan(0);
    expect(stats.postingVisits).toBeGreaterThan(0);
    expect(stats.cappedSentences).toBeGreaterThan(0);
    expect(stats.pairsCompared).toBeLessThanOrEqual(stats.sentences * MAX_CANDIDATES_PER_SENTENCE);
    // Every pair within a family, which is what an uncapped scan compares, is 4 x 450 x 449 / 2.
    expect(stats.pairsCompared).toBeLessThan(404_100 * 0.6);
  });

  describe('when a sentence has more partners than it is compared with', () => {
    const BASE = [
      'harbour',
      'ferry',
      'council',
      'island',
      'route',
      'budget',
      'tender',
      'safety',
      'winter',
    ];
    const sentence = (words: string[], figure: number): string =>
      `The ${words.join(' ')} plan covers ${figure} units.`;
    const first = sentence(BASE, 100);
    // Shares six of the ten words with the first, the closest a statement can be and still be paired.
    const weak = (k: number): string =>
      sentence([...BASE.slice(0, 6), token(4 * k), token(4 * k + 1), token(4 * k + 2)], 200 + k);
    // Shares every word: the one partner that the cap must not drop, wherever it comes.
    const strong = sentence(BASE, 300);
    const crowd = Array.from({ length: 300 }, (_, k) => weak(k));

    it.each([
      ['last', [first, ...crowd, strong]],
      ['first', [strong, ...crowd, first]],
    ])('keeps the closest partner of a sentence, when it comes %s', (_where, sentences) => {
      const stats = emptyStats();
      const found = detectContradictions(apart(sentences), NOW, stats);
      expect(stats.cappedSentences).toBeGreaterThan(0);
      expect(found[0]).toMatchObject({ kind: 'numeric', confidence: 0.95 });
      expect([found[0]?.leftValue, found[0]?.rightValue].sort()).toEqual(['100', '300']);
    });
  });

  describe('when a document says the same sentence again, word for word', () => {
    const SAME = 'The council recorded 100 permits during 2025 across the harbour district.';
    const OTHER = 'The council recorded 110 permits during 2025 across the harbour district.';
    const said = (copies: number): SourceDocument => ({
      id: 'D1',
      name: 'repeats.md',
      content: Array.from({ length: copies }, () => SAME).join(' '),
    });
    const other: SourceDocument = { id: 'D2', name: 'register.md', content: OTHER };

    it.each([500, 513, 3_000])(
      'still finds the disagreement with a document that says it %i times',
      (copies) => {
        const stats = emptyStats();
        const found = detectContradictions(chunkDocuments([said(copies), other]), NOW, stats);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ kind: 'numeric' });
        expect([found[0]?.leftValue, found[0]?.rightValue].sort()).toEqual(['100', '110']);
        // The copies are one sentence, so no list is long enough to be left unread.
        expect(stats.skippedLists).toBe(0);
        expect(stats.sentences).toBeLessThan(10);
      },
    );

    it('finds the same one whatever order the passages arrive in', () => {
      const passages = chunkDocuments([said(600), other]);
      const sides = (found: ContradictionRecord[]) =>
        found.map((entry) =>
          [
            `${entry.left.documentId}:${entry.leftValue}`,
            `${entry.right.documentId}:${entry.rightValue}`,
          ].sort(),
        );
      const forward = detectContradictions(passages, NOW);
      const backward = detectContradictions([...passages].reverse(), NOW);
      expect(forward).toHaveLength(1);
      expect(sides(backward)).toEqual(sides(forward));
      expect(sides(forward)).toEqual([['D1:100', 'D2:110']]);
    });

    it('keeps one copy for each document, so that a second source saying it is not lost', () => {
      const agreeing: SourceDocument = { id: 'D3', name: 'press.md', content: SAME };
      const found = detectContradictions(chunkDocuments([said(600), agreeing, other]), NOW);
      expect(
        new Set(found.flatMap((entry) => [entry.left.documentId, entry.right.documentId])),
      ).toEqual(new Set(['D1', 'D2', 'D3']));
    });
  });

  describe('among thousands of sentences that share common words', () => {
    // Every filler sentence holds the same six words, and one word of its own.
    const filler = (i: number): string =>
      `Harbour board item ${token(i)} costs ${10 + (i % 80)} pounds.`;
    // The two statements share ten words, six of which the filler holds too, and give different figures.
    const left = 'The harbour board item for the Skerry Point tidal turbine costs 412 pounds.';
    const right = 'The harbour board item for the Skerry Point tidal turbine costs 365 pounds.';
    const around = (at: number): string[] => {
      const sentences = Array.from({ length: 5_000 }, (_, i) => filler(i));
      sentences.splice(at, 0, left);
      sentences.splice(at + 7, 0, right);
      return sentences;
    };

    it.each([0, 2_500, 4_990])(
      'still finds a clear contradiction between two statements at %i',
      (at) => {
        const stats = emptyStats();
        const found = detectContradictions(apart(around(at)), NOW, stats);
        // The common words are not used to look for partners, yet the pair is judged on all it shares.
        expect(stats.skippedLists).toBeGreaterThan(0);
        expect(stats.sentences).toBeGreaterThan(5_000);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ kind: 'numeric', confidence: 0.95 });
        expect([found[0]?.leftValue, found[0]?.rightValue].sort()).toEqual(['365', '412']);
        expect(found[0]?.topic).toContain('harbour');
        expect(found[0]?.topic).toContain('skerry');
      },
    );

    it('finds it whichever way round the passages arrive', () => {
      const forward = detectContradictions(apart(around(2_500)), NOW);
      const backward = detectContradictions(apart(around(2_500).reverse()), NOW);
      expect(forward).toHaveLength(1);
      expect(backward.map((c) => [c.kind, c.confidence, c.topic])).toEqual(
        forward.map((c) => [c.kind, c.confidence, c.topic]),
      );
    });
  });
});
