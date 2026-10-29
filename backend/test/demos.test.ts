import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ContradictionRecord } from '../../shared/evidence.js';
import { createProjectSchema, type ChatMessage } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { ABSTENTION_MESSAGE } from '../src/orchestration/evidence-gate.js';
import { testConfig } from './fixtures.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'demo');

const manifest = z
  .object({
    version: z.literal(1),
    demos: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        question: z.string(),
        files: z.array(z.string()).min(1),
        conflicts: z.array(z.tuple([z.string(), z.string()])),
        note: z.string().optional(),
        answerable: z.array(z.string()).min(1),
        unanswerable: z.array(z.string()).min(1),
      }),
    ),
  })
  .parse(JSON.parse(readFileSync(join(root, 'demos.json'), 'utf8')));

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function runDemo(demo: (typeof manifest.demos)[number]) {
  const harness = await buildApp({ config: testConfig() });
  applications.push(harness);
  const project = harness.repository.create(
    createProjectSchema.parse({
      name: demo.title,
      question: demo.question,
      documents: demo.files.map((name) => ({
        name,
        content: readFileSync(join(root, demo.slug, name), 'utf8').replaceAll('\r\n', '\n'),
      })),
      settings: { mode: 'local', agentCount: 6, rounds: 3, seed: 42, network: 'community' },
    }),
  );
  harness.jobs.enqueue(project.id);
  await harness.jobs.idle();
  expect(harness.repository.get(project.id).status).toBe('completed');
  return { harness, id: project.id };
}

async function ask(
  harness: Awaited<ReturnType<typeof buildApp>>,
  id: string,
  message: string,
): Promise<ChatMessage> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/projects/${id}/chat`,
    payload: { target: 'report', message },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ messages: ChatMessage[] }>().messages.at(-1)!;
}

describe('the demonstration packs', () => {
  it('are all listed, and each source file exists', () => {
    expect(manifest.demos.map((demo) => demo.slug)).toEqual([
      'larkholm-ferry',
      'hartwell-clinic-booking',
      'eastfield-campus-parking',
      'northgate-bus-redesign',
      'docklands-warehouse-robotics',
      'library-hours-thin-evidence',
    ]);
    for (const demo of manifest.demos) {
      for (const file of demo.files) {
        expect(readFileSync(join(root, demo.slug, file), 'utf8').length).toBeGreaterThan(80);
      }
    }
  });

  it('are fictional, and say so in every source', () => {
    for (const demo of manifest.demos) {
      for (const file of demo.files) {
        const text = readFileSync(join(root, demo.slug, file), 'utf8').toLowerCase();
        expect(text, `${demo.slug}/${file}`).toMatch(/fictional/u);
      }
    }
  });

  for (const demo of manifest.demos) {
    describe(demo.title, () => {
      it('reports the conflicts between sources that a careful reader would flag, and no others', async () => {
        const { harness, id } = await runDemo(demo);
        const response = await harness.app.inject(`/api/projects/${id}/ledger`);
        const found = response
          .json<{ contradictions: ContradictionRecord[] }>()
          .contradictions.map((conflict) =>
            [conflict.left.documentName, conflict.right.documentName].sort().join(' | '),
          )
          .sort();
        const expected = demo.conflicts.map((pair) => [...pair].sort().join(' | ')).sort();
        expect(found).toEqual(expected);
      });

      it('answers questions its sources cover, citing them', async () => {
        const { harness, id } = await runDemo(demo);
        for (const question of demo.answerable) {
          const reply = await ask(harness, id, question);
          expect(reply.content, question).not.toContain(ABSTENTION_MESSAGE);
          expect(reply.grounding?.status, question).toBe('cited');
          expect(reply.sourceIds.length, question).toBeGreaterThan(0);
        }
      });

      it('abstains, with the required sentence, on questions its sources cannot answer', async () => {
        const { harness, id } = await runDemo(demo);
        for (const question of demo.unanswerable) {
          const reply = await ask(harness, id, question);
          expect(reply.content.startsWith(ABSTENTION_MESSAGE), question).toBe(true);
          expect(reply.grounding?.status, question).toBe('abstained');
          expect(reply.sourceIds, question).toEqual([]);
        }
      });
    });
  }
});
