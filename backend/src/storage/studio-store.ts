import { z } from 'zod';
import { studioDocumentSchema, type StudioDocument } from '../../../shared/studio.js';
import { AppError } from '../errors.js';
import { decode } from './codec.js';
import type { SqlDatabase } from './sql.js';

const payloadRow = z.object({ payload: z.string() });

/** A document is one row. This is far above any real report, and keeps a runaway from filling the database. */
export const MAX_STUDIO_PAYLOAD = 3_000_000;

function serialise(document: StudioDocument): string {
  const payload = JSON.stringify(document);
  if (payload.length > MAX_STUDIO_PAYLOAD) {
    throw new AppError(
      413,
      'STUDIO_TOO_LARGE',
      'This report has grown too large to keep. Export it and start from a clean one.',
    );
  }
  return payload;
}

/**
 * Stores each project's Report Studio document. A save names the revision it started from and is
 * refused if the stored one has moved on, so a lost race is the caller's to resolve, never a silent
 * overwrite. The document belongs to its project and is deleted with it.
 */
export class StudioStore {
  constructor(private readonly database: SqlDatabase) {}

  get(projectId: string): StudioDocument | null {
    const raw = this.database
      .prepare('SELECT payload FROM studio_documents WHERE project_id = ?')
      .get(projectId);
    return raw ? decode(studioDocumentSchema, payloadRow.parse(raw).payload) : null;
  }

  /** Stores the first document of a project. False when one exists already: someone else was first. */
  insert(projectId: string, document: StudioDocument): boolean {
    const result = this.database
      .prepare(
        `INSERT INTO studio_documents (project_id, revision, state, updated_at, payload)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id) DO NOTHING`,
      )
      .run(projectId, document.revision, document.state, document.updatedAt, serialise(document));
    return Number(result.changes) > 0;
  }

  /** Saves a changed document if nobody has saved since `expectedRevision`. False: read it again. */
  save(projectId: string, document: StudioDocument, expectedRevision: number): boolean {
    const result = this.database
      .prepare(
        `UPDATE studio_documents SET revision = ?, state = ?, updated_at = ?, payload = ?
         WHERE project_id = ? AND revision = ?`,
      )
      .run(
        document.revision,
        document.state,
        document.updatedAt,
        serialise(document),
        projectId,
        expectedRevision,
      );
    return Number(result.changes) > 0;
  }
}
