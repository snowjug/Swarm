import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiContext, expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import { PHONE, allOf, audit, expectPressable, quiet } from '../support/shell';
import {
  BUS_RELATIONS,
  BUS_STAKEHOLDERS,
  chooseRuns,
  expectNoForecasts,
  freezeImpacts,
  latestId,
  openSetup,
  readViaApi,
  roundSlider,
  run,
  scenarioRows,
  seedByHand,
  seedExample,
  setScenario,
  setup,
  showView,
  simulateAt,
  startButton,
  startViaApi,
  finished,
  waitForTheatre,
} from '../support/simulate';

// The simulation as a person meets it, from the page that sets the futures side by side to the first thing it says:
// what is set, what is run, what is said of it and what must never be said. Stopping, refusing and interrupting are
// in simulate-running.spec.ts; the views of a finished simulation in simulate-theatre.spec.ts.

const EXAMPLES = ['copilot-in-teams', 'regional-price-change', 'ecommerce-experience'] as const;

const ids = {} as Record<
  (typeof EXAMPLES)[number] | 'bus' | 'fresh' | 'still' | 'undirected' | 'reproduce',
  string
>;
let api: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  api = await apiContext(playwright);
  for (const example of EXAMPLES) ids[example] = await seedExample(api, example, 'Simulate');
  ids.bus = await seedByHand(api, 'Simulate: regional bus fares', BUS_STAKEHOLDERS, BUS_RELATIONS);
  ids.fresh = await seedByHand(
    api,
    'Simulate: bus fares, not yet compared',
    BUS_STAKEHOLDERS,
    BUS_RELATIONS,
  );
  ids.reproduce = await seedByHand(
    api,
    'Simulate: bus fares, repeated',
    BUS_STAKEHOLDERS,
    BUS_RELATIONS,
  );
  const unclear = BUS_STAKEHOLDERS.map((stakeholder) => ({
    ...stakeholder,
    direction: 'unclear' as const,
  }));
  ids.still = await seedByHand(
    api,
    'Simulate: nobody has a direction, nothing to land on',
    unclear,
  );
  await freezeImpacts(api, ids.still);
  ids.undirected = await seedByHand(
    api,
    'Simulate: nobody has a direction, members differ',
    unclear,
  );
});

test.afterAll(async () => {
  await api.dispose();
});

test.describe('setting the futures side by side and running them', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const example of EXAMPLES) {
    test(`${example}: a baseline, the change and an alternative are set, run and said honestly`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.goto(simulateAt(ids[example]));
      await expect(setup(page)).toBeVisible();

      // Before anything runs: what is compared, and that how strongly it lands is the system's own guess.
      await expect(
        setup(page).getByText(
          'Every scenario runs on the same seeds, so the only difference between them is the change.',
        ),
      ).toBeVisible();
      const rows = scenarioRows(page);
      await expect(rows.first()).toContainText('Baseline');
      await expect(rows.first()).toContainText('Nothing changes');
      await expect(rows.nth(1)).toContainText('Proposed');
      expect(await rows.count()).toBeGreaterThanOrEqual(2);
      await expect(
        setup(page)
          .getByText(/\d[\d,]* simulated runs/u)
          .first(),
      ).toBeVisible();
      await expect(setup(page).getByText('none of it is a rate of anything real')).toBeAttached();

      // The person defines their own: the proposed change stronger and later, and one more way to do it.
      const before = await rows.count();
      await setScenario(rows.nth(1), { intensity: 0.8, round: 3 });
      await setup(page).getByRole('button', { name: 'Add an alternative' }).click();
      await expect(rows).toHaveCount(before + 1);
      await setScenario(rows.last(), {
        name: 'Staged rollout (intervention)',
        intensity: 0.35,
        round: 5,
      });
      await chooseRuns(page, 10);
      await run(page);
      await waitForTheatre(page);

      // What was set is said as set: the sentence that is saved says the values that were run.
      const analysis = await readViaApi(api, ids[example], await latestId(api, ids[example]));
      expect(analysis.config.runsPerVariant).toBe(10);
      const rollout = analysis.config.variants.find(
        (scenario) => scenario.label === 'Staged rollout (intervention)',
      )!;
      expect(rollout).toMatchObject({ intensity: 0.35, round: 5 });
      expect(rollout.description).toBe('Added by you. Intensity 0.35 from round 5 was set by you.');
      expect(
        analysis.config.variants.find((scenario) => scenario.id === 'proposed-change')!.description,
      ).toContain('Intensity 0.8 from round 3 was set by you.');

      // The first thing it says, in its own words, never what will happen.
      await showView(page, 'Story');
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        /of simulated members look for an alternative or resist|simulated members/u,
      );
      await expectNoForecasts(page, `${example}: the story`);
      expect(problems).toEqual([]);
    });
  }

  test('a question of the person’s own, in another domain: the suggested versions follow the amounts, and the second moves are read back', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSetup(page, ids.bus);
    const rows = scenarioRows(page);
    // The suggested larger and smaller versions follow the amounts the scenario states, and say they are suggestions.
    await expect(rows.first()).toContainText('No change');
    const names = await rows
      .getByRole('textbox', { name: /^Name of scenario/u })
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(names).toEqual([
      'Proposed change',
      'Smaller change (suggestion)',
      'Larger change (suggestion)',
    ]);
    const strength = async (index: number): Promise<number> =>
      Number(await rows.nth(index).getByRole('slider').getAttribute('aria-valuenow'));
    expect(await strength(2)).toBeLessThan(await strength(1));
    expect(await strength(3)).toBeGreaterThanOrEqual(await strength(1));

    await setScenario(rows.nth(1), { intensity: 1 });
    await setup(page).getByRole('button', { name: 'Add an alternative' }).click();
    await setScenario(rows.last(), {
      name: 'Student fare cap (intervention)',
      intensity: 0.3,
      round: 5,
    });
    await chooseRuns(page, 10);
    await run(page);
    await waitForTheatre(page);

    // What the typical run set off: who acted, in which round, because of which simulated signal.
    await showView(page, 'Story');
    const sets = page.getByRole('region', { name: 'What it sets off' });
    await expect(sets).toBeVisible();
    await expect(sets.getByRole('listitem').first()).toContainText(/Round \d+/u);
    await expect(sets).toContainText(/(counter-move|scrutiny|enablement|substitute-offer)/u);
    await expect(sets).toContainText(/the simulated .* signal/u);
    await expect(sets).toContainText('It is one run, not the answer.');
    await expectNoForecasts(page, 'the story of another domain');

    // The same run, round by round: the round in which it was set off says so in the theatre, from the engine's record.
    const analysis = await readViaApi(api, ids.bus, await latestId(api, ids.bus));
    const events = analysis.representativeRun!.events as { round: number; kind: string }[];
    expect(events.length).toBeGreaterThan(0);
    const first = events[0]!;
    await showView(page, 'Live');
    await roundSlider(page).focus();
    await page.keyboard.press('Home');
    for (let step = 1; step < first.round; step += 1) await page.keyboard.press('ArrowRight');
    await expect(roundSlider(page)).toHaveAttribute('aria-valuenow', String(first.round));
    await expect(page.getByRole('complementary', { name: `Round ${first.round}` })).toContainText(
      first.kind,
    );
    expect(problems).toEqual([]);
  });

  for (const [width, height] of [
    [1366, 768],
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`keeps the button that starts a simulation on the screen at ${width}x${height}, however long the form is`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openSetup(page, ids.fresh);
      const start = startButton(page);
      // Eight scenarios, the most there can be, make a form several screens long.
      while ((await scenarioRows(page).count()) < 8)
        await setup(page).getByRole('button', { name: 'Add an alternative' }).click();
      await expect(scenarioRows(page)).toHaveCount(8);
      await expect(setup(page).getByRole('button', { name: 'Add an alternative' })).toBeDisabled();
      await expect(start).toBeInViewport({ ratio: 1 });
      await page.mouse.wheel(0, 600);
      await expect(start).toBeInViewport({ ratio: 1 });
      // A field that takes focus is not left behind it, even when it is already on the screen, at its very foot.
      const last = scenarioRows(page).last().getByRole('slider');
      await last.evaluate((node) => {
        window.scrollBy(0, node.getBoundingClientRect().bottom - window.innerHeight + 2);
      });
      await last.focus();
      const [field, button] = await Promise.all([last.boundingBox(), start.boundingBox()]);
      expect(field!.y + field!.height).toBeLessThanOrEqual(button!.y + 1);
    });
  }

  test('says before and after the run that a change that cannot move anyone shows only chance', async ({
    page,
  }) => {
    await openSetup(page, ids.still);
    const warning = page
      .getByRole('status')
      .filter({ hasText: 'Nothing in this change can move anyone yet' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('every difference from no change is noise');
    await expect(warning).toContainText('You can still run it');
    await expect(warning.getByRole('button', { name: 'Review stakeholders' })).toBeVisible();
    await expect(startButton(page)).toBeEnabled();
    await chooseRuns(page, 10);
    await run(page);
    await waitForTheatre(page);

    // It says nothing of a direction, and a robust row is not allowed to read as a finding.
    await showView(page, 'Story');
    const notice = page.getByRole('status').filter({ hasText: 'Nothing here can move anyone' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Say who is helped or harmed in the stakeholder review');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText('a difference from no change below is noise');
    await expect(heading).not.toContainText(/favourable|look for an alternative or resist/u);
    await expectNoForecasts(page, 'a change that cannot move anyone');

    // The way to say who is helped or harmed is one press away, in the scene that asks it.
    await notice.getByRole('button', { name: 'Review stakeholders' }).click();
    await expect(page).toHaveURL(/scene=map/u);
    await page.goto(simulateAt(ids.still, 'setup'));
    await setup(page).getByRole('button', { name: 'Review stakeholders' }).click();
    await expect(page).toHaveURL(/scene=map/u);
  });

  test('says before and after the run that nobody has a direction, and not that nothing can move, where members still differ in how the change lands', async ({
    page,
  }) => {
    await openSetup(page, ids.undirected);
    const warning = page
      .getByRole('status')
      .filter({ hasText: 'No stakeholder has an expected direction yet' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('nobody is set as helped or harmed by the change');
    await expect(warning).toContainText('You can still run it');
    await expect(warning).not.toContainText(/cannot move anyone|can move anyone yet|noise/u);
    await expect(startButton(page)).toBeEnabled();
    await chooseRuns(page, 10);
    await run(page);
    await waitForTheatre(page);
    await showView(page, 'Story');
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'No stakeholder has an expected direction' });
    await expect(notice.first()).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('Nothing here can move anyone');
    await expectNoForecasts(page, 'nobody has a direction');
  });

  test('repeating a simulation on the same seeds gives the same numbers, and the page says which seeds', async ({
    page,
  }) => {
    await openSetup(page, ids.reproduce);
    await chooseRuns(page, 10);
    await run(page);
    await waitForTheatre(page);
    await showView(page, 'Story');
    await expect(page.getByRole('main')).toContainText('10 seeded runs of each, on the same seeds');
    const headline = async (): Promise<string> =>
      (await page.getByRole('heading', { level: 1 }).innerText()).replace(/\s+/gu, ' ');
    const first = await headline();
    const firstId = await latestId(api, ids.reproduce);

    // Run it again with the same settings, from the page that was opened from the results.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: /Run it again/u }).click();
    await expect(setup(page)).toBeVisible();
    await run(page);
    await waitForTheatre(page);
    await showView(page, 'Story');
    expect(await headline()).toBe(first);

    // The saved documents agree too, to the last digit; a different first seed does not.
    const stable = (analysis: Awaited<ReturnType<typeof readViaApi>>): string =>
      JSON.stringify([
        analysis.config.baseSeed,
        analysis.variants,
        analysis.findings,
        analysis.sensitivity,
        analysis.representativeRun,
      ]);
    const a = await readViaApi(api, ids.reproduce, firstId);
    const b = await readViaApi(api, ids.reproduce, await latestId(api, ids.reproduce));
    expect(b.id).not.toBe(a.id);
    expect(stable(b)).toBe(stable(a));
    const other = await finished(
      api,
      ids.reproduce,
      (await startViaApi(api, ids.reproduce, { runsPerVariant: 10, baseSeed: 4_242 })).id,
    );
    expect(other.config.baseSeed).toBe(4_242);
    expect(stable(other)).not.toBe(stable(a));
  });
});

// ---------------------------------------------------------------------------------------------
// The page that sets the futures, with a scenario added, at the sizes people use and in every theme
// ---------------------------------------------------------------------------------------------

for (const [label, viewport, themes, touch] of [
  ['a desktop', { width: 1440, height: 900 }, ['light', 'dark', 'high-contrast'], false],
  ['a laptop', { width: 1366, height: 768 }, ['light'], false],
  ['a tablet', { width: 768, height: 1024 }, ['light'], true],
  ['a phone', PHONE.viewport, ['light', 'dark'], true],
] as const) {
  test.describe(`on ${label}`, () => {
    test.use({ viewport, hasTouch: touch, reducedMotion: 'reduce' });

    test(`the setup, with a scenario added, passes axe in ${themes.join(', ')}, fits the page and is made for ${touch ? 'a finger' : 'a pointer'}`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      for (const theme of themes) {
        await page.addInitScript(
          (value) => window.localStorage.setItem('swarm.theme', value),
          theme,
        );
        await openSetup(page, ids.fresh);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const rows = await scenarioRows(page).count();
        if (rows < 3) await setup(page).getByRole('button', { name: 'Add an alternative' }).click();
        await expect(scenarioRows(page)).toHaveCount(Math.max(rows, 3));
        await audit(page, `the setup, ${theme}, ${label}`);
        if (theme !== themes[0]) continue;
        await quiet(page);
        await allOf({
          'no horizontal scroll': () => expectNoHorizontalOverflow(page),
          'controls of 24px or more': () =>
            expectPressable(page, `the setup ${label}`, { min: 24, scope: 'main' }),
          ...(touch
            ? {
                'controls a finger wide': () =>
                  expectPressable(page, `the setup ${label}`, { min: 44, scope: 'main' }),
              }
            : {}),
        });
      }
      expect(problems).toEqual([]);
    });
  });
}
