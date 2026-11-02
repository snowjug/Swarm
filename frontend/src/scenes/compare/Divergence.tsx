import { useId, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RunComparison } from '../../../../shared/guided';
import { metricLabels } from '../../lib/metrics';
import { tickLabel } from './format';
import { useInView, useWidth } from './hooks';
import { Segmented } from '../../design/ui';
import { DataTable, type TableSpec } from './parts';
import {
  METRICS,
  isShare,
  metricAxis,
  metricSeries,
  metricText,
  partedRound,
  sharedRounds,
  type Metric,
} from './runs';
import { bandPath, linePath, linear, nearest } from './scale';
import './divergence.css';

const tickText = (value: number, metric: Metric, step: number): string =>
  metric === 'activityCount'
    ? String(Math.round(value))
    : isShare(metric)
      ? `${(value * 100).toFixed(step < 0.01 ? 1 : 0)}%`
      : tickLabel(value, step);

function Chart({
  comparison,
  metric,
  round,
  onRound,
  scrubbing,
}: {
  comparison: RunComparison;
  metric: Metric;
  round: number;
  onRound: (round: number | null) => void;
  scrubbing: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [seenRef, seen] = useInView<HTMLDivElement>('0px 0px -10% 0px');
  const id = useId();
  const series = useMemo(() => metricSeries(comparison, metric), [comparison, metric]);
  const rounds = series.map((point) => point.round);
  const first = rounds[0] ?? 1;
  const last = rounds[rounds.length - 1] ?? first;
  const left = 52;
  const right = 18;
  const top = 30;
  const mainBottom = 186;
  const stripTop = 232;
  const stripBottom = 298;
  const height = 328;
  const x = linear([first, Math.max(last, first + 1)], [left, Math.max(left + 40, width - right)]);
  const values = series.flatMap((point) =>
    point.base !== null && point.other !== null ? [point.base, point.other] : [],
  );
  const axis = metricAxis(values, metric);
  const tickStep =
    axis.ticks.length > 1 ? Math.abs((axis.ticks[1] ?? 0) - (axis.ticks[0] ?? 0)) : 1;
  const y = linear([axis.min, axis.max], [mainBottom, top]);
  const reach = Math.max(1e-9, ...series.map((point) => Math.abs(point.delta ?? 0)));
  const stripMid = (stripTop + stripBottom) / 2;
  const bar = linear([0, reach], [0, (stripBottom - stripTop) / 2 - 4]);
  const parted = partedRound(comparison);
  const stride = Math.max(
    1,
    Math.ceil(rounds.length / Math.max(2, Math.floor((width - left - right) / 46))),
  );
  const complete = series.filter((point) => point.base !== null && point.other !== null);
  const basePoints = complete.map((point) => ({ x: x(point.round), y: y(point.base ?? 0) }));
  const otherPoints = complete.map((point) => ({ x: x(point.round), y: y(point.other ?? 0) }));
  const move = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onRound(nearest(rounds, x.invert(event.clientX - box.left + left)));
  };
  const final = complete[complete.length - 1];
  const label = `${metricLabels[metric]} in each of the ${rounds.length} recorded rounds. ${
    parted === null
      ? 'The two runs are the same in every round.'
      : `The runs are the same through round ${comparison.identicalThroughRound} and part in round ${parted}.`
  } ${
    final && final.delta !== null
      ? `By round ${final.round} the difference, other minus base, is ${metricText(final.delta, metric, true)}.`
      : ''
  } The values are in the table below.`;
  const slot = (width - left - right) / Math.max(rounds.length, 1);

  return (
    <div className="sw-cmp-div__plot" ref={seenRef} data-in={seen || undefined}>
      <div ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-labelledby={`${id}-title`}
          focusable="false"
        >
          <title id={`${id}-title`}>{label}</title>
          <defs>
            <clipPath id={`${id}-wipe`}>
              <rect className="sw-cmp-div__wipe" x={0} y={0} width={width} height={height} />
            </clipPath>
          </defs>
          <g className="sw-cmp-div__grid" aria-hidden="true">
            {axis.ticks.map((tick) => (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
                <text x={left - 10} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                  {tickText(tick, metric, tickStep)}
                </text>
              </g>
            ))}
            {rounds.map((value, index) =>
              index % stride === 0 || index === rounds.length - 1 ? (
                <text key={value} x={x(value)} y={stripBottom + 22} textAnchor="middle">
                  {value}
                </text>
              ) : null,
            )}
          </g>
          {parted !== null && (
            <g
              className="sw-cmp-div__parts"
              transform={`translate(${x(parted - 0.5)} 0)`}
              aria-hidden="true"
            >
              <line y1={top - 10} y2={stripBottom} />
              <text y={top - 16} dx={6}>
                The runs part
              </text>
            </g>
          )}
          <g clipPath={`url(#${id}-wipe)`}>
            <path className="sw-cmp-div__area" d={bandPath(basePoints, otherPoints)} />
            <path className="sw-cmp-div__line" data-side="base" d={linePath(basePoints)} />
            <path className="sw-cmp-div__line" data-side="other" d={linePath(otherPoints)} />
            {complete.map((point) => (
              <g key={point.round} className="sw-cmp-div__marks">
                <circle
                  className="sw-cmp-div__dot"
                  data-side="base"
                  cx={x(point.round)}
                  cy={y(point.base ?? 0)}
                  r={3.4}
                />
                <rect
                  className="sw-cmp-div__dot"
                  data-side="other"
                  x={x(point.round) - 3.2}
                  y={y(point.other ?? 0) - 3.2}
                  width={6.4}
                  height={6.4}
                  rx={1.2}
                />
              </g>
            ))}
            <line
              className="sw-cmp-div__zero"
              x1={left}
              x2={width - right}
              y1={stripMid}
              y2={stripMid}
            />
            {series.map((point) =>
              point.delta === null ? null : (
                <rect
                  key={point.round}
                  className="sw-cmp-div__bar"
                  data-flat={Math.abs(point.delta) < 1e-9 || undefined}
                  x={x(point.round) - Math.max(2, Math.min(slot * 0.42, 16)) / 2}
                  width={Math.max(2, Math.min(slot * 0.42, 16))}
                  y={point.delta >= 0 ? stripMid - bar(Math.abs(point.delta)) : stripMid}
                  height={Math.max(
                    bar(Math.abs(point.delta)),
                    Math.abs(point.delta) < 1e-9 ? 1.5 : 1.5,
                  )}
                  rx={2}
                />
              ),
            )}
          </g>
          <text className="sw-cmp-div__striptitle" x={left} y={stripTop - 12} aria-hidden="true">
            Difference, other minus base
          </text>
          <g
            className="sw-cmp-div__guide"
            aria-hidden="true"
            data-scrub={scrubbing || undefined}
            style={{ transform: `translateX(${x(round)}px)` }}
          >
            <line y1={top - 4} y2={stripBottom} />
          </g>
          <rect
            className="sw-cmp-div__hit"
            x={left}
            y={0}
            width={Math.max(width - left - right, 1)}
            height={stripBottom + 4}
            onPointerDown={move}
            onPointerMove={move}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'touch') onRound(null);
            }}
          />
        </svg>
      </div>
    </div>
  );
}

const tableOf = (comparison: RunComparison): TableSpec => ({
  caption:
    'Per-round recorded values of the two runs and the difference of each. Difference = other minus base. Missing values are not estimated.',
  columns: [
    'Round',
    'Metric',
    `Base: ${comparison.base.name}`,
    `Other: ${comparison.other.name}`,
    'Difference',
  ],
  rows: comparison.rounds.flatMap((round) =>
    METRICS.map((metric) => [
      round.round,
      metricLabels[metric],
      metricText(round.base?.[metric] ?? null, metric),
      metricText(round.other?.[metric] ?? null, metric),
      metricText(round.delta?.[metric] ?? null, metric, true),
    ]),
  ),
});

/**
 * How two recorded runs come apart. The runs are two lines of one metric and the space between them is shaded; under it,
 * the difference in each round is a bar, flat until the round they part. Moving across it reads any round, and the keyboard
 * can too. The differences are recorded values, not effects of anything.
 */
export function Divergence({
  comparison,
  metric,
  onMetric,
}: {
  comparison: RunComparison;
  metric: Metric;
  onMetric: (metric: Metric) => void;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const series = metricSeries(comparison, metric);
  const rounds = series.map((point) => point.round);
  const last = rounds[rounds.length - 1] ?? 1;
  // Until a round is chosen the readout is of the last round both runs recorded.
  const lastBoth = sharedRounds(comparison).at(-1) ?? last;
  const round = scrub !== null && rounds.includes(scrub) ? scrub : lastBoth;
  const point = series.find((entry) => entry.round === round);
  const reading = `Round ${round}: base ${metricText(point?.base ?? null, metric)}, other ${metricText(point?.other ?? null, metric)}, difference ${metricText(point?.delta ?? null, metric, true)}`;
  return (
    <div className="sw-cmp-div">
      <Segmented
        label="Metric"
        size="sm"
        value={metric}
        onChange={onMetric}
        options={METRICS.map((entry) => ({ value: entry, label: metricLabels[entry] }))}
      />
      <div className="sw-cmp-div__readout" aria-hidden="true">
        <p className="sw-cmp-div__round">
          <span className="sw-eyebrow">Round</span>
          <span className="sw-numeral">{round}</span>
        </p>
        <dl>
          <div data-side="base">
            <dt>
              <span className="sw-cmp-div__key" data-side="base" />
              Base
            </dt>
            <dd className="num">{metricText(point?.base ?? null, metric)}</dd>
          </div>
          <div data-side="other">
            <dt>
              <span className="sw-cmp-div__key" data-side="other" />
              Other
            </dt>
            <dd className="num">{metricText(point?.other ?? null, metric)}</dd>
          </div>
          <div data-side="delta">
            <dt>Difference</dt>
            <dd className="num">{metricText(point?.delta ?? null, metric, true)}</dd>
          </div>
        </dl>
      </div>
      <div className="sw-cmp-div__stage">
        <Chart
          comparison={comparison}
          metric={metric}
          round={round}
          onRound={setScrub}
          scrubbing={scrub !== null}
        />
        <input
          className="sr-only sw-cmp-div__slider"
          type="range"
          min={rounds[0]}
          max={last}
          step={1}
          value={round}
          onChange={(event) => setScrub(Number(event.target.value))}
          aria-label="Round to read"
          aria-valuetext={reading}
        />
      </div>
      <DataTable spec={tableOf(comparison)} />
    </div>
  );
}
