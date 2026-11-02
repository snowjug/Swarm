import { useId, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Analysis } from '../../../../shared/analysis';
import { Segmented } from '../../design/ui';
import { vars } from './css';
import { sectionInfo, STANCE_WORDS } from './copy';
import { signed, tickLabel } from './format';
import { useInView, useWidth } from './hooks';
import type { Pair } from './pair';
import { DataTable, Section, type TableSpec } from './parts';
import { bandPath, fitAxis, linePath, linear, nearest, spreadLabels } from './scale';
import type { Scenario } from './scenarios';
import './time.css';

interface Series {
  scenario: Scenario;
  role: 'a' | 'b' | 'other';
  bands: { round: number; p10: number; p50: number; p90: number }[];
  color: string;
  dash: string | undefined;
}

/** What tells one scenario's line from another's besides its name: a colour of its own, and a dash for the reference. */
const ALTERNATIVE_COLOURS = [
  'var(--cat-1)',
  'var(--cat-5)',
  'var(--cat-6)',
  'var(--cat-4)',
  'var(--cat-8)',
  'var(--cat-7)',
  'var(--cat-2)',
] as const;

function seriesOf(analysis: Analysis, scenarios: readonly Scenario[], pair: Pair): Series[] {
  let alternative = 0;
  return scenarios.flatMap((scenario) => {
    const bands =
      analysis.variants.find((result) => result.variantId === scenario.id)?.trajectory ?? [];
    const baseline = scenario.kind === 'baseline';
    const color = baseline
      ? 'var(--ink-2)'
      : ALTERNATIVE_COLOURS[alternative++ % ALTERNATIVE_COLOURS.length]!;
    if (bands.length === 0) return [];
    return [
      {
        scenario,
        role: scenario.id === pair.a ? 'a' : scenario.id === pair.b ? 'b' : 'other',
        bands: [...bands].sort((x, y) => x.round - y.round),
        color,
        dash: baseline ? '6 5' : undefined,
      } satisfies Series,
    ];
  });
}

/** The whole scale of a stance: the same axis every stance chart in the product could be drawn on. */
const WHOLE = { min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1] };

const HEIGHT_MIN = 270;
const HEIGHT_MAX = 400;

function Chart({
  series,
  hidden,
  focus,
  axis,
  round,
  onRound,
  scrubbing,
  seen,
  rounds,
  landing,
}: {
  series: readonly Series[];
  hidden: ReadonlySet<string>;
  focus: string | null;
  axis: { min: number; max: number; ticks: number[] };
  round: number;
  onRound: (round: number | null) => void;
  scrubbing: boolean;
  seen: boolean;
  rounds: number[];
  landing: { round: number; label: string }[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const id = useId();
  const labelled = width >= 620;
  const height = Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, width * 0.4)));
  const left = 46;
  const right = labelled ? 210 : 14;
  const top = 26;
  const bottom = 34;
  const first = rounds[0] ?? 1;
  const last = rounds[rounds.length - 1] ?? first;
  const x = linear([first, last], [left, Math.max(left + 40, width - right)]);
  const y = linear([axis.min, axis.max], [height - bottom, top]);
  const visible = series.filter((entry) => !hidden.has(entry.scenario.id));
  const tickStep =
    axis.ticks.length > 1 ? Math.abs((axis.ticks[1] ?? 0) - (axis.ticks[0] ?? 0)) : 0.25;
  const stride = Math.max(
    1,
    Math.ceil(rounds.length / Math.max(2, Math.floor((width - left - right) / 54))),
  );

  const ends = visible.map((entry) => {
    const band = entry.bands[entry.bands.length - 1];
    return band ? y(band.p50) : y(0);
  });
  const placed = spreadLabels(ends, 15, top + 4, height - bottom - 2);

  const move = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onRound(nearest(rounds, x.invert(event.clientX - box.left + left)));
  };

  return (
    <div className="sw-cmp-time__plot" ref={ref} data-in={seen || undefined}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-labelledby={`${id}-title`}
        focusable="false"
      >
        <title id={`${id}-title`}>
          {`The overall simulated stance round by round, for ${visible.map((entry) => entry.scenario.label).join(', ')}. The line is the median of the seeded runs and the band runs from their 10th to their 90th percentile. The values are in the table below.`}
        </title>
        <defs>
          <clipPath id={`${id}-wipe`}>
            <rect className="sw-cmp-time__wipe" x={0} y={0} width={width} height={height} />
          </clipPath>
        </defs>
        <g className="sw-cmp-time__grid" aria-hidden="true">
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width - right}
                y1={y(tick)}
                y2={y(tick)}
                data-zero={Math.abs(tick) < 1e-9 || undefined}
              />
              <text x={left - 10} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                {tickLabel(tick, tickStep)}
              </text>
            </g>
          ))}
          {rounds.map((value, index) =>
            index % stride === 0 || index === rounds.length - 1 ? (
              <text key={value} x={x(value)} y={height - bottom + 22} textAnchor="middle">
                {value}
              </text>
            ) : null,
          )}
        </g>
        <g className="sw-cmp-time__lands" aria-hidden="true">
          {landing.map((entry, index) => (
            <g key={entry.round} transform={`translate(${x(entry.round)} 0)`}>
              <line y1={top - 6} y2={height - bottom} />
              {index === 0 && (
                <text
                  y={top - 12}
                  textAnchor={x(entry.round) > width - right - 120 ? 'end' : 'start'}
                  dx={x(entry.round) > width - right - 120 ? -6 : 6}
                >
                  {entry.label}
                </text>
              )}
            </g>
          ))}
        </g>
        <g clipPath={`url(#${id}-wipe)`} data-reveal={seen ? 'in' : 'pending'}>
          {series.map((entry) => {
            const off = hidden.has(entry.scenario.id);
            const upper = entry.bands.map((band) => ({ x: x(band.round), y: y(band.p90) }));
            const lower = entry.bands.map((band) => ({ x: x(band.round), y: y(band.p10) }));
            const median = entry.bands.map((band) => ({ x: x(band.round), y: y(band.p50) }));
            const quiet = focus !== null ? focus !== entry.scenario.id : entry.role === 'other';
            return (
              <g
                key={entry.scenario.id}
                className="sw-cmp-time__series"
                data-off={off || undefined}
                data-quiet={quiet || undefined}
                data-role={entry.role}
                style={{ color: entry.color }}
              >
                <path className="sw-cmp-time__band" d={bandPath(upper, lower)} />
                <path
                  className="sw-cmp-time__line"
                  d={linePath(median)}
                  strokeDasharray={entry.dash}
                />
              </g>
            );
          })}
        </g>
        {labelled && (
          <g className="sw-cmp-time__names" aria-hidden="true">
            {visible.map((entry, index) => (
              <text
                key={entry.scenario.id}
                x={width - right + 10}
                y={placed[index]}
                dominantBaseline="middle"
                data-quiet={entry.role === 'other' || undefined}
                style={{ fill: entry.color }}
              >
                {entry.scenario.label.length > 28
                  ? `${entry.scenario.label.slice(0, 27)}…`
                  : entry.scenario.label}
              </text>
            ))}
          </g>
        )}
        <g
          className="sw-cmp-time__guide"
          aria-hidden="true"
          data-scrub={scrubbing || undefined}
          style={{ transform: `translateX(${x(round)}px)` }}
        >
          <line y1={top - 4} y2={height - bottom} />
          {visible.map((entry) => {
            const band = entry.bands.find((candidate) => candidate.round === round);
            return band ? (
              <circle
                key={entry.scenario.id}
                cx={0}
                cy={y(band.p50)}
                r={entry.role === 'other' ? 3.5 : 5}
                style={{ fill: entry.color }}
              />
            ) : null;
          })}
        </g>
        <rect
          className="sw-cmp-time__hit"
          x={left}
          y={0}
          width={Math.max(width - left - right, 1)}
          height={height - bottom + 8}
          onPointerDown={move}
          onPointerMove={move}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch') onRound(null);
          }}
        />
      </svg>
    </div>
  );
}

const tableOf = (series: readonly Series[], rounds: readonly number[]): TableSpec => ({
  caption:
    'Overall simulated stance by round: the median of the seeded runs, with the 10th and 90th percentile (from -1 to +1)',
  columns: ['Round', ...series.map((entry) => entry.scenario.label)],
  rows: rounds.map((round) => [
    round,
    ...series.map((entry) => {
      const band = entry.bands.find((candidate) => candidate.round === round);
      return band
        ? `${signed(band.p50, 3)} (${signed(band.p10, 3)} to ${signed(band.p90, 3)})`
        : 'not kept';
    }),
  ]),
});

/**
 * How the overall stance moves round by round, a line for each scenario's middle run and a band for the spread of
 * runs. Moving across the chart, or the arrow keys on its slider, reads off any round; each scenario can be hidden.
 * The change lands in a round of its own, marked. The scale is the whole one, so that small moves look as small as
 * they are, or can be zoomed to read them.
 */
export function Trajectory({
  analysis,
  scenarios,
  pair,
}: {
  analysis: Analysis;
  scenarios: readonly Scenario[];
  pair: Pair;
}) {
  const [ref, seen] = useInView<HTMLDivElement>('0px 0px -10% 0px');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit');
  const [scrub, setScrub] = useState<number | null>(null);
  const series = useMemo(() => seriesOf(analysis, scenarios, pair), [analysis, scenarios, pair]);
  const rounds = useMemo(
    () =>
      [...new Set(series.flatMap((entry) => entry.bands.map((band) => band.round)))].sort(
        (x, y) => x - y,
      ),
    [series],
  );
  const info = sectionInfo('time');
  if (series.length === 0 || rounds.length === 0) {
    return (
      <Section info={info}>
        <p className="sw-cmp-note">No round-by-round spread was kept for this comparison.</p>
      </Section>
    );
  }
  const visible = series.filter((entry) => !hidden.has(entry.scenario.id));
  const values = visible.flatMap((entry) =>
    entry.bands.flatMap((band) => [band.p10, band.p50, band.p90]),
  );
  const axis = zoom === 'full' ? WHOLE : fitAxis(values);
  const last = rounds[rounds.length - 1] ?? 1;
  const round = scrub !== null && rounds.includes(scrub) ? scrub : last;
  const landing = [
    ...new Map(
      visible
        .filter((entry) => entry.scenario.kind !== 'baseline')
        .sort((x, y) => (x.role === 'b' ? -1 : y.role === 'b' ? 1 : 0))
        .map((entry) => [entry.scenario.round, entry.scenario.round]),
    ).values(),
  ].map((value) => ({ round: value, label: `The change lands, round ${value}` }));

  const toggle = (id: string) =>
    setHidden((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else if (series.length - next.size > 1) next.add(id);
      return next;
    });

  const reading = visible
    .map((entry) => {
      const band = entry.bands.find((candidate) => candidate.round === round);
      return band
        ? `${entry.scenario.label} ${signed(band.p50, 2)}, from ${signed(band.p10, 2)} to ${signed(band.p90, 2)}`
        : null;
    })
    .filter(Boolean)
    .join('; ');

  return (
    <Section
      info={info}
      aside={
        <Segmented
          label="Scale"
          size="sm"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: 'fit', label: 'Zoomed in' },
            { value: 'full', label: '−1 to +1' },
          ]}
        />
      }
    >
      <div className="sw-cmp-time" ref={ref}>
        <div className="sw-cmp-time__readout">
          <p className="sw-cmp-time__round" aria-hidden="true">
            <span className="sw-eyebrow">Round</span>
            <span className="sw-numeral">{round}</span>
          </p>
          <ul
            className="sw-cmp-time__series-list"
            aria-label="Scenarios shown, with their value in the round read"
          >
            {series.map((entry) => {
              const on = !hidden.has(entry.scenario.id);
              const band = entry.bands.find((candidate) => candidate.round === round);
              return (
                <li
                  key={entry.scenario.id}
                  style={vars({ '--series': entry.color })}
                  onPointerEnter={() => setFocus(entry.scenario.id)}
                  onPointerLeave={() => setFocus(null)}
                >
                  <button
                    type="button"
                    className="sw-cmp-time__toggle"
                    aria-pressed={on}
                    onClick={() => toggle(entry.scenario.id)}
                    onFocus={() => setFocus(entry.scenario.id)}
                    onBlur={() => setFocus(null)}
                  >
                    <span className="sw-cmp-time__name">
                      <svg
                        width="22"
                        height="10"
                        viewBox="0 0 22 10"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <line
                          x1="1"
                          x2="21"
                          y1="5"
                          y2="5"
                          stroke="currentColor"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeDasharray={entry.dash}
                        />
                      </svg>
                      {entry.scenario.label}
                    </span>
                    <b className="num" aria-hidden="true">
                      {on && band ? signed(band.p50, 2) : '—'}
                    </b>
                    <span className="sw-cmp-time__spread num" aria-hidden="true">
                      {on && band ? `${signed(band.p10, 2)} to ${signed(band.p90, 2)}` : 'hidden'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="sw-cmp-time__stage">
          <Chart
            series={series}
            hidden={hidden}
            focus={focus}
            axis={axis}
            round={round}
            onRound={setScrub}
            scrubbing={scrub !== null}
            seen={seen}
            rounds={rounds}
            landing={landing}
          />
          <input
            className="sr-only sw-cmp-time__slider"
            type="range"
            min={rounds[0]}
            max={last}
            step={1}
            value={round}
            onChange={(event) => setScrub(Number(event.target.value))}
            aria-label="Round to read"
            aria-valuetext={`Round ${round}: ${reading}`}
          />
        </div>
        <p className="sw-cmp-quiet">
          {STANCE_WORDS}
          {zoom === 'fit' ? ' The chart is zoomed in to the range of the data.' : ''}
        </p>
        <DataTable spec={tableOf(series, rounds)} />
      </div>
    </Section>
  );
}
