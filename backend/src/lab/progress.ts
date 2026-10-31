import type { ArtifactKind } from '../../../shared/artifacts.js';
import type { LabProgress } from '../../../shared/lab.js';
import type { ArtifactStore } from '../storage/artifacts.js';

/**
 * A document that cannot be read counts as not there. The project is still shown, and the page that
 * works on that document says what is wrong with it.
 */
function readable<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * Looking from the newest comparison of scenarios back: one that is running, or one that finished,
 * is what the person is shown, and the first of those decides. A comparison that stopped without a
 * result (failed, cancelled, interrupted) is passed over, so that a finished one is not forgotten
 * because a later one was cancelled: the brief is written from the newest finished one. Only the
 * comparisons that are looked at are read, and a project holds up to a dozen, each a large document.
 */
function analysisProgress(artifacts: ArtifactStore, projectId: string): LabProgress['analysis'] {
  let stopped = false;
  for (const key of artifacts.keys(projectId, 'analysis')) {
    const status = readable(() => artifacts.get(projectId, 'analysis', key))?.data.status;
    if (status === 'queued' || status === 'running') return 'running';
    if (status === 'completed') return 'completed';
    if (status !== undefined) stopped = true;
  }
  return stopped ? 'failed' : 'none';
}

function stakeholderProgress(
  artifacts: ArtifactStore,
  projectId: string,
): LabProgress['stakeholders'] {
  const stored = readable(() => artifacts.get(projectId, 'stakeholders'));
  if (!stored) return 'none';
  return stored.data.approvedAt === null ? 'proposed' : 'approved';
}

/**
 * How far a project has come along the path from a question to a decision brief, from what its
 * artifacts hold. It is read when one project is read, and nowhere that a project is listed, exported
 * or copied. Nothing here can fail a request: a stakeholder list, a cast or a comparison that cannot
 * be read counts as missing, and a scenario, a review or a brief counts as there when it is stored,
 * since the page that shows it says whether it can be read.
 */
export function labProgress(artifacts: ArtifactStore, projectId: string): LabProgress {
  const stored = (kind: ArtifactKind): boolean => artifacts.keys(projectId, kind).length > 0;
  return {
    scenario: stored('scenario'),
    stakeholders: stakeholderProgress(artifacts, projectId),
    actors: readable(() => artifacts.get(projectId, 'actors'))?.data.actors.length ?? 0,
    analysis: analysisProgress(artifacts, projectId),
    critiques: stored('critiques'),
    brief: stored('brief'),
  };
}
