import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { Intervention, RoundSnapshot, SimulationReport } from '../../../../shared/types';
import { cx } from '../../design/cx';
import { useReducedMotion, useTween } from '../../design/motion';
import { Disclosure } from '../../design/ui';
import { useElementSize } from '../../hooks/useElementSize';
import {
  STANCE_THRESHOLD,
  describeTrajectory,
  finalSplit,
  nearestIndex,
  percentOf,
  shiftWord,
  signedNumber,
  trajectory,
  trajectoryDomain,
  trajectoryGeometry,
  type TrajectoryPoint,
} from './model';
import './Figures.css';

/** Where a value on the −1 to +1 scale sits on a track, as a share of its width. */
const along = (value: number): number => ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100;

/** A number that matters, in the serif, easing to its figure. */
function Numeral({ value, format }: { value: number; format: (value: number) => string }) {
  const shown = useTween(value);
  return <span className="sw-fig__numeral sw-numeral num">{format(shown)}</span>;
}

/** The mean inclination: where it began and ended on the whole scale, so that a small move looks small. */
function MeanFigure({ initial, final }: { initial: number; final: number }) {
  const word = shiftWord(initial, final);
  const side =
    final > STANCE_THRESHOLD / 4 ? 'favor' : final < -STANCE_THRESHOLD / 4 ? 'against' : 'neutral';
  return (
    <div className="sw-fig">
      <p className="sw-fig__label">Mean inclination</p>
      <Numeral value={final} format={(value) => signedNumber(value, 2)} />
      <div className="sw-fig__track" aria-hidden="true">
        <span className="sw-fig__axis" />
        <span className="sw-fig__zero" />
        <span
          className="sw-fig__span"
          style={{
            left: `${Math.min(along(initial), along(final))}%`,
            width: `${Math.abs(along(final) - along(initial))}%`,
          }}
        />
        <span className="sw-fig__dot sw-fig__dot--from" style={{ left: `${along(initial)}%` }} />
        <span
          className="sw-fig__dot sw-fig__dot--to"
          data-side={side}
          style={
            {
              left: `${along(initial)}%`,
              '--delta': along(final) - along(initial),
            } as CSSProperties
          }
        />
      </div>
      <p className="sw-fig__ends" aria-hidden="true">
        <span>Against</span>
        <span>In favour</span>
      </p>
      <p className="sw-fig__note">
        From <span className="num">{signedNumber(initial, 2)}</span>: {word}
      </p>
    </div>
  );
}

/** Where the actors ended: one bar cut three ways, and the same three numbers in words. */
function SplitFigure({ metrics }: { metrics: SimulationReport['metrics'] }) {
  const split = finalSplit(metrics);
  const parts = [
    { key: 'support', label: 'Supportive', share: split.support },
    { key: 'undecided', label: 'Undecided', share: split.undecided },
    { key: 'opposition', label: 'Opposing', share: split.opposition },
  ] as const;
  return (
    <div className="sw-fig">
      <p className="sw-fig__label">Where the actors ended</p>
      <div
        className="sw-fig__split"
        role="img"
        aria-label={`Final split: ${parts.map((part) => `${percentOf(part.share)}% ${part.label.toLowerCase()}`).join(', ')}`}
      >
        {parts.map((part) => (
          <span
            key={part.key}
            className={`sw-fig__cut sw-fig__cut--${part.key}`}
            style={{ flexGrow: Math.max(part.share, 0.004) }}
          />
        ))}
      </div>
      <ul className="sw-fig__legend" role="list">
        {parts.map((part) => (
          <li key={part.key} className={`sw-fig__key sw-fig__key--${part.key}`}>
            <span className="sw-fig__swatch" aria-hidden="true" />
            <span className="num sw-fig__pct">{percentOf(part.share)}%</span>
            <span>{part.label}</span>
          </li>
        ))}
      </ul>
      <p className="sw-fig__note">
        Supportive is {signedNumber(STANCE_THRESHOLD, 1)} or more, opposing{' '}
        {signedNumber(-STANCE_THRESHOLD, 1)} or less.
      </p>
    </div>
  );
}

function CountFigure({
  label,
  value,
  note,
  format = (count) => Math.round(count).toLocaleString('en-GB'),
}: {
  label: string;
  value: number;
  note: string;
  format?: (value: number) => string;
}) {
  return (
    <div className="sw-fig">
      <p className="sw-fig__label">{label}</p>
      <Numeral value={value} format={format} />
      <p className="sw-fig__note">{note}</p>
    </div>
  );
}

const PAD = { left: 40, right: 12, top: 14, bottom: 28 };

/** The scrubbable line of the mean inclination across the recorded rounds. */
function Trajectory({
  points,
  intervention,
}: {
  points: TrajectoryPoint[];
  intervention: Pick<Intervention, 'round' | 'label'> | null;
}) {
  const reduced = useReducedMotion();
  const { ref, width } = useElementSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [drawn, setDrawn] = useState(reduced);
  const height = width < 520 ? 160 : 210;
  const innerWidth = Math.max(width - PAD.left - PAD.right, 40);
  const innerHeight = height - PAD.top - PAD.bottom;
  const domain = useMemo(() => trajectoryDomain(points), [points]);
  const geometry = useMemo(
    () => trajectoryGeometry(points, { width: innerWidth, height: innerHeight }, domain),
    [points, innerWidth, innerHeight, domain],
  );
  const last = points.length - 1;
  const shown = active ?? last;
  const point = points[shown];

  useEffect(() => {
    // The line is drawn once the chart is on screen, not while it is still below the fold.
    const node = ref.current;
    if (!node || reduced || typeof IntersectionObserver === 'undefined') {
      setDrawn(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setDrawn(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, reduced]);

  if (!point) return null;

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(nearestIndex(event.clientX - box.left - PAD.left, innerWidth, points.length));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : last);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      setActive((current) => Math.min(last, Math.max(0, (current ?? last) + step)));
    } else if (event.key === 'Escape') setActive(null);
  };
  const interventionAt = intervention
    ? points.findIndex((entry) => entry.round === intervention.round)
    : -1;
  const marker = interventionAt >= 0 ? (geometry.xs[interventionAt] ?? 0) : null;
  const area = `${geometry.line} L${innerWidth} ${geometry.zero} L0 ${geometry.zero} Z`;
  const ticks = [domain, 0, -domain];

  return (
    <div className="sw-traj">
      <div className="sw-traj__head">
        <p className="sw-fig__label">Mean inclination, round by round</p>
        <p className="sw-traj__readout num" aria-live={focused ? 'polite' : 'off'}>
          <span className="sw-traj__round">Round {point.round}</span>
          <span className="sw-traj__mean">{signedNumber(point.mean, 3)}</span>
          <span className="sw-traj__muted">
            {percentOf(point.support)}% supportive · {percentOf(point.opposition)}% opposing
          </span>
        </p>
      </div>
      <div
        ref={ref}
        className={cx('sw-traj__chart', drawn && 'is-drawn')}
        role="group"
        tabIndex={0}
        aria-label={`${describeTrajectory(points)} Use the left and right arrow keys to move between rounds.`}
        onKeyDown={keys}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setActive(null);
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          focusable="false"
          onPointerMove={move}
          onPointerLeave={() => setActive(null)}
        >
          <defs>
            <clipPath id="sw-traj-above">
              <rect x="0" y="0" width={innerWidth} height={geometry.zero} />
            </clipPath>
            <clipPath id="sw-traj-below">
              <rect
                x="0"
                y={geometry.zero}
                width={innerWidth}
                height={Math.max(innerHeight - geometry.zero, 0)}
              />
            </clipPath>
          </defs>
          <g transform={`translate(${PAD.left} ${PAD.top})`}>
            {ticks.map((tick) => {
              const y = geometry.zero - (tick / domain) * (innerHeight / 2);
              return (
                <g key={tick}>
                  <line
                    className={cx('sw-traj__grid', tick === 0 && 'is-zero')}
                    x1="0"
                    x2={innerWidth}
                    y1={y}
                    y2={y}
                  />
                  <text
                    className="sw-traj__tick num"
                    x="-8"
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {tick === 0 ? '0' : signedNumber(tick, 2)}
                  </text>
                </g>
              );
            })}
            <path
              className="sw-traj__area sw-traj__area--favor"
              clipPath="url(#sw-traj-above)"
              d={area}
            />
            <path
              className="sw-traj__area sw-traj__area--against"
              clipPath="url(#sw-traj-below)"
              d={area}
            />
            {marker !== null && (
              <g>
                <line className="sw-traj__marker" x1={marker} x2={marker} y1="0" y2={innerHeight} />
                <text className="sw-traj__tag" x={marker + 6} y="10">
                  Intervention
                </text>
              </g>
            )}
            <path className="sw-traj__line" d={geometry.line} pathLength={1} />
            {active !== null && (
              <line
                className="sw-traj__guide"
                x1={geometry.xs[active]}
                x2={geometry.xs[active]}
                y1="0"
                y2={innerHeight}
              />
            )}
            {points.map((entry, index) => (
              <circle
                key={entry.round}
                className={cx('sw-traj__dot', index === shown && 'is-on')}
                cx={geometry.xs[index]}
                cy={geometry.ys[index]}
                r={index === shown ? 5 : 3}
                style={{ animationDelay: `${400 + index * 55}ms` }}
              />
            ))}
            {points.map((entry, index) =>
              index === 0 || index === last || points.length <= 9 ? (
                <text
                  key={entry.round}
                  className="sw-traj__tick num"
                  x={geometry.xs[index]}
                  y={innerHeight + 19}
                  textAnchor={index === 0 ? 'start' : index === last ? 'end' : 'middle'}
                >
                  {entry.round}
                </text>
              ) : null,
            )}
          </g>
        </svg>
      </div>
      <p className="sw-traj__legend">
        {intervention
          ? `Intervention at round ${intervention.round}: ${intervention.label}. `
          : 'No intervention was scheduled. '}
        The chart spans {signedNumber(-domain, 2)} to {signedNumber(domain, 2)} of the whole −1 to
        +1 scale.
      </p>
      <Disclosure summary="Round by round, as a table">
        <div className="sw-traj__table-wrap">
          <table className="sw-traj__table">
            <caption className="sr-only">Recorded rounds</caption>
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col">Mean</th>
                <th scope="col">Supportive</th>
                <th scope="col">Undecided</th>
                <th scope="col">Opposing</th>
                <th scope="col">Polarisation</th>
              </tr>
            </thead>
            <tbody>
              {points.map((entry) => (
                <tr key={entry.round}>
                  <th scope="row" className="num">
                    {entry.round}
                  </th>
                  <td className="num">{signedNumber(entry.mean, 3)}</td>
                  <td className="num">{percentOf(entry.support)}%</td>
                  <td className="num">{percentOf(entry.undecided)}%</td>
                  <td className="num">{percentOf(entry.opposition)}%</td>
                  <td className="num">{entry.polarization.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * The run in a few numbers, set large and drawn on the page: where the mean inclination began and ended,
 * how the actors divided, how far apart they were and how many exposures there were, and the line of the
 * mean across the rounds. They are the recorded figures of a simulation, not a forecast.
 */
export function Figures({
  metrics,
  rounds,
  intervention,
}: {
  metrics: SimulationReport['metrics'];
  rounds: readonly RoundSnapshot[];
  intervention: Intervention | null;
}) {
  const points = useMemo(() => trajectory(rounds), [rounds]);
  const scheduled = rounds.find((round) => round.intervention)?.intervention ?? intervention;
  return (
    <div className="sw-figs">
      <div className="sw-figs__row">
        <MeanFigure initial={metrics.initialMean} final={metrics.finalMean} />
        <SplitFigure metrics={metrics} />
        <CountFigure
          label="Polarisation"
          value={metrics.polarization}
          note="Spread between the actors"
          format={(value) => value.toFixed(2)}
        />
        <CountFigure
          label="Exposures"
          value={metrics.totalInteractions}
          note="Simulated peer exposures"
        />
      </div>
      {points.length > 1 && <Trajectory points={points} intervention={scheduled} />}
    </div>
  );
}
