import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DecisionView } from '../../../shared/decision.js';
import { projectAllows } from '../auth/roles.js';
import { DecisionService } from '../decision/service.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });

/**
 * The Decision Canvas of a project: the answer-first picture of the decision, worked out at every read
 * from the project’s own stored documents (nothing is stored, so it cannot be stale). Who may read it is
 * in `auth/policy.ts` and what is recorded in `auth/audit-policy.ts`; it changes nothing and so records
 * nothing, and it answers with no canvas and the reasons while there is no finished comparison.
 */
export function decisionRoutes(
  app: FastifyInstance,
  repository: Repository,
  rateScale = 1,
): DecisionService {
  const service = new DecisionService(repository);
  const limit = (max: number) => ({ rateLimit: { max: max * rateScale, timeWindow: '1 minute' } });

  // Signed in, the guard has vouched for the project. Without sign-in nothing has.
  const exists = (id: string): void => {
    if (!repository.ownership(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    }
  };
  const may = (request: FastifyRequest): DecisionView['may'] => ({
    run: projectAllows('run', request.membership),
    export: projectAllows('export', request.membership),
  });

  app.get('/api/projects/:id/decision', { config: limit(120) }, async (request) => {
    const { id } = idParams.parse(request.params);
    exists(id);
    return service.view(id, may(request));
  });

  return service;
}
