import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { PairedRun } from '../model/analysis-model';
import { perHundred, signedPerHundred } from '../model/format';
import { useWidth } from '../hooks';
import './strip.css';

/** A stable number from a seed, so that a dot keeps its place in the strip however often it is drawn. */
function spread(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Every seeded run, one dot, at the difference the change made to the share of simulated members looking for
 * an alternative or resisting, on that run's seed. The line at zero is no difference: dots to its right are
 * runs where the change raised the share. The mean and its standard error are marked on it.
 */
export function PairedStrip({
  runs,
  mean,
  error,
  higher,
  pairs,
  compact = false,
  label,
  intro = false,
  domain,
}: {
  runs: readonly PairedRun[];
  mean: number;
  error: number | null;
  higher: number;
  pairs: number;
  compact?: boolean;
  label: string;
  /** The dots arrive one after another when the strip is first drawn. */
  intro?: boolean;
  /** One scale shared by several strips, so that they can be read against each other. */
  domain?: readonly [number, number];
}) {
  const { ref, width } = useWidth<HTMLDivElement>(560);
  const id = useId();
  const height = compact ? 76 : 132;
  const padX = 14;
  const axis = height - 22;
  const deltas = runs.map((run) => run.delta);
  const low = domain ? Math.min(domain[0], 0) : Math.min(0, ...deltas, mean - (error ?? 0));
  const high = domain ? Math.max(domain[1], 0) : Math.max(0, ...deltas, mean + (error ?? 0));
  const span = high - low || 0.01;
  const margin = span * 0.06;
  const x = (value: number) =>
    padX + ((value - low + margin) / (span + margin * 2)) * (width - padX * 2);
  const zero = x(0);
  const lane = (axis - 14) / 2;
  const ticks = niceTicks(low, high, width < 420 ? 3 : 5);
  const summary = `${runs.length} paired seeded runs of the change against the baseline. The share was higher under the change in ${higher} of ${pairs}. The mean difference is ${signedPerHundred(mean)} in 100 simulated members${error === null ? '' : `, standard error ${perHundred(error)}`}. ${label}`;

  return (
    <figure
      className="sw-decide-strip"
      data-compact={compact || undefined}
      data-intro={intro || undefined}
    >
      <div ref={ref} className="sw-decide-strip__plot">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${id}-t`}
          focusable="false"
        >
          <title id={`${id}-t`}>{summary}</title>
          {error !== null && (
            <rect
              className="sw-decide-strip__band"
              x={x(mean - error)}
              y={8}
              width={Math.max(x(mean + error) - x(mean - error), 2)}
              height={axis - 8}
              rx={3}
            />
          )}
          {ticks.map((tick) => (
            <g key={tick} className="sw-decide-strip__tick">
              <line x1={x(tick)} x2={x(tick)} y1={axis} y2={axis + 5} />
              <text x={x(tick)} y={axis + 18} textAnchor="middle">
                {tick === 0 ? '0' : signedPerHundred(tick)}
              </text>
            </g>
          ))}
          <line className="sw-decide-strip__axis" x1={padX} x2={width - padX} y1={axis} y2={axis} />
          <line className="sw-decide-strip__zero" x1={zero} x2={zero} y1={6} y2={axis} />
          {runs.map((run, index) => {
            const y = 8 + lane + (spread(run.seed) - 0.5) * 2 * (lane - 3);
            const tone = run.delta > 0.0005 ? 'up' : run.delta < -0.0005 ? 'down' : 'same';
            return (
              <circle
                key={run.seed}
                className="sw-decide-strip__dot"
                data-tone={tone}
                cx={x(run.delta)}
                cy={y}
                r={compact ? 3.4 : 4.4}
                style={{ '--i': Math.min(index, 40) } as CSSProperties}
              >
                <title>{`Seed ${run.seed}: ${signedPerHundred(run.delta)} in 100`}</title>
              </circle>
            );
          })}
          <line className="sw-decide-strip__mean" x1={x(mean)} x2={x(mean)} y1={4} y2={axis} />
        </svg>
        <span
          className="sw-decide-strip__mean-label num"
          style={{ left: `${(x(mean) / width) * 100}%` }}
          aria-hidden="true"
        >
          mean {signedPerHundred(mean)}
        </span>
        <span
          className="sw-decide-strip__zero-label"
          style={{ left: `${(zero / width) * 100}%` }}
          aria-hidden="true"
        >
          no difference
        </span>
      </div>
    </figure>
  );
}

/** Round numbers a scale can be read by, in shares: steps of 1, 2 or 5 in 100, and tenths of those. */
function niceTicks(low: number, high: number, wanted: number): number[] {
  const span = (high - low) * 100;
  if (!(span > 0)) return [0];
  const rough = span / wanted;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    ([1, 2, 5, 10].find((candidate) => candidate * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (
    let value = Math.ceil((low * 100) / step) * step;
    value <= high * 100 + 1e-9;
    value += step
  ) {
    ticks.push(Number((value / 100).toFixed(6)));
  }
  return ticks.length > 0 ? ticks : [0];
}

/**
 * The same, from the count alone, where the runs themselves cannot be read: as many dots as there were paired
 * runs, filled for those where the share was higher under the change. A count, not the runs in their order.
 */
export function RunDots({
  higher,
  pairs,
  label,
}: {
  higher: number;
  pairs: number;
  label: string;
}) {
  return (
    <div
      className="sw-decide-dots"
      role="img"
      aria-label={`${higher} of ${pairs} paired seeded runs were higher under the change. ${label}`}
    >
      {Array.from({ length: Math.min(pairs, 200) }, (_, index) => (
        <span
          key={index}
          data-on={index < higher || undefined}
          style={{ '--i': Math.min(index, 40) } as CSSProperties}
        />
      ))}
    </div>
  );
}
