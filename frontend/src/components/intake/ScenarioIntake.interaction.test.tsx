import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scenarioFixture } from '../../../../shared/lab-fixtures';
import type { ScenarioFrame, ScenarioParseResult } from '../../../../shared/scenario';
import { ScenarioIntake } from './ScenarioIntake';

// The component is drawn here by a few lines that stand in for React's: function components run, their
// hooks keep their state between draws, effects run after a draw, and a click or a change calls the
// handler the page gave the control. There is no DOM to drive in this suite, so the stand-in notes where
// focus is sent. What is asserted is what a person's actions do, not what the markup looks like.

type Tree = Host | string;
interface Host {
  tag: string;
  props: Record<string, unknown>;
  children: Tree[];
}

const harness = vi.hoisted(() => {
  interface Slot {
    value?: unknown;
    deps?: readonly unknown[];
    cleanup?: void | (() => void);
  }
  return {
    slots: new Map<string, Slot[]>(),
    visiting: null as { path: string; slots: Slot[]; at: number } | null,
    effects: [] as (() => void)[],
    ids: 0,
    redraw: () => undefined as void,
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  type Slot = ReturnType<typeof slot>;
  const slot = (make: () => object) => {
    const visit = harness.visiting!;
    visit.slots[visit.at] ??= make();
    return visit.slots[visit.at++]!;
  };
  return {
    ...actual,
    useState: (initial: unknown) => {
      const mine = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      const set = (next: unknown) => {
        mine.value = typeof next === 'function' ? next(mine.value) : next;
        harness.redraw();
      };
      return [mine.value, set];
    },
    useRef: (initial: unknown) => slot(() => ({ value: { current: initial } })).value as object,
    useId: () => slot(() => ({ value: `:t${harness.ids++}:` })).value,
    useCallback: (callback: unknown) => callback,
    useEffect: (run: () => void | (() => void), deps?: readonly unknown[]) => {
      const mine: Slot = slot(() => ({}));
      const same = deps && mine.deps && deps.every((dep, at) => Object.is(dep, mine.deps![at]));
      if (same) return;
      harness.effects.push(() => {
        mine.cleanup?.();
        mine.cleanup = run();
        mine.deps = deps;
      });
    },
  };
});

const FRAGMENT = Symbol.for('react.fragment');
const focused: string[] = [];

const textOf = (tree: Tree | Tree[]): string =>
  (Array.isArray(tree) ? tree : [tree])
    .map((node) => (typeof node === 'string' ? node : textOf(node.children)))
    .join('');

function descend(nodes: Tree[], visit: (node: Host) => void): void {
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    visit(node);
    descend(node.children, visit);
  }
}

/** Draws an element and what its components draw, down to plain elements; an icon or another wrapped component is left out. */
function draw(node: ReactNode, path: string, seen: Set<string>): Tree[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) {
    return node.flatMap((child, at) => draw(child as ReactNode, `${path}/${at}`, seen));
  }
  const { type, props } = node as ReactElement<Record<string, unknown>>;
  const children = props.children as ReactNode;
  if ((type as unknown) === FRAGMENT) return draw(children, path, seen);
  if (typeof type === 'string') {
    const host: Host = { tag: type, props, children: draw(children, `${path}/${type}`, seen) };
    const ref = props.ref as { current: unknown } | undefined;
    if (ref && typeof ref === 'object') {
      ref.current = { focus: () => focused.push(textOf(host).trim() || String(props.id ?? type)) };
    }
    return [host];
  }
  if (typeof type !== 'function') return [];
  const here = `${path}/${type.name}`;
  seen.add(here);
  const slots = harness.slots.get(here) ?? [];
  harness.slots.set(here, slots);
  harness.visiting = { path: here, slots, at: 0 };
  const output = (type as (props: object) => ReactNode)(props);
  harness.visiting = null;
  return draw(output, here, seen);
}

function mount(element: ReactElement) {
  harness.slots.clear();
  let tree: Tree[] = [];
  let busy = false;
  let again = false;
  const redraw = (): void => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        harness.effects = [];
        const seen = new Set<string>();
        tree = draw(element, '', seen);
        // What is no longer drawn forgets what it held, as it does in React.
        for (const path of [...harness.slots.keys()]) {
          if (!seen.has(path)) harness.slots.delete(path);
        }
        const effects = harness.effects;
        harness.effects = [];
        for (const run of effects) run();
      } while (again);
    } finally {
      busy = false;
    }
  };
  harness.redraw = redraw;
  redraw();

  const all = (test: (node: Host) => boolean): Host[] => {
    const found: Host[] = [];
    descend(tree, (node) => test(node) && found.push(node));
    return found;
  };
  const one = (test: (node: Host) => boolean, what: string): Host => {
    const found = all(test);
    if (found.length !== 1) throw new Error(`Expected one ${what}, found ${found.length}.`);
    return found[0]!;
  };
  const buttons = (name: string | RegExp): Host[] =>
    all(
      (node) =>
        node.tag === 'button' &&
        [textOf(node), String(node.props['aria-label'] ?? '')].some((text) =>
          typeof name === 'string' ? text.trim() === name : name.test(text),
        ),
    );
  const button = (name: string | RegExp): Host =>
    one((node) => buttons(name).includes(node), `button ${String(name)}`);
  /** The control that a label names: the label's `for` is its id. */
  const field = (label: string | RegExp): Host => {
    const named = one(
      (node) =>
        node.tag === 'label' &&
        (typeof label === 'string' ? textOf(node).trim() === label : label.test(textOf(node))),
      `label ${String(label)}`,
    );
    return one((node) => node.props.id === named.props.htmlFor, `control of ${String(label)}`);
  };
  return {
    tree: () => tree,
    text: () => textOf(tree),
    all,
    button,
    buttons,
    field,
    click: (node: Host) => (node.props.onClick as () => void)(),
    type: (node: Host, value: string) =>
      (node.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      }),
    valueOf: (node: Host) => String(node.props.value ?? ''),
  };
}

/** The wait for what the page does after an answer arrives. */
const settled = () => vi.waitFor(() => undefined, { interval: 1 });

const reading = (frame: ScenarioFrame, mode: 'rules' | 'model' = 'rules'): ScenarioParseResult => ({
  frame,
  mode,
  model: mode === 'model' ? 'fixture-model' : null,
  notes: ['Read by a fixture.'],
});

/** What a reading by rules gives, with some structure to edit and no questions left open. */
const scenario = (): ScenarioFrame =>
  scenarioFixture({
    origin: 'rules',
    ambiguities: [],
    changes: [
      { name: 'First change', from: 'now', to: 'later', note: '' },
      { name: 'Second change', from: null, to: null, note: '' },
    ],
    alternatives: [
      { id: 'option-1', label: 'First alternative', description: '', changes: [] },
      { id: 'option-2', label: 'Second alternative', description: '', changes: [] },
    ],
  });

function answerWith(result: ScenarioParseResult) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const QUESTION =
  'What could happen if the harbour office doubles the mooring fee for visiting boats?';
const DOCUMENTS = [{ name: 'harbour-notes.md', content: 'The office sets the fee.' }];
const noop = () => undefined;

beforeEach(() => {
  focused.length = 0;
  harness.ids = 0;
  // `document.getElementById(id).focus()` is how a new row takes focus.
  vi.stubGlobal('document', {
    getElementById: (id: string) => ({
      focus: () => focused.push(`#${id.replace(/^:t\d+:/u, '')}`),
    }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  harness.redraw = noop;
});

const bodyOf = (fetch: ReturnType<typeof answerWith>): Record<string, unknown> =>
  JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<
    string,
    unknown
  >;

describe('asking for a reading', () => {
  it.each([
    [false, 'rules'],
    [true, 'model'],
  ] as const)(
    'sends useModel %s when the person has chosen %s, and says where the question goes',
    async (useModel, mode) => {
      const fetch = answerWith(reading(scenario(), mode));
      const page = mount(
        <ScenarioIntake
          question={QUESTION}
          frame={null}
          onFrame={noop}
          disabled={false}
          documents={DOCUMENTS}
          useModel={useModel}
        />,
      );
      expect(page.text()).toContain(
        useModel
          ? 'your question is sent to the model provider this server uses'
          : 'Rules on this server read the question; it goes nowhere else.',
      );
      expect(fetch).not.toHaveBeenCalled();
      page.click(page.button('Understand my question'));
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/api/scenario/parse');
      expect(init.method).toBe('POST');
      expect(bodyOf(fetch)).toEqual({
        question: QUESTION,
        // Only the names and sizes of the documents go, never their text.
        documents: [{ name: 'harbour-notes.md', characters: 24, excerpt: expect.any(String) }],
        useModel,
      });
      await vi.waitFor(() => expect(page.text()).toContain('Check and edit the scenario'));
    },
  );

  it('sends useModel false when nothing says a model was chosen', async () => {
    const fetch = answerWith(reading(scenario()));
    const page = mount(
      <ScenarioIntake question={QUESTION} frame={null} onFrame={noop} disabled={false} />,
    );
    page.click(page.button('Understand my question'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetch).useModel).toBe(false);
  });

  it('asks nothing until it is asked, and nothing at all when the question is too short or the page is busy', async () => {
    const fetch = answerWith(reading(scenario()));
    const short = mount(
      <ScenarioIntake question="short" frame={null} onFrame={noop} disabled={false} />,
    );
    expect(short.button('Understand my question').props.disabled).toBe(true);
    const busy = mount(<ScenarioIntake question={QUESTION} frame={null} onFrame={noop} disabled />);
    expect(busy.button('Understand my question').props.disabled).toBe(true);
    await settled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

/** The page that holds the scenario between the reading and the experiment, as the entry console does. */
function Page({ useModel = false }: { useModel?: boolean }) {
  const [frame, setFrame] = useState<ScenarioFrame | null>(null);
  return (
    <ScenarioIntake
      question={QUESTION}
      frame={frame}
      onFrame={setFrame}
      disabled={false}
      useModel={useModel}
    />
  );
}

async function review() {
  answerWith(reading(scenario()));
  const page = mount(<Page />);
  page.click(page.button('Understand my question'));
  await vi.waitFor(() => expect(page.text()).toContain('Check and edit the scenario'));
  return page;
}

const alternativeLabels = (page: Awaited<ReturnType<typeof review>>): string[] =>
  page
    .all((node) => node.tag === 'input' && String(node.props.id ?? '').endsWith('-label'))
    .map((node) => String(node.props.value));

describe('editing a scenario that has been read', () => {
  it('puts the heading where a keyboard person is when the review appears', async () => {
    await review();
    expect(focused).toContain('Check and edit the scenario');
  });

  it('adds an alternative: one more, the earlier ones as they were, and the new one ready to be named', async () => {
    const page = await review();
    const before = alternativeLabels(page);
    expect(before).toEqual(['First alternative', 'Second alternative']);
    page.click(page.button('Add an alternative'));
    const after = alternativeLabels(page);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe('');
    // The new row can be named, and naming it changes only it.
    const added = page
      .all((node) => node.tag === 'input' && String(node.props.id ?? '').endsWith('-label'))
      .at(-1)!;
    page.type(added, 'A notice period');
    expect(alternativeLabels(page)).toEqual([...before, 'A notice period']);
    expect(page.text()).toContain('Alternative 3');
  });

  it('removes a change: that row goes, the other stays, and focus goes to the control that adds one', async () => {
    const page = await review();
    const names = () =>
      page
        .all((node) => node.tag === 'input' && /-name-\d+$/u.test(String(node.props.id ?? '')))
        .map((node) => String(node.props.value));
    expect(names().slice(0, 2)).toEqual(['First change', 'Second change']);
    focused.length = 0;
    page.click(page.button('Remove change 1: First change'));
    expect(names().slice(0, 1)).toEqual(['Second change']);
    expect(names()).not.toContain('First change');
    expect(page.text()).not.toContain('Remove change 2');
    expect(focused.at(-1)).toBe('Add a change');
  });

  it('adds a change, and takes focus to its name', async () => {
    const page = await review();
    focused.length = 0;
    // The first of the three is the scenario's own: each alternative has one for what it changes.
    page.click(page.buttons('Add a change')[0]!);
    expect(page.button('Remove change 3')).toBeDefined();
    expect(focused.at(-1)).toBe('#-name-2');
  });

  it('keeps an edit of the decision: used, shown, and there again when the scenario is opened', async () => {
    const page = await review();
    const decision = page.field(/^Decision or event/u);
    const wanted = 'Double the mooring fee from the first of June';
    page.type(decision, wanted);
    expect(page.valueOf(page.field(/^Decision or event/u))).toBe(wanted);

    page.click(page.button('Use this scenario'));
    expect(page.text()).toContain('This scenario will be used');
    expect(page.text()).toContain(wanted);
    expect(page.text()).toContain('Edited by you');

    page.click(page.button('Edit the scenario'));
    expect(page.valueOf(page.field(/^Decision or event/u))).toBe(wanted);
  });

  it('does not use a scenario that has no decision, and says what is missing', async () => {
    const page = await review();
    page.type(page.field(/^Decision or event/u), '   ');
    page.click(page.button('Use this scenario'));
    expect(page.text()).toContain('This scenario cannot be used yet');
    expect(page.text()).toContain('Check and edit the scenario');
  });

  it('drops the reading when it is discarded, and the question is read again from scratch', async () => {
    const page = await review();
    page.click(page.button('Discard'));
    expect(page.text()).not.toContain('Check and edit the scenario');
    expect(page.button('Understand my question')).toBeDefined();
  });
});
