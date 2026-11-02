import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Chip, IconButton, Meter } from '../../design/ui';
import { stanceColor } from '../../viz/palette';
import { signedNumber } from '../../lib/analysis';
import type { ChainStep } from '../../lib/analysis';
import { ShareBar } from './ShareBar';
import { PeekCard } from './PeekCard';
import { StanceKey } from './StanceLegend';
import { movementOf, roundOf, signalsOf, stanceSentence, traceOf, type Replay } from './model';
import './roundcard.css';

/** One actor's stance across the rounds of the run, as a line on a symmetrical scale, with the change and the round shown marked. */
export function Sparkline({
  replay,
  actorId,
  round,
}: {
  replay: Replay;
  actorId: string;
  round: number;
}) {
  const trace = useMemo(() => traceOf(replay, actorId), [replay, actorId]);
  if (trace.length < 2) return null;
  const width = 220;
  const height = 64;
  const reach = Math.max(replay.scale, ...trace.map((point) => Math.abs(point.stance))) * 1.1;
  const x = (r: number): number =>
    4 + ((r - replay.firstRound) / Math.max(replay.lastRound - replay.firstRound, 1)) * (width - 8);
  const y = (v: number): number => height / 2 - (v / reach) * (height / 2 - 6);
  const path = trace
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${x(point.round).toFixed(1)} ${y(point.stance).toFixed(1)}`,
    )
    .join('');
  const here = trace.find((point) => point.round === round) ?? trace[trace.length - 1]!;
  const text = trace
    .map((point) => `round ${point.round}: ${signedNumber(point.stance)}`)
    .join('; ');
  return (
    <svg
      className="sw-spark"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Stance by round. ${text}`}
      preserveAspectRatio="none"
    >
      <line className="sw-spark__zero" x1="0" x2={width} y1={height / 2} y2={height / 2} />
      {replay.changeRound >= replay.firstRound && replay.changeRound <= replay.lastRound && (
        <line
          className="sw-spark__change"
          x1={x(replay.changeRound)}
          x2={x(replay.changeRound)}
          y1="2"
          y2={height - 2}
        />
      )}
      <path className="sw-spark__line" d={path} />
      <circle
        className="sw-spark__dot"
        cx={x(here.round)}
        cy={y(here.stance)}
        r="4"
        style={{ fill: stanceColor(here.stance, replay.scale) }}
      />
    </svg>
  );
}

/** One actor in this run: where it stands now, how it got there, and where its members end up. */
export function ActorTrace({
  replay,
  actorId,
  round,
  onClose,
}: {
  replay: Replay;
  actorId: string;
  round: number;
  onClose: () => void;
}) {
  const actor = replay.actors.get(actorId);
  const stance =
    roundOf(replay, round).byActor.find((entry) => entry.actorId === actorId)?.stanceMean ?? 0;
  const moved = movementOf(replay, actorId);
  const end = replay.run.final.byActor.find((entry) => entry.actorId === actorId);
  return (
    <section className="sw-trace" aria-label={actor?.name ?? actorId}>
      <header className="sw-trace__head">
        <div>
          <p className="sw-eyebrow">{actor?.kind === 'cohort' ? 'Cohort' : 'Actor'}</p>
          <h3 className="sw-trace__name">{actor?.name ?? actorId}</h3>
        </div>
        <IconButton label="Close" size="sm" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </header>
      <p className="sw-trace__now">
        <span
          className="sw-trace__swatch"
          style={{ background: stanceColor(stance, replay.scale) }}
          aria-hidden="true"
        />
        <span className="sw-mono">{signedNumber(stance)}</span> ·{' '}
        {stanceSentence(stance, replay.scale)}
      </p>
      <Sparkline replay={replay} actorId={actorId} round={round} />
      <p className="sw-caption">
        {Math.abs(moved) < 0.005
          ? 'Hardly moved over the run'
          : `Moved ${signedNumber(moved)} over the run`}
        {end && ` · ${end.members} simulated ${end.members === 1 ? 'member' : 'members'}`}
      </p>
      {end && (
        <ShareBar
          shares={end.responseShares}
          label={`Where ${actor?.name ?? actorId} ends up`}
          legend={false}
          size="sm"
        />
      )}
    </section>
  );
}

export interface RoundCardProps {
  replay: Replay;
  round: number;
  chain: ReadonlyMap<string, ChainStep>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** On a narrow screen the card is a line that opens, so that it does not cover the picture. */
  compact?: boolean;
}

/** What is going on in the round shown: how the mix of responses stands, the signals the engine read, and what was set off. */
export function RoundCard({
  replay,
  round,
  chain,
  selectedId,
  onSelect,
  compact = false,
}: RoundCardProps) {
  const aggregate = roundOf(replay, round);
  const events = replay.eventsByRound.get(aggregate.round) ?? [];
  const signals = signalsOf(aggregate);
  const changeHere = aggregate.round === replay.changeRound;
  const head = (
    <header className="sw-round__head">
      <p className="sw-eyebrow">Round</p>
      <div className="sw-round__title">
        <span className="sw-round__number sw-numeral">{aggregate.round}</span>
        <span className="sw-round__of">of {replay.lastRound}</span>
        {changeHere && <Chip tone="accent">The change lands</Chip>}
      </div>
      <p className="sw-caption">
        Overall stance <span className="sw-mono">{signedNumber(aggregate.stanceMean)}</span> ·{' '}
        {stanceSentence(aggregate.stanceMean, replay.scale)}
      </p>
    </header>
  );
  // A button holds phrasing content only, so the one line that opens the card is spans.
  const peek = (
    <span className="sw-round__line">
      <span className="sw-round__number sw-numeral">{aggregate.round}</span>
      <span className="sw-round__of">of {replay.lastRound}</span>
      <span className="sw-round__state">
        {changeHere ? 'The change lands · ' : ''}
        <span className="sw-mono">{signedNumber(aggregate.stanceMean)}</span>{' '}
        {stanceSentence(aggregate.stanceMean, replay.scale)}
      </span>
    </span>
  );
  return (
    <PeekCard
      compact={compact}
      label={`Round ${aggregate.round}`}
      peek={peek}
      glance={
        <ShareBar
          shares={aggregate.responseShares}
          label={`Responses in round ${aggregate.round}`}
          legend={false}
          size="sm"
        />
      }
      opensWith={selectedId}
    >
      {!compact && head}

      <StanceKey scale={replay.scale} />

      <section className="sw-round__block" aria-label="Responses">
        <ShareBar
          shares={aggregate.responseShares}
          label={`Responses in round ${aggregate.round}`}
        />
      </section>

      {signals.length > 0 && (
        <section className="sw-round__block" aria-label="Signals read by the engine">
          <h3 className="sw-eyebrow">Signals</h3>
          <ul className="sw-round__signals">
            {signals.map((signal) => (
              <li key={signal.key}>
                <span className="sw-round__signal">{signal.label}</span>
                <Meter
                  value={signal.value}
                  label={signal.label}
                  valueText={`${Math.round(signal.value * 100)}%`}
                  size="sm"
                  tone={
                    signal.key === 'adoption'
                      ? 'favor'
                      : signal.key === 'adverse-share'
                        ? 'against'
                        : 'accent'
                  }
                />
                <span className="sw-round__pct">{Math.round(signal.value * 100)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sw-round__block" aria-label="Set off in this round">
        <h3 className="sw-eyebrow">Set off</h3>
        {events.length === 0 ? (
          <p className="sw-caption">Nothing was set off in this round.</p>
        ) : (
          <ul className="sw-round__events">
            {events.map((event) => {
              const step = chain.get(event.id);
              const needed = step?.because.filter((cause) => cause.kind === 'event') ?? [];
              const signalsSeen = step?.because.filter((cause) => cause.kind === 'signal') ?? [];
              const actor = event.actorId ? replay.actors.get(event.actorId) : null;
              return (
                <li key={event.id}>
                  <p className="sw-round__event-head">
                    <Chip size="sm" tone="caution">
                      {event.kind}
                    </Chip>
                    {actor && (
                      <button
                        type="button"
                        className="sw-round__actor"
                        onClick={() => onSelect(selectedId === actor.id ? null : actor.id)}
                      >
                        {actor.name}
                      </button>
                    )}
                  </p>
                  <p className="sw-round__desc">{event.description}</p>
                  {signalsSeen.length > 0 && (
                    <p className="sw-caption">
                      After{' '}
                      {signalsSeen
                        .map((cause) => cause.text.replace('the simulated ', ''))
                        .join(' and ')}{' '}
                      reached its threshold.
                    </p>
                  )}
                  {needed.length > 0 && (
                    <p className="sw-caption">
                      Could not have happened without{' '}
                      {needed.map((cause) => cause.text).join(' and ')}.
                    </p>
                  )}
                  {step && step.followed.length > 0 && (
                    <p className="sw-caption">
                      Came after {step.followed.join(' and ')};{' '}
                      {step.tested
                        ? 'a replay without it still had this event'
                        : 'nothing shows it mattered'}
                      .
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selectedId && (
        <ActorTrace
          replay={replay}
          actorId={selectedId}
          round={aggregate.round}
          onClose={() => onSelect(null)}
        />
      )}
    </PeekCard>
  );
}
