import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectScene, goTo, journey, notices, projectOf, settled, step } from '../support/app';
import { apiContext, listProjects, watchPage } from '../support/helpers';
import { pipelineCalls, recordApi } from '../support/lab-api';
import {
  PHONE,
  expectGates,
  historyButton,
  historyDialog,
  quiet,
  readJourney,
  recordOf,
  type Expected,
} from '../support/shell';

// The whole journey, in a real browser, the way a person walks it: a question and its evidence from an example,
// Ground, who is affected, the actors, the simulation and the theatre, the comparison, the decision. At each point the
// journey is read: which steps are open, which are locked and what each says it needs, and what the record on the
// server holds. Rules mode, so nothing here needs a model, and no call to one may be made.

const EXAMPLE = 'Online store checkout';
const RUN_FIRST = 'Run a simulation first';
const NEEDS_ACTORS = 'Needs actors';

const LOCKED = {
  simulate: { locked: NEEDS_ACTORS },
  compare: { locked: RUN_FIRST },
  decide: { locked: RUN_FIRST },
} as const;
const OPEN_FROM_THE_ACTORS: Partial<Record<'simulate' | 'compare' | 'decide', Expected>> = {
  simulate: 'open',
  compare: { locked: RUN_FIRST },
  decide: { locked: RUN_FIRST },
};

/**
 * Everything a page may ask of the server to walk this journey in rules mode, in the order a person asks for it:
 * the question read into a scenario, the exploration made, the stakeholders found and approved, the actors made, the
 * simulation run, the brief written. Nothing else: no model, no provider check, no chat.
 */
const EXPECTED_CALLS = [
  'POST /api/scenario/parse',
  'POST /api/projects',
  'POST /api/projects/:id/steps/knowledge',
  'POST /api/projects/:id/stakeholders/discover',
  'POST /api/projects/:id/stakeholders/approve',
  'POST /api/projects/:id/actors/generate',
  'POST /api/projects/:id/analysis',
  'POST /api/projects/:id/brief',
];

async function walk(
  page: Page,
  api: APIRequestContext,
  options: { phone: boolean },
): Promise<void> {
  const problems = watchPage(page);
  const calls = recordApi(page);
  const before = (await listProjects(api)).length;
  let id = '';

  await test.step('the first screen asks one question and has no journey yet', async () => {
    await page.goto('/');
    await settled(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'See how a decision could unfold.',
    );
    await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);
    await expect(
      page.getByText(
        'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
      ),
    ).toBeVisible();
  });

  await test.step('an example gives the question and its evidence, which are read into a scenario that can be corrected', async () => {
    await page.getByRole('button', { name: EXAMPLE, exact: true }).click();
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your scenario' })).toBeVisible();
    // Reading is not running: nothing exists on the server until the person goes on.
    expect((await listProjects(api)).length).toBe(before);
  });

  await test.step('Ground: the exploration is made and its evidence is read; the Map is open, the rest is locked and says why', async () => {
    await page.getByRole('button', { name: 'Ground it' }).click();
    await page.waitForURL(/[?&]project=/u);
    await expectScene(page, 'ground');
    id = projectOf(page);
    expect((await listProjects(api)).length).toBe(before + 1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('online store');
    await expectGates(
      page,
      { ground: 'open', map: 'open', ...LOCKED },
      'after the evidence is read',
    );

    // A locked step says what it needs when it is pressed, and stays where it is.
    await step(page, 'simulate').click({ force: true });
    await expect(notices(page).getByRole('status')).toContainText(NEEDS_ACTORS);
    await expectScene(page, 'ground');
  });

  await test.step('Map: the stakeholders are found by reading the text, and nothing is open that nobody approved', async () => {
    await page.getByRole('button', { name: 'Map the stakeholders' }).click();
    await expectScene(page, 'map');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Who is in play');
    await page.getByRole('button', { name: 'Find who is affected' }).click();
    const parties = page
      .getByRole('group', { name: 'Stakeholders and how they relate' })
      .getByRole('button');
    await expect(parties.first()).toBeVisible();
    expect(await parties.count(), 'parties on the map').toBeGreaterThan(8);
    await expectGates(page, { map: 'open', ...LOCKED }, 'stakeholders found, not approved');
    expect((await recordOf(api, id)).lab).toMatchObject({ stakeholders: 'proposed', actors: 0 });
  });

  await test.step('Map: approving the stakeholders makes the actors, and that is what opens Simulate', async () => {
    // On a phone the button says only "Approve".
    await page.getByRole('button', { name: /^Approve/u }).click();
    const next = page.getByRole('group', { name: 'Next' });
    await expect(next.getByRole('button', { name: 'Simulate' })).toBeVisible();
    await expectGates(page, OPEN_FROM_THE_ACTORS, 'actors made');
    await expect(step(page, 'map')).toHaveAttribute('data-state', 'done');
    await expect(step(page, 'map')).toHaveAccessibleName('Map, done');
    const { lab } = await recordOf(api, id);
    expect(lab.stakeholders).toBe('approved');
    expect(lab.actors).toBeGreaterThan(8);
    // The actors are stand-ins, and the page says so where they are made.
    await expect(
      page
        .getByText(/synthetic stand-ins/iu)
        .locator('visible=true')
        .first(),
    ).toBeVisible();
    await next.getByRole('button', { name: 'Simulate' }).click();
    await expectScene(page, 'simulate');
  });

  await test.step('Simulate: the futures are set up, the simulation runs, and the theatre shows what happened', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Set the futures');
    await page.getByRole('radio', { name: '10', exact: true }).check();
    await page.getByRole('button', { name: 'Run the simulation' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Watch it unfold' })).toBeVisible({
      timeout: 90_000,
    });
    // The line that says what this is: in full where there is room, and short on a phone.
    await expect(
      page
        .getByText(
          options.phone
            ? 'Synthetic actors. Not a prediction.'
            : 'Synthetic actors, simulated under stated assumptions. Not a prediction.',
        )
        .locator('visible=true')
        .first(),
    ).toBeVisible();
    // The comparison finished, so the two scenes after it are open, and Simulate is done.
    await expectGates(
      page,
      { simulate: 'open', compare: 'open', decide: 'open' },
      'after the simulation',
    );
    await expect(step(page, 'simulate')).toHaveAttribute('data-state', 'done');
    await expect(step(page, 'simulate')).toHaveAccessibleName('Simulate, done');
    expect((await recordOf(api, id)).lab.analysis).toBe('completed');
  });

  await test.step('Simulate: the theatre has four ways to look, a scrubber over the rounds, and every one keeps the address', async () => {
    const slider = page.getByRole('slider', { name: 'Round' });
    await expect(slider).toBeVisible();
    const last = Number(await slider.getAttribute('aria-valuemax'));
    await slider.focus();
    await page.keyboard.press('Home');
    expect(Number(await slider.getAttribute('aria-valuenow'))).toBeLessThan(last);
    await page.keyboard.press('End');
    expect(Number(await slider.getAttribute('aria-valuenow'))).toBe(last);

    for (const [view, param] of [
      ['Network', 'network'],
      ['Timeline', 'timeline'],
      ['Story', 'story'],
      ['Live', null],
    ] as const) {
      await page.getByRole('radio', { name: view, exact: true }).click();
      if (param) await expect(page).toHaveURL(new RegExp(`[?&]view=${param}(?:&|$)`, 'u'));
      else await expect(page).not.toHaveURL(/[?&]view=/u);
      await expectScene(page, 'simulate');
    }
  });

  await test.step('Compare: the futures are set side by side, and the scene opens without a fault', async () => {
    await goTo(page, 'compare');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('An exploration, not a forecast.')).toBeVisible();
    await expectGates(page, { compare: 'open', decide: 'open' });
  });

  await test.step('Decide: the brief is written from the comparison, and the journey ends in it', async () => {
    await goTo(page, 'decide');
    const write = page.getByRole('button', { name: 'Write the brief' });
    await expect(write).toBeVisible();
    await write.click();
    await expect
      .poll(async () => (await recordOf(api, id)).lab.brief, { timeout: 60_000 })
      .toBe(true);
    await expect(write).toHaveCount(0);
    await expect(step(page, 'decide')).toHaveAttribute('data-state', 'done');
    await expect(step(page, 'decide')).toHaveAccessibleName('Decide, done');
    const found = await readJourney(page);
    expect(Object.values(found).filter((gate) => gate?.locked)).toEqual([]);
  });

  await test.step('the exploration is kept: it is in the history, and opens again where its work ended', async () => {
    await quiet(page);
    await historyButton(page).click();
    await expect(historyDialog(page)).toContainText('Online store');
    await expect(historyDialog(page).getByText('Open now')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`/?project=${id}`);
    await settled(page);
    await expectScene(page, 'decide');
    const { lab } = await recordOf(api, id);
    expect(lab).toMatchObject({ stakeholders: 'approved', analysis: 'completed', brief: true });
  });

  // What the page asked of the server: what a person asked for, in order, and nothing else.
  expect(pipelineCalls(calls)).toEqual(EXPECTED_CALLS);
  expect(problems).toEqual([]);
}

test.describe('the journey from a question to a decision', () => {
  let api: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    api = await apiContext(playwright);
  });
  test.afterAll(async () => {
    await api.dispose();
  });

  test.describe('on a laptop', () => {
    test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

    test('a question becomes evidence, stakeholders, actors, a simulation, a comparison and a decision, and the journey opens one step at a time', async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await walk(page, api, { phone: false });
    });
  });

  test.describe('on a phone', () => {
    test.use({ ...PHONE, reducedMotion: 'reduce' });

    test('the same journey, by the dock and with a finger, reaches the same decision', async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await walk(page, api, { phone: true });
      // On a phone the dock is the only journey.
      await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(1);
      await expect(journey(page).getByRole('button')).toHaveCount(5);
    });
  });
});

// A person who comes back to an exploration that is part-way finds it where it was, not where it began.
test.describe('coming back to an exploration part-way', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('the journey is read again from the record: a reload on the Map keeps the stakeholders found and the steps locked', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto('/');
    await page.getByRole('button', { name: EXAMPLE, exact: true }).click();
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    await page.getByRole('button', { name: 'Ground it' }).click();
    await page.waitForURL(/[?&]project=/u);
    await page.getByRole('button', { name: 'Map the stakeholders' }).click();
    await page.getByRole('button', { name: 'Find who is affected' }).click();
    const parties = page
      .getByRole('group', { name: 'Stakeholders and how they relate' })
      .getByRole('button');
    await expect(parties.first()).toBeVisible();
    const found = await parties.count();

    await page.reload();
    await settled(page);
    await expectScene(page, 'map');
    await expect(
      page.getByRole('group', { name: 'Stakeholders and how they relate' }).getByRole('button'),
    ).toHaveCount(found);
    await expectGates(page, { map: 'open', ...LOCKED }, 'after a reload');
    expect(problems).toEqual([]);
  });
});
