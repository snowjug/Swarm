#!/usr/bin/env node
/**
 * Local load/soak measurement for Swarm Lab (deterministic local engine only; no provider calls).
 *
 * Spawns its own isolated server (temporary data directory, raised rate-limit scale so the limiter
 * does not mask server behaviour) and reports latency percentiles, throughput, queue back-pressure,
 * 5xx counts and server memory. These are numbers for THIS machine, not a capacity guarantee.
 *
 *   node scripts/load-test.mjs [--port 3131] [--reads 3000] [--creates 40] [--workflows 12]
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

const run = promisify(execFile);
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, all) =>
        value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs,
      [],
    ),
);
const port = Number(args.port || 3131);
const reads = Number(args.reads || 3000);
const creates = Number(args.creates || 40);
const workflows = Number(args.workflows || 12);
const base = `http://127.0.0.1:${port}`;

const SOURCE = [
  'This is a fictional scenario for testing a proposed change to public library opening hours.',
  'The Library Service proposes opening until nine in the evening on weekdays and closing earlier on Sundays.',
  'Residents who work late support longer evening hours, while some neighbours worry about noise and staffing costs.',
  'The Local Council asks for usage evidence before approving any extra budget for the library.',
  'No survey has measured support. These notes describe proposed actions, not observed outcomes.',
].join('\n');

const dataDir = mkdtempSync(join(tmpdir(), 'swarm-load-'));
const server = spawn(process.execPath, ['dist/backend/src/index.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    AI_PROVIDER: 'none',
    LOG_LEVEL: 'error',
    RATE_LIMIT_SCALE: '1000',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

let peakRssMb = 0;
const sampler = setInterval(async () => {
  try {
    const command =
      process.platform === 'win32'
        ? ['powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${server.pid}).WorkingSet64`]]
        : ['ps', ['-o', 'rss=', '-p', String(server.pid)]];
    const { stdout } = await run(command[0], command[1]);
    const value = Number(stdout.trim());
    const mb = process.platform === 'win32' ? value / 1048576 : value / 1024;
    if (Number.isFinite(mb)) peakRssMb = Math.max(peakRssMb, mb);
  } catch {
    // Memory sampling is best-effort.
  }
}, 2000);

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) /
    10
  );
};
const summary = (values) => ({
  n: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  p99: percentile(values, 99),
  max: values.length ? Math.round(Math.max(...values) * 10) / 10 : null,
});

const statuses = {};
const tally = (status) => (statuses[status] = (statuses[status] || 0) + 1);

async function call(method, path, body) {
  const started = performance.now();
  const response = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  tally(response.status);
  return {
    status: response.status,
    ms: performance.now() - started,
    json: text ? JSON.parse(text) : null,
  };
}

async function pool(total, concurrency, task) {
  let next = 0;
  const results = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < total) {
        const index = next++;
        results[index] = await task(index);
      }
    }),
  );
  return results;
}

async function waitReady() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The server did not become ready.');
}

const guidedBody = (index) => ({
  name: `Load ${index}`,
  question:
    'How might fictional community groups respond to a proposed change in library opening hours?',
  workflow: 'guided',
  documents: [{ name: 'library.md', content: SOURCE }],
  settings: { mode: 'local', agentCount: 12, rounds: 8, seed: 1 + index, network: 'community' },
});

async function stage(id, step, queueFull) {
  for (;;) {
    const started = performance.now();
    const response = await call('POST', `/api/projects/${id}/steps/${step}`);
    if (response.status === 429 && response.json?.error?.code === 'QUEUE_FULL') {
      queueFull.count += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      continue;
    }
    if (response.status !== 202)
      throw new Error(`${step} -> ${response.status} ${JSON.stringify(response.json)}`);
    for (;;) {
      const detail = await call('GET', `/api/projects/${id}`);
      const state = detail.json?.console?.steps?.[step];
      if (state === 'ready') return performance.now() - started;
      if (state === 'failed' || state === 'cancelled') throw new Error(`${step} ended ${state}`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
}

const report = {
  machine: `${process.platform} ${process.arch}, node ${process.version}`,
  phases: {},
};
try {
  await waitReady();

  const health = [];
  await pool(reads, 64, async () => health.push((await call('GET', '/api/health')).ms));
  const list = [];
  await pool(reads, 64, async () => list.push((await call('GET', '/api/projects?limit=100')).ms));
  report.phases.readsIdle = { health: summary(health), list: summary(list), concurrency: 64 };

  const created = await pool(creates, 8, async (index) =>
    call('POST', '/api/projects', guidedBody(index)),
  );
  const ids = created.filter((item) => item.status === 201).map((item) => item.json.id);
  report.phases.creates = { ...summary(created.map((item) => item.ms)), created: ids.length };

  const queueFull = { count: 0 };
  const stageMs = { knowledge: [], environment: [], simulation: [], report: [] };
  const mixedReads = [];
  let running = true;
  const background = (async () => {
    while (running) {
      mixedReads.push((await call('GET', '/api/projects?limit=100')).ms);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })();
  const startedAt = performance.now();
  let completed = 0;
  let failed = 0;
  await pool(Math.min(workflows, ids.length), 6, async (index) => {
    try {
      for (const step of ['knowledge', 'environment', 'simulation', 'report']) {
        stageMs[step].push(await stage(ids[index], step, queueFull));
      }
      completed += 1;
    } catch (error) {
      failed += 1;
      console.error(`workflow ${index} failed:`, error.message);
    }
  });
  running = false;
  await background;
  report.phases.workflows = {
    requested: Math.min(workflows, ids.length),
    completed,
    failed,
    wallSeconds: Math.round((performance.now() - startedAt) / 100) / 10,
    queueFullRejections: queueFull.count,
    stageMs: Object.fromEntries(
      Object.entries(stageMs).map(([step, values]) => [step, summary(values)]),
    ),
    readsWhileWorkflowsRun: summary(mixedReads),
  };
  report.statusCounts = statuses;
  report.serverErrors5xx = Object.entries(statuses)
    .filter(([status]) => Number(status) >= 500)
    .reduce((sum, [, count]) => sum + count, 0);
  report.peakServerRssMb = Math.round(peakRssMb);
  console.log(JSON.stringify(report, null, 2));
  if (report.serverErrors5xx > 0 || failed > 0) process.exitCode = 1;
} finally {
  clearInterval(sampler);
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(dataDir, { recursive: true, force: true });
}
