import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { chatInputSchema, createProjectSchema } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { markdownExport } from '../export.js';
import { retrieve } from '../knowledge/retrieval.js';
import type { InteractionService } from '../orchestration/interaction.js';
import type { Orchestrator } from '../orchestration/runner.js';
import type { Repository } from '../storage/repository.js';

const projectParams = z.object({ id: z.uuid() });
const targetQuery = z.object({ target: z.string().min(1).max(80).default('report') });

export function projectRoutes(
  app: FastifyInstance,
  repository: Repository,
  jobs: Orchestrator,
  interaction: InteractionService,
): void {
  app.get('/api/projects', async (request) => {
    const { limit, offset } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(100),
        offset: z.coerce.number().int().min(0).max(100).default(0),
      })
      .parse(request.query);
    return repository.list(limit, offset);
  });

  app.post(
    '/api/projects',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const project = repository.create(createProjectSchema.parse(request.body));
      return reply.code(201).send(project);
    },
  );

  app.get('/api/projects/:id', async (request) => {
    return repository.get(projectParams.parse(request.params).id);
  });

  app.post(
    '/api/projects/:id/run',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = projectParams.parse(request.params);
      return reply.code(202).send(jobs.enqueue(id));
    },
  );

  app.post('/api/projects/:id/cancel', async (request, reply) => {
    return reply.code(202).send(jobs.cancel(projectParams.parse(request.params).id));
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = projectParams.parse(request.params);
    const project = repository.get(id);
    if (
      jobs.isBusy(id) ||
      interaction.isBusy(id) ||
      ['queued', 'running'].includes(project.status)
    ) {
      throw new AppError(409, 'PROJECT_BUSY', 'Stop active work before deleting this experiment.');
    }
    repository.delete(id);
    return reply.code(204).send();
  });

  app.get('/api/projects/:id/evidence', async (request) => {
    const { id } = projectParams.parse(request.params);
    const { query } = z
      .object({ query: z.string().trim().max(1_000).default('') })
      .parse(request.query);
    const chunks = repository.chunks(id);
    const citation = chunks.find((chunk) => chunk.id === query);
    return {
      query,
      matches: !query
        ? chunks.map((chunk) => ({ ...chunk, score: 0 }))
        : citation
          ? [{ ...citation, score: 1 }]
          : retrieve(chunks, query, 5),
    };
  });

  app.get('/api/projects/:id/chat', async (request) => {
    const { id } = projectParams.parse(request.params);
    const { target } = targetQuery.parse(request.query);
    return { messages: interaction.conversation(id, target) };
  });

  app.post(
    '/api/projects/:id/chat',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = projectParams.parse(request.params);
      const { target, message } = chatInputSchema.parse(request.body);
      const controller = new AbortController();
      const onClose = (): void => {
        if (!reply.raw.writableEnded) {
          controller.abort(
            new AppError(409, 'CLIENT_DISCONNECTED', 'The follow-up request disconnected.'),
          );
        }
      };
      reply.raw.once('close', onClose);
      try {
        return { messages: await interaction.reply(id, target, message, controller.signal) };
      } finally {
        reply.raw.removeListener('close', onClose);
      }
    },
  );

  app.get('/api/projects/:id/export', async (request, reply) => {
    const { id } = projectParams.parse(request.params);
    const { format } = z
      .object({ format: z.enum(['markdown', 'json']).default('markdown') })
      .parse(request.query);
    const project = repository.get(id);
    const chunks = repository.chunks(id);
    if (format === 'json') {
      return reply
        .header('content-disposition', `attachment; filename="swarm-lab-${id}.json"`)
        .type('application/json; charset=utf-8')
        .send({
          schemaVersion: project.workflow === 'guided' ? 2 : 1,
          exportedAt: new Date().toISOString(),
          project,
          evidence: chunks,
          messages: repository.allMessages(id),
        });
    }
    if (project.status !== 'completed')
      throw new AppError(
        409,
        'REPORT_NOT_READY',
        'Complete the report before exporting Markdown. JSON remains available for partial snapshots.',
      );
    return reply
      .header('content-disposition', `attachment; filename="swarm-lab-${id}.md"`)
      .type('text/markdown; charset=utf-8')
      .send(markdownExport(project, chunks));
  });
}
