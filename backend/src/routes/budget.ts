import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { budgetInputSchema, type BudgetView } from '../../../shared/budget.js';
import { projectAllows } from '../auth/roles.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';
import { budgetState } from '../storage/usage.js';

const idParams = z.object({ id: z.uuid() });

/**
 * What a project may spend on the model. Anyone who can read the project may see what it has used
 * against its limits; only a workspace owner or administrator may change the limits. Who may call
 * what is in `auth/policy.ts`, and what is recorded in `auth/audit-policy.ts`.
 */
export function budgetRoutes(app: FastifyInstance, repository: Repository, rateScale = 1): void {
  const limit = { config: { rateLimit: { max: 30 * rateScale, timeWindow: '1 minute' } } };

  // Signed in, the guard has vouched for the project. Without sign-in nothing has, and a counter for
  // a project that is not there would be a made-up answer.
  const exists = (id: string): void => {
    if (!repository.ownership(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    }
  };

  const view = (request: FastifyRequest, id: string): BudgetView => {
    exists(id);
    const usage = repository.usage.get(id);
    return {
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      callLimit: usage.limits.callLimit,
      tokenLimit: usage.limits.tokenLimit,
      own: usage.own,
      defaults: usage.defaults,
      state: budgetState(usage),
      may: { edit: projectAllows('budget', request.membership) },
    };
  };

  app.get('/api/projects/:id/budget', async (request) => ({
    budget: view(request, idParams.parse(request.params).id),
  }));

  app.put('/api/projects/:id/budget', limit, async (request) => {
    const { id } = idParams.parse(request.params);
    const input = budgetInputSchema.parse(request.body);
    exists(id);
    repository.usage.setLimits(id, input);
    return { budget: view(request, id) };
  });
}
