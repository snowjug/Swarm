// What a browser run of the real application needs: a server of its own, on a free port, in local rules mode and with
// an empty database, and one project that has been taken through every stage over HTTP, so that every scene has real
// engine output to show. Used by the UI audit (scripts/ui-audit.mjs) and by the documentation screenshots
// (scripts/ui/docs-assets.mjs). It needs the built application: npm run build.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Starts the built application and returns once it answers; a server that never does fails the audit. */
export async function startServer() {
  const port = await freePort();
  const data = mkdtempSync(join(tmpdir(), 'swarm-audit-'));
  const child = spawn(process.execPath, ['dist/backend/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: data,
      AI_PROVIDER: 'none',
      LOG_LEVEL: 'warn',
      RATE_LIMIT_SCALE: '100',
    },
    stdio: 'ignore',
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (exited)
      throw new Error('The application exited before it answered. Run npm run build first.');
    if (Date.now() > deadline)
      throw new Error('The application did not answer within 120 seconds.');
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    base,
    stop() {
      child.kill();
      rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

async function call(BASE, method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Swarm-CSRF': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
}

async function until(label, read, done, limit = 120_000) {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() - start > limit) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** Makes one complete project the way a person would, over HTTP: every scene has real engine output to show. */
export async function makeProject(BASE) {
  const { EXAMPLE_SCENARIOS } = await import(
    pathToFileURL(join(process.cwd(), 'dist', 'shared', 'example-scenarios.js')).href
  );
  const example =
    EXAMPLE_SCENARIOS.find((item) => item.id === 'copilot-in-teams') ?? EXAMPLE_SCENARIOS[0];
  const documents = example.documents.map(({ name, content, provenance }) => ({
    name,
    content,
    provenance,
  }));
  const parsed = await call(BASE, 'POST', '/api/scenario/parse', {
    question: example.question,
    documents: documents.map((doc) => ({
      name: doc.name,
      characters: doc.content.length,
      excerpt: doc.content.slice(0, 2000),
    })),
    useModel: false,
  });
  const created = await call(BASE, 'POST', '/api/projects', {
    name: example.title.slice(0, 100),
    question: example.question,
    workflow: 'guided',
    documents,
    settings: {
      mode: 'local',
      agentCount: 12,
      rounds: 8,
      seed: 42,
      network: 'community',
      intervention: null,
    },
    scenario: parsed.frame,
  });
  const id = created.id;
  const state = () => call(BASE, 'GET', `/api/projects/${id}`);
  await call(BASE, 'POST', `/api/projects/${id}/steps/knowledge`);
  await until(
    'the evidence to be read',
    state,
    (project) => project.console?.steps.knowledge === 'ready',
  );
  const found = await call(BASE, 'POST', `/api/projects/${id}/stakeholders/discover`, {
    mode: 'rules',
    confirm: false,
  });
  await call(BASE, 'POST', `/api/projects/${id}/stakeholders/approve`, {
    expectedRevision: found.revision,
  });
  await call(BASE, 'POST', `/api/projects/${id}/actors/generate`, { model: false, confirm: false });
  for (const step of ['environment', 'simulation']) {
    await call(BASE, 'POST', `/api/projects/${id}/steps/${step}`);
    await until(step, state, (project) => project.console?.steps[step] === 'ready');
  }
  const started = await call(BASE, 'POST', `/api/projects/${id}/analysis`, {
    runsPerVariant: 20,
    variants: 'auto',
    sensitivity: true,
  });
  await until(
    'the comparison',
    () => call(BASE, 'GET', `/api/projects/${id}/analysis/${started.analysis.id}`),
    (answer) => !['running', 'queued'].includes(answer.analysis.status),
  );
  // Opening Ground is what compares the sources: a review made before that says so, and a person always gets there first.
  await call(BASE, 'GET', `/api/projects/${id}/ledger`);
  await call(BASE, 'POST', `/api/projects/${id}/critiques/run`, { useModel: false });
  await call(BASE, 'POST', `/api/projects/${id}/brief`, {});
  return id;
}
