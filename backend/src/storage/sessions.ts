import type { SqlDatabase } from './sql.js';
import { z } from 'zod';
import { randomToken, sha256Hex } from '../auth/oidc.js';
import type { Principal } from '../auth/principal.js';

const LOGIN_TTL_MS = 10 * 60_000;
/** A session's last-seen time is written at most this often, so reading is not writing on every request. */
const TOUCH_EVERY_MS = 60_000;

const loginRow = z.object({
  binding_hash: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  return_to: z.string(),
  created_at: z.number(),
});

const sessionRow = z.object({
  principal_id: z.string(),
  tenant_id: z.string(),
  platform_admin: z.number(),
  bootstrap_admin: z.number(),
  created_at: z.number(),
  last_seen_at: z.number(),
  expires_at: z.number(),
});

export interface SessionInfo {
  /** When the session ends if nothing more happens. */
  idleExpiresAt: number;
  /** When it ends whatever happens. */
  expiresAt: number;
}

export interface LoginAttempt {
  nonce: string;
  verifier: string;
  returnTo: string;
}

/**
 * Server-side sign-in state. A session is a random identifier in an HttpOnly cookie; what is stored
 * is its hash, who it is for, and when it ends. No token from the identity provider is stored here
 * or anywhere else: signing in produces a session and nothing more.
 */
export class SessionStore {
  constructor(
    private readonly database: SqlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts a sign-in. The state and the browser binding are kept as hashes. */
  createLogin(input: {
    state: string;
    binding: string;
    nonce: string;
    verifier: string;
    returnTo: string;
  }): void {
    const at = this.now();
    this.database.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(at - LOGIN_TTL_MS);
    this.database
      .prepare(
        `INSERT INTO login_attempts (state_hash, binding_hash, nonce, verifier, return_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sha256Hex(input.state),
        sha256Hex(input.binding),
        input.nonce,
        input.verifier,
        input.returnTo,
        at,
      );
  }

  /**
   * Finishes a sign-in: the attempt is removed whether or not it matches, so a state can be tried
   * once. It must be the browser that started it, and recent.
   */
  consumeLogin(state: string, binding: string): LoginAttempt | null {
    const hash = sha256Hex(state);
    const raw = this.database
      .prepare(
        'SELECT binding_hash, nonce, verifier, return_to, created_at FROM login_attempts WHERE state_hash = ?',
      )
      .get(hash);
    if (!raw) return null;
    this.database.prepare('DELETE FROM login_attempts WHERE state_hash = ?').run(hash);
    const row = loginRow.parse(raw);
    if (row.binding_hash !== sha256Hex(binding)) return null;
    if (this.now() - row.created_at > LOGIN_TTL_MS) return null;
    return { nonce: row.nonce, verifier: row.verifier, returnTo: row.return_to };
  }

  /** A new session for a person, with a new identifier every time. */
  create(
    principal: Principal,
    lifetime: { idleMs: number; absoluteMs: number },
  ): { token: string; expiresAt: number; maxAgeSeconds: number } {
    const token = randomToken();
    const at = this.now();
    const expiresAt = at + lifetime.absoluteMs;
    this.database
      .prepare(
        `INSERT INTO sessions (id_hash, principal_id, tenant_id, platform_admin, bootstrap_admin, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sha256Hex(token),
        principal.id,
        principal.tenantId,
        principal.platformAdmin ? 1 : 0,
        principal.bootstrapAdmin ? 1 : 0,
        at,
        at,
        expiresAt,
      );
    return { token, expiresAt, maxAgeSeconds: Math.floor(lifetime.absoluteMs / 1000) };
  }

  /**
   * The person a session belongs to, or null when it is unknown, idle for too long, or past its end.
   * An ended session is deleted, and a live one is marked as seen.
   */
  find(token: string, idleMs: number): { principal: Principal; info: SessionInfo } | null {
    const hash = sha256Hex(token);
    const raw = this.database
      .prepare(
        `SELECT principal_id, tenant_id, platform_admin, bootstrap_admin, created_at, last_seen_at, expires_at
         FROM sessions WHERE id_hash = ?`,
      )
      .get(hash);
    if (!raw) return null;
    const row = sessionRow.parse(raw);
    const at = this.now();
    if (at >= row.expires_at || at - row.last_seen_at >= idleMs) {
      this.database.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash);
      return null;
    }
    let seen = row.last_seen_at;
    if (at - row.last_seen_at >= TOUCH_EVERY_MS) {
      this.database.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(at, hash);
      seen = at;
    }
    return {
      principal: {
        id: row.principal_id,
        tenantId: row.tenant_id,
        platformAdmin: row.platform_admin === 1,
        bootstrapAdmin: row.bootstrap_admin === 1,
      },
      info: { idleExpiresAt: Math.min(seen + idleMs, row.expires_at), expiresAt: row.expires_at },
    };
  }

  /** Ends one session. */
  revoke(token: string): boolean {
    return (
      Number(
        this.database.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256Hex(token))
          .changes,
      ) > 0
    );
  }

  /** Removes what has ended. Safe to call at any time. */
  purge(): void {
    const at = this.now();
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(at);
    this.database.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(at - LOGIN_TTL_MS);
  }
}
