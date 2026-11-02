import { useMemo, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useElementSize } from '../../hooks/useElementSize';
import { ChipButton, Disclosure, IconButton } from '../../design/ui';
import type { Analysis } from '../../../../shared/analysis';
import { signedNumber } from '../../lib/analysis';
import { niceAxis, seriesOf, type Replay } from './model';
import './timeline.css';

const M = { left: 52, right: 20, top: 26, bottom: 44 };
const HEIGHT = 380;

export interface TimelineChartProps {
  analysis: Analysis;
  replay: Replay | null;
  round: number;
  onSeek: (round: number) => void;
  /** Plays the cursor along the rounds, where a run was kept to play. */
  play?: { playing: boolean; atEnd: boolean; toggle: () => void } | null;
}

/**
 * The spread of the overall stance, round by round, for every scenario: a line for the middle run and a soft band for the
 * range most runs fall in (the 10th to the 90th of the seeded runs). The round shown is a cursor that a press, a drag
 * or the arrow keys move; the same figures are in a table under it. Nothing here is a forecast: it is how the runs spread.
 */
export function TimelineChart({ analysis, replay, round, onSeek, play }: TimelineChartProps) {
  const series = useMemo(() => seriesOf(analysis), [analysis]);
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const { ref, width } = useElementSize<HTMLDivElement>();
  const shown = series.filter((item) => !off.has(item.id));
  const runId = 'typical-run';
  const runShown = Boolean(replay) && !off.has(runId);
  const rounds = series[0]?.points.map((point) => point.round) ?? [];
  const first = rounds[0] ?? 1;
  const last = rounds[rounds.length - 1] ?? first + 1;
  const axis = useMemo(
    () =>
      niceAxis([
        ...shown.flatMap((item) => item.points.flatMap((point) => [point.p10, point.p90])),
        ...(runShown && replay ? replay.rounds.map((entry) => entry.stanceMean) : []),
      ]),
    [shown, runShown, replay],
  );
  const inner = { w: Math.max(width - M.left - M.right, 80), h: HEIGHT - M.top - M.bottom };
  const x = (r: number): number => M.left + ((r - first) / Math.max(last - first, 1)) * inner.w;
  const y = (v: number): number =>
    M.top + (1 - (v - axis.min) / Math.max(axis.max - axis.min, 0.0001)) * inner.h;
  const change =
    replay?.changeRound ??
    analysis.config.variants.find((variant) => variant.kind === 'alternative')?.round ??
    null;
  const cursor = Math.min(Math.max(round, first), last);

  const roundAt = (event: PointerEvent<SVGSVGElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.round(
      first +
        Math.min(1, Math.max(0, (event.clientX - box.left - M.left) / Math.max(inner.w, 1))) *
          (last - first),
    );
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageDown: -3, PageUp: 3 };
    if (event.key in by) {
      event.preventDefault();
      onSeek(Math.min(last, Math.max(first, cursor + by[event.key]!)));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onSeek(first);
    } else if (event.key === 'End') {
      event.preventDefault();
      onSeek(last);
    }
  };
  const toggle = (id: string) =>
    setOff((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else if (id === runId || series.filter((item) => !next.has(item.id)).length > 1) next.add(id);
      return next;
    });

  const summary = shown.map((item) => {
    const end = item.points[item.points.length - 1]!;
    return `${item.label} ends near ${signedNumber(end.p50)} (most runs between ${signedNumber(end.p10)} and ${signedNumber(end.p90)})`;
  });
  const every = inner.w / Math.max(last - first, 1) < 34 ? 2 : 1;

  return (
    <div className="sw-tl">
      <ul className="sw-tl__legend" aria-label="Scenarios">
        {series.map((item) => (
          <li key={item.id}>
            <ChipButton
              pressed={!off.has(item.id)}
              onClick={() => toggle(item.id)}
              aria-label={`${item.label}: ${off.has(item.id) ? 'hidden' : 'shown'}`}
            >
              <svg className="sw-tl__swatch" viewBox="0 0 22 8" aria-hidden="true">
                <line
                  x1="1"
                  x2="21"
                  y1="4"
                  y2="4"
                  stroke={item.colour}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={item.dash}
                />
              </svg>
              {item.label}
            </ChipButton>
          </li>
        ))}
        {replay && (
          <li>
            <ChipButton
              pressed={runShown}
              onClick={() => toggle(runId)}
              aria-label={`The run you watched: ${runShown ? 'shown' : 'hidden'}`}
            >
              <svg className="sw-tl__swatch" viewBox="0 0 22 8" aria-hidden="true">
                <line x1="1" x2="21" y1="4" y2="4" className="sw-tl__run-key" />
                <circle cx="6" cy="4" r="1.8" className="sw-tl__run-dot" />
                <circle cx="16" cy="4" r="1.8" className="sw-tl__run-dot" />
              </svg>
              The run you watched
            </ChipButton>
          </li>
        )}
        {replay && replay.events.length > 0 && (
          <li className="sw-tl__key">
            <svg
              className="sw-tl__swatch sw-tl__swatch--event"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path d="M6 0 L12 6 L6 12 L0 6 Z" />
            </svg>
            Set off in that run
          </li>
        )}
      </ul>

      <div ref={ref} className="sw-tl__plot">
        <svg
          className="sw-tl__svg"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="slider"
          tabIndex={0}
          aria-label="Overall stance by round. Use the arrow keys to move through the rounds."
          aria-valuemin={first}
          aria-valuemax={last}
          aria-valuenow={cursor}
          aria-valuetext={`Round ${cursor}. ${shown.map((item) => `${item.label} ${signedNumber(item.points.find((point) => point.round === cursor)?.p50 ?? 0)}`).join('; ')}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onSeek(roundAt(event));
          }}
          onPointerMove={(event) =>
            event.currentTarget.hasPointerCapture(event.pointerId) && onSeek(roundAt(event))
          }
          onKeyDown={key}
        >
          <g className="sw-tl__grid" aria-hidden="true">
            {axis.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={M.left}
                  x2={width - M.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? 'is-zero' : undefined}
                />
                <text x={M.left - 10} y={y(tick) + 4} textAnchor="end">
                  {tick > 0 ? `+${tick.toFixed(2)}` : tick.toFixed(2)}
                </text>
              </g>
            ))}
            {rounds.map((r, index) =>
              index % every === 0 ? (
                <text
                  key={r}
                  x={x(r)}
                  y={HEIGHT - M.bottom + 22}
                  textAnchor="middle"
                  className="sw-tl__round"
                >
                  {r}
                </text>
              ) : null,
            )}
            <text
              x={M.left + inner.w / 2}
              y={HEIGHT - 6}
              textAnchor="middle"
              className="sw-tl__axis"
            >
              Round
            </text>
            <text x={M.left - 10} y={12} textAnchor="start" className="sw-tl__axis">
              Overall stance
            </text>
          </g>

          {change !== null && change >= first && change <= last && (
            <g aria-hidden="true" className="sw-tl__change">
              <line x1={x(change)} x2={x(change)} y1={M.top - 6} y2={HEIGHT - M.bottom} />
              <text x={x(change) + 6} y={M.top + 4}>
                The change lands
              </text>
            </g>
          )}

          <g className="sw-tl__draw">
            {shown.map((item) => {
              const band = `${item.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.round).toFixed(1)} ${y(point.p90).toFixed(1)}`).join('')}${[
                ...item.points,
              ]
                .reverse()
                .map((point) => `L${x(point.round).toFixed(1)} ${y(point.p10).toFixed(1)}`)
                .join('')}Z`;
              const line = item.points
                .map(
                  (point, index) =>
                    `${index === 0 ? 'M' : 'L'}${x(point.round).toFixed(1)} ${y(point.p50).toFixed(1)}`,
                )
                .join('');
              return (
                <g key={item.id} className="sw-tl__series" style={{ color: item.colour }}>
                  <path className="sw-tl__band" d={band} />
                  <path className="sw-tl__line" d={line} strokeDasharray={item.dash} />
                </g>
              );
            })}
            {runShown && replay && (
              <g className="sw-tl__run" aria-hidden="true">
                <path
                  className="sw-tl__run-line"
                  d={replay.rounds
                    .map(
                      (entry, index) =>
                        `${index === 0 ? 'M' : 'L'}${x(entry.round).toFixed(1)} ${y(entry.stanceMean).toFixed(1)}`,
                    )
                    .join('')}
                />
                {replay.rounds.map((entry) => (
                  <circle
                    key={entry.round}
                    className="sw-tl__run-dot"
                    cx={x(entry.round)}
                    cy={y(entry.stanceMean)}
                    r="2.6"
                  />
                ))}
              </g>
            )}
          </g>

          {replay &&
            [...replay.eventsByRound].map(([r, list]) => (
              <g
                key={r}
                className="sw-tl__event"
                transform={`translate(${x(r)} ${HEIGHT - M.bottom - 8})`}
              >
                <title>{`${list.length} set off in round ${r} of the typical run`}</title>
                <path d="M0 -6 L6 0 L0 6 L-6 0 Z" />
              </g>
            ))}

          <g
            className="sw-tl__cursor"
            aria-hidden="true"
            style={{ transform: `translateX(${x(cursor).toFixed(1)}px)` }}
          >
            <line x1="0" x2="0" y1={M.top - 6} y2={HEIGHT - M.bottom} />
            {shown.map((item) => {
              const point = item.points.find((entry) => entry.round === cursor);
              return point ? (
                <circle
                  key={item.id}
                  className="sw-tl__dot"
                  cx="0"
                  cy="0"
                  r="5"
                  style={{
                    fill: item.colour,
                    transform: `translateY(${y(point.p50).toFixed(1)}px)`,
                  }}
                />
              ) : null;
            })}
          </g>
        </svg>
        <div className="sw-tl__bar">
          {play && (
            <IconButton
              label={play.playing ? 'Pause' : play.atEnd ? 'Play again' : 'Play the rounds'}
              tone="accent"
              size="md"
              pressed={play.playing}
              onClick={play.toggle}
            >
              {play.playing ? (
                <Pause size={18} aria-hidden="true" />
              ) : play.atEnd ? (
                <RotateCcw size={18} aria-hidden="true" />
              ) : (
                <Play size={18} aria-hidden="true" />
              )}
            </IconButton>
          )}
          <p className="sw-tl__read" aria-hidden="true">
            <span className="sw-eyebrow">Round {cursor}</span>
            {shown.map((item) => {
              const point = item.points.find((entry) => entry.round === cursor);
              return point ? (
                <span
                  key={item.id}
                  className="sw-tl__readout"
                  style={{ '--c': item.colour } as React.CSSProperties}
                >
                  <i />
                  {item.label} <b className="sw-mono">{signedNumber(point.p50)}</b>
                </span>
              ) : null;
            })}
          </p>
        </div>
      </div>
      <p className="sw-caption sw-tl__note">
        Middle run and the range most runs fall in (10th to 90th), over seeded runs of each
        scenario. How the runs spread under the stated assumptions, not a forecast.
      </p>
      <p className="sr-only">{summary.join('. ')}</p>

      <Disclosure summary="The figures">
        <div className="sw-tl__tablewrap">
          <table className="sw-tl__table">
            <caption className="sr-only">
              Overall stance by round: the middle run, and the range of the 10th to the 90th of the
              seeded runs
            </caption>
            <thead>
              <tr>
                <th scope="col">Round</th>
                {shown.map((item) => (
                  <th key={item.id} scope="col">
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r} className={r === cursor ? 'is-now' : undefined}>
                  <th scope="row">{r}</th>
                  {shown.map((item) => {
                    const point = item.points.find((entry) => entry.round === r);
                    return (
                      <td key={item.id}>
                        {point ? (
                          <>
                            <span className="sw-mono">{signedNumber(point.p50)}</span>
                            <small>
                              {' '}
                              ({signedNumber(point.p10)} to {signedNumber(point.p90)})
                            </small>
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </div>
  );
}
