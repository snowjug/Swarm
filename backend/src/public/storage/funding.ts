import type { Funding } from '../../../../shared/public.js';
import type { SqlDatabase } from '../../storage/sql.js';

/**
 * What a project's model work is paid for with: the free tier, or a person's own key. Not a secret: it is only the word.
 * It is what stops a run that started on someone's own key from carrying on, once the key is gone, on the owner's credits.
 */
export class ProjectFundingStore {
  constructor(
    private readonly database: SqlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  get(projectId: string): Funding | null {
    const row = this.database
      .prepare('SELECT funding FROM project_funding WHERE project_id = ?')
      .get(projectId);
    return row?.funding === 'byok' ? 'byok' : row?.funding === 'free' ? 'free' : null;
  }

  set(projectId: string, funding: Funding): void {
    this.database
      .prepare(
        `INSERT INTO project_funding (project_id, funding, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET funding = EXCLUDED.funding, updated_at = EXCLUDED.updated_at`,
      )
      .run(projectId, funding, this.now());
  }
}
