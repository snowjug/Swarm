import { defineConfig } from '@playwright/test';

// The presentation journey against the server that will be shown, with a real model:
//
//   npm start                       (in another window, with the Azure settings in .env)
//   npm run demo:seed               (restore the demonstration first)
//   npm run demo:journey            (add -- to pass Playwright options)
//
// JOURNEY_URL    the server to test (default http://127.0.0.1:3001)
// JOURNEY_ASK=0  read the recorded conversation instead of asking the model new questions
// JOURNEY_SCREENSHOTS=<folder>  also save a screenshot of every key step (the backup set)
// JOURNEY_FORBIDDEN=a,b,c       values that must appear nowhere on any page or in any API answer
//                               (endpoint host, tenant, subscription): never written to the repository
process.env.JOURNEY_URL ||= 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: 'e2e/journey',
  // The other specs in this folder (themes, the report studio) need the throwaway server and data of
  // playwright.config.ts; only the presentation is meant to run against a server that is already up.
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
