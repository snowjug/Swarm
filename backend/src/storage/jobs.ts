import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { SqlDatabase, SqlValue } from './sql.js';

/**
 * A job is one stage of one project, waiting to run, running, or finished. The table is the queue:
 * it survives a restart of any process, a worker takes a job by an atomic update that gives it a
 * lease, keeps the lease alive with heartbeats, and a job whose lease runs out is handed to someone
 * else. Nothing here knows what a stage does.
 *
 *   queued ──claim──▶ running ──▶ completed | partial
 *     ▲                 │  ├────▶ failed          (not retryable, or out of attempts)
 *     │                 │  ├────▶ retrying ──────▶ (claimed again after a delay)
 *     │                 │  ├────▶ paused          (a simulation stopped at a saved round)
 *     │                 │  └────▶ cancelling ────▶ cancelled
 *     └────── lease runs out while running: retrying, or failed when attempts are used up
 *   queued/retrying waiting too long: expired
 */
export const JOB_STATES = [
  'queued',
  'running',
  'paused',
  'cancelling',
  'cancelled',
  'completed',
  'partial',
  'retrying',
  'failed',
  'expired',
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** States in which a project has work in flight. A paused job is resumed by a new one. */
export const LIVE_STATES: readonly JobState[] = ['queued', 'running', 'retrying', 'cancelling'];
const WAITING: readonly JobState[] = ['queued', 'retrying'];
export const TERMINAL_STATES: readonly JobState[] = [
  'paused',
  'cancelled',
  'completed',
  'partial',
  'failed',
  'expired',
];

export type JobKind = 'quick' | 'knowledge' | 'environment' | 'simulation' | 'report';

export interface Job {
  id: string;
  projectId: string;
  kind: JobKind;
  /** For a simulation: continue from the last saved round instead of starting again. */
  resume: boolean;
  state: JobState;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  /** This is not the first go: an earlier attempt was cut off, or the job was handed back to the queue. */
  repeat: boolean;
  /** Not claimed before this time (epoch ms): the backoff of a retry. */
  notBefore: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  heartbeatAt: number | null;
  cancelRequested: boolean;
  pauseRequested: boolean;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

const row = z.object({
  id: z.string(),
  project_id: z.string(),
  kind: z.enum(['quick', 'knowledge', 'environment', 'simulation', 'report']),
  resume: z.number(),
  state: z.enum(JOB_STATES),
  idempotency_key: z.string(),
  attempt: z.number(),
  max_attempts: z.number(),
  not_before: z.number(),
  lease_owner: z.string().nullable(),
  lease_expires_at: z.number().nullable(),
  heartbeat_at: z.number().nullable(),
  cancel_requested: z.number(),
  pause_requested: z.number(),
  error_code: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  finished_at: z.number().nullable(),
});

const toJob = (raw: unknown): Job => {
  const value = row.parse(raw);
  return {
    id: value.id,
    projectId: value.project_id,
    kind: value.kind,
    resume: value.resume === 1,
    state: value.state,
    idempotencyKey: value.idempotency_key,
    attempt: value.attempt,
    maxAttempts: value.max_attempts,
    repeat: value.attempt > 1 || value.error_code === 'JOB_RELEASED',
    notBefore: value.not_before,
    leaseOwner: value.lease_owner,
    leaseExpiresAt: value.lease_expires_at,
    heartbeatAt: value.heartbeat_at,
    cancelRequested: value.cancel_requested === 1,
    pauseRequested: value.pause_requested === 1,
    errorCode: value.error_code,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    finishedAt: value.finished_at,
  };
};

const inList = (states: readonly JobState[]): string => states.map((s) => `'${s}'`).join(', ');

export const RETRY_BASE_MS = 15_000;
export const RETRY_CAP_MS = 5 * 60_000;

/** Wait before attempt n+1: doubling from the base, capped, and spread so that retries do not arrive together. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const full = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(full / 2 + (random() * full) / 2);
}

export type FailureOutcome = 'retrying' | 'failed';

/**
 * The job whose work is running in this async context. While it is set, the repository refuses a write
 * unless that job still holds its lease, so a worker that lost its lease (it stalled, and the job was handed
 * on) cannot write a stale result over the new holder's.
 */
export interface JobLease {
  jobId: string;
  owner: string;
}
export const jobLease = new AsyncLocalStorage<JobLease>();

/**
 * The condition that the worker `?` (second parameter) holds the lease of the job `?` (first): true
 * only while the job is running or being cancelled and is leased to that worker. It is part of the
 * statement that writes the worker's result, so the check and the write cannot be pulled apart.
 */
export const LEASE_HELD = `EXISTS (SELECT 1 FROM jobs WHERE id = ? AND lease_owner = ? AND state IN ('running', 'cancelling'))`;

export class JobStore {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transaction: <T>(operation: () => T) => T,
    private readonly now: () => number = Date.now,
    /** How long a failed attempt waits before the next: by default doubling, capped and spread. */
    private readonly retryDelayMs: (attempt: number) => number = (attempt) => backoffMs(attempt),
  ) {}

  private select(where: string, ...parameters: SqlValue[]): Job[] {
    return this.database
      .prepare(`SELECT * FROM jobs WHERE ${where}`)
      .all(...parameters)
      .map(toJob);
  }

  get(id: string): Job | null {
    return this.select('id = ?', id)[0] ?? null;
  }

  /** The job a project already has for this idempotency key, if any. */
  byIdempotencyKey(projectId: string, key: string): Job | null {
    return this.select('project_id = ? AND idempotency_key = ?', projectId, key)[0] ?? null;
  }

  /** True while owner holds the lease of this job: the only time its work may be written down. */
  holds(id: string, owner: string): boolean {
    return (
      this.database.prepare(`SELECT 1 AS held WHERE ${LEASE_HELD}`).get(id, owner) !== undefined
    );
  }

  /**
   * Queues a job, unless this project already has one with the same idempotency key, in which case
   * that one is returned: asking twice for the same thing is one job.
   */
  enqueue(input: {
    id: string;
    projectId: string;
    kind: JobKind;
    resume?: boolean;
    idempotencyKey: string;
    maxAttempts?: number;
  }): { job: Job; duplicate: boolean } {
    return this.transaction(() => {
      const existing = this.select(
        'project_id = ? AND idempotency_key = ?',
        input.projectId,
        input.idempotencyKey,
      )[0];
      if (existing) return { job: existing, duplicate: true };
      const at = this.now();
      this.database
        .prepare(
          `INSERT INTO jobs (id, project_id, kind, resume, state, idempotency_key, attempt, max_attempts,
                             not_before, cancel_requested, pause_requested, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?, 0, 0, ?, ?)`,
        )
        .run(
          input.id,
          input.projectId,
          input.kind,
          input.resume ? 1 : 0,
          input.idempotencyKey,
          input.maxAttempts ?? 3,
          at,
          at,
          at,
        );
      return { job: this.get(input.id)!, duplicate: false };
    });
  }

  /** The newest jobs of a project, newest first. */
  recent(projectId: string, limit = 10): Job[] {
    return this.database
      .prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC, id LIMIT ?')
      .all(projectId, limit)
      .map(toJob);
  }

  /** The job that has this project's work in flight, if any. */
  live(projectId: string): Job | null {
    return (
      this.database
        .prepare(
          `SELECT * FROM jobs WHERE project_id = ? AND state IN (${inList(LIVE_STATES)})
           ORDER BY created_at DESC LIMIT 1`,
        )
        .all(projectId)
        .map(toJob)[0] ?? null
    );
  }

  /** Projects that have a job in flight. */
  liveProjectIds(): string[] {
    return this.database
      .prepare(`SELECT DISTINCT project_id FROM jobs WHERE state IN (${inList(LIVE_STATES)})`)
      .all()
      .map((raw) => z.object({ project_id: z.string() }).parse(raw).project_id);
  }

  /** Jobs that are waiting to run, now or after a retry delay. */
  waiting(): number {
    const found = this.database
      .prepare(`SELECT COUNT(*) AS count FROM jobs WHERE state IN (${inList(WAITING)})`)
      .get();
    return Number(found?.count ?? 0);
  }

  counts(): Record<JobState, number> {
    const counts = Object.fromEntries(JOB_STATES.map((state) => [state, 0])) as Record<
      JobState,
      number
    >;
    for (const raw of this.database
      .prepare('SELECT state, COUNT(*) AS count FROM jobs GROUP BY state')
      .all()) {
      const { state, count } = z
        .object({ state: z.enum(JOB_STATES), count: z.number() })
        .parse(raw);
      counts[state] = count;
    }
    return counts;
  }

  /** How long the oldest waiting job has waited, in milliseconds; null when nothing waits. */
  oldestWaitingMs(): number | null {
    const found = this.database
      .prepare(`SELECT MIN(created_at) AS oldest FROM jobs WHERE state IN (${inList(WAITING)})`)
      .get();
    const oldest = found?.oldest;
    return typeof oldest === 'number' ? Math.max(0, this.now() - oldest) : null;
  }

  /** True when a job is due now, so that a worker looking for work knows whether to try. */
  hasDue(): boolean {
    return (
      this.database
        .prepare(
          `SELECT 1 AS due FROM jobs WHERE state IN (${inList(WAITING)}) AND not_before <= ? LIMIT 1`,
        )
        .get(this.now()) !== undefined
    );
  }

  /**
   * Takes the next job that is due, for `owner`, for `leaseMs`. The take is one update, in a
   * transaction, so two workers can never hold the same job.
   */
  claim(owner: string, leaseMs: number): Job | null {
    // Look before locking: most polls find nothing, and those need not take a write lock.
    if (!this.hasDue()) return null;
    return this.transaction(() => {
      const at = this.now();
      const taken = this.database
        .prepare(
          `UPDATE jobs SET state = 'running', lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?,
                           attempt = attempt + 1, updated_at = ?
           WHERE id = (SELECT id FROM jobs WHERE state IN (${inList(WAITING)}) AND not_before <= ?
                       ORDER BY not_before, created_at, id LIMIT 1)
             AND state IN (${inList(WAITING)})
           RETURNING id`,
        )
        .get(owner, at + leaseMs, at, at, at);
      const id = z.object({ id: z.string() }).safeParse(taken);
      return id.success ? this.get(id.data.id) : null;
    });
  }

  /**
   * Extends a lease. `lost` means someone else holds the job now (or it ended), and the caller must
   * stop at once and write nothing more for it; otherwise it learns whether a stop was asked for.
   */
  heartbeat(
    id: string,
    owner: string,
    leaseMs: number,
  ): { lost: true } | { lost: false; cancel: boolean; pause: boolean } {
    const at = this.now();
    const found = this.database
      .prepare(
        `UPDATE jobs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND lease_owner = ? AND state IN ('running', 'cancelling')
         RETURNING cancel_requested, pause_requested`,
      )
      .get(at, at + leaseMs, at, id, owner);
    const parsed = z
      .object({ cancel_requested: z.number(), pause_requested: z.number() })
      .safeParse(found);
    return parsed.success
      ? {
          lost: false,
          cancel: parsed.data.cancel_requested === 1,
          pause: parsed.data.pause_requested === 1,
        }
      : { lost: true };
  }

  private finish(id: string, owner: string, state: JobState, errorCode: string | null): boolean {
    const at = this.now();
    const result = this.database
      .prepare(
        `UPDATE jobs SET state = ?, error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
                         finished_at = ?, updated_at = ?
         WHERE id = ? AND lease_owner = ? AND state IN ('running', 'cancelling')`,
      )
      .run(state, errorCode, at, at, id, owner);
    return Number(result.changes) > 0;
  }

  /** The holder finished the work. False when the lease was already lost, so the result is not theirs to record. */
  complete(id: string, owner: string, state: 'completed' | 'partial' = 'completed'): boolean {
    return this.finish(id, owner, state, null);
  }

  /**
   * The holder stopped, and says why: a cancellation, a pause at a saved round, or a failure that
   * left saved rounds behind (`partial`: some work is kept and the stage can be resumed).
   */
  settle(
    id: string,
    owner: string,
    state: 'cancelled' | 'paused' | 'partial',
    code: string,
  ): boolean {
    return this.finish(id, owner, state, code);
  }

  /**
   * The holder is stopping for a reason that is not the job's fault (the backend is shutting down):
   * the job goes back to the queue at once, and the attempt does not count against its budget.
   */
  release(id: string, owner: string): boolean {
    const at = this.now();
    const result = this.database
      .prepare(
        `UPDATE jobs SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL,
                         attempt = CASE WHEN attempt > 0 THEN attempt - 1 ELSE 0 END,
                         not_before = ?, error_code = 'JOB_RELEASED', updated_at = ?
         WHERE id = ? AND lease_owner = ? AND state = 'running'`,
      )
      .run(at, at, id, owner);
    return Number(result.changes) > 0;
  }

  /**
   * The holder failed. A failure that may pass (and that has attempts left) becomes a retry after a
   * delay; anything else ends the job. Null when the lease was already lost.
   */
  fail(id: string, owner: string, code: string, retryable: boolean): FailureOutcome | null {
    return this.transaction(() => {
      const job = this.get(id);
      if (!job || job.leaseOwner !== owner || !['running', 'cancelling'].includes(job.state)) {
        return null;
      }
      if (retryable && job.attempt < job.maxAttempts) {
        const at = this.now();
        this.database
          .prepare(
            `UPDATE jobs SET state = 'retrying', error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
                             not_before = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(code, at + this.retryDelayMs(job.attempt), at, id);
        return 'retrying';
      }
      return this.finish(id, owner, 'failed', code) ? 'failed' : null;
    });
  }

  /**
   * Asks for a job to stop. Work that has not started ends at once; work that is running is told
   * through its next heartbeat. Null when there is nothing to cancel.
   */
  requestCancel(id: string): Job | null {
    return this.transaction(() => {
      const job = this.get(id);
      if (!job) return null;
      const at = this.now();
      if (WAITING.includes(job.state) || job.state === 'paused') {
        this.database
          .prepare(
            `UPDATE jobs SET state = 'cancelled', error_code = 'RUN_CANCELLED', finished_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(at, at, id);
      } else if (job.state === 'running') {
        this.database
          .prepare(
            `UPDATE jobs SET state = 'cancelling', cancel_requested = 1, updated_at = ? WHERE id = ?`,
          )
          .run(at, id);
      } else if (job.state !== 'cancelling') {
        return null;
      }
      return this.get(id);
    });
  }

  /** Asks a simulation to stop at its last saved round. Work that has not started is set aside at once. */
  requestPause(id: string): Job | null {
    return this.transaction(() => {
      const job = this.get(id);
      if (!job) return null;
      const at = this.now();
      if (WAITING.includes(job.state)) {
        this.database
          .prepare(
            `UPDATE jobs SET state = 'paused', error_code = 'RUN_PAUSED', finished_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(at, at, id);
      } else if (job.state === 'running') {
        this.database
          .prepare(`UPDATE jobs SET pause_requested = 1, updated_at = ? WHERE id = ?`)
          .run(at, id);
      } else {
        return null;
      }
      return this.get(id);
    });
  }

  /**
   * Hands back the jobs of workers that stopped heartbeating. A job that was being cancelled is
   * cancelled; one with attempts left is retried after a delay; one that has used them all is
   * failed, so a job that kills its worker every time cannot loop forever.
   */
  reap(): { job: Job; outcome: 'retrying' | 'failed' | 'cancelled' }[] {
    return this.transaction(() => {
      const at = this.now();
      const reaped: { job: Job; outcome: 'retrying' | 'failed' | 'cancelled' }[] = [];
      for (const job of this.select(
        `state IN ('running', 'cancelling') AND lease_expires_at < ?`,
        at,
      )) {
        if (job.state === 'cancelling') {
          this.database
            .prepare(
              `UPDATE jobs SET state = 'cancelled', error_code = 'RUN_CANCELLED', lease_owner = NULL,
                               lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?`,
            )
            .run(at, at, job.id);
          reaped.push({ job: this.get(job.id)!, outcome: 'cancelled' });
        } else if (job.attempt >= job.maxAttempts) {
          // A job allowed one attempt was never meant to be repeated; one allowed several that has
          // taken its workers down every time is poison, and is set aside rather than tried again.
          this.database
            .prepare(
              `UPDATE jobs SET state = 'failed', error_code = ?, lease_owner = NULL,
                               lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?`,
            )
            .run(job.maxAttempts > 1 ? 'JOB_POISONED' : 'JOB_INTERRUPTED', at, at, job.id);
          reaped.push({ job: this.get(job.id)!, outcome: 'failed' });
        } else {
          this.database
            .prepare(
              `UPDATE jobs SET state = 'retrying', error_code = 'LEASE_EXPIRED', lease_owner = NULL,
                               lease_expires_at = NULL, not_before = ?, updated_at = ? WHERE id = ?`,
            )
            .run(at + this.retryDelayMs(job.attempt), at, job.id);
          reaped.push({ job: this.get(job.id)!, outcome: 'retrying' });
        }
      }
      return reaped;
    });
  }

  /** Ends jobs that have waited longer than `ttlMs`, so that a queue nobody serves does not run old work later. */
  expireStale(ttlMs: number): Job[] {
    return this.transaction(() => {
      const at = this.now();
      const stale = this.select(`state IN (${inList(WAITING)}) AND created_at < ?`, at - ttlMs);
      for (const job of stale) {
        this.database
          .prepare(
            `UPDATE jobs SET state = 'expired', error_code = 'JOB_EXPIRED', finished_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(at, at, job.id);
      }
      return stale.map((job) => this.get(job.id)!);
    });
  }

  /** Removes finished jobs older than `olderThanMs`. */
  purge(olderThanMs: number): number {
    const result = this.database
      .prepare(`DELETE FROM jobs WHERE state IN (${inList(TERMINAL_STATES)}) AND finished_at < ?`)
      .run(this.now() - olderThanMs);
    return Number(result.changes);
  }
}
