import { z } from 'zod';
import {
  DEFAULT_ARTIFACT_KEY,
  MAX_ARTIFACT_BYTES,
  artifactSchemas,
  type ArtifactData,
  type ArtifactKind,
} from '../../../shared/artifacts.js';
import { AppError } from '../errors.js';
import type { SqlDatabase } from './sql.js';

export interface ArtifactRecord<K extends ArtifactKind = ArtifactKind> {
  projectId: string;
  kind: K;
  key: string;
  /** Starts at 1 and rises by one with every write, so a stale writer can be told. */
  revision: number;
  data: ArtifactData<K>;
  createdAt: string;
  updatedAt: string;
}

const row = z.object({
  project_id: z.string(),
  kind: z.string(),
  artifact_key: z.string(),
  revision: z.coerce.number(),
  payload: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

const conflict = (kind: string, key: string): AppError =>
  new AppError(
    409,
    'ARTIFACT_CONFLICT',
    `The ${kind} changed while you were editing it (${key}). Reload it and make your change again.`,
  );

/**
 * What a project carries beyond its own record: a scenario, stakeholders, actors, run sets,
 * critiques, a brief. Each is one JSON document of a kind named in `shared/artifacts.ts`, checked
 * against that kind's schema when written and when read. The store knows nothing about what a kind
 * means; the code that owns the kind does. The documents are removed with their project.
 */
export class ArtifactStore {
  constructor(private readonly database: SqlDatabase) {}

  get<K extends ArtifactKind>(
    projectId: string,
    kind: K,
    key: string = DEFAULT_ARTIFACT_KEY,
  ): ArtifactRecord<K> | null {
    const found = this.database
      .prepare(
        `SELECT project_id, kind, artifact_key, revision, payload, created_at, updated_at
         FROM project_artifacts WHERE project_id = ? AND kind = ? AND artifact_key = ?`,
      )
      .get(projectId, kind, key);
    return found ? this.decode(kind, row.parse(found)) : null;
  }

  /** Every document of a kind, oldest first. */
  list<K extends ArtifactKind>(projectId: string, kind: K): ArtifactRecord<K>[] {
    return this.database
      .prepare(
        `SELECT project_id, kind, artifact_key, revision, payload, created_at, updated_at
         FROM project_artifacts WHERE project_id = ? AND kind = ?
         ORDER BY created_at, artifact_key`,
      )
      .all(projectId, kind)
      .map((found) => this.decode(kind, row.parse(found)));
  }

  /**
   * Writes a document. With `expectedRevision`, the write is refused unless that is still the current
   * revision (0 meaning there is none yet), so that two people editing one document cannot silently
   * overwrite each other.
   */
  put<K extends ArtifactKind>(
    projectId: string,
    kind: K,
    key: string,
    data: ArtifactData<K>,
    options: { expectedRevision?: number } = {},
  ): ArtifactRecord<K> {
    if (!KEY.test(key)) {
      throw new AppError(
        400,
        'ARTIFACT_KEY_INVALID',
        'An artifact key is letters, digits, . _ and -.',
      );
    }
    const payload = JSON.stringify(artifactSchemas[kind].parse(data));
    if (Buffer.byteLength(payload, 'utf8') > MAX_ARTIFACT_BYTES) {
      throw new AppError(
        413,
        'ARTIFACT_TOO_LARGE',
        `A ${kind} document is limited to ${MAX_ARTIFACT_BYTES.toLocaleString('en-GB')} bytes.`,
      );
    }
    const now = new Date().toISOString();
    const write = (): void => {
      const current = this.database
        .prepare(
          'SELECT revision FROM project_artifacts WHERE project_id = ? AND kind = ? AND artifact_key = ?',
        )
        .get(projectId, kind, key);
      const revision = current ? Number(current.revision) : 0;
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
        throw conflict(kind, key);
      }
      if (!current) {
        this.database
          .prepare(
            `INSERT INTO project_artifacts
               (project_id, kind, artifact_key, revision, payload, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?, ?)`,
          )
          .run(projectId, kind, key, payload, now, now);
        return;
      }
      const updated = this.database
        .prepare(
          `UPDATE project_artifacts SET revision = revision + 1, payload = ?, updated_at = ?
           WHERE project_id = ? AND kind = ? AND artifact_key = ? AND revision = ?`,
        )
        .run(payload, now, projectId, kind, key, revision);
      if (Number(updated.changes) !== 1) throw conflict(kind, key);
    };
    if (this.database.inTransaction) write();
    else this.database.transaction(write);
    const stored = this.get(projectId, kind, key);
    if (!stored) throw conflict(kind, key);
    return stored;
  }

  delete(projectId: string, kind: ArtifactKind, key: string = DEFAULT_ARTIFACT_KEY): boolean {
    const removed = this.database
      .prepare(
        'DELETE FROM project_artifacts WHERE project_id = ? AND kind = ? AND artifact_key = ?',
      )
      .run(projectId, kind, key);
    return Number(removed.changes) > 0;
  }

  /** Copies documents to another project (a branch, a duplicate), starting each at revision 1. */
  copy(fromProjectId: string, toProjectId: string, kinds: readonly ArtifactKind[]): number {
    let copied = 0;
    const run = (): void => {
      for (const kind of kinds) {
        for (const source of this.list(fromProjectId, kind)) {
          this.put(toProjectId, kind, source.key, source.data);
          copied += 1;
        }
      }
    };
    if (this.database.inTransaction) run();
    else this.database.transaction(run);
    return copied;
  }

  private decode<K extends ArtifactKind>(kind: K, stored: z.output<typeof row>): ArtifactRecord<K> {
    let data: ArtifactData<K>;
    try {
      data = artifactSchemas[kind].parse(JSON.parse(stored.payload)) as ArtifactData<K>;
    } catch {
      throw new AppError(
        500,
        'ARTIFACT_INVALID',
        `A stored ${kind} document no longer matches its schema and cannot be read.`,
      );
    }
    return {
      projectId: stored.project_id,
      kind,
      key: stored.artifact_key,
      revision: stored.revision,
      data,
      createdAt: stored.created_at,
      updatedAt: stored.updated_at,
    };
  }
}
