import type { RunComparison } from '../../../../shared/guided';
import { comparisonMetrics, metricLabels, metricValue } from '../../lib/metrics';
import { describeChange, lineageSentence } from '../../lib/whatIf';
import { RecordedChart } from './RecordedChart';

export function ComparisonResults({ comparison }: { comparison: RunComparison }) {
  const { base, other, rounds } = comparison;
  return (
    <div className="comparison-results view-stack">
      <p className="comparison-lineage">{lineageSentence(comparison)}</p>
      <p className="identical-marker" role="status">
        Identical through round {comparison.identicalThroughRound}
      </p>
      <div className="comparison-run-info">
        {[base, other].map((run, index) => (
          <div key={run.id}>
            <strong>
              {index === 0 ? 'Base' : 'Other'}: {run.name}
            </strong>
            <p>
              {run.completedRounds}/{run.totalRounds} saved rounds · seed {run.seed} · {run.status}
            </p>
            <p className="mono">{run.id}</p>
          </div>
        ))}
      </div>
      <div className="comparison-charts">
        {(['meanOpinion', 'polarization'] as const).map((metric) => (
          <RecordedChart
            key={metric}
            title={`${metricLabels[metric]} — recorded run comparison`}
            min={metric === 'meanOpinion' ? -1 : 0}
            max={1}
            summary={`Base ${base.name}: solid line with circles. Other ${other.name}: dashed line with squares. Differences are recorded associations, not causal estimates.`}
            series={[
              {
                id: 'base',
                label: `Base: ${base.name}`,
                color: 'var(--chart-1)',
                marker: 'circle',
                points: rounds.map((round) => ({
                  round: round.round,
                  value: round.base?.[metric] ?? null,
                })),
              },
              {
                id: 'other',
                label: `Other: ${other.name}`,
                color: 'var(--chart-3)',
                dash: '8 4',
                marker: 'square',
                points: rounds.map((round) => ({
                  round: round.round,
                  value: round.other?.[metric] ?? null,
                })),
              },
            ]}
          />
        ))}
      </div>
      <section className="comparison-changes">
        <h3>Declared branch changes</h3>
        {comparison.declaredChanges.length ? (
          <ul>
            {comparison.declaredChanges.map((change, index) => (
              <li key={index}>{describeChange(change)}</li>
            ))}
          </ul>
        ) : (
          <p>No declared assumption changes were returned for this comparison.</p>
        )}
      </section>
      <section className="comparison-honesty">
        <h3>Server comparison notes — honesty statement</h3>
        {comparison.notes.length ? (
          comparison.notes.map((note, index) => (
            <p className="preserve-text" key={index}>
              {note}
            </p>
          ))
        ) : (
          <p>No comparison notes were returned by the server.</p>
        )}
      </section>
      <table className="metrics-table comparison-table">
        <caption>
          Per-round recorded values and deltas. Δ = other − base. Unitless values are shown to 3
          decimal places; action counts are integers. Missing values are not estimated.
        </caption>
        <colgroup>
          <col className="round-column" />
          <col className="metric-column" />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col">Metric</th>
            <th scope="col">Base</th>
            <th scope="col">Other</th>
            <th scope="col">Δ other − base</th>
          </tr>
        </thead>
        {rounds.map((round) => (
          <tbody key={round.round}>
            {comparisonMetrics.map((metric, index) => (
              <tr key={metric}>
                {index === 0 && (
                  <th scope="rowgroup" rowSpan={comparisonMetrics.length}>
                    {round.round}
                  </th>
                )}
                <th scope="row">{metricLabels[metric]}</th>
                <td>{metricValue(round.base?.[metric], metric)}</td>
                <td>{metricValue(round.other?.[metric], metric)}</td>
                <td>{metricValue(round.delta?.[metric], metric, true)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      {!rounds.length && <p>No recorded round comparisons were returned.</p>}
    </div>
  );
}
