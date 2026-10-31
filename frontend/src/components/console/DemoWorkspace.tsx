import { ArrowRight, GitBranch, Layers, RefreshCw } from 'lucide-react';
import { DEMO_PROJECTS } from '../../../../shared/demo';
import type { ProjectSummary } from '../../../../shared/types';
import { Notice, Spinner, StatusBadge } from '../ui';

export interface DemoHistory {
  projects: ProjectSummary[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * The demonstration workspace: the recorded synthetic projects that `npm run demo:seed` restores.
 * A card offers to open a project only when it really is in this workspace; otherwise it says how to
 * restore it, and nothing pretends it is there.
 */
export function DemoWorkspace({
  history,
  busy,
  onOpen,
  onRetry,
}: {
  history: DemoHistory;
  busy: boolean;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  const loaded = new Map((history.projects ?? []).map((project) => [project.id, project]));
  return (
    <section className="demo-workspace" aria-labelledby="demo-workspace-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SYNTHETIC SCENARIO · LARKHOLM ELECTRIC FERRY</span>
          <h2 id="demo-workspace-heading">Demonstration workspace</h2>
        </div>
        <Layers size={22} aria-hidden="true" />
      </div>
      <p className="demo-note">
        Synthetic: every source, organisation and person is fictional, and nothing here describes a
        real place. These projects were recorded with a real model; what the actors decide and what
        the report concludes are what the model produced, not text written for the demo.
      </p>
      {history.loading && !history.projects && (
        <div className="inline-pending" role="status">
          <Spinner /> Reading the workspace…
        </div>
      )}
      {history.error && (
        <Notice
          tone="error"
          title="The workspace could not be read"
          action={
            <button
              className="button button-secondary button-small"
              type="button"
              disabled={history.loading}
              onClick={onRetry}
            >
              <RefreshCw size={13} aria-hidden="true" /> Retry
            </button>
          }
        >
          {history.error}
        </Notice>
      )}
      {history.projects && (
        <ol className="demo-cards">
          {DEMO_PROJECTS.map((demo) => {
            const project = loaded.get(demo.id);
            return (
              <li key={demo.id} className="demo-card card">
                <div className="demo-card-head">
                  <span className="mono demo-role">
                    {demo.role === 'base' ? (
                      'BASE RUN'
                    ) : (
                      <>
                        <GitBranch size={12} aria-hidden="true" /> BRANCH
                      </>
                    )}
                  </span>
                  {project && <StatusBadge status={project.status} />}
                </div>
                <h3>{demo.title}</h3>
                <p>{demo.summary}</p>
                {project ? (
                  <>
                    <p className="mono demo-meta">
                      {project.agentCount} actors · {project.roundCount} rounds ·{' '}
                      {project.mode === 'llm' ? 'real model' : 'local rules'}
                    </p>
                    <button
                      className="button button-black button-small"
                      type="button"
                      disabled={busy}
                      aria-label={`Open project: ${demo.title}`}
                      onClick={() => onOpen(demo.id)}
                    >
                      Open project <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <p className="demo-missing">
                    Not loaded in this workspace. Restore it with <code>npm run demo:seed</code>.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
