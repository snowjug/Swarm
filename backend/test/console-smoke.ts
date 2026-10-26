import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { EXECUTION_STEPS } from '../../shared/guided.js';
import { storedProjectSchema } from '../src/storage/codec.js';
import { makePdf } from './pdf-fixture.js';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3001');
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
  'Smoke tests only target a local application.',
);
async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(new URL(path, base), {
    method,
    signal: AbortSignal.timeout(15_000),
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok)
    throw new Error(
      `${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 500)}`,
    );
  if (response.status === 204) return null;
  const parsed: unknown = await response.json();
  return parsed;
}

const health = z
  .object({ status: z.literal('ok'), version: z.literal('0.2.0') })
  .parse(await request('/api/health'));
const pdfText =
  'Fictional container transit scenario. Residents discuss accessible bus stops and a reversible electric bus trial. A community group asks for transparent funding and service evidence. These notes are invented inputs, not measured outcomes or real people speaking.';
const extracted = z
  .object({
    name: z.string(),
    content: z.string(),
    pageCount: z.literal(1),
    bytes: z.number(),
  })
  .parse(
    await request('/api/documents/extract', 'POST', {
      name: 'container-source.pdf',
      data: makePdf(pdfText).toString('base64'),
    }),
  );
assert.equal(extracted.content.replace(/\s+/gu, ' ').trim(), pdfText);
let project = storedProjectSchema.parse(
  await request('/api/projects', 'POST', {
    workflow: 'guided',
    name: 'Container workflow smoke',
    question: 'How might fictional stakeholders respond to an accessible transit trial?',
    documents: [
      { name: extracted.name, content: extracted.content, pageCount: extracted.pageCount },
    ],
    settings: { mode: 'local', agentCount: 4, rounds: 3, seed: 42 },
  }),
);
for (const step of EXECUTION_STEPS) {
  await request(`/api/projects/${project.id}/steps/${step}`, 'POST');
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    project = storedProjectSchema.parse(await request(`/api/projects/${project.id}`));
    assert(!['failed', 'cancelled'].includes(project.status), project.error || `${step} failed.`);
    if (project.console?.steps[step] === 'ready') {
      ready = true;
      break;
    }
    await delay(250);
  }
  assert(ready, `${step} did not become ready.`);
  if (step === 'knowledge') {
    assert.equal(project.agents.length, 0);
    assert.equal(project.report, null);
  }
  if (step === 'simulation') {
    assert.equal(project.report, null);
    assert.equal(project.console?.platforms.length, 2);
    assert(project.console?.platforms.every((run) => run.rounds.length === 3));
  }
}
assert.equal(project.status, 'completed');
assert.equal(project.execution?.modelCalls, 0);
assert(project.report?.sections.length);
const survey = z.object({ id: z.uuid() }).parse(
  await request(`/api/projects/${project.id}/surveys`, 'POST', {
    kind: 'state',
    question: 'Inspect the recorded fictional position.',
    agentIds: ['agent-1'],
  }),
);
let surveyReady = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  project = storedProjectSchema.parse(await request(`/api/projects/${project.id}`));
  const record = project.console?.surveys.find((item) => item.id === survey.id);
  assert(
    record && !['failed', 'cancelled'].includes(record.status),
    record?.error || 'Survey failed.',
  );
  if (record.status === 'completed') {
    assert.equal(record.responses[0]?.answer, null);
    surveyReady = true;
    break;
  }
  await delay(250);
}
assert(surveyReady, 'The state survey did not complete.');
await request(`/api/projects/${project.id}`, 'DELETE');
console.log(
  JSON.stringify({
    version: health.version,
    pdfTextVerified: true,
    stages: EXECUTION_STEPS,
    independentPlatforms: 2,
    report: true,
    stateSurvey: true,
    modelCalls: 0,
    cleanedUp: true,
  }),
);
