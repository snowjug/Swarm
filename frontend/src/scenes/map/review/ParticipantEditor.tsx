import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  AUTHORITY_LABELS,
  DECISION_AUTHORITIES,
  INFLUENCE_LABELS,
  INFLUENCE_LEVELS,
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLE_MEANINGS,
  STAKEHOLDER_CATEGORY_LABELS,
  type Stakeholder,
} from '../../../../../shared/stakeholders';
import type { ParticipantChanges } from '../../../api/participants';
import {
  Button,
  Dialog,
  Disclosure,
  Field,
  IconButton,
  Input,
  Notice,
  Segmented,
  Select,
  Textarea,
} from '../../../design/ui';
import { useReturnFocus } from '../../../design/useReturnFocus';
import {
  DIRECTNESS_LABELS,
  IMPACT_LABELS,
  PRIORITY_LABELS,
} from '../../../lib/stakeholders/labels';
import {
  categoriesOf,
  changesBetween,
  hasChanges,
  participantDraftOf,
  participantDraftProblems,
  withRole,
  type ParticipantDraft,
} from './logic';
import '../dialog.css';
import './review.css';

export interface ParticipantEditorProps {
  /** The participant being changed; the dialog is open while there is one. */
  stakeholder: Stakeholder | null;
  busy: boolean;
  /** Why the server refused the last change, said inside the dialog where the person is looking. */
  problem: string | null;
  /** Sends what the person changed, and answers whether it was saved. */
  onSubmit: (id: string, changes: ParticipantChanges) => Promise<boolean>;
  onClose: () => void;
}

const LINES_HINT = 'One to a line.';

function Form({
  stakeholder,
  busy,
  problem,
  onSubmit,
  onClose,
}: Omit<ParticipantEditorProps, 'stakeholder'> & { stakeholder: Stakeholder }) {
  const nameField = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => participantDraftOf(stakeholder));
  const [shown, setShown] = useState(false);
  const [sent, setSent] = useState(false);
  const problems = participantDraftProblems(draft);
  useEffect(() => {
    nameField.current?.focus();
  }, []);
  const set = <K extends keyof ParticipantDraft>(key: K, value: ParticipantDraft[K]): void =>
    setDraft((old) => ({ ...old, [key]: value }));
  const problemOf = (key: keyof ParticipantDraft): string | undefined =>
    shown ? problems[key] : undefined;
  const lines = (key: 'incentives' | 'pressures' | 'constraints' | 'concerns'): string =>
    draft[key];
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setShown(true);
    if (Object.keys(problems).length > 0) return;
    const changes = changesBetween(stakeholder, draft);
    if (!hasChanges(changes)) {
      onClose();
      return;
    }
    setSent(true);
    await onSubmit(stakeholder.id, changes);
  };
  const lineField = (
    key: 'incentives' | 'pressures' | 'constraints' | 'concerns',
    label: string,
  ) => (
    <Field label={label} hint={LINES_HINT} error={problemOf(key)}>
      <Textarea
        rows={2}
        maxRows={6}
        value={lines(key)}
        onChange={(event) => set(key, event.target.value)}
      />
    </Field>
  );

  return (
    <form
      className="sw-sform"
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={`Edit ${stakeholder.name}`}
    >
      <div className="sw-sform__body">
        <p className="sw-caption sw-prv__editor-note">
          A synthetic role, not a person. Describe what the role is assumed to want and could do,
          and do not claim to know what any real person thinks or wants.
        </p>
        <Field
          label="Name"
          hint="The role it plays here, not “staff” or “users”."
          error={problemOf('name')}
        >
          <Input
            ref={nameField}
            value={draft.name}
            maxLength={160}
            autoComplete="off"
            onChange={(event) => set('name', event.target.value)}
          />
        </Field>
        <div className="sw-sform__row">
          <Field label="Role in the decision" hint={PARTICIPANT_ROLE_MEANINGS[draft.role]}>
            <Select
              value={draft.role}
              onChange={(event) =>
                setDraft((old) => withRole(old, event.target.value as ParticipantDraft['role']))
              }
            >
              {PARTICIPANT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {PARTICIPANT_ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kind of party">
            <Select
              value={draft.category}
              onChange={(event) =>
                set('category', event.target.value as ParticipantDraft['category'])
              }
            >
              {categoriesOf(draft.role).map((category) => (
                <option key={category} value={category}>
                  {STAKEHOLDER_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Why they matter here" error={problemOf('relevance')}>
          <Textarea
            rows={2}
            maxRows={5}
            value={draft.relevance}
            onChange={(event) => set('relevance', event.target.value)}
          />
        </Field>
        <Field
          label="What the role is trying to achieve"
          hint="An assumption for the simulation to explore."
          error={problemOf('objective')}
        >
          <Textarea
            rows={2}
            maxRows={5}
            value={draft.objective}
            onChange={(event) => set('objective', event.target.value)}
          />
        </Field>
        <Disclosure summary="What drives and limits it">
          <div className="sw-sform__more">
            {lineField('incentives', 'Incentives')}
            {lineField('pressures', 'Pressures')}
            {lineField('constraints', 'Constraints')}
            {lineField('concerns', 'Concerns')}
          </div>
        </Disclosure>
        <Disclosure summary="What it can see and could do">
          <div className="sw-sform__more">
            <Field label="What it can see" hint={LINES_HINT} error={problemOf('informationAccess')}>
              <Textarea
                rows={2}
                maxRows={6}
                value={draft.informationAccess}
                onChange={(event) => set('informationAccess', event.target.value)}
              />
            </Field>
            <Field
              label="What it could do"
              hint="Possibilities for the simulation to try, not predictions. One to a line."
              error={problemOf('plausibleActions')}
            >
              <Textarea
                rows={2}
                maxRows={6}
                value={draft.plausibleActions}
                onChange={(event) => set('plausibleActions', event.target.value)}
              />
            </Field>
            <Field
              label="Never asserted about it"
              hint="One to a line. The limits every participant of this role carries stay, whatever is written here."
              error={problemOf('prohibitedClaims')}
            >
              <Textarea
                rows={2}
                maxRows={6}
                value={draft.prohibitedClaims}
                onChange={(event) => set('prohibitedClaims', event.target.value)}
              />
            </Field>
          </div>
        </Disclosure>
        <Disclosure summary="Its place in the decision">
          <div className="sw-sform__more">
            <div className="sw-sform__group">
              <span className="sw-field__label">Influence</span>
              <Segmented
                label="Influence"
                value={draft.influence}
                onChange={(value) => set('influence', value)}
                block
                options={INFLUENCE_LEVELS.map((value) => ({
                  value,
                  label: INFLUENCE_LABELS[value],
                }))}
              />
            </div>
            <div className="sw-sform__row">
              <Field label="What it can do about the decision">
                <Select
                  value={draft.authority}
                  onChange={(event) =>
                    set('authority', event.target.value as ParticipantDraft['authority'])
                  }
                >
                  {DECISION_AUTHORITIES.map((value) => (
                    <option key={value} value={value}>
                      {AUTHORITY_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="How directly it is reached">
                <Select
                  value={draft.directness}
                  onChange={(event) =>
                    set('directness', event.target.value as ParticipantDraft['directness'])
                  }
                >
                  {(['direct', 'indirect'] as const).map((value) => (
                    <option key={value} value={value}>
                      {DIRECTNESS_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="sw-sform__group">
              <span className="sw-field__label">Priority</span>
              <Segmented
                label="Priority"
                value={draft.priority}
                onChange={(value) => set('priority', value)}
                block
                options={(['key', 'standard', 'background'] as const).map((value) => ({
                  value,
                  label: PRIORITY_LABELS[value],
                }))}
              />
            </div>
            <div className="sw-sform__group">
              <span className="sw-field__label">How the change lands on it</span>
              <Segmented
                label="How the change lands on it"
                value={draft.impactDirection}
                onChange={(value) => set('impactDirection', value)}
                block
                options={(['harmed', 'benefited', 'mixed', 'unclear'] as const).map((value) => ({
                  value,
                  label: IMPACT_LABELS[value],
                }))}
              />
            </div>
            <Field label="Why you think so" error={problemOf('impactRationale')}>
              <Input
                value={draft.impactRationale}
                autoComplete="off"
                onChange={(event) => set('impactRationale', event.target.value)}
              />
            </Field>
            <div className="sw-sform__row">
              <Field label="How sure you are">
                <Select
                  value={draft.uncertaintyLevel}
                  onChange={(event) =>
                    set(
                      'uncertaintyLevel',
                      event.target.value as ParticipantDraft['uncertaintyLevel'],
                    )
                  }
                >
                  <option value="low">Quite sure (low uncertainty)</option>
                  <option value="medium">Somewhat sure (medium uncertainty)</option>
                  <option value="high">Not sure (high uncertainty)</option>
                </Select>
              </Field>
              <Field label="Why" error={problemOf('uncertaintyReason')}>
                <Input
                  value={draft.uncertaintyReason}
                  autoComplete="off"
                  onChange={(event) => set('uncertaintyReason', event.target.value)}
                />
              </Field>
            </div>
            <Field
              label="How many it stands for"
              hint="A weight for modelling a cohort, never a count of real people. A key actor is always one."
              error={problemOf('populationSize')}
            >
              <Input
                inputMode="numeric"
                value={draft.populationSize}
                autoComplete="off"
                onChange={(event) => set('populationSize', event.target.value)}
              />
            </Field>
          </div>
        </Disclosure>
        {sent && problem && (
          <Notice tone="error" title="That was not saved">
            {problem}
          </Notice>
        )}
      </div>
      <div className="sw-sform__foot">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy} busyLabel="Saving">
          Save changes
        </Button>
      </div>
    </form>
  );
}

/**
 * Changing a participant: the few fields that matter first, the rest one press away. What a person changes is
 * theirs, and the participant says so afterwards; its evidence is the sources' and cannot be edited here. The
 * server checks every change again and what it refuses is said in the dialog.
 */
export function ParticipantEditor({
  stakeholder,
  busy,
  problem,
  onSubmit,
  onClose,
}: ParticipantEditorProps) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog open={stakeholder !== null} onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="sw-scrim sw-scrim--dialog" />
        <RadixDialog.Content
          className="sw-dialog sw-dialog--form sw-glass sw-glass--overlay"
          aria-describedby={undefined}
          ref={returnFocus.remember}
          onCloseAutoFocus={returnFocus.restore}
        >
          <div className="sw-dialog__bar">
            <RadixDialog.Title className="sw-dialog__title">Edit participant</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton label="Close" size="sm">
                <X size={16} aria-hidden="true" />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {stakeholder && (
            <Form
              key={stakeholder.id}
              stakeholder={stakeholder}
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
