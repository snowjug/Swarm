// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stakeholderFixture, stakeholderSetFixture } from '../../../../shared/lab-fixtures';
import {
  act,
  fireEvent,
  reduceMotion,
  renderWithApp,
  setBox,
  screen,
  waitFor,
  within,
} from '../../test/dom';
import { Ecosystem, type EcosystemProps } from './Ecosystem';
import { edgesOf, nodesFromStakeholders } from './model';

// The picture is a real group of buttons: these tests use it as a person does (Tab, the arrows, Enter,
// Space, Escape, a press), and read what it shows from attributes and names. jsdom has no layout, so the
// host is given a size, and what the nodes' places are is read from where they were painted.

const set = stakeholderSetFixture();
const stakeholders = [
  ...set.stakeholders,
  stakeholderFixture('press', 'influencer'),
  stakeholderFixture('unions', 'end-user'),
  stakeholderFixture('auditors', 'governance'),
];
const NODES = nodesFromStakeholders(stakeholders);
const EDGES = edgesOf(set.relations, new Set(NODES.map((node) => node.id)));

const LABEL = 'Who is affected';

// A picture is laid out once it has a size; every test but the one about that starts with one.
beforeEach(() => setBox('.sw-eco', { width: 720, height: 480 }));

type Props = Partial<EcosystemProps>;

/** The picture with a selection of its own, which is how a scene holds it. */
function Held({
  onSelect,
  selectedId = null,
  ...props
}: Props & { onSelect?: (id: string | null) => void }) {
  const [selected, setSelected] = useState<string | null>(selectedId);
  return (
    <Ecosystem
      nodes={NODES}
      edges={EDGES}
      label={LABEL}
      selectedId={selected}
      onSelect={(id) => {
        setSelected(id);
        onSelect?.(id);
      }}
      {...props}
    />
  );
}

const map = () => screen.getByRole('group', { name: LABEL });
const nodeButtons = () => within(map()).getAllByRole('button');
const nodeNamed = (label: string) =>
  within(map()).getByRole('button', { name: new RegExp(`^${label},`, 'u') });
const stops = () => nodeButtons().filter((button) => button.getAttribute('tabindex') === '0');
const labelOf = (button: Element) => /^[^,]+/u.exec(button.getAttribute('aria-label') ?? '')![0];

/** Where each node was painted, by the id on its group. */
function placed(
  container: HTMLElement,
  nodes: readonly { id: string }[] = NODES,
): Map<string, { x: number; y: number }> {
  return new Map(
    nodes.map((node) => {
      const group = container.querySelector(`[data-id="${node.id}"]`)!;
      const [x, y] = /translate\(([-\d.]+) ([-\d.]+)\)/u
        .exec(group.getAttribute('transform') ?? '')!
        .slice(1)
        .map(Number);
      return [node.id, { x: x!, y: y! }];
    }),
  );
}
const idOf = (button: Element) => button.getAttribute('data-stk-focus')!.replace('node:', '');

describe('the map as one group of buttons', () => {
  it('has a name, a button for every party, and one stop in the tab order', async () => {
    const { user } = renderWithApp(
      <>
        <button type="button">Before</button>
        <Held />
      </>,
    );
    expect(nodeButtons()).toHaveLength(NODES.length);
    expect(nodeButtons().every((button) => button.getAttribute('aria-label'))).toBe(true);
    expect(nodeNamed('Provider').getAttribute('aria-label')).toBe(
      'Provider, Decision maker, unclear',
    );
    expect(stops()).toHaveLength(1);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(document.activeElement).toBe(stops()[0]);
    // The next Tab leaves the map, for its own controls; it does not walk through every party.
    await user.tab();
    expect(map().contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zoom in' }));
  });

  it('leaves the stop where focus last was, so that going back lands on the same party', async () => {
    const { user } = renderWithApp(
      <>
        <button type="button">Before</button>
        <Held />
      </>,
    );
    await user.tab();
    await user.tab();
    const first = document.activeElement!;
    await user.keyboard('{ArrowRight}');
    const second = document.activeElement!;
    expect(map().contains(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(stops()).toEqual([second]);
    expect(first.getAttribute('tabindex')).toBe('-1');

    await user.tab();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(second);
  });

  it('is laid out for the size it really has, not for a guess that it then glides away from', async () => {
    setBox('.sw-eco', { width: 0, height: 0 });
    const { container } = renderWithApp(<Held />);
    const first = container.querySelector(`[data-id="${NODES[0]!.id}"]`)!;
    expect(first.getAttribute('transform')).toBeNull();
    setBox('.sw-eco', { width: 390, height: 640 });
    await waitFor(() => expect(first.getAttribute('transform')).not.toBeNull());
    for (const { x, y } of placed(container).values()) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(390);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(640);
    }
  });

  it('is sized by its host, and follows it when it changes', async () => {
    setBox('.sw-eco', { width: 960, height: 560 });
    renderWithApp(<Held />);
    expect(map().getAttribute('viewBox')).toBe('0 0 960 560');
    setBox('.sw-eco', { width: 640, height: 420 });
    await waitFor(() => expect(map().getAttribute('viewBox')).toBe('0 0 640 420'));
  });
});

describe('choosing a party', () => {
  it('selects with Enter and with Space, and the same key again lets go', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithApp(<Held onSelect={onSelect} />);
    const provider = nodeNamed('Provider');
    provider.focus();
    expect(provider.getAttribute('aria-pressed')).toBe('false');

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('provider');
    expect(provider.getAttribute('aria-pressed')).toBe('true');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(provider.getAttribute('aria-pressed')).toBe('false');

    await user.keyboard(' ');
    expect(onSelect).toHaveBeenLastCalledWith('provider');
    expect(provider.getAttribute('aria-pressed')).toBe('true');
  });

  it('selects with a press on the party, and only that one is pressed', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithApp(<Held onSelect={onSelect} />);
    await user.click(nodeNamed('Regulator'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('regulator');
    expect(
      nodeButtons()
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
        .map(labelOf),
    ).toEqual(['Regulator']);

    await user.click(nodeNamed('Press'));
    expect(onSelect).toHaveBeenLastCalledWith('press');
    expect(
      nodeButtons()
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
        .map(labelOf),
    ).toEqual(['Press']);
  });

  it('lets go with Escape, and keeps Escape for whoever is above when nothing is selected', async () => {
    const onSelect = vi.fn();
    const above = vi.fn();
    const { user } = renderWithApp(
      <div onKeyDown={above}>
        <Held onSelect={onSelect} selectedId="provider" />
      </div>,
    );
    const provider = nodeNamed('Provider');
    provider.focus();
    expect(provider.getAttribute('aria-pressed')).toBe('true');

    await user.keyboard('{Escape}');
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(provider.getAttribute('aria-pressed')).toBe('false');
    // It was used here: a sheet around the map does not also close.
    expect(above).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(above).toHaveBeenCalledTimes(1);
  });

  it('lets go with a press on the background, and not at the end of a drag that panned the picture', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithApp(<Held onSelect={onSelect} selectedId="provider" />);
    const background = map();
    const viewport = () => Array.from(background.children).find((child) => child.tagName === 'g')!;
    const before = viewport().getAttribute('transform');

    await user.pointer([
      { keys: '[MouseLeft>]', target: background, coords: { clientX: 40, clientY: 40 } },
      { target: background, coords: { clientX: 120, clientY: 90 } },
      { keys: '[/MouseLeft]', target: background, coords: { clientX: 120, clientY: 90 } },
    ]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(viewport().getAttribute('transform')).not.toBe(before);
    expect(nodeNamed('Provider').getAttribute('aria-pressed')).toBe('true');

    await user.pointer([
      { keys: '[MouseLeft>]', target: background, coords: { clientX: 300, clientY: 300 } },
      { keys: '[/MouseLeft]', target: background, coords: { clientX: 300, clientY: 300 } },
    ]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(nodeNamed('Provider').getAttribute('aria-pressed')).toBe('false');
  });

  it('offers an empty slot that opens what it is for, and never selects it', async () => {
    const onSelect = vi.fn();
    const onGhost = vi.fn();
    const { user } = renderWithApp(
      <Held
        onSelect={onSelect}
        onGhost={onGhost}
        ghosts={[{ id: 'ghost-rival', label: 'Rivals', cluster: 'rival' }]}
      />,
    );
    const slot = within(map()).getByRole('button', { name: 'Add Rivals' });
    expect(slot.hasAttribute('aria-pressed')).toBe(false);
    await user.click(slot);
    slot.focus();
    await user.keyboard('{Enter}');
    expect(onGhost).toHaveBeenCalledTimes(2);
    expect(onGhost).toHaveBeenCalledWith('ghost-rival');
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('moving between parties with the arrows', () => {
  const AXES = {
    ArrowRight: (dx: number, dy: number) => ({ along: dx, across: Math.abs(dy) }),
    ArrowLeft: (dx: number, dy: number) => ({ along: -dx, across: Math.abs(dy) }),
    ArrowDown: (dx: number, dy: number) => ({ along: dy, across: Math.abs(dx) }),
    ArrowUp: (dx: number, dy: number) => ({ along: -dy, across: Math.abs(dx) }),
  } as const;

  it('goes to a party that lies the way the key points, the nearest of those, or stays when none does', async () => {
    const { user, container } = renderWithApp(<Held drift={false} />);
    const where = placed(container);
    const move = (from: string, to: string, key: keyof typeof AXES) => {
      const a = where.get(from)!;
      const b = where.get(to)!;
      return AXES[key](b.x - a.x, b.y - a.y);
    };

    let moved = 0;
    for (const start of NODES) {
      for (const key of Object.keys(AXES) as (keyof typeof AXES)[]) {
        nodeNamed(start.label).focus();
        await user.keyboard(`{${key}}`);
        const landed = idOf(document.activeElement!);
        // Whatever the answer is, there is exactly one stop, and it is where focus is.
        expect(stops()).toEqual([document.activeElement]);

        // A party is clearly ahead when it lies within the quarter of the circle that the key faces.
        const ahead = NODES.filter((other) => other.id !== start.id).filter((other) => {
          const { along, across } = move(start.id, other.id, key);
          return along > 1 && across <= along;
        });
        if (landed === start.id) {
          // It stayed: so nothing was clearly ahead.
          expect(
            ahead.map((other) => other.label),
            `${key} from ${start.label} passed over a party`,
          ).toEqual([]);
          continue;
        }
        moved += 1;
        const here = move(start.id, landed, key);
        // It went the way the key points...
        expect(here.along, `${key} from ${start.label} went backwards`).toBeGreaterThan(1);
        // ...and to nothing that was both nearer along the way and straighter on it.
        for (const other of ahead) {
          const rival = move(start.id, other.id, key);
          const beatsIt = rival.along < here.along - 0.5 && rival.across < here.across - 0.5;
          expect(beatsIt, `${key} from ${start.label} skipped ${other.label}`).toBe(false);
        }
      }
    }
    // The keys do something: most of the four directions from most of the parties lead on.
    expect(moved).toBeGreaterThan(NODES.length);
  });

  it('goes from one party to its neighbour and back with the keys of the longer way between them', async () => {
    const pair = nodesFromStakeholders([
      stakeholderFixture('provider', 'decision-maker'),
      stakeholderFixture('subscribers', 'cost-bearer'),
    ]);
    const { user, container } = renderWithApp(<Held nodes={pair} edges={[]} drift={false} />);
    const where = placed(container, pair);
    const a = where.get('provider')!;
    const b = where.get('subscribers')!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // The longer way between them is the way the keys that lead from one to the other point.
    const [forward, back] =
      Math.abs(dx) >= Math.abs(dy)
        ? dx > 0
          ? ['ArrowRight', 'ArrowLeft']
          : ['ArrowLeft', 'ArrowRight']
        : dy > 0
          ? ['ArrowDown', 'ArrowUp']
          : ['ArrowUp', 'ArrowDown'];

    nodeNamed('Provider').focus();
    await user.keyboard(`{${forward}}`);
    expect(document.activeElement).toBe(nodeNamed('Subscribers'));
    await user.keyboard(`{${forward}}`);
    expect(document.activeElement).toBe(nodeNamed('Subscribers'));
    await user.keyboard(`{${back}}`);
    expect(document.activeElement).toBe(nodeNamed('Provider'));
  });

  it('does not stop at a cluster that has been put away, and does not land in it', async () => {
    const hidden = new Set([NODES.find((node) => node.id === 'provider')!.cluster]);
    const { user } = renderWithApp(<Held hiddenClusters={hidden} drift={false} />);
    const away = NODES.filter((node) => hidden.has(node.cluster)).map((node) => node.label);
    expect(away.length).toBeGreaterThan(0);

    for (const label of away) {
      const button = within(map()).getByRole('button', {
        name: new RegExp(`^${label},`, 'u'),
        hidden: true,
      });
      expect(button.getAttribute('tabindex')).toBe('-1');
      expect(button.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    // The stop is on a party that is shown, and the keys never take focus to one that is not.
    const shown = within(map()).getAllByRole('button');
    expect(shown.some((button) => away.includes(labelOf(button)))).toBe(false);
    expect(stops()).toHaveLength(1);
    stops()[0]!.focus();
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) {
      await user.keyboard(`{${key}}`);
      expect(away).not.toContain(labelOf(document.activeElement!));
    }
  });
});

describe('what the props show', () => {
  it('shows which party is selected, and follows the selection when the page changes it', () => {
    const { rerender } = renderWithApp(
      <Ecosystem
        nodes={NODES}
        edges={EDGES}
        label={LABEL}
        selectedId="provider"
        onSelect={vi.fn()}
      />,
    );
    const pressed = () =>
      nodeButtons()
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
        .map(labelOf);
    expect(pressed()).toEqual(['Provider']);
    rerender(
      <Ecosystem
        nodes={NODES}
        edges={EDGES}
        label={LABEL}
        selectedId="regulator"
        onSelect={vi.fn()}
      />,
    );
    expect(pressed()).toEqual(['Regulator']);
    rerender(
      <Ecosystem nodes={NODES} edges={EDGES} label={LABEL} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(pressed()).toEqual([]);
  });

  it('names a party as the page asks, and tells a screen reader nothing about one that is put away', () => {
    renderWithApp(
      <Held
        describe={(node) => `${node.label}: ${node.direction}`}
        hiddenClusters={new Set(['rules'])}
      />,
    );
    expect(within(map()).getByRole('button', { name: 'Subscribers: harmed' })).toBeTruthy();
    expect(within(map()).queryByRole('button', { name: /^Regulator/u })).toBeNull();
  });

  it('names the parties that stand out, and only those, when the names are not shown', () => {
    const { container, rerender } = renderWithApp(
      <Ecosystem
        nodes={NODES}
        edges={EDGES}
        label={LABEL}
        selectedId={null}
        onSelect={vi.fn()}
        labels="none"
      />,
    );
    const shownNames = () =>
      Array.from(container.querySelectorAll('text[data-visible]')).map((text) => text.textContent);
    expect(shownNames()).toEqual([]);
    rerender(
      <Ecosystem
        nodes={NODES}
        edges={EDGES}
        label={LABEL}
        selectedId={null}
        onSelect={vi.fn()}
        labels="none"
        emphasis={new Set(['unions', 'press'])}
      />,
    );
    expect(shownNames().sort()).toEqual(['Press', 'Unions']);
    // The one that is chosen is named too.
    rerender(
      <Ecosystem
        nodes={NODES}
        edges={EDGES}
        label={LABEL}
        selectedId="regulator"
        onSelect={vi.fn()}
        labels="none"
        emphasis={new Set(['unions', 'press'])}
      />,
    );
    expect(shownNames().sort()).toEqual(['Press', 'Regulator', 'Unions']);
  });

  it('says what the picture is coloured by and whether it is looking at one party and its neighbours', () => {
    const { container, rerender } = renderWithApp(
      <Ecosystem nodes={NODES} edges={EDGES} label={LABEL} selectedId={null} onSelect={vi.fn()} />,
    );
    const host = container.querySelector('[data-mode]')!;
    expect(host.getAttribute('data-mode')).toBe('direction');
    expect(host.hasAttribute('data-focus')).toBe(false);
    rerender(
      <Ecosystem
        nodes={NODES}
        edges={EDGES}
        label={LABEL}
        selectedId="provider"
        onSelect={vi.fn()}
        focus
        mode="value"
        valueFor={() => 0.2}
      />,
    );
    expect(host.getAttribute('data-mode')).toBe('value');
    expect(host.getAttribute('data-focus')).toBe('on');
  });

  it('says how sure it is of each party, and whether the change reaches it directly', () => {
    const uncertain = nodesFromStakeholders([
      stakeholderFixture('provider', 'decision-maker', {
        uncertainty: { level: 'low', reason: 'Well evidenced.' },
      }),
      stakeholderFixture('subscribers', 'cost-bearer', {
        directness: 'indirect',
        uncertainty: { level: 'high', reason: 'Little is known.' },
      }),
    ]);
    const { container } = renderWithApp(<Held nodes={uncertain} edges={[]} />);
    const of = (id: string) => container.querySelector(`[data-id="${id}"]`)!;
    expect(of('provider').getAttribute('data-confidence')).toBe('high');
    expect(of('provider').getAttribute('data-direct')).toBe('true');
    expect(of('subscribers').getAttribute('data-confidence')).toBe('low');
    expect(of('subscribers').getAttribute('data-direct')).toBe('false');
  });
});

describe('what hovering and focusing show', () => {
  it('names a party under the pointer, with what it is and what is expected of it', async () => {
    const { user, container } = renderWithApp(<Held />);
    expect(container.querySelector('.sw-eco__tip')).toBeNull();
    await user.hover(nodeNamed('Subscribers'));
    const tip = await waitFor(() => {
      const found = container.querySelector('.sw-eco__tip');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(tip.textContent).toContain('Subscribers');
    expect(tip.textContent).toContain('Bears cost');
    expect(tip.textContent).toContain('Harmed');
    await user.unhover(nodeNamed('Subscribers'));
    await waitFor(() => expect(container.querySelector('.sw-eco__tip')).toBeNull());
  });
});

describe('the view', () => {
  it('zooms with its own buttons and says that it has, and fits everything again', async () => {
    const { user, container } = renderWithApp(<Held />);
    const host = container.querySelector('[data-mode]')!;
    expect(host.hasAttribute('data-zoomed')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(host.getAttribute('data-zoomed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Fit everything' }));
    await waitFor(() => expect(host.hasAttribute('data-zoomed')).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(host.getAttribute('data-zoomed')).toBe('true');
  });

  it('zooms with Ctrl or ⌘ and the wheel, and leaves a plain wheel to scroll the page', () => {
    const { container } = renderWithApp(<Held />);
    const host = container.querySelector('[data-mode]')!;

    // `fireEvent` says false when the page's default for the event was prevented.
    expect(fireEvent.wheel(host, { deltaY: 240 })).toBe(true);
    expect(host.hasAttribute('data-zoomed')).toBe(false);

    expect(fireEvent.wheel(host, { deltaY: -240, ctrlKey: true })).toBe(false);
    expect(host.getAttribute('data-zoomed')).toBe('true');
    expect(fireEvent.wheel(host, { deltaY: 240, metaKey: true })).toBe(false);
    expect(host.hasAttribute('data-zoomed')).toBe(false);
  });

  it('names the controls as the page asks, and can leave them out', () => {
    const { unmount } = renderWithApp(
      <Held zoomLabels={{ group: 'Vue', in: 'Agrandir', out: 'Réduire', fit: 'Tout voir' }} />,
    );
    expect(screen.getByRole('group', { name: 'Vue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agrandir' })).toBeTruthy();
    unmount();
    renderWithApp(<Held controls={false} />);
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  });
});

describe('motion', () => {
  // The clock is the test's, so that a frame is asked for, or not, and nothing depends on how busy the machine is.
  const frames = () => {
    vi.useFakeTimers();
    return vi.spyOn(window, 'requestAnimationFrame');
  };
  const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('paints at once, and with reduced motion asks for no frame beyond the first, and keeps it still', async () => {
    reduceMotion(true);
    const asked = frames();
    const { container } = renderWithApp(<Held />);
    // Painted before any frame has run.
    expect(placed(container).size).toBe(NODES.length);
    const painted = [...placed(container)];

    await later(1000);
    expect(asked.mock.calls.length).toBeLessThanOrEqual(2);
    expect([...placed(container)]).toEqual(painted);
  });

  it('keeps a loop of frames going when motion is allowed, so that the picture is alive', async () => {
    const asked = frames();
    renderWithApp(<Held />);
    await later(1000);
    // A frame is about 16 ms: a loop that has not stopped has asked for most of the sixty there are in a second.
    expect(asked.mock.calls.length).toBeGreaterThan(40);
  });

  it('does not drift the parties when drift is off: they are where the layout put them and stay there', async () => {
    const asked = frames();
    const { container } = renderWithApp(<Held drift={false} />);
    const first = placed(container);
    await later(1000);
    expect([...placed(container)]).toEqual([...first]);
    // With nothing to move, the loop has nothing to ask a frame for.
    expect(asked.mock.calls.length).toBeLessThan(40);
  });
});
