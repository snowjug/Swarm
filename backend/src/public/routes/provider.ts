import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProviderStatus } from '../../../../shared/types.js';
import { principalOf } from '../../auth/guard.js';
import type { PublicContext } from '../context.js';
import { freeTierRefusal } from '../gate.js';

/**
 * What the model chip is told in the public edition: what **this person's** funding can do, and what it has used today.
 * The pilot's route answers with the process's own counters (every caller's calls and tokens, its last error, its
 * deployment), which a stranger must not read, so this replaces it. `check` makes no model call: the free tier's state
 * is read from the ledger, and a person's own key is tried by `POST /api/byok/connect`, which says what it found.
 */
export function publicProviderRoutes(
  app: FastifyInstance,
  context: PublicContext,
  rateScale = 1,
): void {
  const startedAt = new Date(context.now()).toISOString();

  const view = (request: FastifyRequest): ProviderStatus => {
    const principal = principalOf(request);
    const mine = context.ledger.userState(principal.tenantId).free;
    const reason = context.freeReason(principal.tenantId);
    const refusal = reason === null || reason === 'concurrent' ? null : freeTierRefusal(reason);
    const usable = reason === null || reason === 'concurrent';
    return {
      mode: context.config.provider.configured ? 'real-model' : 'local-rules',
      provider: context.config.provider.name,
      model: 'Free tier',
      auth: 'none',
      configured: context.config.provider.configured,
      connectivity: usable ? 'ok' : 'failing',
      lastCheckedAt: null,
      lastLatencyMs: null,
      lastError: refusal ? { code: refusal.code, message: refusal.message } : null,
      check: null,
      counters: {
        calls: mine.calls,
        repairCalls: 0,
        failures: 0,
        truncated: 0,
        schemaInvalid: 0,
        inputTokens: mine.inputTokens,
        outputTokens: mine.outputTokens,
        reasoningTokens: mine.reasoningTokens,
        tokensReported: true,
      },
      startedAt,
    };
  };

  app.get('/api/provider/status', async (request) => view(request));
  app.post(
    '/api/provider/check',
    { config: { rateLimit: { max: 6 * rateScale, timeWindow: '1 minute' } } },
    async (request) => view(request),
  );
}
