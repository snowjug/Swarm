import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { LedgerRefusal, UsageLedger, type LedgerLimits } from '../../src/public/storage/ledger.js';
import { migratePublic } from '../../src/public/storage/migrations.js';
import { migrate } from '../../src/storage/migrations.js';
import { openDatabase } from '../../src/storage/open.js';
import type { SqlDatabase } from '../../src/storage/sql.js';
import { asSystemView } from '../../src/storage/system-view.js';

/**
 * One competing user of the usage ledger, and the thread it runs on. Each has a connection of its own to the same
 * database, as two instances of the service would, and a gate releases them together (see `ledger-race.test.ts`).
 * `runRounds` is also called directly, in turn, for a database that has one connection in a process (PGlite).
 */
export interface RoundParams {
  workspaceId: string;
  rounds: number;
  /** Reservations held at once in a round, before any is settled: calls in flight. */
  holds: number;
  /** What each reservation holds, and what the call then really used. */
  held: number;
  used: { inputTokens: number; outputTokens: number; reasoningTokens: number };
}

export interface RoundResult {
  settled: number;
  refused: Record<string, number>;
  unexpected: string[];
}

export interface OpenedLedger {
  ledger: UsageLedger;
  close(): void;
}

export function openLedger(target: string, limits: LedgerLimits, at: number): OpenedLedger {
  const database: SqlDatabase = openDatabase(target);
  migrate(database, { path: target });
  migratePublic(database);
  return {
    ledger: new UsageLedger(asSystemView(database), limits, () => at),
    close: () => database.close(),
  };
}

export function runRounds(ledger: UsageLedger, params: RoundParams): RoundResult {
  const result: RoundResult = { settled: 0, refused: {}, unexpected: [] };
  for (let round = 0; round < params.rounds; round += 1) {
    const holding = [];
    for (let hold = 0; hold < params.holds; hold += 1) {
      try {
        holding.push(
          ledger.reserve({
            workspaceId: params.workspaceId,
            funding: 'free',
            tokens: params.held,
            microUsd: 10,
          }),
        );
      } catch (error) {
        if (error instanceof LedgerRefusal) {
          result.refused[error.reason] = (result.refused[error.reason] ?? 0) + 1;
        } else {
          result.unexpected.push(
            error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          );
        }
      }
    }
    for (const reservation of holding) {
      try {
        ledger.settle(reservation, { ...params.used, microUsd: 5 });
        result.settled += 1;
      } catch (error) {
        result.unexpected.push(
          error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        );
      }
    }
  }
  return result;
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  const { target, limits, at } = workerData as { target: string; limits: LedgerLimits; at: number };
  const opened = openLedger(target, limits, at);
  port.on(
    'message',
    (message: { type: string; params?: RoundParams; gate?: SharedArrayBuffer }) => {
      if (message.type === 'stop') {
        opened.close();
        port.close();
        return;
      }
      // Armed, then blocked until every writer is: they are released by one write to shared memory.
      port.postMessage({ type: 'armed' });
      Atomics.wait(new Int32Array(message.gate!), 0, 0);
      port.postMessage({ type: 'result', result: runRounds(opened.ledger, message.params!) });
    },
  );
  port.postMessage({ type: 'ready' });
}
