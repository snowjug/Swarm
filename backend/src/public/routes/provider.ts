import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ByokStatus } from '../../../../shared/public.js';
import type { ProviderStatus } from '../../../../shared/types.js';
import { principalOf } from '../../auth/guard.js';
import { AppError } from '../../errors.js';
import { connectGemini } from '../byok/connect.js';
import type { PublicContext } from '../context.js';
import { currentFunding } from '../funding.js';
import { freeTierRefusal } from '../gate.js';

/** The failure code a key check that did not work stands for. */
const CODE_OF: Record<Exclude<ByokStatus, 'valid'>, string> = {
  invalid: 'BYOK_KEY_REJECTED',
  'rate-limited': 'BYOK_RATE_LIMITED',
  quota: 'BYOK_QUOTA',
  region: 'BYOK_REGION',
  unreachable: 'MODEL_UNREACHABLE',
  disabled: 'NOT_AVAILABLE',
};

/**
 * What the model chip is told in the public edition: what **this person's** funding can do, and what it has used today.
 * The pilot's route answers with the process's own counters (every caller's calls and tokens, its last error, its
 * deployment), which a stranger must not read, so this replaces it. On the free tier `check` makes no model call: the
 * state is read from the ledger, so pressing it cannot spend the operator's credits. On a person's own key it makes the
 * one request `POST /api/byok/connect` makes, which uses no tokens.
 */
export function publicProviderRoutes(
  app: FastifyInstance,
  context: PublicContext,
  rateScale = 1,
): void {
  const startedAt = new Date(context.now()).toISOString();

  const view = (
    request: FastifyRequest,
    checked?: { status: ByokStatus; message: string; at: string },
  ): ProviderStatus => {
    const principal = principalOf(request);
    const byok = currentFunding()?.byok ?? null;
    const counters = (
      from: Pick<
        ReturnType<typeof context.ledger.userState>['free'],
        'calls' | 'inputTokens' | 'outputTokens' | 'reasoningTokens'
      >,
    ): ProviderStatus['counters'] => ({
      calls: from.calls,
      repairCalls: 0,
      failures: 0,
      truncated: 0,
      schemaInvalid: 0,
      inputTokens: from.inputTokens,
      outputTokens: from.outputTokens,
      reasoningTokens: from.reasoningTokens,
      tokensReported: true,
    });
    const used = context.ledger.userState(principal.tenantId);
    if (byok) {
      const failed = checked !== undefined && checked.status !== 'valid';
      return {
        mode: 'real-model',
        provider: 'gemini',
        model: byok.model ?? 'Your own key',
        auth: 'none',
        configured: true,
        connectivity: checked === undefined ? 'unverified' : failed ? 'failing' : 'ok',
        lastCheckedAt: checked?.at ?? null,
        lastLatencyMs: null,
        lastError:
          checked !== undefined && checked.status !== 'valid'
            ? { code: CODE_OF[checked.status], message: checked.message }
            : null,
        check: null,
        counters: counters(used.byok),
        startedAt,
      };
    }
    const mine = used.free;
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
      counters: counters(mine),
      startedAt,
    };
  };

  app.get('/api/provider/status', async (request) => view(request));
  app.post(
    '/api/provider/check',
    { config: { rateLimit: { max: 6 * rateScale, timeWindow: '1 minute' } } },
    async (request) => {
      const byok = currentFunding()?.byok ?? null;
      if (!byok) return view(request);
      if (!context.keyChecks.allow(principalOf(request).id)) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many key checks. Try again in an hour.');
      }
      const controller = new AbortController();
      request.raw.once('close', () => {
        if (!request.raw.complete) controller.abort();
      });
      const result = await connectGemini(byok.key, {
        ...(context.options.byokFetcher ? { fetcher: context.options.byokFetcher } : {}),
        signal: controller.signal,
      });
      return view(request, {
        status: result.status,
        message: result.message,
        at: new Date(context.now()).toISOString(),
      });
    },
  );
}
