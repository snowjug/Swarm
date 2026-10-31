import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const localPort = Number(process.env.E2E_LOCAL_PORT || 3111);
const modelPort = Number(process.env.E2E_MODEL_PORT || 3112);
const journeyPort = Number(process.env.E2E_JOURNEY_PORT || 3113);
const signinPort = Number(process.env.E2E_SIGNIN_PORT || 3114);
const signinIdpPort = Number(process.env.E2E_SIGNIN_IDP_PORT || 3115);
const labPort = Number(process.env.E2E_LAB_PORT || 3116);
const providerPort = Number(process.env.E2E_PROVIDER_PORT || 11999);
// One throwaway root per run: the runner creates it and workers inherit it through the environment,
// so re-loading this file in a worker never creates another directory.
const dataRoot = (process.env.E2E_DATA_ROOT ??= mkdtempSync(join(tmpdir(), 'swarm-e2e-')));
const dataDir = (name: string): string => join(dataRoot, name);

const server = (port: number, name: string, extra: Record<string, string> = {}) => ({
  command: 'node dist/backend/src/index.js',
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  // Start-up is the one step whose duration depends on the machine; a failed start still fails.
  timeout: 120_000,
  env: {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir(name),
    LOG_LEVEL: 'warn',
    // The suite issues far more requests than a person would; production limits are tested in
    // backend/test/security.test.ts.
    RATE_LIMIT_SCALE: '100',
    ...extra,
  },
});

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Locally set PW_CHANNEL=msedge to reuse the installed Edge; CI installs Chromium.
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [
    {
      name: 'local',
      testMatch: /local\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${localPort}` },
    },
    {
      name: 'model',
      testMatch: /model\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${modelPort}` },
    },
    {
      // The presentation, on a server of its own that holds the committed demonstration, so that
      // it neither depends on nor changes what the other projects leave behind.
      name: 'journey',
      testMatch: /journey\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${journeyPort}` },
    },
    {
      // Browser sign-in with Microsoft Entra, against the real application and a test identity
      // provider (backend/test/support/signin-e2e-server.ts). Microsoft's own page is never reached.
      name: 'signin',
      testMatch: /signin\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${signinPort}` },
    },
    {
      // The scenario-lab journey in rules mode: intake, evidence, stakeholders, actors, analysis,
      // critics and the brief, on a server of its own.
      name: 'lab',
      testMatch: /lab\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${labPort}` },
    },
  ],
  webServer: [
    server(localPort, 'local', { AI_PROVIDER: 'none' }),
    server(journeyPort, 'journey', { AI_PROVIDER: 'none' }),
    server(labPort, 'lab', { AI_PROVIDER: 'none' }),
    {
      command: 'node --import tsx backend/test/support/signin-e2e-server.ts',
      url: `http://127.0.0.1:${signinPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        SIGNIN_E2E_PORT: String(signinPort),
        SIGNIN_E2E_IDP_PORT: String(signinIdpPort),
      },
    },
    {
      command: 'node --import tsx e2e/support/fake-provider.ts',
      url: `http://127.0.0.1:${providerPort}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_PROVIDER_PORT: String(providerPort) },
    },
    server(modelPort, 'model', {
      AI_PROVIDER: 'ollama',
      AI_MODEL: 'fake-model',
      OLLAMA_BASE_URL: `http://127.0.0.1:${providerPort}`,
    }),
  ],
});
