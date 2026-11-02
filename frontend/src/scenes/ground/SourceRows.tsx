import { FileText } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { EmptyState, Notice, Button, Skeleton } from '../../design/ui';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { CONFLICT_STATUS_SHORT, arcGeometry, conflictLabel } from './conflicts';
import { useGroundActions, useGroundData, useGroundLit } from './context';
import { vars } from './css';
import { documentColour, figure, plural } from './model';
import { placePassages, rangeText } from './passages';
import { SourceTag } from './SourceTag';
import { useCentres } from './useCentres';
import './sources.css';

export type Reading = 'idle' | 'active' | 'done';

/**
 * The sources as threads: each document is a line as long as it is (against the longest), its passages are
 * laid along it where they sit in the text, and the conflicts between documents are arcs on the right. It is
 * the same drawing whether it is the whole of the first screen (before there is a graph) or a part of the page.
 * Pointing at a document, a passage or an arc lights what it is tied to in the graph and the conflicts.
 */
export function SourceRows({ variant, reading }: { variant: 'field' | 'list'; reading: Reading }) {
  const { documents, passages, ledger, conflictsKnown, mode } = useGroundData();
  const actions = useGroundActions();
  const { lit } = useGroundLit();
  const wrap = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery('(max-width: 40rem)');

  const conflicts = useMemo(
    () => (conflictsKnown ? (ledger.ledger?.contradictions ?? []) : []),
    [conflictsKnown, ledger.ledger],
  );
  const longest = Math.max(1, ...documents.map((doc) => doc.characters));
  // Each arc ends at the passage it is about, so that the line and the thing it is about are tied by height;
  // where the passages are not known yet it ends at the document.
  const anchors = useMemo(() => {
    const keys: string[] = [];
    const indexOf = new Map<string, number>();
    const at = (key: string) => {
      const known = indexOf.get(key);
      if (known !== undefined) return known;
      keys.push(key);
      indexOf.set(key, keys.length - 1);
      return keys.length - 1;
    };
    const ends = conflicts.map((conflict) => {
      const side = (ref: typeof conflict.left) => {
        const passageKey = `passage:${ref.passageId}`;
        return passages.index?.byId.has(ref.passageId)
          ? at(passageKey)
          : at(`doc:${ref.documentId}`);
      };
      return {
        id: conflict.id,
        status: conflict.status,
        from: side(conflict.left),
        to: side(conflict.right),
      };
    });
    return { keys, ends };
  }, [conflicts, passages.index]);
  const gutter = anchors.ends.length === 0 ? 0 : narrow ? 44 : 72;
  const { centres, height } = useCentres(
    wrap,
    `${documents.length}:${passages.index?.all.length ?? 0}:${gutter}:${anchors.keys.length}`,
  );
  const arcs = useMemo(
    () =>
      arcGeometry(
        anchors.ends,
        anchors.keys.map((key) => centres.get(key) ?? Number.NaN),
        Math.max(gutter, 1),
        0,
      ),
    [anchors, centres, gutter],
  );
  const conflictById = useMemo(
    () => new Map(conflicts.map((conflict) => [conflict.id, conflict])),
    [conflicts],
  );
  // A passage that sits in an open conflict carries a mark, so the arc and the thread it ends on are tied.
  const openStatus = useMemo(() => {
    const marks = new Map<string, 'detected' | 'confirmed'>();
    for (const conflict of conflicts) {
      if (conflict.status !== 'detected' && conflict.status !== 'confirmed') continue;
      for (const id of [conflict.left.passageId, conflict.right.passageId]) {
        if (marks.get(id) !== 'confirmed') marks.set(id, conflict.status);
      }
    }
    return marks;
  }, [conflicts]);

  if (documents.length === 0) {
    return (
      <EmptyState icon={<FileText size={22} aria-hidden="true" />} title="No source text">
        This record holds no readable sources.
      </EmptyState>
    );
  }

  return (
    <div
      ref={wrap}
      className="sw-ground-src"
      data-variant={variant}
      data-reading={reading}
      data-arcs={anchors.ends.length > 0}
      style={vars({ '--arc-w': `${gutter}px` })}
    >
      <ol className="sw-ground-src__list" role="list" aria-label="Sources">
        {documents.map((doc, index) => {
          const own = passages.index?.byDocument.get(doc.id) ?? [];
          const placed = placePassages(own, doc.characters);
          const litRow = lit.documents.has(doc.id);
          return (
            <li
              key={doc.id}
              className="sw-ground-src__row"
              data-lit={lit.active && litRow ? '' : undefined}
              data-dim={lit.active && !litRow ? '' : undefined}
              style={vars({
                '--doc': documentColour(index),
                '--i': index,
                '--body': Math.max(0.34, doc.characters / longest),
                '--lanes': placed.lanes,
              })}
              onPointerEnter={(event) =>
                event.pointerType === 'mouse' && actions.hover({ document: doc.id })
              }
              onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
            >
              <div className="sw-ground-src__head">
                <button
                  type="button"
                  className="sw-ground-src__open"
                  onClick={() => actions.openDocument(doc.id)}
                  onFocus={() => actions.hover({ document: doc.id })}
                  onBlur={() => actions.hover(null)}
                >
                  <span className="sw-ground-src__idx">
                    <i aria-hidden="true" />
                    {doc.id}
                  </span>
                  <span className="sw-ground-src__name">{doc.name}</span>
                </button>
                <span className="sw-ground-src__meta">
                  <SourceTag doc={doc} />
                  <span className="sw-ground-src__facts num">
                    {plural(doc.characters, 'character')}
                    {doc.pages ? ` · ${plural(doc.pages, 'page')}` : ''}
                    {passages.index ? ` · ${plural(own.length, 'passage')}` : ''}
                  </span>
                </span>
              </div>
              <div className="sw-ground-src__thread" data-key={`doc:${doc.id}`}>
                <span className="sw-ground-src__scan" aria-hidden="true" />
                <div className="sw-ground-src__body">
                  {passages.loading && !passages.index && (
                    <Skeleton width="100%" height="1.1rem" radius="var(--r-pill)" />
                  )}
                  {placed.items.map((item, at) => {
                    const id = item.passage.id;
                    const isLit = lit.passages.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className="sw-ground-src__passage"
                        data-key={`passage:${id}`}
                        data-lit={lit.active && isLit ? '' : undefined}
                        data-dim={lit.active && !isLit && lit.passages.size > 0 ? '' : undefined}
                        data-conflict={openStatus.get(id)}
                        style={vars({
                          '--from': item.from,
                          '--span': item.span,
                          '--lane': item.lane,
                          '--n': at,
                        })}
                        aria-label={`Passage ${id}, ${rangeText(item.passage)}${
                          openStatus.has(id) ? ', in a conflict that is not settled' : ''
                        }`}
                        onClick={() => actions.openPassage(id)}
                        onPointerEnter={(event) => {
                          event.stopPropagation();
                          if (event.pointerType === 'mouse') actions.hover({ passage: id });
                        }}
                        onPointerLeave={(event) => {
                          if (event.pointerType === 'mouse') actions.hover({ document: doc.id });
                        }}
                        onFocus={() => actions.hover({ passage: id })}
                        onBlur={() => actions.hover(null)}
                      >
                        {id}
                      </button>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {arcs.length > 0 && height > 0 && (
        <svg
          className="sw-ground-src__arcs"
          width={gutter}
          height={height}
          role="group"
          aria-label="Conflicts between documents"
        >
          {arcs.map((arc, index) => {
            const conflict = conflictById.get(arc.id);
            if (!conflict) return null;
            const isLit = lit.conflicts.has(arc.id);
            return (
              <g
                key={arc.id}
                className="sw-ground-arc"
                data-status={arc.status}
                data-lit={lit.active && isLit ? '' : undefined}
                data-dim={lit.active && !isLit ? '' : undefined}
                style={vars({ '--i': index })}
                role="button"
                tabIndex={0}
                aria-label={`${conflictLabel(conflict)}. Show conflict.`}
                onClick={() => actions.showConflict(arc.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    actions.showConflict(arc.id);
                  }
                }}
                onPointerEnter={(event) =>
                  event.pointerType === 'mouse' && actions.hover({ conflict: arc.id })
                }
                onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
                onFocus={() => actions.hover({ conflict: arc.id })}
                onBlur={() => actions.hover(null)}
              >
                <path className="sw-ground-arc__hit" d={arc.d} />
                <path className="sw-ground-arc__line" d={arc.d} />
                <circle className="sw-ground-arc__dot" cx={arc.a.x} cy={arc.a.y} r={3} />
                <circle className="sw-ground-arc__dot" cx={arc.b.x} cy={arc.b.y} r={3} />
                <text className="sw-ground-arc__id" x={arc.apex.x + 7} y={arc.apex.y + 4}>
                  {arc.id}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {passages.error && (
        <Notice
          tone="error"
          title="Passages could not be read"
          action={
            <Button size="sm" variant="glass" onClick={passages.reload}>
              Retry
            </Button>
          }
        >
          {passages.error}
        </Notice>
      )}
      {mode === 'advanced' && variant === 'list' && arcs.length > 0 && (
        <p className="sw-ground-src__legend sw-caption">
          {arcs.length === 1 ? 'One arc' : `${figure(arcs.length)} arcs`}:{' '}
          {arcs
            .map((arc) => `${arc.id} ${CONFLICT_STATUS_SHORT[arc.status].toLowerCase()}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
