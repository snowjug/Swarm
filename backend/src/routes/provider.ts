import type { FastifyInstance } from 'fastify';
import type { DeploymentCheck } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { CHECK_ANSWER_TOKENS, checkDeployment, summarizeChecks } from '../models/check.js';
import type { ModelFactory } from '../models/factory.js';
import { MINIMAL_EFFORT } from '../models/output-policy.js';
import { createRouter } from '../models/router.js';
import { MODEL_ROLES, type ModelRole } from '../models/task.js';
import type { ProviderTelemetry } from '../models/telemetry.js';
import type { ServerConfig } from '../config.js';

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
  // For Foundry it asks every deployment that a task could be routed to, once each. A check that ran is
  // always an answer (HTTP 200) that says what it found about each of the four things, apart: reached,
  // signed in to, deployment found, structured output. Only a check that could not be made (no model is
  // configured, no deployment may serve a task) is an error, so that "connected" and "the check failed"
  // are never said of the same thing.
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
      const credentials = config.provider.auth !== 'none';
      if (config.provider.name !== 'foundry') {
        const model = createModel(() => undefined, { maxCalls: 2 });
        const result = await checkDeployment(
          model,
          { deployment: config.provider.model, route: {} },
          { signal: within(), credentials },
        );
        telemetry.recordCheck(summarizeChecks([result]));
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
      // Room for what a deployment may need before it answers: refused parameters, and a cut-off reply asked again.
      const model = createModel(() => undefined, { maxCalls: checks.length * 5 });
      const results: DeploymentCheck[] = [];
      for (const { role, deployment } of checks) {
        const route = router.route({
          role,
          contextChars: 300,
          maxTokens: CHECK_ANSWER_TOKENS,
          available: [deployment],
        });
        results.push(
          await checkDeployment(
            model,
            {
              deployment: route.deployment,
              // The same deployment and sampling that a task would be sent with, but at the lowest
              // effort and with room to finish: the check is not a task that can afford to think.
              route: {
                role,
                deployment: route.deployment,
                temperature: route.temperature,
                reasoningEffort: MINIMAL_EFFORT,
                roomForReasoning: false,
                timeoutMs: route.timeoutMs,
                retry: route.retry,
                strictSchema: route.strictSchema,
              },
            },
            { signal: within(), credentials },
          ),
        );
      }
      telemetry.recordCheck(summarizeChecks(results));
      return telemetry.snapshot();
    },
  );
}
