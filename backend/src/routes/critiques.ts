import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  critiqueResponseInputSchema,
  runCritiquesInputSchema,
  type CritiquesView,
} from '../../../shared/critique.js';
import { principalOf } from '../auth/guard.js';
import { projectAllows } from '../auth/roles.js';
import { CritiqueService } from '../critics/service.js';
import { AppError } from '../errors.js';
import type { ModelFactory } from '../models/factory.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });
const critiqueParams = idParams.extend({ cid: z.string().min(1).max(80) });

/** A review that asks a model is bounded in time: a model that does not answer does not hold the page. */
const REVIEW_TIMEOUT_MS = 3 * 60_000;

/**
 * The independent review of an analysis. Anyone who can read the project reads it; running it needs
 * the capability to run, and responding to a critique the capability to edit. Who may call what is in
 * `auth/policy.ts`, and what is recorded in `auth/audit-policy.ts`.
 */
export function critiqueRoutes(
  app: FastifyInstance,
  repository: Repository,
  createModel: ModelFactory,
  options: { modelAvailable: boolean; rateScale?: number },
): void {
  const service = new CritiqueService(repository, {
    createModel,
    modelAvailable: options.modelAvailable,
  });
  const scale = options.rateScale ?? 1;
  const limit = (max: number) => ({ rateLimit: { max: max * scale, timeWindow: '1 minute' } });

  // Signed in, the guard has vouched for the project. Without sign-in nothing has.
  const exists = (id: string): void => {
    if (!repository.ownership(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    }
  };

  /** Every change answers with the review as it now is, so the page needs no second request. */
  const view = (request: FastifyRequest, id: string): CritiquesView =>
    service.view(id, {
      run: projectAllows('run', request.membership),
      respond: projectAllows('edit', request.membership),
    });

  app.get('/api/projects/:id/critiques', async (request) => {
    const { id } = idParams.parse(request.params);
    exists(id);
    return view(request, id);
  });

  app.post('/api/projects/:id/critiques/run', { config: limit(6) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    exists(id);
    const body = runCritiquesInputSchema.parse(request.body ?? {});
    const controller = new AbortController();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once('close', onClose);
    try {
      await service.run(
        id,
        body,
        principalOf(request).id,
        AbortSignal.any([controller.signal, AbortSignal.timeout(REVIEW_TIMEOUT_MS)]),
      );
    } finally {
      reply.raw.removeListener('close', onClose);
    }
    return view(request, id);
  });

  app.put('/api/projects/:id/critiques/:cid/response', { config: limit(60) }, async (request) => {
    const { id, cid } = critiqueParams.parse(request.params);
    exists(id);
    service.respond(
      id,
      cid,
      critiqueResponseInputSchema.parse(request.body),
      principalOf(request).id,
    );
    return view(request, id);
  });
}
