/**
 * The DOM layer of the front-end tests. Vitest runs `node` everywhere (static markup, pure logic); a test
 * that has to click, type and tab opts in with `// @vitest-environment jsdom` as the first line of its file
 * and imports this module:
 *
 *   // @vitest-environment jsdom
 *   import { renderWithApp, screen } from '../../test/dom';
 *
 * Importing it installs what the application uses and jsdom does not have (layout, the observers,
 * `matchMedia`, scrolling, pointer capture, the `inert` attribute), unmounts what a test rendered after it
 * and puts the page's globals back. The stand-ins answer as a browser does when it has nothing to report:
 * nothing has a size, everything is visible, no media query matches. A test says otherwise, out loud, with
 * `setBox` and `setMedia`. A test that needs to control time calls `vi.useFakeTimers()` before it renders.
 */
import { act, cleanup, configure, render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, vi } from 'vitest';
import { WorkspaceContext } from '../app/context';
import type { Workspace } from '../app/context';
import { sceneInfos } from '../app/scenes';
import { MotionRoot } from '../design/motion';
import { ToastProvider, TooltipProvider } from '../design/ui';
import { projectFixture } from './project';

export { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

// The machine that runs these is often busy, and a spring that takes a moment on it must not fail a test.
configure({ asyncUtilTimeout: 5000 });

// Testing Library only notices fake timers through a `jest` global. Without one it waits on a clock that
// never moves, and the first `user.click` of a test that controls time never returns. Vitest's clock is the
// same kind of clock, so it is lent one.
Object.defineProperty(globalThis, 'jest', {
  configurable: true,
  value: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
});

// ---- Layout: jsdom lays nothing out, so a box is whatever a test says it is ------------------------------

export interface Box {
  width: number;
  height: number;
  left?: number;
  top?: number;
}

const boxes: { target: Element | string; box: Box }[] = [];

function boxOf(element: Element): Box | null {
  for (let at = boxes.length - 1; at >= 0; at -= 1) {
    const { target, box } = boxes[at]!;
    if (target === element || (typeof target === 'string' && element.matches(target))) return box;
  }
  return null;
}

const measured = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
  const box = boxOf(this);
  return box
    ? new DOMRect(box.left ?? 0, box.top ?? 0, box.width, box.height)
    : measured.call(this);
};

/** An element that is on the page and not taken out of it (`hidden`, `display: none`) is drawn, even at no size. */
function isDrawn(element: Element): boolean {
  if (!element.isConnected) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || window.getComputedStyle(node).display === 'none')
      return false;
  }
  return true;
}

// Code that asks whether something is on the screen before it moves focus to it asks this, and jsdom says no to all.
Element.prototype.getClientRects = function getClientRects(this: Element) {
  const rects = isDrawn(this) ? [this.getBoundingClientRect()] : [];
  return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
};

interface Watch {
  observer: StubResizeObserver;
  target: Element;
  reported: string;
}
const watches = new Set<Watch>();

/** Tells each observer whose element has a size it has not been told, as a browser does after layout. */
function reportSizes(): void {
  const batches = new Map<StubResizeObserver, ResizeObserverEntry[]>();
  for (const watch of watches) {
    const rect = watch.target.getBoundingClientRect();
    const key = `${rect.width}x${rect.height}`;
    if (key === watch.reported) continue;
    watch.reported = key;
    const size = [{ inlineSize: rect.width, blockSize: rect.height }];
    const entry = {
      target: watch.target,
      contentRect: rect,
      borderBoxSize: size,
      contentBoxSize: size,
      devicePixelContentBoxSize: size,
    } as ResizeObserverEntry;
    batches.set(watch.observer, [...(batches.get(watch.observer) ?? []), entry]);
  }
  if (batches.size === 0) return;
  act(() => {
    for (const [observer, entries] of batches) observer.callback(entries, observer);
  });
}

class StubResizeObserver implements ResizeObserver {
  constructor(readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    watches.add({ observer: this, target, reported: '0x0' });
    queueMicrotask(reportSizes);
  }
  unobserve(target: Element): void {
    for (const watch of watches)
      if (watch.observer === this && watch.target === target) watches.delete(watch);
  }
  disconnect(): void {
    for (const watch of watches) if (watch.observer === this) watches.delete(watch);
  }
}

/**
 * Gives an element a size (or every element that matches a selector, now and later: a component's own
 * host is not there to be handed over before it renders), and tells whatever observes it.
 */
export function setBox(target: Element | string, box: Box): void {
  boxes.push({ target, box });
  reportSizes();
}

// ---- Observers, media, scrolling, pointers, `inert` ---------------------------------------------------------

class StubIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  private live = true;
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() => {
      if (!this.live) return;
      const rect = target.getBoundingClientRect();
      const entry = {
        target,
        isIntersecting: true,
        intersectionRatio: 1,
        boundingClientRect: rect,
        intersectionRect: rect,
        rootBounds: null,
        time: performance.now(),
      } as IntersectionObserverEntry;
      act(() => this.callback([entry], this));
    });
  }
  unobserve(): void {}
  disconnect(): void {
    this.live = false;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const mediaRules: { fragment: string; matches: boolean }[] = [];
const mediaLists = new Set<StubMediaQueryList>();
const squeeze = (text: string): string => text.replace(/\s+/gu, '').toLowerCase();

function matchesMedia(query: string): boolean {
  const asked = squeeze(query);
  const rule = [...mediaRules].reverse().find(({ fragment }) => asked.includes(squeeze(fragment)));
  return rule?.matches ?? false;
}

/** The part of a `MediaQueryList` that the application uses: its answer, and being told when it changes. */
class StubMediaQueryList {
  private readonly listeners = new Set<EventListenerOrEventListenerObject>();
  private last: boolean;
  constructor(readonly media: string) {
    this.last = this.matches;
    mediaLists.add(this);
  }
  get matches(): boolean {
    return matchesMedia(this.media);
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'change') this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'change') this.listeners.delete(listener);
  }
  /** Says what changed, to whoever listens, if the answer is not the one they were last given. */
  announce(): void {
    if (this.matches === this.last) return;
    this.last = this.matches;
    const event = Object.assign(new Event('change'), { matches: this.last, media: this.media });
    for (const listener of this.listeners) {
      if (typeof listener === 'function') listener.call(this, event);
      else listener.handleEvent(event);
    }
  }
}

/**
 * Makes every media query that contains `fragment` (spaces and case do not matter) match, or not. Queries
 * match nothing until a test says so, which is how a browser at its defaults answers. Call it before the
 * render, or after: what is already listening is told.
 */
export function setMedia(fragment: string, matches: boolean): void {
  mediaRules.push({ fragment, matches });
  act(() => {
    for (const list of mediaLists) list.announce();
  });
}

/** The device asks for less motion (or stops asking). */
export const reduceMotion = (on = true): void => setMedia('prefers-reduced-motion', on);

/** Which element holds each pointer. A pointer that is let go is let go by the browser too, after `pointerup`. */
const captures = new Map<number, Element>();
const release = (event: Event) => {
  const { pointerId } = event as PointerEvent;
  queueMicrotask(() => captures.delete(pointerId));
};
document.addEventListener('pointerup', release, true);
document.addEventListener('pointercancel', release, true);

const install = (target: object, name: string, value: unknown): void => {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
};

install(globalThis, 'ResizeObserver', StubResizeObserver);
install(globalThis, 'IntersectionObserver', StubIntersectionObserver);
install(window, 'matchMedia', (query: string) => new StubMediaQueryList(query));
install(window, 'scrollTo', vi.fn());
install(Element.prototype, 'scrollIntoView', vi.fn());
// There is no canvas to draw on; the components that ask for one draw nothing, as they do without a context.
install(HTMLCanvasElement.prototype, 'getContext', () => null);
install(
  Element.prototype,
  'setPointerCapture',
  function setPointerCapture(this: Element, id: number) {
    captures.set(id, this);
  },
);
install(
  Element.prototype,
  'releasePointerCapture',
  function releasePointerCapture(this: Element, id: number) {
    if (captures.get(id) === this) captures.delete(id);
  },
);
install(
  Element.prototype,
  'hasPointerCapture',
  function hasPointerCapture(this: Element, id: number) {
    return captures.get(id) === this;
  },
);
// `inert` is a content attribute that a browser also offers as a property.
Object.defineProperty(HTMLElement.prototype, 'inert', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('inert');
  },
  set(this: HTMLElement, value: boolean) {
    this.toggleAttribute('inert', Boolean(value));
  },
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-motion');
  boxes.length = 0;
  watches.clear();
  captures.clear();
  mediaRules.length = 0;
  mediaLists.clear();
});

// ---- Rendering --------------------------------------------------------------------------------------

/** A workspace that does nothing: the project of the fixture, every action a spy, every panel closed. */
export function workspaceStub(overrides: Partial<Workspace> = {}): Workspace {
  const project = overrides.project ?? projectFixture();
  const scene = overrides.scene ?? 'ground';
  return {
    project,
    config: null,
    mode: 'guided',
    busy: false,
    refreshing: false,
    refresh: vi.fn(),
    run: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    setIntervention: vi.fn(async () => undefined),
    branch: vi.fn(async () => undefined),
    saveEnvironment: vi.fn(async () => undefined),
    recordSurvey: vi.fn(),
    duplicate: vi.fn(),
    openProject: vi.fn(),
    projects: [],
    scene,
    view: null,
    go: vi.fn(),
    setView: vi.fn(),
    journey: sceneInfos(project, scene),
    sharing: false,
    panels: {
      history: vi.fn(),
      ask: vi.fn(),
      audit: vi.fn(),
      budget: vi.fn(),
      access: vi.fn(),
      provider: vi.fn(),
    },
    ...overrides,
  };
}

export interface AppRender extends RenderResult {
  /** A person at the keyboard and the pointer. */
  user: UserEvent;
  /** What the scene was given as its workspace: its actions are spies. */
  workspace: Workspace;
}

/**
 * Renders what the application wraps every screen in (motion, tooltips, toasts, and for a scene the
 * workspace it reads) around `ui`. Pass `workspace` to say what the scene finds in it.
 */
export function renderWithApp(
  ui: ReactElement,
  {
    workspace,
    ...options
  }: Omit<RenderOptions, 'wrapper'> & { workspace?: Partial<Workspace> } = {},
): AppRender {
  const stub = workspaceStub(workspace);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      MotionRoot,
      null,
      createElement(
        TooltipProvider,
        null,
        createElement(
          ToastProvider,
          null,
          createElement(WorkspaceContext.Provider, { value: stub }, children),
        ),
      ),
    );
  const user = userEvent.setup(
    vi.isFakeTimers() ? { advanceTimers: (ms) => void vi.advanceTimersByTime(ms) } : {},
  );
  return { ...render(ui, { ...options, wrapper }), user, workspace: stub };
}
