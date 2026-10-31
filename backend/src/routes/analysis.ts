import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/guard.js';
import { projectAllows } from '../auth/roles.js';
import { AnalysisService, type AnalysisServiceOptions } from '../analysis/service.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';
import { idSchema } from '../../../shared/stakeholders.js';

export type { AnalysisServiceOptions };

const projectParams = z.object({ id: z.uuid() });
const analysisParams = projectParams.extend({ aid: idSchema });

/**
 * Baseline against alternatives, repeated over seeds. Starting one needs the `run` capability and so
 * does stopping it; reading needs `read`. Who may call what is in `auth/policy.ts`, and what is
 * recorded in `auth/audit-policy.ts`. The comparison itself runs in this process after the answer is
 * sent, and the person polls the saved document for its progress.
 */
export function analysisRoutes(
  app: FastifyInstance,
  repository: Repository,
  options: AnalysisServiceOptions,
  rateScale = 1,
): AnalysisService {
  const service = new AnalysisService(repository, {
    // A code only: never what the engine said, which may hold what a person wrote.
    onFault: (code) =>
      app.log.error(
        { code },
        'A scenario comparison failed or could not be saved. Inspect its saved state.',
      ),
    ...options,
  });
  service.recoverInterrupted();
  // Before the database is closed, so that nothing is left running that would write to it.
  app.addHook('preClose', async () => service.stop());

  const limit = (max: number) => ({
    config: { rateLimit: { max: max * rateScale, timeWindow: '1 minute' } },
  });
  // Signed in, the guard has vouched for the project. Without sign-in nothing has.
  const exists = (id: string): void => {
    if (!repository.ownership(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    }
  };

  app.get('/api/projects/:id/analysis', async (request) => {
    const { id } = projectParams.parse(request.params);
    exists(id);
    return service.list(id, projectAllows('run', request.membership));
  });

  app.get('/api/projects/:id/analysis/:aid', async (request) => {
    const { id, aid } = analysisParams.parse(request.params);
    exists(id);
    return { analysis: service.get(id, aid) };
  });

  app.post('/api/projects/:id/analysis', limit(6), async (request, reply) => {
    const { id } = projectParams.parse(request.params);
    exists(id);
    const analysis = service.start(id, request.body, principalOf(request).id);
    return reply.code(202).send({ analysis });
  });

  app.post('/api/projects/:id/analysis/:aid/cancel', limit(30), async (request, reply) => {
    const { id, aid } = analysisParams.parse(request.params);
    exists(id);
    return reply.code(202).send({ analysis: service.cancel(id, aid, principalOf(request).id) });
  });

  return service;
}
