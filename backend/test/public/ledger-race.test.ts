import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import type { LedgerLimits } from '../../src/public/storage/ledger.js';
import {
  openLedger,
  runRounds,
  type RoundParams,
  type RoundResult,
} from '../support/ledger-worker.js';

// The usage ledger is what keeps the free tier to its caps, so "however the calls interleave" is tested the way the
// ledger is used: several users of one database, each with a connection of its own, released together, and the
// caps looked at while they run, and not only when they are done. SQLite is raced for real (a thread per writer on one
// file). PGlite has one connection in a process, so its writers take turns. A real PostgreSQL server is raced the same
// way as SQLite when SWARM_TEST_POSTGRES_URL names a database this test may fill (see concurrency.test.ts).
const ROUNDS = 25;
const HOLDS = 2;
const HELD = 900;
const USED = { inputTokens: 150, outputTokens: 250, reasoningTokens: 100 };
const PER_CALL = USED.inputTokens + USED.outputTokens;
const LIMITS: LedgerLimits = {
  userDailyTokens: 6_000,
  userDailyCalls: 1_000,
  userLifetimeTokens: 10_000_000,
  userConcurrentCalls: 3,
  globalDailyTokens: 15_000,
  globalDailyMicroUsd: 1_000_000_000,
  byokConcurrentCalls: 2,
};
// Two writers share one person, so that a person's own caps are raced as well as the whole tier's.
const WORKSPACES = ['w_shared', 'w_shared', 'w_c', 'w_d'] as const;

const root = fileURLToPath(new URL('../../', import.meta.url));
const directories: string[] = [];
afterAll(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface Engine {
  name: string;
  parallel: boolean;
  target: () => string;
}
const postgres = process.env.SWARM_TEST_POSTGRES_URL;
const engines: Engine[] = [
  {
    name: 'SQLite',
    parallel: true,
    target: () => {
      mkdirSync(join(root, 'data'), { recursive: true });
      const directory = mkdtempSync(join(root, 'data', 'ledger-race-'));
      directories.push(directory);
      return join(directory, 'race.sqlite');
    },
  },
  { name: 'PGlite', parallel: false, target: () => `pglite:ledger_race_${Date.now()}` },
  ...(postgres ? [{ name: 'PostgreSQL', parallel: true, target: () => postgres }] : []),
];

type Message = { type: string; result?: RoundResult };
const next = (worker: Worker, type: string): Promise<Message> =>
  new Promise((resolve, reject) => {
    const onMessage = (message: Message): void => {
      if (message.type !== type) return;
      cleanup();
      resolve(message);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
  });

// A day nobody has used: a real database may already hold others'.
const freshDay = (): number =>
  Date.UTC(2100, 0, 1) + Math.floor(Math.random() * 365 * 50) * 86_400_000 + 10 * 3_600_000;

describe.each(engines)('$name: the usage ledger under writers that run at once', (engine) => {
  it('never lets what is used and held pass a cap, at any moment, and ends with nothing held', async () => {
    const target = engine.target();
    const at = freshDay();
    const parent = openLedger(target, LIMITS, at);
    const rounds = (index: number): RoundParams => ({
      workspaceId: WORKSPACES[index]!,
      rounds: ROUNDS,
      holds: HOLDS,
      held: HELD,
      used: USED,
    });
    let results: RoundResult[];
    const samples: string[] = [];
    const sample = (): void => {
      const global = parent.ledger.globalState();
      const held = global.inputTokens + global.outputTokens + global.reservedTokens;
      if (held > LIMITS.globalDailyTokens) samples.push(`the tier held ${held}`);
      for (const workspace of new Set(WORKSPACES)) {
        const mine = parent.ledger.userState(workspace).free;
        const heldByPerson = mine.inputTokens + mine.outputTokens + mine.reservedTokens;
        if (heldByPerson > LIMITS.userDailyTokens)
          samples.push(`${workspace} held ${heldByPerson}`);
        if (mine.reservedCalls > LIMITS.userConcurrentCalls) {
          samples.push(`${workspace} had ${mine.reservedCalls} calls in flight`);
        }
      }
    };
    if (engine.parallel) {
      const url = new URL('../support/ledger-worker.ts', import.meta.url);
      const workers = WORKSPACES.map(
        () =>
          new Worker(url, {
            workerData: { target, limits: LIMITS, at },
            execArgv: ['--import', 'tsx'],
          }),
      );
      try {
        await Promise.all(workers.map((worker) => once(worker, 'message')));
        const shared = new SharedArrayBuffer(4);
        const armed = workers.map((worker) => next(worker, 'armed'));
        const done = workers.map((worker) => next(worker, 'result'));
        workers.forEach((worker, index) =>
          worker.postMessage({ type: 'round', params: rounds(index), gate: shared }),
        );
        await Promise.all(armed);
        Atomics.store(new Int32Array(shared), 0, 1);
        Atomics.notify(new Int32Array(shared), 0);
        let finished = false;
        const all = Promise.all(done).then((messages) => {
          finished = true;
          return messages;
        });
        while (!finished) {
          sample();
          await sleep(2);
        }
        results = (await all).map((message) => message.result!);
      } finally {
        for (const worker of workers) worker.postMessage({ type: 'stop' });
        await Promise.all(workers.map((worker) => worker.terminate()));
      }
    } else {
      const others = WORKSPACES.slice(1).map(() => openLedger(target, LIMITS, at));
      try {
        results = [parent, ...others].map((opened, index) =>
          runRounds(opened.ledger, rounds(index)),
        );
      } finally {
        for (const opened of others) opened.close();
      }
    }
    sample();

    expect(results.flatMap((result) => result.unexpected)).toEqual([]);
    for (const result of results) {
      const refused = Object.values(result.refused).reduce((sum, count) => sum + count, 0);
      expect(result.settled + refused).toBe(ROUNDS * HOLDS);
    }
    const settled = results.reduce((sum, result) => sum + result.settled, 0);
    expect(settled).toBeGreaterThan(0);
    const turnedAway = results.reduce(
      (sum, result) => sum + (result.refused['global-cap'] ?? 0),
      0,
    );
    // 200 calls were asked for against room for 37: the whole tier's cap is what ended it, for somebody.
    expect(turnedAway).toBeGreaterThan(0);

    const global = parent.ledger.globalState();
    expect(global).toMatchObject({
      calls: settled,
      inputTokens: settled * USED.inputTokens,
      outputTokens: settled * USED.outputTokens,
      reasoningTokens: settled * USED.reasoningTokens,
      reservedTokens: 0,
      reservedCalls: 0,
    });
    expect(global.inputTokens + global.outputTokens).toBeLessThanOrEqual(LIMITS.globalDailyTokens);
    // What each person was charged adds up to what the tier was, and none passed theirs.
    let sum = 0;
    for (const workspace of new Set(WORKSPACES)) {
      const mine = parent.ledger.userState(workspace).free;
      const used = mine.inputTokens + mine.outputTokens;
      sum += used;
      expect(used).toBeLessThanOrEqual(LIMITS.userDailyTokens);
      expect(used).toBe(mine.calls * PER_CALL);
      expect(mine.reservedTokens).toBe(0);
      expect(mine.reservedCalls).toBe(0);
    }
    expect(sum).toBe(global.inputTokens + global.outputTokens);
    expect(samples).toEqual([]);
    parent.close();
  }, 120_000);
});
