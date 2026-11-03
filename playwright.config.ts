import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const localPort = Number(process.env.E2E_LOCAL_PORT || 3111);
const modelPort = Number(process.env.E2E_MODEL_PORT || 3112);
const journeyPort = Number(process.env.E2E_JOURNEY_PORT || 3113);
const signinPort = Number(process.env.E2E_SIGNIN_PORT || 3114);
const signinIdpPort = Number(process.env.E2E_SIGNIN_IDP_PORT || 3115);
const labPort = Number(process.env.E2E_LAB_PORT || 3116);
const providerPort = Number(process.env.E2E_PROVIDER_PORT || 11999);
const labWebPort = Number(process.env.E2E_LAB_WEB_PORT || 3117);
const labWebFixturePort = Number(process.env.E2E_LAB_WEB_FIXTURE_PORT || 3118);
// Where the specs that add public web pages as evidence (ask-evidence.spec.ts, ask-pipeline.spec.ts) find
// their server and the fixture web server behind it; workers inherit them.
process.env.E2E_LAB_WEB_URL ??= `http://127.0.0.1:${labWebPort}`;
process.env.E2E_LAB_WEB_FIXTURE_URL ??= `http://127.0.0.1:${labWebFixturePort}`;
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

type Project = NonNullable<PlaywrightTestConfig['projects']>[number];
type WebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>;

// Each project and the servers it needs. `E2E_PROJECTS=lab,local` starts only those, which is how one
// area is run on its own without starting the rest.
const suites: Record<string, { project: Project; servers: WebServer[] }> = {
  local: {
    project: {
      name: 'local',
      testMatch: /local\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${localPort}` },
    },
    servers: [server(localPort, 'local', { AI_PROVIDER: 'none' })],
  },
  model: {
    project: {
      name: 'model',
      testMatch: /model\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${modelPort}` },
    },
    servers: [
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
  },
  journey: {
    // The presentation, on a server of its own that holds the committed demonstration, so that
    // it neither depends on nor changes what the other projects leave behind.
    project: {
      name: 'journey',
      testMatch: /journey\/.*\.spec\.ts/u,
      // The production journey and its failure cases run from playwright.journey.config.ts, on a harness of their own.
      testIgnore: /journey\/(?:production-journey|failure-cases)\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${journeyPort}` },
    },
    servers: [server(journeyPort, 'journey', { AI_PROVIDER: 'none' })],
  },
  signin: {
    // Browser sign-in with Microsoft Entra, against the real application and a test identity
    // provider (backend/test/support/signin-e2e-server.ts). Microsoft's own page is never reached.
    project: {
      name: 'signin',
      testMatch: /signin\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${signinPort}` },
    },
    servers: [
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
    ],
  },
  lab: {
    // The scenario-lab journey in rules mode: intake, evidence, stakeholders, actors, analysis,
    // critics and the brief, on a server of its own. ask-pipeline.spec.ts, and the public-page tests of
    // ask-evidence.spec.ts, run on the server with the fixture web instead (E2E_LAB_WEB_URL), because they
    // add public pages as evidence.
    project: {
      name: 'lab',
      testMatch: /lab\/.*\.spec\.ts/u,
      use: { baseURL: `http://127.0.0.1:${labPort}` },
    },
    servers: [
      server(labPort, 'lab', { AI_PROVIDER: 'none' }),
      {
        // The application in rules mode, with a web of fixture pages for "Add a public web page": the real
        // fetcher, a lookup that is a table and a connection that ends on this machine
        // (backend/test/support/lab-e2e-server.ts). No page on the internet is reached.
        command: 'node --import tsx backend/test/support/lab-e2e-server.ts',
        url: `http://127.0.0.1:${labWebPort}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          LAB_E2E_PORT: String(labWebPort),
          LAB_E2E_FIXTURE_PORT: String(labWebFixturePort),
        },
      },
    ],
  },
};

const chosen = (process.env.E2E_PROJECTS ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
for (const name of chosen) {
  if (!suites[name]) throw new Error(`E2E_PROJECTS names "${name}", which is not a project.`);
}
const active = Object.entries(suites).filter(
  ([name]) => chosen.length === 0 || chosen.includes(name),
);

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
  projects: active.map(([, suite]) => suite.project),
  webServer: active.flatMap(([, suite]) => suite.servers),
});
