import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SqlDatabase } from '../../storage/sql.js';
import type { PublicProviderId } from '../../../../shared/public.js';

/** An opaque identifier of 128 random bits, with a prefix that says what it names. */
export const opaqueId = (prefix: 'u' | 'w'): string =>
  `${prefix}_${randomBytes(16).toString('base64url')}`;

export interface PublicUser {
  id: string;
  /** The private workspace: the `tenantId` of everything the person owns. */
  workspaceId: string;
  provider: PublicProviderId;
  email: string;
  createdAt: number;
  lastLoginAt: number;
  disabled: boolean;
}

const userRow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  provider: z.enum(['google', 'github']),
  email: z.string(),
  created_at: z.coerce.number(),
  last_login_at: z.coerce.number(),
  disabled: z.coerce.number(),
});

const toUser = (raw: unknown): PublicUser => {
  const row = userRow.parse(raw);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    email: row.email,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    disabled: row.disabled === 1,
  };
};

const COLUMNS = 'id, workspace_id, provider, email, created_at, last_login_at, disabled';

/** What a sign-up needs of a person, and nothing else. */
export interface NewAccount {
  provider: PublicProviderId;
  subject: string;
  /** Verified by the provider, lower case. */
  email: string;
}

/** Everything that was removed, counted, so that a person and a test can see that it happened. */
export interface DeletionReport {
  projects: number;
  sessions: number;
  retainedCounter: boolean;
}

/**
 * Accounts of the public edition. Its database is the platform's (see `storage/system-view.ts`): a sign-in finds an
 * account before the workspace is known. It never holds a token from a provider, only what identifies the person there.
 */
export class PublicUserStore {
  constructor(
    private readonly database: SqlDatabase,
    private readonly options: {
      pepper: string;
      retentionDays: number;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** One unit of work: part of the caller's transaction when there is one, a transaction of its own when not. */
  private atomic<T>(operation: () => T): T {
    return this.database.inTransaction ? operation() : this.database.transaction(operation);
  }

  find(provider: PublicProviderId, subject: string): PublicUser | null {
    const raw = this.database
      .prepare(`SELECT ${COLUMNS} FROM public_users WHERE provider = ? AND subject = ?`)
      .get(provider, subject);
    return raw ? toUser(raw) : null;
  }

  get(id: string): PublicUser | null {
    const raw = this.database.prepare(`SELECT ${COLUMNS} FROM public_users WHERE id = ?`).get(id);
    return raw ? toUser(raw) : null;
  }

  getByWorkspace(workspaceId: string): PublicUser | null {
    const raw = this.database
      .prepare(`SELECT ${COLUMNS} FROM public_users WHERE workspace_id = ?`)
      .get(workspaceId);
    return raw ? toUser(raw) : null;
  }

  /** The accounts that have an address, for an administrator who knows only that. At most 20. */
  byEmail(email: string): PublicUser[] {
    return this.database
      .prepare(`SELECT ${COLUMNS} FROM public_users WHERE email = ? ORDER BY created_at LIMIT 20`)
      .all(email.trim().toLowerCase())
      .map(toUser);
  }

  count(): number {
    return Number(this.database.prepare('SELECT COUNT(*) AS n FROM public_users').get()?.n ?? 0);
  }

  /** The keyed hash that stands for a provider account after the account is deleted. */
  private tombstoneKey(provider: string, subject: string): string {
    return createHmac('sha256', this.options.pepper).update(`${provider}:${subject}`).digest('hex');
  }

  /**
   * Makes the account, its private workspace and the one membership that makes the person its owner, in one
   * transaction. A person who deleted an account within the retention period gets back the free tokens it had used, so
   * that deleting and signing up again does not reset the lifetime allowance.
   */
  create(account: NewAccount): PublicUser {
    return this.atomic(() => {
      const at = this.now();
      const id = opaqueId('u');
      const workspaceId = opaqueId('w');
      this.database
        .prepare(
          `INSERT INTO public_users (id, workspace_id, provider, subject, email, created_at, last_login_at, disabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(id, workspaceId, account.provider, account.subject, account.email, at, at);
      this.database
        .prepare(
          `INSERT INTO workspace_members (tenant_id, principal_id, role, added_by, added_at)
           VALUES (?, ?, 'owner', 'sign-up', ?)`,
        )
        .run(workspaceId, id, new Date(at).toISOString());
      const key = this.tombstoneKey(account.provider, account.subject);
      const kept = this.database
        .prepare('SELECT lifetime_tokens FROM deleted_accounts WHERE key_hash = ?')
        .get(key);
      if (kept) {
        this.database
          .prepare(
            `INSERT INTO usage_lifetime (subject, tokens, calls, updated_at) VALUES (?, ?, 0, ?)
             ON CONFLICT (subject) DO UPDATE SET tokens = EXCLUDED.tokens, updated_at = EXCLUDED.updated_at`,
          )
          .run(`u:${workspaceId}`, Number(kept.lifetime_tokens), at);
        this.database.prepare('DELETE FROM deleted_accounts WHERE key_hash = ?').run(key);
      }
      return {
        id,
        workspaceId,
        provider: account.provider,
        email: account.email,
        createdAt: at,
        lastLoginAt: at,
        disabled: false,
      };
    });
  }

  touchLogin(id: string): void {
    this.database
      .prepare('UPDATE public_users SET last_login_at = ? WHERE id = ?')
      .run(this.now(), id);
  }

  /** The address is the one the provider verified most recently: it follows the person if they change it there. */
  updateEmail(id: string, email: string): void {
    this.database.prepare('UPDATE public_users SET email = ? WHERE id = ?').run(email, id);
  }

  /** Switches an account off or on. Switching off also ends its sessions. Returns false when there is no such account. */
  setDisabled(id: string, disabled: boolean, reason: string | null = null): boolean {
    return this.atomic(() => {
      const changed = this.database
        .prepare('UPDATE public_users SET disabled = ?, disabled_reason = ? WHERE id = ?')
        .run(disabled ? 1 : 0, disabled ? reason : null, id);
      if (Number(changed.changes) === 0) return false;
      if (disabled) {
        this.database.prepare('DELETE FROM sessions WHERE principal_id = ?').run(id);
      }
      return true;
    });
  }

  /**
   * Deletes the account and everything that is the person's: every project (and with it, by cascade, its documents,
   * messages, claims, studio report, usage, artifacts, jobs and funding marker), the workspace's membership, the
   * sessions, the usage rows. What stays is written on the account page: the audit log, whose rows hold an opaque id and
   * counts, and for the retention period a keyed counter of the free tokens the account had used.
   */
  delete(id: string): DeletionReport | null {
    return this.atomic(() => {
      const raw = this.database
        .prepare(`SELECT ${COLUMNS}, subject FROM public_users WHERE id = ?`)
        .get(id);
      if (!raw) return null;
      const user = toUser(raw);
      const subject = String((raw as { subject: unknown }).subject);
      const workspace = user.workspaceId;
      const scopes = [`u:${workspace}`, `b:${workspace}`];
      const projects = Number(
        this.database
          .prepare('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?')
          .get(workspace)?.n ?? 0,
      );
      const sessions = Number(
        this.database
          .prepare('DELETE FROM sessions WHERE principal_id = ? OR tenant_id = ?')
          .run(id, workspace).changes,
      );
      this.database.prepare('DELETE FROM projects WHERE tenant_id = ?').run(workspace);
      this.database.prepare('DELETE FROM workspace_members WHERE tenant_id = ?').run(workspace);
      const used = this.database
        .prepare('SELECT tokens FROM usage_lifetime WHERE subject = ?')
        .get(scopes[0]!);
      for (const scope of scopes) {
        this.database.prepare('DELETE FROM usage_daily WHERE subject = ?').run(scope);
        this.database.prepare('DELETE FROM usage_reservations WHERE subject = ?').run(scope);
        this.database.prepare('DELETE FROM usage_lifetime WHERE subject = ?').run(scope);
      }
      let retained = false;
      const tokens = Number(used?.tokens ?? 0);
      if (this.options.retentionDays > 0 && tokens > 0) {
        this.database
          .prepare(
            `INSERT INTO deleted_accounts (key_hash, lifetime_tokens, deleted_at) VALUES (?, ?, ?)
             ON CONFLICT (key_hash) DO UPDATE SET lifetime_tokens = EXCLUDED.lifetime_tokens, deleted_at = EXCLUDED.deleted_at`,
          )
          .run(this.tombstoneKey(user.provider, subject), tokens, this.now());
        retained = true;
      }
      this.database.prepare('DELETE FROM public_users WHERE id = ?').run(id);
      return { projects, sessions, retainedCounter: retained };
    });
  }

  /** Forgets the counters of accounts that were deleted longer ago than the retention period. */
  purgeDeleted(): void {
    const cutoff = this.now() - this.options.retentionDays * 86_400_000;
    this.database.prepare('DELETE FROM deleted_accounts WHERE deleted_at < ?').run(cutoff);
  }
}
