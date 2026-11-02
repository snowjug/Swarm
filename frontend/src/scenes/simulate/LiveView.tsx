import { useMemo } from 'react';
import { Ecosystem } from '../../viz/ecosystem/Ecosystem';
import type { Analysis } from '../../../../shared/analysis';
import { chainOf, signedNumber, type ChainStep } from '../../lib/analysis';
import { Scrubber } from './Scrubber';
import type { CastMap } from './useCastMap';
import { RoundCard } from './RoundCard';
import { causalLinks, landsOn, roundOf, stanceSentence, stancesAt, type Replay } from './model';
import type { Playback } from './usePlayback';

export interface LiveViewProps {
  analysis: Analysis;
  cast: CastMap;
  replay: Replay;
  playback: Playback;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Room kept clear on the right for the round card, on a wide screen. */
  wide: boolean;
}

/**
 * The run, round by round, on the map of who is in it. Every actor is coloured by where it stands that round; the ones
 * that set something off are lit, and a line is drawn only between two actors where a replay showed that one event was
 * needed for the other. All of it is read from the one run the engine kept in full.
 */
export function LiveView({
  analysis,
  cast,
  replay,
  playback,
  selectedId,
  onSelect,
  wide,
}: LiveViewProps) {
  const { nodes, edges } = cast;
  const round = playback.round;
  const stances = useMemo(() => stancesAt(replay, round), [replay, round]);
  const chain = useMemo(
    () =>
      new Map<string, ChainStep>(
        chainOf(replay.run, analysis.actors).map((step) => [step.id, step]),
      ),
    [replay, analysis.actors],
  );
  const events = useMemo(
    () => replay.eventsByRound.get(roundOf(replay, round).round) ?? [],
    [replay, round],
  );
  const emphasis = useMemo(
    () => new Set(events.flatMap((event) => (event.actorId ? [event.actorId] : []))),
    [events],
  );
  const pulses = useMemo(() => {
    const found = events.flatMap((event) =>
      event.actorId ? [{ id: event.actorId, key: `${round}:${event.id}` }] : [],
    );
    if (round === replay.changeRound) {
      for (const id of landsOn(analysis.actors, replay.variant))
        found.push({ id, key: `change:${round}:${id}` });
    }
    return found;
  }, [events, round, replay.changeRound, replay.variant, analysis.actors]);
  const flows = useMemo(
    () => causalLinks(replay, round).map((link) => ({ ...link, key: `${round}:${link.key}` })),
    [replay, round],
  );
  const eventCounts = useMemo(
    () => new Map([...replay.eventsByRound].map(([key, list]) => [key, list.length])),
    [replay],
  );
  const covered = wide ? 400 : 0;

  return (
    <>
      <div className="sw-sim__canvas">
        <Ecosystem
          nodes={nodes}
          edges={edges}
          label="The actors, coloured by where each stands in the round shown"
          selectedId={selectedId}
          onSelect={onSelect}
          mode="value"
          valueFor={(id) => stances.get(id) ?? null}
          valueScale={replay.scale}
          focus={false}
          emphasis={emphasis}
          pulses={pulses}
          flows={flows}
          inset={{ top: wide ? 150 : 190, bottom: wide ? 112 : 220, left: 24, right: 24 }}
          covered={{ right: covered, bottom: wide ? 0 : 0 }}
          emerge={false}
          describe={(node) => {
            const stance = stances.get(node.id) ?? 0;
            return `${node.label}, stance ${signedNumber(stance)}, ${stanceSentence(stance, replay.scale)}, in round ${round}`;
          }}
          tooltip={(node) => {
            const stance = stances.get(node.id) ?? 0;
            return (
              <>
                <strong>{node.label}</strong>
                <span>
                  {signedNumber(stance)} · {stanceSentence(stance, replay.scale)}
                </span>
              </>
            );
          }}
        />
      </div>
      <RoundCard
        replay={replay}
        round={round}
        chain={chain}
        selectedId={selectedId}
        onSelect={onSelect}
        compact={!wide}
      />
      <Scrubber
        playback={playback}
        first={replay.firstRound}
        last={replay.lastRound}
        changeRound={replay.changeRound}
        events={eventCounts}
      />
    </>
  );
}
