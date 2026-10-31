import { useId } from 'react';
import {
  RESPONSE_CATEGORIES,
  RESPONSE_LABELS,
  type Analysis,
  type ResponseCategory,
  type SensitivityRow,
} from '../../../../shared/analysis';
import { useElementSize } from '../../hooks/useElementSize';
import {
  ORIGIN,
  SENSITIVITY,
  VARIANT_STYLES,
  percentText,
  signedNumber,
  signedPoints,
  stanceAxis,
  type VariantDistribution,
} from '../../lib/analysis';
import { ToneChip } from '../console/LedgerParts';

const TABLE_REGION = { tabIndex: 0, role: 'region' } as const;

/** How the final responses of the simulated members divide, one bar for each scenario. */
export function DistributionBars({ distributions }: { distributions: VariantDistribution[] }) {
  return (
    <figure className="analysis-figure">
      <figcaption>
        Final responses of the simulated members, averaged over the seeded runs of each scenario
      </figcaption>
      <p className="field-help">
        Each bar adds up to all the simulated members of that scenario. The groups are readings of
        where each simulated member ended up, not observed behaviour.
      </p>
      <ul className="analysis-legend" aria-label="What each segment means">
        {RESPONSE_CATEGORIES.map((category) => (
          <li key={category}>
            <span className={`analysis-swatch analysis-seg-${category}`} aria-hidden="true" />
            {RESPONSE_LABELS[category]}
          </li>
        ))}
      </ul>
      <ol className="analysis-bars">
        {distributions.map((distribution) => (
          <li key={distribution.variantId}>
            <div className="analysis-bar-head">
              <strong>{distribution.label}</strong>
              <span>{distribution.runs} seeded runs</span>
            </div>
            <div
              className="analysis-bar"
              role="img"
              aria-label={`${distribution.label}, averaged over ${distribution.runs} seeded runs: ${RESPONSE_CATEGORIES.map(
                (category) =>
                  `${RESPONSE_LABELS[category]} ${percentText(distribution.shares[category])}`,
              ).join(', ')} of the simulated members.`}
            >
              {RESPONSE_CATEGORIES.map((category: ResponseCategory) =>
                distribution.shares[category] > 0.0005 ? (
                  <span
                    key={category}
                    className={`analysis-seg analysis-seg-${category}`}
                    style={{ width: `${distribution.shares[category] * 100}%` }}
                    title={`${RESPONSE_LABELS[category]}: ${percentText(distribution.shares[category])}`}
                  >
                    {distribution.shares[category] >= 0.07
                      ? percentText(distribution.shares[category])
                      : ''}
                  </span>
                ) : null,
              )}
            </div>
            <p className="analysis-spread">
              Looking for an alternative or resisting: {percentText(distribution.adverse.p50)} of
              the simulated members in a typical run; the middle 80% of runs ranged from{' '}
              {percentText(distribution.adverse.p10)} to {percentText(distribution.adverse.p90)}.
            </p>
          </li>
        ))}
      </ol>
      <details className="analysis-table-toggle">
        <summary>View the distribution as a table</summary>
        <div
          className="analysis-table-wrap"
          aria-label="Distribution of final responses"
          {...TABLE_REGION}
        >
          <table className="metrics-table">
            <caption>
              Mean share of the simulated members in each final response, over the seeded runs
            </caption>
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Runs</th>
                {RESPONSE_CATEGORIES.map((category) => (
                  <th scope="col" key={category}>
                    {RESPONSE_LABELS[category]}
                  </th>
                ))}
                <th scope="col">Alternative or resist, 10th to 90th percentile of runs</th>
              </tr>
            </thead>
            <tbody>
              {distributions.map((distribution) => (
                <tr key={distribution.variantId}>
                  <th scope="row">{distribution.label}</th>
                  <td>{distribution.runs}</td>
                  {RESPONSE_CATEGORIES.map((category) => (
                    <td key={category}>{percentText(distribution.shares[category])}</td>
                  ))}
                  <td>
                    {percentText(distribution.adverse.p10)} to{' '}
                    {percentText(distribution.adverse.p90)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** The spread of the overall simulated stance round by round: a band from the 10th to the 90th percentile and the median. */
export function BandChart({ analysis }: { analysis: Analysis }) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const id = useId();
  const series = analysis.config.variants.flatMap((variant, index) => {
    const bands = analysis.variants.find((result) => result.variantId === variant.id)?.trajectory;
    return bands && bands.length > 0
      ? [{ variant, bands, style: VARIANT_STYLES[index % VARIANT_STYLES.length]! }]
      : [];
  });
  if (series.length === 0) return null;
  const height = 280;
  const left = 52;
  const right = Math.max(left + 20, width - 18);
  const top = 16;
  const bottom = height - 42;
  const rounds = [...new Set(series.flatMap((item) => item.bands.map((band) => band.round)))].sort(
    (a, b) => a - b,
  );
  const first = rounds[0] ?? 1;
  const last = rounds.at(-1) ?? first;
  const axis = stanceAxis(
    series.flatMap((item) => item.bands.flatMap((band) => [band.p10, band.p90])),
  );
  const x = (round: number) =>
    first === last
      ? (left + right) / 2
      : left + ((round - first) * (right - left)) / (last - first);
  const y = (value: number) =>
    bottom - ((value - axis.min) * (bottom - top)) / (axis.max - axis.min);
  const stride = Math.max(
    1,
    Math.ceil(rounds.length / Math.max(2, Math.floor((right - left) / 60))),
  );
  const roundTicks = rounds.filter(
    (_, index) => index % stride === 0 || index === rounds.length - 1,
  );
  const summary =
    'The line is the median of the seeded runs; the shaded band runs from their 10th to their 90th percentile. Stance runs from -1 (clearly against) to +1 (clearly in favour) and is a simulated reading, not a measurement.';
  return (
    <figure className="recorded-chart analysis-figure">
      <figcaption id={`${id}-caption`}>
        How the overall simulated stance spreads across the seeded runs, round by round
      </figcaption>
      <p className="field-help" id={`${id}-description`}>
        {summary}
      </p>
      <div className="chart-surface" ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-labelledby={`${id}-caption ${id}-description`}
        >
          <title>How the overall simulated stance spreads across the seeded runs</title>
          <desc>
            {series.length} scenarios over {rounds.length} rounds. The exact values are in the data
            table below the chart.
          </desc>
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
              />
              <text
                x={left - 8}
                y={y(tick) + 4}
                textAnchor="end"
                fill="var(--chart-label)"
                fontSize={12}
              >
                {tick.toFixed(2)}
              </text>
            </g>
          ))}
          <line x1={left} x2={left} y1={top} y2={bottom} stroke="var(--chart-axis)" />
          <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="var(--chart-axis)" />
          {roundTicks.map((round) => (
            <text
              key={round}
              x={x(round)}
              y={bottom + 20}
              textAnchor="middle"
              fill="var(--chart-label)"
              fontSize={12}
            >
              {round}
            </text>
          ))}
          <text
            x={(left + right) / 2}
            y={height - 4}
            textAnchor="middle"
            fill="var(--chart-label)"
            fontSize={12}
          >
            Round
          </text>
          {series.map((item) => {
            const upper = item.bands.map((band) => `${x(band.round)},${y(band.p90)}`);
            const lower = item.bands.map((band) => `${x(band.round)},${y(band.p10)}`).reverse();
            const median = item.bands
              .map((band, index) => `${index === 0 ? 'M' : 'L'}${x(band.round)},${y(band.p50)}`)
              .join(' ');
            return (
              <g key={item.variant.id}>
                <path
                  d={`M${upper.join(' L')} L${lower.join(' L')} Z`}
                  fill={item.style.color}
                  fillOpacity={0.16}
                  stroke="none"
                />
                <path
                  d={median}
                  fill="none"
                  stroke={item.style.color}
                  strokeWidth={2}
                  strokeDasharray={item.style.dash}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="chart-legend">
        {series.map((item) => (
          <li key={item.variant.id}>
            <svg width={38} height={20} aria-hidden="true">
              <line
                x1={0}
                x2={38}
                y1={10}
                y2={10}
                stroke={item.style.color}
                strokeWidth={2}
                strokeDasharray={item.style.dash}
              />
            </svg>
            <span>
              {item.variant.label} ({item.style.dash ? 'dashed' : 'solid'} median line)
            </span>
          </li>
        ))}
      </ul>
      <details className="analysis-table-toggle">
        <summary>View the trajectory as a table</summary>
        <div className="analysis-table-wrap" aria-label="Trajectory values" {...TABLE_REGION}>
          <table className="metrics-table">
            <caption>
              Overall simulated stance by round: 10th percentile, median and 90th percentile of the
              seeded runs (from -1 to +1)
            </caption>
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col">Scenario</th>
                <th scope="col">10th percentile</th>
                <th scope="col">Median</th>
                <th scope="col">90th percentile</th>
              </tr>
            </thead>
            {rounds.map((round) => (
              <tbody key={round}>
                {series.map((item, index) => {
                  const band = item.bands.find((candidate) => candidate.round === round);
                  return band ? (
                    <tr key={item.variant.id}>
                      {index === 0 && (
                        <th scope="rowgroup" rowSpan={series.length}>
                          {round}
                        </th>
                      )}
                      <th scope="row">{item.variant.label}</th>
                      <td>{signedNumber(band.p10)}</td>
                      <td>{signedNumber(band.p50)}</td>
                      <td>{signedNumber(band.p90)}</td>
                    </tr>
                  ) : null;
                })}
              </tbody>
            ))}
          </table>
        </div>
      </details>
    </figure>
  );
}

/** How far the headline moved when each assumption was moved, with the noise of the paired runs and where the assumption came from. */
export function SensitivityBars({ rows }: { rows: SensitivityRow[] }) {
  const reach = Math.max(0.1, ...rows.map((row) => Math.abs(row.shift) + row.standardError));
  const metric = rows[0]?.metric ?? 'Share ending in switch or resist';
  return (
    <figure className="analysis-figure">
      <figcaption>How the result moves when one assumption is moved</figcaption>
      <p className="field-help">
        Measured on the same seeds as the unmoved run, so the noise is only that of each pair. The
        measure is: {metric}. Bars to the right mean more simulated members ended that way.
      </p>
      <ol className="analysis-sens">
        {rows.map((row) => {
          const share = (Math.abs(row.shift) / reach) * 50;
          const whisker = (row.standardError / reach) * 50;
          const origin = ORIGIN[row.assumptionOrigin];
          const unsupported = row.classification === 'assumption-sensitive' && !origin.evidenced;
          return (
            <li
              key={row.id}
              className={unsupported ? 'analysis-sens-row analysis-sens-warn' : 'analysis-sens-row'}
            >
              <div className="analysis-sens-head">
                <strong>{row.label}</strong>
                <span className="analysis-chips">
                  <ToneChip
                    tone={SENSITIVITY[row.classification].tone}
                    label={SENSITIVITY[row.classification].label}
                  />
                  <ToneChip tone={origin.tone} label={origin.label} />
                </span>
              </div>
              <div
                className="analysis-sens-track"
                role="img"
                aria-label={`${row.label}: the simulated share moved by ${signedPoints(row.shift)} points, with noise of about ${Math.round(row.standardError * 100)} points. ${SENSITIVITY[row.classification].label}. ${origin.label}.`}
              >
                <span className="analysis-sens-zero" />
                <span
                  className={`analysis-sens-bar ${row.shift < 0 ? 'analysis-sens-down' : 'analysis-sens-up'}`}
                  style={
                    row.shift < 0
                      ? { right: '50%', width: `${share}%` }
                      : { left: '50%', width: `${share}%` }
                  }
                />
                <span
                  className="analysis-sens-noise"
                  style={{
                    left: `${50 + Math.sign(row.shift || 1) * share - whisker}%`,
                    width: `${whisker * 2}%`,
                  }}
                />
              </div>
              <p className="analysis-sens-text">
                {signedPoints(row.shift)} points of the simulated share (±
                {Math.round(row.standardError * 100)} noise), from {percentText(row.baseMean)}.{' '}
                {SENSITIVITY[row.classification].explain}
              </p>
            </li>
          );
        })}
      </ol>
      <details className="analysis-table-toggle">
        <summary>View the sensitivity as a table</summary>
        <div className="analysis-table-wrap" aria-label="Sensitivity values" {...TABLE_REGION}>
          <table className="metrics-table">
            <caption>Shift of the headline when one assumption is moved, on the same seeds</caption>
            <thead>
              <tr>
                <th scope="col">Assumption moved</th>
                <th scope="col">Base</th>
                <th scope="col">Shift</th>
                <th scope="col">Noise (standard error)</th>
                <th scope="col">Result</th>
                <th scope="col">Where the assumption came from</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.label}</th>
                  <td>{percentText(row.baseMean)}</td>
                  <td>{signedNumber(row.shift)}</td>
                  <td>{row.standardError.toFixed(3)}</td>
                  <td>{SENSITIVITY[row.classification].label}</td>
                  <td>{ORIGIN[row.assumptionOrigin].label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
