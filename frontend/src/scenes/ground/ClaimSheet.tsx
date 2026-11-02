import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { CircleCheck, Scale } from 'lucide-react';
import {
  MAX_REVIEW_NOTE_LENGTH,
  PUBLICATION_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
  SUPPORT_CLASS_LABELS,
  SUPPORT_CLASS_MEANINGS,
  type ClaimDetail,
  type ClaimRecord,
  type EvidenceRef,
  type ReviewResult,
} from '../../../../shared/evidence';
import type { EvidenceChunk } from '../../../../shared/types';
import { ApiError, api, errorMessage, isAbort } from '../../api';
import {
  Button,
  Chip,
  Disclosure,
  Field,
  Notice,
  SheetClose,
  SheetContent,
  Skeleton,
  SkeletonText,
  Textarea,
  useToast,
} from '../../design/ui';
import { dateTime } from '../../lib/format';
import { PUBLICATION_TONE, SUPPORT_TONE, splitAtQuote, type Tone } from '../../lib/ledger';
import { useGroundActions, useGroundData } from './context';
import { familyOf } from './families';
import { Kind } from './Kind';
import { clipAroundQuote, rangeText } from './passages';
import { focusSheet } from './sheetFocus';
import { CHIP_TONE, TONE_ICON } from './tones';
import './statements.css';

const REVIEWS: { result: Exclude<ReviewResult, 'pending'>; label: string }[] = [
  { result: 'accepted', label: 'Accept' },
  { result: 'needs-revision', label: 'Needs revision' },
  { result: 'rejected', label: 'Reject' },
];

function Passage({
  evidence,
  passage,
  mode,
}: {
  evidence: EvidenceRef;
  passage: EvidenceChunk | undefined;
  mode: 'guided' | 'advanced';
}) {
  const actions = useGroundActions();
  const [whole, setWhole] = useState(false);
  const split = passage ? splitAtQuote(passage.text, evidence.quote) : null;
  const clipped =
    split && !whole && passage && passage.text.length > 640 ? clipAroundQuote(split) : null;
  const supports = evidence.role === 'supports';
  return (
    <li className="sw-ground-evidence" data-role={evidence.role}>
      <div className="sw-ground-evidence__head">
        <span className="sw-ground-evidence__role">
          {supports ? (
            <CircleCheck size={15} aria-hidden="true" />
          ) : (
            <Scale size={15} aria-hidden="true" />
          )}
          {supports ? 'Supporting' : 'Contradicting'}
        </span>
        <button
          type="button"
          className="sw-ground-evidence__where"
          onClick={() => actions.openPassage(evidence.passageId, { quote: evidence.quote })}
        >
          {evidence.documentName} · {evidence.passageId}
        </button>
      </div>
      {passage ? (
        <blockquote className="sw-ground-text sw-ground-text--passage">
          {clipped ? (
            <>
              {clipped.cutBefore ? '… ' : ''}
              {clipped.before}
              <mark>{clipped.quote}</mark>
              {clipped.after}
              {clipped.cutAfter ? ' …' : ''}
            </>
          ) : split ? (
            <>
              {split.before}
              <mark>{split.quote}</mark>
              {split.after}
            </>
          ) : (
            passage.text
          )}
        </blockquote>
      ) : (
        <p className="sw-caption">The passage text is no longer available.</p>
      )}
      <p className="sw-caption">
        {evidence.quote
          ? 'The marked words are in it exactly as written.'
          : 'No exact quotation was matched: the whole passage is cited.'}{' '}
        {rangeText(evidence)}.
        {mode === 'advanced' ? ` SHA-256 ${evidence.contentHash.slice(0, 16)}…` : ''}
        {split && passage && passage.text.length > 640 && (
          <>
            {' '}
            <button
              type="button"
              className="sw-ground-search__clear"
              aria-expanded={whole}
              onClick={() => setWhole((value) => !value)}
            >
              {whole ? 'Show less' : 'Show the whole passage'}
            </button>
          </>
        )}
      </p>
    </li>
  );
}

function Checks({ claim }: { claim: ClaimRecord }) {
  const check = claim.verification;
  const rows: [string, string][] = [
    [
      'Method',
      check.method === 'deterministic+model'
        ? 'Automatic checks, then an independent model check'
        : 'Automatic checks only',
    ],
    ['Why this class', check.reason],
  ];
  if (check.quote)
    rows.push([
      'Quotation',
      check.quote === 'found' ? 'Found in the passage' : 'Not found in the passage',
    ]);
  if (check.numbers)
    rows.push([
      'Figures',
      check.numbers === 'match' ? 'Match the passage' : 'Differ from the passage',
    ]);
  if (check.overlap !== null) rows.push(['Shared wording', `${Math.round(check.overlap * 100)}%`]);
  if (check.entailment) {
    rows.push([
      'Independent check',
      {
        supports: 'Passage backs it',
        partial: 'Passage backs part of it',
        contradicts: 'Passage conflicts with it',
        'not-supported': 'Passage does not back it',
      }[check.entailment],
    ]);
  }
  return (
    <dl className="sw-ground-facts">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One statement with everything behind it, and the means to review it: nothing a reviewer does makes it better supported than its evidence allows. */
export function ClaimSheetContent({ claimId }: { claimId: string }) {
  const { project, ledger, mode } = useGroundData();
  const toast = useToast();
  const noteId = useId();
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Exclude<ReviewResult, 'pending'> | null>(null);
  const [failure, setFailure] = useState<{ text: string; stale: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    void api.claim(project.id, claimId, controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) setDetail(loaded);
      },
      (problem: unknown) => {
        if (controller.signal.aborted || isAbort(problem)) return;
        setLoadError(errorMessage(problem));
      },
    );
    return () => controller.abort();
  }, [project.id, claimId, revision]);

  const current = detail && detail.claim.id === claimId ? detail : null;
  const claim = current?.claim ?? null;
  const passages = useMemo(
    () => new Map(current?.passages.map((passage) => [passage.id, passage])),
    [current],
  );

  const review = useCallback(
    async (result: Exclude<ReviewResult, 'pending'>) => {
      if (!claim) return;
      setBusy(result);
      setFailure(null);
      try {
        const saved = await api.reviewClaim(project.id, claim.id, {
          result,
          note: note.trim() || null,
          expectedVersion: claim.version,
        });
        setDetail((old) => (old ? { ...old, claim: saved.claim } : old));
        if (ledger.ledger) {
          ledger.replace({
            ...ledger.ledger,
            claims: ledger.ledger.claims.map((item) =>
              item.id === saved.claim.id ? saved.claim : item,
            ),
          });
        }
        ledger.reload();
        setNote('');
        toast({ title: 'Review saved', tone: 'success', duration: 2600 });
      } catch (problem) {
        setFailure({
          text: errorMessage(problem),
          stale: problem instanceof ApiError && problem.code === 'CLAIM_CONFLICT',
        });
      } finally {
        setBusy(null);
      }
    },
    [claim, ledger, note, project.id, toast],
  );

  if (!claim || !current) {
    return (
      <SheetContent
        className="sw-ground-sheet"
        width="xl"
        onOpenAutoFocus={focusSheet}
        eyebrow="Statement"
        title={claimId}
        description={loadError ? 'It could not be opened.' : 'Opening it.'}
        footer={
          <SheetClose asChild>
            <Button variant="primary">Done</Button>
          </SheetClose>
        }
      >
        {loadError ? (
          <Notice
            tone="error"
            title="Could not open this statement"
            action={
              <Button size="sm" variant="glass" onClick={() => setRevision((value) => value + 1)}>
                Retry
              </Button>
            }
          >
            {loadError}
          </Notice>
        ) : (
          <div className="sw-ground-skeleton" aria-hidden="true">
            <Skeleton height="1.6rem" width="80%" />
            <SkeletonText lines={4} />
          </div>
        )}
      </SheetContent>
    );
  }

  const support = SUPPORT_TONE[claim.supportClass];
  const publication = PUBLICATION_TONE[claim.publication.status];
  const SupportIcon = TONE_ICON[support];
  const reviewTone: Tone =
    claim.review.result === 'pending'
      ? 'neutral'
      : claim.review.result === 'accepted'
        ? 'good'
        : 'caution';
  const ReviewIcon = TONE_ICON[reviewTone];
  const evidence = [...claim.supporting, ...claim.contradicting];

  return (
    <SheetContent
      className="sw-ground-sheet"
      width="xl"
      onOpenAutoFocus={focusSheet}
      eyebrow={<Kind family={familyOf(claim.statementType)} type={claim.statementType} />}
      title={`Statement ${claim.id}`}
      description={claim.section}
      footer={
        <SheetClose asChild>
          <Button variant="primary">Done</Button>
        </SheetClose>
      }
    >
      <div className="sw-ground-claim">
        <p className="sw-ground-claim__text">{claim.text}</p>
        <div className="sw-ground-claim__chips">
          <Chip
            tone={CHIP_TONE[support]}
            icon={<SupportIcon aria-hidden="true" />}
            title={SUPPORT_CLASS_MEANINGS[claim.supportClass]}
          >
            {SUPPORT_CLASS_LABELS[claim.supportClass]}
          </Chip>
          <Chip tone={CHIP_TONE[publication]}>
            {PUBLICATION_STATUS_LABELS[claim.publication.status]}
          </Chip>
          <Chip tone={CHIP_TONE[reviewTone]} icon={<ReviewIcon aria-hidden="true" />}>
            {REVIEW_RESULT_LABELS[claim.review.result]}
          </Chip>
        </div>
        <p className="sw-ground-claim__meaning">{SUPPORT_CLASS_MEANINGS[claim.supportClass]}</p>
        {claim.publication.qualification && (
          <p className="sw-ground-claim__qualify">
            <span>Shown with</span> {claim.publication.qualification}
          </p>
        )}

        {evidence.length > 0 ? (
          <section aria-label="Cited passages">
            <h3 className="sw-eyebrow">Evidence</h3>
            <ul className="sw-ground-evidence-list" role="list">
              {evidence.map((item, index) => (
                <Passage
                  key={`${index}-${item.passageId}-${item.role}`}
                  evidence={item}
                  passage={passages.get(item.passageId)}
                  mode={mode}
                />
              ))}
            </ul>
          </section>
        ) : (
          <p className="sw-ground-claim__none">No source passage is cited for this statement.</p>
        )}

        {current.assumptions.length > 0 && (
          <section aria-label="Assumptions">
            <h3 className="sw-eyebrow">It depends on</h3>
            <ul className="sw-ground-list" role="list">
              {current.assumptions.map((assumption) => (
                <li key={assumption.id}>
                  <span className="sw-ground-list__id num">{assumption.id}</span>
                  <span>{assumption.statement}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {claim.simulationEvents.length > 0 && (
          <section aria-label="Simulated events">
            <h3 className="sw-eyebrow">Simulated events</h3>
            <p className="sw-caption">
              Recorded outputs of the simulation, not observations of real people.
            </p>
            <ul className="sw-ground-list" role="list">
              {claim.simulationEvents.map((event) => {
                const text = current.memories.find((memory) => memory.id === event.memoryId)?.text;
                return (
                  <li key={event.memoryId}>
                    <span className="sw-ground-list__id num">{event.memoryId}</span>
                    <span>
                      {event.platform}, round {event.round}
                      {text ? `: ${text}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <Disclosure summary="How it was checked">
          <Checks claim={claim} />
        </Disclosure>

        <section className="sw-ground-review" aria-label="Review">
          <h3 className="sw-eyebrow">Review</h3>
          {claim.review.note && <p className="sw-ground-review__note">{claim.review.note}</p>}
          {claim.review.reviewedAt && (
            <p className="sw-caption num">Reviewed {dateTime(claim.review.reviewedAt)}</p>
          )}
          <Field
            label="Note"
            hint={`${note.length} of ${MAX_REVIEW_NOTE_LENGTH.toLocaleString('en-GB')}`}
          >
            <Textarea
              id={noteId}
              value={note}
              maxLength={MAX_REVIEW_NOTE_LENGTH}
              maxRows={6}
              disabled={busy !== null}
              placeholder="Optional"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <div className="sw-ground-review__actions">
            {REVIEWS.map(({ result, label }) => (
              <Button
                key={result}
                size="sm"
                variant={result === 'rejected' ? 'danger' : 'glass'}
                busy={busy === result}
                disabled={busy !== null}
                onClick={() => void review(result)}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="sw-caption">
            Rejecting withholds it from the report. Accepting only records that you reviewed it: it
            does not make it better supported.
          </p>
          {failure && (
            <Notice
              tone={failure.stale ? 'caution' : 'error'}
              title={failure.stale ? 'Someone else changed this statement' : 'Not saved'}
              action={
                failure.stale ? (
                  <Button
                    size="sm"
                    variant="glass"
                    onClick={() => {
                      setFailure(null);
                      setRevision((value) => value + 1);
                      ledger.reload();
                    }}
                  >
                    Load the latest
                  </Button>
                ) : undefined
              }
            >
              {failure.stale
                ? 'Your note is kept. Read the latest version, then review it again.'
                : failure.text}
            </Notice>
          )}
        </section>

        {claim.history.length > 0 && (
          <Disclosure summary={`History · ${claim.history.length}`}>
            <ol className="sw-ground-history">
              {claim.history.map((entry) => (
                <li key={entry.version}>
                  <span className="sw-ground-history__v num">v{entry.version}</span>
                  <span className="sw-ground-history__what">
                    {entry.actor === 'reviewer' ? 'Reviewer' : 'System'}: {entry.change}
                  </span>
                  <time className="sw-ground-history__at num" dateTime={entry.at}>
                    {dateTime(entry.at)}
                  </time>
                </li>
              ))}
            </ol>
          </Disclosure>
        )}

        {mode === 'advanced' && (
          <Disclosure summary="Record">
            <dl className="sw-ground-facts num">
              <div>
                <dt>Version</dt>
                <dd>{claim.version}</dd>
              </div>
              <div>
                <dt>Stage</dt>
                <dd>{claim.generationStage}</dd>
              </div>
              <div>
                <dt>Lineage</dt>
                <dd>
                  {claim.lineage.parentId
                    ? `Branch of ${claim.lineage.parentId}${claim.lineage.branchFromRound !== null ? ` from round ${claim.lineage.branchFromRound}` : ''}`
                    : 'Original'}
                </dd>
              </div>
            </dl>
          </Disclosure>
        )}
      </div>
    </SheetContent>
  );
}
