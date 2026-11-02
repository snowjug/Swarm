import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Analysis, RunOutcome } from '../../../../shared/analysis';
import { chainOf, rankFindings, type ChainStep } from '../../lib/analysis';
import { sectionInfo } from './copy';
import { secondOrderFindings } from './chain';
import { useCompare } from './context';
import { countText, signed, tickLabel } from './format';
import { useInView, useWidth } from './hooks';
import { DataTable, Section, StabilityChip, type TableSpec } from './parts';
import { fitAxis, linePath, linear } from './scale';
import type { Scenario } from './scenarios';
import './chain.css';

const SHOWN = 12;

/** What the run recorded of an event, in its own terms: its id and what it names as its causes and what came before. */
function rawOf(run: RunOutcome, id: string): string {
  const event = run.events.find((entry) => entry.id === id);
  if (!event) return id;
  const causes = event.causedBy.length > 0 ? event.causedBy.join(', ') : 'none';
  const before = (event.followed ?? []).length > 0 ? (event.followed ?? []).join(', ') : 'none';
  return `${event.id} · ${event.kind} · causedBy: ${causes} · followed: ${before}${run.explained ? ' · explained' : ''}`;
}

/**
 * The overall stance of this one run, round by round, with a pin at each round an event happened and a dotted line at
 * the round the change lands. It is the run read in detail, not an average: the same line as the middle one of the chart
 * above would be only by chance.
 */
function Timeline({
  run,
  steps,
  landing,
  focus,
  onFocus,
}: {
  run: RunOutcome;
  steps: readonly ChainStep[];
  landing: number | null;
  focus: string | null;
  onFocus: (id: string | null) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [seenRef, seen] = useInView<HTMLDivElement>('0px 0px -10% 0px');
  const id = useId();
  const rounds = run.rounds.map((round) => round.round);
  const first = rounds[0] ?? 1;
  const last = rounds[rounds.length - 1] ?? first;
  const height = 196;
  const left = 50;
  const right = 18;
  const top = 34;
  const bottom = 34;
  const axis = fitAxis(run.rounds.map((round) => round.stanceMean));
  const tickStep =
    axis.ticks.length > 1 ? Math.abs((axis.ticks[1] ?? 0) - (axis.ticks[0] ?? 0)) : 0.05;
  const x = linear([first, Math.max(last, first + 1)], [left, Math.max(left + 40, width - right)]);
  const y = linear([axis.min, axis.max], [height - bottom, top]);
  const stride = Math.max(
    1,
    Math.ceil(rounds.length / Math.max(2, Math.floor((width - left - right) / 46))),
  );
  return (
    <div className="sw-cmp-tl" ref={seenRef} data-in={seen || undefined}>
      <div ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-labelledby={`${id}-title`}
          focusable="false"
        >
          <title id={`${id}-title`}>
            {`The overall stance of the one run read in detail, round by round, with ${steps.length} ${steps.length === 1 ? 'event' : 'events'} marked at the round each happened. The values are in the table below.`}
          </title>
          <g className="sw-cmp-tl__grid" aria-hidden="true">
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
            {rounds.map((round, index) =>
              index % stride === 0 || index === rounds.length - 1 ? (
                <text key={round} x={x(round)} y={height - bottom + 20} textAnchor="middle">
                  {round}
                </text>
              ) : null,
            )}
          </g>
          {landing !== null && rounds.includes(landing) && (
            <g
              className="sw-cmp-tl__lands"
              transform={`translate(${x(landing)} 0)`}
              aria-hidden="true"
            >
              <line y1={top - 8} y2={height - bottom} />
              <text y={top - 14} dx={6}>
                The change lands, round {landing}
              </text>
            </g>
          )}
          <path
            className="sw-cmp-tl__line"
            d={linePath(run.rounds.map((round) => ({ x: x(round.round), y: y(round.stanceMean) })))}
            pathLength={1}
          />
          <g className="sw-cmp-tl__pins">
            {steps.map((step, index) => (
              <g
                key={step.id}
                transform={`translate(${x(step.round)} 0)`}
                data-focus={focus === step.id || undefined}
                onPointerEnter={() => onFocus(step.id)}
                onPointerLeave={() => onFocus(null)}
              >
                <line y1={top + 8} y2={height - bottom} />
                <circle cy={top + 2} r={10} />
                <text y={top + 2} textAnchor="middle" dominantBaseline="central">
                  {index + 1}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * One event, in words that claim no more than the run showed: what its responder watched, what a replay showed it
 * needed (only in a run that was replayed), and what only came before it and is not shown to have mattered.
 */
function Step({
  step,
  number,
  focused,
  onFocus,
  advanced,
  raw,
}: {
  step: ChainStep;
  number: number;
  focused: boolean;
  onFocus: (id: string | null) => void;
  advanced: boolean;
  raw: string;
}) {
  const signals = step.because.filter((cause) => cause.kind === 'signal');
  const needed = step.because.filter((cause) => cause.kind === 'event');
  return (
    <li
      className="sw-cmp-step"
      data-focus={focused || undefined}
      onPointerEnter={() => onFocus(step.id)}
      onPointerLeave={() => onFocus(null)}
    >
      <div className="sw-cmp-step__when">
        <span className="sw-cmp-step__no num" aria-hidden="true">
          {number}
        </span>
        <p className="sw-cmp-step__round">
          <span className="sw-eyebrow">Round</span>
          <span className="sw-numeral">{step.round}</span>
        </p>
      </div>
      <div className="sw-cmp-step__body">
        <h3 className="sw-cmp-step__title">
          {step.kind}
          {step.actor ? <span> by {step.actor}</span> : null}
        </h3>
        <p className="sw-cmp-step__because">
          {signals.length > 0 ? (
            <>
              <b>Because</b> {signals.map((cause) => cause.text).join(' and ')} it watches reached
              its threshold, <b>then</b> a simulated “{step.kind}” event:{' '}
            </>
          ) : (
            <>A simulated “{step.kind}” event: </>
          )}
          {step.description}
        </p>
        {needed.length > 0 && (
          <p className="sw-cmp-step__note">
            It could not have happened without {needed.map((cause) => cause.text).join(' and ')}: a
            replay of this run without that responder had no such event by then.
          </p>
        )}
        {advanced && <p className="sw-cmp-step__engine sw-mono">{raw}</p>}
        {step.followed.length > 0 && (
          <p className="sw-cmp-step__note">
            It came after {step.followed.join(' and ')}, which had already reached actors it
            watches;{' '}
            {step.tested
              ? 'a replay of this run without it still had the event, so it is not shown to have mattered'
              : 'nothing here shows that it mattered'}
            .
          </p>
        )}
      </div>
    </li>
  );
}

const tableOf = (run: RunOutcome, steps: readonly ChainStep[]): TableSpec => ({
  caption:
    'The overall stance of the one run read in detail in each round (from -1 to +1), and the events that happened in it',
  columns: ['Round', 'Overall stance', 'Events'],
  rows: run.rounds.map((round) => [
    round.round,
    signed(round.stanceMean, 3),
    steps
      .filter((step) => step.round === round.round)
      .map((step) => `${step.kind}${step.actor ? ` by ${step.actor}` : ''}`)
      .join('; ') || 'none',
  ]),
});

/**
 * What the change sets off, in one run read event by event, and how often events like them occurred across all the
 * runs. It says plainly that this is one run, the one nearest the median under the proposed change, and not the answer.
 */
export function Chain({
  analysis,
  scenarios,
}: {
  analysis: Analysis;
  scenarios: readonly Scenario[];
}) {
  const { advanced } = useCompare();
  const [all, setAll] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const info = sectionInfo('sets-off');
  const run = analysis.representativeRun;
  if (!run) {
    return (
      <Section info={info}>
        <p className="sw-cmp-note">
          No run was kept in detail for this comparison, so there is no chain to read.
        </p>
      </Section>
    );
  }
  const label =
    scenarios.find((scenario) => scenario.id === run.variantId)?.label ?? 'the proposed change';
  const steps = chainOf(run, analysis.actors);
  const landing = analysis.config.variants.find((variant) => variant.id === run.variantId);
  const across = rankFindings(
    secondOrderFindings(analysis.findings, run.variantId),
    analysis.config.variants,
  ).slice(0, 4);
  const shown = all ? steps : steps.slice(0, SHOWN);

  return (
    <Section info={info}>
      <div className="sw-cmp-chain">
        <p className="sw-cmp-note">
          This is one seeded run, seed <b className="num">{run.seed}</b>: the one whose overall
          stance was nearest the median under {label}. It shows how a chain can unfold. It is not
          the answer, and the findings above say how often each kind of event occurred across all
          the runs.
        </p>
        {steps.length === 0 ? (
          <p className="sw-cmp-note">No simulated follow-on events occurred in this run.</p>
        ) : (
          <>
            <Timeline
              run={run}
              steps={steps}
              landing={landing && landing.kind !== 'baseline' ? landing.round : null}
              focus={focus}
              onFocus={setFocus}
            />
            <ol className="sw-cmp-chain__steps" aria-label="Events of the run, in order">
              {shown.map((step, index) => (
                <Step
                  key={step.id}
                  step={step}
                  number={index + 1}
                  focused={focus === step.id}
                  onFocus={setFocus}
                  advanced={advanced}
                  raw={rawOf(run, step.id)}
                />
              ))}
            </ol>
            {steps.length > SHOWN && (
              <button type="button" className="sw-cmp-more" onClick={() => setAll((old) => !old)}>
                {all ? 'Show fewer' : `Show the other ${countText(steps.length - SHOWN)} events`}
                <ChevronDown size={16} aria-hidden="true" data-up={all || undefined} />
              </button>
            )}
          </>
        )}
        {across.length > 0 && (
          <div className="sw-cmp-chain__across">
            <h3 className="sw-eyebrow">How often, across all the runs</h3>
            <ul>
              {across.map((finding) => (
                <li key={finding.id}>
                  <p>{finding.statement}</p>
                  <StabilityChip classification={finding.classification} size="sm" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {steps.length > 0 && <DataTable spec={tableOf(run, steps)} />}
    </Section>
  );
}
