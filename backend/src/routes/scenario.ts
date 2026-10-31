import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  scenarioParseRequestSchema,
  scenarioWriteSchema,
  type ScenarioFrame,
  type ScenarioView,
} from '../../../shared/scenario.js';
import { principalOf } from '../auth/guard.js';
import type { ServerConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { ModelUsageSink } from '../models/client.js';
import type { ModelFactory } from '../models/factory.js';
import { parseScenario } from '../scenario/parse.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });
const KEY = 'default';
/** A question and its documents' excerpts, with room for the JSON around them. */
const PARSE_BODY_LIMIT = 300_000;
/** The first reading and two repairs: reading one question never costs more than this. */
const MODEL_CALLS = 3;

const countOf = (frame: ScenarioFrame) => ({
  changes: frame.changes.length,
  alternatives: frame.alternatives.length,
  assumptions: frame.assumptions.length,
  stakeholders: frame.likelyStakeholders.length,
  ambiguities: frame.ambiguities.length,
});

/**
 * Reading a what-if question into a scenario frame, and keeping the frame a person settled on. Who
 * may call what is in `auth/policy.ts`, and what is recorded in `auth/audit-policy.ts`: a question,
 * an excerpt and a frame are never recorded, only counts.
 */
export function scenarioRoutes(
  app: FastifyInstance,
  repository: Repository,
  config: ServerConfig,
  createModel: ModelFactory,
  rateScale = 1,
): void {
  const exists = (id: string): void => {
    if (!repository.ownership(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    }
  };

  // Before there is a project there is nothing to charge a model call to, so what bounds it is the
  // rate limit here, the three calls a reading may make, and the size of what is read.
  app.post(
    '/api/scenario/parse',
    {
      bodyLimit: PARSE_BODY_LIMIT,
      config: { rateLimit: { max: 10 * rateScale, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { question, documents } = scenarioParseRequestSchema.parse(request.body);
      const used = { calls: 0, inputTokens: 0, outputTokens: 0 };
      const sink: ModelUsageSink = (usage) => {
        used.calls += 1;
        used.inputTokens += usage.inputTokens;
        used.outputTokens += usage.outputTokens;
      };
      const model = config.provider.configured
        ? createModel(sink, { maxCalls: MODEL_CALLS })
        : null;
      const controller = new AbortController();
      const onClose = (): void => {
        if (!reply.raw.writableEnded) {
          controller.abort(
            new AppError(
              409,
              'CLIENT_DISCONNECTED',
              'The request disconnected before it finished.',
            ),
          );
        }
      };
      reply.raw.once('close', onClose);
      try {
        const result = await parseScenario({
          question,
          documents,
          model,
          modelName: config.provider.model,
          signal: controller.signal,
        });
        repository.audit.record({
          actor: principalOf(request).id,
          action: 'scenario.parsed',
          targetType: 'service',
          targetId: 'scenario.parsed',
          projectId: null,
          detail: {
            mode: result.mode,
            documents: documents.length,
            modelCalls: used.calls,
            tokens: used.inputTokens + used.outputTokens,
            ...countOf(result.frame),
          },
        });
        return result;
      } finally {
        reply.raw.removeListener('close', onClose);
      }
    },
  );

  const view = (id: string): ScenarioView => {
    exists(id);
    const stored = repository.artifacts.get(id, 'scenario', KEY);
    return { scenario: stored?.data ?? null, revision: stored?.revision ?? 0 };
  };

  // A project that never had a scenario answers with null, so a page can ask without failing.
  app.get('/api/projects/:id/scenario', async (request) => view(idParams.parse(request.params).id));

  app.put(
    '/api/projects/:id/scenario',
    { config: { rateLimit: { max: 60 * rateScale, timeWindow: '1 minute' } } },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const { scenario, expectedRevision } = scenarioWriteSchema.parse(request.body);
      exists(id);
      const stored = repository.artifacts.put(
        id,
        'scenario',
        KEY,
        scenario,
        expectedRevision === undefined ? {} : { expectedRevision },
      );
      return { scenario: stored.data, revision: stored.revision } satisfies ScenarioView;
    },
  );
}
