// @vitest-environment jsdom
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyResponseShares } from '../../../../shared/analysis';
import { analysisFixture } from '../../../../shared/lab-fixtures';
import { act, reduceMotion, renderWithApp, screen, setMedia, within } from '../../test/dom';
import type { Mover } from './movement';
import { Movers } from './Movers';
import { scenariosOf } from './scenarios';

// Pressing an actor on the map brings that actor's row into view in the list beside it. An actor that ranks past the
// first few has no row until the list has opened to show all of them, so the row is looked for once it is there.

// The map is a picture of its own: here it is a button for each actor that selects it, which is all the list is told.
vi.mock('../../viz/ecosystem/Ecosystem', () => ({
  Ecosystem: ({
    nodes,
    onSelect,
  }: {
    nodes: { id: string; label: string }[];
    onSelect: (id: string) => void;
  }) =>
    createElement(
      'div',
      null,
      nodes.map((node) =>
        createElement(
          'button',
          { key: node.id, type: 'button', onClick: () => onSelect(node.id) },
          `On the map: ${node.label}`,
        ),
      ),
    ),
}));
vi.mock('./hooks', async (original) => ({
  ...(await original<typeof import('./hooks')>()),
  useInView: () => [{ current: null }, true],
}));

const analysis = analysisFixture();
const scenarios = scenariosOf(analysis);
const pair = { a: scenarios[0]!.id, b: scenarios[1]!.id };

/** Twelve actors, the first the one that moved most: ranked by the size of the move, so the tenth is past the first eight. */
const movers: Mover[] = Array.from({ length: 12 }, (_, index) => ({
  id: `actor-${index + 1}`,
  name: `Actor ${index + 1}`,
  role: 'Someone in the model',
  kind: 'key',
  category: 'end-user',
  categoryLabel: 'End user',
  group: 'customers',
  members: 1,
  size: 1,
  a: 0,
  b: -(0.6 - index * 0.04),
  delta: -(0.6 - index * 0.04),
  sharesA: emptyResponseShares(),
  sharesB: emptyResponseShares(),
}));

// The picture's actors are the analysis's own: name them for the movers, by position.
analysis.actors = movers.map((mover, index) => ({
  ...analysis.actors[index % analysis.actors.length]!,
  id: mover.id,
  name: mover.name,
}));

const scrolled = vi.fn();
beforeEach(() => {
  scrolled.mockReset();
  Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
    scrolled(this.getAttribute('data-mover'), options);
  };
  setMedia('min-width: 64rem', true);
});

const show = () =>
  renderWithApp(
    <Movers
      analysis={analysis}
      pair={pair}
      scenarios={scenarios}
      movers={movers}
      source="actors"
    />,
  );
const onTheMap = (name: string) => screen.getByRole('button', { name: `On the map: ${name}` });

describe('the row of an actor pressed on the map', () => {
  it('is brought into view, smoothly, when the actor ranks among the first few', async () => {
    const { user } = show();
    await user.click(onTheMap('Actor 3'));
    expect(scrolled).toHaveBeenCalledExactlyOnceWith('actor-3', {
      block: 'nearest',
      behavior: 'smooth',
    });
  });

  it('is brought into view once the list has opened for an actor that ranks past the first eight', async () => {
    const { user } = show();
    const list = () => screen.getByRole('list', { name: 'Actors, those who moved most first' });
    expect(within(list()).queryByText('Actor 10')).toBeNull();
    await user.click(onTheMap('Actor 10'));
    expect(await screen.findByRole('button', { name: 'Show fewer' })).toBeTruthy();
    expect(scrolled).toHaveBeenCalledExactlyOnceWith('actor-10', {
      block: 'nearest',
      behavior: 'smooth',
    });
  });

  it('is brought into view without motion when motion is reduced', async () => {
    reduceMotion();
    const { user } = show();
    await user.click(onTheMap('Actor 10'));
    await screen.findByRole('button', { name: 'Show fewer' });
    expect(scrolled).toHaveBeenCalledExactlyOnceWith('actor-10', {
      block: 'nearest',
      behavior: 'auto',
    });
  });

  it('is not looked for again when the whole list is opened afterwards by hand', async () => {
    const { user } = show();
    await user.click(onTheMap('Actor 3'));
    await user.click(screen.getByRole('button', { name: 'Show all 12' }));
    await act(async () => undefined);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });
});
