import type { ProjectDetail } from '../../../../../shared/types';
import { resolveReport } from '../../report/model';

/**
 * What the tools of the brief offer for the detailed report, from where the report stands.
 *
 * - `edit`: it is written, so it can be worked on in the studio and read.
 * - `write`: it is not written and this role can write it. The way to it is the detailed report's own page, which
 *   writes it, or says what has to happen first (the deep dive).
 * - `read`: it is being written, or stopped part-way: its page shows how far it got.
 * - `none`: there is nothing to offer this role, or this record cannot make one.
 *
 * The studio is never offered for a report that does not exist: it would only say so.
 */
export type ReportTool = 'edit' | 'write' | 'read' | 'none';

export function reportTool(project: ProjectDetail, mayWrite: boolean): ReportTool {
  const state = resolveReport(project);
  switch (state.kind) {
    case 'complete':
      return 'edit';
    case 'writing':
      return 'read';
    case 'stopped':
      return project.report ? 'read' : mayWrite ? 'write' : 'none';
    case 'ready':
    case 'blocked':
      return mayWrite ? 'write' : 'none';
    case 'none':
      return 'none';
  }
}
