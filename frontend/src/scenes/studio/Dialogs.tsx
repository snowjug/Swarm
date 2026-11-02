import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MAX_NOTE, type StudioView } from '../../../../shared/studio';
import { Button, Dialog, DialogContent, Textarea } from '../../design/ui';
import type { ButtonVariant } from '../../design/ui';
import { reviewSummary } from '../../lib/studio';
import { unsavedSentence } from './model';
import './Dialogs.css';

export type DialogKind =
  'approve' | 'request-changes' | 'reopen' | 'withdraw' | 'restart' | 'leave';

/** A question that needs an answer: a step of the review that a person confirms, with a reason where one is needed. */
function Confirm({
  title,
  description,
  noteLabel,
  confirmLabel,
  confirmVariant = 'primary',
  cancelLabel = 'Cancel',
  working,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  /** When set, the person must say why, in at least three characters; the server asks for it too. */
  noteLabel?: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  cancelLabel?: string;
  working: boolean;
  children?: ReactNode;
  onConfirm: (note: string | null) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const needsNote = noteLabel !== undefined;
  const ready = !needsNote || note.trim().length >= 3;
  const submit = () => {
    if (ready && !working) onConfirm(needsNote ? note.trim() : null);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !working && onClose()}>
      <DialogContent
        title={title}
        description={description}
        // The reason is asked for first. It is focused here and not with `autoFocus`, which would move focus before the
        // dialog has noted what had it, and the button that asked could not be given focus back.
        onOpenAutoFocus={
          needsNote
            ? (event) => {
                event.preventDefault();
                field.current?.focus();
              }
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" disabled={working} onClick={onClose}>
              {cancelLabel}
            </Button>
            <Button
              variant={confirmVariant}
              busy={working}
              busyLabel={`${confirmLabel}…`}
              disabled={!ready}
              onClick={submit}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="sw-confirm">
          {children}
          {needsNote && (
            <div className="sw-confirm__note">
              <label htmlFor={id} className="sw-field__label">
                {noteLabel}
              </label>
              <Textarea
                ref={field}
                id={id}
                maxRows={6}
                maxLength={MAX_NOTE}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <p className="sw-caption">
                At least three characters. It is kept in the report’s record.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What a reviewer is about to approve, in the figures the page shows. */
function ApproveBody({ view }: { view: StudioView }) {
  const summary = reviewSummary(view);
  const figures: { value: number; label: string }[] = [
    { value: summary.sections, label: summary.sections === 1 ? 'section' : 'sections' },
    { value: summary.byPeople, label: 'written by people' },
    { value: summary.notes, label: summary.notes === 1 ? 'reviewer note' : 'reviewer notes' },
    { value: summary.findings, label: summary.findings === 1 ? 'finding' : 'findings' },
    { value: summary.labelled, label: 'labelled, not findings' },
    ...(summary.notCurrent > 0
      ? [
          {
            value: summary.notCurrent,
            label:
              summary.notCurrent === 1
                ? 'chapter not checked as written'
                : 'chapters not checked as written',
          },
        ]
      : []),
  ];
  return (
    <>
      <dl className="sw-confirm__figures">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt className="sw-numeral num">{figure.value}</dt>
            <dd>{figure.label}</dd>
          </div>
        ))}
      </dl>
      <p className="sw-caption">
        The approval is recorded with a fingerprint of this exact text; any later change needs the
        report reopened first. It records that a reviewer read this text. It does not verify the
        statements in it.
      </p>
    </>
  );
}

/** The questions the studio asks before it does something that cannot be quietly undone. */
export function Dialogs({
  kind,
  view,
  state,
  working,
  unsaved,
  onClose,
  onStep,
  onRestart,
  onLeave,
}: {
  kind: DialogKind | null;
  view: StudioView;
  state: 'draft' | 'in-review' | 'changes-requested' | 'approved';
  working: string | null;
  unsaved: number;
  onClose: () => void;
  onStep: (step: 'approve' | 'request-changes' | 'reopen', note: string | null) => void;
  onRestart: () => void;
  onLeave: () => void;
}) {
  if (kind === 'approve') {
    return (
      <Confirm
        title="Approve this report"
        description="You are approving the text exactly as it stands now."
        confirmLabel="Approve this text"
        working={working === 'step:approve'}
        onConfirm={(note) => onStep('approve', note)}
        onClose={onClose}
      >
        <ApproveBody view={view} />
      </Confirm>
    );
  }
  if (kind === 'request-changes') {
    return (
      <Confirm
        title="Send it back for changes"
        description="The author can then edit the report and submit it again."
        noteLabel="What needs to change?"
        confirmLabel="Send it back"
        working={working === 'step:request-changes'}
        onConfirm={(note) => onStep('request-changes', note)}
        onClose={onClose}
      />
    );
  }
  if (kind === 'reopen' || kind === 'withdraw') {
    const approved = state === 'approved' || kind === 'reopen';
    return (
      <Confirm
        title={approved ? 'Reopen the approved report' : 'Withdraw it from review'}
        description={
          approved
            ? 'Reopening takes the approval away. The report must be reviewed and approved again.'
            : 'The reviewer’s decision is withdrawn and the report becomes a draft again.'
        }
        noteLabel={approved ? 'Why is it being reopened?' : 'Why is it being withdrawn?'}
        confirmLabel={approved ? 'Reopen it' : 'Withdraw it'}
        working={working === 'step:reopen'}
        onConfirm={(note) => onStep('reopen', note)}
        onClose={onClose}
      />
    );
  }
  if (kind === 'restart') {
    return (
      <Confirm
        title="Start again from the new report"
        description="This working copy holds edits, notes or a decision. Starting again replaces it with one made from the newer generated report."
        confirmLabel="Start again"
        working={working === 'start'}
        onConfirm={onRestart}
        onClose={onClose}
      >
        <p className="sw-caption">
          The text of this copy is kept in the new one’s archive, and the record of what was decided
          stays.
        </p>
      </Confirm>
    );
  }
  if (kind === 'leave') {
    return (
      <Confirm
        title="Leave with unsaved changes?"
        description={`${unsavedSentence(unsaved)} They are lost if you leave.`}
        confirmLabel="Leave anyway"
        confirmVariant="danger"
        cancelLabel="Keep editing"
        working={false}
        onConfirm={onLeave}
        onClose={onClose}
      />
    );
  }
  return null;
}
