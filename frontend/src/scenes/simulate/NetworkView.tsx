import { useMemo } from 'react';
import { ChipButton } from '../../design/ui';
import { Ecosystem } from '../../viz/ecosystem/Ecosystem';
import { RELATION_INVERSE, RELATION_LABEL } from '../../viz/ecosystem/model';
import type { Analysis } from '../../../../shared/analysis';
import { signedNumber } from '../../lib/analysis';
import type { CastMap } from './useCastMap';
import { ActorTrace } from './RoundCard';
import { PeekCard } from './PeekCard';
import { SegmentedColour } from './SegmentedColour';
import { StanceKey } from './StanceLegend';
import {
  movementOf,
  niceScale,
  stanceSentence,
  stancesAt,
  type NetworkSettings,
  type Replay,
} from './model';

/** The controls of the network: how the colours are chosen, and which kinds of relation are drawn. */
export function NetworkControls({
  cast,
  settings,
  onChange,
}: {
  cast: CastMap;
  settings: NetworkSettings;
  onChange: (next: NetworkSettings) => void;
}) {
  const kinds = useMemo(
    () => [...new Set(cast.edges.map((edge) => edge.type))].sort(),
    [cast.edges],
  );
  return (
    <div className="sw-net__controls">
      <SegmentedColour
        value={settings.colour}
        onChange={(colour) => onChange({ ...settings, colour })}
      />
      {kinds.length > 0 && (
        <ul className="sw-net__kinds" aria-label="Relations to show">
          {kinds.map((kind) => (
            <li key={kind}>
              <ChipButton
                size="sm"
                pressed={!settings.hidden.has(kind)}
                onClick={() => {
                  const hidden = new Set(settings.hidden);
                  if (hidden.has(kind)) hidden.delete(kind);
                  else hidden.add(kind);
                  onChange({ ...settings, hidden });
                }}
              >
                {RELATION_LABEL[kind]}
              </ChipButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface NetworkViewProps {
  analysis: Analysis;
  cast: CastMap;
  replay: Replay;
  settings: NetworkSettings;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  wide: boolean;
}

/**
 * Who is connected to whom, with where each ended up in the run: the relations the comparison copied, by kind, and the
 * actors coloured by how they finished or by how far they moved. A press on an actor draws what it is joined to and reads
 * out its own course through the rounds.
 */
export function NetworkView({
  analysis,
  cast,
  replay,
  settings,
  selectedId,
  onSelect,
  wide,
}: NetworkViewProps) {
  const { nodes, edges } = cast;
  const { colour, hidden } = settings;
  const visible = useMemo(() => edges.filter((edge) => !hidden.has(edge.type)), [edges, hidden]);
  const finals = useMemo(() => stancesAt(replay, replay.lastRound), [replay]);
  const moves = useMemo(
    () => new Map(analysis.actors.map((actor) => [actor.id, movementOf(replay, actor.id)])),
    [analysis.actors, replay],
  );
  const moveScale = useMemo(() => niceScale([...moves.values()]), [moves]);
  const values = colour === 'end' ? finals : moves;
  const scale = colour === 'end' ? replay.scale : moveScale;
  const ranked = useMemo(
    () => [...moves].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5),
    [moves],
  );
  const covered = wide ? 400 : 0;
  const selected = selectedId ? replay.actors.get(selectedId) : null;
  const joined = selectedId
    ? edges.filter((edge) => edge.from === selectedId || edge.to === selectedId)
    : [];

  return (
    <>
      <div className="sw-sim__canvas">
        <Ecosystem
          nodes={nodes}
          edges={visible}
          label="The actors and the relations between them"
          selectedId={selectedId}
          onSelect={onSelect}
          mode="value"
          valueFor={(id) => values.get(id) ?? null}
          valueScale={scale}
          focus={Boolean(selectedId)}
          inset={{ top: wide ? 200 : 250, bottom: wide ? 64 : 96, left: 24, right: 24 }}
          covered={{ right: covered }}
          describe={(node) =>
            `${node.label}, ${colour === 'end' ? 'ended' : 'moved'} ${signedNumber(values.get(node.id) ?? 0)}, ${stanceSentence(values.get(node.id) ?? 0, scale)}`
          }
        />
      </div>

      <PeekCard
        compact={!wide}
        label="Actor"
        className="sw-round--tall"
        opensWith={selectedId}
        peek={
          selected ? (
            <span className="sw-round__line">
              <strong>{selected.name}</strong>
              <span className="sw-mono">{signedNumber(values.get(selected.id) ?? 0)}</span>
            </span>
          ) : (
            <span className="sw-round__line">
              <span className="sw-eyebrow">Moved most</span>
              {ranked[0] && (
                <span>
                  {replay.actors.get(ranked[0][0])?.name ?? ranked[0][0]}{' '}
                  <span className="sw-mono">{signedNumber(ranked[0][1])}</span>
                </span>
              )}
            </span>
          )
        }
      >
        <StanceKey
          scale={scale}
          label={colour === 'end' ? 'Stance at the end of the run' : 'Movement over the run'}
        />
        {selected ? (
          <>
            <ActorTrace
              replay={replay}
              actorId={selected.id}
              round={replay.lastRound}
              onClose={() => onSelect(null)}
            />
            {joined.length > 0 && (
              <section className="sw-round__block" aria-label="Connected to">
                <h3 className="sw-eyebrow">Connected to</h3>
                <ul className="sw-net__links">
                  {joined.map((edge) => {
                    const other = edge.from === selected.id ? edge.to : edge.from;
                    return (
                      <li key={edge.id}>
                        <span className="sw-net__phrase">
                          {edge.from === selected.id
                            ? RELATION_LABEL[edge.type]
                            : RELATION_INVERSE[edge.type]}
                        </span>
                        <button
                          type="button"
                          className="sw-round__actor"
                          onClick={() => onSelect(other)}
                        >
                          {replay.actors.get(other)?.name ?? other}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        ) : (
          <section className="sw-round__block" aria-label="Who moved most">
            <h3 className="sw-eyebrow">Moved most in this run</h3>
            <ul className="sw-net__links">
              {ranked.map(([id, move]) => (
                <li key={id}>
                  <button type="button" className="sw-round__actor" onClick={() => onSelect(id)}>
                    {replay.actors.get(id)?.name ?? id}
                  </button>
                  <span className="sw-mono sw-net__move">{signedNumber(move)}</span>
                </li>
              ))}
            </ul>
            <p className="sw-caption">Press an actor to see what it is joined to.</p>
          </section>
        )}
      </PeekCard>
    </>
  );
}
