import { useMemo, useState } from 'react';
import { ChipButton } from '../../design/ui';
import { Ecosystem } from '../../viz/ecosystem/Ecosystem';
import { RELATION_INVERSE, RELATION_LABEL } from '../../viz/ecosystem/model';
import { stanceColor } from '../../viz/palette';
import type { Analysis } from '../../../../shared/analysis';
import { signedNumber } from '../../lib/analysis';
import type { CastMap } from './useCastMap';
import { Dock, SideCard } from './Dock';
import { ActorTrace } from './RoundCard';
import { SegmentedColour } from './SegmentedColour';
import { StanceKey } from './StanceLegend';
import { useClosedHeight, type StageBoxes } from './useStage';
import {
  alignmentAt,
  movementOf,
  niceScale,
  stanceSentence,
  stancesAt,
  type NetworkSettings,
  type Replay,
} from './model';

/** The width the card beside the picture takes, with its margin. */
const SIDE = 400;

/** Whether the colours show where each actor finished, or how far it moved to get there. */
export function NetworkColour({
  settings,
  onChange,
}: {
  settings: NetworkSettings;
  onChange: (next: NetworkSettings) => void;
}) {
  return (
    <SegmentedColour
      value={settings.colour}
      onChange={(colour) => onChange({ ...settings, colour })}
    />
  );
}

/** Which kinds of relation are drawn, each with how many there are. */
export function RelationKinds({
  cast,
  settings,
  onChange,
}: {
  cast: CastMap;
  settings: NetworkSettings;
  onChange: (next: NetworkSettings) => void;
}) {
  const kinds = useMemo(() => {
    const counts = new Map<(typeof cast.edges)[number]['type'], number>();
    for (const edge of cast.edges) counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cast]);
  if (kinds.length === 0) return null;
  return (
    <ul className="sw-net__kinds" aria-label="Relations to show">
      {kinds.map(([kind, count]) => (
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
            {RELATION_LABEL[kind]} <span className="sw-net__count">{count}</span>
          </ChipButton>
        </li>
      ))}
    </ul>
  );
}

/** Who moved most over the run, as bars that run either way from where the actor began. */
function Movers({
  rows,
  scale,
  names,
  onSelect,
}: {
  rows: readonly (readonly [string, number])[];
  scale: number;
  names: ReadonlyMap<string, string>;
  onSelect: (id: string) => void;
}) {
  const reach = Math.max(...rows.map(([, move]) => Math.abs(move)), 0.01);
  return (
    <ul className="sw-movers">
      {rows.map(([id, move]) => (
        <li key={id}>
          <button type="button" className="sw-round__actor" onClick={() => onSelect(id)}>
            {names.get(id) ?? id}
          </button>
          <span className="sw-dv" aria-hidden="true">
            <span className="sw-dv__zero" />
            <span
              className="sw-dv__bar"
              data-side={move < 0 ? 'less' : 'more'}
              style={{
                transform: `scaleX(${Math.abs(move) / reach})`,
                background: stanceColor(move, scale),
              }}
            />
          </span>
          <span className="sw-mono sw-movers__value">{signedNumber(move)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface NetworkViewProps {
  analysis: Analysis;
  cast: CastMap;
  replay: Replay;
  settings: NetworkSettings;
  onSettings: (next: NetworkSettings) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  wide: boolean;
  boxes: StageBoxes;
}

/**
 * Who is connected to whom, with where each ended up in the run: the relations the comparison copied, by kind, and the
 * actors coloured by how they finished or by how far they moved. A press on an actor draws what it is joined to and reads
 * out its own course through the rounds. The relations do not change during a run, and the picture says so.
 */
export function NetworkView({
  analysis,
  cast,
  replay,
  settings,
  onSettings,
  selectedId,
  onSelect,
  wide,
  boxes,
}: NetworkViewProps) {
  const { nodes, edges } = cast;
  const { colour, hidden } = settings;
  const [open, setOpen] = useState(false);
  const closedDock = useClosedHeight(boxes.dock, open);
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
    () =>
      [...moves]
        .filter(([, move]) => Math.abs(move) >= 0.005)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
        .slice(0, 6),
    [moves],
  );
  const names = useMemo(
    () => new Map(analysis.actors.map((actor) => [actor.id, actor.name])),
    [analysis.actors],
  );
  const selected = selectedId ? replay.actors.get(selectedId) : null;
  const joined = selectedId
    ? edges.filter((edge) => edge.from === selectedId || edge.to === selectedId)
    : [];
  const compact = !wide;

  const details = (
    <div className="sw-round__body">
      {compact && (
        <section className="sw-round__block" aria-label="Relations to show">
          <h2 className="sw-eyebrow">Relations</h2>
          <RelationKinds cast={cast} settings={settings} onChange={onSettings} />
        </section>
      )}
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
              <h2 className="sw-eyebrow">Connected to</h2>
              <ul className="sw-net__links">
                {joined.map((edge) => {
                  const other = edge.from === selected.id ? edge.to : edge.from;
                  const lean = alignmentAt(replay, [edge], replay.lastRound).byEdge.get(edge.id);
                  const there = finals.get(other) ?? 0;
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
                        {names.get(other) ?? other}
                      </button>
                      <span className="sw-net__end">
                        <span
                          className="sw-trace__swatch"
                          style={{ background: stanceColor(there, replay.scale) }}
                          aria-hidden="true"
                        />
                        <span className="sw-mono">{signedNumber(there)}</span>
                        {lean && (
                          <span className="sw-net__lean" data-lean={lean}>
                            {lean === 'together' ? 'together' : 'apart'}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      ) : (
        <section className="sw-round__block" aria-label="Who moved most">
          <h2 className="sw-eyebrow">Moved most over the run</h2>
          {ranked.length > 0 ? (
            <Movers rows={ranked} scale={moveScale} names={names} onSelect={onSelect} />
          ) : (
            <p className="sw-caption">Nobody moved over this run.</p>
          )}
          <p className="sw-caption">Press an actor to see what it is joined to.</p>
        </section>
      )}
      <StanceKey
        scale={scale}
        label={colour === 'end' ? 'Stance at the end of the run' : 'Movement over the run'}
      />
      <p className="sw-caption">
        Lines are the relations the comparison used. They stay the same through the run; only where
        the actors stand changes.
      </p>
    </div>
  );

  const first = ranked[0];
  return (
    <>
      <div className="sw-sim__canvas">
        {boxes.topReady && (compact ? boxes.dockReady : true) && (
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
            inset={{ top: boxes.top + 28, bottom: closedDock + 8, left: 24, right: 24 }}
            covered={{ right: wide ? SIDE : 0, bottom: compact && open ? boxes.dock : 0 }}
            describe={(node) =>
              `${node.label}, ${colour === 'end' ? 'ended' : 'moved'} ${signedNumber(values.get(node.id) ?? 0)}, ${stanceSentence(values.get(node.id) ?? 0, scale)}`
            }
          />
        )}
      </div>
      {wide && <SideCard label="Actor">{details}</SideCard>}
      {compact && (
        <Dock
          compact
          open={open}
          onOpenChange={setOpen}
          label="Actor"
          peek={
            selected ? (
              <span className="sw-round__line">
                <strong>{selected.name}</strong>
                <span className="sw-mono">{signedNumber(values.get(selected.id) ?? 0)}</span>
              </span>
            ) : (
              <span className="sw-round__line">
                <span className="sw-eyebrow">Moved most</span>
                {first && (
                  <span>
                    {names.get(first[0]) ?? first[0]}{' '}
                    <span className="sw-mono">{signedNumber(first[1])}</span>
                  </span>
                )}
              </span>
            )
          }
          fold={details}
          dockRef={boxes.dockRef}
          opensWith={selectedId}
        />
      )}
    </>
  );
}
