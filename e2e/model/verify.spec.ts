import { expect, test } from '@playwright/test';
import { runLiveVerification } from '../../scripts/azure/lib/verify-flow';
import { fetchHttp } from '../../scripts/azure/lib/verify-http';

const providerUrl = `http://127.0.0.1:${process.env.E2E_PROVIDER_PORT || 11999}`;
const AGENTS = 4;
const ROUNDS = 3;
const BRANCH_FROM_ROUND = 1;

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
