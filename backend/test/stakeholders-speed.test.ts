import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '../../shared/types.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { discoverStakeholders } from '../src/stakeholders/discover.js';
import { sentencesOf } from '../src/stakeholders/mentions.js';

// Discovery reads text that anyone can put in a source, on the server's one thread. A document is up to
// 40,000 characters and a project holds ten: the time it takes must grow with the length of the text and
// not with the square of it, whatever the text is made of.

const LIMIT_MS = 500;
const DOCUMENT = 40_000;
const repeated = (unit: string, chars = DOCUMENT): string =>
  unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);

/** The way sentences were cut before the single pass: a regular expression that backtracks over a long run of full stops. */
function cutByExpression(text: string): { text: string; start: number }[] {
  const found: { text: string; start: number }[] = [];
  let from = 0;
  const push = (end: number): void => {
    const raw = text.slice(from, end);
    const trimmed = raw.trim();
    if (trimmed) found.push({ text: trimmed, start: from + raw.indexOf(trimmed) });
  };
  for (const match of text.matchAll(/[.!?]+(?=\s|$)|\n+/gu)) {
    const index = match.index;
    push(match[0].startsWith('\n') ? index : index + match[0].length);
    from = index + match[0].length;
  }
  push(text.length);
  return found;
}

function milliseconds(work: () => unknown): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

describe('cutting a passage into sentences', () => {
  it('ends a sentence at . ! ? that white space or the end follows, and before a line break', () => {
    const text = 'First one. Second! Third?\nFourth line\n\nFifth 3.14 is not a boundary...  Sixth';
    const cut = sentencesOf(text);
    expect(cut.map((sentence) => sentence.text)).toEqual([
      'First one.',
      'Second!',
      'Third?',
      'Fourth line',
      'Fifth 3.14 is not a boundary...',
      'Sixth',
    ]);
    for (const sentence of cut) {
      expect(text.slice(sentence.start, sentence.start + sentence.text.length)).toBe(sentence.text);
    }
    expect(sentencesOf('')).toEqual([]);
    expect(sentencesOf(' \n . \n ')).toEqual([{ text: '.', start: 3 }]);
  });

  it('cuts exactly where the regular expression it replaced did, on any mix of the characters that matter', () => {
    const alphabet = ['a', 'b', ' ', ' ', '.', '.', '!', '?', '\n', '\r', '\t', '\u00a0', '…', '3'];
    let seed = 20_260_301;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let round = 0; round < 4_000; round += 1) {
      const length = next() % 28;
      const text = Array.from({ length }, () => alphabet[next() % alphabet.length]).join('');
      expect(sentencesOf(text), JSON.stringify(text)).toEqual(cutByExpression(text));
    }
  });

  const RUNS: [string, string][] = [
    ['full stops', repeated('.')],
    ['full stops with a letter at the end', repeated('.', DOCUMENT - 1) + 'x'],
    ['full stops between letters', `x${repeated('.', DOCUMENT - 2)}x`],
    ['a full stop and a space, over and over', repeated('. ')],
    ['a full stop and a space, then a letter', repeated('. ', DOCUMENT - 1) + 'x'],
    ['exclamation and question marks', repeated('!?')],
    ['exclamation and question marks, then a letter', repeated('!?', DOCUMENT - 1) + 'x'],
    ['line breaks', repeated('\n')],
    ['white space then a word', `${repeated(' ', DOCUMENT - 9)} customer`],
  ];

  it.each(RUNS)('takes well under a second for 40,000 characters of %s', (_name, text) => {
    expect(text).toHaveLength(DOCUMENT);
    expect(milliseconds(() => sentencesOf(text))).toBeLessThan(LIMIT_MS);
  });
});

describe('reading a whole project for groups', () => {
  const chunks = (contents: readonly string[]) =>
    chunkDocuments(
      contents.map((content, index) => ({
        id: `D${index + 1}`,
        name: `source-${index + 1}.md`,
        content,
      })),
    ).map((chunk) => ({
      ...chunk,
      contentHash: createHash('sha256').update(chunk.text).digest('hex'),
    }));

  const discover = (
    passages: ReturnType<typeof chunks>,
    extra: { graph?: KnowledgeGraph | null; likely?: string[] } = {},
  ) =>
    discoverStakeholders({
      project: { question: 'What could happen if the change is made?', graph: extra.graph ?? null },
      scenario: extra.likely
        ? ({
            likelyStakeholders: extra.likely,
            assumptions: [],
            changes: [],
            alternatives: [],
          } as never)
        : null,
      passages,
      model: null,
      now: () => new Date('2026-03-01T09:00:00.000Z'),
    });

  /** Distinct words made of letters only, so that each one is a different name. */
  const words = (count: number, prefix: string): string[] =>
    Array.from({ length: count }, (_, index) => {
      let rest = index;
      let word = '';
      do {
        word = String.fromCharCode(97 + (rest % 26)) + word;
        rest = Math.floor(rest / 26);
      } while (rest > 0);
      return `${prefix}${word}`;
    });
  const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

  it('does not compare thousands of different names that end in the same word with one another', async () => {
    // Every one of these is a group of its own ("Aab team", "Aac team", ...): folding names looked at
    // every pair, which took five seconds for one document.
    const text = words(4_000, 'q')
      .map((word) => `${capital(word)} team`)
      .join(' ')
      .slice(0, DOCUMENT);
    const passages = chunks([text]);
    const start = performance.now();
    const set = await discover(passages);
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(set.stakeholders.length).toBeGreaterThan(0);
  });

  it('keeps a project of ten full documents, a graph of forty people and organisations and twenty named groups to a few seconds', async () => {
    const sentences = [
      'The customers asked whether the new fee would apply to existing plans.',
      'Regulators want notice before any change to charges takes effect.',
      'Support engineers expect more calls from small clients in the first weeks.',
      'A rival provider has already published a lower price for the same service.',
      'The finance team cannot say who pays until the terms are agreed.',
      'Administrators decide which options are switched on for each workspace.',
    ];
    const documents = Array.from({ length: 10 }, (_, index) =>
      repeated(`${sentences.map((sentence) => `${sentence} Note ${index}.`).join(' ')} `),
    );
    const names = [
      'Customers',
      'Regulators',
      'Support engineers',
      'Rival provider',
      'Finance team',
      'Administrators',
      'Clients',
      'Resellers',
      'Auditors',
      'Partners',
    ];
    const graph = {
      nodes: Array.from({ length: 40 }, (_, index) => ({
        id: `n${index}`,
        label: `${names[index % names.length]}${index >= names.length ? ` ${index}` : ''}`,
        kind: index % 3 === 0 ? 'person' : 'organization',
        summary: 'A group in the sources.',
        sourceIds: [],
      })),
      edges: [],
      note: '',
    } as unknown as KnowledgeGraph;
    const passages = chunks(documents);
    expect(passages.length).toBeGreaterThan(300);
    const start = performance.now();
    const set = await discover(passages, { graph, likely: [...names, ...names].slice(0, 20) });
    expect(performance.now() - start).toBeLessThan(3_000);
    expect(set.stakeholders.length).toBeGreaterThan(5);
  });
});
