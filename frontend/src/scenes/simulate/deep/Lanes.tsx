import { useId, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { useElementSize } from '../../../hooks/useElementSize';
import { stanceColor } from '../../../viz/palette';
import {
  axisRounds,
  countLimit,
  fitFromZero,
  fitSymmetric,
  linePath,
  linear,
  roundAtX,
} from './chart';
import { shareText, stanceText, type ProxyLine, type RoundPoint } from './model';
import './lanes.css';

export interface LanesProps {
  points: readonly RoundPoint[];
  lines: readonly ProxyLine[];
  /** The mean of the proxies' initial inclinations: where the line starts. */
  startMean: number;
  total: number;
  saved: number;
  round: number;
  onSelect: (round: number) => void;
  event: { round: number; applied: boolean } | null;
  /** Rounds 1 to this one were copied from a parent run. */
  copied: number;
  /** Zoom the inclination and polarization to the range they use. */
  zoom: boolean;
  /** One proxy to follow: its line is drawn strong and the others fade. */
  follow: string | null;
  summary: string;
}

const TITLE = 24;
const GAP = 10;
const AXIS = 34;

function Glide({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <g className="sw-deep-lanes__glide" style={{ transform: `translate(${x}px, ${y}px)` }}>
      {children}
    </g>
  );
}

/**
 * The rounds of one platform as four lanes on one shared clock: where the proxies stand (each one thin, the
 * mean strong), how the three shares fall, how far apart they are, and how much they did. Only saved rounds
 * are drawn; the rest of the clock is left empty, so nothing is implied that has not run.
 */
export function Lanes({
  points,
  lines,
  startMean,
  total,
  saved,
  round,
  onSelect,
  event,
  copied,
  zoom,
  follow,
  summary,
}: LanesProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const compact = width < 540;
  const padL = compact ? 38 : 48;
  const padR = compact ? 12 : 18;
  const plotL = padL;
  const plotR = Math.max(padL + 60, width - padR);
  const span = Math.max(total, 1);
  const x = linear([0, span], [plotL, plotR]);
  const step = (plotR - plotL) / span;
  const barWidth = Math.max(4, Math.min(30, step * 0.58));
  const height = compact
    ? { stance: 150, shares: 70, pol: 48, act: 48 }
    : { stance: 184, shares: 80, pol: 58, act: 58 };

  // The flag of an assumed event gets a row of its own above the first lane, so that it never sits on a title.
  const top = 8 + (event ? 26 : 0);
  const stanceTop = top + TITLE;
  const stanceBottom = stanceTop + height.stance;
  const sharesTop = stanceBottom + GAP + TITLE;
  const sharesBottom = sharesTop + height.shares;
  const polTop = sharesBottom + GAP + TITLE;
  const polBottom = polTop + height.pol;
  const actTop = polBottom + GAP + TITLE;
  const actBottom = actTop + height.act;
  const full = actBottom + AXIS;

  const values = [
    startMean,
    ...points.map((point) => point.mean),
    ...lines.flatMap((line) => line.points.map((item) => item.opinion)),
  ];
  const stanceDomain: [number, number] = zoom ? fitSymmetric(values) : [-1, 1];
  const polDomain: [number, number] = zoom
    ? fitFromZero(points.map((point) => point.polarization))
    : [0, 1];
  const actMax = countLimit(points.map((point) => point.actions));
  const yStance = linear(stanceDomain, [stanceBottom, stanceTop]);
  const yShare = linear([0, 1], [sharesBottom, sharesTop]);
  const yPol = linear(polDomain, [polBottom, polTop]);
  const yAct = linear([0, actMax], [actBottom, actTop]);

  const meanLine = [
    { round: 0, mean: startMean },
    ...points.map((point) => ({ round: point.round, mean: point.mean })),
  ];
  const here = points.find((point) => point.round === round) ?? null;
  const at = Math.min(round, Math.max(saved, 0));
  const gradient = `deep-mean-${useId().replace(/[^a-zA-Z0-9]/gu, '')}`;

  const roundOf = (event_: PointerEvent<SVGSVGElement>): number => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return at;
    return Math.min(saved, roundAtX(event_.clientX - box.left, plotL, plotR, span));
  };
  const down = (event_: PointerEvent<SVGSVGElement>) => {
    event_.currentTarget.setPointerCapture(event_.pointerId);
    setDragging(true);
    onSelect(roundOf(event_));
  };
  const move = (event_: PointerEvent<SVGSVGElement>) => {
    if (event_.currentTarget.hasPointerCapture(event_.pointerId)) onSelect(roundOf(event_));
    else if (event_.pointerType === 'mouse') setHover(roundOf(event_));
  };
  const up = (event_: PointerEvent<SVGSVGElement>) => {
    if (event_.currentTarget.hasPointerCapture(event_.pointerId))
      event_.currentTarget.releasePointerCapture(event_.pointerId);
    setDragging(false);
  };

  const ticks = axisRounds(span, plotR - plotL, compact ? 34 : 44);
  const stanceTicks = [stanceDomain[1], 0, stanceDomain[0]];
  const polTicks = [polDomain[1], polDomain[0]];
  const label = (value: number) => stanceText(value, Math.abs(value) >= 1 ? 0 : 2);

  const flagRight = event ? x(event.round) > plotL + (plotR - plotL) * 0.72 : false;
  const lanes = [
    { top: stanceTop, bottom: stanceBottom },
    { top: sharesTop, bottom: sharesBottom },
    { top: polTop, bottom: polBottom },
    { top: actTop, bottom: actBottom },
  ];
  /** A lane's name, and beside it the figure for the round in view. */
  const heading = (top: number, name: string, read: string | null) => (
    <text className="sw-deep-lanes__title" x={plotL} y={top - 10}>
      {name}
      {read && (
        <tspan className="sw-deep-lanes__read" dx={12}>
          {read}
        </tspan>
      )}
    </text>
  );

  return (
    <div className="sw-deep-lanes" ref={ref} data-dragging={dragging || undefined}>
      <svg
        ref={svg}
        role="img"
        aria-label={summary}
        width="100%"
        height={full}
        viewBox={`0 0 ${Math.max(width, 1)} ${full}`}
        preserveAspectRatio="xMinYMin meet"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient
            id={gradient}
            gradientUnits="userSpaceOnUse"
            x1="0"
            x2="0"
            y1={yStance(0.5)}
            y2={yStance(-0.5)}
          >
            <stop offset="0" style={{ stopColor: 'var(--c-favor)' }} />
            <stop offset="0.5" style={{ stopColor: 'var(--c-neutral)' }} />
            <stop offset="1" style={{ stopColor: 'var(--c-against)' }} />
          </linearGradient>
        </defs>

        {saved < total &&
          lanes.map((lane) => (
            <rect
              key={lane.top}
              className="sw-deep-lanes__ahead"
              x={x(saved)}
              y={lane.top}
              width={Math.max(0, plotR - x(saved))}
              height={lane.bottom - lane.top}
            />
          ))}

        {/* Lane titles, scales and rules */}
        {heading(
          stanceTop,
          compact ? 'Inclination' : 'Inclination · the mean, and each proxy thinly',
          here ? `mean ${stanceText(here.mean)}` : null,
        )}
        {stanceTicks.map((tick) => (
          <g key={tick}>
            <line
              className={tick === 0 ? 'sw-deep-lanes__zero' : 'sw-deep-lanes__rule'}
              x1={plotL}
              x2={plotR}
              y1={yStance(tick)}
              y2={yStance(tick)}
            />
            <text
              className="sw-deep-lanes__scale"
              x={plotL - 8}
              y={yStance(tick) + 4}
              textAnchor="end"
            >
              {tick === 0 ? '0' : label(tick)}
            </text>
          </g>
        ))}
        {zoom && !compact && (
          <text className="sw-deep-lanes__scale" x={plotR} y={stanceTop - 10} textAnchor="end">
            zoomed in
          </text>
        )}

        {heading(
          sharesTop,
          compact ? 'Shares' : 'Shares · against, undecided, in favour',
          here && !compact
            ? `${shareText(here.opposition)} · ${shareText(here.undecided)} · ${shareText(here.support)}`
            : null,
        )}
        {[1, 0.5, 0].map((tick) => (
          <g key={tick}>
            <line
              className="sw-deep-lanes__rule"
              x1={plotL}
              x2={plotR}
              y1={yShare(tick)}
              y2={yShare(tick)}
            />
            <text
              className="sw-deep-lanes__scale"
              x={plotL - 8}
              y={yShare(tick) + 4}
              textAnchor="end"
            >
              {shareText(tick)}
            </text>
          </g>
        ))}

        {heading(polTop, 'Polarization', here ? here.polarization.toFixed(2) : null)}
        {polTicks.map((tick) => (
          <g key={tick}>
            <line
              className="sw-deep-lanes__rule"
              x1={plotL}
              x2={plotR}
              y1={yPol(tick)}
              y2={yPol(tick)}
            />
            <text
              className="sw-deep-lanes__scale"
              x={plotL - 8}
              y={yPol(tick) + 4}
              textAnchor="end"
            >
              {tick === 0 ? '0' : tick.toFixed(2)}
            </text>
          </g>
        ))}

        {heading(
          actTop,
          compact ? 'Actions' : 'Actions · posts, replies and updates',
          here ? String(here.actions) : null,
        )}
        {[actMax, 0].map((tick) => (
          <g key={tick}>
            <line
              className="sw-deep-lanes__rule"
              x1={plotL}
              x2={plotR}
              y1={yAct(tick)}
              y2={yAct(tick)}
            />
            <text
              className="sw-deep-lanes__scale"
              x={plotL - 8}
              y={yAct(tick) + 4}
              textAnchor="end"
            >
              {tick}
            </text>
          </g>
        ))}

        {/* Where each round falls on the clock */}
        {ticks.map((tick) => (
          <g key={tick}>
            {lanes.map((lane) => (
              <line
                key={lane.top}
                className="sw-deep-lanes__grid"
                x1={x(tick)}
                x2={x(tick)}
                y1={lane.top}
                y2={lane.bottom}
              />
            ))}
            <text
              className="sw-deep-lanes__scale sw-deep-lanes__tick"
              x={x(tick)}
              y={actBottom + 22}
              textAnchor="middle"
              data-now={tick === at || undefined}
            >
              {tick === 0 ? 'Start' : tick}
            </text>
          </g>
        ))}
        {copied > 0 && (
          <g>
            <line
              className="sw-deep-lanes__copied"
              x1={x(0)}
              x2={x(Math.min(copied, total))}
              y1={actBottom + 8}
              y2={actBottom + 8}
            />
          </g>
        )}

        {/* The data */}
        {lines.map((line) => {
          const last = line.points.at(-1)?.opinion ?? 0;
          return (
            <path
              key={line.id}
              className="sw-deep-lanes__proxy"
              data-follow={follow === null ? undefined : follow === line.id ? 'on' : 'off'}
              d={linePath(
                line.points.map((item) => ({ x: x(item.round), y: yStance(item.opinion) })),
              )}
              style={{ stroke: stanceColor(last, 0.5) }}
              pathLength={1}
            />
          );
        })}
        <path
          className="sw-deep-lanes__mean"
          d={linePath(meanLine.map((item) => ({ x: x(item.round), y: yStance(item.mean) })))}
          stroke={`url(#${gradient})`}
          pathLength={1}
        />
        {meanLine.map((item) => (
          <circle
            key={item.round}
            className="sw-deep-lanes__dot"
            cx={x(item.round)}
            cy={yStance(item.mean)}
            r={item.round === at ? 0 : 2.6}
          />
        ))}

        {points.map((point) => {
          const bottom = yShare(point.opposition);
          const middle = yShare(point.opposition + point.undecided);
          const left = x(point.round) - barWidth / 2;
          return (
            <g
              key={point.round}
              className="sw-deep-lanes__bar"
              data-now={point.round === at || undefined}
            >
              <rect
                className="sw-deep-lanes__seg sw-deep-lanes__seg--against"
                x={left}
                y={bottom}
                width={barWidth}
                height={Math.max(0, sharesBottom - bottom)}
              />
              <rect
                className="sw-deep-lanes__seg sw-deep-lanes__seg--undecided"
                x={left}
                y={middle}
                width={barWidth}
                height={Math.max(0, bottom - middle)}
              />
              <rect
                className="sw-deep-lanes__seg sw-deep-lanes__seg--favour"
                x={left}
                y={sharesTop}
                width={barWidth}
                height={Math.max(0, middle - sharesTop)}
              />
            </g>
          );
        })}

        <path
          className="sw-deep-lanes__pol"
          d={linePath(points.map((point) => ({ x: x(point.round), y: yPol(point.polarization) })))}
          pathLength={1}
        />
        {points.map((point) => (
          <circle
            key={point.round}
            className="sw-deep-lanes__dot sw-deep-lanes__dot--pol"
            cx={x(point.round)}
            cy={yPol(point.polarization)}
            r={point.round === at ? 0 : 2.4}
          />
        ))}

        {points.map((point) => {
          const top = yAct(point.actions);
          return (
            <rect
              key={point.round}
              className="sw-deep-lanes__act"
              data-now={point.round === at || undefined}
              x={x(point.round) - barWidth / 2}
              y={top}
              width={barWidth}
              height={Math.max(point.actions > 0 ? 2 : 0, actBottom - top)}
              rx={2}
            />
          );
        })}

        {/* The assumed event */}
        {event && event.round >= 0 && event.round <= total && (
          <g className="sw-deep-lanes__event" data-applied={event.applied}>
            {lanes.map((lane) => (
              <line
                key={lane.top}
                x1={x(event.round)}
                x2={x(event.round)}
                y1={lane.top - 4}
                y2={lane.bottom}
              />
            ))}
            <path
              d={`M${x(event.round)} ${top + 2}v-22M${x(event.round)} ${top - 20}h${flagRight ? -11 : 11}l${flagRight ? 3 : -3} 4l${flagRight ? -3 : 3} 4h${flagRight ? 11 : -11}`}
            />
            <text
              x={x(event.round) + (flagRight ? -16 : 16)}
              y={top - 9}
              textAnchor={flagRight ? 'end' : 'start'}
            >
              {event.applied ? 'Event applied' : 'Event scheduled'}
            </text>
          </g>
        )}

        {hover !== null && hover !== at && (
          <g className="sw-deep-lanes__ghost">
            {lanes.map((lane) => (
              <line key={lane.top} x1={x(hover)} x2={x(hover)} y1={lane.top} y2={lane.bottom} />
            ))}
          </g>
        )}

        {/* The round in view: a line across every lane, and a point on each line at that round */}
        <g className="sw-deep-lanes__scrub" style={{ transform: `translateX(${x(at)}px)` }}>
          {lanes.map((lane) => (
            <line key={lane.top} x1={0} x2={0} y1={lane.top - 4} y2={lane.bottom + 2} />
          ))}
        </g>
        {lines.map((line) => {
          const found = line.points.find((item) => item.round === at);
          if (!found) return null;
          return (
            <Glide key={line.id} x={x(at)} y={yStance(found.opinion)}>
              <circle
                className="sw-deep-lanes__now"
                data-follow={follow === null ? undefined : follow === line.id ? 'on' : 'off'}
                r={follow === line.id ? 5.5 : 3.6}
                style={{ fill: stanceColor(found.opinion, 0.5) }}
              />
            </Glide>
          );
        })}
        {(() => {
          const found = meanLine.find((item) => item.round === at);
          return found ? (
            <Glide x={x(at)} y={yStance(found.mean)}>
              <circle className="sw-deep-lanes__now-mean" r={6} />
            </Glide>
          ) : null;
        })()}
        {here && (
          <>
            <Glide x={x(at)} y={yPol(here.polarization)}>
              <circle className="sw-deep-lanes__now-pol" r={4.6} />
            </Glide>
          </>
        )}
      </svg>
    </div>
  );
}
