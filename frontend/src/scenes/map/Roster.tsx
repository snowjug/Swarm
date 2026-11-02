import { useMemo } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { Plus } from 'lucide-react';
import { cx } from '../../design/cx';
import { SPRING } from '../../design/motion';
import { Button, Chip, Disclosure } from '../../design/ui';
import { clusterColour, clusterLabel, CLUSTER_ORDER, directionColor } from '../../viz/palette';
import type { EcoNode } from '../../viz/ecosystem/model';
import { STATUS_LABELS } from '../../lib/stakeholders/labels';
import type { Stakeholder } from '../../../../shared/stakeholders';
import type { Ghost } from './model';
import { ImpactChip } from './parts';
import './roster.css';

export interface RosterProps {
  nodes: readonly EcoNode[];
  /** One line on each: why it is here, or what its role is. */
  why: (id: string) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hidden: ReadonlySet<string>;
  removed: readonly Stakeholder[];
  ghosts: readonly Ghost[];
  onGhost?: (ghost: Ghost) => void;
  label: string;
}

function Row({
  node,
  why,
  selected,
  onSelect,
}: {
  node: EcoNode;
  why: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <m.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={SPRING.smooth}
    >
      <button
        type="button"
        className={cx('sw-roster__row', selected && 'is-selected')}
        aria-pressed={selected}
        data-stk-focus={`node:${node.id}`}
        onClick={onSelect}
      >
        <span
          className="sw-roster__orb"
          style={{
            background: directionColor(node.direction, node.cluster),
            opacity: node.confidence === 'low' ? 0.6 : 1,
          }}
          data-direct={node.direct === null ? undefined : String(node.direct)}
          aria-hidden="true"
        />
        <span className="sw-roster__main">
          <span className="sw-roster__name">{node.label}</span>
          <span className="sw-roster__why">{why}</span>
        </span>
        <span className="sw-roster__meta">
          {node.kind === 'key' ? <Chip size="sm">Key</Chip> : null}
          <ImpactChip direction={node.direction} />
          {node.status === 'proposed' && (
            <Chip size="sm" tone="caution">
              {STATUS_LABELS.proposed}
            </Chip>
          )}
        </span>
      </button>
    </m.li>
  );
}

/**
 * The same parties as the map, as a list: the way to read them without a pointer, and the quickest way to go
 * down them one by one. A press opens the same detail as a press on the map does.
 */
export function Roster({
  nodes,
  why,
  selectedId,
  onSelect,
  hidden,
  removed,
  ghosts,
  onGhost,
  label,
}: RosterProps) {
  const groups = useMemo(() => {
    const by = new Map<string, EcoNode[]>();
    for (const node of nodes) {
      if (hidden.has(node.cluster)) continue;
      const list = by.get(node.cluster);
      if (list) list.push(node);
      else by.set(node.cluster, [node]);
    }
    return CLUSTER_ORDER.filter((id) => by.has(id)).map((id) => ({
      id,
      items: by.get(id)!.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label)),
    }));
  }, [nodes, hidden]);

  return (
    <div className="sw-roster" aria-label={label} role="region">
      <LayoutGroup>
        {groups.map((group) => (
          <section
            key={group.id}
            className="sw-roster__group"
            aria-labelledby={`roster-${group.id}`}
          >
            <h2 id={`roster-${group.id}`} className="sw-eyebrow sw-roster__heading">
              <span
                className="sw-roster__swatch"
                style={{ background: clusterColour(group.id) }}
                aria-hidden="true"
              />
              {clusterLabel(group.id)}
              <span className="sw-roster__count">{group.items.length}</span>
            </h2>
            <ul className="sw-roster__list">
              <AnimatePresence initial={false}>
                {group.items.map((node) => (
                  <Row
                    key={node.id}
                    node={node}
                    why={why(node.id)}
                    selected={selectedId === node.id}
                    onSelect={() => onSelect(node.id)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))}
      </LayoutGroup>

      {ghosts.length > 0 && onGhost && (
        <section className="sw-roster__group" aria-labelledby="roster-missing">
          <h2 id="roster-missing" className="sw-eyebrow sw-roster__heading">
            Nobody found for
          </h2>
          <ul className="sw-roster__list">
            {ghosts.map((ghost) => (
              <li key={ghost.id} className="sw-roster__gap">
                <span className="sw-roster__name">{ghost.label}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus size={14} aria-hidden="true" />}
                  onClick={() => onGhost(ghost)}
                >
                  Add
                  <span className="sr-only"> {ghost.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {removed.length > 0 && (
        <Disclosure
          summary={
            <>
              Removed <span className="sw-roster__count">{removed.length}</span>
            </>
          }
        >
          <ul className="sw-roster__list sw-roster__list--removed">
            {removed.map((stakeholder) => (
              <li key={stakeholder.id}>
                <button
                  type="button"
                  className={cx('sw-roster__row', selectedId === stakeholder.id && 'is-selected')}
                  aria-pressed={selectedId === stakeholder.id}
                  data-stk-focus={`node:${stakeholder.id}`}
                  onClick={() => onSelect(stakeholder.id)}
                >
                  <span className="sw-roster__orb is-removed" aria-hidden="true" />
                  <span className="sw-roster__main">
                    <span className="sw-roster__name">{stakeholder.name}</span>
                    <span className="sw-roster__why">
                      {STATUS_LABELS.removed}. Any of them can be restored.
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
