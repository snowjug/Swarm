import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  constraintReviewSchema,
  proposeConstraintsSchema,
  putConstraintsSchema,
  type ConstraintsView,
} from '../../../shared/constraints.js';
import type { Simulator } from '../../../shared/analysis.js';
import { principalOf } from '../auth/guard.js';
import { projectAllows } from '../auth/roles.js';
import type { ProviderConfig } from '../config.js';
import { ConstraintService, MODEL_TIMEOUT_MS } from '../constraints/service.js';
import { AppError } from '../errors.js';
import type { ModelFactory } from '../models/factory.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });

/**
 * The constraints of a project: what limits the decision, reviewed by a person before a simulation, with the
 * gate that says whether one may start and the counterfactual views of the proposed change. Who may call
 * what is in `auth/policy.ts` and what is recorded in `auth/audit-policy.ts`; every change is written with
 * its audit entry in one transaction, and the entry holds counts, never a statement or a quote.
 */
export function constraintRoutes(
  app: FastifyInstance,
  repository: Repository,
  createModel: ModelFactory,
  provider: Pick<ProviderConfig, 'configured' | 'reason' | 'model'>,
  rateScale = 1,
  simulator?: Simulator,
): ConstraintService {
  const service = new ConstraintService(repository, {
    createModel,
    provider,
    ...(simulator ? { simulator } : {}),
  });
  const limit = (max: number) => ({ rateLimit: { max: max * rateScale, timeWindow: '1 minute' } });
  // Signed in, the guard has vouched for the project. Without sign-in nothing has.
  const exists = (id: string): void => {
    if (!repository.ownership(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    }
  };
  const may = (request: FastifyRequest): ConstraintsView['may'] => ({
    edit: projectAllows('edit', request.membership),
    run: projectAllows('run', request.membership),
  });

  /** Runs work that may wait for a model, ended by the client leaving or by the timeout. */
  const bounded = async <T>(
    reply: FastifyReply,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once('close', onClose);
    try {
      return await work(
        AbortSignal.any([controller.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
      );
    } finally {
      reply.raw.removeListener('close', onClose);
    }
  };

  app.get('/api/projects/:id/constraints', async (request) => {
    const { id } = idParams.parse(request.params);
    exists(id);
    return service.view(id, may(request));
  });

  app.put(
    '/api/projects/:id/constraints',
    { config: limit(120), bodyLimit: 600_000 },
    async (request) => {
      const { id } = idParams.parse(request.params);
      exists(id);
      const input = putConstraintsSchema.parse(request.body);
      return service.put(id, input, principalOf(request).id, may(request));
    },
  );

  app.post(
    '/api/projects/:id/constraints/propose',
    { config: limit(10), bodyLimit: 4_096 },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      exists(id);
      const input = proposeConstraintsSchema.parse(request.body ?? {});
      const view = await bounded(reply, (signal) =>
        service.propose(id, input, principalOf(request).id, signal, may(request)),
      );
      return reply.code(201).send(view);
    },
  );

  app.post(
    '/api/projects/:id/constraints/review',
    { config: limit(120), bodyLimit: 100_000 },
    async (request) => {
      const { id } = idParams.parse(request.params);
      exists(id);
      const input = constraintReviewSchema.parse(request.body);
      return service.review(id, input, principalOf(request).id, may(request));
    },
  );

  app.get('/api/projects/:id/constraints/gate', async (request) => {
    const { id } = idParams.parse(request.params);
    exists(id);
    return service.gate(id);
  });

  app.get('/api/projects/:id/constraints/counterfactuals', async (request) => {
    const { id } = idParams.parse(request.params);
    exists(id);
    return service.readCounterfactuals(id, { run: projectAllows('run', request.membership) });
  });

  app.post(
    '/api/projects/:id/constraints/counterfactuals',
    { config: limit(6), bodyLimit: 4_096 },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      exists(id);
      const view = await service.runCounterfactuals(id, principalOf(request).id, {
        run: projectAllows('run', request.membership),
      });
      return reply.code(201).send(view);
    },
  );

  return service;
}
