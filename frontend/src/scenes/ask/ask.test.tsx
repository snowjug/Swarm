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
  editedPage,
  fileKind,
  fileProblem,
  firstUrl,
  keyOf,
  limitsOf,
  nextPasteName,
  roomProblem,
  samePage,
  siteOf,
  sizeText,
  splitRequestId,
  totalOf,
  withText,
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
    expect(fileProblem({ name: 'a.png', size: 10 }, limits, true)).toMatch(/UTF-8 TXT.*PDF/u);
    // Where PDFs are not read, a person is not told to bring one.
    expect(fileProblem({ name: 'a.png', size: 10 }, limits, false)).not.toMatch(/PDF/u);
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

  it('says in one sentence why a source has no room, whatever the source is, and says nothing when it has', () => {
    const doc = (content: string) => ({ name: 'a.txt', content });
    const small = { ...limits, maxDocuments: 2, maxTotal: 10 };
    expect(roomProblem([], 10, small)).toBeNull();
    expect(roomProblem([doc('abcde')], 5, small)).toBeNull();
    const words = 'Use at most 2 documents and 10 total characters.';
    // Too many sources, or too much text between them.
    expect(roomProblem([doc('a'), doc('b')], 1, small)).toBe(words);
    expect(roomProblem([doc('abcde')], 6, small)).toBe(words);
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

  it('stops calling a fetched page a retrieved page once its text is not the text that came, and says it is again when it is', () => {
    const page = {
      name: 'page.txt',
      content: `${'The pilot ran for six weeks. '.repeat(5)}\n`,
      provenance: {
        kind: 'url' as const,
        url: 'https://example.org/pilot',
        sha256: 'a'.repeat(64),
        fetchedByServer: true,
      },
    };
    const edited = withText(page, `${page.content}One more sentence.`);
    expect(edited.provenance).toEqual({ kind: 'paste' });
    expect(editedPage(edited)).toBe(true);
    expect(keyOf(edited)).toBe(keyOf(page));
    // Edited again, and put back as it came (the ends do not count, as the server trims them): the page it was.
    const again = withText(edited, `  ${page.content.trim()}  `);
    expect(again.provenance).toEqual(page.provenance);
    expect(editedPage(again)).toBe(false);
    // A source that was never fetched is only given its new text.
    const typed = {
      name: 'n.md',
      content: 'x'.repeat(100),
      provenance: { kind: 'paste' as const },
    };
    expect(withText(typed, 'y'.repeat(100)).provenance).toEqual({ kind: 'paste' });
    expect(editedPage(withText(typed, 'y'.repeat(100)))).toBe(false);
    const sample = {
      name: 's.md',
      content: 'x'.repeat(100),
      provenance: { kind: 'sample' as const },
    };
    expect(withText(sample, 'z'.repeat(100)).provenance).toEqual({ kind: 'sample' });
  });
});

describe('a page named in the question', () => {
  it('finds the address the question names, without the punctuation that closes the sentence', () => {
    expect(firstUrl('What if we follow https://example.org/fees? Or not.')).toBe(
      'https://example.org/fees',
    );
    expect(firstUrl('See (http://city.example.org/pilot), then decide.')).toBe(
      'http://city.example.org/pilot',
    );
    expect(firstUrl('Nothing here, and ftp://example.org/file is not a page.')).toBeNull();
    expect(firstUrl('https:// is not an address')).toBeNull();
    expect(siteOf('https://www.example.org/a/b')).toBe('example.org');
    expect(siteOf('not an address')).toBe('');
  });

  it('knows a source that is that page, by the address asked for or the one it ended on', () => {
    const fetched = {
      name: 'page.txt',
      content: 'x'.repeat(100),
      provenance: {
        kind: 'url' as const,
        url: 'https://example.org/fees',
        finalUrl: 'https://example.org/fees/2025/',
      },
    };
    expect(samePage(fetched, 'https://example.org/fees/')).toBe(true);
    expect(samePage(fetched, 'HTTPS://EXAMPLE.ORG/fees#top')).toBe(true);
    expect(samePage(fetched, 'https://example.org/fees/2025')).toBe(true);
    expect(samePage(fetched, 'https://example.org/other')).toBe(false);
    expect(samePage({ name: 'a.md', content: 'x'.repeat(100) }, 'https://example.org/fees')).toBe(
      false,
    );
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

  it('says in one heading what Swarm is for, and in one sentence what it does', () => {
    expect(html).toContain('See how a decision could');
    expect(html).toContain('unfold');
    expect(html).toContain(
      'Swarm researches the context, maps who matters, simulates reactions, and shows possible paths forward.',
    );
    expect(html.match(/<h1/gu)).toHaveLength(1);
  });

  it('keeps the hero to a few words: the heading and the sentence under it are all that is said before the question', () => {
    const hero = /<h1[^>]*>([^]*?)<\/h1>\s*<p[^>]*>([^]*?)<\/p>/u.exec(html);
    expect(hero).not.toBeNull();
    const words = (hero![1]! + ' ' + hero![2]!)
      .replace(/<[^>]+>/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(25);
  });

  it('has the composer, its evidence and the way to go on, each with a name', () => {
    expect(html).toMatch(/<label[^>]*for="swarm-question"[^>]*>Your what-if question<\/label>/u);
    expect(html).toContain('Evidence');
    expect(html).toContain('Explore');
  });

  it('keeps the statement of what Swarm is not, in the words it was verified with, under the short line', () => {
    expect(html).toContain('Explore scenarios, not predictions.');
    expect(html).toContain(POSITIONING_STATEMENT);
  });

  it('shows the way from a question to a decision, as a list in order', () => {
    const order = ['Question', 'Research', 'People', 'Possible futures', 'Decision'].map((name) =>
      html.indexOf(`aria-label="${name}"`),
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/<ol[^>]*aria-labelledby=/u);
  });

  it('writes nothing that claims a prediction', () => {
    expect(html).not.toMatch(/\bpredicts?\b(?! real)/iu);
    expect(html).not.toMatch(/probab/iu);
  });
});
