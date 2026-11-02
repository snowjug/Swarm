import { useMemo, useState } from 'react';
import { m } from 'motion/react';
import { ArrowRight, Play } from 'lucide-react';
import { cx } from '../../design/cx';
import { SPRING, useTween } from '../../design/motion';
import { Button, Chip, Disclosure, Notice } from '../../design/ui';
import { NO_DIRECTION_NOTICE, UNDIRECTED_NOTICE } from '../../../../shared/signal';
import type { Analysis } from '../../../../shared/analysis';
import {
  STABILITY,
  comparisonSummary,
  holdsText,
  percentText,
  pointsText,
  signedNumber,
} from '../../lib/analysis';
import { stanceColor } from '../../viz/palette';
import { niceScale, storyOf, topFindings, type Mover, type Replay } from './model';
import { TimelineChart } from './TimelineChart';
import type { Playback } from './usePlayback';
import './pages.css';

/** What the simulation is, said short: the sentence that stays visible wherever a number is shown, in two lengths. */
export function Fine({ className }: { className?: string }) {
  return (
    <p className={cx('sw-caption', className)}>
      <span className="sw-hide-sm">
        Synthetic actors, simulated under stated assumptions. Not a prediction.
      </span>
      <span className="sw-hide-lg">Synthetic actors. Not a prediction.</span>
    </p>
  );
}

const toneOf = {
  good: 'favor',
  info: 'accent',
  caution: 'caution',
  neutral: 'neutral',
  bad: 'against',
} as const;

function Tween({ value }: { value: number }) {
  const shown = useTween(value * 100, { duration: 0.9 });
  return <>{Math.round(shown)}</>;
}

/** Where the share of simulated members who look for an alternative or resist stands without the change and with it, and how far the seeded runs spread. */
function Spread({
  baseline,
  proposed,
  spread,
}: {
  baseline: number;
  proposed: number;
  spread: { p10: number; p50: number; p90: number };
}) {
  const top = Math.max(0.3, Math.ceil(Math.max(spread.p90, baseline, proposed) * 12) / 10);
  const at = (value: number): string => `${Math.min(100, (value / top) * 100)}%`;
  return (
    <figure
      className="sw-story__spread"
      aria-label={`Without the change ${percentText(baseline)}; with it ${percentText(proposed)}, most runs between ${percentText(spread.p10)} and ${percentText(spread.p90)}`}
    >
      <div className="sw-story__track" aria-hidden="true">
        <span
          className="sw-story__range"
          style={{ left: at(spread.p10), width: `calc(${at(spread.p90)} - ${at(spread.p10)})` }}
        />
        <span className="sw-story__dot sw-story__dot--with" style={{ left: at(proposed) }} />
        <span className="sw-story__dot sw-story__dot--without" style={{ left: at(baseline) }} />
      </div>
      <figcaption>
        <span>
          <i className="sw-story__key sw-story__key--without" />
          No change <b>{percentText(baseline)}</b>
        </span>
        <span>
          <i className="sw-story__key sw-story__key--with" />
          With the change <b>{percentText(proposed)}</b>{' '}
          <span className="sw-story__muted">
            (most runs {percentText(spread.p10)} to {percentText(spread.p90)})
          </span>
        </span>
      </figcaption>
    </figure>
  );
}

/** One actor's mean stance without the change and with it, on a shared scale: a hollow point where it stood, a filled one where it ends, and the line between. */
function Dumbbell({ mover, scale }: { mover: Mover; scale: number }) {
  const at = (value: number): number =>
    50 + (Math.max(-scale, Math.min(scale, value)) / scale) * 46;
  const a = at(mover.baseline);
  const b = at(mover.proposed);
  return (
    <span className="sw-bell" aria-hidden="true">
      <span className="sw-bell__zero" />
      <span
        className="sw-bell__link"
        style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
      />
      <span className="sw-bell__a" style={{ left: `${a}%` }} />
      <span
        className="sw-bell__b"
        style={{ left: `${b}%`, background: stanceColor(mover.proposed, scale) }}
      />
    </span>
  );
}

export interface StoryViewProps {
  analysis: Analysis;
  replay: Replay | null;
  onWatch: (actorId?: string) => void;
  onCompare: () => void;
  /** To the stakeholders, where who is helped or harmed is said. */
  onReview: () => void;
}

/**
 * The answer, written out from the numbers: what happens to the share of simulated members who look for an alternative
 * or resist, who moves most, what the typical run sets off, how steady the findings are and how far to rely on them. It
 * is composed entirely from what the comparison states; where it cannot say something, it says nothing.
 */
export function StoryView({ analysis, replay, onWatch, onCompare, onReview }: StoryViewProps) {
  const story = useMemo(() => storyOf(analysis), [analysis]);
  const findings = useMemo(() => topFindings(analysis, 3), [analysis]);
  const lines = comparisonSummary(analysis);
  const scale = useMemo(
    () => niceScale(story.movers.flatMap((mover) => [mover.baseline, mover.proposed])),
    [story.movers],
  );
  const { adverse } = story;
  const direction = adverse
    ? adverse.shift > 0.005
      ? 'more'
      : adverse.shift < -0.005
        ? 'fewer'
        : 'about the same'
    : null;

  return (
    <div className="sw-story">
      <m.section
        className="sw-story__hero"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING.gentle }}
        aria-labelledby="story-title"
      >
        <p className="sw-eyebrow">What the simulation says</p>
        {story.caution === 'cannot-move' || !adverse ? (
          <h1 id="story-title" className="sw-display sw-story__title">
            {lines[1] ?? lines[0]}
          </h1>
        ) : (
          <h1 id="story-title" className="sw-display sw-story__title">
            With the change,{' '}
            <span className="sw-story__figure sw-numeral">
              <Tween value={adverse.proposed} />%
            </span>{' '}
            of simulated members look for an alternative or resist
            {direction === 'about the same' ? (
              <>
                : <em>about the same</em> as with no change.
              </>
            ) : (
              <>
                : <em>{pointsText(adverse.shift)}</em> {direction === 'more' ? 'more' : 'fewer'}{' '}
                than with no change.
              </>
            )}
          </h1>
        )}
        {adverse && story.caution !== 'cannot-move' && (
          <Spread baseline={adverse.baseline} proposed={adverse.proposed} spread={adverse.spread} />
        )}
        {story.caution && (
          <Notice
            tone="caution"
            title={
              story.caution === 'cannot-move'
                ? 'Nothing here can move anyone'
                : story.caution === 'no-direction'
                  ? 'No one has a direction of impact yet'
                  : 'No stakeholder has an expected direction'
            }
            action={
              <Button size="sm" variant="glass" onClick={onReview}>
                Review stakeholders
              </Button>
            }
          >
            {story.caution === 'no-direction'
              ? NO_DIRECTION_NOTICE
              : story.caution === 'undirected'
                ? UNDIRECTED_NOTICE
                : lines[2]}
          </Notice>
        )}
        <div className="sw-story__actions">
          {replay && (
            <Button
              variant="accent"
              size="lg"
              icon={<Play size={17} aria-hidden="true" />}
              onClick={() => onWatch()}
            >
              Watch it unfold
            </Button>
          )}
          <Button
            variant="glass"
            size="lg"
            iconEnd={<ArrowRight size={17} aria-hidden="true" />}
            onClick={onCompare}
          >
            Compare the scenarios
          </Button>
        </div>
        <div className="sw-story__foot">
          {!replay && (
            <p className="sw-story__sources">
              No run was kept in detail, so there is nothing to watch round by round. Live and
              Network are not offered; the timeline still shows how the runs spread.
            </p>
          )}
          <p className="sw-story__sources">{lines[0]}</p>
          <Fine />
        </div>
      </m.section>

      {story.movers.length > 0 && story.caution !== 'cannot-move' && (
        <section className="sw-story__section sw-reveal" aria-labelledby="story-movers">
          <h2 id="story-movers" className="sw-title">
            Who moves most
          </h2>
          <p className="sw-story__lead">
            Mean stance of each actor, with no change and with it, across the seeded runs. Actors
            are synthetic stand-ins.
          </p>
          <p className="sw-story__legend" aria-hidden="true">
            <span>
              <i className="sw-story__swatch sw-story__swatch--a" />
              No change
            </span>
            <span>
              <i className="sw-story__swatch sw-story__swatch--b" />
              With the change
            </span>
            <span className="sw-story__axis">
              <span>Against {signedNumber(-scale)}</span>
              <span>In favour {signedNumber(scale)}</span>
            </span>
          </p>
          <ol className="sw-story__movers">
            {story.movers.map((mover, index) => (
              <li key={mover.actorId} style={{ animationDelay: `${index * 40}ms` }}>
                <button
                  type="button"
                  className="sw-story__mover"
                  onClick={() => onWatch(mover.actorId)}
                  disabled={!replay}
                >
                  <span className="sw-story__name">{mover.name}</span>
                  <Dumbbell mover={mover} scale={scale} />
                  <span
                    className="sw-story__shift sw-mono"
                    style={{ color: stanceColor(mover.shift, scale / 2) }}
                  >
                    {signedNumber(mover.shift)}
                  </span>
                  <span className="sr-only">
                    from {signedNumber(mover.baseline)} to {signedNumber(mover.proposed)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="sw-story__section sw-reveal" aria-labelledby="story-set-off">
        <h2 id="story-set-off" className="sw-title">
          What it sets off
        </h2>
        {story.firstEvents.length === 0 ? (
          <p className="sw-story__lead">
            {replay
              ? 'No follow-on events occurred in the typical run.'
              : 'No run was kept in detail, so there is no chain of events to read.'}
          </p>
        ) : (
          <>
            <p className="sw-story__lead">
              In one typical run (seed {replay?.run.seed}), the seeded run nearest the middle under
              the proposed change. It is one run, not the answer.
            </p>
            <ol className="sw-story__events">
              {story.firstEvents.map((step) => (
                <li key={step.id}>
                  <span className="sw-story__when">Round {step.round}</span>
                  <p>
                    <Chip size="sm" tone="caution">
                      {step.kind}
                    </Chip>{' '}
                    {step.actor ? <strong>{step.actor}: </strong> : null}
                    {step.description}
                  </p>
                </li>
              ))}
            </ol>
            {story.eventCount > story.firstEvents.length && (
              <p className="sw-caption">
                {story.eventCount - story.firstEvents.length} more in the timeline.
              </p>
            )}
          </>
        )}
      </section>

      {findings.length > 0 && (
        <section className="sw-story__section sw-reveal" aria-labelledby="story-steady">
          <h2 id="story-steady" className="sw-title">
            How steady it is
          </h2>
          <ul className="sw-story__findings">
            {findings.map((finding) => {
              const stability = STABILITY[finding.classification];
              return (
                <li key={finding.id}>
                  <p>{finding.statement}</p>
                  <p className="sw-story__stable">
                    <Chip
                      size="sm"
                      tone={toneOf[stability.tone as keyof typeof toneOf] ?? 'neutral'}
                    >
                      {stability.label}
                    </Chip>
                    <span>It {holdsText(finding)}.</span>
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="sw-caption">
            Repeatable describes how steady a finding is under the simulation’s own randomness. It
            is not the chance of anything happening in the world.
          </p>
        </section>
      )}

      <section className="sw-story__section sw-story__rely" aria-labelledby="story-rely">
        <h2 id="story-rely" className="sw-title">
          How far to rely on this
        </h2>
        <p className="sw-story__lead">
          Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.
        </p>
        <Disclosure summary={analysis.fidelity.label}>
          <ul className="sw-story__caveats">
            {analysis.fidelity.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </Disclosure>
      </section>
    </div>
  );
}

export interface TimelineViewProps {
  analysis: Analysis;
  replay: Replay | null;
  playback: Playback;
}

/**
 * The spread of the runs over the rounds, with the change and the events marked, the run that was kept in full drawn over
 * it, and the round shown as a cursor that can be dragged, stepped with the keys or played along.
 */
export function TimelineView({ analysis, replay, playback }: TimelineViewProps) {
  // Without a run to replay there is nothing to play, but the cursor still moves along the rounds the runs spread over.
  const [own, setOwn] = useState<number | null>(null);
  const round = replay ? playback.round : (own ?? 1);
  return (
    <div className="sw-story sw-story--timeline">
      <section className="sw-story__section" aria-labelledby="tl-title">
        <h1 id="tl-title" className="sw-display sw-story__title">
          How it <em>plays out</em>
        </h1>
        <Fine />
        <TimelineChart
          analysis={analysis}
          replay={replay}
          round={round}
          onSeek={replay ? playback.seek : setOwn}
          play={
            replay
              ? { playing: playback.playing, atEnd: playback.atEnd, toggle: playback.toggle }
              : null
          }
        />
      </section>
    </div>
  );
}
