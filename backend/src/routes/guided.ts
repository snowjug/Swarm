import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  EXECUTION_STEPS,
  environmentUpdateSchema,
  surveyInputSchema,
} from '../../../shared/guided.js';
import { AppError } from '../errors.js';
import { editEnvironment } from '../guided/environment.js';
import { requireConsole } from '../guided/state.js';
import { searchMemories } from '../guided/tools.js';
import { pdfInputSchema, type PdfService } from '../ingest/pdf.js';
import type { InteractionService } from '../orchestration/interaction.js';
import type { Orchestrator } from '../orchestration/runner.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });

export function guidedRoutes(
  app: FastifyInstance,
  repository: Repository,
  jobs: Orchestrator,
  interaction: InteractionService,
  pdf: PdfService,
): void {
  app.post(
    '/api/projects/:id/steps/:step',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id, step } = idParams.extend({ step: z.enum(EXECUTION_STEPS) }).parse(request.params);
      return reply.code(202).send(jobs.enqueueStep(id, step));
    },
  );

  app.patch('/api/projects/:id/environment', async (request) => {
    const { id } = idParams.parse(request.params);
    if (jobs.isBusy(id) || interaction.isBusy(id))
      throw new AppError(
        409,
        'PROJECT_BUSY',
        'Wait for active work before editing the environment.',
      );
    return editEnvironment(repository, id, environmentUpdateSchema.parse(request.body));
  });

  app.get('/api/projects/:id/memories', async (request) => {
    const { id } = idParams.parse(request.params);
    const { query, platform, limit } = z
      .object({
        query: z.string().trim().max(1_000).default(''),
        platform: z.enum(['all', 'plaza', 'community']).default('all'),
        limit: z.coerce.number().int().min(1).max(1_200).default(100),
      })
      .parse(request.query);
    const state = requireConsole(repository.get(id));
    const filtered = state.memories.filter(
      (memory) => platform === 'all' || memory.platform === platform,
    );
    const memories = searchMemories(filtered, query, limit);
    return { query, memories, total: query ? memories.length : filtered.length };
  });

  app.post(
    '/api/projects/:id/surveys',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      return reply
        .code(202)
        .send(interaction.startSurvey(id, surveyInputSchema.parse(request.body)));
    },
  );

  app.post('/api/projects/:id/surveys/:surveyId/cancel', async (request, reply) => {
    const { id, surveyId } = idParams.extend({ surveyId: z.uuid() }).parse(request.params);
    return reply.code(202).send(interaction.cancelSurvey(id, surveyId));
  });

  app.post(
    '/api/documents/extract',
    {
      bodyLimit: 2_700_000,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { name, data } = pdfInputSchema.parse(request.body);
      const controller = new AbortController();
      const onClose = (): void => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.once('close', onClose);
      try {
        return await pdf.extract(name, data, controller.signal);
      } finally {
        reply.raw.removeListener('close', onClose);
      }
    },
  );
}
