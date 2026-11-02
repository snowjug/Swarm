import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import type { Analysis } from '../../../../shared/analysis';
import { SPRING, useReducedMotion } from '../../design/motion';
import { ChipButton, Segmented } from '../../design/ui';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Ecosystem } from '../../viz/ecosystem/Ecosystem';
import { edgesOf, nodesFromActors } from '../../viz/ecosystem/model';
import { clusterColour, clusterLabel, stanceColor, stanceWord } from '../../viz/palette';
import { vars } from './css';
import { sectionInfo, STANCE_WORDS, ADVERSE_WORDS } from './copy';
import { countText, shareText, signed } from './format';
import { useInView } from './hooks';
import {
  adverseOf,
  deltaScale,
  groupsOf,
  hiddenGroups,
  inGroup,
  rankMovers,
  stanceScale,
  type Mover,
  type MoverSource,
} from './movement';
import { DataTable, ResponseBar, Section, type TableSpec } from './parts';
import type { Pair } from './pair';
import { linear } from './scale';
import type { Scenario } from './scenarios';
import './movers.css';

const SHOWN = 8;

/** A scenario's mark, as the numerals above use it: a ring for the reference, a dot for the one set against it. */
const Mark = ({ side }: { side: 'a' | 'b' }) => (
  <span className="sw-cmp-mark" data-side={side} aria-hidden="true" />
);

function Detail({ mover, a, b }: { mover: Mover; a: Scenario; b: Scenario }) {
  const adverse = adverseOf(mover);
  return (
    <div className="sw-cmp-mv__detail">
      <p className="sw-cmp-mv__facts">
        <span>{mover.categoryLabel}</span>
        <span>
          {mover.kind === 'key'
            ? 'One simulated actor'
            : `${countText(mover.members)} simulated members`}
        </span>
        {mover.kind === 'cohort' && <span>stands for {countText(mover.size)}, an assumption</span>}
      </p>
      <div className="sw-cmp-mv__mix">
        {(
          [
            { side: 'a', scenario: a, stance: mover.a, adverse: adverse.a, shares: mover.sharesA },
            { side: 'b', scenario: b, stance: mover.b, adverse: adverse.b, shares: mover.sharesB },
          ] as const
        ).map((entry) => (
          <div key={entry.side} className="sw-cmp-mv__mixrow">
            <p className="sw-cmp-mv__mixhead">
              <Mark side={entry.side} />
              <b>{entry.scenario.label}</b>
              <span>
                stance <span className="num">{signed(entry.stance)}</span>,{' '}
                {stanceWord(entry.stance)}
              </span>
            </p>
            <ResponseBar
              shares={entry.shares}
              label={`${mover.name} under ${entry.scenario.label}`}
              size="sm"
            />
            <p className="sw-cmp-mv__mixcap">
              <span className="num">{shareText(entry.adverse, entry.adverse < 0.1 ? 1 : 0)}</span>{' '}
              of simulated members {ADVERSE_WORDS}
            </p>
          </div>
        ))}
      </div>
      {mover.role && <p className="sw-cmp-quiet">{mover.role}</p>}
    </div>
  );
}

function Row({
  mover,
  axis,
  scale,
  selected,
  onSelect,
  a,
  b,
}: {
  mover: Mover;
  axis: { min: number; max: number };
  scale: number;
  selected: boolean;
  onSelect: () => void;
  a: Scenario;
  b: Scenario;
}) {
  const x = linear([axis.min, axis.max], [0, 100]);
  const xa = x(mover.a);
  const xb = x(mover.b);
  const tone = mover.delta < -0.0005 ? 'against' : mover.delta > 0.0005 ? 'favor' : 'neutral';
  return (
    <m.li
      layout="position"
      transition={SPRING.smooth}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="sw-cmp-mv"
      data-selected={selected || undefined}
      data-tone={tone}
      data-mover={mover.id}
    >
      <button
        type="button"
        className="sw-cmp-mv__head"
        aria-expanded={selected}
        onClick={onSelect}
        style={vars({
          '--xa': xa.toFixed(2),
          '--xb': xb.toFixed(2),
          '--x0': x(0).toFixed(2),
          '--lo': Math.min(xa, xb).toFixed(2),
          '--span': Math.abs(xb - xa).toFixed(2),
          '--fill': stanceColor(mover.b, Math.max(scale, 0.05)),
          '--group': clusterColour(mover.group),
        })}
      >
        <span className="sw-cmp-mv__name">
          <span className="sw-cmp-mv__dot" aria-hidden="true" />
          <span>{mover.name}</span>
        </span>
        <span className="sw-cmp-mv__track" aria-hidden="true">
          <span className="sw-cmp-mv__zero" />
          <span className="sw-cmp-mv__link" />
          <span className="sw-cmp-mv__end" data-side="a" />
          <span className="sw-cmp-mv__end" data-side="b" />
        </span>
        <span className="sw-cmp-mv__delta num">{signed(mover.delta)}</span>
        <span className="sr-only">
          {`: stance ${signed(mover.a)} under ${a.label}, ${signed(mover.b)} under ${b.label}, a difference of ${signed(mover.delta)}`}
        </span>
        <ChevronDown className="sw-cmp-mv__chev" size={16} aria-hidden="true" />
      </button>
      <div className="sw-cmp-mv__panel" data-open={selected} inert={!selected}>
        <div className="sw-cmp-mv__panel-in">
          <Detail mover={mover} a={a} b={b} />
        </div>
      </div>
    </m.li>
  );
}

/** Colours a map by how far each actor moved, and says what the colours are. */
function DeltaKey({ scale, a, b }: { scale: number; a: Scenario; b: Scenario }) {
  return (
    <div className="sw-cmp-dkey" aria-hidden="true">
      <span className="sw-cmp-dkey__end" data-end="lo">
        less favourable under {b.label}
      </span>
      <span
        className="sw-cmp-dkey__bar"
        style={{
          background: `linear-gradient(90deg, ${stanceColor(-scale, scale)}, ${stanceColor(0, scale)} 50%, ${stanceColor(scale, scale)})`,
        }}
      />
      <span className="sw-cmp-dkey__end" data-end="hi">
        more favourable than {a.label}
      </span>
      <span className="sw-cmp-dkey__scale num">
        <span>{signed(-scale, 2)}</span>
        <span>0</span>
        <span>{signed(scale, 2)}</span>
      </span>
    </div>
  );
}

function MoverMap({
  analysis,
  movers,
  group,
  selected,
  onSelect,
  scale,
  a,
  b,
}: {
  analysis: Analysis;
  movers: readonly Mover[];
  group: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  scale: number;
  a: Scenario;
  b: Scenario;
}) {
  const [ref, near] = useInView<HTMLDivElement>('700px 0px 700px 0px');
  const nodes = useMemo(() => nodesFromActors(analysis.actors), [analysis.actors]);
  const edges = useMemo(
    () => edgesOf(analysis.relations, new Set(nodes.map((node) => node.id))),
    [analysis.relations, nodes],
  );
  const byId = useMemo(() => new Map(movers.map((mover) => [mover.id, mover])), [movers]);
  const hidden = useMemo(() => hiddenGroups(movers, group), [movers, group]);
  // The actors that moved furthest are named on the map; the others are one hover or press away.
  const leaders = useMemo(
    () =>
      new Set(
        rankMovers(movers)
          .slice(0, 5)
          .map((mover) => mover.id),
      ),
    [movers],
  );
  return (
    <div className="sw-cmp-map" ref={ref}>
      <div className="sw-cmp-map__canvas">
        {near && (
          <Ecosystem
            nodes={nodes}
            edges={edges}
            label={`Simulated actors, coloured by how far their stance moved from ${a.label} to ${b.label}`}
            mode="value"
            valueFor={(id) => byId.get(id)?.delta ?? null}
            valueScale={scale}
            selectedId={selected}
            onSelect={onSelect}
            hiddenClusters={hidden}
            drift={false}
            clusters={false}
            labels="none"
            emphasis={leaders}
            inset={{ top: 28, bottom: 28, left: 28, right: 28 }}
            zoomLabels={{ group: 'Zoom', in: 'Zoom in', out: 'Zoom out', fit: 'Fit everything' }}
            describe={(node) => {
              const mover = byId.get(node.id);
              return mover
                ? `${node.label}, ${node.categoryLabel}, stance ${signed(mover.a)} under ${a.label}, ${signed(mover.b)} under ${b.label}`
                : `${node.label}, ${node.categoryLabel}`;
            }}
            tooltip={(node) => {
              const mover = byId.get(node.id);
              return (
                <>
                  <strong>{node.label}</strong>
                  <span>
                    {mover
                      ? `${signed(mover.delta)} stance, ${stanceWord(mover.b)}`
                      : node.categoryLabel}
                  </span>
                </>
              );
            }}
          />
        )}
      </div>
      <DeltaKey scale={scale} a={a} b={b} />
    </div>
  );
}

const tableOf = (movers: readonly Mover[], a: Scenario, b: Scenario): TableSpec => ({
  caption: `Mean final stance of each simulated actor's members under ${a.label} and under ${b.label} (from -1 to +1), and the difference, with the share looking for an alternative or resisting`,
  columns: [
    'Actor',
    'Group',
    'Simulated members',
    `Stance, ${a.label}`,
    `Stance, ${b.label}`,
    'Difference',
    `Alternative or resist, ${a.label}`,
    `Alternative or resist, ${b.label}`,
  ],
  rows: rankMovers(movers).map((mover) => {
    const adverse = adverseOf(mover);
    return [
      mover.name,
      clusterLabel(mover.group),
      countText(mover.members),
      signed(mover.a, 3),
      signed(mover.b, 3),
      signed(mover.delta, 3),
      shareText(adverse.a, 1),
      shareText(adverse.b, 1),
    ];
  }),
});

/**
 * The simulated actors, ranked by how far their stance moved between the two scenarios: each a line from where its
 * members stood in one to where they stand in the other, on one ruler. The same actors are a map, coloured by the
 * move. Pressing either opens what an actor's members did in each scenario. Actors are synthetic, and sizes are assumptions.
 */
export function Movers({
  analysis,
  pair,
  scenarios,
  movers,
  source,
}: {
  analysis: Analysis;
  pair: Pair;
  scenarios: readonly Scenario[];
  movers: readonly Mover[];
  source: MoverSource;
}) {
  const a = scenarios.find((scenario) => scenario.id === pair.a) ?? null;
  const b = scenarios.find((scenario) => scenario.id === pair.b) ?? null;
  const wide = useMediaQuery('(min-width: 64rem)');
  const reduced = useReducedMotion();
  const [group, setGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [panel, setPanel] = useState<'list' | 'map'>('list');
  const list = useRef<HTMLOListElement>(null);

  const ranked = useMemo(() => rankMovers(movers), [movers]);
  const groups = useMemo(() => groupsOf(movers), [movers]);
  const axis = useMemo(() => stanceScale(movers), [movers]);
  const scale = useMemo(() => deltaScale(movers), [movers]);
  const visibleGroup = group !== null && groups.some((entry) => entry.id === group) ? group : null;
  const filtered = inGroup(ranked, visibleGroup);
  const shown = all || visibleGroup !== null ? filtered : filtered.slice(0, SHOWN);
  const hasMore = visibleGroup === null && filtered.length > SHOWN;

  // A press on the map brings that actor's row into view, once the row is there: an actor ranked past the first few has no
  // row until the list has opened to show it.
  const rowShown = selected !== null && shown.some((mover) => mover.id === selected);
  useEffect(() => {
    if (!selected || !rowShown) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-mover="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [selected, rowShown, reduced]);
  const selectedMover = selected ? (movers.find((mover) => mover.id === selected) ?? null) : null;
  const hiddenByLimit = selected !== null && !rowShown;
  useEffect(() => {
    if (hiddenByLimit) setAll(true);
  }, [hiddenByLimit]);

  const info = sectionInfo('movers');
  if (!a || !b) {
    return (
      <Section info={info}>
        <p className="sw-cmp-note">Two scenarios are needed to see who moves between them.</p>
      </Section>
    );
  }
  if (source === 'none') {
    return (
      <Section info={info}>
        <p className="sw-cmp-note">
          Results for each actor were not kept in this comparison, so who moves between {a.label}{' '}
          and {b.label} cannot be shown.
        </p>
      </Section>
    );
  }

  const showList = wide || panel === 'list';
  const showMap = wide || panel === 'map';
  const ticks = axis.ticks.filter((tick) => tick >= axis.min - 1e-9 && tick <= axis.max + 1e-9);
  const x = linear([axis.min, axis.max], [0, 100]);

  return (
    <Section
      info={info}
      aside={
        !wide ? (
          <Segmented
            label="Show actors as"
            size="sm"
            value={panel}
            onChange={setPanel}
            options={[
              { value: 'list', label: 'List' },
              { value: 'map', label: 'Map' },
            ]}
          />
        ) : undefined
      }
    >
      <div className="sw-cmp-mvs" data-wide={wide || undefined}>
        {showList && (
          <div className="sw-cmp-mvs__list">
            <div className="sw-cmp-mvs__chips" role="group" aria-label="Show actors of a group">
              <ChipButton pressed={visibleGroup === null} onClick={() => setGroup(null)}>
                All <span className="num">{movers.length}</span>
              </ChipButton>
              {groups.map((entry) => (
                <ChipButton
                  key={entry.id}
                  pressed={visibleGroup === entry.id}
                  onClick={() => setGroup(visibleGroup === entry.id ? null : entry.id)}
                >
                  <span
                    className="sw-cmp-mvs__swatch"
                    style={{ background: clusterColour(entry.id) }}
                    aria-hidden="true"
                  />
                  {entry.label} <span className="num">{entry.count}</span>
                </ChipButton>
              ))}
            </div>
            <div className="sw-cmp-mvs__scale" aria-hidden="true">
              <span className="sw-cmp-mvs__legend">
                <span>
                  <Mark side="a" />
                  {a.label}
                </span>
                <span>
                  <Mark side="b" />
                  {b.label}
                </span>
              </span>
              <span className="sw-cmp-mvs__axis">
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    style={{ left: `${x(tick)}%` }}
                    data-edge={x(tick) < 9 ? 'start' : x(tick) > 91 ? 'end' : undefined}
                    className="num"
                  >
                    {tick === 0 ? '0' : signed(tick, 2)}
                  </span>
                ))}
              </span>
              <span className="sw-cmp-mvs__diff">Difference</span>
            </div>
            <LayoutGroup>
              <ol
                className="sw-cmp-mvs__rows"
                ref={list}
                aria-label="Actors, those who moved most first"
              >
                <AnimatePresence initial={false}>
                  {shown.map((mover) => (
                    <Row
                      key={mover.id}
                      mover={mover}
                      axis={axis}
                      scale={scale}
                      selected={selected === mover.id}
                      onSelect={() => setSelected(selected === mover.id ? null : mover.id)}
                      a={a}
                      b={b}
                    />
                  ))}
                </AnimatePresence>
              </ol>
            </LayoutGroup>
            {hasMore && (
              <button type="button" className="sw-cmp-more" onClick={() => setAll((old) => !old)}>
                {all ? 'Show fewer' : `Show all ${filtered.length}`}
                <ChevronDown size={16} aria-hidden="true" data-up={all || undefined} />
              </button>
            )}
            <p className="sw-cmp-quiet">
              {STANCE_WORDS} Actors are synthetic, and the sizes they stand for are assumptions.
            </p>
          </div>
        )}
        {showMap && (
          <div className="sw-cmp-mvs__map">
            <MoverMap
              analysis={analysis}
              movers={movers}
              group={visibleGroup}
              selected={selected}
              onSelect={setSelected}
              scale={scale}
              a={a}
              b={b}
            />
            {!wide && selectedMover && (
              <div
                className="sw-cmp-mvs__peek"
                role="region"
                aria-label={`${selectedMover.name}, in detail`}
              >
                <p className="sw-cmp-mvs__peekhead">
                  <b>{selectedMover.name}</b>
                  <span className="num">{signed(selectedMover.delta)}</span>
                  <button type="button" onClick={() => setSelected(null)}>
                    Close
                  </button>
                </p>
                <Detail mover={selectedMover} a={a} b={b} />
              </div>
            )}
          </div>
        )}
      </div>
      <DataTable spec={tableOf(movers, a, b)} />
    </Section>
  );
}
