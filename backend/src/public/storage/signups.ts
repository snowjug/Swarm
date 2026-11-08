import { createHmac, randomBytes } from 'node:crypto';
import type { SqlDatabase } from '../../storage/sql.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Account-creation throttling. An address is stored only as a keyed hash that changes every UTC day, so the table can
 * say "this address made five accounts today" and cannot say who it was, or link one day to the next. The table is
 * shared with the throttle on new guests (`GuestLog`), whose records have an identifier that begins `g_`; a sign-up's
 * begins `s_`, and only sign-ups are counted here.
 */
export class SignupLog {
  constructor(
    private readonly database: SqlDatabase,
    private readonly options: {
      pepper: string;
      perIpPerDay: number;
      perHour: number;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private hashOf(ip: string): string {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return createHmac('sha256', this.options.pepper).update(`${day}:${ip}`).digest('hex');
  }

  /** Whether another account may be made from this address now. */
  allows(ip: string): boolean {
    const at = this.now();
    const sameAddress = Number(
      this.database
        .prepare('SELECT COUNT(*) AS n FROM signup_log WHERE ip_hash = ? AND created_at > ?')
        .get(this.hashOf(ip), at - DAY_MS)?.n ?? 0,
    );
    if (sameAddress >= this.options.perIpPerDay) return false;
    const lastHour = Number(
      this.database
        .prepare(
          `SELECT COUNT(*) AS n FROM signup_log WHERE created_at > ? AND SUBSTR(id, 1, 2) <> 'g_'`,
        )
        .get(at - HOUR_MS)?.n ?? 0,
    );
    return lastHour < this.options.perHour;
  }

  record(ip: string): void {
    this.database
      .prepare('INSERT INTO signup_log (id, ip_hash, created_at) VALUES (?, ?, ?)')
      .run(`s_${randomBytes(12).toString('base64url')}`, this.hashOf(ip), this.now());
  }

  /** Forgets what is older than the longest window. */
  purge(): void {
    this.database
      .prepare('DELETE FROM signup_log WHERE created_at < ?')
      .run(this.now() - 2 * DAY_MS);
  }
}
