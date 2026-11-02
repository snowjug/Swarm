import { useMemo, useState } from 'react';
import { Ecosystem } from '../../viz/ecosystem/Ecosystem';
import type { Analysis } from '../../../../shared/analysis';
import { chainOf, signedNumber, type ChainStep } from '../../lib/analysis';
import { Dock, SideCard } from './Dock';
import { Say, NarrationLine } from './Narration';
import { RoundDetails, RoundGlance } from './RoundCard';
import { Scrubber } from './Scrubber';
import type { CastMap } from './useCastMap';
import {
  causalLinks,
  landsOn,
  movesIn,
  narrationOf,
  roundOf,
  stanceSentence,
  stancesAt,
  type Replay,
} from './model';
import type { Playback } from './usePlayback';
import { useClosedHeight, useCoveredRight, useStageInset, type StageBoxes } from './useStage';

/** The width the card beside the picture takes, with its margin. */
const SIDE = 400;

export interface LiveViewProps {
  analysis: Analysis;
  cast: CastMap;
  replay: Replay;
  playback: Playback;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Room for the card beside the picture, and no folding of it. */
  wide: boolean;
  boxes: StageBoxes;
}

/**
 * The run, round by round, on the map of who is in it. Every actor is coloured by where it stands that round; the ones
 * that moved most in the round, and the ones that set something off, are lit as it arrives; a line is drawn only
 * between two actors where a replay showed that one event was needed for the other. All of it is read from the one run
 * the engine kept in full, and what is said about each round is said from what the run recorded in it.
 */
export function LiveView({
  analysis,
  cast,
  replay,
  playback,
  selectedId,
  onSelect,
  wide,
  boxes,
}: LiveViewProps) {
  const { nodes, edges } = cast;
  const round = playback.round;
  const [open, setOpen] = useState(false);
  const closedDock = useClosedHeight(boxes.dock, open);
  const inset = useStageInset(boxes, closedDock, wide);
  const coveredRight = useCoveredRight(wide, SIDE);
  const stances = useMemo(() => stancesAt(replay, round), [replay, round]);
  const chain = useMemo(
    () =>
      new Map<string, ChainStep>(
        chainOf(replay.run, analysis.actors).map((step) => [step.id, step]),
      ),
    [replay, analysis.actors],
  );
  const shown = roundOf(replay, round).round;
  const events = useMemo(() => replay.eventsByRound.get(shown) ?? [], [replay, shown]);
  const emphasis = useMemo(
    () => new Set(events.flatMap((event) => (event.actorId ? [event.actorId] : []))),
    [events],
  );
  const pulses = useMemo(() => {
    const found = events.flatMap((event) =>
      event.actorId ? [{ id: event.actorId, key: `${shown}:${event.id}` }] : [],
    );
    for (const { actorId } of movesIn(replay, shown, 4))
      found.push({ id: actorId, key: `${shown}:moved:${actorId}` });
    if (shown === replay.changeRound) {
      for (const id of landsOn(analysis.actors, replay.variant))
        found.push({ id, key: `change:${shown}:${id}` });
    }
    return found;
  }, [events, shown, replay, analysis.actors]);
  const flows = useMemo(
    () => causalLinks(replay, shown).map((link) => ({ ...link, key: `${shown}:${link.key}` })),
    [replay, shown],
  );
  const eventCounts = useMemo(
    () => new Map([...replay.eventsByRound].map(([key, list]) => [key, list.length])),
    [replay],
  );
  const narration = useMemo(() => narrationOf(replay, shown), [replay, shown]);
  const compact = !wide;
  const details = (
    <RoundDetails
      replay={replay}
      round={round}
      edges={edges}
      chain={chain}
      runs={analysis.config.runsPerVariant}
      selectedId={selectedId}
      onSelect={onSelect}
      compact={compact}
    />
  );

  return (
    <>
      <div className="sw-sim__canvas">
        {boxes.topReady && boxes.dockReady && (
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
            inset={inset}
            covered={{ right: coveredRight, bottom: compact && open ? boxes.dock : 0 }}
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
        )}
      </div>
      {wide && <SideCard label={`Round ${shown}`}>{details}</SideCard>}
      <Dock
        compact={compact}
        open={open}
        onOpenChange={setOpen}
        label={compact ? `Round ${shown}` : 'Playback'}
        peek={
          <span className="sw-round__line">
            <span className="sw-round__number sw-numeral">{shown}</span>
            <span className="sw-round__of">of {replay.lastRound}</span>
            <NarrationLine narration={narration} />
          </span>
        }
        glance={<RoundGlance replay={replay} round={round} />}
        fold={compact ? details : undefined}
        dockRef={boxes.dockRef}
        opensWith={selectedId}
      >
        {wide && <Say narration={narration} round={shown} />}
        <Scrubber
          embedded
          playback={playback}
          first={replay.firstRound}
          last={replay.lastRound}
          changeRound={replay.changeRound}
          events={eventCounts}
        />
      </Dock>
    </>
  );
}
