import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MotionRoot } from '../../design/motion';
import { TooltipProvider } from '../../design/ui';
import { MAX_DOCUMENTS } from '../../../../shared/types';
import { POSITIONING_STATEMENT } from '../../lib/product';
import { AskScene } from './AskScene';
import {
  base64,
  carryKey,
  fileKind,
  fileProblem,
  keyOf,
  limitsOf,
  nextPasteName,
  sizeText,
  splitRequestId,
  totalOf,
} from './evidence';
import {
  EXAMPLE_SCENARIOS,
  OFFERED_EXAMPLES,
  STARTER,
  exampleLabel,
  startingFromExample,
  startingFromStarter,
} from './examples';
import { ago } from './time';

const limits = limitsOf(null);

describe('what a file may be', () => {
  it('knows the kinds Swarm reads, and no others', () => {
    expect(fileKind('notes.TXT')).toBe('text');
    expect(fileKind('brief.md')).toBe('text');
    expect(fileKind('table.csv')).toBe('table');
    expect(fileKind('data.json')).toBe('table');
    expect(fileKind('paper.pdf')).toBe('pdf');
    expect(fileKind('picture.png')).toBeNull();
    expect(fileKind('noextension')).toBeNull();
  });

  it('says why a file cannot be read before anything is read from it', () => {
    expect(fileProblem({ name: 'a.png', size: 10 }, limits, true)).toMatch(/UTF-8 TXT/u);
    expect(fileProblem({ name: 'a.pdf', size: 10 }, limits, false)).toMatch(/unavailable/u);
    expect(fileProblem({ name: 'a.pdf', size: limits.maxBytes + 1 }, limits, true)).toMatch(
      /2 MB/u,
    );
    expect(fileProblem({ name: 'a.csv', size: limits.maxBytes + 1 }, limits, true)).toMatch(
      /2 MB/u,
    );
    expect(fileProblem({ name: 'a.txt', size: limits.maxChars * 4 + 1 }, limits, true)).toMatch(
      /characters/u,
    );
    expect(fileProblem({ name: 'a.txt', size: 1000 }, limits, true)).toBeNull();
  });

  it('uses the server’s limits once it has said them, and the shared ones before', () => {
    expect(limits.maxDocuments).toBe(MAX_DOCUMENTS);
    expect(limitsOf({ limits: { maxDocuments: 3 } } as never).maxDocuments).toBe(3);
  });

  it('names sizes briefly and the next pasted source so that no name is taken twice', () => {
    expect(sizeText(412)).toBe('412 characters');
    expect(sizeText(1900)).toBe('1.9k characters');
    expect(sizeText(23_000)).toBe('23k characters');
    const doc = (name: string, content = 'x') => ({ name, content });
    expect(nextPasteName([])).toBe('notes.txt');
    expect(nextPasteName([doc('notes.txt')])).toBe('notes-2.txt');
    expect(nextPasteName([doc('notes.txt'), doc('notes-2.txt')])).toBe('notes-3.txt');
    expect(totalOf([doc('a', 'abc'), doc('b', 'de')])).toBe(5);
  });

  it('encodes bytes in chunks a call can take', () => {
    const bytes = new Uint8Array(100_000).map((_, index) => index % 251);
    const encoded = base64(bytes);
    expect(atob(encoded).length).toBe(100_000);
    expect(atob(encoded).charCodeAt(250)).toBe(250);
  });

  it('sets the number to quote apart from the words of what the server said', () => {
    expect(splitRequestId('The PDF could not be read. Request ID: 0b1c-22')).toEqual({
      words: 'The PDF could not be read.',
      requestId: '0b1c-22',
    });
    expect(splitRequestId(' No number here. ')).toEqual({
      words: 'No number here.',
      requestId: null,
    });
  });

  it('knows a source by what it is, so that taking one away moves no other, and a correction keeps its key', () => {
    const first = { name: 'a.md', content: 'x'.repeat(100) };
    const second = { name: 'a.md', content: 'x'.repeat(100) };
    expect(keyOf(first)).toBe(keyOf(first));
    expect(keyOf(first)).not.toBe(keyOf(second));
    const corrected = carryKey(first, { ...first, content: 'y'.repeat(100) });
    expect(keyOf(corrected)).toBe(keyOf(first));
  });
});

describe('the ways to start', () => {
  it('offers the examples in an order that leads with no company, and every one of them', () => {
    expect(OFFERED_EXAMPLES.map((example) => example.id).sort()).toEqual(
      EXAMPLE_SCENARIOS.map((example) => example.id).sort(),
    );
    expect(OFFERED_EXAMPLES[0]!.id).toBe('launch-pricing');
    expect(OFFERED_EXAMPLES.at(-1)!.id).toBe('copilot-in-teams');
  });

  it('turns an example into a question and its evidence, and says what comes with it', () => {
    const example = EXAMPLE_SCENARIOS[0]!;
    const starting = startingFromExample(example);
    expect(starting.question).toBe(example.question);
    expect(starting.documents.length).toBe(example.documents.length);
    expect(starting.summary).toMatch(/sample evidence$/u);
    expect(starting.name.length).toBeLessThanOrEqual(100);
    expect(exampleLabel(example).length).toBeLessThanOrEqual(24);
  });

  it('has a starter that is plainly fictional', () => {
    const starting = startingFromStarter();
    expect(starting.id).toBe(STARTER.id);
    expect(starting.documents[0]!.content).toMatch(/fictional/iu);
    expect(starting.summary).toMatch(/invented/u);
    starting.documents[0]!.name = 'changed';
    expect(STARTER.documents[0]!.name).not.toBe('changed');
  });
});

describe('time', () => {
  it('says how long ago in the reader’s words, and nothing for a date that is not one', () => {
    const now = Date.parse('2026-03-10T12:00:00Z');
    expect(ago('2026-03-10T11:00:00Z', now)).toMatch(/hour/u);
    expect(ago('2026-03-09T12:00:00Z', now)).toMatch(/yesterday|day/u);
    expect(ago('nonsense', now)).toBe('');
  });
});

describe('the first screen', () => {
  const html = renderToStaticMarkup(
    <MotionRoot>
      <TooltipProvider>
        <AskScene
          config={null}
          busy={false}
          onSubmit={async () => undefined}
          history={{ projects: [], loading: false, error: null }}
          onOpenProject={() => undefined}
          onRetryHistory={() => undefined}
          onHistory={() => undefined}
          mode="guided"
        />
      </TooltipProvider>
    </MotionRoot>,
  );

  it('says in one heading what Swarm is for, and asks the one question', () => {
    expect(html).toContain('Explore what could');
    expect(html).toContain('happen');
    expect(html).toContain('What change do you want to explore?');
    expect(html.match(/<h1/gu)).toHaveLength(1);
  });

  it('has the composer, its evidence and the way to go on, each with a name', () => {
    expect(html).toMatch(/<textarea[^>]*aria-label="[^"]+"|<label[^>]*for=/u);
    expect(html).toContain('Evidence');
    expect(html).toContain('Explore');
  });

  it('keeps the statement of what Swarm is not, in the words it was verified with', () => {
    expect(html).toContain(POSITIONING_STATEMENT);
  });

  it('shows the whole journey, as a list in order', () => {
    const order = ['Ask', 'Ground', 'Map', 'Simulate', 'Compare', 'Decide'].map((name) =>
      html.indexOf(`<strong>${name}</strong>`),
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('writes nothing that claims a prediction', () => {
    expect(html).not.toMatch(/\bpredicts?\b(?! real)/iu);
    expect(html).not.toMatch(/probab/iu);
  });
});
