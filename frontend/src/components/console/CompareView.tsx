import { useEffect, useId, useState } from 'react';
import type { RunComparison } from '../../../../shared/guided';
import type { ProjectDetail, ProjectSummary } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { ComparisonResults } from './ComparisonResults';

export function CompareView({
  project,
  projects,
  defaultOtherId,
  onClose,
}: {
  project: ProjectDetail;
  projects: ProjectSummary[];
  defaultOtherId?: string | null;
  onClose: () => void;
}) {
  const eligible = projects.filter(
    (item) => item.id !== project.id && item.workflow === 'guided' && item.currentRound >= 1,
  );
  const [otherId, setOtherId] = useState(
    defaultOtherId ?? project.parentId ?? eligible[0]?.id ?? '',
  );
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const id = useId();
  useEffect(() => {
    setError(null);
    setComparison(null);
    if (!otherId || !project.rounds.length) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void api.compare(project.id, otherId, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setComparison(result);
          setLoading(false);
        }
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(failure));
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [project.id, project.rounds.length, otherId, revision]);
  return (
    <section
      id="run-comparison"
      className="compare-view view-stack"
      aria-labelledby={`${id}-title`}
    >
      <div className="section-heading">
        <h2 id={`${id}-title`}>Compare recorded runs</h2>
        <button className="button button-secondary" type="button" onClick={onClose}>
          Back to current stage
        </button>
      </div>
      <div className="comparison-picker">
        <div className="field">
          <label htmlFor={`${id}-other`}>
            Other guided run from History (at least one saved round)
          </label>
          <select
            id={`${id}-other`}
            value={otherId}
            onChange={(event) => setOtherId(event.target.value)}
          >
            <option value="">Choose a recorded run…</option>
            {otherId && !eligible.some((item) => item.id === otherId) && (
              <option value={otherId}>
                Parent / requested run ({otherId}) — availability checked by API
              </option>
            )}
            {eligible.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name} · {item.currentRound} saved rounds
              </option>
            ))}
          </select>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={loading || !otherId || !project.rounds.length}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh recorded comparison
        </button>
      </div>
      <p className="field-help">
        Snapshot from the latest comparison request; Refresh reads newly persisted rounds. Graphs
        show recorded values, not causal effects. Δ always means other minus base.
      </p>
      {!otherId && eligible.length > 0 && (
        <p className="field-help">Choose another guided run to enable comparison and Refresh.</p>
      )}
      {!project.rounds.length && (
        <Notice tone="warning">
          This run has no saved rounds. Comparison is disabled until at least one round is
          persisted.
        </Notice>
      )}
      {!eligible.length && !otherId && (
        <EmptyPanel title="No other eligible runs in History">
          Complete at least one round in another guided run, or resume a branch, then refresh
          History.
        </EmptyPanel>
      )}
      {loading && (
        <div className="inline-pending" role="status">
          <Spinner /> Fetching actual run comparison…
        </div>
      )}
      {error && (
        <Notice tone="error" title="Comparison unavailable">
          {error} The requested run may have been deleted. Choose another run or retry with Refresh.
        </Notice>
      )}
      {comparison && <ComparisonResults comparison={comparison} />}
    </section>
  );
}
