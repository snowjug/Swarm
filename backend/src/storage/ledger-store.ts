import type { SqlDatabase } from './sql.js';
import { z } from 'zod';
import {
  claimRecordSchema,
  contradictionRecordSchema,
  type ClaimRecord,
  type ContradictionRecord,
} from '../../../shared/evidence.js';
import { AppError } from '../errors.js';
import { decode } from './codec.js';

const payloadRow = z.object({ payload: z.string() });
const stateRow = z.object({ built_at: z.string(), reviewed_at: z.string().nullable() });

export interface LedgerState {
  builtAt: string;
  reviewedAt: string | null;
}

export interface LedgerContents {
  claims: readonly ClaimRecord[];
  contradictions: readonly ContradictionRecord[];
  /** When the grounding review behind the statements ran. Null when no review exists yet. */
  reviewedAt: string | null;
}

function numericId(id: string): number {
  return Number(id.replace(/\D+/gu, '')) || 0;
}

/** Stores the claim ledger and the conflicts between sources. Every row belongs to one project. */
export class LedgerStore {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transaction: <T>(operation: () => T) => T,
  ) {}

  state(projectId: string): LedgerState | null {
    const raw = this.database
      .prepare('SELECT built_at, reviewed_at FROM ledger_state WHERE project_id = ?')
      .get(projectId);
    if (!raw) return null;
    const value = stateRow.parse(raw);
    return { builtAt: value.built_at, reviewedAt: value.reviewed_at };
  }

  claims(projectId: string): ClaimRecord[] {
    return this.database
      .prepare('SELECT payload FROM claim_records WHERE project_id = ?')
      .all(projectId)
      .map((raw) => decode(claimRecordSchema, payloadRow.parse(raw).payload))
      .sort((a, b) => numericId(a.id) - numericId(b.id));
  }

  claim(projectId: string, claimId: string): ClaimRecord | undefined {
    const raw = this.database
      .prepare('SELECT payload FROM claim_records WHERE project_id = ? AND id = ?')
      .get(projectId, claimId);
    return raw ? decode(claimRecordSchema, payloadRow.parse(raw).payload) : undefined;
  }

  contradictions(projectId: string): ContradictionRecord[] {
    return this.database
      .prepare('SELECT payload FROM source_conflicts WHERE project_id = ?')
      .all(projectId)
      .map((raw) => decode(contradictionRecordSchema, payloadRow.parse(raw).payload))
      .sort((a, b) => numericId(a.id) - numericId(b.id));
  }

  contradiction(projectId: string, id: string): ContradictionRecord | undefined {
    const raw = this.database
      .prepare('SELECT payload FROM source_conflicts WHERE project_id = ? AND id = ?')
      .get(projectId, id);
    return raw ? decode(contradictionRecordSchema, payloadRow.parse(raw).payload) : undefined;
  }

  /** Replaces everything the ledger holds for a project in one transaction. */
  replace(projectId: string, contents: LedgerContents, now: Date): void {
    this.transaction(() => this.replaceInside(projectId, contents, now));
  }

  /** Same as `replace`, for callers that already hold the transaction. */
  replaceInside(projectId: string, contents: LedgerContents, now: Date): void {
    this.database.prepare('DELETE FROM claim_records WHERE project_id = ?').run(projectId);
    this.database.prepare('DELETE FROM source_conflicts WHERE project_id = ?').run(projectId);
    const insertClaim = this.database.prepare(
      'INSERT INTO claim_records (project_id, id, version, updated_at, payload) VALUES (?, ?, ?, ?, ?)',
    );
    for (const claim of contents.claims) {
      insertClaim.run(
        projectId,
        claim.id,
        claim.version,
        claim.history.at(-1)?.at ?? now.toISOString(),
        JSON.stringify(claim),
      );
    }
    const insertConflict = this.database.prepare(
      'INSERT INTO source_conflicts (project_id, id, status, updated_at, payload) VALUES (?, ?, ?, ?, ?)',
    );
    for (const conflict of contents.contradictions) {
      insertConflict.run(
        projectId,
        conflict.id,
        conflict.status,
        conflict.updatedAt,
        JSON.stringify(conflict),
      );
    }
    this.database
      .prepare(
        `INSERT INTO ledger_state (project_id, built_at, reviewed_at) VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET built_at = excluded.built_at, reviewed_at = excluded.reviewed_at`,
      )
      .run(projectId, now.toISOString(), contents.reviewedAt);
  }

  /**
   * Saves a changed claim only if nobody else changed it since the caller read it. A lost race is a
   * conflict the caller must resolve, never a silent overwrite.
   */
  saveClaim(projectId: string, record: ClaimRecord, expectedVersion: number): void {
    const result = this.database
      .prepare(
        `UPDATE claim_records SET version = ?, updated_at = ?, payload = ?
         WHERE project_id = ? AND id = ? AND version = ?`,
      )
      .run(
        record.version,
        record.history.at(-1)?.at ?? new Date().toISOString(),
        JSON.stringify(record),
        projectId,
        record.id,
        expectedVersion,
      );
    if (Number(result.changes) === 0) {
      throw new AppError(
        409,
        'CLAIM_CONFLICT',
        'Someone else changed this statement. Reload it and review the latest version.',
      );
    }
  }

  saveContradiction(
    projectId: string,
    record: ContradictionRecord,
    expectedUpdatedAt: string,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE source_conflicts SET status = ?, updated_at = ?, payload = ?
         WHERE project_id = ? AND id = ? AND updated_at = ?`,
      )
      .run(
        record.status,
        record.updatedAt,
        JSON.stringify(record),
        projectId,
        record.id,
        expectedUpdatedAt,
      );
    if (Number(result.changes) === 0) {
      throw new AppError(
        409,
        'CONFLICT_CHANGED',
        'Someone else changed this conflict. Reload it and review the latest version.',
      );
    }
  }
}
