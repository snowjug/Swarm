import { createHmac, randomBytes } from 'node:crypto';
import type { SqlDatabase } from '../../storage/sql.js';

const HOUR_MS = 3_600_000;
/** The prefix of a record of a guest in `signup_log` (`s_` is a sign-up), so that the two are counted apart. */
export const GUEST_ID_PREFIX = 'g_';

/**
 * The throttle on new guests. It shares `signup_log` with `SignupLog` (a record there is a keyed hash of an address that
 * changes every UTC day, and a time) and keeps itself apart by the prefix of the record's identifier and by what is hashed.
 * It says "this address made ten guests in the last hour" and cannot say who it was.
 */
export class GuestLog {
  constructor(
    private readonly database: SqlDatabase,
    private readonly options: {
      pepper: string;
      perIpPerHour: number;
      perHour: number;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private hashOf(ip: string): string {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return createHmac('sha256', this.options.pepper).update(`guest:${day}:${ip}`).digest('hex');
  }

  /** Whether another guest may be made from this address now: this address, and everyone together, within the hour. */
  allows(ip: string): boolean {
    const since = this.now() - HOUR_MS;
    const sameAddress = Number(
      this.database
        .prepare(
          'SELECT COUNT(*) AS n FROM signup_log WHERE ip_hash = ? AND created_at > ? AND SUBSTR(id, 1, 2) = ?',
        )
        .get(this.hashOf(ip), since, GUEST_ID_PREFIX)?.n ?? 0,
    );
    if (sameAddress >= this.options.perIpPerHour) return false;
    const everyone = Number(
      this.database
        .prepare(
          'SELECT COUNT(*) AS n FROM signup_log WHERE created_at > ? AND SUBSTR(id, 1, 2) = ?',
        )
        .get(since, GUEST_ID_PREFIX)?.n ?? 0,
    );
    return everyone < this.options.perHour;
  }

  record(ip: string): void {
    this.database
      .prepare('INSERT INTO signup_log (id, ip_hash, created_at) VALUES (?, ?, ?)')
      .run(
        `${GUEST_ID_PREFIX}${randomBytes(12).toString('base64url')}`,
        this.hashOf(ip),
        this.now(),
      );
  }
}
