import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLE_MEANINGS,
  type ParticipantRole,
} from '../../../../../shared/stakeholders';
import type { AddMissingInput } from '../../../api/participants';
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  Notice,
  Select,
  Textarea,
} from '../../../design/ui';
import { useReturnFocus } from '../../../design/useReturnFocus';
import { emptyMissing, missingInput, missingProblems, type MissingDraft } from './logic';
import '../dialog.css';
import './review.css';

export interface AddMissingDialogProps {
  /** The role to start from; the dialog is open while there is one. */
  role: ParticipantRole | null;
  busy: boolean;
  problem: string | null;
  onSubmit: (input: AddMissingInput) => Promise<boolean>;
  onClose: () => void;
}

function Form({
  role,
  busy,
  problem,
  onSubmit,
  onClose,
}: Omit<AddMissingDialogProps, 'role'> & { role: ParticipantRole }) {
  const nameField = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<MissingDraft>(() => emptyMissing(role));
  const [shown, setShown] = useState(false);
  const [sent, setSent] = useState(false);
  const problems = missingProblems(draft);
  useEffect(() => {
    nameField.current?.focus();
  }, []);
  const set = <K extends keyof MissingDraft>(key: K, value: MissingDraft[K]): void =>
    setDraft((old) => ({ ...old, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setShown(true);
    if (Object.keys(problems).length > 0) return;
    setSent(true);
    await onSubmit(missingInput(draft));
  };
  return (
    <form
      className="sw-sform"
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label="Add a missing participant"
    >
      <div className="sw-sform__body">
        <p className="sw-caption sw-prv__editor-note">
          It starts from the usual shape of its role and carries no evidence: it is yours, and is
          shown as an assumption. Name the role by what it does here, not “staff” or “users”.
        </p>
        <Field label="Role in the decision" hint={PARTICIPANT_ROLE_MEANINGS[draft.role]}>
          <Select
            value={draft.role}
            onChange={(event) => set('role', event.target.value as ParticipantRole)}
          >
            {PARTICIPANT_ROLES.map((value) => (
              <option key={value} value={value}>
                {PARTICIPANT_ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" error={shown ? problems.name : undefined}>
          <Input
            ref={nameField}
            value={draft.name}
            maxLength={160}
            autoComplete="off"
            onChange={(event) => set('name', event.target.value)}
          />
        </Field>
        <Field
          label="Why they matter here"
          hint="Optional."
          error={shown ? problems.whyTheyMatter : undefined}
        >
          <Textarea
            rows={2}
            maxRows={5}
            value={draft.whyTheyMatter}
            onChange={(event) => set('whyTheyMatter', event.target.value)}
          />
        </Field>
        <Field
          label="What the role is trying to achieve"
          hint="Optional. An assumption for the simulation to explore."
          error={shown ? problems.objective : undefined}
        >
          <Textarea
            rows={2}
            maxRows={5}
            value={draft.objective}
            onChange={(event) => set('objective', event.target.value)}
          />
        </Field>
        {sent && problem && (
          <Notice tone="error" title="That was not added">
            {problem}
          </Notice>
        )}
      </div>
      <div className="sw-sform__foot">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy} busyLabel="Adding">
          Add participant
        </Button>
      </div>
    </form>
  );
}

/** Adding a participant for a role nobody holds: a few words, and the rest is the role's usual shape. */
export function AddMissingDialog({
  role,
  busy,
  problem,
  onSubmit,
  onClose,
}: AddMissingDialogProps) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog open={role !== null} onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="sw-scrim sw-scrim--dialog" />
        <RadixDialog.Content
          className="sw-dialog sw-dialog--form sw-glass sw-glass--overlay"
          aria-describedby={undefined}
          ref={returnFocus.remember}
          onCloseAutoFocus={returnFocus.restore}
        >
          <div className="sw-dialog__bar">
            <RadixDialog.Title className="sw-dialog__title">
              Add a missing participant
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton label="Close" size="sm">
                <X size={16} aria-hidden="true" />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {role && (
            <Form
              key={role}
              role={role}
              busy={busy}
              problem={problem}
              onSubmit={onSubmit}
              onClose={onClose}
            />
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </Dialog>
  );
}
