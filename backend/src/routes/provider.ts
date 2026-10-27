import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { ModelFactory } from '../models/factory.js';
import type { ProviderTelemetry } from '../models/telemetry.js';
import type { ServerConfig } from '../config.js';

const pingSchema = z.object({ status: z.string().min(1).max(40) });

export function providerRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  telemetry: ProviderTelemetry,
  createModel: ModelFactory,
  rateScale = 1,
): void {
  app.get('/api/provider/status', async () => telemetry.snapshot());

  // An explicit, user-triggered real round trip. It never runs automatically and never falls back.
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
      const model = createModel(() => undefined, { maxCalls: 2 });
      await model.json(
        pingSchema,
        'Connectivity check. Reply with the JSON object {"status":"ok"} and nothing else.',
        { purpose: 'connectivity-check' },
        AbortSignal.any([controller.signal, AbortSignal.timeout(config.provider.timeoutMs)]),
        50,
        { repairs: 1 },
      );
      return telemetry.snapshot();
    },
  );
}
