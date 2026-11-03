import { AppError } from '../errors.js';

/**
 * What a model call may cost, as an ESTIMATE. Swarm ships no prices: a deployment's price is whatever
 * its operator enters, and a deployment with none has a cost of "unknown", never a guess. Nothing here
 * is a bill; the provider's own metering is.
 */
export interface PriceEntry {
  /** A deployment name, or a pattern in which `*` stands for any run of characters. */
  deployment: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export type PriceTable = readonly PriceEntry[];

/** `estimate`: priced, and only an estimate. `unknown`: no price is configured, so no number is given. */
export type CostEstimate = { basis: 'estimate'; usd: number } | { basis: 'unknown'; usd: null };

export const NO_COST: CostEstimate = { basis: 'estimate', usd: 0 };
export const UNKNOWN_COST: CostEstimate = { basis: 'unknown', usd: null };

/**
 * Characters per token used wherever a token count has to be guessed before a call. Low on purpose:
 * code, JSON and many scripts need more tokens per character than English prose, and an estimate that
 * is too small would let a limit be passed.
 */
export const CHARS_PER_TOKEN = 3;

export const estimateTokens = (chars: number): number =>
  Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);

function matches(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name;
  const parts = pattern.split('*');
  const head = parts[0] ?? '';
  const tail = parts[parts.length - 1] ?? '';
  if (name.length < head.length + tail.length || !name.startsWith(head) || !name.endsWith(tail)) {
    return false;
  }
  const end = name.length - tail.length;
  let at = head.length;
  for (const part of parts.slice(1, -1)) {
    const found = name.indexOf(part, at);
    if (found === -1 || found + part.length > end) return false;
    at = found + part.length;
  }
  return true;
}

/** The most specific entry for a deployment: an exact name, then the pattern with most fixed characters. */
export function priceFor(table: PriceTable, deployment: string | null): PriceEntry | null {
  if (!deployment) return null;
  let best: PriceEntry | null = null;
  let bestScore = -1;
  for (const entry of table) {
    if (!matches(entry.deployment, deployment)) continue;
    const score = entry.deployment.includes('*')
      ? entry.deployment.replaceAll('*', '').length
      : Number.MAX_SAFE_INTEGER;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
}

const usd = (price: PriceEntry, input: number, output: number): number =>
  (input * price.inputPerMillionUsd + output * price.outputPerMillionUsd) / 1_000_000;

export function estimateCostUsd(
  usage: TokenCounts,
  deployment: string | null,
  table: PriceTable,
): CostEstimate {
  const price = priceFor(table, deployment);
  if (!price) return UNKNOWN_COST;
  return { basis: 'estimate', usd: usd(price, usage.inputTokens, usage.outputTokens) };
}

/** The most one call could cost: every input token, and a reply of the whole output budget. */
export function worstCaseCostUsd(
  inputTokens: number,
  maxOutputTokens: number,
  deployment: string | null,
  table: PriceTable,
): number | null {
  const price = priceFor(table, deployment);
  return price ? usd(price, inputTokens, maxOutputTokens) : null;
}

/** Adds costs: one unknown makes the sum unknown, because the part that is missing cannot be guessed. */
export function addCosts(left: CostEstimate, right: CostEstimate): CostEstimate {
  if (left.basis === 'unknown' || right.basis === 'unknown') return UNKNOWN_COST;
  return { basis: 'estimate', usd: left.usd + right.usd };
}

export type BudgetKind = 'tokens' | 'usd' | 'unpriced';

/** A model call that was not started because the operation's own allowance could not cover it. */
export class OperationBudgetError extends AppError {
  constructor(
    public readonly kind: BudgetKind,
    message: string,
  ) {
    super(429, kind === 'tokens' ? 'MODEL_TOKEN_BUDGET' : 'MODEL_COST_BUDGET', message);
    this.name = 'OperationBudgetError';
  }
}

export interface OperationBudgetOptions {
  /** Input plus output tokens the operation may use. 0 or absent: no limit. */
  tokens?: number;
  /** Estimated US dollars the operation may spend. 0 or absent: no limit. Needs prices. */
  usd?: number;
  prices?: PriceTable;
}

export interface CallRequest {
  deployment: string;
  inputTokens: number;
  maxOutputTokens: number;
}

export interface Reservation {
  /** Ends the reservation. What the call really used replaces it; null: nothing was reported. */
  settle(actual: TokenCounts | null): void;
}

export interface OperationUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** The estimated cost of the calls so far; unknown as soon as one call had no price. */
  cost: CostEstimate;
}

/**
 * One operation's allowance of tokens and of estimated dollars. A call is admitted only if its worst
 * case (every input token, and a reply of the whole output budget) still fits, so calls that run at
 * the same moment cannot together pass the limit, and a limit in dollars is never enforced from a
 * price that is not there: a deployment without a price is refused under such a limit.
 */
export class OperationBudget {
  readonly tokenLimit: number;
  readonly usdLimit: number;
  private readonly prices: PriceTable;
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private spentUsd = 0;
  private unpriced = false;
  private reservedTokens = 0;
  private reservedUsd = 0;

  constructor(options: OperationBudgetOptions = {}) {
    this.tokenLimit = Math.max(0, options.tokens ?? 0);
    this.usdLimit = Math.max(0, options.usd ?? 0);
    this.prices = options.prices ?? [];
  }

  reserve(request: CallRequest): Reservation {
    const worstTokens = request.inputTokens + request.maxOutputTokens;
    if (
      this.tokenLimit > 0 &&
      this.inputTokens + this.outputTokens + this.reservedTokens + worstTokens > this.tokenLimit
    ) {
      throw new OperationBudgetError(
        'tokens',
        'The model token budget for this operation would be passed by this call, so it was not made.',
      );
    }
    let worstUsd = 0;
    if (this.usdLimit > 0) {
      const worst = worstCaseCostUsd(
        request.inputTokens,
        request.maxOutputTokens,
        request.deployment,
        this.prices,
      );
      if (worst === null) {
        throw new OperationBudgetError(
          'unpriced',
          'A model cost limit is set, but this deployment has no price configured, so the call was not made.',
        );
      }
      if (this.spentUsd + this.reservedUsd + worst > this.usdLimit) {
        throw new OperationBudgetError(
          'usd',
          'The estimated model cost for this operation would be passed by this call, so it was not made.',
        );
      }
      worstUsd = worst;
    }
    this.reservedTokens += worstTokens;
    this.reservedUsd += worstUsd;
    let settled = false;
    return {
      settle: (actual) => {
        if (settled) return;
        settled = true;
        this.reservedTokens -= worstTokens;
        this.reservedUsd -= worstUsd;
        this.calls += 1;
        if (!actual) return;
        this.inputTokens += actual.inputTokens;
        this.outputTokens += actual.outputTokens;
        const cost = estimateCostUsd(actual, request.deployment, this.prices);
        if (cost.basis === 'estimate') this.spentUsd += cost.usd;
        else this.unpriced = true;
      },
    };
  }

  snapshot(): OperationUsage {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cost: this.unpriced ? UNKNOWN_COST : { basis: 'estimate', usd: this.spentUsd },
    };
  }

  /**
   * Counts a call that was made without asking: nothing is refused, because it has been made, but
   * what it used is spent from the allowance all the same.
   */
  charge(deployment: string, used: TokenCounts): void {
    this.calls += 1;
    this.inputTokens += used.inputTokens;
    this.outputTokens += used.outputTokens;
    const cost = estimateCostUsd(used, deployment, this.prices);
    if (cost.basis === 'estimate') this.spentUsd += cost.usd;
    else this.unpriced = true;
  }
}

/** The codes that mean an allowance, not a failure, ended the work: callers stop instead of retrying. */
export const BUDGET_CODES: ReadonlySet<string> = new Set([
  'MODEL_TOKEN_BUDGET',
  'MODEL_COST_BUDGET',
  'MODEL_CALL_BUDGET',
  'PROJECT_BUDGET',
]);
