import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios';
import type { LabProgress } from '../../shared/lab';
import {
  advance,
  apiContext,
  createGuided,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  watchPage,
} from '../support/helpers';

// Simulation and Report are opened by what the project's own record holds (the stakeholders a person
// approved, the actors made from them, a comparison that finished), not only by the engine's stages.
// Here each point of that way is made on the server through the same routes the pages use, and the
// page is read at it: what is locked and what it says it needs, what the journey shows, the one next
// step it names, and what happens when a person follows it, with the mouse and with the keyboard.
// Rules mode, so nothing here needs a model.

type Stage = 'Graph Build' | 'Env Setup' | 'Simulation' | 'Report' | 'Interaction';
const STAGES: readonly Stage[] = [
  'Graph Build',
  'Env Setup',
  'Simulation',
  'Report',
  'Interaction',
];
const THEMES = ['light', 'dark', 'high-contrast'] as const;

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

const stepper = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Guided workflow steps' });
const stageButton = (page: Page, name: Stage): Locator =>
  stepper(page).getByRole('button', { name: new RegExp(`^${name}`, 'u') });
const path = (page: Page): Locator =>
  page.getByRole('group', { name: 'Your path through the scenario' });
const nextBar = (page: Page): Locator => page.getByRole('group', { name: 'Next step' });
const workbench = (page: Page, name: Stage): Locator =>
  page.getByRole('region', { name: `${name} workbench` });
const mode = (page: Page, name: 'Guided' | 'Advanced'): Locator =>
  page.getByRole('group', { name: 'Interface mode' }).getByRole('button', { name });

async function inTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
}

// ---------------------------------------------------------------------------------------------
// The server: a project at each point of the way, made through the API
// ---------------------------------------------------------------------------------------------

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

const readLab = async (api: APIRequestContext, id: string): Promise<LabProgress> =>
  (await json<{ lab: LabProgress }>(await api.get(`/api/projects/${id}`))).lab;

/** The question of the project is read into a scenario, which is stored with the project, as in intake. */
async function storeScenario(api: APIRequestContext, id: string): Promise<void> {
  const project = await json<{ question: string; documents: { name: string }[] }>(
    await api.get(`/api/projects/${id}`),
  );
  const reading = await json<{ frame: unknown }>(
    await api.post('/api/scenario/parse', {
      data: {
        question: project.question,
        documents: project.documents.map((document) => ({ name: document.name, characters: 400 })),
      },
    }),
  );
  await json(await api.put(`/api/projects/${id}/scenario`, { data: { scenario: reading.frame } }));
}

async function proposeStakeholders(api: APIRequestContext, id: string): Promise<number> {
  const found = await json<{ revision: number }>(
    await api.post(`/api/projects/${id}/stakeholders/discover`, { data: { mode: 'rules' } }),
  );
  return found.revision;
}

async function approveStakeholders(api: APIRequestContext, id: string): Promise<void> {
  const revision = await proposeStakeholders(api, id);
  await json(
    await api.post(`/api/projects/${id}/stakeholders/approve`, {
      data: { expectedRevision: revision },
    }),
  );
}

const makeActors = async (api: APIRequestContext, id: string): Promise<void> => {
  await json(await api.post(`/api/projects/${id}/actors/generate`, { data: {} }));
};

async function startComparison(
  api: APIRequestContext,
  id: string,
  body: Record<string, unknown> = { runsPerVariant: 10 },
): Promise<string> {
  const started = await json<{ analysis: { id: string } }>(
    await api.post(`/api/projects/${id}/analysis`, { data: body }),
  );
  return started.analysis.id;
}

const statusOf = async (api: APIRequestContext, id: string, analysisId: string) =>
  (
    await json<{ analysis: { status: string } }>(
      await api.get(`/api/projects/${id}/analysis/${analysisId}`),
    )
  ).analysis.status;

async function compare(api: APIRequestContext, id: string): Promise<void> {
  const analysisId = await startComparison(api, id);
  await expect
    .poll(() => statusOf(api, id, analysisId), { timeout: 60_000, intervals: [100, 250, 500] })
    .toBe('completed');
}

/**
 * A project whose cast is big enough for a comparison to take some seconds, so that a comparison can
 * be seen while it runs and stopped before it finishes. It is only an example's question and evidence.
 */
async function bigProject(api: APIRequestContext, name: string): Promise<string> {
  const example = EXAMPLE_SCENARIOS.find((item) => item.id === 'regional-price-change');
  expect(example, 'the example the heavy comparison is made from').toBeDefined();
  const response = await api.post('/api/projects', {
    data: {
      name,
      question: example!.question,
      workflow: 'guided',
      documents: example!.documents,
      settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await advance(api, id, 'knowledge');
  await storeScenario(api, id);
  await approveStakeholders(api, id);
  await makeActors(api, id);
  return id;
}

/** Eight scenarios of 150 runs each, with the sensitivity runs that follow: about as large as one may be. */
const LONG_COMPARISON = {
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

// ---------------------------------------------------------------------------------------------
// What each point of the way should look like
// ---------------------------------------------------------------------------------------------

type Level =
  | 'fresh'
  | 'graph'
  | 'proposed'
  | 'approved'
  | 'actors'
  | 'stopped'
  | 'compared'
  | 'reviewed'
  | 'brief';

interface Expected {
  /** What the server says, so that the way the project was made is not taken on trust. */
  lab: Omit<LabProgress, 'actors'> & { actors: 'none' | 'some' };
  /** The word under each stage's name; `locked` is a stage that cannot be opened. */
  stages: Record<Stage, string>;
  /** The steps of the path that are ticked, in the order of the path. */
  done: string[];
  /** The one next step, or none. */
  next: { says: RegExp; button: string; opens: Stage } | null;
  /** What the path says in the stages that can be opened. */
  inView: Partial<Record<Stage, string>>;
}

const LOCKED_REASON: Partial<Record<Stage, string>> = {
  'Env Setup': 'Needs Graph Build first',
  Simulation: 'Needs actors from Env Setup',
  Report: 'Needs a finished comparison',
  Interaction: 'Needs the detailed report',
};

const NOTHING = {
  scenario: false,
  stakeholders: 'none',
  actors: 'none',
  analysis: 'none',
  critiques: false,
  brief: false,
} as const;

const COMPARED = {
  'Graph Build': 'ready',
  'Env Setup': 'actors ready',
  Simulation: 'compared',
  Report: 'ready to write',
  Interaction: 'locked',
} as const;
const COMPARED_DONE = [
  'Question',
  'Evidence',
  'Stakeholders',
  'Actors',
  'Scenarios',
  'Run',
  'Progress',
  'Results',
];
const COMPARED_VIEW = {
  'Graph Build': 'STEP 2 OF 12 Evidence · in the Graph Build stage',
  'Env Setup': 'STEP 4 OF 12 Actors · in the Env Setup stage',
  Simulation: 'STEP 7 OF 12 Progress · in the Simulation stage',
  Report: 'STEP 8 OF 12 Results · in the Report stage',
} as const;
const TO_THE_BRIEF = {
  says: /The comparison has finished/u,
  button: 'See the decision brief',
  opens: 'Report',
} as const;

const LEVELS: Record<Level, Expected> = {
  fresh: {
    lab: NOTHING,
    stages: {
      'Graph Build': 'pending',
      'Env Setup': 'locked',
      Simulation: 'locked',
      Report: 'locked',
      Interaction: 'locked',
    },
    done: ['Question'],
    next: null,
    inView: { 'Graph Build': 'STEP 2 OF 12 Evidence · in the Graph Build stage' },
  },
  graph: {
    lab: NOTHING,
    stages: {
      'Graph Build': 'ready',
      'Env Setup': 'pending',
      Simulation: 'locked',
      Report: 'locked',
      Interaction: 'locked',
    },
    done: ['Question', 'Evidence'],
    next: null,
    inView: {
      'Graph Build': 'STEP 2 OF 12 Evidence · in the Graph Build stage',
      'Env Setup': 'STEP 3 OF 12 Stakeholders · in the Env Setup stage',
    },
  },
  proposed: {
    lab: { ...NOTHING, scenario: true, stakeholders: 'proposed' },
    stages: {
      'Graph Build': 'ready',
      'Env Setup': 'pending',
      Simulation: 'locked',
      Report: 'locked',
      Interaction: 'locked',
    },
    // Proposed is not approved: nothing is ticked that a person has not decided.
    done: ['Question', 'Evidence'],
    next: {
      says: /Review them and approve the list/u,
      button: 'Review the stakeholders',
      opens: 'Env Setup',
    },
    inView: {
      'Graph Build': 'STEP 2 OF 12 Evidence · in the Graph Build stage',
      'Env Setup': 'STEP 3 OF 12 Stakeholders · in the Env Setup stage',
    },
  },
  approved: {
    lab: { ...NOTHING, scenario: true, stakeholders: 'approved' },
    stages: {
      'Graph Build': 'ready',
      'Env Setup': 'pending',
      Simulation: 'locked',
      Report: 'locked',
      Interaction: 'locked',
    },
    done: ['Question', 'Evidence', 'Stakeholders'],
    next: { says: /The stakeholders are approved/u, button: 'Make the actors', opens: 'Env Setup' },
    inView: {
      'Graph Build': 'STEP 2 OF 12 Evidence · in the Graph Build stage',
      'Env Setup': 'STEP 4 OF 12 Actors · in the Env Setup stage',
    },
  },
  actors: {
    lab: { ...NOTHING, scenario: true, stakeholders: 'approved', actors: 'some' },
    stages: {
      'Graph Build': 'ready',
      'Env Setup': 'actors ready',
      Simulation: 'ready to compare',
      Report: 'locked',
      Interaction: 'locked',
    },
    done: ['Question', 'Evidence', 'Stakeholders', 'Actors'],
    next: {
      says: /The simulated actors are ready/u,
      button: 'Compare the scenarios',
      opens: 'Simulation',
    },
    inView: {
      'Graph Build': 'STEP 2 OF 12 Evidence · in the Graph Build stage',
      'Env Setup': 'STEP 5 OF 12 Scenarios · in the Env Setup stage',
      Simulation: 'STEP 6 OF 12 Run · in the Simulation stage',
    },
  },
  stopped: {
    lab: {
      ...NOTHING,
      scenario: true,
      stakeholders: 'approved',
      actors: 'some',
      analysis: 'failed',
    },
    stages: {
      'Graph Build': 'ready',
      'Env Setup': 'actors ready',
      Simulation: 'stopped',
      Report: 'locked',
      Interaction: 'locked',
    },
    done: ['Question', 'Evidence', 'Stakeholders', 'Actors'],
    next: {
      says: /stopped before it finished/u,
      button: 'Compare the scenarios',
      opens: 'Simulation',
    },
    inView: {
      'Graph Build': 'STEP 2 OF 12 Evidence · in the Graph Build stage',
      'Env Setup': 'STEP 5 OF 12 Scenarios · in the Env Setup stage',
      Simulation: 'STEP 6 OF 12 Run · in the Simulation stage',
    },
  },
  compared: {
    lab: {
      ...NOTHING,
      scenario: true,
      stakeholders: 'approved',
      actors: 'some',
      analysis: 'completed',
    },
    stages: COMPARED,
    done: COMPARED_DONE,
    next: TO_THE_BRIEF,
    inView: COMPARED_VIEW,
  },
  reviewed: {
    lab: {
      ...NOTHING,
      scenario: true,
      stakeholders: 'approved',
      actors: 'some',
      analysis: 'completed',
      critiques: true,
    },
    // The critics' review is part of the record and does not change what can be opened.
    stages: COMPARED,
    done: COMPARED_DONE,
    next: TO_THE_BRIEF,
    inView: COMPARED_VIEW,
  },
  brief: {
    lab: {
      ...NOTHING,
      scenario: true,
      stakeholders: 'approved',
      actors: 'some',
      analysis: 'completed',
      critiques: true,
      brief: true,
    },
    stages: { ...COMPARED, Report: 'brief written' },
    done: [...COMPARED_DONE, 'Export'],
    next: TO_THE_BRIEF,
    inView: COMPARED_VIEW,
  },
};

// ---------------------------------------------------------------------------------------------

test.use({ viewport: { width: 1440, height: 900 } });

const ids = {} as Record<Level | 'big' | 'unlocking' | 'starting' | 'cancelling', string>;
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  const made = async (level: Level, build: (id: string) => Promise<void>): Promise<void> => {
    ids[level] = await createGuided(api, { name: `Gates: ${level}` });
    await build(ids[level]);
  };
  await made('fresh', async () => {});
  await made('graph', (id) => advance(api, id, 'knowledge'));
  await made('proposed', async (id) => {
    await advance(api, id, 'knowledge');
    await storeScenario(api, id);
    await proposeStakeholders(api, id);
  });
  await made('approved', async (id) => {
    await advance(api, id, 'knowledge');
    await storeScenario(api, id);
    await approveStakeholders(api, id);
  });
  const withActors = async (id: string): Promise<void> => {
    await advance(api, id, 'knowledge');
    await storeScenario(api, id);
    await approveStakeholders(api, id);
    await makeActors(api, id);
  };
  await made('actors', withActors);
  await made('compared', async (id) => {
    await withActors(id);
    await compare(api, id);
  });
  await made('reviewed', async (id) => {
    await withActors(id);
    await compare(api, id);
    await json(await api.post(`/api/projects/${id}/critiques/run`, { data: {} }));
  });
  await made('brief', async (id) => {
    await withActors(id);
    await compare(api, id);
    await json(await api.post(`/api/projects/${id}/critiques/run`, { data: {} }));
    await json(await api.post(`/api/projects/${id}/brief`, { data: {} }));
  });
  ids.big = await bigProject(api, 'Gates: a long comparison');
  // A comparison that a person stopped: it is cancelled while it is still running.
  ids.stopped = await bigProject(api, 'Gates: stopped');
  const stopping = await startComparison(api, ids.stopped, LONG_COMPARISON);
  await json(await api.post(`/api/projects/${ids.stopped}/analysis/${stopping}/cancel`));
  await expect
    .poll(() => statusOf(api, ids.stopped, stopping), { timeout: 30_000 })
    .toBe('cancelled');
  ids.unlocking = await createGuided(api, { name: 'Gates: unlocking' });
  await advance(api, ids.unlocking, 'knowledge');
  await storeScenario(api, ids.unlocking);
  await approveStakeholders(api, ids.unlocking);
  // The two that a comparison is started from in the page itself.
  ids.starting = await createGuided(api, { name: 'Gates: started from the page' });
  await withActors(ids.starting);
  ids.cancelling = await bigProject(api, 'Gates: stopped from the page');
});

test.afterAll(async () => {
  await api.dispose();
});

// ---------------------------------------------------------------------------------------------

test.describe('what is locked at each point of the way, and what the page says about it', () => {
  for (const [level, expected] of Object.entries(LEVELS) as [Level, Expected][]) {
    test(`${level}: the stages, the path and the next step are what the record holds`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      const lab = await readLab(api, ids[level]);
      const { actors, ...rest } = expected.lab;
      expect(lab, `the server's record of the ${level} project`).toMatchObject(rest);
      if (actors === 'none') expect(lab.actors).toBe(0);
      else expect(lab.actors).toBeGreaterThan(0);

      await page.goto(`/?project=${ids[level]}`);
      await expect(workbench(page, 'Graph Build')).toBeVisible();

      for (const name of STAGES) {
        const button = stageButton(page, name);
        const label = expected.stages[name];
        await expect(button, `${name} at ${level}`).toContainText(label);
        if (label === 'locked') {
          // It cannot be opened, it says so in words, and says what it needs.
          await expect(button).toBeDisabled();
          await expect(button).toContainText(LOCKED_REASON[name]!);
        } else {
          await expect(button).toBeEnabled();
          await expect(button.locator('small.step-lock')).toHaveCount(0);
        }
      }

      // The path ticks only what the record shows, in the order of the path.
      await expect(path(page).locator('.journey-step.done .journey-label')).toHaveText(
        expected.done,
      );
      await expect(path(page).locator('[aria-current="step"]')).toHaveCount(1);

      // The one next step, or none, and it is a single button.
      if (expected.next) {
        await expect(nextBar(page)).toBeVisible();
        await expect(nextBar(page)).toContainText(expected.next.says);
        await expect(nextBar(page).getByRole('button')).toHaveCount(1);
        await expect(nextBar(page).getByRole('button')).toHaveText(expected.next.button);
      } else {
        await expect(nextBar(page)).toHaveCount(0);
      }
      expect(problems).toEqual([]);
    });

    test(`${level}: the path follows the stage in view`, async ({ page }) => {
      await page.goto(`/?project=${ids[level]}`);
      for (const [name, summary] of Object.entries(expected.inView) as [Stage, string][]) {
        await stageButton(page, name).click();
        await expect(workbench(page, name)).toBeVisible();
        await expect(path(page)).toContainText(summary);
        await expect(path(page).locator('[aria-current="step"]')).toHaveCount(1);
      }
    });

    if (expected.next) {
      const { button, opens } = expected.next;
      test(`${level}: the next step opens ${opens}, and puts focus there`, async ({ page }) => {
        await page.goto(`/?project=${ids[level]}`);
        await nextBar(page).getByRole('button', { name: button }).click();
        await expect(workbench(page, opens)).toBeVisible();
        // The brief is what the person came for, so Report hands focus on to the brief itself.
        await expect(
          opens === 'Report' ? page.locator('#report-brief') : workbench(page, opens),
        ).toBeFocused();
        await expect(stageButton(page, opens)).toHaveAttribute('aria-current', 'step');
        // Where the work of that step is done, the stage says what to do, and the bar steps aside;
        // from the comparison's brief it offers the way back.
        if (opens === 'Report') {
          await expect(nextBar(page)).toContainText('Back to the comparison');
          await expect(nextBar(page).getByRole('button')).toHaveText('Back to the comparison');
        } else {
          await expect(nextBar(page)).toHaveCount(0);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------

test.describe('opening a stage that the record has not opened', () => {
  test('a locked stage cannot be opened, by a click or from the keyboard', async ({ page }) => {
    await page.goto(`/?project=${ids.approved}`);
    for (const name of ['Simulation', 'Report', 'Interaction'] as const) {
      const button = stageButton(page, name);
      await expect(button).toBeDisabled();
      await button.click({ force: true });
      await expect(workbench(page, name)).toHaveCount(0);
      await expect(workbench(page, 'Graph Build')).toBeVisible();
    }
    // A locked stage is not a tab stop: the keyboard goes from the stages that can be opened to the
    // controls after them, and never to one that does nothing.
    await stageButton(page, 'Graph Build').focus();
    await page.keyboard.press('Tab');
    await expect(stageButton(page, 'Env Setup')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(stepper(page).getByRole('button', { name: /^Simulation/u })).not.toBeFocused();
    expect(
      await page.evaluate(() => document.activeElement?.closest('nav.console-stepper') === null),
      'focus has left the stages',
    ).toBe(true);
  });

  test('Simulation opens from the actors alone, and Report from a finished comparison alone', async ({
    page,
  }) => {
    // Neither of the engine's stages behind them was run: the graph is all it has built.
    const project = await json<{ console: { steps: Record<string, string> } }>(
      await api.get(`/api/projects/${ids.compared}`),
    );
    expect(project.console.steps).toMatchObject({
      knowledge: 'ready',
      environment: 'pending',
      simulation: 'pending',
      report: 'pending',
    });
    await page.goto(`/?project=${ids.compared}`);
    await stageButton(page, 'Simulation').click();
    await expect(workbench(page, 'Simulation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compare scenarios' })).toBeVisible();
    await stageButton(page, 'Report').click();
    await expect(workbench(page, 'Report')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Decision brief' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate decision brief' })).toBeVisible();
  });

  test('Interaction stays locked on the lab’s record, which does not make the detailed report', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.brief}`);
    await expect(stageButton(page, 'Interaction')).toBeDisabled();
    await expect(stageButton(page, 'Interaction')).toContainText(LOCKED_REASON.Interaction!);
    await expect(nextBar(page)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('how a person unlocks the next stage', () => {
  test('approved stakeholders lead to the actors, and the actors open Simulation without a reload', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.unlocking}`);
    // A marker that a reload would remove: the page below is never loaded again.
    await page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));
    await expect(stageButton(page, 'Simulation')).toBeDisabled();
    await expect(stageButton(page, 'Simulation')).toContainText('Needs actors from Env Setup');
    await expect(nextBar(page)).toContainText('The stakeholders are approved');

    // The bar names the thing to do and takes the person to where it is done.
    await nextBar(page).getByRole('button', { name: 'Make the actors' }).click();
    await expect(workbench(page, 'Env Setup')).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Stakeholders and actors' })).toBeVisible();
    await expect(nextBar(page)).toHaveCount(0);

    // The person makes the actors in the panel, which says so in its own words.
    await workbench(page, 'Env Setup')
      .getByRole('button', { name: /make the actors|create actors/iu })
      .first()
      .click();
    await expect(stageButton(page, 'Simulation')).toBeEnabled();
    await expect(stageButton(page, 'Simulation')).toContainText('ready to compare');
    await expect(stageButton(page, 'Env Setup')).toContainText('actors ready');
    await expect(stageButton(page, 'Report')).toBeDisabled();

    // With the actors made, the way on is named from where the person is, and it opens Simulation.
    await expect(nextBar(page)).toContainText('The simulated actors are ready');
    await nextBar(page).getByRole('button', { name: 'Compare the scenarios' }).click();
    await expect(workbench(page, 'Simulation')).toBeFocused();
    await expect(nextBar(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(
      true,
    );
    expect((await readLab(api, ids.unlocking)).actors).toBeGreaterThan(0);
  });

  test('a comparison that is running keeps Report locked, and opens it when it finishes, by itself', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.big}`);
    await expect(stageButton(page, 'Simulation')).toContainText('ready to compare');
    await stageButton(page, 'Simulation').click();
    await expect(workbench(page, 'Simulation')).toBeVisible();
    await page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));

    // The comparison is started on the server and the page told to read the project again.
    await startComparison(api, ids.big, LONG_COMPARISON);
    await page.getByRole('button', { name: 'Refresh project from server' }).click();
    await expect(stageButton(page, 'Simulation')).toContainText('comparing');
    expect(
      (await readLab(api, ids.big)).analysis,
      'the comparison is still running when the page is read: it is made long enough for that',
    ).toBe('running');
    await expect(stageButton(page, 'Report')).toBeDisabled();
    await expect(stageButton(page, 'Report')).toContainText('Needs a finished comparison');
    await expect(nextBar(page)).toHaveCount(0);
    await expect(path(page)).toContainText('STEP 7 OF 12 Progress');

    // The page reads the project again while it runs, so nothing is done to open Report.
    await expect(stageButton(page, 'Report')).toBeEnabled({ timeout: 90_000 });
    await expect(stageButton(page, 'Simulation')).toContainText('compared');
    await expect(stageButton(page, 'Report')).toContainText('ready to write');
    await expect(nextBar(page)).toContainText('The comparison has finished');
    await expect(path(page).locator('.journey-step.done .journey-label')).toHaveText([
      ...COMPARED_DONE,
    ]);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(
      true,
    );
  });

  test('a comparison started in the page opens Report when it finishes, and the brief ticks the path, with no reload', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.starting}`);
    await expect(stageButton(page, 'Report')).toBeDisabled();
    await page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));
    await stageButton(page, 'Simulation').click();
    await expect(workbench(page, 'Simulation')).toBeVisible();

    // The person does it all in the page: no request from here, and the refresh button is not touched.
    await workbench(page, 'Simulation')
      .getByRole('button', { name: 'Compare scenarios', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'What this comparison says' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(stageButton(page, 'Report')).toBeEnabled();
    await expect(stageButton(page, 'Report')).toContainText('ready to write');
    await expect(stageButton(page, 'Simulation')).toContainText('compared');
    await expect(nextBar(page)).toContainText('The comparison has finished');
    await expect(path(page).locator('.journey-step.done .journey-label')).toHaveText(COMPARED_DONE);

    // On to the brief, and writing it in the page: the stage and the path follow it.
    await nextBar(page).getByRole('button', { name: 'See the decision brief' }).click();
    await expect(page.locator('#report-brief')).toBeFocused();
    await page.getByRole('button', { name: 'Generate decision brief' }).click();
    await expect(stageButton(page, 'Report')).toContainText('brief written');
    await expect(path(page).locator('.journey-step.done .journey-label')).toHaveText([
      ...COMPARED_DONE,
      'Export',
    ]);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(
      true,
    );
    expect(await readLab(api, ids.starting)).toMatchObject({ analysis: 'completed', brief: true });
  });

  test('a comparison stopped in the page leaves Report locked, and Simulation says it stopped, with no reload', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.cancelling}`);
    await page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));
    await stageButton(page, 'Simulation').click();
    const simulation = workbench(page, 'Simulation');
    await simulation.getByLabel('Seeded runs of each scenario').selectOption({ label: '100 runs' });
    await simulation.getByRole('button', { name: 'Compare scenarios', exact: true }).click();
    await simulation.getByRole('button', { name: 'Cancel the comparison' }).click();

    await expect(stageButton(page, 'Simulation')).toContainText('stopped');
    await expect(stageButton(page, 'Report')).toBeDisabled();
    await expect(stageButton(page, 'Report')).toContainText('Needs a finished comparison');
    expect((await readLab(api, ids.cancelling)).analysis).toBe('failed');
    // From another stage the next step says that it stopped and offers to run it again.
    await stageButton(page, 'Graph Build').click();
    await expect(nextBar(page)).toContainText('stopped before it finished');
    await expect(nextBar(page).getByRole('button')).toHaveText('Compare the scenarios');
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(
      true,
    );
  });

  test('a running comparison is named from the stages that are not showing it, until it finishes', async ({
    page,
  }) => {
    const id = await bigProject(api, 'Gates: running');
    await startComparison(api, id, LONG_COMPARISON);
    await page.goto(`/?project=${id}`);
    await page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));
    expect(
      (await readLab(api, id)).analysis,
      'the comparison is still running when the page is read: it is made long enough for that',
    ).toBe('running');
    await expect(workbench(page, 'Graph Build')).toBeVisible();
    await expect(nextBar(page)).toContainText('A comparison is running');
    await expect(nextBar(page).getByRole('button')).toHaveText('Follow the comparison');
    await expect(stageButton(page, 'Simulation')).toContainText('comparing');
    await expect(stageButton(page, 'Report')).toBeDisabled();

    // The stage in view is not the one that shows the comparison, and the bar does not go on saying
    // that it runs once it has finished.
    await expect(nextBar(page).getByRole('button')).toHaveText('See the decision brief', {
      timeout: 90_000,
    });
    await expect(stageButton(page, 'Report')).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the next step from the keyboard', () => {
  test('is a tab stop between the stages and the work, and Enter and Space both take it', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.compared}`);
    const button = nextBar(page).getByRole('button', { name: 'See the decision brief' });
    // From the last control of the stage navigation, the next stop is the one next step.
    await page.getByRole('group', { name: 'Console view' }).getByRole('button').last().focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    expect(
      Number.parseFloat(await button.evaluate((element) => getComputedStyle(element).outlineWidth)),
      'a visible focus ring',
    ).toBeGreaterThanOrEqual(2);

    await page.keyboard.press('Enter');
    await expect(page.locator('#report-brief')).toBeFocused();
    await expect(page.locator('body')).not.toBeFocused();

    // Back the same way: the button now says where it goes, and Space takes it too.
    const back = nextBar(page).getByRole('button', { name: 'Back to the comparison' });
    await back.focus();
    await page.keyboard.press('Space');
    await expect(workbench(page, 'Simulation')).toBeFocused();
    await expect(stageButton(page, 'Simulation')).toHaveAttribute('aria-current', 'step');

    // Focus is on the stage, so the next Tab goes into it, not back to the top of the page. The
    // comparison is read as the stage opens, and until it is drawn there is nothing in it to reach.
    await expect(
      workbench(page, 'Simulation').getByRole('heading', { name: 'What this comparison says' }),
    ).toBeVisible();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('section.console-stage') !== null),
      'the next stop is inside the stage',
    ).toBe(true);
  });

  test('moves focus to the stage even when only the graph was showing', async ({ page }) => {
    await page.goto(`/?project=${ids.actors}`);
    await page
      .getByRole('group', { name: 'Console view' })
      .getByRole('button', { name: 'Graph' })
      .click();
    await expect(workbench(page, 'Graph Build')).toHaveCount(0);
    await nextBar(page).getByRole('button', { name: 'Compare the scenarios' }).click();
    await expect(workbench(page, 'Simulation')).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('the view a stage opens in', () => {
  test('is the stage’s own, and a narrow screen does not keep the workbench for good', async ({
    page,
  }) => {
    const view = (name: string): Locator =>
      page.getByRole('group', { name: 'Console view' }).getByRole('button', { name });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?project=${ids.actors}`);
    // The map is beside Graph Build, which is about it, and Env Setup has the whole width.
    await expect(view('Split')).toHaveAttribute('aria-pressed', 'true');
    await stageButton(page, 'Env Setup').click();
    await expect(view('Workbench')).toHaveAttribute('aria-pressed', 'true');
    await stageButton(page, 'Graph Build').click();
    await expect(view('Split')).toHaveAttribute('aria-pressed', 'true');

    // On a phone the map that was opened on its own gives way to the stage that is opened next...
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('group', { name: 'Console pane' })
      .getByRole('button', { name: 'Graph' })
      .click();
    await expect(workbench(page, 'Graph Build')).toHaveCount(0);
    await stageButton(page, 'Env Setup').click();
    await expect(workbench(page, 'Env Setup')).toBeVisible();
    // ...and is not held to once the window is wide again.
    await page.setViewportSize({ width: 1440, height: 900 });
    await stageButton(page, 'Graph Build').click();
    await expect(view('Split')).toHaveAttribute('aria-pressed', 'true');
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('Guided and Advanced', () => {
  test('both say that a stage is locked; Guided says in words what it needs, Advanced to a screen reader', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.approved}`);
    await expect(mode(page, 'Guided')).toHaveAttribute('aria-pressed', 'true');
    // A locked stage says what it is for, and under that what it needs.
    await expect(stageButton(page, 'Simulation').locator('.step-help')).toHaveText([
      'Run and compare scenarios',
      'Needs actors from Env Setup',
    ]);
    await expect(stageButton(page, 'Env Setup').locator('.step-help')).toHaveText(
      'Review stakeholders and actors',
    );

    await mode(page, 'Advanced').click();
    await expect(page.locator('.step-help')).toHaveCount(0);
    await expect(stageButton(page, 'Simulation')).toBeDisabled();
    await expect(stageButton(page, 'Simulation')).toContainText('locked');
    await expect(stageButton(page, 'Simulation')).toHaveAccessibleName(
      /Simulation.*locked.*step 3 of 5\. Needs actors from Env Setup/u,
    );
    // The next step is the same in both modes.
    await expect(nextBar(page)).toContainText('The stakeholders are approved');

    await mode(page, 'Guided').click();
    await expect(stageButton(page, 'Simulation').locator('.step-lock')).toHaveText(
      'Needs actors from Env Setup',
    );
  });

  test('Advanced keeps every stage reachable that the record opens', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('swarm.mode', 'advanced'));
    await page.goto(`/?project=${ids.compared}`);
    for (const name of ['Graph Build', 'Env Setup', 'Simulation', 'Report'] as const) {
      await expect(stageButton(page, name)).toBeEnabled();
    }
    await expect(stageButton(page, 'Interaction')).toBeDisabled();
    await nextBar(page).getByRole('button', { name: 'See the decision brief' }).click();
    await expect(workbench(page, 'Report')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('after a reload', () => {
  test('the same stages are open, the same ones locked, and the next step is named again', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.compared}`);
    await stageButton(page, 'Report').click();
    await expect(workbench(page, 'Report')).toBeVisible();
    await page.reload();

    // What opens a stage is on the server: the page reads it again and lands where the engine is.
    await expect(workbench(page, 'Graph Build')).toBeVisible();
    await expect(stageButton(page, 'Report')).toBeEnabled();
    await expect(stageButton(page, 'Report')).toContainText('ready to write');
    await expect(stageButton(page, 'Simulation')).toContainText('compared');
    await expect(stageButton(page, 'Interaction')).toBeDisabled();
    await expect(nextBar(page).getByRole('button')).toHaveText('See the decision brief');
    await expect(path(page).locator('.journey-step.done')).toHaveCount(COMPARED_DONE.length);
  });

  test('a locked stage is still locked, and the mode that was chosen is kept', async ({ page }) => {
    await page.goto(`/?project=${ids.approved}`);
    await mode(page, 'Advanced').click();
    await page.reload();
    await expect(mode(page, 'Advanced')).toHaveAttribute('aria-pressed', 'true');
    await expect(stageButton(page, 'Simulation')).toBeDisabled();
    await expect(stageButton(page, 'Simulation')).toContainText('locked');
    await expect(page.locator('.step-help')).toHaveCount(0);
    await expect(nextBar(page)).toContainText('The stakeholders are approved');
  });
});

// ---------------------------------------------------------------------------------------------

test.describe('in every theme, on a laptop and on a phone', () => {
  for (const [name, size] of [
    ['laptop', { width: 1366, height: 768 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    test.describe(name, () => {
      test.use({ viewport: size });

      for (const theme of THEMES) {
        test(`the locked stages and the next step are clean in the ${theme} theme`, async ({
          page,
        }) => {
          const problems = watchPage(page);
          await inTheme(page, theme);
          for (const level of ['approved', 'actors', 'compared'] as const) {
            await page.goto(`/?project=${ids[level]}`);
            await expect(stageButton(page, 'Report')).toContainText(LEVELS[level].stages.Report);
            const label = `${theme} ${name}: ${level}`;
            await expectNoAxeViolations(page, label);
            await expectNoHorizontalOverflow(page);
            await expectReadableText(page, label);
            await expectTargetSizes(page, label);
          }
          expect(problems).toEqual([]);
        });
      }
    });
  }

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('no stage name is broken in two, and the next step is whole on the screen', async ({
      page,
    }) => {
      await page.goto(`/?project=${ids.actors}`);
      const names = stepper(page).locator('strong');
      await expect(names).toHaveCount(5);
      for (const [index, expected] of STAGES.entries()) {
        const box = await names.nth(index).evaluate((element) => {
          const words = element.textContent!.split(' ');
          const range = document.createRange();
          range.selectNodeContents(element);
          const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
          return {
            words: words.length,
            lines: lines.size,
            width: element.scrollWidth,
            room: element.clientWidth,
          };
        });
        // One line per word at most, and no word wider than the room it has.
        expect(box.lines, `${expected}: lines`).toBeLessThanOrEqual(box.words);
        expect(box.width, `${expected}: a name wider than its room`).toBeLessThanOrEqual(
          box.room + 1,
        );
      }
      const bar = nextBar(page);
      await bar.scrollIntoViewIfNeeded();
      await expect(bar).toBeInViewport({ ratio: 1 });
      await expect(bar.getByRole('button')).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
    });

    test('the header goes with the page instead of keeping a quarter of the screen', async ({
      page,
    }) => {
      await page.goto(`/?project=${ids.actors}`);
      // The console is fetched when a project opens: measure the page once it is there.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const header = page.locator('header.app-header');
      expect((await header.boundingBox())!.height).toBeLessThan(200);
      expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe('static');
      await page.evaluate(() => window.scrollTo(0, 400));
      expect((await header.boundingBox())!.y).toBeLessThan(0);
    });
  });
});
