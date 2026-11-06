import { describe, expect, it } from 'vitest';
import { migratePublic } from '../../src/public/storage/migrations.js';
import { LedgerRefusal, UsageLedger, type LedgerLimits } from '../../src/public/storage/ledger.js';
import { asSystemView } from '../../src/storage/system-view.js';
import { openDatabase } from '../../src/storage/open.js';
import { migrate } from '../../src/storage/migrations.js';
import type { SqlDatabase } from '../../src/storage/sql.js';

const LIMITS: LedgerLimits = {
  userDailyTokens: 1_000,
  userDailyCalls: 5,
  userLifetimeTokens: 2_500,
  userConcurrentCalls: 2,
  globalDailyTokens: 1_800,
  globalDailyMicroUsd: 500,
  byokConcurrentCalls: 2,
};

function open(target: string): { database: SqlDatabase; close(): void } {
  const database = openDatabase(target);
  migrate(database, { path: target });
  migratePublic(database);
  return { database, close: () => database.close() };
}

const DAY = 86_400_000;

describe.each([':memory:', 'pglite:memory'])('the usage ledger on %s', (target) => {
  const make = (
    limits: Partial<LedgerLimits> = {},
    clock: { at: number } = { at: Date.UTC(2026, 10, 5, 10) },
  ) => {
    const { database, close } = open(target);
    const ledger = new UsageLedger(
      asSystemView(database),
      { ...LIMITS, ...limits },
      () => clock.at,
    );
    return { ledger, database, clock, close };
  };
  const free = (workspaceId: string, tokens: number, microUsd = 10) => ({
    workspaceId,
    funding: 'free' as const,
    tokens,
    microUsd,
  });

  it('counts what a call really used, hidden reasoning tokens included, and gives the reservation back', () => {
    const { ledger, close } = make();
    const held = ledger.reserve(free('w_a', 900, 100));
    expect(ledger.userState('w_a').free).toMatchObject({
      reservedTokens: 900,
      reservedCalls: 1,
      calls: 0,
    });
    expect(ledger.globalState()).toMatchObject({ reservedTokens: 900, reservedCalls: 1 });
    ledger.settle(held, {
      inputTokens: 300,
      outputTokens: 500,
      reasoningTokens: 200,
      microUsd: 42,
    });
    const mine = ledger.userState('w_a');
    expect(mine.free).toMatchObject({
      calls: 1,
      inputTokens: 300,
      outputTokens: 500,
      reasoningTokens: 200,
      reservedTokens: 0,
      reservedCalls: 0,
      microUsd: 42,
    });
    expect(mine.lifetimeTokens).toBe(800);
    expect(mine.lifetimeReserved).toBe(0);
    expect(ledger.globalState()).toMatchObject({
      calls: 1,
      inputTokens: 300,
      outputTokens: 500,
      reasoningTokens: 200,
      reservedTokens: 0,
      microUsd: 42,
    });
    close();
  });

  it('settles a reservation once: a second settle or a release of the same one changes nothing', () => {
    const { ledger, close } = make();
    const held = ledger.reserve(free('w_a', 100));
    ledger.settle(held, { inputTokens: 40, outputTokens: 40, reasoningTokens: null, microUsd: 1 });
    ledger.settle(held, { inputTokens: 40, outputTokens: 40, reasoningTokens: null, microUsd: 1 });
    ledger.release(held);
    expect(ledger.userState('w_a').free).toMatchObject({
      calls: 1,
      inputTokens: 40,
      outputTokens: 40,
      reservedTokens: 0,
      reservedCalls: 0,
    });
    close();
  });

  it('refuses a person at their daily tokens, counting what is reserved as well as what is used', () => {
    const { ledger, close } = make();
    const a = ledger.reserve(free('w_a', 600));
    expect(() => ledger.reserve(free('w_a', 600))).toThrow(LedgerRefusal);
    ledger.settle(a, { inputTokens: 100, outputTokens: 100, reasoningTokens: null, microUsd: 1 });
    // Now 200 used: 800 more fit, 801 do not.
    ledger.release(ledger.reserve(free('w_a', 800)));
    expect(() => ledger.reserve(free('w_a', 801))).toThrow(
      expect.objectContaining({ reason: 'user-cap' }),
    );
    // Another person is not held to it.
    ledger.release(ledger.reserve(free('w_b', 600)));
    close();
  });

  it('refuses a person at their daily calls, and at the calls they have in flight', () => {
    const { ledger, close } = make({
      userDailyTokens: 100_000,
      userLifetimeTokens: 1_000_000,
      globalDailyTokens: 1_000_000,
      globalDailyMicroUsd: 1_000_000,
    });
    const one = ledger.reserve(free('w_a', 10));
    const two = ledger.reserve(free('w_a', 10));
    expect(() => ledger.reserve(free('w_a', 10))).toThrow(
      expect.objectContaining({ reason: 'concurrent' }),
    );
    ledger.settle(one, { inputTokens: 5, outputTokens: 5, reasoningTokens: null, microUsd: 1 });
    ledger.settle(two, { inputTokens: 5, outputTokens: 5, reasoningTokens: null, microUsd: 1 });
    for (let i = 0; i < 3; i++)
      ledger.settle(ledger.reserve(free('w_a', 10)), {
        inputTokens: 5,
        outputTokens: 5,
        reasoningTokens: null,
        microUsd: 1,
      });
    expect(() => ledger.reserve(free('w_a', 10))).toThrow(
      expect.objectContaining({ reason: 'user-cap' }),
    );
    close();
  });

  it('refuses a person at their lifetime allowance, whatever day it is', () => {
    const clock = { at: Date.UTC(2026, 10, 5, 10) };
    const { ledger, close } = make(
      { userDailyTokens: 1_000, userLifetimeTokens: 1_500, globalDailyTokens: 1_000_000 },
      clock,
    );
    ledger.settle(ledger.reserve(free('w_a', 900)), {
      inputTokens: 450,
      outputTokens: 450,
      reasoningTokens: null,
      microUsd: 1,
    });
    clock.at += DAY;
    // A new day: the daily limit is fresh, the lifetime is not. 900 used of 1,500, so 700 would pass the day but not the life.
    expect(() => ledger.reserve(free('w_a', 700))).toThrow(
      expect.objectContaining({ reason: 'lifetime-cap' }),
    );
    ledger.release(ledger.reserve(free('w_a', 600)));
    close();
  });

  it('refuses everyone at the global cap, in tokens and in dollars, and leaves nothing reserved by the refused', () => {
    const { ledger, close } = make({
      userDailyTokens: 5_000,
      userLifetimeTokens: 50_000,
      globalDailyTokens: 1_500,
      globalDailyMicroUsd: 1_000_000,
    });
    const a = ledger.reserve(free('w_a', 1_000));
    expect(() => ledger.reserve(free('w_b', 1_000))).toThrow(
      expect.objectContaining({ reason: 'global-cap' }),
    );
    // The refusal did not keep what it had reserved for the person on the way.
    expect(ledger.userState('w_b').free).toMatchObject({ reservedTokens: 0, reservedCalls: 0 });
    expect(ledger.userState('w_b').lifetimeReserved).toBe(0);
    expect(ledger.globalState().reservedTokens).toBe(1_000);
    ledger.settle(a, { inputTokens: 100, outputTokens: 100, reasoningTokens: null, microUsd: 1 });
    ledger.release(ledger.reserve(free('w_b', 1_000)));
    expect(ledger.blockedByReason(1)).toEqual({ 'global-cap': 1 });

    const dollars = make({
      userDailyTokens: 5_000,
      userLifetimeTokens: 50_000,
      globalDailyTokens: 1_000_000,
      globalDailyMicroUsd: 150,
    });
    dollars.ledger.settle(dollars.ledger.reserve(free('w_a', 100, 100)), {
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: null,
      microUsd: 100,
    });
    expect(() => dollars.ledger.reserve(free('w_b', 100, 100))).toThrow(
      expect.objectContaining({ reason: 'global-cap' }),
    );
    dollars.close();
    close();
  });

  it('starts the day afresh at 00:00 UTC, for the person and for everyone', () => {
    const clock = { at: Date.UTC(2026, 10, 5, 23, 59, 0) };
    const { ledger, close } = make(
      { userDailyTokens: 500, userLifetimeTokens: 50_000, globalDailyTokens: 500 },
      clock,
    );
    ledger.settle(ledger.reserve(free('w_a', 500)), {
      inputTokens: 250,
      outputTokens: 250,
      reasoningTokens: null,
      microUsd: 1,
    });
    expect(ledger.freeReason('w_a')).toBe('global-cap');
    clock.at += 2 * 60_000;
    expect(ledger.today()).toBe('2026-11-06');
    expect(ledger.freeReason('w_a')).toBeNull();
    ledger.release(ledger.reserve(free('w_a', 500)));
    expect(ledger.days(3).map((row) => row.day)).toEqual(['2026-11-06', '2026-11-05']);
    close();
  });

  it('gives back what a crashed process left reserved', () => {
    const clock = { at: Date.UTC(2026, 10, 5, 10) };
    const { ledger, close } = make({}, clock);
    ledger.reserve(free('w_a', 400));
    expect(ledger.userState('w_a').free.reservedTokens).toBe(400);
    expect(ledger.sweep(60 * 60_000)).toBe(0);
    clock.at += 2 * 3_600_000;
    expect(ledger.sweep(60 * 60_000)).toBe(1);
    expect(ledger.userState('w_a').free).toMatchObject({
      reservedTokens: 0,
      reservedCalls: 0,
      calls: 0,
    });
    expect(ledger.globalState().reservedTokens).toBe(0);
    close();
  });

  it('keeps a person’s own key out of every free-tier count and cap', () => {
    const { ledger, close } = make({
      globalDailyTokens: 10,
      userDailyTokens: 10,
      userLifetimeTokens: 10,
    });
    const held = ledger.reserve({
      workspaceId: 'w_a',
      funding: 'byok',
      tokens: 50_000,
      microUsd: 0,
    });
    ledger.settle(held, {
      inputTokens: 20_000,
      outputTokens: 20_000,
      reasoningTokens: 5_000,
      microUsd: 0,
    });
    expect(ledger.userState('w_a').byok).toMatchObject({
      calls: 1,
      inputTokens: 20_000,
      outputTokens: 20_000,
    });
    expect(ledger.userState('w_a').free).toMatchObject({ calls: 0, inputTokens: 0 });
    expect(ledger.userState('w_a').lifetimeTokens).toBe(0);
    expect(ledger.globalState()).toMatchObject({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      reservedTokens: 0,
    });
    // Only their own concurrency holds them.
    const one = ledger.reserve({ workspaceId: 'w_a', funding: 'byok', tokens: 1, microUsd: 0 });
    const two = ledger.reserve({ workspaceId: 'w_a', funding: 'byok', tokens: 1, microUsd: 0 });
    expect(() =>
      ledger.reserve({ workspaceId: 'w_a', funding: 'byok', tokens: 1, microUsd: 0 }),
    ).toThrow(expect.objectContaining({ reason: 'byok-concurrent' }));
    ledger.release(one);
    ledger.release(two);
    // And a used-up free tier does not touch them.
    expect(ledger.freeReason('w_a')).toBeNull();
    close();
  });

  it('shows the administrator spend by day, the top accounts and the refusals', () => {
    const { ledger, close } = make({
      userDailyTokens: 5_000,
      userLifetimeTokens: 50_000,
      globalDailyTokens: 50_000,
      globalDailyMicroUsd: 5_000_000,
    });
    ledger.settle(ledger.reserve(free('w_a', 300)), {
      inputTokens: 100,
      outputTokens: 100,
      reasoningTokens: 10,
      microUsd: 7,
    });
    ledger.settle(ledger.reserve(free('w_b', 900)), {
      inputTokens: 400,
      outputTokens: 400,
      reasoningTokens: 0,
      microUsd: 11,
    });
    ledger.recordBlocked('user-cap');
    ledger.recordBlocked('user-cap');
    expect(ledger.days(1)).toEqual([
      { day: '2026-11-05', calls: 2, tokens: 1_000, reasoningTokens: 10, microUsd: 18, blocked: 2 },
    ]);
    expect(ledger.topWorkspaces(7, 5)).toEqual([
      { workspaceId: 'w_b', tokens: 800, calls: 1 },
      { workspaceId: 'w_a', tokens: 200, calls: 1 },
    ]);
    close();
  });
});

void [DAY];
