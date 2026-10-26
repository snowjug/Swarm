import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { eventSchema, storedProjectSchema } from '../src/storage/codec.js';
import { fixtureInput, sourceText, testConfig } from './fixtures.js';

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];

async function setup() {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  return instance;
}

function detail(value: unknown) {
  return {
    ...storedProjectSchema.parse(value),
    events: z.object({ events: z.array(eventSchema) }).parse(value).events,
  };
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe('local workflow HTTP API', () => {
  it('completes the real intake -> graph -> agents -> rounds -> report -> evidence/chat/export flow', async () => {
    const { app, repository, jobs } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: fixtureInput(),
    });
    expect(created.statusCode).toBe(201);
    const project = detail(created.json<unknown>());
    expect(project.status).toBe('draft');
    const queued = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/run` });
    expect(queued.statusCode).toBe(202);
    await jobs.idle();
    const fetched = await app.inject(`/api/projects/${project.id}`);
    const result = detail(fetched.json<unknown>());
    expect(result).toMatchObject({
      status: 'completed',
      stage: 'complete',
      progress: 100,
      currentRound: 4,
      graph: { method: 'lexical' },
      report: { generatedBy: 'local' },
      execution: { provider: 'none', model: null, modelCalls: 0 },
    });
    expect(result.rounds).toHaveLength(4);
    expect(result.agents).toHaveLength(6);
    expect(result.events.at(-1)!.stage).toBe('complete');
    expect(result.report!.metrics.totalInteractions).toBeGreaterThan(0);
    expect(fetched.headers['cache-control']).toBe('no-store');
    expect(fetched.headers['content-security-policy']).toContain("script-src 'self'");

    const evidence = await app.inject(`/api/projects/${project.id}/evidence?query=S1`);
    expect(evidence.json()).toMatchObject({ query: 'S1', matches: [{ id: 'S1', score: 1 }] });
    const browse = await app.inject(`/api/projects/${project.id}/evidence?query=`);
    expect(browse.statusCode).toBe(200);
    expect(browse.json()).toMatchObject({ query: '', matches: [{ id: 'S1', score: 0 }] });
    const noMatch = await app.inject(`/api/projects/${project.id}/evidence?query=quasars`);
    expect(noMatch.json()).toMatchObject({ matches: [] });

    const chat = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/chat`,
      payload: { target: 'report', message: 'What do the sources say about transit?' },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json()).toMatchObject({
      messages: [
        { role: 'user', mode: 'local' },
        { role: 'assistant', mode: 'local', sourceIds: ['S1'] },
      ],
    });
    expect(repository.conversation(project.id, 'report')[1]!.content).toContain(
      'not an AI-generated answer',
    );
    expect(repository.conversation(project.id, 'agent-1')).toEqual([]);
    const download = await app.inject(`/api/projects/${project.id}/export?format=json`);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.json()).toMatchObject({
      schemaVersion: 1,
      project: { id: project.id, status: 'completed' },
    });
    expect(download.json<{ messages: unknown[] }>().messages).toHaveLength(2);
    const markdown = await app.inject(`/api/projects/${project.id}/export?format=markdown`);
    expect(markdown.body).toContain('not AI');
    expect(markdown.body).toContain('Source passages');
    expect(
      (await app.inject({ method: 'POST', url: `/api/projects/${project.id}/run` })).statusCode,
    ).toBe(409);
  });

  it('does not invoke a configured cloud model for local mode', async () => {
    const factory = vi.fn(() => {
      throw new Error('A local run must never create a model.');
    });
    const instance = await buildApp({
      config: testConfig({ AI_PROVIDER: 'openai', AI_MODEL: 'test', OPENAI_API_KEY: 'fake-key' }),
      modelFactory: factory,
    });
    applications.push(instance);
    const project = instance.repository.create(fixtureInput());
    instance.jobs.enqueue(project.id);
    await instance.jobs.idle();
    expect(instance.repository.get(project.id).status).toBe('completed');
    expect(factory).not.toHaveBeenCalled();
  });

  it('surfaces missing provider configuration instead of returning pretend AI results', async () => {
    const { app, repository } = await setup();
    const project = repository.create(
      fixtureInput({
        settings: { mode: 'llm', agentCount: 4, rounds: 3 },
      }),
    );
    const response = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/run` });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'MODEL_NOT_CONFIGURED' } });
    expect(repository.get(project.id)).toMatchObject({
      status: 'draft',
      graph: null,
      report: null,
    });
  });

  it('rejects malformed/oversized input, unsupported files, and invalid IDs without creating projects', async () => {
    const { app, repository } = await setup();
    const input = fixtureInput();
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { ...input, documents: [{ name: '..\\secret.txt', content: sourceText }] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    const tooLarge = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'x'.repeat(600_000) }),
    });
    expect(tooLarge.statusCode).toBe(413);
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(malformed.statusCode).toBe(400);
    expect((await app.inject('/api/projects/not-a-uuid')).statusCode).toBe(400);
    expect(
      (await app.inject('/api/projects/00000000-0000-4000-8000-000000000001')).statusCode,
    ).toBe(404);
    expect(repository.count()).toBe(0);
  });

  it('enforces host/origin boundaries and never serves source or secrets as static files', async () => {
    const { app } = await setup();
    expect(
      (await app.inject({ url: '/api/projects', headers: { host: 'evil.example' } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/projects', headers: { origin: 'https://evil.example' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/health', headers: { origin: 'http://127.0.0.1:5173' } }))
        .statusCode,
    ).toBe(200);
    for (const url of ['/.env', '/package.json', '/%2e%2e/.env', '/api/missing']) {
      const response = await app.inject(url);
      expect([400, 403, 404]).toContain(response.statusCode);
      expect(response.body).not.toContain('OPENAI_API_KEY=');
    }
  });

  it('escapes source HTML in Markdown exports and prevents premature interaction', async () => {
    const { app, repository, jobs } = await setup();
    const project = repository.create(
      fixtureInput({
        documents: [
          { name: 'notes.md', content: `${sourceText}\n<script>alert("untrusted")</script>` },
        ],
      }),
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/chat`,
          payload: { target: 'report', message: 'transit' },
        })
      ).statusCode,
    ).toBe(409);
    jobs.enqueue(project.id);
    await jobs.idle();
    const markdown = await app.inject(`/api/projects/${project.id}/export?format=markdown`);
    expect(markdown.body).not.toContain('<script>');
    expect(markdown.body).toContain('&lt;script&gt;');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/chat`,
          payload: { target: 'agent-outside-project', message: 'transit' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` })).statusCode,
    ).toBe(204);
    expect((await app.inject(`/api/projects/${project.id}`)).statusCode).toBe(404);
  });
});
