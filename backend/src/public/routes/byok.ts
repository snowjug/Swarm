import type { FastifyInstance } from 'fastify';
import { principalOf } from '../../auth/guard.js';
import { AppError } from '../../errors.js';
import { connectGemini, CONNECT_WORDS } from '../byok/connect.js';
import { byokOf } from '../byok/provider.js';
import type { PublicContext } from '../context.js';

const FIFTEEN_MINUTES = 15 * 60_000;

/**
 * Trying a key, and forgetting it. `connect` makes one request that uses no tokens, so a person learns their key works
 * before a run depends on it. It is signed-in only and limited by address and by account, so it is not a way to find out
 * whether somebody else's keys are valid. Neither route ever returns a key, or any part of one.
 */
export function byokRoutes(app: FastifyInstance, context: PublicContext): void {
  const { pub, config } = context;
  const perAccount = context.keyChecks;

  app.post(
    '/api/byok/connect',
    { config: { rateLimit: { max: 10 * config.rateLimitScale, timeWindow: '1 hour' } } },
    async (request) => {
      const principal = principalOf(request);
      if (!pub.byok.enabled) {
        return {
          status: 'disabled',
          message: CONNECT_WORDS.disabled,
          models: [],
          defaultModel: null,
        };
      }
      const said = byokOf(request);
      if (said.kind !== 'ok') {
        throw new AppError(
          400,
          'INVALID_INPUT',
          'Send your key with this request, as the page does. It was missing or not in a form this server reads.',
        );
      }
      if (!perAccount.allow(principal.id)) {
        throw new AppError(
          429,
          'RATE_LIMITED',
          `Too many key checks. Try again in ${Math.ceil(Math.max(perAccount.retryAfterMs(principal.id), 60_000) / 60_000)} minutes.`,
        );
      }
      const controller = new AbortController();
      request.raw.once('close', () => {
        if (!request.raw.complete) controller.abort();
      });
      const result = await connectGemini(said.byok.key, {
        ...(context.options.byokFetcher ? { fetcher: context.options.byokFetcher } : {}),
        signal: controller.signal,
      });
      // A key that did not work is not kept for the runs that would have used it.
      if (result.status !== 'valid') context.keys.forget(principal.tenantId);
      context.audit('public.byok.connect', principal.id, { status: result.status });
      return result;
    },
  );

  // "Forget key": the page clears its own copy, and this clears the one the server may hold for a run in progress.
  app.delete('/api/byok', async (request, reply) => {
    const principal = principalOf(request);
    context.keys.forget(principal.tenantId);
    context.audit('public.byok.forget', principal.id);
    return reply.code(204).send();
  });

  const sweep = setInterval(() => context.keys.sweep(), FIFTEEN_MINUTES);
  sweep.unref();
  app.addHook('onClose', async () => {
    clearInterval(sweep);
    context.keys.forgetAll();
  });
}
