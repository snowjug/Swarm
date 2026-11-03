import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  SCENES,
  addressOf,
  expectScene,
  journey,
  notices,
  openApp,
  settled,
  step,
  type SceneName,
} from '../support/app';
import { apiContext, watchPage } from '../support/helpers';
import {
  PHONE,
  expectGates,
  forget,
  historyButton,
  historyDialog,
  makeLegacy,
  makeProject,
  readJourney,
  recordOf,
  stepName,
  type Expected,
  type Made,
  type Stage,
} from '../support/shell';

// The journey opens step by step, by what the project's own record holds (the evidence read, the stakeholders a
// person approved, the actors made from them, a comparison that finished), not by a button that was pressed.
// Here each point of that way is made on the server through the routes the pages use, and the page is read at
// it: which scenes are open, which are locked and the reason in the name of the step, where the project opens,
// what pressing a locked step does, and what happens when the record moves on while the page is open.
// Rules mode, so nothing here needs a model.

type Level = Stage;

const GROUND_IT = 'Ground it first';
const NEEDS_ACTORS = 'Needs actors';
const RUN_FIRST = 'Run a simulation first';
const LEGACY = 'Not in this record';

interface Reading {
  /** What the server says, so that the way the project was made is not taken on trust. */
  lab: {
    stakeholders: string;
    actors: 'none' | 'some';
    analysis: string;
    critiques: boolean;
    brief: boolean;
  };
  /** The scene a project with this record opens on when the address names none. */
  opensTo: SceneName;
  /** Which scenes can be opened, and for the ones that cannot, the reason the step gives. */
  gates: Partial<Record<SceneName, Expected>>;
  /** The state each step carries: the scene in view is `current` unless it has a state of its own to show. */
  states: Record<SceneName, string>;
}

const NOTHING = {
  stakeholders: 'none',
  actors: 'none',
  analysis: 'none',
  critiques: false,
  brief: false,
} as const;

const ONLY_GROUND: Partial<Record<SceneName, Expected>> = {
  ground: 'open',
  map: { locked: GROUND_IT },
  simulate: { locked: NEEDS_ACTORS },
  compare: { locked: RUN_FIRST },
  decide: { locked: RUN_FIRST },
};
const THROUGH_MAP = { ...ONLY_GROUND, map: 'open' } satisfies Partial<Record<SceneName, Expected>>;
const THROUGH_ACTORS = { ...THROUGH_MAP, simulate: 'open' } satisfies Partial<
  Record<SceneName, Expected>
>;
const EVERYTHING: Partial<Record<SceneName, Expected>> = {
  ground: 'open',
  map: 'open',
  simulate: 'open',
  compare: 'open',
  decide: 'open',
};

const READINGS: Record<Level, Reading> = {
  fresh: {
    lab: NOTHING,
    opensTo: 'ground',
    gates: ONLY_GROUND,
    states: {
      ask: 'done',
      ground: 'current',
      map: 'locked',
      simulate: 'locked',
      compare: 'locked',
      decide: 'locked',
    },
  },
  ground: {
    lab: NOTHING,
    opensTo: 'map',
    gates: THROUGH_MAP,
    states: {
      ask: 'done',
      ground: 'done',
      map: 'current',
      simulate: 'locked',
      compare: 'locked',
      decide: 'locked',
    },
  },
  proposed: {
    // Proposed is not approved: nothing is opened that a person has not decided.
    lab: { ...NOTHING, stakeholders: 'proposed' },
    opensTo: 'map',
    gates: THROUGH_MAP,
    states: {
      ask: 'done',
      ground: 'done',
      map: 'current',
      simulate: 'locked',
      compare: 'locked',
      decide: 'locked',
    },
  },
  approved: {
    lab: { ...NOTHING, stakeholders: 'approved' },
    opensTo: 'map',
    gates: THROUGH_MAP,
    states: {
      ask: 'done',
      ground: 'done',
      map: 'current',
      simulate: 'locked',
      compare: 'locked',
      decide: 'locked',
    },
  },
  actors: {
    lab: { ...NOTHING, stakeholders: 'approved', actors: 'some' },
    opensTo: 'simulate',
    gates: THROUGH_ACTORS,
    states: {
      ask: 'done',
      ground: 'done',
      map: 'done',
      simulate: 'current',
      compare: 'locked',
      decide: 'locked',
    },
  },
  stopped: {
    // A comparison that was stopped is a step that needs a look, and opens nothing after it.
    lab: { ...NOTHING, stakeholders: 'approved', actors: 'some', analysis: 'failed' },
    opensTo: 'simulate',
    gates: THROUGH_ACTORS,
    states: {
      ask: 'done',
      ground: 'done',
      map: 'done',
      simulate: 'attention',
      compare: 'locked',
      decide: 'locked',
    },
  },
  compared: {
    lab: { ...NOTHING, stakeholders: 'approved', actors: 'some', analysis: 'completed' },
    opensTo: 'decide',
    gates: EVERYTHING,
    states: {
      ask: 'done',
      ground: 'done',
      map: 'done',
      simulate: 'done',
      compare: 'ready',
      decide: 'current',
    },
  },
  reviewed: {
    // The critics' review is part of the record and does not change what can be opened.
    lab: {
      ...NOTHING,
      stakeholders: 'approved',
      actors: 'some',
      analysis: 'completed',
      critiques: true,
    },
    opensTo: 'decide',
    gates: EVERYTHING,
    states: {
      ask: 'done',
      ground: 'done',
      map: 'done',
      simulate: 'done',
      compare: 'ready',
      decide: 'current',
    },
  },
  brief: {
    lab: {
      ...NOTHING,
      stakeholders: 'approved',
      actors: 'some',
      analysis: 'completed',
      critiques: true,
      brief: true,
    },
    opensTo: 'decide',
    gates: EVERYTHING,
    states: {
      ask: 'done',
      ground: 'done',
      map: 'done',
      simulate: 'done',
      compare: 'ready',
      decide: 'done',
    },
  },
};

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const projects = {} as Record<Level, Made>;
let legacy = '';
let api: APIRequestContext;
/** Names are made once per setup: a worker that restarts after a failure sets up again, and must not repeat them. */
const tag = Date.now().toString(36);
const nameOf = (what: string): string => `Gates ${tag}: ${what}`;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  for (const level of Object.keys(READINGS) as Level[]) {
    projects[level] = await makeProject(api, level, { name: nameOf(level) });
  }
  legacy = await makeLegacy(api, nameOf('legacy'));
});

test.afterAll(async () => {
  await forget(api, [...Object.values(projects).map((made) => made.id), legacy]);
  await api.dispose();
});

/** A marker that a reload would remove: what carries it has not been loaded again. */
const mark = (page: Page) =>
  page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));
const marked = (page: Page) =>
  page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);

// ---------------------------------------------------------------------------------------------

test.describe('what is locked at each point of the way, and what the step says about it', () => {
  for (const [level, reading] of Object.entries(READINGS) as [Level, Reading][]) {
    test(`${level}: the scenes that are open, the ones that are locked and why, and where it opens`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      const { lab } = await recordOf(api, projects[level].id);
      const { actors, ...rest } = reading.lab;
      expect(lab, `the server's record of the ${level} project`).toMatchObject(rest);
      if (actors === 'none') expect(lab.actors).toBe(0);
      else expect(lab.actors).toBeGreaterThan(0);

      // Opened with no scene in the address, the project goes to where its work has got to, and says so.
      await page.goto(addressOf({ project: projects[level].id }));
      await settled(page);
      await expectScene(page, reading.opensTo);
      await expectGates(page, reading.gates, level);

      const found = await readJourney(page);
      expect(
        Object.fromEntries(SCENES.map((scene) => [scene, found[scene]?.state])),
        `the state each step carries at ${level}`,
      ).toEqual(reading.states);
      // What the glyph shows is in the name too, so that it is not left to the eye: done, or locked for a reason.
      expect(
        Object.fromEntries(SCENES.map((scene) => [scene, found[scene]?.name])),
        `what each step is called at ${level}`,
      ).toEqual(
        Object.fromEntries(
          SCENES.map((scene) => {
            const gate = reading.gates[scene];
            const reason = typeof gate === 'object' ? gate.locked : undefined;
            return [scene, stepName(scene, reading.states[scene], reason)];
          }),
        ),
      );
      expect(
        SCENES.filter((scene) => found[scene]?.current),
        'exactly one step is the one in view',
      ).toEqual([reading.opensTo]);
      expect(problems).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------

test.describe('pressing a step that is locked', () => {
  test('says what is needed, with the pointer or the keyboard, and stays where it is', async ({
    page,
  }) => {
    await openApp(page, { project: projects.approved.id, scene: 'map' });

    // A locked step is still a button that can be reached and read: it says why it is locked in its name.
    const simulate = step(page, 'simulate');
    await expect(simulate).toHaveAccessibleName(`Simulate, locked: ${NEEDS_ACTORS}`);
    await expect(simulate).toHaveAttribute('aria-disabled', 'true');
    await expect(simulate).toHaveJSProperty('disabled', false);

    await simulate.click({ force: true });
    await expect(notices(page).getByRole('status')).toContainText(NEEDS_ACTORS);
    await expectScene(page, 'map');
    // The notice leaves by itself.
    await expect(notices(page).getByRole('status')).toHaveCount(0, { timeout: 15_000 });

    const compare = step(page, 'compare');
    await compare.focus();
    await expect(compare).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(notices(page).getByRole('status')).toContainText(RUN_FIRST);
    await notices(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(notices(page).getByRole('status')).toHaveCount(0);

    const decide = step(page, 'decide');
    await decide.focus();
    await page.keyboard.press('Space');
    await expect(notices(page).getByRole('status')).toContainText(RUN_FIRST);
    await expectScene(page, 'map');
  });

  test('is a stop on the way along the journey: the keyboard reaches every step, locked or not', async ({
    page,
  }) => {
    await openApp(page, { project: projects.approved.id, scene: 'map' });
    await step(page, 'ask').focus();
    const reached: string[] = [];
    for (const scene of ['ground', 'map', 'simulate', 'compare', 'decide'] as const) {
      await page.keyboard.press('Tab');
      await expect(step(page, scene)).toBeFocused();
      reached.push(scene);
    }
    expect(reached).toEqual(['ground', 'map', 'simulate', 'compare', 'decide']);
  });

  test('on a record the guided journey did not make, says it is not in the record', async ({
    page,
  }) => {
    await openApp(page, { project: legacy });
    await step(page, 'map').click({ force: true });
    await expect(notices(page).getByRole('status')).toContainText(LEGACY);
    await step(page, 'compare').click({ force: true });
    await expect(notices(page).getByRole('status').last()).toContainText(LEGACY);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('opening a scene that the record has not opened, by its address', () => {
  test('shows where the work is instead, and shows it again after a reload', async ({ page }) => {
    const problems = watchPage(page);
    for (const requested of ['decide', 'compare', 'simulate', 'ask', 'nonsense']) {
      await page.goto(`/?project=${projects.approved.id}&scene=${requested}`);
      await settled(page);
      await expect(step(page, 'map'), `?scene=${requested}`).toHaveAttribute(
        'aria-current',
        'step',
      );
      await expect(page).toHaveTitle(/ · Map \| Swarm$/u);
      // The address says what is shown, so that a reload and a shared link land where the page is.
      await expect(page, `?scene=${requested}`).toHaveURL(/[?&]scene=map(?:&|$)/u);
      await expectGates(page, {
        simulate: { locked: NEEDS_ACTORS },
        decide: { locked: RUN_FIRST },
      });
    }
    await page.reload();
    await settled(page);
    await expect(step(page, 'map')).toHaveAttribute('aria-current', 'step');
    await expect(page).toHaveURL(/[?&]scene=map(?:&|$)/u);
    expect(problems).toEqual([]);
  });

  test('replaces the address it was given: Back does not return to a scene that was never shown', async ({
    page,
  }) => {
    await page.goto('/');
    await settled(page);
    await page.goto(`/?project=${projects.approved.id}&scene=decide&view=report`);
    await settled(page);
    await expect(step(page, 'map')).toHaveAttribute('aria-current', 'step');
    await expect(page).toHaveURL(/[?&]scene=map(?:&|$)/u);
    await expect(page).not.toHaveURL(/[?&]view=/u);

    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]project=/u);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
  });

  test('never trusts a view it does not know, whatever the address says', async ({ page }) => {
    const problems = watchPage(page);
    for (const view of [
      '%3Cscript%3Ealert(1)%3C/script%3E',
      'x'.repeat(60),
      '..%2F..%2Fetc',
      'nonsense',
    ]) {
      await page.goto(`/?project=${projects.compared.id}&scene=compare&view=${view}`);
      await settled(page);
      await expectScene(page, 'compare');
    }
    expect(problems).toEqual([]);
  });

  test('keeps a scene the record has opened, with its view, after a reload', async ({ page }) => {
    await openApp(page, { project: projects.compared.id, scene: 'simulate', view: 'timeline' });
    await expectScene(page, 'simulate');
    await page.reload();
    await settled(page);
    await expectScene(page, 'simulate');
    await expect(page).toHaveURL(/[?&]view=timeline(?:&|$)/u);
    await expectGates(page, EVERYTHING);
  });

  test('on a record the guided journey did not make, opens the report and keeps the map and the comparison shut', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: legacy });
    await expectScene(page, 'decide');
    await expectGates(page, {
      ground: 'open',
      map: { locked: LEGACY },
      simulate: 'open',
      compare: { locked: LEGACY },
      decide: 'open',
    });
    for (const requested of ['map', 'compare']) {
      await page.goto(`/?project=${legacy}&scene=${requested}`);
      await settled(page);
      await expect(step(page, 'decide'), `?scene=${requested}`).toHaveAttribute(
        'aria-current',
        'step',
      );
    }
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('how a person opens the next step, and how the page finds out', () => {
  test('making the actors in the Map opens Simulate without a reload, and the way on is Simulate', async ({
    page,
  }) => {
    const made = await makeProject(api, 'approved', { name: nameOf('making the actors') });
    await openApp(page, { project: made.id, scene: 'map' });
    await mark(page);
    await expectGates(page, { simulate: { locked: NEEDS_ACTORS } });

    await page.getByRole('button', { name: 'Create actors' }).click();
    await expectGates(page, {
      map: 'open',
      simulate: 'open',
      compare: { locked: RUN_FIRST },
      decide: { locked: RUN_FIRST },
    });
    await expect(step(page, 'map')).toHaveAttribute('data-state', 'done');
    await expect(step(page, 'simulate')).toHaveAttribute('data-state', 'ready');
    expect((await recordOf(api, made.id)).lab.actors).toBeGreaterThan(0);

    await page
      .getByRole('group', { name: 'Next' })
      .getByRole('button', { name: 'Simulate' })
      .click();
    await expectScene(page, 'simulate');
    expect(await marked(page), 'the page was not loaded again').toBe(true);
  });

  test('running the simulation from the page opens Compare and Decide when it finishes, with no reload', async ({
    page,
  }) => {
    const made = await makeProject(api, 'actors', { name: nameOf('run from the page') });
    await openApp(page, { project: made.id, scene: 'simulate' });
    await mark(page);
    await expectGates(page, { compare: { locked: RUN_FIRST }, decide: { locked: RUN_FIRST } });

    await page.getByRole('radio', { name: '10', exact: true }).check();
    await page.getByRole('button', { name: 'Run the simulation' }).click();
    await expectGates(page, EVERYTHING, 'after the simulation finished');
    await expect(step(page, 'simulate')).toHaveAttribute('data-state', 'done');
    await expect(step(page, 'compare')).toHaveAttribute('data-state', 'ready');
    expect(await readJourney(page).then((found) => found.decide?.state)).toBe('ready');
    expect(await marked(page), 'the page was not loaded again').toBe(true);
    expect((await recordOf(api, made.id)).lab.analysis).toBe('completed');
  });

  test('a comparison that finishes elsewhere, while the page is open on Simulate, is found by the page', async ({
    page,
  }) => {
    const made = await makeProject(api, 'actors', { name: nameOf('finishing elsewhere') });
    await openApp(page, { project: made.id, scene: 'simulate' });
    await mark(page);
    await expectGates(page, { compare: { locked: RUN_FIRST }, decide: { locked: RUN_FIRST } });

    const started = await api.post(`/api/projects/${made.id}/analysis`, {
      data: { runsPerVariant: 100 },
    });
    expect(started.status(), await started.text()).toBe(202);
    // The page reads the project again on its own: a few seconds while it waits, then while it runs.
    await expectGates(page, EVERYTHING, 'after the comparison finished', 120_000);
    await expect(step(page, 'simulate')).toHaveAttribute('data-state', 'done');
    expect(await marked(page), 'the page was not loaded again').toBe(true);
  });

  test('follows the record while the page is open: a comparison that runs keeps Compare and Decide locked, one that stops needs a look', async ({
    page,
  }) => {
    // A comparison is seconds of work on a server like this one, too short to be caught running. So the record is
    // held at each point by answering the project's own request, and the page is left to read it as it does.
    let held: 'running' | 'failed' | null = 'running';
    await page.route(new RegExp(`/api/projects/${projects.compared.id}$`, 'u'), async (route) => {
      const response = await route.fetch();
      if (held === null || route.request().method() !== 'GET') return route.fulfill({ response });
      const body = (await response.json()) as { lab: Record<string, unknown> };
      return route.fulfill({ response, json: { ...body, lab: { ...body.lab, analysis: held } } });
    });
    await openApp(page, { project: projects.compared.id, scene: 'simulate' });
    await mark(page);
    await expect(step(page, 'simulate')).toHaveAttribute('data-state', 'working');
    await expect(step(page, 'simulate')).toHaveAccessibleName('Simulate, in progress');
    await expectGates(page, {
      simulate: 'open',
      compare: { locked: RUN_FIRST },
      decide: { locked: RUN_FIRST },
    });

    // Stopped somewhere else: the page reads the project again, and the step asks for a look.
    held = 'failed';
    await expect(step(page, 'simulate')).toHaveAttribute('data-state', 'attention', {
      timeout: 30_000,
    });
    await expect(step(page, 'simulate')).toHaveAccessibleName('Simulate, stopped: needs a look');
    await expectGates(page, { compare: { locked: RUN_FIRST }, decide: { locked: RUN_FIRST } });

    // And when the record says it finished, the two scenes after it open, by themselves.
    held = null;
    await expectGates(page, EVERYTHING, 'once the record says it finished', 30_000);
    await expect(step(page, 'simulate')).toHaveAttribute('data-state', 'done');
    await expect(step(page, 'simulate')).toHaveAccessibleName('Simulate, done');
    expect(await marked(page), 'the page was not loaded again').toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the first step, and the other ways of reading the same record', () => {
  test('the first step starts a new question and the exploration is kept in the history', async ({
    page,
  }) => {
    await openApp(page, { project: projects.ground.id, scene: 'ground' });
    await step(page, 'ask').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
    await expect(page).not.toHaveURL(/[?&]scene=/u);
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);

    await historyButton(page).click();
    await expect(
      historyDialog(page).getByRole('button', { name: new RegExp(`^${nameOf('ground')}\\b`, 'u') }),
    ).toBeVisible();
  });

  test('after a reload the same scenes are open and the same ones locked', async ({ page }) => {
    await openApp(page, { project: projects.approved.id, scene: 'map' });
    const before = await readJourney(page);
    await page.reload();
    await settled(page);
    expect(await readJourney(page)).toEqual(before);
    await expectGates(page, { simulate: { locked: NEEDS_ACTORS }, compare: { locked: RUN_FIRST } });
  });

  test('Advanced shows more of the engine and opens nothing more: the same scenes are open', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('swarm.mode', 'advanced'));
    await openApp(page, { project: projects.approved.id, scene: 'map' });
    await expectGates(page, THROUGH_MAP, 'approved, in Advanced');
    await openApp(page, { project: projects.compared.id, scene: 'compare' });
    await expectGates(page, EVERYTHING, 'compared, in Advanced');
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the dock holds the five scenes of the journey, names the locked ones, and is the only journey', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openApp(page, { project: projects.approved.id, scene: 'map' });

    // The bar's journey is hidden on a phone, so only one journey is in the page for a screen reader.
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(1);
    await expect(journey(page).getByRole('button')).toHaveCount(5);
    await expectGates(page, THROUGH_MAP);
    await expectScene(page, 'map');

    // Each one is at least a finger wide and tall.
    const sizes = await journey(page)
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return {
            name: button.getAttribute('aria-label') ?? button.textContent,
            width: box.width,
            height: box.height,
          };
        }),
      );
    for (const size of sizes) {
      expect(size.width, `${size.name}: width`).toBeGreaterThanOrEqual(44);
      expect(size.height, `${size.name}: height`).toBeGreaterThanOrEqual(44);
    }

    // Pressed, a locked step says what it needs, the same as on a wide screen.
    await step(page, 'compare').click({ force: true });
    await expect(notices(page).getByRole('status')).toContainText(RUN_FIRST);
    expect(problems).toEqual([]);
  });
});
