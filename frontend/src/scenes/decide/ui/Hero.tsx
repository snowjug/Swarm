import { useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { ArrowRight, Info, Scale } from 'lucide-react';
import { UNRECORDED_INPUTS_ADVICE } from '../../../../../shared/analysis';
import { BRIEF_SIGNAL_NOTICES, type BriefStatement } from '../../../../../shared/brief';
import type { CritiquesView } from '../../../../../shared/critique';
import {
  Button,
  Chip,
  Disclosure,
  Notice,
  Popover,
  PopoverTrigger,
  Segmented,
  Skeleton,
} from '../../../design/ui';
import { STABILITY_LABELS } from '../../../lib/brief';
import { useCountUp } from '../hooks';
import type { Movement } from '../model/analysis-model';
import {
  answerParts,
  leadIn,
  SIMULATION_NOTE,
  verdictOf,
  type Freshness,
  type HeroModel,
  type HeroRow,
} from '../model/brief-model';
import { tally } from '../model/critique-model';
import {
  dayLabel,
  decimals,
  perHundred,
  plural,
  sentence,
  signedPerHundred,
} from '../model/format';
import { PairedStrip, RunDots } from '../visuals/PairedStrip';
import { useDoc } from './context';
import { DetailPopover } from './DetailPopover';
import { StatementList } from './Statements';
import { OriginMark } from './Provenance';
import { Prose } from './Prose';
import './hero.css';

/** A figure that counts up to its value when it first appears. */
function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  return <>{format(useCountUp(value))}</>;
}

function Numeral({
  tone,
  label,
  figure,
  caption,
  index,
}: {
  tone: 'against' | 'neutral' | 'favor' | 'ink';
  label: ReactNode;
  figure: ReactNode;
  caption: ReactNode;
  index: number;
}) {
  return (
    <div
      className="sw-decide-num sw-rise"
      data-tone={tone}
      style={{ '--i': index + 3 } as CSSProperties}
    >
      <p className="sw-decide-num__label">{label}</p>
      <p className="sw-decide-num__figure sw-numeral num">{figure}</p>
      <p className="sw-decide-num__caption">{caption}</p>
    </div>
  );
}

/** The verdict with the name of the change set in italic, where it appears. */
function Verdict({ row, signal }: { row: HeroRow; signal: HeroModel['signal'] }) {
  const text = verdictOf(row, signal);
  const at = row.unread ? -1 : text.indexOf(row.label);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <em>{row.label}</em>
      {text.slice(at + row.label.length)}
    </>
  );
}

/** The groups that moved most, each as its own share before and after, so that the answer says who. */
function Moved({ rows, runs }: { rows: readonly Movement[]; runs: number }) {
  const top = rows.filter((row) => row.affected).slice(0, 3);
  const scale = Math.max(...rows.map((row) => Math.max(row.share, row.baselineShare)), 0.05);
  if (top.length === 0) {
    return (
      <p className="sw-decide-block__none">
        No simulated group’s own share moved by as much as 1 in 100.
      </p>
    );
  }
  return (
    <ol className="sw-decide-moved" role="list">
      {top.map((row, index) => {
        const keyActor = row.members === 1;
        return (
          <li key={row.actorId} style={{ '--i': index } as CSSProperties}>
            <span className="sw-decide-moved__name">{row.name}</span>
            <span className="sw-decide-moved__track" aria-hidden="true">
              <span
                className="sw-decide-moved__line"
                style={{
                  left: `${(Math.min(row.baselineShare, row.share) / scale) * 100}%`,
                  width: `${(Math.abs(row.share - row.baselineShare) / scale) * 100}%`,
                }}
              />
              <span
                className="sw-decide-moved__dot"
                data-end="base"
                style={{ left: `${(row.baselineShare / scale) * 100}%` }}
              />
              <span
                className="sw-decide-moved__dot"
                data-end="change"
                style={{ left: `${(row.share / scale) * 100}%` }}
              />
            </span>
            <span className="sw-decide-moved__value num">
              {keyActor ? (
                <>
                  <b>{Math.round(row.share * runs)}</b> of {runs} runs
                </>
              ) : (
                <>
                  <b>{perHundred(row.share)}</b> in 100
                </>
              )}
              <span className="sw-decide-moved__from">
                {' '}
                from{' '}
                {keyActor ? Math.round(row.baselineShare * runs) : perHundred(row.baselineShare)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A statement that opens with a label, the label set on a line of its own, with its origin one press away. */
function Labelled({ statement }: { statement: BriefStatement }) {
  const lead = leadIn(statement.text);
  return (
    <>
      {lead ? <strong className="sw-decide-block__label">{lead.label}</strong> : null}
      <Prose text={lead ? sentence(lead.rest) : statement.text} />
      <OriginMark statement={statement} />
    </>
  );
}

function ReviewLine({ view, failed }: { view: CritiquesView | null; failed: boolean }) {
  const { openReview } = useDoc();
  const counts = view?.critiques ? tally(view.critiques.critiques) : null;
  let text: string;
  if (!view)
    text = failed ? 'The independent review could not be read.' : 'Reading the independent review…';
  else if (!counts)
    text = view.analysis
      ? 'No independent review has been run.'
      : 'There is no comparison to review.';
  else if (counts.total === 0)
    text = 'The critics raised nothing. That does not show the analysis is right.';
  else if (counts.open === 0) text = `All ${plural(counts.total, 'criticism')} answered.`;
  else text = `${plural(counts.open, 'criticism')} still open.`;
  return (
    <button type="button" className="sw-decide-reviewline" onClick={() => openReview()}>
      <Scale size={16} aria-hidden="true" />
      <span>{text}</span>
      <span className="sw-decide-reviewline__go">
        {counts ? 'Open the review' : 'Review'} <ArrowRight size={14} aria-hidden="true" />
      </span>
    </button>
  );
}

/** What the figures are and how they were counted: the method, one press away. */
function HowCounted() {
  const { brief } = useDoc();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="sw-decide-how">
          <Info size={14} aria-hidden="true" /> How this is counted
        </button>
      </PopoverTrigger>
      <DetailPopover
        label="How this is counted"
        width="28rem"
        align="start"
        className="sw-decide-howpop"
      >
        <strong>{brief.fidelity.label}</strong>
        <ul role="list">
          {[...brief.methodology.notes, ...brief.fidelity.caveats.slice(0, 2)].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </DetailPopover>
    </Popover>
  );
}

export interface HeroProps {
  hero: HeroModel | null;
  freshness: Freshness;
  may: { generate: boolean; export: boolean };
  generating: boolean;
  onGenerate: () => void;
  onRerun: () => void;
  review: { view: CritiquesView | null; failed: boolean };
  tools: ReactNode;
  comparisonRunning: boolean;
  /** The row of tools, so that the page can tell when it has gone by and keep them in reach. */
  topRef: RefObject<HTMLDivElement | null>;
}

/**
 * The first screen: what happened, why, and what matters. The question, the sentence that answers it, the
 * four numbers it rests on, who moved and how steadily, and what to do first. Everything below it is the
 * same answer in more depth.
 */
export function Hero({
  hero,
  freshness,
  may,
  generating,
  onGenerate,
  onRerun,
  review,
  tools,
  comparisonRunning,
  topRef,
}: HeroProps) {
  const { brief, visuals, facts, factsLoading } = useDoc();
  const [selected, setSelected] = useState<string | null>(null);
  const [answerOpen, setAnswerOpen] = useState(false);
  const executive = brief.sections.find((section) => section.id === 'executive-answer');
  const statements: readonly BriefStatement[] = executive?.statements ?? [];
  const parts = answerParts(statements);
  const row = hero
    ? (hero.rows.find((entry) => entry.variantId === selected) ?? hero.rows[0] ?? null)
    : null;
  const paired = row ? facts?.paired[row.variantId] : undefined;
  const movement = row ? facts?.movement[row.variantId] : undefined;
  const signal = hero?.signal ?? brief.signal;
  const notice = signal === 'clear' ? null : BRIEF_SIGNAL_NOTICES[signal];
  const finding = row?.findingId
    ? visuals?.lookups.findings.find((entry) => entry.id === row.findingId)
    : undefined;
  const recommendation = parts.recommendation?.[0];
  const caveat = parts.caveat?.[0];
  const tone: 'against' | 'favor' | 'neutral' =
    !row || row.unread || row.direction === null || row.direction === 'same'
      ? 'neutral'
      : row.direction === 'higher'
        ? 'against'
        : 'favor';

  return (
    <header
      className="sw-decide-hero"
      id="brief-answer"
      tabIndex={-1}
      data-tone={tone}
      aria-labelledby="brief-answer-title"
    >
      <div className="sw-decide-hero__top sw-rise" ref={topRef}>
        <div className="sw-decide-hero__chips">
          <span className="sw-eyebrow">Decision brief</span>
          <Chip size="sm">Made {dayLabel(brief.generatedAt)}</Chip>
          {!freshness.current && (
            <Chip size="sm" tone="caution" dot>
              Out of date
            </Chip>
          )}
          {signal !== 'clear' && (
            <Chip size="sm" tone="caution">
              {signal === 'no-direction'
                ? 'Cannot tell the change from no change'
                : 'No measurable difference'}
            </Chip>
          )}
          {comparisonRunning && (
            <Chip size="sm" tone="accent" dot>
              A new comparison is running
            </Chip>
          )}
        </div>
        {tools}
      </div>

      {!freshness.current && (
        <Notice
          tone="caution"
          className="sw-decide-hero__notice sw-rise"
          title="This brief may be out of date"
          action={
            freshness.action === 'rerun' && may.generate ? (
              <Button
                size="sm"
                variant="glass"
                iconEnd={<ArrowRight size={14} aria-hidden="true" />}
                onClick={onRerun}
              >
                Re-run the comparison
              </Button>
            ) : freshness.action === 'regenerate' && may.generate ? (
              <Button
                size="sm"
                variant="glass"
                iconEnd={<ArrowRight size={14} aria-hidden="true" />}
                busy={generating}
                busyLabel="Writing the brief"
                onClick={onGenerate}
              >
                Write the brief again
              </Button>
            ) : null
          }
        >
          {freshness.summary}
          {freshness.unrecorded ? ` ${UNRECORDED_INPUTS_ADVICE}` : ''}
          {freshness.chartsFromNow
            ? ' Its charts show the project as it is now, not as it was when the brief was made.'
            : ''}
          {!may.generate
            ? ' Ask someone who can edit this exploration to bring it up to date.'
            : ''}
        </Notice>
      )}

      <div className="sw-decide-hero__main">
        <p className="sw-decide-hero__question sw-rise" style={{ '--i': 1 } as CSSProperties}>
          {brief.question}
        </p>

        <h1
          id="brief-answer-title"
          className="sw-display sw-decide-verdict sw-rise"
          data-written={!row || undefined}
          style={{ '--i': 2 } as CSSProperties}
        >
          {row && hero ? <Verdict row={row} signal={hero.signal} /> : brief.headline}
        </h1>

        <p className="sw-decide-hero__nature sw-rise" style={{ '--i': 3 } as CSSProperties}>
          <Info size={14} aria-hidden="true" />
          <span>{SIMULATION_NOTE}</span>
        </p>

        {notice && (
          <p className="sw-decide-hero__signal sw-rise" style={{ '--i': 3 } as CSSProperties}>
            {notice.text}
          </p>
        )}

        {row && hero ? (
          <section
            className="sw-decide-hero__happened"
            aria-labelledby="hero-happened"
            data-unread={row.unread || undefined}
          >
            <div className="sw-decide-hero__heading">
              <h2
                id="hero-happened"
                className="sw-eyebrow sw-rise"
                style={{ '--i': 3 } as CSSProperties}
              >
                What happened
              </h2>
              {hero.rows.length > 1 && (
                <Segmented
                  size="sm"
                  label="Which change to read"
                  value={row.variantId}
                  onChange={setSelected}
                  options={hero.rows.map((entry) => ({
                    value: entry.variantId,
                    label: entry.label,
                  }))}
                />
              )}
            </div>
            <div
              className="sw-decide-numerals"
              role="group"
              aria-label={`The comparison of ${row.label} with ${row.baselineLabel}`}
            >
              <Numeral
                index={0}
                tone={tone === 'neutral' ? 'ink' : tone}
                label={<>Under {row.label}</>}
                figure={<CountUp value={row.share * 100} format={(v) => perHundred(v / 100)} />}
                caption="in 100 simulated members look for an alternative or resist"
              />
              {row.baselineShare !== null && (
                <Numeral
                  index={1}
                  tone="neutral"
                  label={<>Under {row.baselineLabel}</>}
                  figure={
                    <CountUp value={row.baselineShare * 100} format={(v) => perHundred(v / 100)} />
                  }
                  caption="in 100, with nothing changed"
                />
              )}
              {row.delta !== null && row.error !== null && (
                <Numeral
                  index={2}
                  tone={tone === 'neutral' ? 'ink' : tone}
                  label="Paired difference"
                  figure={
                    <CountUp value={row.delta * 100} format={(v) => signedPerHundred(v / 100)} />
                  }
                  caption={
                    <>
                      in 100, on the same seeds · standard error{' '}
                      <span className="num">{perHundred(row.error)}</span>
                    </>
                  }
                />
              )}
              {row.delta !== null && row.pairedRuns > 0 && (
                <Numeral
                  index={3}
                  tone="ink"
                  label="Higher under the change"
                  figure={
                    <>
                      <CountUp value={row.higherIn} format={(v) => String(Math.round(v))} />
                      <small> of {row.pairedRuns}</small>
                    </>
                  }
                  caption="paired seeded runs"
                />
              )}
            </div>
            {row.unread && (
              <p className="sw-decide-hero__unread">
                <Info size={15} aria-hidden="true" /> These figures are not read as an effect of the
                change.
              </p>
            )}
            {row.delta !== null && (
              <div className="sw-decide-hero__strip sw-rise" style={{ '--i': 6 } as CSSProperties}>
                {paired ? (
                  <PairedStrip
                    runs={paired.runs}
                    mean={paired.mean}
                    error={paired.error}
                    higher={paired.higher}
                    pairs={paired.runs.length}
                    label={`Each dot is one seeded run, paired with the baseline on the same seed.`}
                    compact
                    intro
                  />
                ) : factsLoading ? (
                  <Skeleton height="3rem" radius="var(--r-md)" />
                ) : row.pairedRuns > 0 ? (
                  <RunDots
                    higher={row.higherIn}
                    pairs={row.pairedRuns}
                    label="Each dot is one paired seeded run."
                  />
                ) : null}
                <p className="sw-decide-hero__fine">
                  {brief.fidelity.label} · {plural(hero.runsPerVariant, 'seeded run')} of{' '}
                  {plural(brief.methodology.rounds, 'round')}. Each dot is one seeded run. Simulated
                  members are synthetic stand-ins for groups, not people.
                </p>
              </div>
            )}
          </section>
        ) : (
          <p className="sw-decide-hero__fine sw-rise">
            The figures behind this answer are no longer stored, so it is shown as it was written.
          </p>
        )}
      </div>

      <div className="sw-decide-hero__side">
        <section
          className="sw-decide-block sw-rise"
          aria-labelledby="hero-why"
          style={{ '--i': 7 } as CSSProperties}
        >
          <h2 id="hero-why" className="sw-eyebrow">
            Why
          </h2>
          {row && hero && movement ? (
            <div>
              <p className="sw-decide-block__lead">Who moved most</p>
              <Moved rows={movement} runs={hero.runsPerVariant} />
            </div>
          ) : factsLoading && row ? (
            <div className="sw-decide-block__skeleton" aria-hidden="true">
              <Skeleton height="1.1rem" />
              <Skeleton height="1.1rem" width="86%" />
              <Skeleton height="1.1rem" width="72%" />
            </div>
          ) : parts.groups?.[0] ? (
            <p className="sw-decide-block__text">
              <Prose text={parts.groups[0].text} />
              <OriginMark statement={parts.groups[0]} />
            </p>
          ) : null}
          {row && (finding || row.classification) && (
            <p className="sw-decide-block__steady">
              <span className="sw-decide-block__lead">How steady</span>
              <span>
                {finding ? (
                  <>
                    Held in <b className="num">{finding.holdsIn}</b> of{' '}
                    <b className="num">{finding.of}</b> seeded runs ·{' '}
                    {STABILITY_LABELS[finding.classification]} · interval{' '}
                    <span className="num">
                      {decimals(finding.interval.lo)} to {decimals(finding.interval.hi)}
                    </span>
                  </>
                ) : row.classification && row.holdsIn !== null && row.of !== null ? (
                  <>
                    Held in <b className="num">{row.holdsIn}</b> of <b className="num">{row.of}</b>{' '}
                    seeded runs · {STABILITY_LABELS[row.classification]}
                  </>
                ) : null}
              </span>
            </p>
          )}
        </section>

        <section
          className="sw-decide-block sw-rise"
          aria-labelledby="hero-matters"
          style={{ '--i': 8 } as CSSProperties}
        >
          <h2 id="hero-matters" className="sw-eyebrow">
            What matters
          </h2>
          {recommendation && (
            <p className="sw-decide-block__text">
              <Labelled statement={recommendation} />
            </p>
          )}
          {caveat && (
            <p className="sw-decide-block__text" data-caveat>
              <Labelled statement={caveat} />
            </p>
          )}
          {!recommendation && !caveat && brief.recommendations[0] && (
            <p className="sw-decide-block__text">{brief.recommendations[0].text}</p>
          )}
          <ReviewLine view={review.view} failed={review.failed} />
        </section>
      </div>

      <div className="sw-decide-hero__foot sw-rise" style={{ '--i': 9 } as CSSProperties}>
        <HowCounted />
        <Disclosure
          heading={2}
          className="sw-decide-hero__full"
          summary={`The answer in full · ${plural(statements.length, 'statement')}`}
          open={answerOpen}
          onOpenChange={setAnswerOpen}
        >
          <StatementList
            statements={statements}
            show={statements.length}
            label="The executive answer"
            style="labelled"
          />
        </Disclosure>
      </div>
    </header>
  );
}
