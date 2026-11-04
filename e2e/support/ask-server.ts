import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// A server of its own, for the specs that are about a setting that the servers of the suite do not have. The first
// screen draws what the server says it can do (`/api/config`), and a server researches unless it is set not to
// (`RESEARCH_ENABLED=off`), so the specs of the composer and of the scenario read from a question, which are written for
// a server where research is off and a project needs a source of its own, run on this one. It is the application as the
// suite's other servers run it (the built server where there is one, the source where there is not), on a port and in a
// data directory of its own, in rules mode.

export const MANUAL_PORT = Number(process.env.E2E_LAB_MANUAL_PORT ?? 3121);
export const MANUAL_URL = `http://127.0.0.1:${MANUAL_PORT}`;
/** Where the browser opens the page: the server's own (the built page), or a development server that proxies to it. */
export const MANUAL_PAGE_URL = process.env.E2E_LAB_MANUAL_PAGE_URL ?? MANUAL_URL;

async function ready(url: string, exited: () => number | null, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const code = exited();
    if (code !== null) throw new Error(`The server stopped (${code}).`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve_) => setTimeout(resolve_, 250));
  }
  throw new Error('The server did not start in time.');
}

/** Starts the application with research off, on its own port, and returns the way to stop it. */
export async function startServerWithoutResearch(): Promise<() => Promise<void>> {
  // The data of a run is in one root that the runner makes and its workers inherit; without it, one is made here.
  const root = process.env.E2E_DATA_ROOT ?? mkdtempSync(join(tmpdir(), 'swarm-e2e-'));
  const dataDir = join(root, 'manual');
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });

  const built = resolve('dist', 'backend', 'src', 'index.js');
  const entry = existsSync(built) ? [built] : ['--import', 'tsx', 'backend/src/index.ts'];
  const child = spawn('node', entry, {
    env: {
      ...process.env,
      PORT: String(MANUAL_PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      AI_PROVIDER: 'none',
      LOG_LEVEL: 'warn',
      RATE_LIMIT_SCALE: '100',
      RESEARCH_ENABLED: 'off',
      // For a page served by another server (the development server of the page), which reaches this one by a proxy.
      ...(process.env.E2E_LAB_MANUAL_ORIGINS
        ? { ALLOWED_ORIGINS: process.env.E2E_LAB_MANUAL_ORIGINS }
        : {}),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    await ready(MANUAL_URL, () => child.exitCode, 120_000);
  } catch (failure) {
    child.kill('SIGTERM');
    throw failure;
  }
  return () =>
    new Promise<void>((done) => {
      if (child.exitCode !== null) return done();
      child.once('exit', () => done());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    });
}
