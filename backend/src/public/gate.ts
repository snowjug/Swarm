import { AppError } from '../errors.js';
import type { FreeTierReason } from '../../../shared/public.js';
import { estimateCostUsd, worstCaseCostUsd, type PriceTable } from '../models/cost.js';
import type { SpendGate, SpendTicket } from '../models/spend.js';
import type { FundingContext } from './funding.js';
import { LedgerRefusal, type UsageLedger } from './storage/ledger.js';

/** What a person reads when a call is refused. One sentence of what happened, and the one thing to do. */
const FREE_MESSAGE: Record<FreeTierReason, { code: string; message: string }> = {
  'user-cap': {
    code: 'FREE_TIER_USER_CAP',
    message:
      'You have used today’s free runs. They come back at 00:00 UTC, or you can use your own key now.',
  },
  'global-cap': {
    code: 'FREE_TIER_GLOBAL_CAP',
    message: 'The free tier is used up for today. Bring your own key, or come back tomorrow.',
  },
  'lifetime-cap': {
    code: 'FREE_TIER_LIFETIME_CAP',
    message: 'You have used the free allowance for this account. Bring your own key to keep going.',
  },
  disabled: {
    code: 'FREE_TIER_DISABLED',
    message: 'The free tier is switched off right now. You can still use your own key.',
  },
  concurrent: {
    code: 'FREE_TIER_CONCURRENT',
    message: 'A run is already in progress. It will finish soon.',
  },
};

/** The refusal for a reason, as an error every route turns into a plain state, never an ugly failure. */
export const freeTierRefusal = (reason: FreeTierReason): AppError =>
  new AppError(429, FREE_MESSAGE[reason].code, FREE_MESSAGE[reason].message);

export const byokBusy = (): AppError =>
  new AppError(
    429,
    'RUN_IN_PROGRESS',
    'Several calls on your key are already running. Wait a moment, then try again.',
  );

const toMicro = (usd: number): number => Math.max(0, Math.round(usd * 1_000_000));

/**
 * What is held for what is sent. It is an estimate from characters, and a provider counts more than the characters
 * (hidden instructions, the schema, framing), so the hold is padded: the surplus is given back at once when the call is
 * settled, and a call that used more than it held is still charged for all it used.
 */
export const heldInputTokens = (estimated: number): number => Math.ceil(estimated * 1.5) + 64;

/**
 * The gate a model client is given in the public edition. It reserves the worst case of a round trip before it is
 * made (`UsageLedger.reserve`) and settles the real usage after; a refusal is an error with a message that says what to
 * do. A person on their own key is never held to the free tier's caps, and never counted against them.
 */
export function createSpendGate(input: {
  ledger: UsageLedger;
  funding: FundingContext;
  prices: PriceTable;
  /** Whether the free tier may be used at all right now: the environment, the run-time switch, and a model that is set up. */
  freeEnabled: () => boolean;
}): SpendGate {
  const { ledger, funding, prices } = input;
  return {
    begin(request): SpendTicket {
      const heldInput = heldInputTokens(request.inputTokens);
      let microUsd = 0;
      if (funding.funding === 'free') {
        if (!input.freeEnabled()) throw freeTierRefusal('disabled');
        const worst = worstCaseCostUsd(
          heldInput,
          request.maxOutputTokens,
          request.deployment,
          prices,
        );
        // A call that cannot be priced cannot be held to a dollar cap: it is not made.
        if (worst === null) throw freeTierRefusal('disabled');
        microUsd = toMicro(worst);
      }
      let reservation;
      try {
        reservation = ledger.reserve({
          workspaceId: funding.workspaceId,
          funding: funding.funding,
          tokens: heldInput + request.maxOutputTokens,
          microUsd,
        });
      } catch (error) {
        if (error instanceof LedgerRefusal) {
          throw error.reason === 'byok-concurrent' ? byokBusy() : freeTierRefusal(error.reason);
        }
        throw error;
      }
      const costOf = (inputTokens: number, outputTokens: number): number => {
        if (funding.funding === 'byok') return 0;
        const estimate = estimateCostUsd({ inputTokens, outputTokens }, request.deployment, prices);
        return estimate.basis === 'estimate' ? toMicro(estimate.usd) : reservation.microUsd;
      };
      return {
        settle(used) {
          ledger.settle(reservation, {
            inputTokens: used.inputTokens,
            outputTokens: used.outputTokens,
            reasoningTokens: used.reasoningTokens,
            microUsd: costOf(used.inputTokens, used.outputTokens),
          });
        },
        settleAtWorstCase() {
          ledger.settle(reservation, {
            inputTokens: heldInput,
            outputTokens: request.maxOutputTokens,
            reasoningTokens: null,
            microUsd: funding.funding === 'byok' ? 0 : reservation.microUsd,
          });
        },
        release() {
          ledger.release(reservation);
        },
      };
    },
  };
}
