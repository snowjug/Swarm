import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, Search } from 'lucide-react';
import {
  UNRECORDED_INPUTS_ADVICE,
  comparisonInputsUnrecorded,
  inputsInWords,
  staleComparisonInputs,
} from '../../../../../shared/analysis';
import {
  CRITIC_ROLES,
  CRITIC_ROLE_LABELS,
  CRITIC_ROLE_QUESTIONS,
  type CriticRole,
  type Critique,
  type CritiqueResponseStatus,
  type CritiquesView,
} from '../../../../../shared/critique';
import { useReducedMotion } from '../../../design/motion';
import {
  Button,
  ChipButton,
  Field,
  Notice,
  Segmented,
  Sheet,
  SheetContent,
  Switch,
  Textarea,
} from '../../../design/ui';
import type { CritiquesState } from '../../../hooks/useCritiques';
import {
  LEAD_EXPLANATION,
  LEAD_HEADING,
  STATUS_VIEW,
  SEVERITY_VIEW,
  day,
  groupByRole,
  impactHeading,
  isOutOfDate,
  leadCritique,
  modeText,
  withoutLead,
} from '../../../lib/critics';
import {
  NO_FILTER,
  bySeriousness,
  filterCritiques,
  mentionsConflicts,
  subjectOf,
  tally,
  type ReviewFilter,
} from '../model/critique-model';
import { plural } from '../model/format';
import { useDoc } from '../ui/context';
import { smooth } from '../ui/scroll';
import { OriginChip, SeverityChip, StatusChip } from './chips';
import './review.css';

// ---------------------------------------------------------------------------------------------
// Asking for the review
// ---------------------------------------------------------------------------------------------

/**
 * Runs the review, and says what the optional model reading is. A model's reading is its opinion, not evidence.
 * What is given as children stands first in the row of actions.
 */
export function RunControls({
  view,
  state,
  compact = false,
  children,
}: {
  view: CritiquesView;
  state: CritiquesState;
  compact?: boolean;
  children?: ReactNode;
}) {
  const [useModel, setUseModel] = useState(false);
  const noteId = useId();
  const canModel = view.model.available;
  const again = view.critiques !== null;
  return (
    <div className="sw-decide-run" data-compact={compact || undefined}>
      <div className="sw-decide-run__row">
        {children}
        <Button
          variant={compact || again ? 'glass' : 'accent'}
          size={compact ? 'sm' : 'md'}
          icon={<Search size={16} aria-hidden="true" />}
          busy={state.running}
          busyLabel="Running the independent review"
          disabled={!view.may.run}
          onClick={() => void state.run(useModel && canModel)}
        >
          {again ? 'Run the review again' : 'Run the independent review'}
        </Button>
        <Switch
          label="Also ask a model"
          aria-describedby={noteId}
          disabled={!canModel || state.running || !view.may.run}
          checked={useModel && canModel}
          onChange={(event) => setUseModel(event.target.checked)}
        />
      </div>
      <p className="sw-decide-run__note" id={noteId}>
        {canModel
          ? 'Adds a model’s reading of the analysis. It is an opinion, not evidence.'
          : (view.model.reason ?? 'No model is configured, so only the checks by rule run.')}
        {again && view.may.run
          ? ' Your responses are kept for any criticism that comes back unchanged.'
          : ''}
      </p>
      {!view.may.run && (
        <p className="sw-decide-run__note">
          Only someone who can run analyses on this exploration can start a review.
        </p>
      )}
      {state.runError && (
        <Notice tone="error" title="The independent review did not run">
          {state.runError}
        </Notice>
      )}
    </div>
  );
}

/** The review describes the comparison as it was, and the project may have moved on since: said once, with what to do. */
export function ReviewFreshness({ view, onRerun }: { view: CritiquesView; onRerun: () => void }) {
  if (view.critiques === null) return null;
  const inputs = staleComparisonInputs(view.changedSince);
  const unrecorded = comparisonInputsUnrecorded(view.changedSince);
  if (isOutOfDate(view)) {
    return (
      <Notice tone="caution" title="This review is of an earlier comparison">
        A newer comparison has finished since. Run the review again to challenge it; responses to
        criticisms that come back unchanged are kept.
      </Notice>
    );
  }
  if (inputs.length === 0 && !unrecorded) return null;
  return (
    <Notice
      tone="caution"
      title="This review may be out of date"
      action={
        view.may.run ? (
          <Button size="sm" variant="glass" onClick={onRerun}>
            Re-run the comparison
          </Button>
        ) : null
      }
    >
      {inputs.length > 0
        ? `The comparison it reviews was run before ${inputsInWords(inputs)} changed, so it describes the project as it was. `
        : ''}
      {unrecorded ? `${UNRECORDED_INPUTS_ADVICE} ` : ''}
      Run the comparison again, then run the review again.
    </Notice>
  );
}

// ---------------------------------------------------------------------------------------------
// One criticism
// ---------------------------------------------------------------------------------------------

const MEANINGS: { value: CritiqueResponseStatus; label: string }[] = [
  { value: 'responded', label: 'Respond' },
  { value: 'accepted', label: 'Accept' },
  { value: 'disputed', label: 'Dispute' },
];

/**
 * What a person says to one criticism: the words, what they still disagree about, and what the answer means.
 * What is typed is kept until it is saved, even when the review changed under the person and was read again.
 */
function ResponseForm({ critique, state }: { critique: Critique; state: CritiquesState }) {
  const [typed, setTyped] = useState<string | null>(null);
  const [typedRemaining, setTypedRemaining] = useState<string | null>(null);
  const [meaning, setMeaning] = useState<CritiqueResponseStatus>(
    critique.status === 'open' ? 'responded' : critique.status,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const text = typed ?? critique.response?.text ?? '';
  const remaining = typedRemaining ?? critique.remainingDisagreement ?? '';
  const busy = state.answering === critique.id;
  const failure =
    problem ?? (state.answerError?.id === critique.id ? state.answerError.message : null);

  const save = async () => {
    if (text.trim() === '') {
      setProblem('Write your response before choosing what it means.');
      return;
    }
    setProblem(null);
    const saved = await state.respond(critique.id, {
      text: text.trim(),
      status: meaning,
      remainingDisagreement: remaining.trim() === '' ? null : remaining.trim(),
    });
    if (saved) {
      setTyped(null);
      setTypedRemaining(null);
    }
  };

  return (
    <form
      className="sw-decide-form"
      noValidate
      aria-label={`Respond to this criticism`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field label="Your response" error={failure ?? undefined}>
        <Textarea
          rows={3}
          maxLength={800}
          value={text}
          disabled={busy}
          onChange={(event) => {
            setTyped(event.target.value);
            setProblem(null);
          }}
        />
      </Field>
      <Field label="What you still disagree about" hint="Optional.">
        <Textarea
          rows={2}
          maxLength={600}
          value={remaining}
          disabled={busy}
          onChange={(event) => setTypedRemaining(event.target.value)}
        />
      </Field>
      <div className="sw-decide-form__act">
        <Segmented
          size="sm"
          label="What your response means"
          value={meaning}
          onChange={setMeaning}
          options={MEANINGS}
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          busy={busy}
          busyLabel="Saving your response"
        >
          Save response
        </Button>
      </div>
      <p className="sw-decide-form__meaning">{STATUS_VIEW[meaning].meaning}</p>
    </form>
  );
}

/** One criticism: what it says, what it rests on, what it does to the conclusion if it stands, and the answer to it. */
function CritiqueCard({
  critique,
  open,
  onToggle,
  state,
  canRespond,
}: {
  critique: Critique;
  open: boolean;
  onToggle: () => void;
  state: CritiquesState;
  canRespond: boolean;
}) {
  const { brief, visuals, mode } = useDoc();
  const id = useId();
  const subject = subjectOf(critique.target, brief, visuals);
  return (
    <article
      className="sw-decide-cc"
      data-severity={critique.severity}
      data-open={open}
      id={`critique-${critique.id}`}
    >
      <button
        type="button"
        className="sw-decide-cc__head"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className="sw-decide-cc__chips">
          <SeverityChip severity={critique.severity} />
          <StatusChip status={critique.status} />
        </span>
        <span className="sw-decide-cc__subject">{subject}</span>
        <span className="sw-decide-cc__objection">{critique.objection}</span>
        <ChevronDown className="sw-decide-cc__chevron" size={18} aria-hidden="true" />
      </button>
      <div className="sw-decide-cc__body" id={id} data-open={open} inert={!open}>
        <div className="sw-decide-cc__inner">
          <dl className="sw-decide-dl">
            {critique.basis.length > 0 && (
              <div>
                <dt>What it rests on</dt>
                <dd>
                  <ul role="list">
                    {critique.basis.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {critique.evidence.length > 0 && (
              <div>
                <dt>Evidence</dt>
                <dd>
                  <ul role="list">
                    {critique.evidence.map((passage) => (
                      <li key={`${passage.passageId}-${passage.role}`}>
                        <span className="sw-mono">
                          {passage.documentName}, passage {passage.passageId}
                          {passage.role === 'contradicts' ? ' (contradicts)' : ''}
                        </span>
                        {passage.quote ? (
                          <q className="sw-decide-cc__quote">{passage.quote}</q>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            <div className="sw-decide-cc__impact" data-status={critique.status}>
              <dt>{impactHeading(critique.status)}</dt>
              <dd>{critique.impactOnConclusion || 'No effect on the conclusion was stated.'}</dd>
            </div>
            {critique.requestedAction && (
              <div>
                <dt>Asked of you</dt>
                <dd>{critique.requestedAction}</dd>
              </div>
            )}
            {critique.response && (
              <div>
                <dt>
                  {critique.response.by === 'user' ? 'Your response' : 'Response by the analysis'} ·{' '}
                  {day(critique.response.at)}
                </dt>
                <dd className="sw-decide-cc__kept">{critique.response.text}</dd>
              </div>
            )}
            {(critique.remainingDisagreement || critique.status === 'disputed') && (
              <div>
                <dt>Still disputed</dt>
                <dd className="sw-decide-cc__kept">
                  {critique.remainingDisagreement ?? 'No reason for the dispute was given.'}
                </dd>
              </div>
            )}
          </dl>
          <p className="sw-decide-cc__foot">
            <OriginChip origin={critique.origin} />
            <span>{CRITIC_ROLE_LABELS[critique.role]}</span>
            {mode === 'advanced' ? <span className="sw-mono">{critique.id}</span> : null}
          </p>
          {canRespond ? (
            <ResponseForm key={critique.id} critique={critique} state={state} />
          ) : (
            <p className="sw-decide-run__note">
              Only someone who can edit this exploration can respond to a criticism.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------------------------

export interface ReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: CritiquesState;
  /** A criticism to open and bring into view. */
  focusId: string | null;
  /** A critic to show alone, when the sheet was opened from one. */
  role: CriticRole | null;
  onRerun: () => void;
  /** The way to the conflicts between the sources, for a note that says they were not checked. */
  onConflicts?: () => void;
}

function useFocused(
  focusId: string | null,
  open: boolean,
  ready: boolean,
): [ReadonlySet<string>, (id: string) => void] {
  const reduced = useReducedMotion();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const served = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !focusId || !ready || served.current === focusId) return;
    served.current = focusId;
    setOpened((old) => new Set(old).add(focusId));
    // The card grows from nothing, so the page moves once it has begun to.
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(`critique-${focusId}`);
      card?.scrollIntoView({ block: 'start', behavior: smooth(reduced) });
      card?.querySelector<HTMLElement>('.sw-decide-cc__head')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, open, ready, reduced]);
  useEffect(() => {
    if (!open) served.current = null;
  }, [open]);
  return [
    opened,
    (id) =>
      setOpened((old) => {
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  ];
}

/**
 * Where focus goes when the sheet opens and closes. The sheet is opened by the address, not by a trigger of
 * its own, so it is not given back to what opened it unless that is kept here: the press, from a button
 * or a note, is remembered as the sheet takes focus, and returned to when it has gone. Focus starts on the
 * sheet itself, not on its close button, whose tooltip would take the first Escape.
 */
function useReturnFocus(open: boolean): (event: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const target = opener.current;
    opener.current = null;
    if (!target?.isConnected) return;
    const timer = window.setTimeout(() => target.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(timer);
  }, [open]);
  return (event) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    event.preventDefault();
    if (event.currentTarget instanceof HTMLElement)
      event.currentTarget.focus({ preventScroll: true });
  };
}

/** The independent review, beside the document: every criticism by critic, each opening where it is for the response. */
export function ReviewSheet({
  open,
  onOpenChange,
  state,
  focusId,
  role,
  onRerun,
  onConflicts,
}: ReviewSheetProps) {
  const { view } = state;
  const set = view?.critiques ?? null;
  const [filter, setFilter] = useState<ReviewFilter>(NO_FILTER);
  const [opened, toggle] = useFocused(focusId, open, set !== null);
  const onOpenAutoFocus = useReturnFocus(open);
  useEffect(() => {
    if (open) setFilter({ ...NO_FILTER, role });
  }, [open, role]);

  const lead = set ? leadCritique(set.critiques) : null;
  const rest = useMemo(() => (set ? withoutLead(set.critiques) : []), [set]);
  const counts = useMemo(() => tally(set?.critiques ?? []), [set]);
  const shown = useMemo(() => filterCritiques(rest, filter), [rest, filter]);
  const groups = useMemo(() => groupByRole(bySeriousness(shown)), [shown]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        width="lg"
        eyebrow="Challenge"
        title="Independent review"
        description="Critics challenge the analysis and never change it."
        className="sw-decide-sheet"
        onOpenAutoFocus={onOpenAutoFocus}
      >
        {!view ? (
          <p className="sw-decide-run__note" role="status">
            {state.error ? state.error : 'Reading the independent review…'}
          </p>
        ) : (
          <div className="sw-decide-review">
            {state.error && (
              <Notice
                tone="caution"
                title="The review could not be refreshed"
                action={
                  <Button size="sm" variant="glass" onClick={state.reload}>
                    Retry
                  </Button>
                }
              >
                {state.error} What is shown is the last version that could be read.
              </Notice>
            )}
            <ReviewFreshness view={view} onRerun={onRerun} />
            {lead && (
              <section className="sw-decide-lead" aria-label={LEAD_HEADING}>
                <p className="sw-eyebrow">Read this first</p>
                <h3 className="sw-decide-lead__title">{LEAD_HEADING}</h3>
                <p className="sw-decide-lead__text">{LEAD_EXPLANATION}</p>
                <CritiqueCard
                  critique={lead}
                  open={opened.has(lead.id)}
                  onToggle={() => toggle(lead.id)}
                  state={state}
                  canRespond={view.may.respond}
                />
              </section>
            )}
            {set ? (
              <>
                <div className="sw-decide-review__sum">
                  <p className="sw-decide-review__meta">
                    {modeText(set.mode)} · made {day(set.generatedAt)}
                  </p>
                  {set.notes && set.notes.length > 0 && (
                    <ul
                      className="sw-decide-review__notes"
                      role="list"
                      aria-label="What to know about how this review was made"
                    >
                      {set.notes.map((note) => (
                        <li key={note}>
                          <span>{note}</span>
                          {onConflicts && mentionsConflicts(note) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              iconEnd={<ArrowRight size={15} aria-hidden="true" />}
                              onClick={() => {
                                onOpenChange(false);
                                onConflicts();
                              }}
                            >
                              Open the conflicts in Ground
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div
                    className="sw-decide-review__filters"
                    role="group"
                    aria-label="Filter the criticisms"
                  >
                    <ChipButton
                      size="sm"
                      pressed={filter.status === 'open'}
                      onClick={() =>
                        setFilter((old) => ({
                          ...old,
                          status: old.status === 'open' ? 'all' : 'open',
                        }))
                      }
                    >
                      Open <span className="num">{counts.open}</span>
                    </ChipButton>
                    <ChipButton
                      size="sm"
                      pressed={filter.status === 'answered'}
                      onClick={() =>
                        setFilter((old) => ({
                          ...old,
                          status: old.status === 'answered' ? 'all' : 'answered',
                        }))
                      }
                    >
                      Answered <span className="num">{counts.answered}</span>
                    </ChipButton>
                    {(['blocking', 'major', 'minor', 'note'] as const)
                      .filter((severity) => counts.bySeverity[severity] > 0)
                      .map((severity) => (
                        <ChipButton
                          key={severity}
                          size="sm"
                          pressed={filter.severity === severity}
                          onClick={() =>
                            setFilter((old) => ({
                              ...old,
                              severity: old.severity === severity ? null : severity,
                            }))
                          }
                        >
                          {SEVERITY_VIEW[severity].label}{' '}
                          <span className="num">{counts.bySeverity[severity]}</span>
                        </ChipButton>
                      ))}
                    {filter.role && (
                      <ChipButton
                        size="sm"
                        pressed
                        onClick={() => setFilter((old) => ({ ...old, role: null }))}
                      >
                        {CRITIC_ROLE_LABELS[filter.role]}
                      </ChipButton>
                    )}
                  </div>
                </div>
                {set.critiques.length === 0 ? (
                  <p className="sw-decide-review__none">
                    The checks raised no criticism. That does not show that the analysis is right:
                    they look only for the faults each critic is built to find.
                  </p>
                ) : groups.length === 0 ? (
                  <p className="sw-decide-review__none">Nothing matches that filter.</p>
                ) : (
                  groups.map((group) => (
                    <section key={group.role} className="sw-decide-group" aria-label={group.label}>
                      <header>
                        <p className="sw-eyebrow">
                          {group.label} · {plural(group.critiques.length, 'criticism')}
                        </p>
                        <h3>{group.question}</h3>
                      </header>
                      <div className="sw-decide-group__list">
                        {group.critiques.map((critique) => (
                          <CritiqueCard
                            key={critique.id}
                            critique={critique}
                            open={opened.has(critique.id)}
                            onToggle={() => toggle(critique.id)}
                            state={state}
                            canRespond={view.may.respond}
                          />
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </>
            ) : view.analysis ? (
              <p className="sw-decide-review__none">
                Nobody has run the review for this exploration. Run it to see what the critics
                raise.
              </p>
            ) : (
              <p className="sw-decide-review__none">
                There is no finished comparison to review yet.
              </p>
            )}
            {view.analysis && <RunControls view={view} state={state} compact />}
            <details className="sw-decide-how-review">
              <summary>How the review works</summary>
              <p>
                The <strong>checks by rule</strong> always run. They read the scenario, the
                stakeholders, the actors and the analysis, and apply fixed rules, so the same input
                always gives the same criticisms. No model is involved.
              </p>
              <p>
                The optional <strong>model review</strong> sends a compact digest to the configured
                model, which may add criticisms. Anything it says about an id that does not exist is
                dropped, and it cannot change a finding.
              </p>
              <ul role="list">
                {CRITIC_ROLES.map((entry) => (
                  <li key={entry}>
                    <strong>{CRITIC_ROLE_LABELS[entry]}.</strong> {CRITIC_ROLE_QUESTIONS[entry]}
                  </li>
                ))}
              </ul>
              <p className="sw-decide-run__note">
                <Check size={13} aria-hidden="true" /> A criticism is a challenge, not a verdict.
                None of them has changed a finding.
              </p>
            </details>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
