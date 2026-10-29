import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export type AuditDetail = Record<string, string | number | boolean | null>;

export interface AuditInput {
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  projectId?: string | null;
  /** Identifiers, counts and short labels only. Never source text, model output or a credential. */
  detail?: AuditDetail;
}

export interface AuditEvent {
  seq: number;
  at: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  projectId: string | null;
  detail: AuditDetail;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);
const MAX_VALUE_CHARS = 200;
const MAX_KEYS = 12;

const row = z.object({
  seq: z.number(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  target_type: z.string(),
  target_id: z.string(),
  project_id: z.string().nullable(),
  detail: z.string(),
  prev_hash: z.string(),
  hash: z.string(),
});

/** Keeps the log to metadata: bounded keys, scalar values and short strings. */
export function sanitizeDetail(detail: AuditDetail | undefined): AuditDetail {
  const clean: AuditDetail = {};
  for (const [key, value] of Object.entries(detail ?? {}).slice(0, MAX_KEYS)) {
    clean[key.slice(0, 40)] = typeof value === 'string' ? value.slice(0, MAX_VALUE_CHARS) : value;
  }
  return clean;
}

export function auditHash(
  previous: string,
  event: Omit<AuditEvent, 'seq' | 'prevHash' | 'hash'>,
): string {
  return createHash('sha256')
    .update(
      [
        previous,
        event.at,
        event.actor,
        event.action,
        event.targetType,
        event.targetId,
        event.projectId ?? '',
        JSON.stringify(event.detail),
      ].join('|'),
    )
    .digest('hex');
}

function toEvent(raw: unknown): AuditEvent {
  const value = row.parse(raw);
  return {
    seq: value.seq,
    at: value.at,
    actor: value.actor,
    action: value.action,
    targetType: value.target_type,
    targetId: value.target_id,
    projectId: value.project_id,
    detail: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .parse(JSON.parse(value.detail)),
    prevHash: value.prev_hash,
    hash: value.hash,
  };
}

/**
 * An append-only, hash-chained record of who did what. Database triggers refuse any update or
 * delete, and each entry commits to the one before it, so a silent edit shows up in `verify`.
 * Call `record` inside the transaction of the change it describes so the two commit together.
 */
export class AuditLog {
  constructor(private readonly database: DatabaseSync) {}

  record(input: AuditInput, now: Date = new Date()): AuditEvent {
    const last = this.database
      .prepare('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1')
      .get();
    const prevHash = last ? z.object({ hash: z.string() }).parse(last).hash : GENESIS_HASH;
    const base = {
      at: now.toISOString(),
      actor: input.actor.slice(0, 80),
      action: input.action.slice(0, 80),
      targetType: input.targetType.slice(0, 40),
      targetId: input.targetId.slice(0, 80),
      projectId: input.projectId ?? null,
      detail: sanitizeDetail(input.detail),
    };
    const hash = auditHash(prevHash, base);
    const result = this.database
      .prepare(
        `INSERT INTO audit_events (at, actor, action, target_type, target_id, project_id, detail, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        base.at,
        base.actor,
        base.action,
        base.targetType,
        base.targetId,
        base.projectId,
        JSON.stringify(base.detail),
        prevHash,
        hash,
      );
    return { seq: Number(result.lastInsertRowid), ...base, prevHash, hash };
  }

  list(filter: { projectId?: string; limit?: number } = {}): AuditEvent[] {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const rows = filter.projectId
      ? this.database
          .prepare('SELECT * FROM audit_events WHERE project_id = ? ORDER BY seq DESC LIMIT ?')
          .all(filter.projectId, limit)
      : this.database.prepare('SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?').all(limit);
    return rows.map(toEvent).reverse();
  }

  /** Recomputes every link in the chain. A mismatch means an entry was altered or removed. */
  verify(): { ok: boolean; checked: number; brokenAt: number | null } {
    let previous = GENESIS_HASH;
    let checked = 0;
    for (const raw of this.database.prepare('SELECT * FROM audit_events ORDER BY seq').all()) {
      const event = toEvent(raw);
      const expected = auditHash(previous, event);
      if (event.prevHash !== previous || event.hash !== expected) {
        return { ok: false, checked, brokenAt: event.seq };
      }
      previous = event.hash;
      checked += 1;
    }
    return { ok: true, checked, brokenAt: null };
  }
}
