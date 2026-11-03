import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { ModelFactory } from '../models/factory.js';
import { createRouter } from '../models/router.js';
import { MODEL_ROLES, type ModelRole } from '../models/task.js';
import type { ProviderTelemetry } from '../models/telemetry.js';
import type { ServerConfig } from '../config.js';

const pingSchema = z.object({ status: z.string().min(1).max(40) });
const PING = 'Connectivity check. Reply with the JSON object {"status":"ok"} and nothing else.';

/**
 * The deployments a Foundry configuration uses, each with the role that names it, so that a check
 * is made the way a real task would be: same deployment, same sampling, same structured output. A
 * deployment that no task could be routed to (a data zone it is not declared in) is not checked.
 */
function foundryChecks(config: ServerConfig): Array<{ role: ModelRole; deployment: string }> {
  const router = createRouter(config.routing);
  const seen = new Set<string>();
  const checks: Array<{ role: ModelRole; deployment: string }> = [];
  for (const role of MODEL_ROLES) {
    for (const deployment of router.deployments(role)) {
      if (seen.has(deployment)) continue;
      try {
        router.route({ role, contextChars: 300, available: [deployment] });
      } catch {
        continue;
      }
      seen.add(deployment);
      checks.push({ role, deployment });
    }
  }
  return checks;
}

export function providerRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  telemetry: ProviderTelemetry,
  createModel: ModelFactory,
  rateScale = 1,
): void {
  app.get('/api/provider/status', async () => telemetry.snapshot());

  // An explicit, user-triggered real round trip. It never runs automatically and never falls back.
  // For Foundry it asks every deployment that a task could be routed to, once each.
  app.post(
    '/api/provider/check',
    { config: { rateLimit: { max: 6 * rateScale, timeWindow: '1 minute' } } },
    async (request) => {
      if (!config.provider.configured) {
        throw new AppError(503, 'MODEL_NOT_CONFIGURED', config.provider.reason);
      }
      const controller = new AbortController();
      request.raw.once('close', () => {
        if (!request.raw.complete) controller.abort();
      });
      const within = () =>
        AbortSignal.any([controller.signal, AbortSignal.timeout(config.provider.timeoutMs)]);
      if (config.provider.name !== 'foundry') {
        const model = createModel(() => undefined, { maxCalls: 2 });
        await model.json(pingSchema, PING, { purpose: 'connectivity-check' }, within(), 50, {
          repairs: 1,
        });
        return telemetry.snapshot();
      }
      const checks = foundryChecks(config);
      if (checks.length === 0) {
        throw new AppError(
          503,
          'MODEL_ROUTE_UNAVAILABLE',
          'No configured deployment is declared in the data zone that tasks are held to.',
        );
      }
      const router = createRouter(config.routing);
      const model = createModel(() => undefined, { maxCalls: checks.length * 2 });
      for (const { role, deployment } of checks) {
        const route = router.route({
          role,
          contextChars: 300,
          maxTokens: 50,
          available: [deployment],
        });
        await model.json(
          pingSchema,
          PING,
          { purpose: 'connectivity-check' },
          within(),
          route.maxTokens,
          {
            repairs: 1,
            route: {
              role,
              task: 'connectivity-check',
              deployment: route.deployment,
              temperature: route.temperature,
              reasoningEffort: route.reasoningEffort,
              timeoutMs: route.timeoutMs,
              retry: route.retry,
              strictSchema: route.strictSchema,
            },
          },
        );
      }
      return telemetry.snapshot();
    },
  );
}
