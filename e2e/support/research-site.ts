import { spawn, type ChildProcess } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';

// The server of the research journey (backend/test/support/research-e2e-server.ts) and the web it can reach: the real
// application, reading fixture sites on this machine through the real crawler. See that file for what is replaced.

export const RESEARCH_PORT = Number(process.env.E2E_LAB_RESEARCH_PORT ?? 3119);
export const RESEARCH_FIXTURE_PORT = Number(process.env.E2E_LAB_RESEARCH_FIXTURE_PORT ?? 3120);
export const RESEARCH_URL = `http://127.0.0.1:${RESEARCH_PORT}`;
export const RESEARCH_FIXTURES = `http://127.0.0.1:${RESEARCH_FIXTURE_PORT}`;
/** Where the browser opens the page: the server's own (the built page), or a development server that proxies to it. */
export const RESEARCH_PAGE_URL = process.env.E2E_LAB_RESEARCH_PAGE_URL ?? RESEARCH_URL;

/** A site of the fixture web whose pages a run reads: links, a robots.txt, and one page of each kind that is set aside. */
export const OFFICIAL_SITE = 'harbour-authority.example.org';
/** A site with one page, for a person who names a page of their own. */
export const NEWS_SITE = 'ferry-news.example.org';
export const NEWS_PAGE = `https://${NEWS_SITE}/ferry/winter-crossings`;

/** The titles of the pages of the official site, as a person sees them in the list of pages. */
export const TITLES = {
  fees: 'Crossing fees for 2026',
  review: 'How the board reviewed crossing fees',
  press: 'Winter crossings counted',
  slow: 'Crossing times on each route',
  notice: 'Notice for readers of this site',
  news: 'Ferry operator reports winter crossings',
} as const;

export const QUESTION =
  'What could happen to ferry travel if the harbour board cut crossing fees next spring?';

export { NOTE } from './research-fake';

async function ready(url: string, process_: ChildProcess, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (process_.exitCode !== null)
      throw new Error(`The research server stopped (${process_.exitCode}).`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The research server did not start in time.');
}

/**
 * Starts the server of the journey on ports of its own, and returns the way to stop it. It serves the built page
 * (`frontend/dist`), as the other servers of the suite do.
 */
export async function startResearchServer(): Promise<() => Promise<void>> {
  const child = spawn('node', ['--import', 'tsx', 'backend/test/support/research-e2e-server.ts'], {
    env: {
      ...process.env,
      RESEARCH_E2E_PORT: String(RESEARCH_PORT),
      RESEARCH_E2E_FIXTURE_PORT: String(RESEARCH_FIXTURE_PORT),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    await ready(RESEARCH_URL, child, 120_000);
  } catch (failure) {
    child.kill('SIGTERM');
    throw failure;
  }
  return () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    });
}

export interface FixtureLog {
  attempts: { host: string; port: number; path: string }[];
  served: { host: string; path: string }[];
}

/** What the fetcher tried to reach and what the fixture web answered, since the last reset. */
export async function fixtureLog(request: APIRequestContext): Promise<FixtureLog> {
  return (await (await request.get(`${RESEARCH_FIXTURES}/__attempts`)).json()) as FixtureLog;
}

export async function resetFixtureLog(request: APIRequestContext): Promise<void> {
  await request.post(`${RESEARCH_FIXTURES}/__reset`);
}

/** Whether the server researches: where it does not, the journey has nothing to look at. */
export async function serverResearches(request: APIRequestContext): Promise<boolean> {
  const config = (await (await request.get(`${RESEARCH_URL}/api/config`)).json()) as {
    research?: { enabled?: unknown };
  };
  return config.research?.enabled === true;
}
