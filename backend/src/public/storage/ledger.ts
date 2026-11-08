import { randomBytes } from 'node:crypto';
import type { FreeTierReason, Funding } from '../../../../shared/public.js';
import type { SqlDatabase } from '../../storage/sql.js';

/**
 * The usage ledger of the public edition (docs/public/DESIGN.md, section 6). It counts model calls and tokens (hidden
 * reasoning tokens included) per person per day, per person for life, and for the whole free tier per day, and it
 * **reserves before a call and settles after it**: every cap is checked by a conditional `UPDATE` in the same
 * transaction that reserves, so the check and the reservation are one atomic statement that concurrent requests, in this
 * process or in another, cannot pass together.
 *
 * Subjects: `u:<workspace>` is a person on the free tier, `b:<workspace>` what a person did on their own key (counted so
 * that they can see it, and never against any cap but their own concurrency), `global` is the free tier as a whole.
 */

export interface LedgerLimits {
  userDailyTokens: number;
  userDailyCalls: number;
  userLifetimeTokens: number;
  /** Round trips in flight at once, for one person on the free tier. */
  userConcurrentCalls: number;
  globalDailyTokens: number;
  /** In millionths of a dollar. */
  globalDailyMicroUsd: number;
  /** Round trips in flight at once, for one person on their own key. */
  byokConcurrentCalls: number;
}

/** What a guest is held to instead of a signed-in person's four limits. The global caps are everyone's. */
export type GuestLimits = Pick<
  LedgerLimits,
  'userDailyTokens' | 'userDailyCalls' | 'userLifetimeTokens' | 'userConcurrentCalls'
>;

export interface GuestPolicy {
  /** Whether the workspace is a guest's. */
  isGuest(workspaceId: string): boolean;
  limits: GuestLimits;
}

/** Why a reservation was refused. The reason is one of the states a person is shown. */
export class LedgerRefusal extends Error {
  constructor(readonly reason: FreeTierReason | 'byok-concurrent') {
    super(`Reservation refused: ${reason}.`);
    this.name = 'LedgerRefusal';
  }
}

export interface Reservation {
  id: string;
  day: string;
  workspaceId: string;
  funding: Funding;
  tokens: number;
  microUsd: number;
}

export interface Use {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  microUsd: number;
}

export interface DayRow {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  reservedTokens: number;
  reservedCalls: number;
  microUsd: number;
}

const EMPTY: DayRow = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  reservedTokens: 0,
  reservedCalls: 0,
  microUsd: 0,
};

const num = (value: unknown): number => Number(value ?? 0);
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

export class UsageLedger {
  constructor(
    private readonly database: SqlDatabase,
    private readonly limits: LedgerLimits,
    private readonly now: () => number = Date.now,
    /** Absent: everyone is held to `limits`, which is what a deployment without guests does. */
    private readonly guests: GuestPolicy | null = null,
  ) {}

  /** The limits that apply to this workspace: a guest's, or the signed-in person's. */
  limitsFor(workspaceId: string): LedgerLimits {
    return this.guests?.isGuest(workspaceId)
      ? { ...this.limits, ...this.guests.limits }
      : this.limits;
  }

  today(): string {
    return dayOf(this.now());
  }

  private atomic<T>(operation: () => T): T {
    return this.database.inTransaction ? operation() : this.database.transaction(operation);
  }

  private ensureDay(day: string, subject: string): void {
    this.database
      .prepare(
        'INSERT INTO usage_daily (day, subject) VALUES (?, ?) ON CONFLICT (day, subject) DO NOTHING',
      )
      .run(day, subject);
  }

  /**
   * Reserves the worst case of a call, or throws `LedgerRefusal`. For the free tier the person's day, the person's life
   * and the whole day are each checked and reserved in the one transaction; for a person's own key only their
   * concurrency is. A refusal leaves nothing reserved.
   */
  reserve(input: {
    workspaceId: string;
    funding: Funding;
    tokens: number;
    microUsd: number;
  }): Reservation {
    const at = this.now();
    const day = dayOf(at);
    const tokens = Math.max(0, Math.trunc(input.tokens));
    const microUsd = Math.max(0, Math.round(input.microUsd));
    const id = randomBytes(12).toString('base64url');
    try {
      this.atomic(() =>
        this.reserveRows(input.workspaceId, input.funding, day, tokens, microUsd, id, at),
      );
    } catch (error) {
      if (error instanceof LedgerRefusal) this.recordBlocked(error.reason);
      throw error;
    }
    return { id, day, workspaceId: input.workspaceId, funding: input.funding, tokens, microUsd };
  }

  private reserveRows(
    workspaceId: string,
    funding: Funding,
    day: string,
    tokens: number,
    microUsd: number,
    id: string,
    at: number,
  ): void {
    const L = this.limitsFor(workspaceId);
    const db = this.database;
    const own = funding === 'free' ? `u:${workspaceId}` : `b:${workspaceId}`;
    this.ensureDay(day, own);
    if (funding === 'byok') {
      const held = db
        .prepare(
          `UPDATE usage_daily SET reserved_calls = reserved_calls + 1, reserved_tokens = reserved_tokens + ?
            WHERE day = ? AND subject = ? AND reserved_calls + 1 <= ?`,
        )
        .run(tokens, day, own, L.byokConcurrentCalls);
      if (Number(held.changes) === 0) throw new LedgerRefusal('byok-concurrent');
    } else {
      this.ensureDay(day, 'global');
      db.prepare(
        'INSERT INTO usage_lifetime (subject, updated_at) VALUES (?, ?) ON CONFLICT (subject) DO NOTHING',
      ).run(own, at);
      const mine = db
        .prepare(
          `UPDATE usage_daily
              SET reserved_tokens = reserved_tokens + ?, reserved_micro_usd = reserved_micro_usd + ?, reserved_calls = reserved_calls + 1
            WHERE day = ? AND subject = ?
              AND input_tokens + output_tokens + reserved_tokens + ? <= ?
              AND calls + reserved_calls + 1 <= ?
              AND reserved_calls + 1 <= ?`,
        )
        .run(
          tokens,
          microUsd,
          day,
          own,
          tokens,
          L.userDailyTokens,
          L.userDailyCalls,
          L.userConcurrentCalls,
        );
      if (Number(mine.changes) === 0) {
        const row = db
          .prepare('SELECT reserved_calls FROM usage_daily WHERE day = ? AND subject = ?')
          .get(day, own);
        throw new LedgerRefusal(
          num(row?.reserved_calls) + 1 > L.userConcurrentCalls ? 'concurrent' : 'user-cap',
        );
      }
      const life = db
        .prepare(
          `UPDATE usage_lifetime SET reserved_tokens = reserved_tokens + ?, updated_at = ?
            WHERE subject = ? AND tokens + reserved_tokens + ? <= ?`,
        )
        .run(tokens, at, own, tokens, L.userLifetimeTokens);
      if (Number(life.changes) === 0) throw new LedgerRefusal('lifetime-cap');
      const everyone = db
        .prepare(
          `UPDATE usage_daily
              SET reserved_tokens = reserved_tokens + ?, reserved_micro_usd = reserved_micro_usd + ?, reserved_calls = reserved_calls + 1
            WHERE day = ? AND subject = 'global'
              AND input_tokens + output_tokens + reserved_tokens + ? <= ?
              AND cost_micro_usd + reserved_micro_usd + ? <= ?`,
        )
        .run(tokens, microUsd, day, tokens, L.globalDailyTokens, microUsd, L.globalDailyMicroUsd);
      if (Number(everyone.changes) === 0) throw new LedgerRefusal('global-cap');
    }
    db.prepare(
      'INSERT INTO usage_reservations (id, day, subject, tokens, micro_usd, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, day, own, tokens, microUsd, at);
  }

  /** Takes back what a reservation held and adds what was used. Once: a reservation already settled is not settled again. */
  settle(reservation: Reservation, use: Use): void {
    this.finish(reservation, use);
  }

  /** Takes back what a reservation held and adds nothing: the call never used anything. */
  release(reservation: Reservation): void {
    this.finish(reservation, null);
  }

  private finish(reservation: Reservation, use: Use | null): void {
    const at = this.now();
    this.atomic(() => {
      const db = this.database;
      const taken = db.prepare('DELETE FROM usage_reservations WHERE id = ?').run(reservation.id);
      if (Number(taken.changes) === 0) return;
      const own =
        reservation.funding === 'free'
          ? `u:${reservation.workspaceId}`
          : `b:${reservation.workspaceId}`;
      const input = use ? Math.max(0, Math.trunc(use.inputTokens)) : 0;
      const output = use ? Math.max(0, Math.trunc(use.outputTokens)) : 0;
      const reasoning = use?.reasoningTokens ? Math.max(0, Math.trunc(use.reasoningTokens)) : 0;
      const micro = use ? Math.max(0, Math.round(use.microUsd)) : 0;
      const counted = use ? 1 : 0;
      const subjects = reservation.funding === 'free' ? [own, 'global'] : [own];
      for (const subject of subjects) {
        db.prepare(
          `UPDATE usage_daily SET
             reserved_tokens = CASE WHEN reserved_tokens >= ? THEN reserved_tokens - ? ELSE 0 END,
             reserved_micro_usd = CASE WHEN reserved_micro_usd >= ? THEN reserved_micro_usd - ? ELSE 0 END,
             reserved_calls = CASE WHEN reserved_calls >= 1 THEN reserved_calls - 1 ELSE 0 END,
             calls = calls + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
             reasoning_tokens = reasoning_tokens + ?, cost_micro_usd = cost_micro_usd + ?
           WHERE day = ? AND subject = ?`,
        ).run(
          reservation.tokens,
          reservation.tokens,
          reservation.microUsd,
          reservation.microUsd,
          counted,
          input,
          output,
          reasoning,
          micro,
          reservation.day,
          subject,
        );
      }
      if (reservation.funding === 'free') {
        db.prepare(
          `UPDATE usage_lifetime SET
             reserved_tokens = CASE WHEN reserved_tokens >= ? THEN reserved_tokens - ? ELSE 0 END,
             tokens = tokens + ?, calls = calls + ?, updated_at = ?
           WHERE subject = ?`,
        ).run(reservation.tokens, reservation.tokens, input + output, counted, at, own);
      }
    });
  }

  /** Gives back what a reservation that nobody settled still holds, such as one a crashed process left. */
  sweep(olderThanMs: number): number {
    const stale = this.database
      .prepare(
        'SELECT id, day, subject, tokens, micro_usd FROM usage_reservations WHERE created_at < ?',
      )
      .all(this.now() - olderThanMs);
    for (const row of stale) {
      const subject = String(row.subject);
      this.release({
        id: String(row.id),
        day: String(row.day),
        workspaceId: subject.slice(2),
        funding: subject.startsWith('b:') ? 'byok' : 'free',
        tokens: num(row.tokens),
        microUsd: num(row.micro_usd),
      });
    }
    return stale.length;
  }

  private row(day: string, subject: string): DayRow {
    const found = this.database
      .prepare(
        `SELECT calls, input_tokens, output_tokens, reasoning_tokens, reserved_tokens, reserved_calls, cost_micro_usd
           FROM usage_daily WHERE day = ? AND subject = ?`,
      )
      .get(day, subject);
    if (!found) return { ...EMPTY };
    return {
      calls: num(found.calls),
      inputTokens: num(found.input_tokens),
      outputTokens: num(found.output_tokens),
      reasoningTokens: num(found.reasoning_tokens),
      reservedTokens: num(found.reserved_tokens),
      reservedCalls: num(found.reserved_calls),
      microUsd: num(found.cost_micro_usd),
    };
  }

  /** What a person has used today on the free tier, on their own key, and in all on the free tier. */
  userState(workspaceId: string): {
    free: DayRow;
    byok: DayRow;
    lifetimeTokens: number;
    lifetimeReserved: number;
  } {
    const day = this.today();
    const life = this.database
      .prepare('SELECT tokens, reserved_tokens FROM usage_lifetime WHERE subject = ?')
      .get(`u:${workspaceId}`);
    return {
      free: this.row(day, `u:${workspaceId}`),
      byok: this.row(day, `b:${workspaceId}`),
      lifetimeTokens: num(life?.tokens),
      lifetimeReserved: num(life?.reserved_tokens),
    };
  }

  /** What the whole free tier has used today. */
  globalState(): DayRow {
    return this.row(this.today(), 'global');
  }

  /**
   * Why the free tier cannot be used right now by this person (or by anyone, with no person), as a state to show, or
   * null. The checks the reservation makes, read without reserving anything. A token cap counts as reached when less
   * than `minTokens` is left of it (what one run is taken to cost), so that the state to show and the meter agree.
   */
  freeReason(workspaceId?: string, minTokens = 0): FreeTierReason | null {
    const L = workspaceId ? this.limitsFor(workspaceId) : this.limits;
    const all = this.globalState();
    const least = Math.max(1, minTokens);
    if (
      L.globalDailyTokens - (all.inputTokens + all.outputTokens + all.reservedTokens) < least ||
      all.microUsd >= L.globalDailyMicroUsd
    ) {
      return 'global-cap';
    }
    if (!workspaceId) return null;
    const mine = this.userState(workspaceId);
    if (L.userLifetimeTokens - (mine.lifetimeTokens + mine.lifetimeReserved) < least) {
      return 'lifetime-cap';
    }
    const used = mine.free.inputTokens + mine.free.outputTokens + mine.free.reservedTokens;
    if (
      L.userDailyTokens - used < least ||
      mine.free.calls + mine.free.reservedCalls >= L.userDailyCalls
    ) {
      return 'user-cap';
    }
    if (mine.free.reservedCalls >= L.userConcurrentCalls) return 'concurrent';
    return null;
  }

  /** Counts a refusal, by day and reason, for the administrator's view. */
  recordBlocked(reason: string): void {
    try {
      this.database
        .prepare(
          `INSERT INTO usage_blocked (day, reason, count) VALUES (?, ?, 1)
           ON CONFLICT (day, reason) DO UPDATE SET count = usage_blocked.count + 1`,
        )
        .run(this.today(), reason);
    } catch {
      // Counting a refusal never turns the refusal into a failure.
    }
  }

  /** The free tier's own days, newest first, and the refusals of each. */
  days(count: number): {
    day: string;
    calls: number;
    tokens: number;
    reasoningTokens: number;
    microUsd: number;
    blocked: number;
  }[] {
    const since = dayOf(this.now() - (count - 1) * 86_400_000);
    const blocked = new Map<string, number>();
    for (const row of this.database
      .prepare(
        'SELECT day, CAST(SUM(count) AS BIGINT) AS n FROM usage_blocked WHERE day >= ? GROUP BY day',
      )
      .all(since)) {
      blocked.set(String(row.day), num(row.n));
    }
    return this.database
      .prepare(
        `SELECT day, calls, input_tokens, output_tokens, reasoning_tokens, cost_micro_usd
           FROM usage_daily WHERE subject = 'global' AND day >= ? ORDER BY day DESC`,
      )
      .all(since)
      .map((row) => ({
        day: String(row.day),
        calls: num(row.calls),
        tokens: num(row.input_tokens) + num(row.output_tokens),
        reasoningTokens: num(row.reasoning_tokens),
        microUsd: num(row.cost_micro_usd),
        blocked: blocked.get(String(row.day)) ?? 0,
      }));
  }

  /** The people who used the most tokens in the last `count` days, as workspace ids. */
  topWorkspaces(
    days: number,
    limit: number,
  ): { workspaceId: string; tokens: number; calls: number }[] {
    const since = dayOf(this.now() - (days - 1) * 86_400_000);
    return this.database
      .prepare(
        `SELECT subject, CAST(SUM(input_tokens + output_tokens) AS BIGINT) AS tokens, CAST(SUM(calls) AS BIGINT) AS calls
           FROM usage_daily WHERE subject LIKE 'u:%' AND day >= ?
          GROUP BY subject ORDER BY tokens DESC LIMIT ?`,
      )
      .all(since, limit)
      .map((row) => ({
        workspaceId: String(row.subject).slice(2),
        tokens: num(row.tokens),
        calls: num(row.calls),
      }));
  }

  blockedByReason(days: number): Record<string, number> {
    const since = dayOf(this.now() - (days - 1) * 86_400_000);
    const result: Record<string, number> = {};
    for (const row of this.database
      .prepare(
        'SELECT reason, CAST(SUM(count) AS BIGINT) AS n FROM usage_blocked WHERE day >= ? GROUP BY reason',
      )
      .all(since)) {
      result[String(row.reason)] = num(row.n);
    }
    return result;
  }

  /** Forgets the days older than the longest view. */
  prune(keepDays = 120): void {
    const cutoff = dayOf(this.now() - keepDays * 86_400_000);
    this.database.prepare('DELETE FROM usage_daily WHERE day < ?').run(cutoff);
    this.database.prepare('DELETE FROM usage_blocked WHERE day < ?').run(cutoff);
  }
}
