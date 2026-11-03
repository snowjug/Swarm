import { describe, expect, it } from 'vitest';
import {
  BUDGET_CODES,
  OperationBudget,
  UNKNOWN_COST,
  addCosts,
  budgetLimit,
  estimateCostUsd,
  estimateTokens,
  priceFor,
  worstCaseCostUsd,
  type PriceTable,
} from '../src/models/cost.js';

// Cost is an estimate from the operator's own price table. Without a price it is unknown, which is
// not zero and not a guess, and a limit in dollars is never enforced from a price that is not there.

const table: PriceTable = [
  { deployment: 'gpt-*', inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
  { deployment: 'gpt-mini-*', inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  { deployment: 'gpt-mini-eu', inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.8 },
  { deployment: '*-deep', inputPerMillionUsd: 10, outputPerMillionUsd: 40 },
  { deployment: 'a*b*c', inputPerMillionUsd: 5, outputPerMillionUsd: 5 },
];

describe('the price of a deployment', () => {
  it('is the most specific entry: an exact name, then the pattern with the most fixed characters', () => {
    expect(priceFor(table, 'gpt-mini-eu')?.inputPerMillionUsd).toBe(0.2);
    expect(priceFor(table, 'gpt-mini-us')?.inputPerMillionUsd).toBe(0.1);
    expect(priceFor(table, 'gpt-large')?.inputPerMillionUsd).toBe(1);
    expect(priceFor(table, 'thinker-deep')?.inputPerMillionUsd).toBe(10);
  });

  it('matches `*` as any run of characters, and nothing more', () => {
    expect(priceFor(table, 'a-xx-b-yy-c')?.inputPerMillionUsd).toBe(5);
    expect(priceFor(table, 'abc')?.inputPerMillionUsd).toBe(5);
    expect(priceFor(table, 'ac')).toBeNull();
    expect(priceFor(table, 'abcd')).toBeNull();
    expect(priceFor(table, 'gpt')).toBeNull();
    expect(priceFor(table, 'x-gpt-1')).toBeNull();
  });

  it('is nothing for a deployment with no entry, and for no deployment', () => {
    expect(priceFor([], 'gpt-4')).toBeNull();
    expect(priceFor(table, null)).toBeNull();
    expect(priceFor(table, '')).toBeNull();
  });

  it('does not take a pattern as a regular expression', () => {
    expect(
      priceFor([{ deployment: 'a.c', inputPerMillionUsd: 1, outputPerMillionUsd: 1 }], 'abc'),
    ).toBeNull();
  });
});

describe('an estimate', () => {
  it('is priced from the table and says it is an estimate', () => {
    const cost = estimateCostUsd({ inputTokens: 2_000, outputTokens: 500 }, 'gpt-large', table);
    expect(cost).toEqual({ basis: 'estimate', usd: 0.004 });
  });

  it('is unknown, never zero and never a guess, when nothing says what the deployment costs', () => {
    expect(estimateCostUsd({ inputTokens: 2_000, outputTokens: 500 }, 'mystery', table)).toEqual(
      UNKNOWN_COST,
    );
    expect(estimateCostUsd({ inputTokens: 1, outputTokens: 1 }, 'gpt-large', [])).toEqual({
      basis: 'unknown',
      usd: null,
    });
  });

  it('adds up to unknown as soon as one part is unknown', () => {
    const one = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }, 'gpt-large', table);
    expect(addCosts(one, one)).toEqual({ basis: 'estimate', usd: 2 });
    expect(addCosts(one, UNKNOWN_COST)).toEqual(UNKNOWN_COST);
  });

  it('counts a token as a third of a word at most: fewer tokens would let a limit be passed', () => {
    expect(estimateTokens(3_000)).toBe(1_000);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(0)).toBe(0);
    expect(worstCaseCostUsd(1_000, 2_000, 'gpt-large', table)).toBeCloseTo(0.009, 9);
    expect(worstCaseCostUsd(1_000, 2_000, 'mystery', table)).toBeNull();
  });
});

describe('an operation’s allowance of tokens', () => {
  const call = { deployment: 'gpt-large', inputTokens: 1_000, maxOutputTokens: 1_000 };

  it('admits a call only if its worst case still fits, and counts what it really used', () => {
    const budget = new OperationBudget({ tokens: 5_000 });
    const first = budget.reserve(call);
    first.settle({ inputTokens: 900, outputTokens: 100 });
    expect(budget.snapshot()).toMatchObject({ calls: 1, inputTokens: 900, outputTokens: 100 });
    // 1,000 used; three more calls of 2,000 each cannot all fit in the 4,000 that are left.
    const second = budget.reserve(call);
    const third = budget.reserve(call);
    expect(() => budget.reserve(call)).toThrowError(
      expect.objectContaining({ code: 'MODEL_TOKEN_BUDGET', statusCode: 429, kind: 'tokens' }),
    );
    second.settle({ inputTokens: 200, outputTokens: 50 });
    third.settle(null);
    // What they did not use is given back: there is room again.
    expect(() => budget.reserve(call).settle(null)).not.toThrow();
  });

  it('cannot be passed by calls that run at the same moment', () => {
    const budget = new OperationBudget({ tokens: 10_000 });
    const started = [];
    for (let index = 0; index < 20; index += 1) {
      try {
        started.push(budget.reserve(call));
      } catch {
        break;
      }
    }
    expect(started).toHaveLength(5);
    for (const reservation of started)
      reservation.settle({ inputTokens: 1_000, outputTokens: 1_000 });
    expect(budget.snapshot().inputTokens + budget.snapshot().outputTokens).toBe(10_000);
  });

  it('ends a reservation once, whatever is reported twice', () => {
    const budget = new OperationBudget({ tokens: 3_000 });
    const reservation = budget.reserve(call);
    reservation.settle({ inputTokens: 10, outputTokens: 10 });
    reservation.settle({ inputTokens: 999, outputTokens: 999 });
    expect(budget.snapshot()).toMatchObject({ calls: 1, inputTokens: 10, outputTokens: 10 });
  });

  it('has no limit when none is given, and counts a call made without asking', () => {
    const open = new OperationBudget();
    for (let index = 0; index < 100; index += 1) {
      open.reserve({ ...call, maxOutputTokens: 100_000 }).settle(null);
    }
    const strict = new OperationBudget({ tokens: 100 });
    strict.charge('gpt-large', { inputTokens: 90, outputTokens: 40 });
    expect(strict.snapshot()).toMatchObject({ calls: 1, inputTokens: 90, outputTokens: 40 });
    expect(() => strict.reserve({ ...call, inputTokens: 1, maxOutputTokens: 1 })).toThrow(
      'token budget',
    );
  });
});

describe('a limit that is not a limit', () => {
  const call = { deployment: 'gpt-large', inputTokens: 1_000, maxOutputTokens: 1_000 };

  // A caller that works out what is "remaining" can get a number below zero, or no number at all. Read
  // as none, either would be an allowance that never stops anything, so neither is made.
  it.each([-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'is not made from %s tokens, or from that many dollars',
    (value) => {
      for (const options of [{ tokens: value }, { usd: value, prices: table }]) {
        expect(() => new OperationBudget(options)).toThrowError(
          expect.objectContaining({ code: 'MODEL_BUDGET_INVALID', statusCode: 500 }),
        );
      }
      expect(() => budgetLimit('token', value)).toThrow('zero (no limit)');
    },
  );

  it('keeps 0, and no limit given, as no limit, as the settings document', () => {
    for (const options of [{}, { tokens: 0 }, { usd: 0 }, { tokens: 0, usd: 0 }]) {
      const open = new OperationBudget(options);
      expect([open.tokenLimit, open.usdLimit]).toEqual([0, 0]);
      open.reserve({ ...call, inputTokens: 1e9, maxOutputTokens: 1e9 }).settle(null);
    }
    expect(budgetLimit('dollar', undefined)).toBe(0);
    expect(budgetLimit('dollar', 0.25)).toBe(0.25);
  });

  it('does not let a call whose size is not a count of tokens make every later comparison false', () => {
    const budget = new OperationBudget({ tokens: 10_000 });
    for (const size of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(() => budget.reserve({ ...call, inputTokens: size })).toThrowError(
        expect.objectContaining({ code: 'MODEL_BUDGET_INVALID' }),
      );
      expect(() => budget.reserve({ ...call, maxOutputTokens: size })).toThrowError(
        expect.objectContaining({ code: 'MODEL_BUDGET_INVALID' }),
      );
    }
    // Nothing was reserved by them, and the limit still holds.
    expect(budget.snapshot().calls).toBe(0);
    expect(() => budget.reserve({ ...call, inputTokens: 6_000, maxOutputTokens: 6_000 })).toThrow(
      'token budget',
    );
  });
});

describe('an operation’s allowance of dollars', () => {
  const call = { deployment: 'gpt-large', inputTokens: 1_000, maxOutputTokens: 1_000 };

  it('is enforced from the table, on the worst case', () => {
    // A call costs at most 1,000 x $1/M + 1,000 x $4/M = $0.005.
    const budget = new OperationBudget({ usd: 0.012, prices: table });
    const first = budget.reserve(call);
    const second = budget.reserve(call);
    expect(() => budget.reserve(call)).toThrowError(
      expect.objectContaining({ code: 'MODEL_COST_BUDGET', kind: 'usd' }),
    );
    first.settle({ inputTokens: 100, outputTokens: 100 });
    second.settle({ inputTokens: 100, outputTokens: 100 });
    const cost = budget.snapshot().cost;
    expect(cost.basis).toBe('estimate');
    expect(cost.usd).toBeCloseTo(0.001, 9);
    expect(() => budget.reserve(call)).not.toThrow();
  });

  it('refuses a deployment that has no price, instead of letting a limit that cannot be checked pass', () => {
    const budget = new OperationBudget({ usd: 1, prices: table });
    expect(() => budget.reserve({ ...call, deployment: 'mystery' })).toThrowError(
      expect.objectContaining({ code: 'MODEL_COST_BUDGET', kind: 'unpriced' }),
    );
    expect(() => new OperationBudget({ usd: 1 }).reserve(call)).toThrow('no price');
  });

  it('reports a cost that is unknown once a call without a price was charged', () => {
    const budget = new OperationBudget({ prices: table });
    budget.reserve({ ...call, deployment: 'mystery' }).settle({ inputTokens: 5, outputTokens: 5 });
    expect(budget.snapshot().cost).toEqual(UNKNOWN_COST);
  });

  it('names every code that means an allowance, not a failure, ended the work', () => {
    for (const code of [
      'MODEL_TOKEN_BUDGET',
      'MODEL_COST_BUDGET',
      'MODEL_CALL_BUDGET',
      'PROJECT_BUDGET',
    ]) {
      expect(BUDGET_CODES.has(code)).toBe(true);
    }
    expect(BUDGET_CODES.has('MODEL_RATE_LIMIT')).toBe(false);
  });
});
