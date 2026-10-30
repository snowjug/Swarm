import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  EXECUTION_STEPS,
  branchInputSchema,
  environmentUpdateSchema,
  interventionUpdateSchema,
  surveyInputSchema,
} from '../../../shared/guided.js';
import { AppError } from '../errors.js';
import { ownerOf, principalOf, requireReadable } from '../auth/guard.js';
import { workspaceAllows } from '../auth/roles.js';
import { compareRuns } from '../guided/compare.js';
import { editEnvironment } from '../guided/environment.js';
import { requireConsole } from '../guided/state.js';
import { searchMemories } from '../guided/tools.js';
import { createBranch, setIntervention } from '../guided/whatif.js';
import { pdfInputSchema, type PdfService } from '../ingest/pdf.js';
import type { InteractionService } from '../orchestration/interaction.js';
import type { Orchestrator } from '../orchestration/runner.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });
const stepBody = z.object({ resume: z.boolean().optional() }).strict().optional();

export function guidedRoutes(
  app: FastifyInstance,
  repository: Repository,
  jobs: Orchestrator,
  interaction: InteractionService,
  pdf: PdfService,
  rateScale = 1,
): void {
  const limit = (max: number) => ({ rateLimit: { max: max * rateScale, timeWindow: '1 minute' } });
  const requireIdle = (id: string): void => {
    if (jobs.isBusy(id) || interaction.isBusy(id)) {
      throw new AppError(409, 'PROJECT_BUSY', 'Wait for active work to finish or pause it first.');
    }
  };

  app.post('/api/projects/:id/steps/:step', { config: limit(8) }, async (request, reply) => {
    const { id, step } = idParams.extend({ step: z.enum(EXECUTION_STEPS) }).parse(request.params);
    const body = stepBody.parse(request.body ?? undefined);
    if (body?.resume && step !== 'simulation') {
      throw new AppError(400, 'RESUME_UNSUPPORTED', 'Only the simulation stage can be resumed.');
    }
    return reply.code(202).send(jobs.enqueueStep(id, step, body?.resume === true));
  });

  app.post('/api/projects/:id/pause', { config: limit(20) }, async (request, reply) =>
    reply.code(202).send(jobs.pause(idParams.parse(request.params).id)),
  );

  app.put('/api/projects/:id/intervention', async (request) => {
    const { id } = idParams.parse(request.params);
    requireIdle(id);
    return setIntervention(repository, id, interventionUpdateSchema.parse(request.body));
  });

  app.post('/api/projects/:id/branches', { config: limit(10) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // The guard checked the caller may run the parent. A branch is a new experiment, which only a
    // member of the workspace may create, and the caller leads it.
    if (!workspaceAllows('create-project', request.membership.workspace)) {
      throw new AppError(403, 'FORBIDDEN', 'You are not a member of this workspace.');
    }
    requireIdle(id);
    return reply
      .code(201)
      .send(
        createBranch(
          repository,
          id,
          branchInputSchema.parse(request.body),
          ownerOf(principalOf(request)),
        ),
      );
  });

  app.get('/api/projects/:id/compare', async (request) => {
    const { id } = idParams.parse(request.params);
    const { with: otherId } = z.object({ with: z.uuid() }).parse(request.query);
    // The guard vouched only for the experiment in the path. The one named in the query must be one
    // the caller may read too, or this would read another tenant's runs, or another project's of
    // the same workspace, and confirm that they exist.
    requireReadable(repository, principalOf(request), otherId);
    return compareRuns(repository, id, otherId);
  });

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
    const {
      query,
      platform,
      limit: pageSize,
    } = z
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
    const memories = searchMemories(filtered, query, pageSize);
    return { query, memories, total: query ? memories.length : filtered.length };
  });

  app.post('/api/projects/:id/surveys', { config: limit(5) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return reply.code(202).send(interaction.startSurvey(id, surveyInputSchema.parse(request.body)));
  });

  app.post('/api/projects/:id/surveys/:surveyId/cancel', async (request, reply) => {
    const { id, surveyId } = idParams.extend({ surveyId: z.uuid() }).parse(request.params);
    return reply.code(202).send(interaction.cancelSurvey(id, surveyId));
  });

  app.post(
    '/api/documents/extract',
    { bodyLimit: 2_700_000, config: limit(10) },
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
