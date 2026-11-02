import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios';
import { SCENES, SCENE_LABEL, addressOf, journey, settled, type SceneName } from './app';
import { SOURCE, expectNoAxeViolations } from './helpers';

// What the specs of the shell share: projects made over HTTP at each point of the journey, a reading of the
// journey (which scenes are open, which are locked and why), the settings menu, the history, the keyboard,
// and the one way a screen is made to fail. Nothing here belongs to a scene's interior.

// ---------------------------------------------------------------------------------------------
// Projects made over HTTP
// ---------------------------------------------------------------------------------------------

/** Where a project stands: each stage holds everything the one before it does. */
export type Stage =
  | 'fresh'
  | 'ground'
  | 'proposed'
  | 'approved'
  | 'actors'
  | 'stopped'
  | 'compared'
  | 'reviewed'
  | 'brief';

/** How far along the journey a stage is; `stopped` is made from `actors` and adds a comparison that was stopped. */
const RANK: Record<Stage, number> = {
  fresh: 0,
  ground: 1,
  proposed: 2,
  approved: 3,
  actors: 4,
  stopped: 4,
  compared: 5,
  reviewed: 6,
  brief: 7,
};

export interface Made {
  id: string;
  /** The comparison that was started, for the stages that have one. */
  analysisId?: string;
}

export interface MakeOptions {
  name?: string;
  /** The example whose question and evidence the project is made from; the library notes are small. */
  example?: 'library' | (typeof EXAMPLE_SCENARIOS)[number]['id'];
  /** Seeded runs of each scenario in a finished comparison (the page offers 10, 30 and 100). */
  runs?: number;
}

const SETTINGS = { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' };

/**
 * Eight scenarios of 150 runs each, with the sensitivity runs that follow: as much as the product allows in one
 * comparison. It is still only seconds of work on a server like this one, so one that is to be stopped is stopped at once.
 */
const LARGEST_COMPARISON = {
  runsPerVariant: 150,
  rounds: 36,
  sensitivity: true,
  variants: [
    { id: 'baseline', label: 'No change', kind: 'baseline', round: 1, intensity: 0 },
    ...[1, 2, 3, 4, 5, 6, 7].map((index) => ({
      id: `option-${index}`,
      label: `Option ${index}`,
      kind: 'alternative',
      round: 1 + index,
      intensity: index / 10,
    })),
  ],
};

async function ok<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(response.ok(), `${response.url()}: ${response.status()} ${await response.text()}`).toBe(
    true,
  );
  return (await response.json()) as T;
}

interface ProjectRecord {
  status: string;
  workflow: string;
  console: { steps: Record<string, string> } | null;
  lab: {
    scenario: boolean;
    stakeholders: string;
    actors: number;
    analysis: string;
    critiques: boolean;
    brief: boolean;
  };
  rounds: unknown[];
}

export const recordOf = async (api: APIRequestContext, id: string): Promise<ProjectRecord> =>
  ok<ProjectRecord>(await api.get(`/api/projects/${id}`));

const statusOf = async (api: APIRequestContext, id: string, analysisId: string): Promise<string> =>
  (
    await ok<{ analysis: { status: string } }>(
      await api.get(`/api/projects/${id}/analysis/${analysisId}`),
    )
  ).analysis.status;

/** Waits until a comparison has the status asked for. */
async function waitForAnalysis(
  api: APIRequestContext,
  made: Required<Made>,
  status: 'completed' | 'cancelled',
  timeout = 120_000,
): Promise<void> {
  await expect
    .poll(() => statusOf(api, made.id, made.analysisId), { timeout, intervals: [100, 250, 500] })
    .toBe(status);
}

/**
 * Makes a guided project the way the pages do, up to a stage, over HTTP: the evidence is read, the
 * stakeholders are found (by rules) and approved, the actors are made, a comparison is run, the
 * independent review is made and the brief is written. Rules mode, so nothing here needs a model.
 */
export async function makeProject(
  api: APIRequestContext,
  stage: Stage,
  options: MakeOptions = {},
): Promise<Made> {
  const example = EXAMPLE_SCENARIOS.find(
    (item) => item.id === (options.example ?? 'ecommerce-experience'),
  );
  const source =
    options.example === 'library' || !example
      ? {
          question:
            'How might fictional community groups respond to a proposed change in library opening hours?',
          documents: [{ name: 'library-notes.md', content: SOURCE }],
        }
      : { question: example.question, documents: example.documents };
  const created = await ok<{ id: string }>(
    await api.post('/api/projects', {
      data: {
        name: options.name ?? `Shell ${stage}`,
        question: source.question,
        workflow: 'guided',
        documents: source.documents,
        settings: SETTINGS,
      },
    }),
  );
  const { id } = created;
  const made: Made = { id };
  const reached = (needed: Stage): boolean => RANK[stage] >= RANK[needed];

  if (reached('ground')) {
    expect((await api.post(`/api/projects/${id}/steps/knowledge`)).status()).toBe(202);
    await expect
      .poll(async () => (await recordOf(api, id)).console?.steps.knowledge, { timeout: 30_000 })
      .toBe('ready');
  }
  let revision = 0;
  if (reached('proposed')) {
    const found = await api.post(`/api/projects/${id}/stakeholders/discover`, {
      data: { mode: 'rules' },
    });
    expect(found.status(), await found.text()).toBe(201);
    revision = ((await found.json()) as { revision: number }).revision;
  }
  if (reached('approved')) {
    const approved = await api.post(`/api/projects/${id}/stakeholders/approve`, {
      data: { expectedRevision: revision },
    });
    expect(approved.status(), await approved.text()).toBe(200);
  }
  if (reached('actors')) {
    const actors = await api.post(`/api/projects/${id}/actors/generate`, { data: {} });
    expect(actors.status(), await actors.text()).toBe(201);
  }
  if (stage === 'stopped') {
    const started = await ok<{ analysis: { id: string } }>(
      await api.post(`/api/projects/${id}/analysis`, { data: LARGEST_COMPARISON }),
    );
    made.analysisId = started.analysis.id;
    await ok(await api.post(`/api/projects/${id}/analysis/${made.analysisId}/cancel`));
    await waitForAnalysis(api, made as Required<Made>, 'cancelled', 30_000);
    return made;
  }
  if (reached('compared')) {
    const started = await ok<{ analysis: { id: string } }>(
      await api.post(`/api/projects/${id}/analysis`, {
        data: { runsPerVariant: options.runs ?? 10 },
      }),
    );
    made.analysisId = started.analysis.id;
    await waitForAnalysis(api, made as Required<Made>, 'completed');
  }
  if (reached('reviewed')) {
    await ok(await api.post(`/api/projects/${id}/critiques/run`, { data: { useModel: false } }));
  }
  if (reached('brief')) {
    await ok(await api.post(`/api/projects/${id}/brief`, { data: {} }));
  }
  return made;
}

/**
 * A project the guided journey did not make: the earlier quick workflow, which holds a finished run and a
 * report but no stakeholders, no actors and no comparison, so that two scenes of the journey are not in it.
 */
export async function makeLegacy(api: APIRequestContext, name = 'Shell legacy'): Promise<string> {
  const created = await ok<{ id: string }>(
    await api.post('/api/projects', {
      data: {
        name,
        question:
          'How might fictional community groups respond to a proposed change in library opening hours?',
        documents: [{ name: 'library-notes.md', content: SOURCE }],
        settings: SETTINGS,
      },
    }),
  );
  expect((await api.post(`/api/projects/${created.id}/run`, { data: {} })).status()).toBe(202);
  await expect
    .poll(async () => (await recordOf(api, created.id)).status, { timeout: 90_000 })
    .toBe('completed');
  return created.id;
}

// ---------------------------------------------------------------------------------------------
// The journey, as the page shows it
// ---------------------------------------------------------------------------------------------

export interface Gate {
  /**
   * The step's accessible name: its label, then what its glyph shows ("Map, done", "Simulate, in progress",
   * "Simulate, stopped: needs a look"), and for a locked one what opens it ("Compare, locked: Run a simulation first").
   */
  name: string;
  /** What a sighted person reads on it: "Compare". */
  label: string;
  current: boolean;
  locked: boolean;
  /** `done`, `ready`, `working`, `attention`, `locked` or `current`: the one state the journey carries. */
  state: string | null;
}

/** The words a step adds to its name for what its glyph shows, by state; a step that is ready or in view adds none. */
const STATE_WORDS: Record<string, string> = {
  done: ', done',
  working: ', in progress',
  attention: ', stopped: needs a look',
};

/** The name a step has to assistive technology in a state, with the reason where it is locked. */
export function stepName(scene: SceneName, state: string, reason?: string): string {
  const label = SCENE_LABEL[scene];
  if (state === 'locked') return reason ? `${label}, locked: ${reason}` : `${label}, locked`;
  return `${label}${STATE_WORDS[state] ?? ''}`;
}

/** Every step of the journey that is drawn, by scene. The dock on a phone has no Ask. */
export async function readJourney(page: Page): Promise<Partial<Record<SceneName, Gate>>> {
  const buttons = journey(page).getByRole('button');
  await expect(buttons.first()).toBeVisible();
  const gates = await buttons.evaluateAll((elements) =>
    elements.map((element) => ({
      label: (element.textContent ?? '').trim(),
      name: element.getAttribute('aria-label') ?? (element.textContent ?? '').trim(),
      current: element.getAttribute('aria-current') === 'step',
      locked: element.getAttribute('aria-disabled') === 'true',
      state: element.getAttribute('data-state'),
    })),
  );
  const found: Partial<Record<SceneName, Gate>> = {};
  for (const scene of SCENES) {
    const gate = gates.find((item) => item.label === SCENE_LABEL[scene]);
    if (gate) found[scene] = gate;
  }
  return found;
}

/**
 * What a scene of the journey is: open (whatever its state, with the words of that state in its name), or locked
 * for exactly this reason.
 */
export type Expected = 'open' | { locked: string };

/** Every scene named is open or locked for the reason given, and a locked one says so in its name. */
export async function expectGates(
  page: Page,
  expected: Partial<Record<SceneName, Expected>>,
  label = '',
  timeout = 20_000,
): Promise<void> {
  const openNames = (scene: SceneName) =>
    new Set(['ready', 'done', 'working', 'attention'].map((state) => stepName(scene, state)));
  await expect
    .poll(
      async () => {
        const found = await readJourney(page);
        return Object.fromEntries(
          Object.entries(expected).map(([scene, want]) => {
            const gate = found[scene as SceneName];
            if (!gate) return [scene, 'not drawn'];
            if (want === 'open')
              return [
                scene,
                !gate.locked && openNames(scene as SceneName).has(gate.name)
                  ? `${SCENE_LABEL[scene as SceneName]} (open)`
                  : `${gate.name} (${gate.locked ? 'locked' : 'open'})`,
              ];
            return [scene, gate.locked ? gate.name : `${gate.name} (open)`];
          }),
        );
      },
      { message: `the journey${label ? `: ${label}` : ''}`, timeout },
    )
    .toEqual(
      Object.fromEntries(
        Object.entries(expected).map(([scene, want]) => [
          scene,
          want === 'open'
            ? `${SCENE_LABEL[scene as SceneName]} (open)`
            : stepName(scene as SceneName, 'locked', want.locked),
        ]),
      ),
    );
}

// ---------------------------------------------------------------------------------------------
// The top bar: settings and history
// ---------------------------------------------------------------------------------------------

export const settingsButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Settings and tools' });
export const historyButton = (page: Page): Locator => page.getByRole('button', { name: 'History' });
export const historyDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Your explorations' });

export async function openSettings(page: Page): Promise<Locator> {
  await settingsButton(page).click();
  const menu = page.getByRole('menu', { name: 'Settings and tools' });
  await expect(menu).toBeVisible();
  return menu;
}

/** Chooses one of the radio items of the settings menu (a theme, a motion setting, Guided or Advanced). */
export async function chooseSetting(page: Page, name: string | RegExp): Promise<void> {
  const menu = await openSettings(page);
  await menu.getByRole('menuitemradio', { name }).click();
  await expect(menu).toBeHidden();
}

export async function openHistory(page: Page): Promise<Locator> {
  await historyButton(page).click();
  const dialog = historyDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Presses Escape and waits for `layer` to close. A dialog that has just taken focus is the layer that Escape reaches only one
 * render later, and a key that arrives in between is dropped, so it is pressed again for as long as the layer is open. A press
 * that did close it is never repeated.
 */
export async function escapeUntilHidden(page: Page, layer: Locator): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(layer).toBeHidden({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

/** The attribute the document element carries for the theme or the motion setting, or null when it has none. */
export const rootAttribute = (
  page: Page,
  name: 'data-theme' | 'data-motion',
): Promise<string | null> =>
  page.evaluate((attribute) => document.documentElement.getAttribute(attribute), name);

export const stored = (
  page: Page,
  key: 'swarm.theme' | 'swarm.motion' | 'swarm.mode',
): Promise<string | null> => page.evaluate((name) => window.localStorage.getItem(name), key);

/**
 * Puts a notice on the page that stays: an export that fails is told in an alert, which waits for the person. (The notice a
 * locked step gives leaves after a couple of seconds, which is too short to be looked at.) Needs a project open.
 */
export async function provokeNotice(page: Page): Promise<Locator> {
  await page.route('**/api/projects/*/export*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'EXPORT_FAILED', message: 'The export failed.' } }),
    }),
  );
  const menu = await openSettings(page);
  await menu.getByRole('menuitem', { name: 'Export snapshot' }).click();
  await expect(menu).toHaveCount(0);
  const notice = page.getByRole('region', { name: 'Notifications' }).getByRole('alert');
  await expect(notice).toBeVisible();
  // Focus came back to the menu's button, whose tooltip is open: let it go, so that the notice is what is on show.
  await notice.getByRole('button', { name: 'Dismiss' }).focus();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  return notice;
}

// ---------------------------------------------------------------------------------------------
// The first screen, walked as a person does
// ---------------------------------------------------------------------------------------------

/** Picks an example on the first screen, reads it into a scenario and starts the exploration. Returns its id. */
export async function startFromExample(page: Page, example: string): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: example, exact: true }).click();
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Ground it' }).click();
  await page.waitForURL(/[?&]project=/u);
  await settled(page);
  return new URL(page.url()).searchParams.get('project')!;
}

// ---------------------------------------------------------------------------------------------
// The keyboard and the focus
// ---------------------------------------------------------------------------------------------

/** The name of what has focus, the way a person would say it: its label, or its text. */
export const focusName = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return '(nothing)';
    const label =
      element.getAttribute('aria-label') ??
      element
        .getAttribute('aria-labelledby')
        ?.split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ') ??
      element.textContent ??
      '';
    return `${element.tagName.toLowerCase()} "${label.trim().replace(/\s+/gu, ' ').slice(0, 60)}"`;
  });

/** The width in CSS pixels of the outline that shows where focus is. */
export const outlineWidth = (target: Locator): Promise<number> =>
  target.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth));

// ---------------------------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------------------------

/** Nothing that is finite is still moving: a scan taken mid-fade reads a colour that is not the one at rest. */
export async function quiet(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === 'running' &&
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              ).length,
        ),
      { timeout: 15_000 },
    )
    .toBe(0);
}

/**
 * The scene in view has arrived: its code is fetched, and its page has a title. `settled` alone returns while a
 * scene is still on its way, because what stands in for it is neither a skeleton nor a busy region.
 */
export async function arrived(page: Page): Promise<void> {
  await settled(page);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

/**
 * A scene is drawn and still, and axe finds nothing wrong with it. Over a dialog or a menu the page behind is hidden
 * from assistive technology, and there is no scene to wait for: say so with `scene: false`.
 */
export async function audit(
  page: Page,
  label: string,
  options: { scene?: boolean } = {},
): Promise<void> {
  if (options.scene ?? true) await arrived(page);
  await quiet(page);
  await expectNoAxeViolations(page, label);
}

// ---------------------------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------------------------

export interface MotionReading {
  /** The longest time, in milliseconds, that any element is told to take over a transition or an animation. */
  longestMs: number;
  /** How many elements are told to animate for ever. */
  looping: number;
  /** How many animations that never end are running now. */
  running: number;
}

/** What the page's stylesheets ask of the browser in the way of movement, read off every element. */
export const motionOf = (page: Page): Promise<MotionReading> =>
  page.evaluate(() => {
    const milliseconds = (list: string): number =>
      Math.max(
        0,
        ...list.split(',').map((value) => {
          const amount = Number.parseFloat(value);
          return value.trim().endsWith('ms') ? amount : amount * 1000;
        }),
      );
    let longestMs = 0;
    let looping = 0;
    for (const element of document.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      longestMs = Math.max(
        longestMs,
        milliseconds(style.transitionDuration) + milliseconds(style.transitionDelay),
        milliseconds(style.animationDuration) + milliseconds(style.animationDelay),
      );
      if (
        style.animationName !== 'none' &&
        style.animationIterationCount.split(',').some((count) => count.trim() === 'infinite')
      ) {
        looping += 1;
      }
    }
    const running = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          animation.effect?.getComputedTiming().iterations === Infinity,
      ).length;
    return { longestMs, looping, running };
  });

/** Counts the animation frames the page asks for, from the first script on. Call before the page loads. */
export async function countFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let calls = 0;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      calls += 1;
      return original(callback);
    };
    Object.defineProperty(window, '__frames', { get: () => calls });
  });
}

/** How many frames the page asked for by itself while `frames` frames were drawn: a loop asks for one in each. */
export const framesAskedFor = (page: Page, frames = 12): Promise<number> =>
  page.evaluate(async (count) => {
    const read = (): number => (window as unknown as { __frames: number }).__frames;
    const before = read();
    for (let index = 0; index < count; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // The frames this function asked for itself are not the page's.
    return read() - before - count;
  }, frames);

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

/**
 * Every control that is pressed is at least `min` CSS pixels wide and tall. A box that is hidden from the eye, such as
 * the field of a switch, is pressed by its label, which counts instead; the skip link is off the page until it has
 * focus; and a link that stands in a line of text is exempt (WCAG 2.5.8). `except` names controls (by their label) that
 * a defect written up elsewhere keeps from passing, and `scope` is where to look, for a dialog with the page behind it.
 */
export async function expectPressable(
  page: Page,
  label: string,
  options: { min?: number; except?: string[]; scope?: string } = {},
): Promise<void> {
  const min = options.min ?? 24;
  const small = await page.evaluate(
    ({ limit, except, scope }) => {
      const found: string[] = [];
      const controls = document
        .querySelector(scope)!
        .querySelectorAll(
          'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button], [role=slider]',
        );
      for (const element of controls) {
        if (element.closest('svg, .sr-only, [hidden], [inert]')) continue;
        const text = (element.textContent ?? '').trim();
        // A skip link is off the page until it has focus.
        if (element.matches('a[href^="#"]') && /^skip\b/iu.test(text)) continue;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden') continue;
        if (element.tagName === 'A' && style.display === 'inline') continue;
        const name = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
        if (except.includes(name)) continue;
        let box = element.getBoundingClientRect();
        if (
          element instanceof HTMLInputElement &&
          ['checkbox', 'radio'].includes(element.type) &&
          box.width < 4
        ) {
          box = element.labels?.[0]?.getBoundingClientRect() ?? box;
        }
        if (!box.width || !box.height) continue;
        if (box.width < limit - 0.5 || box.height < limit - 0.5) {
          found.push(
            `${element.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)} "${name.replace(/\s+/gu, ' ').slice(0, 40)}"`,
          );
        }
      }
      return found;
    },
    { limit: min, except: options.except ?? [], scope: options.scope ?? 'body' },
  );
  expect(small, `controls under ${min}px: ${label}`).toEqual([]);
}

/** Runs measures one after the other and reports every one that fails, so that a screen is not judged by its first fault only. */
export async function allOf(measures: Record<string, () => Promise<void>>): Promise<void> {
  const failed: string[] = [];
  for (const [name, measure] of Object.entries(measures)) {
    try {
      await measure();
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : String(failure);
      failed.push(
        `${name}: ${text
          .split('\n')
          .filter((line) => line.trim())
          .slice(0, 14)
          .join('\n   ')}`,
      );
    }
  }
  expect(failed, failed.join('\n\n')).toEqual([]);
}

/** Makes projects go away when a spec has done with them, so that a server keeps room for the next spec. */
export async function forget(api: APIRequestContext, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    if (id) await api.delete(`/api/projects/${id}`).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// The screens of the product, for the specs that look at all of them
// ---------------------------------------------------------------------------------------------

/** The projects the screens are opened on: one at each point of the journey that changes what a scene shows. */
export interface ScreenProjects {
  /** The evidence is read; nothing else is. The map has nobody on it yet. */
  ground: string;
  /** Stakeholders were found and wait to be reviewed. */
  proposed: string;
  /** Everything is done: a comparison and a brief. */
  brief: string;
}

export interface Screen {
  name: string;
  /** Which project it is opened on; the first screen has none. */
  project: keyof ScreenProjects | null;
  scene?: SceneName;
  view?: string;
}

/** Every screen a person walks through, once: each scene, and the views and states of it that look different. */
export const SCREENS: readonly Screen[] = [
  { name: 'the first screen', project: null },
  { name: 'ground', project: 'brief', scene: 'ground' },
  { name: 'map, before anyone is found', project: 'ground', scene: 'map' },
  { name: 'map, reviewing who was found', project: 'proposed', scene: 'map' },
  { name: 'map, with its actors', project: 'brief', scene: 'map' },
  { name: 'map, as a list', project: 'brief', scene: 'map', view: 'list' },
  { name: 'simulate, setting up', project: 'brief', scene: 'simulate', view: 'setup' },
  { name: 'simulate, live', project: 'brief', scene: 'simulate' },
  { name: 'simulate, network', project: 'brief', scene: 'simulate', view: 'network' },
  { name: 'simulate, timeline', project: 'brief', scene: 'simulate', view: 'timeline' },
  { name: 'simulate, story', project: 'brief', scene: 'simulate', view: 'story' },
  { name: 'compare', project: 'brief', scene: 'compare' },
  { name: 'decide', project: 'brief', scene: 'decide' },
];

/** The address of a screen, once the projects it is opened on exist. */
export function screenPath(screen: Screen, projects: ScreenProjects): string {
  return addressOf({
    ...(screen.project ? { project: projects[screen.project] } : {}),
    ...(screen.scene ? { scene: screen.scene } : {}),
    ...(screen.view ? { view: screen.view } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// A screen that fails
// ---------------------------------------------------------------------------------------------

/**
 * Makes the code of every scene fail to load, as it does when the connection drops between the first screen and
 * the one a person opens next. The application's own file is let through; everything the router fetches later
 * is refused, so that a scene fails to render, which is what the error boundary is for.
 */
export async function failSceneCode(page: Page): Promise<void> {
  const html = await (await page.request.get('/')).text();
  const entry = /src="(\/assets\/index-[^"]+\.js)"/u.exec(html)?.[1];
  if (!entry) throw new Error('The page does not name its entry script.');
  await page.route('**/assets/index-*.js', (route) =>
    new URL(route.request().url()).pathname === entry ? route.continue() : route.abort('failed'),
  );
}

// ---------------------------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------------------------

/** A phone: the width of the smallest screen the product is designed for, and a finger instead of a pointer. */
export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true } as const;
