#!/usr/bin/env node
/**
 * Crash recovery, on real processes: a server is killed in the middle of a model-assisted simulation,
 * started again on the same data, and the run is left to finish. Nothing in it is simulated: the
 * server is `dist/backend/src/index.js`, the process is ended with SIGKILL (no shutdown hook runs),
 * and the model is the protocol-faithful fake of e2e/support/fake-provider.ts, so no credential or
 * model is involved. It says nothing about a hosted deployment, where the database is PostgreSQL and
 * the processes are containers; it shows that the durable-job design survives the loss of a process.
 *
 * What it checks, and exits 1 if any fails:
 *   - the run is not marked failed by the restart: a job owns it;
 *   - the run finishes on its own after the lease of the dead process runs out;
 *   - the rounds saved before the kill are not computed again (the provider is asked for each of them
 *     once), and every saved round holds one action per proxy per platform;
 *   - the project's model budget counted the calls on both sides of the kill, and none twice;
 *   - the audit log's hash chain still verifies.
 *
 *   npm run build
 *   node scripts/resilience-test.mjs [--rounds 8] [--agents 6] [--latency 700] [--kill-delay 350] [--port 3133]
 *
 * The kill comes --kill-delay milliseconds after a round is saved, which is while the model calls of the
 * next one are in flight: the provider has been asked and the server has not heard back. With 0 it comes
 * at the boundary between two rounds.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, all) =>
        value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs,
      [],
    ),
);
const rounds = Number(args.rounds || 8);
const agents = Number(args.agents || 6);
const latencyMs = Number(args.latency || 700);
const killDelayMs = Number(args['kill-delay'] ?? 350);
const port = Number(args.port || 3133);
const providerPort = Number(args['provider-port'] || 11997);
const base = `http://127.0.0.1:${port}`;
const provider = `http://127.0.0.1:${providerPort}`;
const LEASE_SECONDS = 10;

const SOURCE = [
  'This is a fictional scenario for testing a proposed change to public library opening hours.',
  'The Library Service proposes opening until nine in the evening on weekdays and closing earlier on Sundays.',
  'Residents who work late support longer evening hours, while some neighbours worry about noise and staffing costs.',
  'The Local Council asks for usage evidence before approving any extra budget for the library.',
  'No survey has measured support. These notes describe proposed actions, not observed outcomes.',
].join('\n');

const dataDir = mkdtempSync(join(tmpdir(), 'swarm-resilience-'));
const children = new Set();

function launch(command, argv, env) {
  const child = spawn(command, argv, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

const startProvider = () =>
  launch(process.execPath, ['--import', 'tsx', 'e2e/support/fake-provider.ts'], {
    FAKE_PROVIDER_PORT: String(providerPort),
  });

const startServer = () =>
  launch(process.execPath, ['dist/backend/src/index.js'], {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'error',
    RATE_LIMIT_SCALE: '100',
    AI_PROVIDER: 'ollama',
    AI_MODEL: 'fake-model',
    OLLAMA_BASE_URL: provider,
    JOB_LEASE_SECONDS: String(LEASE_SECONDS),
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, timeoutMs, probe) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await sleep(150);
  }
}

async function api(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const controlProvider = (control) =>
  fetch(`${provider}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(control),
  });
const providerStats = async () => (await fetch(`${provider}/__stats`)).json();
const savedRounds = (project) =>
  Math.max(0, ...(project.console?.platforms ?? []).map((run) => run.rounds.length));

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const report = { machine: `${process.platform} ${process.arch}, node ${process.version}` };
try {
  startProvider();
  await until('the fake provider', 30_000, async () => (await fetch(`${provider}/__health`)).ok);
  await controlProvider({ latencyMs: 0 });
  let server = startServer();
  await until('the server', 60_000, async () => (await fetch(`${base}/api/health`)).ok);

  const created = await api('POST', '/api/projects', {
    name: 'Resilience: crash during a simulation',
    question:
      'How might fictional community groups respond to a proposed change in library opening hours?',
    workflow: 'guided',
    documents: [{ name: 'library.md', content: SOURCE }],
    settings: { mode: 'llm', agentCount: agents, rounds, seed: 7, network: 'community' },
  });
  if (created.status !== 201) throw new Error(`create -> ${created.status}`);
  const id = created.json.id;
  const project = async () => (await api('GET', `/api/projects/${id}`)).json;

  for (const step of ['knowledge', 'environment']) {
    const started = await api('POST', `/api/projects/${id}/steps/${step}`);
    if (started.status !== 202) throw new Error(`${step} -> ${started.status}`);
    await until(`${step} to be ready`, 120_000, async () => {
      const state = (await project()).console?.steps?.[step];
      if (state === 'failed') throw new Error(`${step} failed`);
      return state === 'ready';
    });
  }

  // Slow the provider so that the simulation lasts long enough to be caught part-way, then start it.
  await controlProvider({ latencyMs });
  const startedAt = performance.now();
  const started = await api('POST', `/api/projects/${id}/steps/simulation`);
  if (started.status !== 202) throw new Error(`simulation -> ${started.status}`);

  await until('some rounds to be saved', 240_000, async () => {
    const current = await project();
    const saved = savedRounds(current);
    return current.console?.steps?.simulation === 'running' && saved >= 3 && saved < rounds
      ? saved
      : null;
  });
  await sleep(killDelayMs);
  // What was saved at the moment of the kill, read as late as it can be.
  const savedAtKill = savedRounds(await project());
  const killedAfterMs = Math.round(performance.now() - startedAt);
  server.kill('SIGKILL');
  await new Promise((resolve) => server.once('exit', resolve));
  const statsAtKill = await providerStats();
  console.log(
    `Killed the server with SIGKILL after ${savedAtKill} of ${rounds} rounds were saved (${killedAfterMs} ms into the simulation).`,
  );
  report.crash = { savedRoundsAtKill: savedAtKill, rounds, providerCallsAtKill: statsAtKill.calls };

  // A person who comes back finds the run where it was; the new process takes it up once the lease of the
  // dead one has run out.
  await controlProvider({ latencyMs: 150 });
  server = startServer();
  await until(
    'the server to start again',
    60_000,
    async () => (await fetch(`${base}/api/health`)).ok,
  );
  const restartedAt = performance.now();
  const afterRestart = await project();
  check(
    'the restart does not mark the run failed',
    afterRestart.status !== 'failed' && afterRestart.console?.steps?.simulation !== 'failed',
    `status ${afterRestart.status}, simulation ${afterRestart.console?.steps?.simulation}`,
  );
  check(
    'the rounds saved before the kill survived it',
    savedRounds(afterRestart) >= savedAtKill,
    `${savedRounds(afterRestart)} saved, ${savedAtKill} before`,
  );

  const finished = await until('the run to finish by itself', 300_000, async () => {
    const current = await project();
    const state = current.console?.steps?.simulation;
    if (state === 'failed' || state === 'cancelled') {
      throw new Error(`The simulation ended ${state}: ${current.error ?? ''}`);
    }
    return state === 'ready' ? current : null;
  });
  const resumedAfterMs = Math.round(performance.now() - restartedAt);
  check('the run finishes by itself after the restart', true, `${resumedAfterMs} ms after it`);

  const runs = finished.console.platforms;
  check(
    'every platform has every round',
    runs.length > 0 && runs.every((run) => run.rounds.length === rounds),
    runs.map((run) => `${run.platform}: ${run.rounds.length}`).join(', '),
  );
  const keys = runs.flatMap((run) =>
    run.rounds.flatMap((round) =>
      round.actions.map((action) => `${run.platform}:${action.round}:${action.agentId}`),
    ),
  );
  check(
    'every saved round holds one action per proxy per platform, none twice',
    new Set(keys).size === keys.length && keys.length === runs.length * rounds * agents,
    `${keys.length} actions, ${new Set(keys).size} distinct, ${runs.length * rounds * agents} expected`,
  );

  const stats = await providerStats();
  const asked = Object.entries(stats.actors);
  const recomputed = asked.filter(([, count]) => count > 1);
  // A call that was in flight when the process died was asked of the provider and never answered to
  // the server, so the round it belonged to is computed again: that is the next round, and only it.
  const recomputedSaved = recomputed.filter(([key]) => Number(key.split(':')[1]) <= savedAtKill);
  const recomputedOutsideNext = recomputed.filter(
    ([key]) => Number(key.split(':')[1]) > savedAtKill + 1,
  );
  check(
    'the rounds saved before the kill were not computed again',
    recomputedSaved.length === 0 && recomputedOutsideNext.length === 0,
    `${recomputed.length} of the ${asked.length} actor calls were asked twice, all for the round that was under way`,
  );
  report.recovery = {
    resumedAfterMs,
    actorCalls: asked.reduce((sum, [, count]) => sum + count, 0),
    actorCallsRepeated: recomputed.length,
    providerCalls: stats.calls,
  };

  const budget = (await api('GET', `/api/projects/${id}/budget`)).json.budget;
  const lost = stats.calls - budget.calls;
  check(
    'the model budget counted the calls on both sides of the kill, and none twice',
    budget.calls > statsAtKill.calls && lost >= 0 && lost <= agents * 2 + 2,
    `${budget.calls} counted of ${stats.calls} the provider answered; ${lost} were in flight when the process died`,
  );
  report.budget = { counted: budget.calls, answeredByProvider: stats.calls };

  const jobs = (await api('GET', `/api/projects/${id}/jobs`)).json;
  const job = (jobs.jobs ?? []).find((candidate) => candidate.kind === 'simulation');
  check(
    'the simulation job was taken again by the new process and completed',
    job !== undefined && job.attempt >= 2 && ['completed', 'partial'].includes(job.state),
    job ? `attempt ${job.attempt}, state ${job.state}` : 'no simulation job found',
  );

  const audit = (await api('GET', '/api/audit/verify')).json;
  check('the audit chain verifies', audit?.ok === true, `${audit?.checked} entries checked`);

  report.checks = checks;
  console.log(JSON.stringify(report, null, 2));
  if (checks.some((entry) => !entry.ok)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill('SIGKILL');
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
