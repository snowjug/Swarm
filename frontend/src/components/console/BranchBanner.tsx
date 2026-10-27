import { useEffect, useState } from 'react';
import type { ProjectDetail } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { describeChange } from '../../lib/whatIf';
import { Notice } from '../ui';

export function BranchBanner({
  project,
  enabled,
  onNavigate,
  onCompare,
}: {
  project: ProjectDetail;
  enabled: boolean;
  onNavigate: (id: string) => void;
  onCompare: (id: string) => void;
}) {
  const branch = project.console?.branch;
  const parentId = branch?.parentId;
  const [state, setState] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!parentId) return;
    const controller = new AbortController();
    setState('loading');
    setError(null);
    void api.project(parentId, controller.signal).then(
      () => {
        if (!controller.signal.aborted) setState('available');
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) {
          setState('unavailable');
          setError(errorMessage(failure));
        }
      },
    );
    return () => controller.abort();
  }, [parentId, revision]);
  if (!branch) return null;
  return (
    <section className="branch-banner" aria-label="Recorded branch lineage">
      <strong>
        Branched from {branch.parentName} at round {branch.fromRound}
      </strong>
      <p>
        {branch.fromRound
          ? `Rounds 1–${branch.fromRound} were copied unchanged.`
          : 'No simulation rounds were copied; this branch starts from scratch.'}{' '}
        Declared changes are assumptions, not proof of a causal effect.
      </p>
      {branch.changes.length ? (
        <details className="branch-declared-changes">
          <summary>{branch.changes.length} declared assumption changes</summary>
          <ul>
            {branch.changes.map((change, index) => (
              <li key={index}>{describeChange(change, project)}</li>
            ))}
          </ul>
        </details>
      ) : (
        <p>No assumption changes were recorded at branch creation.</p>
      )}
      <div className="stage-actions">
        {state === 'available' ? (
          <a
            className="button button-secondary"
            href={`?project=${encodeURIComponent(branch.parentId)}`}
            onClick={(event) => {
              if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
                event.preventDefault();
                onNavigate(branch.parentId);
              }
            }}
          >
            Open parent run
          </a>
        ) : (
          <span className="field-help">
            {state === 'loading'
              ? 'Checking parent availability…'
              : 'Parent unavailable or deleted. This branch and its declared changes remain readable.'}
          </span>
        )}
        {enabled && (
          <button
            className="button button-secondary"
            type="button"
            disabled={state !== 'available' || !project.rounds.length}
            onClick={() => onCompare(branch.parentId)}
          >
            Compare with parent
          </button>
        )}
        {enabled && !project.rounds.length && (
          <span className="field-help">Comparison needs at least one saved round in this run.</span>
        )}
      </div>
      {error && (
        <Notice tone="warning">
          {error}{' '}
          <button
            className="text-button"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry parent lookup
          </button>
        </Notice>
      )}
    </section>
  );
}
