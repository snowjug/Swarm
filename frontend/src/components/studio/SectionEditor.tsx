import { useEffect, useId, useState } from 'react';
import { History, Lock, Pencil, Sparkles, Unlock } from 'lucide-react';
import {
  SECTION_ORIGIN_LABELS,
  isEditableState,
  type StudioSectionView,
  type StudioView,
} from '../../../../shared/studio';
import { dateTime } from '../../lib/format';
import { ORIGIN_TONE, actorLabel, sectionFlags, writtenByPerson } from '../../lib/studio';
import { ToneChip } from '../console/LedgerParts';
import { Notice, Spinner } from '../ui';
import { Diff } from './Diff';
import { LOCK_ICON, ORIGIN_ICON } from './icons';
import { StatementList } from './StatementList';

/** What a person can do to one section. Each resolves true when the server made the change. */
export interface SectionActions {
  edit: (input: { body: string; reason: string | null }) => Promise<boolean>;
  lock: (locked: boolean) => Promise<boolean>;
  note: (text: string) => Promise<boolean>;
  restore: (version: number, reason: string | null) => Promise<boolean>;
  regenerate: (instruction: string | null) => Promise<boolean>;
  decide: (decision: 'accept' | 'reject') => Promise<boolean>;
}

type Document = NonNullable<StudioView['document']>;

function Pending({ working, children }: { working: boolean; children: string }) {
  return working ? (
    <>
      <Spinner label={`${children}…`} /> {children}…
    </>
  ) : (
    <>{children}</>
  );
}

function ProposalPreview({
  section,
  view,
  canDecide,
  pending,
  actions,
}: {
  section: StudioSectionView;
  view: StudioView;
  canDecide: boolean;
  pending: string | null;
  actions: SectionActions;
}) {
  const proposal = section.proposal;
  if (!proposal) return null;
  const { grounding } = proposal;
  const counts = grounding.counts;
  return (
    <section
      className="studio-proposal stage-card"
      aria-label={`Regenerated text for ${section.title}, waiting for your decision`}
    >
      <h4>Regenerated text, waiting for your decision</h4>
      <p className="field-help">
        The model wrote this chapter again from the same sources at {actorLabel(proposal.actor)}
        ’s request on {dateTime(proposal.at)}. It uses {proposal.usage.modelCalls} model calls (
        {proposal.usage.inputTokens.toLocaleString()} tokens in,{' '}
        {proposal.usage.outputTokens.toLocaleString()} out). It changes nothing until it is
        accepted.
      </p>
      {proposal.instruction && (
        <p className="preserve-text">
          <strong>The request:</strong> {proposal.instruction}
        </p>
      )}
      <details className="record-details" open>
        <summary>Changes from the text as it stands</summary>
        <Diff before={section.body} after={proposal.body} />
      </details>
      <details className="record-details">
        <summary>The regenerated text on its own</summary>
        <div className="studio-body preserve-text">{proposal.body}</div>
      </details>
      <p>
        <strong>Checked the way the report was checked</strong> (
        {grounding.method === 'deterministic+model'
          ? 'quotations, wording, figures and an independent model check'
          : 'quotations, wording and figures only'}
        ): {counts.supported} supported, {counts.partial} partly supported, {counts.unsupported} not
        supported, {counts.contradicted} contradicted, {counts.unchecked} not checkable.
      </p>
      {grounding.unverifiedFigures.length > 0 && (
        <Notice tone="warning" title="Figures that match nothing in the cited material">
          {grounding.unverifiedFigures.join(', ')}. They may be invented. Do not accept the text
          without checking them.
        </Notice>
      )}
      {grounding.notes.length > 0 && (
        <ul className="field-help">
          {grounding.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}
      <h5>Its statements</h5>
      <StatementList
        section={{
          kind: 'chapter',
          statements: proposal.statements,
          statementsCurrent: true,
          origin: 'regenerated',
        }}
        evidence={view}
      />
      {canDecide ? (
        <div className="stage-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={pending !== null}
            onClick={() => void actions.decide('accept')}
          >
            <Pending working={pending === `proposal:${section.id}:accept`}>
              Accept the regenerated text
            </Pending>
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={pending !== null}
            onClick={() => void actions.decide('reject')}
          >
            <Pending working={pending === `proposal:${section.id}:reject`}>Reject it</Pending>
          </button>
        </div>
      ) : (
        <p className="field-help">Only someone who can edit this report can accept or reject it.</p>
      )}
    </section>
  );
}

function VersionHistory({
  section,
  canRestore,
  pending,
  actions,
}: {
  section: StudioSectionView;
  canRestore: boolean;
  pending: string | null;
  actions: SectionActions;
}) {
  const [comparing, setComparing] = useState<number | null>(null);
  const shown = section.versions.find((entry) => entry.version === comparing);
  const newestFirst = [...section.versions].reverse();
  return (
    <details className="record-details">
      <summary>
        <History size={13} aria-hidden="true" /> Version history ({section.versions.length})
      </summary>
      <ol className="studio-versions">
        {newestFirst.map((entry) => (
          <li key={entry.version}>
            <p>
              <strong>Version {entry.version}</strong>
              {entry.version === section.version ? ' (current)' : ''}
              {' · '}
              {SECTION_ORIGIN_LABELS[entry.origin]}
              {' · '}
              {actorLabel(entry.actor)}
              {' · '}
              {dateTime(entry.at)}
              {entry.restoredFrom ? ` · restored from version ${entry.restoredFrom}` : ''}
            </p>
            {entry.reason && <p className="field-help preserve-text">Why: {entry.reason}</p>}
            {entry.version !== section.version && (
              <div className="stage-actions">
                <button
                  className="button button-secondary button-small"
                  type="button"
                  aria-pressed={comparing === entry.version}
                  onClick={() => setComparing(comparing === entry.version ? null : entry.version)}
                >
                  Compare with the current text
                </button>
                {canRestore && (
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void actions.restore(entry.version, null)}
                  >
                    <Pending working={pending === `restore:${section.id}:${entry.version}`}>
                      Restore this version
                    </Pending>
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {shown && (
        <div>
          <h4>Version {shown.version} compared with the current text</h4>
          <Diff before={shown.body} after={section.body} />
        </div>
      )}
    </details>
  );
}

function ReviewerNotes({
  section,
  canNote,
  maxNote,
  pending,
  actions,
}: {
  section: StudioSectionView;
  canNote: boolean;
  maxNote: number;
  pending: string | null;
  actions: SectionActions;
}) {
  const [text, setText] = useState('');
  const id = useId();
  return (
    <section aria-label={`Reviewer notes on ${section.title}`}>
      <h4>Reviewer notes ({section.notes.length})</h4>
      {section.notes.length === 0 ? (
        <p className="field-help">No reviewer has left a note on this section.</p>
      ) : (
        <ul className="studio-notes">
          {section.notes.map((entry) => (
            <li key={entry.id}>
              <p className="preserve-text">{entry.text}</p>
              <p className="field-help">
                {actorLabel(entry.actor)} · {dateTime(entry.at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canNote ? (
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault();
            void actions.note(text.trim()).then((made) => {
              if (made) setText('');
            });
          }}
        >
          <label htmlFor={id}>Add a note for the author</label>
          <textarea
            id={id}
            rows={3}
            maxLength={maxNote}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="field-help">
            A note is kept with the section and cannot be edited or removed. It does not change the
            text or an approval.
          </p>
          <button
            className="button button-secondary"
            type="submit"
            disabled={pending !== null || text.trim().length === 0}
          >
            <Pending working={pending === `note:${section.id}`}>Add note</Pending>
          </button>
        </form>
      ) : null}
    </section>
  );
}

export function SectionEditor({
  view,
  document,
  section,
  pending,
  actions,
}: {
  view: StudioView;
  document: Document;
  section: StudioSectionView;
  pending: string | null;
  actions: SectionActions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.body);
  const [reason, setReason] = useState('');
  const [instruction, setInstruction] = useState('');
  const textId = useId();
  const reasonId = useId();
  const instructionId = useId();
  useEffect(() => {
    setEditing(false);
    setDraft(section.body);
    setReason('');
  }, [section.id, section.version, section.body]);

  const editable = view.capabilities.edit && isEditableState(document.state) && !view.stale;
  const unlocked = !section.locked;
  const canWrite = editable && unlocked && !section.proposal;
  const flags = sectionFlags(section);
  const last = section.versions.at(-1);
  const regenerating = pending === `regenerate:${section.id}`;
  return (
    <article className="studio-section" aria-labelledby={`${textId}-title`}>
      <div className="section-heading">
        <h3 id={`${textId}-title`}>{section.title}</h3>
        <span className="mono muted">VERSION {section.version}</span>
      </div>
      <div className="chip-row">
        <ToneChip
          tone={ORIGIN_TONE[section.origin]}
          label={SECTION_ORIGIN_LABELS[section.origin]}
          icon={ORIGIN_ICON[section.origin]}
        />
        {section.locked && <ToneChip tone="info" label="Locked" icon={LOCK_ICON} />}
        {flags
          .filter((flag) => flag !== 'Locked')
          .map((flag) => (
            <ToneChip key={flag} tone="caution" label={flag} />
          ))}
      </div>
      {last && (
        <p className="field-help">
          Version {last.version} by {actorLabel(last.actor)}, {dateTime(last.at)}
          {last.reason ? `. Why: ${last.reason}` : ''}
          {section.locked ? `. Locked by ${actorLabel(section.locked.actor)}.` : ''}
        </p>
      )}
      {writtenByPerson(section) && section.kind === 'chapter' && (
        <p className="field-help">
          {section.origin === 'human'
            ? 'A person wrote this text. It has not been checked statement by statement.'
            : 'The model wrote this text and the server checked its statements, as the report’s were checked.'}
        </p>
      )}

      {editing ? (
        <form
          className="studio-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void actions.edit({ body: draft, reason: reason.trim() || null });
          }}
        >
          <div className="field">
            <label htmlFor={textId}>Text of “{section.title}”</label>
            <textarea
              id={textId}
              rows={section.kind === 'chapter' ? 16 : 8}
              maxLength={view.limits.maxBody}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby={`${textId}-count`}
            />
            <p className="field-help" id={`${textId}-count`}>
              {draft.length.toLocaleString()} of {view.limits.maxBody.toLocaleString()} characters.
              Saving makes a new version; the earlier text stays in the history.
            </p>
          </div>
          <div className="field">
            <label htmlFor={reasonId}>Why (optional)</label>
            <input
              id={reasonId}
              type="text"
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="stage-actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={pending !== null || !draft.trim() || draft === section.body}
            >
              <Pending working={pending === `edit:${section.id}`}>Save as a new version</Pending>
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={pending !== null}
              onClick={() => {
                setEditing(false);
                setDraft(section.body);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : section.kind === 'limitations' ? (
        <ul className="studio-body">
          {section.body
            .split('\n')
            .filter((entry) => entry.trim())
            .map((entry, index) => (
              <li key={index} className="preserve-text">
                {entry}
              </li>
            ))}
        </ul>
      ) : (
        <div className="studio-body preserve-text">{section.body}</div>
      )}

      {!editing && editable && (
        <div className="stage-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={!canWrite || pending !== null}
            onClick={() => setEditing(true)}
          >
            <Pencil size={13} aria-hidden="true" /> Edit text
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={pending !== null || Boolean(section.proposal)}
            aria-pressed={Boolean(section.locked)}
            onClick={() => void actions.lock(unlocked)}
          >
            {unlocked ? (
              <Lock size={13} aria-hidden="true" />
            ) : (
              <Unlock size={13} aria-hidden="true" />
            )}{' '}
            <Pending working={pending === `lock:${section.id}`}>
              {unlocked ? 'Lock this section' : 'Unlock this section'}
            </Pending>
          </button>
        </div>
      )}
      {!editing && editable && !unlocked && (
        <p className="field-help">
          A locked section is final wording: it cannot be edited, restored or regenerated until it
          is unlocked.
        </p>
      )}
      {!editable && (
        <p className="field-help">
          {view.stale
            ? 'The generated report has been replaced, so this document can be read and exported but not changed.'
            : !view.capabilities.edit
              ? 'You can read this report. Editing it needs the analyst or lead role.'
              : document.state === 'approved'
                ? 'This report is approved. Reopen it to change it.'
                : 'This report is in review. Withdraw it to change it.'}
        </p>
      )}

      {section.kind === 'chapter' && editable && (
        <section className="stage-card" aria-label={`Write ${section.title} again`}>
          <h4>
            <Sparkles size={14} aria-hidden="true" /> Write this chapter again
          </h4>
          {view.regeneration.available ? (
            <>
              <div className="field">
                <label htmlFor={instructionId}>
                  What to emphasise, or how to say it (optional)
                </label>
                <input
                  id={instructionId}
                  type="text"
                  maxLength={view.limits.maxInstruction}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  disabled={!canWrite}
                />
                <p className="field-help">
                  The model writes it again from the same sources and the server checks what it
                  wrote the way the report was checked. Your request asks for emphasis and wording;
                  it cannot loosen the checks. Nothing changes until you accept the result.
                </p>
              </div>
              <button
                className="button button-secondary"
                type="button"
                disabled={!canWrite || pending !== null}
                onClick={() => void actions.regenerate(instruction.trim() || null)}
              >
                <Pending working={regenerating}>Write this chapter again</Pending>
              </button>
              {!canWrite && section.proposal && (
                <p className="field-help">Decide on the regenerated text below first.</p>
              )}
              {!canWrite && !unlocked && (
                <p className="field-help">Unlock the section to write it again.</p>
              )}
            </>
          ) : (
            <p className="field-help">{view.regeneration.reason}</p>
          )}
        </section>
      )}

      <ProposalPreview
        section={section}
        view={view}
        canDecide={editable}
        pending={pending}
        actions={actions}
      />

      <VersionHistory section={section} canRestore={canWrite} pending={pending} actions={actions} />

      <ReviewerNotes
        section={section}
        canNote={view.capabilities.review && !view.stale}
        maxNote={view.limits.maxNote}
        pending={pending}
        actions={actions}
      />

      {section.kind === 'chapter' && (
        <section aria-label={`Statements in ${section.title}`}>
          <h4>Statements in this chapter</h4>
          <p className="field-help">
            What the server checked against the sources. Open a statement to read the passages
            behind it, what contradicts it, and the assumptions it rests on.
          </p>
          <StatementList section={section} evidence={view} />
        </section>
      )}
    </article>
  );
}
