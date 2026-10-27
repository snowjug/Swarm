import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { advance, apiContext, createGuided, getProject } from '../support/helpers';

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

test.describe('model-assisted workflow against a protocol-faithful fake provider (not a live model)', () => {
  test.setTimeout(240_000);

  test('real UI pause → intervention → resume, honest token accounting, model report and actor chat', async ({
    page,
    playwright,
  }) => {
    const fake = await provider(playwright);
    await fake.reset();
    await fake.control({ latencyMs: 700 });
    const api = await apiContext(playwright);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await test.step('Model assisted mode is offered only because a provider is configured', async () => {
      const mode = page.getByRole('radio', { name: /Model assisted/ });
      await expect(mode).toBeEnabled();
      await mode.check();
      await page.getByRole('button', { name: 'Load fictional starter input' }).click();
      await page.getByRole('spinbutton', { name: 'Fictional proxies' }).fill(String(PROXIES));
      await page.getByRole('spinbutton', { name: 'Rounds / platform' }).fill(String(ROUNDS));
    });

    await test.step('Graph Build makes real provider calls and the graph comes from the model output', async () => {
      await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
      await expect(page.getByRole('button', { name: /Prepare environment/ })).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByRole('button', { name: /Library service, source Organization\. Inspect/ }),
      ).toBeAttached();
      const stats = await fake.stats();
      expect(stats.byKind).toMatchObject({ ontology: 1, graph: 1 });
    });

    const id = new URL(page.url()).searchParams.get('project')!;

    await test.step('Environment preparation uses model-generated personas', async () => {
      await page.getByRole('button', { name: /Prepare environment/ }).click();
      await expect(page.getByRole('button', { name: 'Start Simulation' })).toBeVisible({
        timeout: 60_000,
      });
      expect((await fake.stats()).byKind).toMatchObject({ personas: 1, environment: 1 });
    });

    let pausedAt = 0;
    await test.step('Pause while the simulation is genuinely running keeps saved rounds', async () => {
      await page.getByRole('button', { name: 'Start Simulation' }).click();
      await expect
        .poll(async () => (await getProject(api, id)).rounds.length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(2);
      await page.getByRole('button', { name: /Pause at last saved round/ }).click();
      const banner = page.getByText(/Paused after round \d+ of 8/).first();
      await expect(banner).toBeVisible({ timeout: 30_000 });
      pausedAt = Number(/round (\d+) of 8/.exec((await banner.textContent()) ?? '')?.[1]);
      expect(pausedAt).toBeGreaterThanOrEqual(2);
      expect(pausedAt).toBeLessThan(ROUNDS);

      const paused = await getProject(api, id);
      expect(paused.console?.steps.simulation).toBe('paused');
      expect(paused.status).toBe('ready');
      expect(paused.rounds).toHaveLength(pausedAt);
      // 4 setup calls + one call per proxy per platform per saved round, plus any in-flight work
      // that was really spent before the pause took effect.
      expect(paused.execution!.modelCalls).toBeGreaterThanOrEqual(4 + 2 * PROXIES * pausedAt);
      expect(paused.execution!.inputTokens).toBeGreaterThan(0);
      expect(paused.execution!.outputTokens).toBeGreaterThan(0);
    });

    await test.step('Schedule an intervention for a future round from the paused state', async () => {
      await page.getByText(/Edit scheduled intervention/).click();
      await page.getByLabel('Apply before round').selectOption(String(pausedAt + 2));
      await page
        .getByLabel(/Intervention label/)
        .fill('Assumed council announcement of longer hours');
      await page.getByLabel(/Assumed stance/).fill('0.9');
      await page.getByLabel(/Assumed strength/).fill('0.8');
      await page.getByRole('button', { name: 'Save future intervention' }).click();
      await expect(page.getByText(`Recorded schedule: round ${pausedAt + 2}`)).toBeVisible();
    });

    await test.step('Resume continues from the next round and the intervention reaches the provider', async () => {
      const actorBefore = (await fake.stats()).byKind.actor ?? 0;
      await page.getByRole('button', { name: /^Resume/ }).click();
      await expect(page.getByRole('button', { name: /Generate Report/ })).toBeVisible({
        timeout: 120_000,
      });
      const done = await getProject(api, id);
      expect(done.rounds).toHaveLength(ROUNDS);
      const applied = (done.rounds as { round: number; intervention: unknown }[]).filter(
        (round) => round.intervention !== null,
      );
      expect(applied.map((round) => round.round)).toEqual([pausedAt + 2]);
      const stats = await fake.stats();
      // Only the remaining rounds are requested again: one call per proxy on each of 2 platforms.
      expect((stats.byKind.actor ?? 0) - actorBefore).toBe(2 * PROXIES * (ROUNDS - pausedAt));
      // Every (platform, round, proxy) was decided by its own model call...
      const keys = Object.keys(stats.actors);
      expect(keys).toHaveLength(2 * ROUNDS * PROXIES);
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

    await test.step('Report: provider-planned tools, three chapters and real citations', async () => {
      await page.getByRole('button', { name: /Generate Report/ }).click();
      await expect(page.getByRole('button', { name: /Open Interaction/ })).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByText(/conditional comparison/i).first()).toBeVisible();
      expect((await fake.stats()).byKind).toMatchObject({ plan: 1, summary: 1, chapter: 3 });
      // The report's statements were checked by an independent call that had to quote real text.
      expect((await fake.stats()).byKind.entailment).toBe(1);
    });

    await test.step('Chat with a fictional actor is a real, labelled provider call', async () => {
      await page.getByRole('button', { name: /Open Interaction/ }).click();
      await page.getByRole('tab', { name: /Any fictional agent/ }).click();
      await page
        .getByRole('textbox', { name: /Question for this fictional proxy context/ })
        .fill('How did your position change during the scenario?');
      await page.getByRole('button', { name: 'Ask model' }).click();
      await expect(page.getByRole('region', { name: 'Saved conversation messages' })).toContainText(
        'this reply does not describe any real person',
        { timeout: 60_000 },
      );
      expect((await fake.stats()).byKind.followup).toBe(1);
    });

    await test.step('Usage is shown to the operator and never claims zero when calls happened', async () => {
      await page.getByText(/^Project [0-9a-f]{8}/).click();
      await expect(
        page.getByText(/\d+ real model calls · [1-9]\d* input \/ [1-9]\d* output tokens/),
      ).toBeVisible();
    });
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

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?project=${id}`);
    await page.getByRole('button', { name: 'Start Simulation' }).click();

    await expect(page.getByText(/Saved checkpoint at round 2/)).toBeVisible({ timeout: 60_000 });
    const failed = await getProject(api, id);
    expect(failed.console?.steps.simulation).toBe('failed');
    expect(failed.rounds).toHaveLength(2);
    expect(failed.status).toBe('failed');
    await expect(page.getByText(/Model provider returned HTTP 500/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Resume/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^(Retry|Restart) from round 1/ })).toBeVisible();

    await fake.control({ failOnRound: null });
    await page.getByRole('button', { name: /^Resume/ }).click();
    await expect(page.getByRole('button', { name: /Generate Report/ })).toBeVisible({
      timeout: 60_000,
    });
    const recovered = await getProject(api, id);
    expect(recovered.rounds).toHaveLength(6);
    expect(recovered.console?.steps.simulation).toBe('ready');
    expect((await fake.stats()).rounds).toEqual([1, 2, 3, 4, 5, 6]);
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

    await page.goto(`/?project=${id}`);
    await page.getByRole('button', { name: 'Build source graph' }).click();
    await expect(page.getByText(/Graph Build · failed/)).toBeVisible({ timeout: 60_000 });
    const failed = await getProject(api, id);
    expect(failed.console?.steps.knowledge).toBe('failed');
    expect((failed as unknown as { graph: unknown }).graph).toBeNull();
    expect(
      (failed as unknown as { events: { message: string }[] }).events.some((event) =>
        event.message.startsWith('MODEL_OUTPUT_INVALID'),
      ),
    ).toBe(true);

    await fake.control({ hostileCitation: false });
    await page.getByRole('button', { name: /Retry Graph Build/ }).click();
    await expect(page.getByRole('button', { name: /Prepare environment/ })).toBeVisible({
      timeout: 60_000,
    });
  });
});
