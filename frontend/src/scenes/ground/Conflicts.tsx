import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Info,
  Pencil,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTRADICTION_STATUS_LABELS,
  MAX_REVIEW_NOTE_LENGTH,
  isOpenConflict,
  type ContradictionRecord,
  type ContradictionStatus,
  type EvidenceRef,
} from '../../../../shared/evidence';
import { ApiError, api, errorMessage } from '../../api';
import { SPRING, useReducedMotion } from '../../design/motion';
import {
  Button,
  Chip,
  Disclosure,
  Field,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Textarea,
  useToast,
} from '../../design/ui';
import { dateTime } from '../../lib/format';
import {
  CONFLICT_KIND_LABEL,
  CONFLICT_TONE,
  conflictFigures,
  groupConflicts,
  sharedWords,
} from './conflicts';
import { useGroundActions, useGroundData } from './context';
import { vars } from './css';
import { documentColour } from './model';
import { excerptAround, findPassage, markWithin, plainQuote } from './passages';
import { Reveal } from './Reveal';
import { SectionHead } from './SectionHead';
import './conflicts.css';

const STATUS_ICON: Record<ContradictionStatus, LucideIcon> = {
  detected: CircleHelp,
  confirmed: CircleAlert,
  dismissed: CircleSlash,
  resolved: CircleCheck,
};

function HowFound({ conflict }: { conflict: ContradictionRecord }) {
  const words = sharedWords(conflict.topic);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" icon={<Info size={15} aria-hidden="true" />}>
          How it was found
        </Button>
      </PopoverTrigger>
      <PopoverContent width="23rem" align="end" aria-label="How this conflict was found">
        <div className="sw-ground-method">
          <h3 className="sw-ground-method__title">Found by wording alone</h3>
          <ul className="sw-ground-method__list" role="list">
            <li>
              Both passages share{' '}
              {words.length > 0 ? <strong>{words.join(', ')}</strong> : 'no recorded words'}, so
              they probably speak of the same thing.
            </li>
            <li>
              {conflict.kind === 'numeric'
                ? 'They give different figures.'
                : 'One says the opposite of the other.'}{' '}
              Neither is declared true.
            </li>
            <li className="num">{Math.round(conflict.confidence * 100)}% alike.</li>
            <li>Not a conflict? Say so, and it no longer weighs on the statements it touched.</li>
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Side({
  side,
  figure,
  position,
}: {
  side: EvidenceRef;
  figure: string | null;
  position: 'left' | 'right';
}) {
  const { documents, passages } = useGroundData();
  const actions = useGroundActions();
  const doc = documents.find((item) => item.id === side.documentId);
  const passage = findPassage(passages.index, side.passageId);
  const text = plainQuote(
    side.quote ?? (passage ? excerptAround(passage.text, figure) : ''),
  ).trim();
  const marked = text ? markWithin(text, figure) : null;
  return (
    <figure
      className="sw-ground-duel__side"
      data-position={position}
      style={vars({ '--doc': documentColour(doc?.index ?? 0) })}
    >
      <figcaption className="sw-ground-duel__from">
        <button
          type="button"
          className="sw-ground-duel__doc"
          onClick={() => actions.openPassage(side.passageId, { quote: side.quote })}
          onPointerEnter={(event) =>
            event.pointerType === 'mouse' && actions.hover({ passage: side.passageId })
          }
          onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
        >
          <i aria-hidden="true" />
          <span className="sw-ground-duel__doc-name">{side.documentName}</span>
          <span className="sw-ground-duel__doc-id num">{side.passageId}</span>
        </button>
      </figcaption>
      {figure && <p className="sw-ground-duel__figure sw-numeral">{figure}</p>}
      {text ? (
        <blockquote className="sw-ground-duel__quote">
          {marked ? (
            <>
              {marked.before}
              <mark>{marked.match}</mark>
              {marked.after}
            </>
          ) : (
            text
          )}
        </blockquote>
      ) : (
        <p className="sw-ground-duel__quote sw-ground-duel__quote--none">
          The passage text is not available.
        </p>
      )}
    </figure>
  );
}

const REVIEWED_NOTE: Record<'confirmed' | 'dismissed' | 'resolved', string> = {
  confirmed: 'Confirmed. It stays open until it is resolved.',
  dismissed: 'Not a conflict. It no longer weighs on the statements it touched.',
  resolved: 'Resolved. It no longer weighs on the statements it touched.',
};

function Duel({
  conflict,
  flashing,
  onReviewed,
}: {
  conflict: ContradictionRecord;
  flashing: boolean;
  onReviewed: (message: string) => void;
}) {
  const { project, ledger } = useGroundData();
  const toast = useToast();
  const actions = useGroundActions();
  const figures = conflictFigures(conflict);
  const open = isOpenConflict(conflict.status);
  const Icon = STATUS_ICON[conflict.status];
  const [draft, setDraft] = useState('');
  const [noting, setNoting] = useState(false);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState<ContradictionStatus | null>(null);
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null);

  const review = async (status: 'confirmed' | 'dismissed' | 'resolved') => {
    setBusy(status);
    setError(null);
    try {
      const result = await api.reviewConflict(project.id, conflict.id, {
        status,
        note: draft.trim() || null,
      });
      ledger.replace(result.ledger);
      setDraft('');
      setNoting(false);
      setChanging(false);
      toast({
        title: `${conflict.id} reviewed`,
        description: REVIEWED_NOTE[status],
        tone: 'success',
        duration: 3600,
      });
      onReviewed(`${conflict.id}: ${REVIEWED_NOTE[status]}`);
    } catch (failure) {
      setError({
        text: errorMessage(failure),
        stale: failure instanceof ApiError && failure.code === 'CONFLICT_CHANGED',
      });
    } finally {
      setBusy(null);
    }
  };

  const showActions = open || changing;
  const label = `${conflict.id}: ${figures ? `${figures.left} against ${figures.right}` : CONFLICT_KIND_LABEL[conflict.kind]}`;
  return (
    <article
      className="sw-ground-duel"
      id={`ground-conflict-${conflict.id}`}
      tabIndex={-1}
      aria-label={label}
      data-status={conflict.status}
      data-flash={flashing || undefined}
      onPointerEnter={(event) =>
        event.pointerType === 'mouse' && actions.hover({ conflict: conflict.id })
      }
      onPointerLeave={(event) => event.pointerType === 'mouse' && actions.hover(null)}
    >
      <header className="sw-ground-duel__head">
        <Chip
          tone={CONFLICT_TONE[conflict.status]}
          icon={<Icon aria-hidden="true" />}
          className="sw-ground-duel__status"
          key={conflict.status}
        >
          {CONTRADICTION_STATUS_LABELS[conflict.status]}
        </Chip>
        <span className="sw-ground-duel__kind">{CONFLICT_KIND_LABEL[conflict.kind]}</span>
        <span className="sw-ground-duel__id num">{conflict.id}</span>
        <span className="sw-ground-duel__spacer" />
        <HowFound conflict={conflict} />
      </header>

      <div className="sw-ground-duel__arena">
        <Side side={conflict.left} figure={conflict.leftValue} position="left" />
        <div className="sw-ground-duel__versus" aria-hidden="true">
          <span className="sw-ground-duel__rule" />
          <span className="sw-ground-duel__sign">{figures ? '≠' : 'vs'}</span>
          <span className="sw-ground-duel__rule" />
        </div>
        <Side side={conflict.right} figure={conflict.rightValue} position="right" />
      </div>

      {conflict.note && (
        <p className="sw-ground-duel__note">
          <span>Note</span> {conflict.note}
          {!open && (
            <span className="sw-ground-duel__when num"> · {dateTime(conflict.updatedAt)}</span>
          )}
        </p>
      )}

      <footer className="sw-ground-duel__foot">
        {showActions ? (
          <>
            <div className="sw-ground-duel__actions">
              {conflict.status !== 'confirmed' && (
                <Button
                  size="sm"
                  variant="glass"
                  icon={<Check size={15} aria-hidden="true" />}
                  busy={busy === 'confirmed'}
                  disabled={busy !== null}
                  onClick={() => void review('confirmed')}
                >
                  Confirm
                </Button>
              )}
              {conflict.status !== 'dismissed' && (
                <Button
                  size="sm"
                  variant="glass"
                  icon={<X size={15} aria-hidden="true" />}
                  busy={busy === 'dismissed'}
                  disabled={busy !== null}
                  onClick={() => void review('dismissed')}
                >
                  Not a conflict
                </Button>
              )}
              {conflict.status !== 'resolved' && (
                <Button
                  size="sm"
                  variant="glass"
                  icon={<CircleCheck size={15} aria-hidden="true" />}
                  busy={busy === 'resolved'}
                  disabled={busy !== null}
                  onClick={() => void review('resolved')}
                >
                  Mark resolved
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<Pencil size={14} aria-hidden="true" />}
                aria-expanded={noting}
                onClick={() => setNoting((value) => !value)}
              >
                {noting ? 'Hide note' : 'Add a note'}
              </Button>
              {!open && (
                <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>
                  Cancel
                </Button>
              )}
            </div>
            <Reveal open={noting}>
              <Field
                label="Note"
                hint={`${draft.length} of ${MAX_REVIEW_NOTE_LENGTH.toLocaleString('en-GB')}`}
              >
                <Textarea
                  value={draft}
                  maxLength={MAX_REVIEW_NOTE_LENGTH}
                  maxRows={5}
                  placeholder="Why, in a line"
                  onChange={(event) => setDraft(event.target.value)}
                />
              </Field>
            </Reveal>
          </>
        ) : (
          <div className="sw-ground-duel__actions">
            <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
              Change decision
            </Button>
          </div>
        )}
        {error && (
          <Notice
            tone="error"
            title={error.stale ? 'Someone else changed this' : 'Not saved'}
            action={
              error.stale ? (
                <Button size="sm" variant="glass" onClick={ledger.reload}>
                  Reload
                </Button>
              ) : undefined
            }
          >
            {error.text}
          </Notice>
        )}
      </footer>
    </article>
  );
}

/** Where two sources give different figures or say opposite things, side by side, to be settled by a person. */
export function Conflicts({ flash, seek = null }: { flash: string | null; seek?: string | null }) {
  const { ledger } = useGroundData();
  const reduced = useReducedMotion();
  const groups = useMemo(
    () => groupConflicts(ledger.ledger?.contradictions ?? []),
    [ledger.ledger],
  );
  const total = groups.open.length + groups.reviewed.length;
  const [reviewedOpen, setReviewedOpen] = useState(groups.open.length === 0);
  const [announce, setAnnounce] = useState('');
  const head = useRef<HTMLElement | null>(null);
  // When the last open conflict is settled, what was settled is what there is to see.
  useEffect(() => {
    if (groups.open.length === 0 && groups.reviewed.length > 0) setReviewedOpen(true);
  }, [groups.open.length, groups.reviewed.length]);
  // A conflict that was asked for and is among the reviewed ones is not on the page until they are shown.
  useEffect(() => {
    if (seek && groups.reviewed.some((conflict) => conflict.id === seek)) setReviewedOpen(true);
  }, [seek, groups.reviewed]);
  const settled = (message: string) => {
    setAnnounce(message);
    requestAnimationFrame(() =>
      (document.getElementById('ground-conflicts') ?? head.current)?.focus({ preventScroll: true }),
    );
  };

  return (
    <section
      className="sw-ground__section"
      aria-labelledby="ground-conflicts-title"
      aria-busy={ledger.loading && !ledger.ledger}
    >
      <SectionHead
        id="ground-conflicts"
        titleId="ground-conflicts-title"
        title="Conflicts"
        count={ledger.ledger ? groups.open.length : null}
        aside={
          ledger.ledger && total > 0 ? (
            <p className="sw-ground-head__hint">
              {groups.open.length === 0
                ? 'All reviewed'
                : `${groups.reviewed.length} of ${total} reviewed`}
            </p>
          ) : null
        }
      />
      {groups.open.length > 0 && (
        <p className="sw-ground-caption">
          Found from wording alone. Neither side is declared true.
        </p>
      )}
      {ledger.loading && !ledger.ledger && (
        <div className="sw-ground-skeleton" aria-hidden="true">
          <Skeleton height="1.2rem" width="30%" />
          <Skeleton height="5.5rem" />
        </div>
      )}
      {ledger.error && (
        <Notice
          tone="error"
          title="Conflicts could not be read"
          action={
            <Button size="sm" variant="glass" onClick={ledger.reload}>
              Retry
            </Button>
          }
        >
          {ledger.error}
        </Notice>
      )}
      {ledger.ledger && total === 0 && (
        <div className="sw-ground-clear">
          <Notice tone="success" title="No conflicts found between the sources">
            Compared sentence by sentence, for figures and opposite statements. A disagreement that
            needs interpretation can be missed.
          </Notice>
        </div>
      )}
      <LayoutGroup>
        <AnimatePresence initial={false} mode="popLayout">
          {groups.open.map((conflict) => (
            <m.div
              key={conflict.id}
              layout={reduced ? false : 'position'}
              initial={reduced ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.16 } }}
              transition={SPRING.smooth}
            >
              <Duel conflict={conflict} flashing={flash === conflict.id} onReviewed={settled} />
            </m.div>
          ))}
        </AnimatePresence>
        {groups.reviewed.length > 0 && (
          <m.div layout={reduced ? false : 'position'} transition={SPRING.smooth}>
            <Disclosure
              summary={`Reviewed · ${groups.reviewed.length}`}
              open={reviewedOpen}
              onOpenChange={setReviewedOpen}
            >
              <div className="sw-ground-duels--reviewed">
                {groups.reviewed.map((conflict) => (
                  <Duel
                    key={conflict.id}
                    conflict={conflict}
                    flashing={flash === conflict.id}
                    onReviewed={settled}
                  />
                ))}
              </div>
            </Disclosure>
          </m.div>
        )}
      </LayoutGroup>
      <p className="sr-only" role="status">
        {announce}
      </p>
    </section>
  );
}
