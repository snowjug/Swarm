// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Ledger } from '../../../../shared/evidence';
import type { EvidenceMatch, ProjectDetail } from '../../../../shared/types';
import { api } from '../../api';
import { renderWithApp, screen, waitFor, within } from '../../test/dom';
import { passagesOf, project, twoConflicts } from './fixtures';
import { findMark } from './passages';
import GroundScene from './index';

// The scene used the way a person uses it: pressed, tabbed and closed again. What is asserted is what happens
// and where focus is, because the things that went wrong here were not in how anything was drawn.

/** The server this scene talks to: every passage for an empty search, `matches` for a word, the ledger it is given. */
function serve({
  ledger = twoConflicts(),
  matches = () => [],
}: { ledger?: Ledger; matches?: (query: string) => EvidenceMatch[] } = {}): ProjectDetail {
  const source = project();
  vi.spyOn(api, 'evidence').mockImplementation(async (_id, query) => ({
    query,
    matches: query ? matches(query) : passagesOf(source).map((chunk) => ({ ...chunk, score: 0 })),
  }));
  vi.spyOn(api, 'ledger').mockResolvedValue(ledger);
  return source;
}

function openScene(source: ProjectDetail, mode: 'guided' | 'advanced' = 'guided') {
  return renderWithApp(<GroundScene />, { workspace: { project: source, mode } });
}

const passageBar = (id: string) =>
  screen.findByRole('button', { name: new RegExp(`^Passage ${id},`, 'u') });

describe('a document read in the sheet', () => {
  it('lets go of a passage that was pressed without breaking the page', async () => {
    const { user } = openScene(serve());
    const sources = await screen.findByRole('list', { name: 'Sources' });
    await user.click(within(sources).getByRole('button', { name: /01-note\.md$/u }));
    const sheet = await screen.findByRole('dialog');
    const chip = within(
      within(sheet).getByRole('list', { name: 'Passages in this document' }),
    ).getByRole('button', { name: 'S1' });

    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    // Pressed a second time it is let go: with no passage and no quotation there is nothing to scroll to,
    // and looking for it used to throw, which took the whole page with it.
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('dialog')).toBe(sheet);
  });

  it('finds the mark to scroll to without building a selector from anything it was given', () => {
    const mark = (attributes: Record<string, string>) => {
      const element = document.createElement('span');
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      return element;
    };
    const root = document.createElement('div');
    const first = mark({ 'data-start': 'S1 S2' });
    const quoted = mark({ 'data-start': 'S10', 'data-quoted': 'true' });
    root.append(first, quoted);

    expect(findMark(root, false, null)).toBeNull();
    expect(findMark(root, false, '')).toBeNull();
    expect(findMark(root, false, 'S2')).toBe(first);
    expect(findMark(root, false, 'S1')).toBe(first);
    expect(findMark(root, false, 'S3')).toBeNull();
    expect(findMark(root, true, null)).toBe(quoted);
    for (const odd of ['S1"]', "S1'", 'S1 S2', '[x]', ']', '\\', '😀']) {
      expect(() => findMark(root, false, odd)).not.toThrow();
    }
    expect(findMark(root, false, 'S1"]')).toBeNull();
  });
});

describe('going to a conflict from a sheet', () => {
  it('leaves focus on the conflict, once the sheet has gone, and not on the passage the sheet was opened from', async () => {
    const { user } = openScene(serve());
    await user.click(await passageBar('S1'));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Conflict X1' }));

    const conflict = await screen.findByRole('article', { name: /^X1:/u });
    await waitFor(() => expect(document.activeElement).toBe(conflict));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(conflict),
    );
    // Nothing takes it back: the sheet's own way of returning focus, and the stack's, both stand aside.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.activeElement).toBe(conflict);
    expect(conflict.getAttribute('tabindex')).toBe('-1');
  });

  it('opens the reviewed conflicts for one that was settled, and goes to it', async () => {
    const { user } = openScene(serve());
    await user.click(await passageBar('S1'));
    const sheet = await screen.findByRole('dialog');
    // X2 was dismissed: it is among the reviewed, which are folded away until they are asked for.
    await user.click(within(sheet).getByRole('button', { name: 'Conflict X2' }));

    const conflict = await screen.findByRole('article', { name: /^X2:/u });
    await waitFor(() => expect(document.activeElement).toBe(conflict));
  });
});

describe('closing a stack of sheets', () => {
  it('gives focus back to what opened the first, though the sheet changed on the way', async () => {
    const { user } = openScene(serve());
    const bar = await passageBar('S1');
    await user.click(bar);
    await user.click(await screen.findByRole('button', { name: 'Read in the document' }));
    await screen.findByRole('button', { name: 'Back' });

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(bar));
  });
});

describe('searching the passages', () => {
  const match = (id: string, index: number): EvidenceMatch => ({
    id,
    documentId: 'D1',
    documentName: '01-note.md',
    start: index * 10,
    end: index * 10 + 9,
    text: `Delivery is mentioned in passage ${id}.`,
    score: 1 - index / 10,
  });
  const search = async (query: string, count: number) => {
    const source = serve({
      matches: () => Array.from({ length: count }, (_, index) => match(`S${index + 1}`, index)),
    });
    const { user } = openScene(source);
    await user.click(await screen.findByRole('button', { name: /passages/iu }));
    const field = await screen.findByRole('searchbox', { name: 'Search the passages' });
    await user.type(field, `${query}{Enter}`);
    return screen.findByRole('status');
  };

  it('says it is the best few, and that there may be more, when the server has given all it gives', async () => {
    const said = await search('delivery', 5);
    await waitFor(() =>
      expect(said.textContent).toBe('The best 5 matches for “delivery”. There may be more.'),
    );
  });

  it('counts the passages when the answer was shorter than the most it gives', async () => {
    const said = await search('delivery', 2);
    await waitFor(() => expect(said.textContent).toBe('2 matches for “delivery”'));
  });
});

describe('what the graph’s controls advertise', () => {
  const tooltipOf = async (name: string) => {
    const { user } = openScene(serve());
    await user.hover(await screen.findByRole('button', { name }));
    return screen.findByRole('tooltip');
  };

  it('advertises no key for the topic finder, which nothing listens for', async () => {
    expect((await tooltipOf('Find a topic')).textContent).toBe('Find a topic');
  });

  it('still advertises the keys the graph does answer', async () => {
    expect((await tooltipOf('Fit to view')).textContent).toMatch(/Fit to view\s*R/u);
  });
});

// ---- Label in name (WCAG 2.5.3) ----------------------------------------------------------------------------

const squash = (text: string) => text.replace(/\s+/gu, ' ').trim().toLowerCase();

/** The words a control shows: what is drawn as text, which is not an icon and is not for a screen reader only. */
function shownText(control: Element): string {
  const clone = control.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('svg, .sr-only')) hidden.remove();
  return squash(clone.textContent ?? '');
}

/** The name a screen reader gives a control: its label if it has one, else what is inside it that is not hidden. */
function nameOf(control: Element): string {
  const by = control.getAttribute('aria-labelledby');
  if (by) {
    return squash(
      by
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    );
  }
  const label = control.getAttribute('aria-label');
  if (label) return squash(label);
  const clone = control.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"], svg, .sr-only'))
    hidden.remove();
  return squash(clone.textContent ?? '');
}

/** Every control whose name does not hold the words it shows: a person who says what they see cannot press it. */
function mismatches(root: ParentNode): string[] {
  const found: string[] = [];
  for (const control of root.querySelectorAll('button, a[href], [role="button"], [role="link"]')) {
    const shown = shownText(control);
    if (shown && !nameOf(control).includes(shown)) {
      found.push(
        `${control.tagName.toLowerCase()}.${control.className}: “${shown}” is not in “${nameOf(control)}”`,
      );
    }
  }
  return found;
}

describe('the names of controls', () => {
  it('hold the words each control shows, on the page and in the sheets', async () => {
    const { user, container } = openScene(serve());
    await passageBar('S1');
    await screen.findByRole('article', { name: /^X1:/u });
    expect(mismatches(container)).toEqual([]);

    await user.click(await passageBar('S1'));
    const sheet = await screen.findByRole('dialog');
    expect(mismatches(sheet)).toEqual([]);
    await user.click(within(sheet).getByRole('button', { name: 'Read in the document' }));
    await screen.findByRole('button', { name: 'Back' });
    expect(mismatches(screen.getByRole('dialog'))).toEqual([]);
  });
});
