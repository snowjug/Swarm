import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  DEFAULT_PORTS,
  type CanaryReport,
  type FoundryRequestSummary,
  type InstanceName,
  type JourneyState,
  type Person,
  type TelemetryReading,
  type WebLog,
} from '../../backend/test/support/journey-protocol';

// What the specs of the production journey share: where the application is (a harness of this repository, or a
// deployed endpoint), the control surface of the harness (failures to start, what was captured), who signs in, and where
// screenshots go. Everything that is about a screen is in journey-ui.ts, and everything about what the server holds is in
// journey-api.ts.

/**
 * `SWARM_JOURNEY_URL` points the same specs at a deployed https endpoint. The person is signed in already, by a storage
 * state of a browser that signed in (`SWARM_JOURNEY_STORAGE_STATE`, see docs/production/journey.md), and nothing of the
 * harness exists: whatever needs it is skipped, and says why.
 */
export const DEPLOYED_URL =
  (process.env.SWARM_JOURNEY_URL ?? '').trim().replace(/\/+$/u, '') || null;
export const deployed = DEPLOYED_URL !== null;

const port = (name: keyof typeof DEFAULT_PORTS): number =>
  Number(process.env[`JOURNEY_PORT_${name.toUpperCase()}`] ?? DEFAULT_PORTS[name]);

export const CONTROL_URL = `http://127.0.0.1:${port('control')}/__journey`;

/** Where the application of an instance is. A deployed endpoint has one, whatever it is asked for. */
export const instanceUrl = (name: InstanceName): string =>
  DEPLOYED_URL ?? `http://127.0.0.1:${port(name)}`;

export const SKIP_DEPLOYED =
  'Needs the harness (fake identity provider, fixture web, fake Foundry, failure controls), which a deployed endpoint does not have.';

/** Skips the test, with the reason, when it is pointed at a deployed endpoint. */
export function needsHarness(): void {
  test.skip(deployed, SKIP_DEPLOYED);
}

// ---------------------------------------------------------------------------------------------
// The control surface of the harness
// ---------------------------------------------------------------------------------------------

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${CONTROL_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`The journey harness refused ${method} ${path}: ${response.status}`);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const harness = {
  state: () => call<JourneyState>('GET', '/state'),
  /** A clean slate: no telemetry, no log of the web, no script for Foundry or the search, every failure ended. */
  reset: () => call<void>('POST', '/reset', {}),
  signInNext: (person: Person | 'declines') => call<void>('POST', '/idp/next', { person }),
  identityVisits: () => call<Record<string, string>[]>('GET', '/idp/visits'),
  web: () => call<WebLog>('GET', '/web'),
  resetWeb: () => call<void>('POST', '/web/reset', {}),
  /** A page that the crawler reaches is not answered until `release`, so that a run is held where a test needs it. */
  holdPage: (path: string) => call<void>('POST', '/web/hold', { path }),
  release: () => call<void>('POST', '/web/release', {}),
  /** The crawler's own limits (`requestTimeoutMs`, `idleMs`...), for the runs that follow. */
  tune: (tuning: Record<string, number>) => call<void>('POST', '/crawl/tuning', tuning),
  /** How long each simulated run waits before the next one, in ms, so that a person can act in the middle of one. */
  paceAnalysis: (ms: number) => call<void>('POST', '/analysis/pace', { ms }),
  foundryBehaviour: (
    behaviour: 'natural' | 'down' | 'content-filter' | 'invalid-json' | 'refusal',
  ) => call<void>('POST', '/foundry/behaviour', { behaviour }),
  foundryRequests: () => call<FoundryRequestSummary[]>('GET', '/foundry/requests'),
  foundryProblems: () => call<string[]>('GET', '/foundry/problems'),
  /** What the search double offers for the next question, or a failure it raises. */
  scriptSearch: (script: { hits?: string[]; failure?: string }) =>
    call<void>('POST', '/search/script', script),
  searchQuestions: () => call<string[]>('GET', '/search/questions'),
  databaseOutage: (instance: InstanceName, down: boolean) =>
    call<void>('POST', '/database/outage', { instance, down }),
  telemetry: () => call<TelemetryReading>('GET', '/telemetry'),
  resetTelemetry: () => call<void>('POST', '/telemetry/reset', {}),
  canaries: () => call<Record<string, string>>('GET', '/canaries'),
  /** Where each canary string was found among the logs, spans, metrics and audit rows: a place for each that was. */
  scanCanaries: () => call<CanaryReport>('GET', '/canaries/scan'),
  audit: (instance: InstanceName) =>
    call<{ action: string; detail: Record<string, unknown> }[]>(
      'GET',
      `/audit?instance=${instance}`,
    ),
  auditVerify: (instance: InstanceName) =>
    call<{ ok: boolean; checked: number }>('GET', `/audit/verify?instance=${instance}`),
};

// ---------------------------------------------------------------------------------------------
// Screenshots, and what a page says it is
// ---------------------------------------------------------------------------------------------

/** Where screenshots go: outside the repository when a person says where (`JOURNEY_SHOTS`), else under test-results. */
const SHOTS = process.env.JOURNEY_SHOTS ?? join('test-results', 'journey-shots');

/** A picture of the page as it is, for a person to look at. It asserts nothing. */
export async function shoot(
  page: Page,
  name: string,
  options: { full?: boolean } = {},
): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: options.full ?? true });
}

/** A signed-in browser's own requests to the application, as that person (the session cookie is the page's). */
export const asPerson = (page: Page): APIRequestContext => page.request;

/** The text of a response body, for the places a canary must not be. */
export const bodyText = async (response: { text(): Promise<string> }): Promise<string> =>
  (await response.text()).toString();

/** Reads a number out of a figure's text, such as "8Pages read". */
export const numberIn = (text: string): number =>
  Number(/\d[\d,]*/u.exec(text)?.[0]?.replace(/,/gu, '') ?? Number.NaN);

export { expect };
