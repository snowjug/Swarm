import { expect, test, type Page } from '@playwright/test';
import { runLiveVerification } from '../../scripts/azure/lib/verify-flow';
import { fetchHttp } from '../../scripts/azure/lib/verify-http';
import { openApp } from '../support/app';
import { expectNoAxeViolations, expectNoHorizontalOverflow, watchPage } from '../support/helpers';
import { quiet } from '../support/shell';

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const AGENTS = 4;
const ROUNDS = 3;
const BRANCH_FROM_ROUND = 1;

test.describe('the connection check in the page, against a protocol-faithful fake provider (not a live model)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  test.setTimeout(120_000);

  const chip = (page: Page) =>
    page.getByRole('banner').getByRole('button', { name: /^REAL MODEL · Ollama \(local\)/u });
  const popover = (page: Page) => page.getByRole('dialog', { name: 'Model provider' });

  test('is one real request, told as it went: configured is not connected, a failure is a failure, and trying again recovers', async ({
    page,
    playwright,
  }) => {
    const problems = watchPage(page, { refusals: true });
    const fake = await playwright.request.newContext({ baseURL: providerUrl });
    await fake.post('/__reset');
    await fake.post('/__control', { data: { latencyMs: 0 } });
    const pings = async () =>
      ((await (await fake.get('/__stats')).json()) as { byKind: Record<string, number> }).byKind
        .ping ?? 0;

    await openApp(page);
    await expect(chip(page)).toContainText('not verified yet');
    await chip(page).click();
    const panel = popover(page);

    await test.step('a provider that is only configured is not called connected, and nothing was sent to it', async () => {
      await expect(panel.getByRole('heading', { name: 'Not verified yet' })).toBeVisible();
      await expect(panel).toContainText(
        'Configured is not a connectivity check. Verify to make one real request.',
      );
      await expect(panel).not.toContainText('Connection verified');
      expect(await pings()).toBe(0);
    });

    await test.step('verifying makes one request, and says what came of it', async () => {
      await panel.getByRole('button', { name: 'Verify connection' }).click();
      await expect(panel).toContainText('Connection verified: one real round trip completed');
      await expect(panel.getByRole('heading', { name: 'Connected' })).toBeVisible();
      await expect(chip(page)).toContainText('connected');
      expect(await pings()).toBe(1);
      await quiet(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page, 'the provider popover, verified');
    });

    await test.step('a provider that fails the check is told as failing, with its reason, and the check can be made again', async () => {
      await fake.post('/__control', { data: { failKind: 'ping' } });
      await panel.getByRole('button', { name: 'Verify connection' }).click();
      await expect(
        panel.getByRole('alert').filter({ hasText: 'Connection check failed' }),
      ).toBeVisible();
      // The server records the failed check, and the page reads it back instead of guessing.
      await expect(panel.getByRole('heading', { name: 'Failing' })).toBeVisible();
      await expect(panel).not.toContainText('Connection verified');
      await expect(chip(page)).toContainText('failing');
      await quiet(page);
      await expectNoAxeViolations(page, 'the provider popover, failing');

      await fake.post('/__control', { data: { failKind: null } });
      await panel.getByRole('button', { name: 'Verify connection' }).click();
      await expect(panel).toContainText('Connection verified: one real round trip completed');
      await expect(panel.getByRole('heading', { name: 'Connected' })).toBeVisible();
    });

    await fake.post('/__reset');
    await fake.dispose();
    // The failed check is provoked, and the browser logs its refusal.
    expect(problems.filter((problem) => !/status of 502/u.test(problem))).toEqual([]);
  });

  test('when the server cannot say how the provider is, the chip says so and one press reads it again', async ({
    page,
    playwright,
  }) => {
    const fake = await playwright.request.newContext({ baseURL: providerUrl });
    await fake.post('/__reset');
    await fake.dispose();
    let refuse = true;
    await page.route('**/api/provider/status', (route) =>
      refuse
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'UNAVAILABLE', message: 'The server could not read the provider.' },
            }),
          })
        : route.continue(),
    );
    await openApp(page);
    const unavailable = page
      .getByRole('banner')
      .getByRole('button', { name: /status unavailable/u });
    await expect(unavailable).toBeVisible();
    await unavailable.click();
    const panel = popover(page);
    await expect(panel.getByRole('heading', { name: 'Status unavailable' })).toBeVisible();
    // It never claims the provider is connected when it does not know.
    await expect(panel).not.toContainText(/Connected|Connection verified/u);
    refuse = false;
    await panel.getByRole('button', { name: 'Retry' }).click();
    // Whatever the server says it is now (it remembers an earlier check), it is said, and the unknown is gone.
    await expect(
      panel.getByRole('heading', { name: /^(?:Not verified yet|Connected|Failing)$/u }),
    ).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Status unavailable' })).toHaveCount(0);
    await expect(chip(page)).toBeVisible();
  });
});

test.describe('live-verification script against a protocol-faithful fake provider (not a live model)', () => {
  test.setTimeout(240_000);

  test('passes every check through the real HTTP stack, and the provider independently saw the calls', async ({
    baseURL,
    playwright,
  }) => {
    const provider = await playwright.request.newContext({ baseURL: providerUrl });
    await provider.post('/__reset');
    await provider.post('/__control', { data: { latencyMs: 0 } });
    try {
      const report = await runLiveVerification(fetchHttp(baseURL ?? '', 60_000), {
        expectProvider: 'ollama',
        expectAuth: 'none',
        agents: AGENTS,
        rounds: ROUNDS,
        probe: true,
        stepTimeoutMs: 120_000,
        pollMs: 250,
      });

      const unmet = report.checks.filter((check) => check.status !== 'pass');
      expect(unmet, JSON.stringify(unmet, null, 2)).toEqual([]);
      expect(report.verified).toBe(true);

      // Ground truth from the provider's side: one call per proxy per platform per round, for the
      // original run and for the branch's later rounds only.
      const stats = (await (await provider.get('/__stats')).json()) as {
        byKind: Record<string, number>;
      };
      expect(stats.byKind.actor).toBe(
        AGENTS * 2 * ROUNDS + AGENTS * 2 * (ROUNDS - BRANCH_FROM_ROUND),
      );
      expect(stats.byKind.ping).toBe(1);
      expect(stats.byKind.entailment).toBeGreaterThanOrEqual(1);
    } finally {
      await provider.post('/__reset');
      await provider.dispose();
    }
  });

  test('refuses to pass when the server is not set up for the provider that was expected', async ({
    baseURL,
  }) => {
    const report = await runLiveVerification(fetchHttp(baseURL ?? '', 30_000), {
      expectProvider: 'azure',
      expectAuth: 'entra',
      agents: AGENTS,
      rounds: ROUNDS,
      probe: true,
      stepTimeoutMs: 10_000,
      pollMs: 250,
    });

    expect(report.verified).toBe(false);
    expect(report.checks[0]).toMatchObject({ id: 'provider-config', status: 'fail' });
    expect(report.checks.slice(1).every((check) => check.status === 'skipped')).toBe(true);
  });
});
