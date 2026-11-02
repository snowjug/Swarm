import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { openApp } from '../support/app';
import { advance, apiContext, createGuided, getProject, watchPage } from '../support/helpers';
import { forget, openSettings } from '../support/shell';

// The model-assisted path of an exploration, through the real page, on a server whose model is the fake provider
// (e2e/support/fake-provider.ts): a protocol-faithful stand-in, not evidence of what any real model would write. What is
// proven here is what the server and the page do with the provider: that the exploration is made by the model only
// because a provider is configured, that every stage asks the provider for exactly what it needs and no more, that a
// pause keeps what was saved and a resume asks only for what is left, that a provider that fails mid-run leaves a
// checkpoint that the person can resume from, that what the model invents is refused, and that the usage is told as it is.

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
// Fictional proxies in the first journey; each platform asks the model once per proxy per round.
const PROXIES = 6;
const ROUNDS = 8;

async function provider(playwright: PlaywrightWorkerArgs['playwright']) {
  const request: APIRequestContext = await playwright.request.newContext({ baseURL: providerUrl });
  return {
    reset: async () => void (await request.post('/__reset')),
    control: async (data: object) => void (await request.post('/__control', { data })),
    stats: async () =>
      (await (await request.get('/__stats')).json()) as {
        calls: number;
        byKind: Record<string, number>;
        rounds: number[];
        actors: Record<string, number>;
      },
  };
}

/** The deep dive of a project: where the engine's own stages are run, paused, scheduled and read. */
const deepDive = (id: string) => `/?project=${id}&scene=simulate&view=deep`;

test.describe('model-assisted workflow against a protocol-faithful fake provider (not a live model)', () => {
  test.setTimeout(300_000);
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('the exploration is made by the model, a pause keeps the saved rounds, a scheduled event reaches the provider, and the usage is told as it is', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page);
    const fake = await provider(playwright);
    await fake.reset();
    await fake.control({ latencyMs: 700 });
    const api = await apiContext(playwright);
    await page.goto('/');

    await test.step('Model assisted is offered only because a provider is configured, and the exploration is read by the model', async () => {
      await page.getByRole('button', { name: 'Options' }).click();
      const options = page.getByRole('dialog', { name: 'Options' });
      const model = options.getByRole('radio', { name: 'Model assisted' });
      await expect(model).toBeEnabled();
      await model.click();
      await expect(options).toContainText(
        'Your question and evidence context are sent to this provider.',
      );
      await options.getByRole('spinbutton', { name: 'Proxies' }).fill(String(PROXIES));
      await options.getByRole('spinbutton', { name: 'Rounds' }).fill(String(ROUNDS));
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Library hours', exact: true }).click();
      await page.getByRole('button', { name: 'Explore', exact: true }).click();
      await page.getByRole('button', { name: 'Ground it' }).click();
      await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible({
        timeout: 90_000,
      });
      const stats = await fake.stats();
      expect(stats.byKind).toMatchObject({ ontology: 1, graph: 1 });
    });

    const id = new URL(page.url()).searchParams.get('project')!;
    const made = await getProject(api, id);
    expect(made).toMatchObject({ mode: 'llm' });

    await test.step('the cast is written by the model', async () => {
      await advance(api, id, 'environment');
      expect((await fake.stats()).byKind).toMatchObject({ personas: 1, environment: 1 });
    });

    let pausedAt = 0;
    await test.step('a pause while the simulation is really running keeps the rounds that were saved', async () => {
      await page.goto(deepDive(id));
      await page.getByRole('button', { name: 'Start the simulation' }).click();
      await expect
        .poll(async () => (await getProject(api, id)).rounds.length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(2);
      await page.getByRole('button', { name: 'Pause at the last saved round' }).click();
      await expect(page.getByText('Saved rounds are kept')).toBeVisible({ timeout: 30_000 });

      const paused = await getProject(api, id);
      pausedAt = paused.rounds.length;
      expect(pausedAt).toBeGreaterThanOrEqual(2);
      expect(pausedAt).toBeLessThan(ROUNDS);
      expect(paused.console?.steps.simulation).toBe('paused');
      expect(paused.status).toBe('ready');
      // 4 setup calls + one call per proxy per platform per saved round, plus any in-flight work that was really
      // spent before the pause took effect.
      expect(paused.execution!.modelCalls).toBeGreaterThanOrEqual(4 + 2 * PROXIES * pausedAt);
      expect(paused.execution!.inputTokens).toBeGreaterThan(0);
      expect(paused.execution!.outputTokens).toBeGreaterThan(0);
    });

    await test.step('an event is scheduled for a future round from the paused state', async () => {
      const round = page.getByRole('slider', { name: 'Round the event is applied before' });
      await round.focus();
      await page.keyboard.press('End');
      await page
        .getByRole('textbox', { name: 'What happens' })
        .fill('Assumed council announcement of longer hours');
      await page.getByRole('button', { name: 'Schedule the event' }).click();
      await expect(
        page.getByRole('region', { name: 'Notifications' }).getByText('Event scheduled'),
      ).toBeVisible();
      const scheduled = await getProject(api, id);
      expect(scheduled.settings.intervention).toMatchObject({
        round: ROUNDS,
        label: 'Assumed council announcement of longer hours',
      });
    });

    await test.step('a resume asks only for the rounds that are left, and the event reaches the provider', async () => {
      const before = (await fake.stats()).byKind.actor ?? 0;
      await page.getByRole('button', { name: /^Resume/u }).click();
      await expect(page.getByRole('button', { name: 'Write the detailed report' })).toBeVisible({
        timeout: 120_000,
      });
      const done = await getProject(api, id);
      expect(done.rounds).toHaveLength(ROUNDS);
      const applied = (done.rounds as { round: number; intervention: unknown }[]).filter(
        (round) => round.intervention !== null,
      );
      expect(applied.map((round) => round.round)).toEqual([ROUNDS]);
      const stats = await fake.stats();
      // Only the remaining rounds are asked for again: one call per proxy on each of two platforms.
      expect((stats.byKind.actor ?? 0) - before).toBe(2 * PROXIES * (ROUNDS - pausedAt));
      // Every (platform, round, proxy) was decided by its own call...
      expect(Object.keys(stats.actors)).toHaveLength(2 * ROUNDS * PROXIES);
      for (const platform of ['plaza', 'community']) {
        for (let round = 1; round <= ROUNDS; round += 1) {
          for (let proxy = 1; proxy <= PROXIES; proxy += 1) {
            expect(stats.actors[`${platform}:${round}:agent-${proxy}`]).toBeGreaterThanOrEqual(1);
          }
        }
      }
      // ...and a round that was saved before the pause was never asked for again.
      for (const [key, count] of Object.entries(stats.actors)) {
        if (Number(key.split(':')[1]) <= pausedAt) expect(count, key).toBe(1);
      }
    });

    await test.step('the report is planned by the provider, written in three chapters, and its statements are checked', async () => {
      await page.getByRole('button', { name: 'Write the detailed report' }).click();
      await expect
        .poll(async () => (await getProject(api, id)).report?.title ?? '', { timeout: 120_000 })
        .not.toBe('');
      const stats = await fake.stats();
      expect(stats.byKind).toMatchObject({ plan: 1, summary: 1, chapter: 3 });
      // The report's statements were checked by an independent call that had to quote real text.
      expect(stats.byKind.entailment).toBe(1);
    });

    await test.step('a conversation with a fictional actor is a real, labelled provider call', async () => {
      await page.getByRole('button', { name: 'Ask about this' }).click();
      const sheet = page.getByRole('dialog', { name: 'Ask' });
      await sheet.getByRole('tab', { name: /^Actors/u }).click();
      await sheet
        .getByRole('textbox', { name: /^Question for / })
        .fill('How did your position change during the scenario?');
      await sheet.getByRole('button', { name: 'Ask model' }).click();
      await expect(sheet).toContainText('this reply does not describe any real person', {
        timeout: 60_000,
      });
      expect((await fake.stats()).byKind.followup).toBe(1);
      await page.keyboard.press('Escape');
    });

    await test.step('the usage is told to the person who owns the project and never claims zero when calls happened', async () => {
      const menu = await openSettings(page);
      await menu.getByRole('menuitem', { name: 'Model budget' }).click();
      const budget = page.getByRole('dialog', { name: 'Model budget' });
      const calls = budget.getByRole('meter', { name: 'Model calls' });
      await expect(calls).toBeVisible();
      expect(Number(await calls.getAttribute('aria-valuenow'))).toBeGreaterThan(
        4 + 2 * PROXIES * ROUNDS,
      );
      const tokens = budget.getByRole('meter', { name: /^Tokens/u });
      expect(Number(await tokens.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
    });

    expect(problems.filter((problem) => !problem.startsWith('console'))).toEqual([]);
    await forget(api, [id]);
    await api.dispose();
  });

  test('a mid-run provider failure leaves a checkpoint; fixing the provider and resuming completes the run', async ({
    page,
    playwright,
  }) => {
    const fake = await provider(playwright);
    await fake.reset();
    await fake.control({ latencyMs: 30, failOnRound: 3 });
    const api = await apiContext(playwright);
    const id = await createGuided(api, { mode: 'llm', agents: 6, rounds: 6 });
    await advance(api, id, 'knowledge');
    await advance(api, id, 'environment');

    await openApp(page, { project: id, scene: 'simulate', view: 'deep' });
    await page.getByRole('button', { name: 'Start the simulation' }).click();

    await expect(page.getByText('A saved checkpoint at round 2')).toBeVisible({ timeout: 60_000 });
    const failed = await getProject(api, id);
    expect(failed.console?.steps.simulation).toBe('failed');
    expect(failed.rounds).toHaveLength(2);
    expect(failed.status).toBe('failed');
    await expect(page.getByText(/Model provider returned HTTP 500/u).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Resume/u })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Retry from round 1/u })).toBeVisible();

    await fake.control({ failOnRound: null });
    await page.getByRole('button', { name: /^Resume/u }).click();
    await expect(page.getByRole('button', { name: 'Write the detailed report' })).toBeVisible({
      timeout: 60_000,
    });
    const recovered = await getProject(api, id);
    expect(recovered.rounds).toHaveLength(6);
    expect(recovered.console?.steps.simulation).toBe('ready');
    expect((await fake.stats()).rounds).toEqual([1, 2, 3, 4, 5, 6]);
    await forget(api, [id]);
    await api.dispose();
  });

  test('invented citations from the provider are rejected, nothing is persisted as complete, and retry works', async ({
    page,
    playwright,
  }) => {
    const fake = await provider(playwright);
    await fake.reset();
    await fake.control({ latencyMs: 20, hostileCitation: true });
    const api = await apiContext(playwright);
    const id = await createGuided(api, { mode: 'llm', agents: 6, rounds: 4 });

    await openApp(page, { project: id });
    await page.getByRole('button', { name: 'Ground it' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Reading the sources failed' }),
    ).toBeVisible({
      timeout: 60_000,
    });
    const failed = await getProject(api, id);
    expect(failed.console?.steps.knowledge).toBe('failed');
    expect((failed as unknown as { graph: unknown }).graph).toBeNull();
    expect(
      (failed as unknown as { events: { message: string }[] }).events.some((event) =>
        event.message.startsWith('MODEL_OUTPUT_INVALID'),
      ),
    ).toBe(true);

    await fake.control({ hostileCitation: false });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Map the stakeholders' })).toBeVisible({
      timeout: 60_000,
    });
    await forget(api, [id]);
    await api.dispose();
  });
});
