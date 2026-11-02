import { useId } from 'react';
import { adverseShare } from '../../lib/analysis';
import type { Analysis } from '../../../../shared/analysis';
import { linear, shareAxis } from './scale';
import { useInView, useWidth } from './hooks';
import { pointsPhrase, rangeText, shareText } from './format';
import { gapTone, type Gap } from './scenarios';
import './gap.css';

const HEIGHT = 136;
const TRACK = 74;
const BRACKET = 34;
const PAD = 14;

const runsOf = (analysis: Analysis, id: string): number[] =>
  analysis.variants
    .find((result) => result.variantId === id)
    ?.runs.map((run) => adverseShare(run.responseShares)) ?? [];

/**
 * The two scenarios on one line, as the share of simulated members who look for an alternative or resist. Every
 * seeded run is a tick at its own share, so the spread is seen and not summarised; a bar spans the middle 80% of
 * the runs, a mark sits at the mean, and the bracket above says how far apart the two means are. When the pair
 * is changed the ticks and marks glide to their new places.
 */
export function GapChart({
  analysis,
  gap,
  digits,
}: {
  analysis: Analysis;
  gap: Gap;
  digits: 0 | 1;
}) {
  const [outer, seen] = useInView<HTMLDivElement>('0px 0px -8% 0px');
  const [ref, width] = useWidth<HTMLDivElement>();
  const id = useId();
  const { a, b } = gap;
  const runsA = runsOf(analysis, a.id);
  const runsB = runsOf(analysis, b.id);
  const axis = shareAxis(
    Math.max(...runsA, ...runsB, a.adverse, b.adverse, a.spread.p90, b.spread.p90),
  );
  const x = linear([0, axis.max], [PAD, Math.max(PAD + 40, width - PAD)]);
  const at = (value: number): number => (seen ? x(value) : x(0));
  const tone = gapTone(gap.delta);
  const left = Math.min(a.adverse, b.adverse);
  const right = Math.max(a.adverse, b.adverse);
  const bracketLeft = at(left);
  const bracketWidth = Math.max(at(right) - at(left), 0.0001);
  const label = `${a.label}: on average ${shareText(a.adverse, digits)} of the simulated members look for an alternative or resist, the middle 80% of ${a.runs} seeded runs between ${rangeText(a.spread.p10, a.spread.p90, digits)}. ${b.label}: ${shareText(b.adverse, digits)}, the middle 80% of ${b.runs} runs between ${rangeText(b.spread.p10, b.spread.p90, digits)}. The difference is ${pointsPhrase(gap.delta, digits)}.`;

  return (
    <div className="sw-cmp-gap" data-tone={tone} ref={outer}>
      <div className="sw-cmp-gap__fit" ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          role="img"
          aria-labelledby={`${id}-label`}
          focusable="false"
        >
          <title id={`${id}-label`}>{label}</title>
          <g className="sw-cmp-gap__axis" aria-hidden="true">
            {axis.ticks.map((tick) => (
              <g key={tick} transform={`translate(${x(tick)} 0)`}>
                <line y1={TRACK - 5} y2={TRACK + 5} />
                <text y={TRACK + 27} textAnchor="middle">
                  {shareText(tick, axis.max < 0.1 ? 1 : 0)}
                </text>
              </g>
            ))}
            <line className="sw-cmp-gap__track" x1={PAD} x2={width - PAD} y1={TRACK} y2={TRACK} />
          </g>
          {(
            [
              { side: 'a', scenario: a, runs: runsA },
              { side: 'b', scenario: b, runs: runsB },
            ] as const
          ).map(({ side, scenario, runs }) => (
            <g key={side} className="sw-cmp-gap__series" data-side={side} aria-hidden="true">
              <rect
                className="sw-cmp-gap__band"
                x={0}
                y={TRACK - 7}
                width={1}
                height={14}
                style={{
                  transform: `translateX(${at(scenario.spread.p10)}px) scaleX(${Math.max(at(scenario.spread.p90) - at(scenario.spread.p10), 2)})`,
                }}
              />
              {runs.map((value, index) => (
                <line
                  key={index}
                  className="sw-cmp-gap__run"
                  y1={TRACK - 11}
                  y2={TRACK + 11}
                  style={{
                    transform: `translateX(${at(value)}px)`,
                    transitionDelay: `${Math.min(index * 14, 380)}ms`,
                  }}
                />
              ))}
              <g
                className="sw-cmp-gap__mean"
                style={{ transform: `translateX(${at(scenario.adverse)}px)` }}
              >
                {side === 'b' && <circle className="sw-cmp-gap__halo" cy={TRACK} r={17} />}
                <circle className="sw-cmp-gap__dot" cy={TRACK} r={side === 'b' ? 9 : 8} />
              </g>
            </g>
          ))}
          <g className="sw-cmp-gap__bracket" aria-hidden="true">
            <rect
              className="sw-cmp-gap__rule"
              x={0}
              y={BRACKET - 0.75}
              width={1}
              height={1.5}
              style={{ transform: `translateX(${bracketLeft}px) scaleX(${bracketWidth})` }}
            />
            {[bracketLeft, bracketLeft + bracketWidth].map((position, index) => (
              <rect
                key={index}
                className="sw-cmp-gap__cap"
                x={-0.75}
                y={BRACKET}
                width={1.5}
                height={9}
                style={{ transform: `translateX(${position}px)` }}
              />
            ))}
            <text
              y={BRACKET - 11}
              textAnchor="middle"
              style={{ transform: `translateX(${bracketLeft + bracketWidth / 2}px)` }}
            >
              {pointsPhrase(gap.delta, digits)}
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
