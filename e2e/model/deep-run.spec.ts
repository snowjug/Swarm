import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { advance, apiContext, createGuided, getProject, watchPage } from '../support/helpers';
import { deepStrip, openDeep, trackTo } from '../support/simulate';

// The run controls of the deep dive against a model provider that takes its time: a run is paused while it is genuinely
// running, takes the one assumed event, and resumes with only the rounds that are left; a provider that fails in the middle
// leaves a checkpoint to resume from. The provider is protocol-faithful and fake (e2e/support/fake-provider.ts): no real model.

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
// Fictional proxies in the first journey; each of the two platforms asks the model once per proxy per round.
const PROXIES = 6;
const ROUNDS = 8;

async function provider(playwright: PlaywrightWorkerArgs['playwright']) {
  const request: APIRequestContext = await playwright.request.newContext({ baseURL: providerUrl });
  return {
    reset: async () => void (await request.post('/__reset')),
    control: async (data: object) => void (await request.post('/__control', { data })),
    stats: async () =>
      (await (await request.get('/__stats')).json()) as {
        byKind: Record<string, number>;
        rounds: number[];
        actors: Record<string, number>;
      },
  };
}

interface Detail {
  status: string;
  rounds: { round: number; intervention: unknown }[];
  execution: { modelCalls: number; inputTokens: number; outputTokens: number } | null;
  console: { steps: Record<string, string> } | null;
}

test.describe('the run controls of the deep dive, with a model that takes its time', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(240_000);

  test('a run that is genuinely running is paused at its last saved round, takes an assumed event, and resumes with only the rounds that are left', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page);
    const fake = await provider(playwright);
    await fake.reset();
    await fake.control({ latencyMs: 700 });
    const api = await apiContext(playwright);
    const id = await createGuided(api, { mode: 'llm', agents: PROXIES, rounds: ROUNDS });
    await advance(api, id, 'knowledge');
    await advance(api, id, 'environment');
    expect((await fake.stats()).byKind).toMatchObject({ ontology: 1, graph: 1, personas: 1 });

    await openDeep(page, id);
    await expect(deepStrip(page)).toContainText('Ready to start');
    await deepStrip(page).getByRole('button', { name: 'Start the simulation' }).click();
    await expect(deepStrip(page)).toContainText('Running');
    await expect
      .poll(async () => (await getProject(api, id)).rounds.length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2);

    // The pause waits for the round that is in flight to be saved or discarded: what is saved stays, nothing is half saved.
    await deepStrip(page).getByRole('button', { name: 'Pause at the last saved round' }).click();
    await expect(deepStrip(page)).toContainText('Paused', { timeout: 30_000 });
    const paused = (await (await api.get(`/api/projects/${id}`)).json()) as Detail;
    const pausedAt = paused.rounds.length;
    expect(pausedAt).toBeGreaterThanOrEqual(2);
    expect(pausedAt).toBeLessThan(ROUNDS);
    expect(paused.console?.steps.simulation).toBe('paused');
    expect(paused.status).toBe('ready');
    await expect(deepStrip(page)).toContainText(
      `After round ${pausedAt} of ${ROUNDS}. Saved and resumable.`,
    );
    await expect(page.getByText('Saved rounds are kept', { exact: true })).toBeVisible();
    // The model calls that were really made are counted: 4 for the set-up, then one per proxy per platform per saved round.
    expect(paused.execution!.modelCalls).toBeGreaterThanOrEqual(4 + 2 * PROXIES * pausedAt);
    expect(paused.execution!.inputTokens).toBeGreaterThan(0);
    expect(paused.execution!.outputTokens).toBeGreaterThan(0);

    // Only now can the event be scheduled, in a round that has not run.
    const section = page.getByRole('region', { name: 'An assumed event' });
    await expect(section).toContainText('No event is scheduled.');
    await trackTo(
      section.getByRole('slider', { name: 'Round the event is applied before' }),
      pausedAt + 2,
    );
    await section
      .getByRole('textbox', { name: 'What happens' })
      .fill('Assumed council announcement of longer hours');
    await section.getByRole('spinbutton', { name: 'Stance' }).fill('0.9');
    await section.getByRole('spinbutton', { name: 'Strength' }).fill('0.8');
    await section.getByRole('button', { name: 'Schedule the event' }).click();
    await expect(section).toContainText(`Scheduled before round ${pausedAt + 2}`);

    // Resuming asks the model only for the rounds that were not saved, and the event reaches it in the round it names.
    const before = (await fake.stats()).byKind.actor ?? 0;
    await deepStrip(page)
      .getByRole('button', {
        name: new RegExp(`^Resume — simulate rounds ${pausedAt + 1}–${ROUNDS}`, 'u'),
      })
      .click();
    await expect(deepStrip(page)).toContainText('Finished', { timeout: 150_000 });
    const done = (await (await api.get(`/api/projects/${id}`)).json()) as Detail;
    expect(done.rounds).toHaveLength(ROUNDS);
    expect(
      done.rounds.filter((round) => round.intervention !== null).map((round) => round.round),
    ).toEqual([pausedAt + 2]);
    await expect(section).toContainText(`Applied in round ${pausedAt + 2}`);
    const stats = await fake.stats();
    expect((stats.byKind.actor ?? 0) - before).toBe(2 * PROXIES * (ROUNDS - pausedAt));
    // Every (platform, round, proxy) was decided by a call of its own, and a round saved before the pause was never asked again.
    expect(Object.keys(stats.actors)).toHaveLength(2 * ROUNDS * PROXIES);
    for (const [key, count] of Object.entries(stats.actors)) {
      if (Number(key.split(':')[1]) <= pausedAt) expect(count, key).toBe(1);
    }
    expect(problems, 'what the page logged or failed at').toEqual([]);
  });

  test('a provider that fails in the middle leaves a checkpoint, and the run resumes from it once the provider answers again', async ({
    page,
    playwright,
  }) => {
    const fake = await provider(playwright);
    await fake.reset();
    await fake.control({ latencyMs: 30, failOnRound: 3 });
    const api = await apiContext(playwright);
    const id = await createGuided(api, { mode: 'llm', agents: PROXIES, rounds: 6 });
    await advance(api, id, 'knowledge');
    await advance(api, id, 'environment');

    await openDeep(page, id);
    await deepStrip(page).getByRole('button', { name: 'Start the simulation' }).click();
    await expect(deepStrip(page)).toContainText('Stopped', { timeout: 60_000 });
    await expect(deepStrip(page)).toContainText('After round 2 of 6. The saved rounds are kept.');
    await expect(page.getByText('A saved checkpoint at round 2')).toBeVisible();
    await expect(page.getByText(/Model provider returned HTTP 500/u).first()).toBeVisible();
    const failed = (await (await api.get(`/api/projects/${id}`)).json()) as Detail;
    expect(failed.console?.steps.simulation).toBe('failed');
    expect(failed.rounds).toHaveLength(2);
    expect(failed.status).toBe('failed');

    // Two ways on are offered, and the one that keeps the saved rounds is the main one.
    await expect(
      deepStrip(page).getByRole('button', { name: /^Resume — simulate rounds 3–6/u }),
    ).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Retry from round 1/u })).toBeVisible();

    await fake.control({ failOnRound: null });
    await deepStrip(page)
      .getByRole('button', { name: /^Resume — simulate rounds 3–6/u })
      .click();
    await expect(deepStrip(page)).toContainText('Finished', { timeout: 90_000 });
    const recovered = await getProject(api, id);
    expect(recovered.rounds).toHaveLength(6);
    expect(recovered.console?.steps.simulation).toBe('ready');
    // Each round was asked for once: the two that were saved before the failure were not asked again.
    expect((await fake.stats()).rounds).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
