import { AppError } from '../errors.js';
import type { FundingSource } from '../models/factory.js';
import { CapabilityMemory } from '../models/capabilities.js';
import { ModelRefusedError } from '../models/safety.js';
import type { ModelRole } from '../models/task.js';
import { ProviderTelemetry } from '../models/telemetry.js';
import { geminiFailure } from './byok/errors.js';
import { geminiProvider } from './byok/provider.js';
import { byokRouting } from './byok/routing.js';
import { currentFunding } from './funding.js';
import { createSpendGate } from './gate.js';
import type { PublicContext } from './context.js';

/** Held to this when a call names no role: the least generous of the free tier's caps. */
const UNNAMED_ROLE_CAP = 2_000;

export const BYOK_BLOCKED_WORDS =
  'Google blocked this request for safety reasons. Change the text and try again.';

/** A block on a person's own key is Google's, and is worded as that; it stays a refusal in every other way. */
const rewordBlock = (error: unknown): unknown =>
  error instanceof ModelRefusedError && error.code === 'MODEL_REFUSED'
    ? new ModelRefusedError(BYOK_BLOCKED_WORDS, error.findings, 'BYOK_BLOCKED')
    : error;

const FREE_UNAVAILABLE =
  'The free model is not available right now. Try again later, or use your own key.';

/**
 * What a person is told when the operator's model fails them. The provider's own messages are written for the person
 * who runs the server (the deployment's name, the setting to change, the role to grant), and a stranger is told none of
 * it: the code stays, so that the page and the stop panel decide by it, and the words say what to do.
 */
const FREE_FAILURE_WORDS: Readonly<Record<string, string>> = {
  MODEL_AUTH: FREE_UNAVAILABLE,
  MODEL_NOT_FOUND: FREE_UNAVAILABLE,
  MODEL_PARAMETER_UNSUPPORTED: FREE_UNAVAILABLE,
  MODEL_PROTOCOL: FREE_UNAVAILABLE,
  MODEL_HTTP_ERROR: FREE_UNAVAILABLE,
  MODEL_ROUTE_UNAVAILABLE: FREE_UNAVAILABLE,
  MODEL_NOT_CONFIGURED: FREE_UNAVAILABLE,
  MODEL_RATE_LIMIT: 'The free model is busy. Try again in a moment, or use your own key.',
  MODEL_UNREACHABLE:
    'The free model could not be reached. Try again in a moment, or use your own key.',
  MODEL_TIMEOUT: 'The free model did not answer in time. Try again, or use your own key.',
  MODEL_REFUSED: 'The model declined this request. Change the text and try again.',
};

export const freeFailureWords = (error: unknown): unknown => {
  if (!(error instanceof AppError)) return error;
  const words = FREE_FAILURE_WORDS[error.code];
  if (words === undefined) return error;
  return error instanceof ModelRefusedError
    ? new ModelRefusedError(words, error.findings)
    : new AppError(error.statusCode, error.code, words);
};

/**
 * Decides, each time a model is made, how it is reached and paid for: from the funding of the request or the run that
 * is making it. With none there is no model at all: nothing reaches the operator's credits except on behalf of a
 * signed-in person. A person's own key is never a way to the operator's: if it is missing the model refuses, and does
 * not fall back to the free tier.
 */
export function publicFundingSource(context: PublicContext): FundingSource {
  const { config, pub } = context;
  // What is learned of the models a person's key reaches is kept apart from the operator's, and so are the counters:
  // one cannot teach the other a refusal, and a stranger's failures are not the operator's.
  const byokCapabilities = new CapabilityMemory();
  const byokTelemetry = new ProviderTelemetry(
    geminiProvider(null, null, config.provider.timeoutMs),
  );
  /** A refusal of a call is a security event, written once in a while for an account: the reason, and no more. */
  const refusedFor = (workspaceId: string) => (reason: string) =>
    context.auditOnce(
      reason === 'byok-concurrent' ? 'public.byok.blocked' : 'public.free.blocked',
      workspaceId,
      reason,
      {},
      () => context.users.getByWorkspace(workspaceId)?.id ?? workspaceId,
    );
  return () => {
    const funding = currentFunding();
    if (!funding) {
      return new AppError(
        403,
        'NO_FUNDING_CONTEXT',
        'A model can only be used on behalf of a signed-in person.',
      );
    }
    if (funding.funding === 'byok') {
      if (!pub.byok.enabled) {
        return new AppError(
          403,
          'NOT_AVAILABLE',
          'Using your own key is switched off on this site.',
        );
      }
      if (!funding.byok) {
        return new AppError(
          400,
          'BYOK_KEY_NEEDED',
          'Your own key is not saved, so it is needed again. Add it in settings, then continue.',
        );
      }
      const { key, model } = funding.byok;
      if (!model) {
        return new AppError(
          400,
          'BYOK_MODEL_NOT_FOUND',
          'Choose a model for your key in settings, then try again.',
        );
      }
      return {
        provider: geminiProvider(key, model, config.provider.timeoutMs),
        ...(context.options.byokFetcher ? { fetcher: context.options.byokFetcher } : {}),
        // Counted for the person's own meter and concurrency, never against the free tier.
        spend: createSpendGate({
          ledger: context.ledger,
          funding: { workspaceId: funding.workspaceId, funding: 'byok', byok: null },
          prices: [],
          freeEnabled: () => false,
          refused: refusedFor(funding.workspaceId),
        }),
        routing: byokRouting(model, config.routing),
        capabilities: byokCapabilities,
        observer: byokTelemetry,
        failure: geminiFailure,
        reword: rewordBlock,
      };
    }
    return {
      provider: config.provider,
      ...(context.options.modelFetcher ? { fetcher: context.options.modelFetcher } : {}),
      spend: createSpendGate({
        ledger: context.ledger,
        funding,
        prices: config.routing.prices,
        freeEnabled: context.freeEnabled,
        refused: refusedFor(funding.workspaceId),
      }),
      outputCap: (role: ModelRole | null) =>
        (role ? pub.free.roleMaxOutputTokens[role] : undefined) ?? UNNAMED_ROLE_CAP,
      reword: freeFailureWords,
    };
  };
}
