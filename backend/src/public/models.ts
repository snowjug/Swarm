import { AppError } from '../errors.js';
import type { FundingSource } from '../models/factory.js';
import type { ModelRole } from '../models/task.js';
import { currentFunding } from './funding.js';
import { createSpendGate } from './gate.js';
import type { PublicContext } from './context.js';

/** Held to this when a call names no role: the least generous of the free tier's caps. */
const UNNAMED_ROLE_CAP = 2_000;

/**
 * Decides, each time a model is made, how it is reached and paid for: from the funding of the request or the run that
 * is making it. With none there is no model at all: nothing reaches the operator's credits except on behalf of a
 * signed-in person.
 */
export function publicFundingSource(
  context: PublicContext,
  byok: (funding: { key: string; model: string | null }) => ReturnType<FundingSource>,
): FundingSource {
  const { config, pub } = context;
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
      if (!funding.byok) {
        return new AppError(
          400,
          'BYOK_KEY_NEEDED',
          'Your own key is not saved, so it is needed again. Add it in settings, then continue.',
        );
      }
      return byok(funding.byok);
    }
    return {
      provider: config.provider,
      ...(context.options.modelFetcher ? { fetcher: context.options.modelFetcher } : {}),
      spend: createSpendGate({
        ledger: context.ledger,
        funding,
        prices: config.routing.prices,
        freeEnabled: context.freeEnabled,
      }),
      outputCap: (role: ModelRole | null) =>
        (role ? pub.free.roleMaxOutputTokens[role] : undefined) ?? UNNAMED_ROLE_CAP,
    };
  };
}
