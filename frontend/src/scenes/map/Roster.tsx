import { useMemo } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { Check, Plus } from 'lucide-react';
import { cx } from '../../design/cx';
import { SPRING } from '../../design/motion';
import { Button, Chip, Disclosure } from '../../design/ui';
import {
  clusterColour,
  clusterLabel,
  CLUSTER_ORDER,
  DIRECTION_LABEL,
  directionColor,
  stanceWord,
} from '../../viz/palette';
import type { EcoNode } from '../../viz/ecosystem/model';
import { STATUS_LABELS } from '../../lib/stakeholders/labels';
import type { Stakeholder } from '../../../../shared/stakeholders';
import type { Ghost, Subject } from './model';
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
  /** Whether the rows are stakeholders to review or actors to read: what each says of itself follows. */
  subject: Subject;
}

const INFLUENCE_WORD = (value: number): string =>
  value < 0.34 ? 'Low' : value < 0.67 ? 'Medium' : 'High';

/** What a row says of its party in a line: facts, not a sentence that every row of its group would repeat. */
function factsOf(node: EcoNode, subject: Subject): string[] {
  const facts: string[] = [];
  if (subject === 'actors') {
    facts.push(node.kind === 'key' ? 'One actor' : `Cohort of ${node.members ?? 1}`);
    if (node.value !== undefined) facts.push(stanceWord(node.value, 1));
  } else {
    if (node.direct !== null) facts.push(node.direct ? 'Direct' : 'Indirect');
  }
  facts.push(
    node.evidenceCount === 0
      ? 'Assumed'
      : `${node.evidenceCount} ${node.evidenceCount === 1 ? 'quote' : 'quotes'}`,
  );
  return facts;
}

/** Three notches that fill with influence: a cue for who matters, with the word beside it for anyone who cannot see it. */
function Influence({ value }: { value: number }) {
  const level = value < 0.34 ? 1 : value < 0.67 ? 2 : 3;
  return (
    <span className="sw-roster__influence" data-level={level}>
      <span className="sw-roster__notches" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="sw-roster__influence-word">{INFLUENCE_WORD(value)} influence</span>
    </span>
  );
}

function Row({
  node,
  line,
  facts,
  subject,
  selected,
  onSelect,
}: {
  node: EcoNode;
  line: string | null;
  facts: string[];
  subject: Subject;
  selected: boolean;
  onSelect: () => void;
}) {
  const reviewed = node.status !== undefined && node.status !== 'proposed';
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
          data-key={node.kind === 'key' || undefined}
          aria-hidden="true"
        />
        <span className="sw-roster__main">
          <span className="sw-roster__name">
            {node.label}
            {node.kind === 'key' && <span className="sw-roster__key">Key</span>}
          </span>
          <span className="sw-roster__facts">{facts.join(' · ')}</span>
          {line && <span className="sw-roster__why">{line}</span>}
        </span>
        <span className="sw-roster__meta">
          {subject === 'actors' && node.influence !== undefined && (
            <Influence value={node.influence} />
          )}
          {node.direction !== 'unclear' && (
            <Chip
              size="sm"
              tone={
                node.direction === 'harmed'
                  ? 'against'
                  : node.direction === 'benefited'
                    ? 'favor'
                    : 'caution'
              }
              dot
            >
              {DIRECTION_LABEL[node.direction]}
            </Chip>
          )}
          {node.status === 'proposed' && (
            <span className="sw-roster__review">{STATUS_LABELS.proposed}</span>
          )}
          {reviewed && node.status && (
            <span className="sw-roster__reviewed">
              <Check size={13} aria-hidden="true" />
              {STATUS_LABELS[node.status]}
            </span>
          )}
        </span>
      </button>
    </m.li>
  );
}

/**
 * The same parties as the map, as a list: the way to read them without a pointer, and the quickest way to go
 * down them one by one. A press opens the same detail as a press on the map does. A line that every row of a
 * group would say alike is said once, under the group's name, and each row says what is its own.
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
  subject,
}: RosterProps) {
  const groups = useMemo(() => {
    const by = new Map<string, EcoNode[]>();
    for (const node of nodes) {
      if (hidden.has(node.cluster)) continue;
      const list = by.get(node.cluster);
      if (list) list.push(node);
      else by.set(node.cluster, [node]);
    }
    return CLUSTER_ORDER.filter((id) => by.has(id)).map((id) => {
      const items = by
        .get(id)!
        .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
      // What more than one row of the group says word for word is the group's, not any row's.
      const seen = new Map<string, number>();
      for (const node of items) {
        const text = why(node.id).trim();
        if (text) seen.set(text, (seen.get(text) ?? 0) + 1);
      }
      const shared = [...seen].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1])[0];
      return { id, items, gloss: shared?.[0] ?? null };
    });
  }, [nodes, hidden, why]);

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
            {group.gloss && <p className="sw-roster__gloss">{group.gloss}</p>}
            <ul className="sw-roster__list">
              <AnimatePresence initial={false}>
                {group.items.map((node) => {
                  const text = why(node.id).trim();
                  // A line that is the same for the group is above; one that is only the method ("Found by reading…")
                  // is in the detail of the party.
                  const own =
                    text && text !== group.gloss && !/^Found by reading the text/u.test(text)
                      ? text
                      : null;
                  return (
                    <Row
                      key={node.id}
                      node={node}
                      line={own}
                      facts={factsOf(node, subject)}
                      subject={subject}
                      selected={selectedId === node.id}
                      onSelect={() => onSelect(node.id)}
                    />
                  );
                })}
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
