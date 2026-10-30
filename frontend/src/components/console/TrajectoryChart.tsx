import { useId, useState } from 'react';
import type { ProjectDetail } from '../../../../shared/types';
import { metricLabels, metricValue, trajectoryMetrics } from '../../lib/metrics';
import { EmptyPanel } from '../ui';
import { RecordedChart } from './RecordedChart';
import type { ChartSeries } from './RecordedChart';

const styles: Pick<ChartSeries, 'color' | 'dash' | 'marker'>[] = [
  { color: 'var(--chart-1)', marker: 'circle' },
  { color: 'var(--chart-2)', marker: 'square', dash: '9 3' },
  { color: 'var(--chart-3)', marker: 'triangle', dash: '3 3' },
  { color: 'var(--chart-4)', marker: 'diamond', dash: '9 3 2 3' },
  { color: 'var(--chart-5)', marker: 'cross', dash: '2 4' },
];

export function TrajectoryChart({ project }: { project: ProjectDetail }) {
  const [tableOpen, setTableOpen] = useState(false);
  const id = useId();
  if (!project.rounds.length)
    return (
      <EmptyPanel title="No trajectory recorded yet">
        The chart uses saved combined round snapshots only; no estimated or interpolated outcomes
        are added.
      </EmptyPanel>
    );
  const rounds = project.rounds.slice().sort((a, b) => a.round - b.round);
  return (
    <section className="stage-card trajectory-section" aria-label="Current run recorded trajectory">
      <RecordedChart
        title="Current run — recorded combined trajectory"
        summary="Mean inclination ranges from −1 to +1. Support, opposition and undecided shares and polarization range from 0 to 1. These are fictional proxy state, not measured public opinion."
        series={trajectoryMetrics.map((metric, index) => ({
          id: metric,
          label: metricLabels[metric],
          ...styles[index]!,
          points: rounds.map((round) => ({ round: round.round, value: round[metric] })),
        }))}
      />
      <button
        className="button button-secondary"
        type="button"
        aria-expanded={tableOpen}
        aria-controls={id}
        onClick={() => setTableOpen((open) => !open)}
      >
        {tableOpen ? 'Hide' : 'Show'} trajectory data table
      </button>
      <div id={id} hidden={!tableOpen}>
        <table className="metrics-table trajectory-table">
          <caption>
            Current run — recorded per-round trajectory values (unitless, shown to 3 decimal places)
          </caption>
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">Metric</th>
              <th scope="col">Recorded value</th>
            </tr>
          </thead>
          {rounds.map((round) => (
            <tbody key={round.round}>
              {trajectoryMetrics.map((metric, index) => (
                <tr key={metric}>
                  {index === 0 && (
                    <th scope="rowgroup" rowSpan={trajectoryMetrics.length}>
                      {round.round}
                    </th>
                  )}
                  <th scope="row">{metricLabels[metric]}</th>
                  <td>{metricValue(round[metric], metric)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
