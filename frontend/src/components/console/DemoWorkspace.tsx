import { ArrowRight, GitBranch, Layers, RefreshCw } from 'lucide-react';
import { DEMO_PROJECTS } from '../../../../shared/demo';
import type { ProjectSummary } from '../../../../shared/types';
import { Notice, Spinner, StatusBadge } from '../ui';

/** The sentence the product is never to be read without. */
export const POSITIONING_STATEMENT =
  'Swarm explores possible scenarios. It does not predict the future.';

const CAPABILITIES = [
  'Evidence ledger',
  'Contradiction review',
  'Assumption register',
  'Scenario graph',
  'Synthetic actors',
  'Branch and compare',
  'Grounded report',
  'Audit trail',
];

export interface DemoHistory {
  projects: ProjectSummary[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Product introduction, then the demonstration workspace: the recorded synthetic projects that
 * `npm run demo:seed` restores. A card offers to open a project only when it really is in this
 * workspace; otherwise it says how to restore it, and nothing pretends it is there.
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
    <div className="product-home">
      <section className="product-intro" aria-labelledby="product-heading">
        <span className="eyebrow">SWARM · EVIDENCE-GROUNDED SCENARIO INTELLIGENCE</span>
        <h1 id="product-heading">Explore what could happen, and see what the evidence supports.</h1>
        <p className="positioning-statement">{POSITIONING_STATEMENT}</p>
        <p className="product-lede">
          Swarm turns source documents into an evidence ledger, runs fictional stakeholders through
          a scenario round by round, lets you branch it on one changed assumption, and writes a
          report in which every statement shows what supports it, or that nothing does.
        </p>
        <ul className="capability-list" aria-label="What Swarm does">
          {CAPABILITIES.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </section>
      <section className="demo-workspace" aria-labelledby="demo-workspace-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">DEMONSTRATION WORKSPACE</span>
            <h2 id="demo-workspace-heading">Larkholm electric ferry</h2>
          </div>
          <Layers size={22} aria-hidden="true" />
        </div>
        <p className="demo-note">
          Synthetic: every source, organisation and person is fictional, and nothing here describes
          a real place. These projects were recorded with a real model; what the actors decide and
          what the report concludes are what the model produced, not text written for the demo.
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
    </div>
  );
}
