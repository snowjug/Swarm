import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  watchPage,
} from '../support/helpers';
import {
  chooseRuns,
  finished,
  openSetup,
  progress,
  run,
  scenarioRows,
  seedByHand,
  seedHeavy,
  setup,
  startButton,
  startViaApi,
  stopEverything,
  theatre,
  BUS_RELATIONS,
  BUS_STAKEHOLDERS,
} from '../support/simulate';

// A simulation while it runs, and when it does not finish as it was asked to: its progress where the person is looking,
// stopping it, a second one refused in a sentence, a request that is too large, and a server that goes away in the middle.

let api: APIRequestContext;
const ids = {} as Record<'heavy' | 'fresh', string>;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  ids.heavy = await seedHeavy(api, 'Running: a cast that takes long to simulate');
  ids.fresh = await seedByHand(
    api,
    'Running: bus fares, not yet simulated',
    BUS_STAKEHOLDERS,
    BUS_RELATIONS,
  );
});

test.afterEach(async () => {
  await stopEverything(api, ids.heavy);
});

test.afterAll(async () => {
  await api.dispose();
});

test.describe('a simulation that is running', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows its progress where the person is looking, can be stopped, and shows no partial result', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSetup(page, ids.heavy);
    await chooseRuns(page, 100);
    await run(page);

    // The form that was pressed is gone: the screen shows the progress, with its figures in words.
    await expect(progress(page)).toBeVisible();
    await expect(progress(page)).toHaveAttribute(
      'aria-valuetext',
      /^[\d,]+ of 1,340 simulated runs finished$/u,
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /^(Running the scenarios|Testing which assumptions it leans on|Reading the results)$/u,
    );
    const lanes = page.getByRole('list', { name: 'Scenarios' });
    await expect(lanes.getByRole('listitem').first()).toContainText('No change');
    await expect(lanes).toContainText('Sensitivity');
    await expect(
      page.getByRole('status').filter({ hasText: /simulated runs are finished/u }),
    ).toHaveText(/^About \d+% of the simulated runs are finished\.$/u);
    await expect(page.getByRole('main')).toContainText('does not guarantee or precisely predict');

    // The server answers while it works, the whole time.
    const slowest = await page.evaluate(async () => {
      let worst = 0;
      for (let index = 0; index < 20; index += 1) {
        const at = performance.now();
        await (await fetch('/api/health')).text();
        worst = Math.max(worst, performance.now() - at);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return worst;
    });
    expect(slowest, 'the slowest answer of /api/health during the simulation, in ms').toBeLessThan(
      500,
    );

    // Stopping it says so until it has stopped, and the button cannot be pressed again meanwhile.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const cancelled = page.getByRole('status').filter({ hasText: 'This simulation was cancelled' });
    await expect(cancelled).toBeVisible();
    await expect(cancelled).toContainText(
      /It stopped after [\d,]+ of 1,340 runs\. Nothing is shown from a partial simulation/u,
    );
    await expect(
      cancelled.getByRole('button', { name: 'Run it again with the same settings' }),
    ).toBeEnabled();
    await expect(theatre(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Set the futures side by side',
    );
    expect(problems).toEqual([]);

    // It can be run again with the same settings, and stopped again.
    await cancelled.getByRole('button', { name: 'Run it again with the same settings' }).click();
    await expect(progress(page)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'This simulation was cancelled' }),
    ).toBeVisible();
    expect((await page.request.get('/api/health')).ok()).toBe(true);
  });

  test('refuses a second simulation for the same project in a sentence, not in the engine’s words', async ({
    page,
  }) => {
    const problems = watchPage(page, { refusals: true });
    await openSetup(page, ids.heavy);
    // The page was set up before anything ran, so its form is still there when another client starts one.
    const running = await startViaApi(api, ids.heavy, { runsPerVariant: 10 });
    await run(page);
    const refusal = page.getByRole('alert').filter({ hasText: 'The simulation did not start' });
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(
      'A comparison of scenarios is already running for this project. Wait for it to finish, or cancel it.',
    );
    await expect(refusal).not.toContainText(/ANALYSIS_|expected|Invalid|undefined/u);
    expect(problems.filter((problem) => !problem.includes('409'))).toEqual([]);

    // And stopping what has already finished or been cancelled is a sentence too.
    await api.post(`/api/projects/${ids.heavy}/analysis/${running.id}/cancel`);
    await finished(api, ids.heavy, running.id);
    const late = await api.post(`/api/projects/${ids.heavy}/analysis/${running.id}/cancel`);
    expect(late.status()).toBe(409);
    expect(((await late.json()) as { error: { message: string } }).error.message).toBe(
      'This comparison has already finished.',
    );
  });

  test('refuses a request that is too large or not understood, with the limit in a sentence', async () => {
    const refused = async (data: unknown): Promise<string> => {
      const response = await api.post(`/api/projects/${ids.fresh}/analysis`, {
        data: data as object,
      });
      expect(response.status(), JSON.stringify(data)).toBe(400);
      return ((await response.json()) as { error: { message: string } }).error.message;
    };
    const variant = (index: number) => ({
      id: index === 0 ? 'baseline' : `alt-${index}`,
      label: index === 0 ? 'No change' : `Alternative ${index}`,
      kind: index === 0 ? 'baseline' : 'alternative',
      intensity: index === 0 ? 0 : 0.5,
    });
    const nine = Array.from({ length: 9 }, (_, index) => variant(index));
    const eight = Array.from({ length: 8 }, (_, index) => variant(index));
    const messages = [
      await refused({ runsPerVariant: 5_000 }),
      await refused({ rounds: 99 }),
      await refused({ variants: nine }),
      await refused({ runsPerVariant: 200, variants: eight, sensitivity: true }),
      await refused({ variants: [variant(0), { ...variant(1), intensity: 1.5 }] }),
      await refused({ somethingElse: true }),
    ];
    expect(messages[0]).toBe(
      'Choose a whole number of seeded runs for each scenario, from 3 to 200.',
    );
    expect(messages[1]).toBe('A run has a whole number of rounds from 3 to 36.');
    expect(messages[2]).toContain('between 2 and 8 scenarios');
    expect(messages[3]).toMatch(
      /limit is 2,400\. Use fewer runs for each scenario or fewer scenarios, or turn sensitivity off\.$/u,
    );
    expect(messages[4]).toBe(
      'Scenario 2 was not accepted: its intensity has to be a number from 0 to 1.',
    );
    for (const message of messages)
      expect(message).not.toMatch(
        /expected|Invalid input|Too (big|small)|Unrecognized|undefined|\[object/u,
      );
    const oversized = await api.post(`/api/projects/${ids.fresh}/analysis`, {
      data: {
        runsPerVariant: 10,
        variants: [{ ...variant(0), description: 'x'.repeat(2_000_000) }],
      },
    });
    expect(oversized.status()).toBe(413);
    // Nothing was started by any of them.
    const listed = (await (await api.get(`/api/projects/${ids.fresh}/analysis`)).json()) as {
      analyses: unknown[];
    };
    expect(listed.analyses).toEqual([]);
  });

  test('says what a simulation will cost before it is started, follows what is chosen, and refuses a setup that is not allowed in words', async ({
    page,
  }) => {
    await openSetup(page, ids.fresh);
    const rows = scenarioRows(page);
    const estimate = setup(page)
      .getByText(/\d simulated runs.*scenarios ×/u)
      .first();
    await chooseRuns(page, 10);
    await expect(estimate).toContainText(`${await rows.count()} scenarios × 10`);
    await expect(estimate).toContainText('for sensitivity');
    // The sensitivity runs are the larger part of the work, and turning them off says so in the estimate.
    await setup(page).getByText('Test which assumptions it leans on', { exact: true }).click();
    await expect(
      setup(page).getByRole('switch', { name: /Test which assumptions it leans on/u }),
    ).not.toBeChecked();
    await expect(estimate).not.toContainText('for sensitivity');
    await setup(page).getByRole('button', { name: 'Add an alternative' }).click();
    await expect(estimate).toContainText(`${await rows.count()} scenarios × 10`);
    await expect(startButton(page)).toBeEnabled();

    // A name that is left empty is refused in words, and keeps the simulation from starting.
    const name = rows.last().getByRole('textbox', { name: /^Name of scenario/u });
    await name.fill('');
    await expect(setup(page).getByText('Give every scenario a name.')).toBeVisible();
    await expect(startButton(page)).toBeDisabled();
    await name.fill('A named change');
    await expect(startButton(page)).toBeEnabled();
  });
});

test.describe('a simulation that the server did not finish', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(240_000);
  let server: ChildProcess | undefined;
  const dataDir = join(process.env.E2E_DATA_ROOT ?? tmpdir(), 'simulate-interrupted');

  const freePort = (): Promise<number> =>
    new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });

  const launch = async (port: number): Promise<void> => {
    server = spawn('node', ['dist/backend/src/index.js'], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        DATA_DIR: dataDir,
        LOG_LEVEL: 'warn',
        RATE_LIMIT_SCALE: '100',
        AI_PROVIDER: 'none',
      },
      stdio: 'ignore',
    });
    await expect
      .poll(
        async () =>
          fetch(`http://127.0.0.1:${port}/api/health`).then(
            (response) => response.ok,
            () => false,
          ),
        { timeout: 60_000, intervals: [100, 250, 500] },
      )
      .toBe(true);
  };
  const stop = async (): Promise<void> => {
    if (!server || server.exitCode !== null) return;
    const gone = new Promise<void>((resolve) => server!.once('exit', () => resolve()));
    server.kill('SIGKILL');
    await gone;
  };

  test.afterEach(async () => {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('says on the open page that it cannot read the progress, then that it was interrupted, and can be run again', async ({
    page,
    playwright,
  }) => {
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    await launch(port);
    const own = await playwright.request.newContext({ baseURL: origin });
    const id = await seedHeavy(own, 'Running: interrupted');
    await page.goto(`${origin}/?project=${id}&scene=simulate&view=setup`);
    await expect(setup(page)).toBeVisible();
    await run(page);
    await expect(progress(page)).toBeVisible();
    await expect(progress(page)).toHaveAttribute('aria-valuenow', /^[1-9]\d*$/u, {
      timeout: 30_000,
    });

    // The server stops in the middle of the run, with the page open.
    await stop();
    const trouble = page
      .getByRole('status')
      .filter({ hasText: 'The progress cannot be read just now' });
    await expect(trouble).toBeVisible({ timeout: 20_000 });
    await expect(trouble).toContainText('It tries again by itself.');
    await expectNoAxeViolations(page, 'progress while the server is away');

    // It comes back and says what became of the simulation, without a reload.
    await launch(port);
    const interrupted = page
      .getByRole('status')
      .filter({ hasText: 'This simulation was interrupted' });
    await expect(interrupted).toBeVisible({ timeout: 60_000 });
    await expect(interrupted).toContainText(
      'It can be reproduced exactly from its seeds: run it again with the same settings.',
    );
    await expect(trouble).toHaveCount(0);
    await expect(theatre(page)).toHaveCount(0);
    await expectNoAxeViolations(page, 'an interrupted simulation');
    await expectNoHorizontalOverflow(page);

    // A reload says the same, and nothing is left running that no one is running.
    await page.reload();
    await expect(
      page.getByRole('status').filter({ hasText: 'This simulation was interrupted' }),
    ).toBeVisible();
    const listed = (await (await own.get(`/api/projects/${id}/analysis`)).json()) as {
      analyses: { status: string }[];
    };
    expect(listed.analyses.map((analysis) => analysis.status)).toEqual(['interrupted']);

    // Run again with the same settings: the same seeds, and it starts.
    await page.getByRole('button', { name: 'Run it again with the same settings' }).click();
    await expect(progress(page)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'This simulation was cancelled' }),
    ).toBeVisible();
    await own.dispose();
  });
});
