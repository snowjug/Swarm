import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { CANARIES, CANARY_HEADER, DEFAULT_PORTS } from './backend/test/support/journey-protocol';

// Two things run from this file, chosen by SWARM_JOURNEY_SUITE.
//
// demo (the default): the presentation journey against the server that will be shown, with a real model:
//
//   npm start                       (in another window, with the Azure settings in .env)
//   npm run demo:seed               (restore the demonstration first)
//   npm run demo:journey            (add -- to pass Playwright options)
//
//   JOURNEY_URL    the server to test (default http://127.0.0.1:3001)
//   JOURNEY_ASK=0  read the recorded conversation instead of asking the model new questions
//   JOURNEY_SCREENSHOTS=<folder>  also save a screenshot of every key step (the backup set)
//   JOURNEY_FORBIDDEN=a,b,c       values that must appear nowhere on any page or in any API answer
//                                 (endpoint host, tenant, subscription): never written to the repository
//
// production: the critical journey and its failure cases, end to end in a real browser (docs/production/journey.md):
//
//   SWARM_JOURNEY_SUITE=production npx playwright test --config playwright.journey.config.ts
//
//   It starts the harness itself (backend/test/support/journey-server.ts: the real application twice, a fake identity
//   provider, a fixture web, a fake Foundry), on ports 3501 to 3512.
//
//   SWARM_JOURNEY_URL=https://...   runs the same specs against a deployed endpoint instead, with no harness: whatever
//   needs the fakes is skipped, and says why. SWARM_JOURNEY_STORAGE_STATE=<file> is the signed-in browser state to use.
//   JOURNEY_SHOTS=<folder>          where the screenshots go (default test-results/journey-shots)
//   JOURNEY_DB=pglite               runs the harness on PostgreSQL in the process instead of SQLite
const deployedUrl = (process.env.SWARM_JOURNEY_URL ?? '').trim().replace(/\/+$/u, '');
const suite = process.env.SWARM_JOURNEY_SUITE ?? (deployedUrl ? 'production' : 'demo');
const port = (name: keyof typeof DEFAULT_PORTS): number =>
  Number(process.env[`JOURNEY_PORT_${name.toUpperCase()}`] ?? DEFAULT_PORTS[name]);

process.env.JOURNEY_URL ||= 'http://127.0.0.1:3001';

const demo = defineConfig({
  testDir: 'e2e/journey',
  // Only the presentation is meant to run against a server that is already up; a spec added to this folder
  // runs under playwright.config.ts, on the throwaway server and data of its own.
  testMatch: /demo-journey\.spec\.ts/u,
  globalSetup: './e2e/journey/live-preflight.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/journey',
  use: {
    baseURL: process.env.JOURNEY_URL,
    // A step that cannot find what it needs fails in seconds, not at the end of the test timeout.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Locally set PW_CHANNEL=msedge to reuse the installed Edge; CI installs Chromium.
    channel: process.env.PW_CHANNEL || undefined,
  },
});

const production = defineConfig({
  testDir: 'e2e/journey',
  testMatch: /(?:production-journey|failure-cases)\.spec\.ts/u,
  fullyParallel: false,
  // One browser at a time: the journey is serial, and the machine is shared.
  workers: 1,
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  // One more try, and Playwright reports a test that needed it as flaky: defect J-03 (docs/production/journey.md), an
  // intermittent stall of the crawler, ends a run early now and then, and the specs name it when it does.
  retries: 1,
  reporter: [['list']],
  outputDir: 'test-results/journey-production',
  use: {
    baseURL: deployedUrl || `http://127.0.0.1:${port('rules')}`,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
    // A canary that every request of the browser carries: the applications must never write it anywhere.
    extraHTTPHeaders: { [CANARY_HEADER]: CANARIES.requestHeader },
    ...(deployedUrl && process.env.SWARM_JOURNEY_STORAGE_STATE
      ? { storageState: process.env.SWARM_JOURNEY_STORAGE_STATE }
      : {}),
    channel: process.env.PW_CHANNEL || undefined,
  },
  ...(deployedUrl
    ? {}
    : {
        webServer: {
          command: 'node --import tsx backend/test/support/journey-server.ts',
          url: `http://127.0.0.1:${port('control')}/__journey/state`,
          reuseExistingServer: false,
          // Start-up is the one step whose duration depends on the machine; a failed start still fails.
          timeout: 180_000,
          env: {
            JOURNEY_DATA_DIR: join(process.cwd(), 'data', 'journey'),
            ...(process.env.JOURNEY_DB ? { JOURNEY_DB: process.env.JOURNEY_DB } : {}),
          },
        },
      }),
});

export default suite === 'production' ? production : demo;
