import { z } from 'zod';
import { sha256Hex } from '../../auth/oidc.js';
import type { SqlDatabase } from '../../storage/sql.js';
import type { PublicProviderId } from '../../../../shared/public.js';

const LOGIN_TTL_MS = 10 * 60_000;

const attemptRow = z.object({
  binding_hash: z.string(),
  provider: z.enum(['google', 'github']),
  nonce: z.string(),
  verifier: z.string(),
  return_to: z.string(),
  created_at: z.coerce.number(),
});

export interface PublicLoginAttempt {
  provider: PublicProviderId;
  nonce: string;
  verifier: string;
  returnTo: string;
}

/**
 * Sign-ins in flight. What identifies one (the state and the browser binding) is kept as a hash; the nonce and the
 * verifier have to be read again, so they are kept for the ten minutes an attempt lives and removed on first use.
 */
export class PublicLoginStore {
  constructor(
    private readonly database: SqlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: {
    state: string;
    binding: string;
    provider: PublicProviderId;
    nonce: string;
    verifier: string;
    returnTo: string;
  }): void {
    const at = this.now();
    this.database
      .prepare('DELETE FROM public_login_attempts WHERE created_at < ?')
      .run(at - LOGIN_TTL_MS);
    this.database
      .prepare(
        `INSERT INTO public_login_attempts (state_hash, binding_hash, provider, nonce, verifier, return_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sha256Hex(input.state),
        sha256Hex(input.binding),
        input.provider,
        input.nonce,
        input.verifier,
        input.returnTo,
        at,
      );
  }

  /**
   * Finishes a sign-in. The attempt is removed whether or not it matches, so that a state can be tried once. It must be
   * the browser that started it, recent, and for the provider that the reply came from.
   */
  consume(state: string, binding: string, provider: PublicProviderId): PublicLoginAttempt | null {
    const hash = sha256Hex(state);
    const raw = this.database
      .prepare(
        `SELECT binding_hash, provider, nonce, verifier, return_to, created_at
           FROM public_login_attempts WHERE state_hash = ?`,
      )
      .get(hash);
    if (!raw) return null;
    this.database.prepare('DELETE FROM public_login_attempts WHERE state_hash = ?').run(hash);
    const row = attemptRow.parse(raw);
    if (row.binding_hash !== sha256Hex(binding)) return null;
    if (row.provider !== provider) return null;
    if (this.now() - row.created_at > LOGIN_TTL_MS) return null;
    return {
      provider: row.provider,
      nonce: row.nonce,
      verifier: row.verifier,
      returnTo: row.return_to,
    };
  }

  purge(): void {
    this.database
      .prepare('DELETE FROM public_login_attempts WHERE created_at < ?')
      .run(this.now() - LOGIN_TTL_MS);
  }
}
