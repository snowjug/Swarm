import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { researchIntakeSchema } from '../../../shared/research.js';
import { sourceProvenanceSchema } from '../../../shared/scenario.js';
import { MAX_DOCUMENTS, documentInputSchema } from '../../../shared/types.js';
import { principalOf } from '../auth/guard.js';
import { projectAllows } from '../auth/roles.js';
import { AppError } from '../errors.js';
import type { ResearchService } from '../research/service.js';
import { idempotencyOptions } from './idempotency.js';

const idParams = z.object({ id: z.uuid() });

const limit = z.number().min(0).max(1e12);
/**
 * What a person may ask a run to use. Any number is taken, and held to what the server allows: the
 * request is never refused for asking too much, and never given it.
 */
const budgetRequestSchema = z
  .object({
    maxPages: limit,
    maxDomains: limit,
    maxDepth: limit,
    maxBytesPerPage: limit,
    maxTotalBytes: limit,
    maxElapsedMs: limit,
    maxEstimatedCostUsd: limit,
    maxDuplicateRatio: limit,
    maxFailedRequests: limit,
    maxRedirects: limit,
    perDomainDelayMs: limit,
  })
  .partial()
  .strict();

const startBodySchema = z
  .object({ intake: researchIntakeSchema.optional(), budget: budgetRequestSchema.optional() })
  .strict();

const sourceBodySchema = z
  .object({ url: z.string().trim().min(1).max(2_048), budget: budgetRequestSchema.optional() })
  .strict();

/**
 * What a person says about where their own text came from: that it was pasted, or read from a file they
 * attached, and what they call it. The rest of a provenance (an address, a time, a hash and above all
 * `fetchedByServer`) is what this server vouches for about a page that it read, so none of it is taken
 * from a client: a body that carries any of it is refused.
 */
const ownProvenanceSchema = sourceProvenanceSchema
  .pick({ title: true, license: true, asOf: true })
  .extend({ kind: z.enum(['paste', 'upload']) })
  .strict();

const ownDocumentsBodySchema = z
  .object({
    documents: z
      .array(
        documentInputSchema
          .omit({ provenance: true })
          .extend({ provenance: ownProvenanceSchema.optional() }),
      )
      .min(1)
      .max(MAX_DOCUMENTS),
  })
  .strict();

/**
 * Automatic research for a project: what it is doing, and what a person may do to it. Who may call what
 * is in `auth/policy.ts` and what is recorded in `auth/audit-policy.ts`: counts and words, never an
 * address, a title or a passage. The work itself is the first phase of the job that grounds the project.
 */
export function researchRoutes(
  app: FastifyInstance,
  research: ResearchService,
  rateScale = 1,
): void {
  const limited = (max: number) => ({
    rateLimit: { max: max * rateScale, timeWindow: '1 minute' },
  });

  app.get('/api/projects/:id/research', async (request) =>
    research.view(idParams.parse(request.params).id),
  );

  app.post(
    '/api/projects/:id/research',
    { bodyLimit: 16_000, config: limited(6) },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const body = startBodySchema.parse(request.body ?? {});
      return reply.code(202).send(
        research.start(
          id,
          {
            ...(body.intake ? { intake: body.intake } : {}),
            ...(body.budget ? { budget: body.budget } : {}),
            ...idempotencyOptions(request),
          },
          principalOf(request).id,
        ),
      );
    },
  );

  // A page or a site a person names. It is a run of its own, under the same rules as any address.
  app.post(
    '/api/projects/:id/research/sources',
    { bodyLimit: 8_192, config: limited(10) },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const body = sourceBodySchema.parse(request.body ?? {});
      return reply
        .code(202)
        .send(
          research.addSource(
            id,
            body.url,
            { ...(body.budget ? { budget: body.budget } : {}), ...idempotencyOptions(request) },
            principalOf(request).id,
          ),
        );
    },
  );

  app.post(
    '/api/projects/:id/research/pause',
    { bodyLimit: 1_024, config: limited(20) },
    async (request) => research.pause(idParams.parse(request.params).id),
  );
  app.post(
    '/api/projects/:id/research/resume',
    { bodyLimit: 1_024, config: limited(20) },
    async (request) => research.resume(idParams.parse(request.params).id),
  );
  app.post(
    '/api/projects/:id/research/finish',
    { bodyLimit: 1_024, config: limited(20) },
    async (request) => research.finish(idParams.parse(request.params).id),
  );
  app.post(
    '/api/projects/:id/research/cancel',
    { bodyLimit: 1_024, config: limited(20) },
    async (request) => research.cancel(idParams.parse(request.params).id),
  );

  // The person's own text, for a project that has not been grounded. It is added whether or not research is
  // on, research does not read it, and the stage that grounds the project is queued with it, so the answer is
  // the project, as it is for a stage that was started.
  app.post(
    '/api/projects/:id/evidence/documents',
    { config: limited(10) },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      // It queues the stage that grounds the project, which is running it as well as editing it.
      if (!projectAllows('run', request.membership)) {
        throw new AppError(
          403,
          'FORBIDDEN',
          'Your role on this experiment does not allow this action.',
        );
      }
      const body = ownDocumentsBodySchema.parse(request.body);
      return reply
        .code(202)
        .send(
          research.addDocuments(
            id,
            body.documents,
            idempotencyOptions(request),
            principalOf(request).id,
          ),
        );
    },
  );
}
