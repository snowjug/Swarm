import { Check, FileText, TriangleAlert, X } from 'lucide-react';
import { useMemo } from 'react';
import { isOpenConflict, type ContradictionRecord } from '../../../../shared/evidence';
import { EmptyState, Notice, Button, Orbit, Skeleton } from '../../design/ui';
import { conflictLabel } from './conflicts';
import { useGroundActions, useGroundData, useGroundLit } from './context';
import { vars } from './css';
import { documentColour, entityNoun, plural, type DocumentFacts, type Moment } from './model';
import { placePassages, rangeText } from './passages';
import { SourceTag } from './SourceTag';
import { useMoment } from './useMoment';
import './sources.css';

export type Reading = 'idle' | 'active' | 'done';

/** The topics a source gives rise to, the heaviest first: what the engine took out of it. */
function signalsOf(
  documentId: string,
  nodes: readonly { label: string; weight: number; documentIds: readonly string[] }[],
): string[] {
  return nodes
    .filter((node) => node.documentIds.includes(documentId))
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .map((node) => node.label);
}

const WORKING_LABEL: Partial<Record<Moment, string>> = {
  queued: 'Queued',
  reading: 'Reading',
  extracting: 'Extracting',
  checking: 'Checking',
};

/** Where one source is: working, ready, or needing a look (a conflict that is not settled involves it). */
function SourceState({
  moment,
  conflicts,
  onShow,
}: {
  moment: Moment;
  conflicts: readonly ContradictionRecord[];
  onShow: (id: string) => void;
}) {
  const settled = moment === 'ready' || moment === 'record';
  if (settled && conflicts.length > 0) {
    return (
      <div className="sw-ground-src__state" data-state="attention">
        <span className="sw-ground-src__badge">
          <TriangleAlert size={14} aria-hidden="true" />
          Needs attention
        </span>
        <span
          className="sw-ground-src__flags"
          role="group"
          aria-label="Conflicts between documents"
        >
          {conflicts.map((conflict) => (
            <button
              key={conflict.id}
              type="button"
              className="sw-ground-src__flag num"
              data-status={conflict.status}
              aria-label={`${conflictLabel(conflict)}. Show conflict.`}
              onClick={() => onShow(conflict.id)}
            >
              {conflict.id}
            </button>
          ))}
        </span>
      </div>
    );
  }
  const working = WORKING_LABEL[moment];
  if (working) {
    return (
      <div className="sw-ground-src__state" data-state="working">
        <span className="sw-ground-src__badge">
          <Orbit size={16} label={working} />
          {working}
        </span>
      </div>
    );
  }
  if (moment === 'ready') {
    return (
      <div className="sw-ground-src__state" data-state="ready">
        <span className="sw-ground-src__badge">
          <Check size={14} strokeWidth={2.5} aria-hidden="true" />
          Ready
        </span>
      </div>
    );
  }
  if (moment === 'failed' || moment === 'stopped') {
    return (
      <div className="sw-ground-src__state" data-state="stopped">
        <span className="sw-ground-src__badge">
          <X size={14} aria-hidden="true" />
          {moment === 'failed' ? 'Failed' : 'Stopped'}
        </span>
      </div>
    );
  }
  return null;
}

/**
 * The sources as a tray: one line for each, with where it came from, what the engine took out of it, how it was
 * cut into passages (laid along a thread as long as the document is) and where it stands: working, ready, or
 * needing a look. It is the same drawing whether it is the whole of the first screen (before there is a graph) or
 * a part of the page. Pointing at a document or a passage lights what it is tied to in the graph and the conflicts.
 */
export function SourceRows({ variant, reading }: { variant: 'field' | 'list'; reading: Reading }) {
  const { project, documents, passages, ledger, conflictsKnown, mode, graph } = useGroundData();
  const actions = useGroundActions();
  const { lit } = useGroundLit();
  const { moment } = useMoment();
  const noun = entityNoun(project.graph);

  const conflicts = useMemo(
    () => (conflictsKnown ? (ledger.ledger?.contradictions ?? []) : []),
    [conflictsKnown, ledger.ledger],
  );
  const open = useMemo(
    () => conflicts.filter((conflict) => isOpenConflict(conflict.status)),
    [conflicts],
  );
  const longest = Math.max(1, ...documents.map((doc) => doc.characters));
  // A passage that sits in an open conflict carries a mark, so the conflict and the thread it touches are tied.
  const openStatus = useMemo(() => {
    const marks = new Map<string, 'detected' | 'confirmed'>();
    for (const conflict of open) {
      if (conflict.status !== 'detected' && conflict.status !== 'confirmed') continue;
      for (const id of [conflict.left.passageId, conflict.right.passageId]) {
        if (marks.get(id) !== 'confirmed') marks.set(id, conflict.status);
      }
    }
    return marks;
  }, [open]);
  const openOf = (doc: DocumentFacts): ContradictionRecord[] =>
    open.filter(
      (conflict) => conflict.left.documentId === doc.id || conflict.right.documentId === doc.id,
    );

  if (documents.length === 0) {
    return (
      <EmptyState icon={<FileText size={22} aria-hidden="true" />} title="No source text">
        This record holds no readable sources.
      </EmptyState>
    );
  }

  return (
    <div className="sw-ground-src" data-variant={variant} data-reading={reading}>
      <ol className="sw-ground-src__list" role="list" aria-label="Sources">
        {documents.map((doc, index) => {
          const own = passages.index?.byDocument.get(doc.id) ?? [];
          const placed = placePassages(own, doc.characters);
          const litRow = lit.documents.has(doc.id);
          const signals = variant === 'list' && graph ? signalsOf(doc.id, graph.nodes) : [];
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
              {variant === 'list' && signals.length > 0 && (
                <ul
                  className="sw-ground-src__signals"
                  role="list"
                  aria-label={`${noun.many} from ${doc.name}`}
                >
                  {signals.slice(0, 4).map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                  {signals.length > 4 && (
                    <li className="sw-ground-src__more num">+{signals.length - 4}</li>
                  )}
                </ul>
              )}
              <div className="sw-ground-src__thread">
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
              <SourceState moment={moment} conflicts={openOf(doc)} onShow={actions.showConflict} />
            </li>
          );
        })}
      </ol>

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
      {mode === 'advanced' && variant === 'list' && open.length > 0 && (
        <p className="sw-ground-src__legend sw-caption">
          {open.length === 1 ? 'One conflict' : `${open.length} conflicts`} not settled:{' '}
          {open.map((conflict) => conflict.id).join(' · ')}
        </p>
      )}
    </div>
  );
}
