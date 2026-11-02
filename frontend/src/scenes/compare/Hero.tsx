import type { ReactNode, RefObject } from 'react';
import { ArrowDown, HelpCircle } from 'lucide-react';
import type { Analysis, Finding } from '../../../../shared/analysis';
import {
  Button,
  IconButton,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../design/ui';
import { STABILITY } from '../../lib/analysis';
import { vars } from './css';
import type { Answers } from './answers';
import {
  ADVERSE_WORDS,
  REPEATABILITY_NOTE,
  SECTIONS,
  SIMULATED_NOTE,
  pairedCountText,
  verdictWords,
} from './copy';
import { GapChart } from './GapChart';
import { useArrival, useInView } from './hooks';
import { countText, plural, precisionOf, signed } from './format';
import { PairName, type PairControl } from './PairMenu';
import { RepeatMeter, StabilityChip } from './parts';
import { gapTone, type Gap } from './scenarios';
import './hero.css';

export interface HeroProps {
  analysis: Analysis;
  control: PairControl;
  gap: Gap | null;
  finding: Finding | null;
  answers: Answers;
  /** What `directionNotice` says, if anything, and whether the change can move anyone at all. */
  notice: string | null;
  noEffect: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onJump: (id: string) => void;
  onReview: () => void;
  /** Where this comparison stands against the project as it is now, when that is worth saying. */
  fresh?: ReactNode;
}

/** The sentence the page leads with. It claims only what the runs show, and nothing about a change that cannot move anyone. */
function Headline({
  gap,
  control,
  noEffect,
}: {
  gap: Gap | null;
  control: PairControl;
  noEffect: boolean;
}) {
  if (!gap) {
    return (
      <>
        One scenario was simulated:{' '}
        <span className="sw-cmp-nowrap">
          <PairName side="a" control={control} />.
        </span>
      </>
    );
  }
  if (noEffect) return <>Nothing in this change can move anyone.</>;
  const tone = gap.verdict === 'less' ? 'against' : gap.verdict === 'more' ? 'favor' : 'neutral';
  const verdict = (
    <span className="sw-cmp-hl" data-tone={tone}>
      {verdictWords(gap.verdict)}
    </span>
  );
  if (gap.verdict === 'same') {
    return (
      <>
        Simulated members end up {verdict} under <PairName side="b" control={control} /> and under{' '}
        <span className="sw-cmp-nowrap">
          <PairName side="a" control={control} />.
        </span>
      </>
    );
  }
  return (
    <>
      Under{' '}
      <span className="sw-cmp-nowrap">
        <PairName side="b" control={control} />,
      </span>{' '}
      simulated members end up {verdict} than under{' '}
      <span className="sw-cmp-nowrap">
        <PairName side="a" control={control} />.
      </span>
    </>
  );
}

function Sub({
  gap,
  finding,
  noEffect,
}: {
  gap: Gap | null;
  finding: Finding | null;
  noEffect: boolean;
}) {
  if (!gap) return <>There is nothing to set it against.</>;
  if (noEffect) return <>Every difference below is noise.</>;
  if (finding) {
    return (
      <>
        {finding.classification === 'unstable' || finding.classification === 'rare'
          ? 'The runs do not agree: it held in '
          : 'It held in '}
        <b className="num">{finding.holdsIn}</b> of <b className="num">{finding.of}</b> seeded runs,
        on the same seeds.
      </>
    );
  }
  if (gap.paired > 0) {
    return (
      <>
        Set against each other on <b className="num">{gap.paired}</b> shared seeds.
      </>
    );
  }
  return <>No seed was run in both, so the two are set against each other as averages.</>;
}

function Figure({
  side,
  label,
  value,
  digits,
  caption,
  mark,
}: {
  side: 'a' | 'b' | 'gap';
  label: ReactNode;
  value: number;
  digits: 0 | 1;
  caption?: ReactNode;
  mark?: 'a' | 'b';
}) {
  const [ref, seen] = useInView<HTMLDivElement>('0px 0px -4% 0px');
  const points = useArrival(value * 100, seen);
  const isGap = side === 'gap';
  const tiny =
    !isGap &&
    value > 0 &&
    Number(points.toFixed(digits)) === 0 &&
    Math.abs(points - value * 100) < 1e-6;
  const text = isGap ? signed(points, digits) : tiny ? '<0.1' : points.toFixed(digits);
  return (
    <div className="sw-cmp-fig" data-side={side} ref={ref}>
      <p className="sw-cmp-fig__num sw-numeral" aria-hidden="true">
        {text}
        <span className="sw-cmp-fig__unit">{isGap ? ' points' : '%'}</span>
      </p>
      <p className="sw-cmp-fig__cap">
        {mark && <span className="sw-cmp-mark" data-side={mark} aria-hidden="true" />}
        {label}
      </p>
      {caption && <p className="sw-cmp-fig__more">{caption}</p>}
    </div>
  );
}

function Figures({ gap, analysis }: { gap: Gap; analysis: Analysis }) {
  const digits = precisionOf([gap.a.adverse, gap.b.adverse]);
  const tone = gapTone(gap.delta);
  const moved = gap.delta > 0.0005 || gap.delta < -0.0005;
  return (
    <div className="sw-cmp-figs" data-tone={tone}>
      <div className="sw-cmp-figs__head">
        <p className="sw-eyebrow">Simulated members who {ADVERSE_WORDS}</p>
        <Popover>
          <PopoverTrigger asChild>
            <IconButton label="How to read this" size="sm">
              <HelpCircle size={16} aria-hidden="true" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent width="21rem" align="start">
            <p className="sw-eyebrow">How to read this</p>
            <p className="sw-cmp-figs__help">
              Each tick is one of {countText(gap.b.runs)} seeded runs, placed at the share of
              simulated members who {ADVERSE_WORDS} in it. The bar spans the middle 80% of the runs
              and the dot is their average. The bracket is the difference between the two averages.
            </p>
          </PopoverContent>
        </Popover>
      </div>
      <div className="sw-cmp-figs__row">
        <Figure side="a" mark="a" label={gap.a.label} value={gap.a.adverse} digits={digits} />
        <Figure side="b" mark="b" label={gap.b.label} value={gap.b.adverse} digits={digits} />
        <Figure
          side="gap"
          label={
            moved ? (
              <span>
                <b>{gap.delta > 0 ? 'more' : 'fewer'}</b> than under {gap.a.label}
              </span>
            ) : (
              <span>
                <b>no difference</b> from {gap.a.label}
              </span>
            )
          }
          value={gap.delta}
          digits={digits}
        />
      </div>
      <GapChart analysis={analysis} gap={gap} digits={digits} />
    </div>
  );
}

function Answer({
  id,
  eyebrow,
  big,
  caption,
  children,
  onJump,
  tone,
}: {
  id: string;
  eyebrow: string;
  big: ReactNode;
  caption: ReactNode;
  children?: ReactNode;
  onJump: (id: string) => void;
  tone?: string;
}) {
  return (
    <a
      href={`#${id}`}
      className="sw-cmp-answer"
      data-tone={tone}
      onClick={(event) => {
        event.preventDefault();
        onJump(id);
      }}
    >
      <span className="sw-cmp-answer__eyebrow sw-eyebrow">{eyebrow}</span>
      <span className="sw-cmp-answer__big">{big}</span>
      <span className="sw-cmp-answer__cap">{caption}</span>
      {children}
      <ArrowDown className="sw-cmp-answer__go" size={16} aria-hidden="true" />
    </a>
  );
}

const capital = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

function Answers({
  answers,
  control,
  noEffect,
  onJump,
}: {
  answers: Answers;
  control: PairControl;
  noEffect: boolean;
  onJump: (id: string) => void;
}) {
  const bLabel = control.scenarios.find((scenario) => scenario.id === control.pair.b)?.label ?? '';
  const { moves, setsOff, sure } = answers;
  if (noEffect) {
    return (
      <div className="sw-cmp-answers" data-quiet="true">
        <Answer
          id="movers"
          eyebrow="Moves most"
          onJump={onJump}
          big="No one"
          caption="The change cannot move anyone, so no move below is its result."
        />
        <Answer
          id="sets-off"
          eyebrow="Sets off"
          onJump={onJump}
          big="Nothing"
          caption="An event in these runs is not something the change set off."
        />
        <Answer
          id="holds"
          eyebrow="How sure"
          onJump={onJump}
          big="Nothing to rate"
          caption="While every difference is noise, there is no result to be sure of."
        />
      </div>
    );
  }
  return (
    <div className="sw-cmp-answers">
      <Answer
        id="movers"
        eyebrow="Moves most"
        onJump={onJump}
        big={moves.mover ? moves.mover.name : moves.known ? 'Nobody' : 'Not kept'}
        caption={
          moves.mover ? (
            <>
              Stance <span className="num">{signed(moves.mover.a)}</span> to{' '}
              <span className="num">{signed(moves.mover.b)}</span>, a move of{' '}
              <span className="num">{signed(moves.mover.delta)}</span>.
            </>
          ) : moves.known ? (
            'No simulated actor’s stance moved by as much as half a point.'
          ) : (
            'Results for each actor were not kept in this comparison.'
          )
        }
      />
      <Answer
        id="sets-off"
        eyebrow="Sets off"
        onJump={onJump}
        big={
          setsOff.kind === 'event'
            ? capital(setsOff.event)
            : setsOff.kind === 'counted'
              ? 'Follow-on events'
              : 'Nothing further'
        }
        caption={
          setsOff.kind === 'event' ? (
            <>
              {setsOff.actor ? `By ${setsOff.actor} in` : 'In'} round {setsOff.round} of the run
              read in detail
              {setsOff.across ? (
                <>
                  ; seen in <span className="num">{setsOff.across.holdsIn}</span> of{' '}
                  <span className="num">{setsOff.across.of}</span> seeded runs.
                </>
              ) : (
                '.'
              )}
            </>
          ) : setsOff.kind === 'counted' ? (
            <span className="sw-cmp-answer__clamp">{setsOff.statement}</span>
          ) : (
            `No follow-on event was counted under ${bLabel}.`
          )
        }
      />
      <Answer
        id="holds"
        eyebrow="How sure"
        onJump={onJump}
        tone={sure.kind === 'finding' ? sure.classification : undefined}
        big={
          sure.kind === 'finding'
            ? STABILITY[sure.classification].label
            : sure.kind === 'paired'
              ? 'Not rated'
              : 'Not rated'
        }
        caption={
          sure.kind === 'finding' ? (
            <>
              Holds in <span className="num">{sure.holdsIn}</span> of{' '}
              <span className="num">{sure.of}</span> seeded runs.
            </>
          ) : sure.kind === 'paired' ? (
            `${pairedCountText(sure.higher, sure.paired)}.`
          ) : (
            'No finding sets these two against each other.'
          )
        }
      >
        {sure.kind === 'finding' && (
          <span className="sw-cmp-answer__meter">
            <RepeatMeter finding={sure.finding} width={148} />
            <span className="sw-cmp-answer__note">{REPEATABILITY_NOTE}</span>
          </span>
        )}
      </Answer>
    </div>
  );
}

/** The parts of the page, as a table of contents: numbered, each one a way in. */
function Contents({ onJump }: { onJump: (id: string) => void }) {
  return (
    <nav
      className="sw-cmp-contents sw-rise"
      style={vars({ '--i': 6 })}
      aria-label="Parts of this page"
    >
      <ol>
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              onClick={(event) => {
                event.preventDefault();
                onJump(section.id);
              }}
            >
              <span className="num">{section.no}</span>
              {section.nav}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The first screen: what happened, why, and how sure the runs are, and the way into the rest of the page. */
export function Hero({
  analysis,
  control,
  gap,
  finding,
  answers,
  notice,
  noEffect,
  headingRef,
  onJump,
  onReview,
  fresh,
}: HeroProps) {
  const runs = analysis.config.runsPerVariant;
  const count = analysis.config.variants.length;
  const caution = notice !== null;
  return (
    <>
      <header
        className="sw-cmp-hero"
        aria-labelledby="compare-title"
        data-effect={!gap ? 'alone' : noEffect ? 'none' : undefined}
      >
        <div className="sw-cmp-hero__lead">
          <p className="sw-cmp-hero__kicker sw-rise">
            <span className="sw-eyebrow">Compare</span>
            <span className="sw-cmp-hero__meta">
              {count} {plural(count, 'scenario')} · {runs} seeded {plural(runs, 'run')} each
            </span>
            {fresh}
          </p>
          <h1
            id="compare-title"
            ref={headingRef}
            tabIndex={-1}
            className="sw-cmp-hero__title sw-rise"
            style={vars({ '--i': 1 })}
          >
            <Headline gap={gap} control={control} noEffect={noEffect} />
          </h1>
          <p className="sw-cmp-hero__sub sw-rise" style={vars({ '--i': 2 })}>
            {finding && !noEffect && (
              <StabilityChip classification={finding.classification} size="sm" />
            )}
            <span>
              <Sub gap={gap} finding={finding} noEffect={noEffect} />
            </span>
          </p>
          {caution && (
            <div className="sw-cmp-hero__notice sw-rise" style={vars({ '--i': 3 })}>
              <Notice
                tone="caution"
                title={
                  noEffect
                    ? 'This comparison cannot say anything about the change'
                    : 'Read these differences with care'
                }
                action={
                  <Button size="sm" variant="glass" onClick={onReview}>
                    Review the stakeholders
                  </Button>
                }
              >
                {notice}
              </Notice>
            </div>
          )}
          {gap && !noEffect && (
            <div className="sw-rise" style={vars({ '--i': 3 })}>
              <Figures gap={gap} analysis={analysis} />
            </div>
          )}
        </div>
        {gap && (
          <aside
            className="sw-cmp-hero__why sw-rise"
            style={vars({ '--i': 4 })}
            aria-label="Why, and how sure"
          >
            <Answers answers={answers} control={control} noEffect={noEffect} onJump={onJump} />
          </aside>
        )}
      </header>
      <Contents onJump={onJump} />
      <p className="sw-cmp-hero__truth sw-caption">{SIMULATED_NOTE}</p>
    </>
  );
}
