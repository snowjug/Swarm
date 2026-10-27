import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const localPort = Number(process.env.E2E_LOCAL_PORT || 3111);
const modelPort = Number(process.env.E2E_MODEL_PORT || 3112);
const providerPort = Number(process.env.E2E_PROVIDER_PORT || 11999);
// Workers re-load this file; only the runner process owns the servers' data directories.
const owner = process.env.TEST_WORKER_INDEX === undefined;
const dataDir = (name: string): string =>
  owner ? mkdtempSync(join(tmpdir(), `swarm-e2e-${name}-`)) : '';

const server = (port: number, name: string, extra: Record<string, string> = {}) => ({
  command: 'node dist/backend/src/index.js',
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  timeout: 60_000,
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
  ],
  webServer: [
    server(localPort, 'local', { AI_PROVIDER: 'none' }),
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
