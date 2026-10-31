import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { chatInputSchema, createProjectSchema } from '../../../shared/types.js';
import { ownerOf, principalOf } from '../auth/guard.js';
import { AppError } from '../errors.js';
import { markdownExport } from '../export.js';
import { LedgerService } from '../grounding/service.js';
import { retrieve } from '../knowledge/retrieval.js';
import { labProgress } from '../lab/progress.js';
import type { InteractionService } from '../orchestration/interaction.js';
import type { Orchestrator } from '../orchestration/runner.js';
import type { Repository } from '../storage/repository.js';
import { attestEvidence } from './evidence.js';
import { idempotencyOptions } from './idempotency.js';

const projectParams = z.object({ id: z.uuid() });
const targetQuery = z.object({ target: z.string().min(1).max(80).default('report') });

export function projectRoutes(
  app: FastifyInstance,
  repository: Repository,
  jobs: Orchestrator,
  interaction: InteractionService,
  rateScale = 1,
): void {
  const limit = (max: number) => ({ rateLimit: { max: max * rateScale, timeWindow: '1 minute' } });
  app.get('/api/projects', async (request) => {
    const { limit: pageSize, offset } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(100),
        offset: z.coerce.number().int().min(0).max(100).default(0),
      })
      .parse(request.query);
    // A caller sees the experiments they were added to in their own tenant, and nobody else's. An
    // owner or admin of the workspace sees all of that workspace's.
    const principal = principalOf(request);
    return repository.list(pageSize, offset, principal.tenantId, {
      principalId: principal.id,
      everything:
        request.membership.workspace === 'owner' || request.membership.workspace === 'admin',
    });
  });

  const attested = { config: limit(20), preHandler: attestEvidence };
  app.post('/api/projects', attested, async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    const principal = principalOf(request);
    const project = repository.create(input, { owner: ownerOf(principal) });
    if (input.scenario) {
      // The scenario the person settled on in intake belongs to the project, or the project is not made.
      try {
        repository.artifacts.put(project.id, 'scenario', 'default', input.scenario);
      } catch (error) {
        repository.delete(project.id, principal.id);
        throw error;
      }
    }
    return reply.code(201).send(project);
  });

  // The one place that adds how far the project has come: it is not part of the stored record, and a
  // list, an export or a copy has no use for it.
  app.get('/api/projects/:id', async (request) => {
    const project = repository.get(projectParams.parse(request.params).id);
    return { ...project, lab: labProgress(repository.artifacts, project.id) };
  });

  app.post('/api/projects/:id/run', { config: limit(6) }, async (request, reply) => {
    const { id } = projectParams.parse(request.params);
    return reply.code(202).send(jobs.enqueue(id, idempotencyOptions(request)));
  });

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
    repository.delete(id, principalOf(request).id);
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

  app.post('/api/projects/:id/chat', { config: limit(10) }, async (request, reply) => {
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
  });

  app.get('/api/projects/:id/export', async (request, reply) => {
    const { id } = projectParams.parse(request.params);
    const { format } = z
      .object({ format: z.enum(['markdown', 'json']).default('markdown') })
      .parse(request.query);
    const project = repository.get(id);
    const chunks = repository.chunks(id);
    const ledger = project.report ? new LedgerService(repository).get(id) : null;
    if (format === 'json') {
      return reply
        .header('content-disposition', `attachment; filename="swarm-lab-${id}.json"`)
        .type('application/json; charset=utf-8')
        .send({
          schemaVersion: project.workflow === 'guided' ? 2 : 1,
          exportedAt: new Date().toISOString(),
          project,
          evidence: chunks,
          ledger,
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
      .send(markdownExport(project, chunks, ledger));
  });
}
