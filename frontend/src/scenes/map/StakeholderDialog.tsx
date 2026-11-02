import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  STAKEHOLDER_CATEGORIES,
  STAKEHOLDER_CATEGORY_LABELS,
} from '../../../../shared/stakeholders';
import {
  Button,
  Dialog,
  Disclosure,
  Field,
  IconButton,
  Input,
  Segmented,
  Select,
  Textarea,
} from '../../design/ui';
import { useReturnFocus } from '../../design/useReturnFocus';
import { DIRECTNESS_LABELS, IMPACT_LABELS, PRIORITY_LABELS } from '../../lib/stakeholders/labels';
import { draftProblems, type StakeholderDraft } from '../../lib/stakeholders/review';
import './dialog.css';

export interface StakeholderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  /** The draft to start from; a new one is read each time the dialog opens. */
  initial: StakeholderDraft;
  busy: boolean;
  onSubmit: (draft: StakeholderDraft) => void;
}

function Form({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  title,
}: Omit<StakeholderDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const nameField = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState(false);
  const problems = draftProblems(draft);
  useEffect(() => {
    nameField.current?.focus();
  }, []);
  const set = <K extends keyof StakeholderDraft>(key: K, value: StakeholderDraft[K]): void =>
    setDraft((old) => ({ ...old, [key]: value }));
  const problem = (key: keyof StakeholderDraft): string | undefined =>
    shown ? problems[key] : undefined;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setShown(true);
    if (Object.keys(problems).length === 0) onSubmit(draft);
  };

  return (
    <form className="sw-sform" noValidate onSubmit={submit} aria-label={title}>
      <div className="sw-sform__body">
        <Field label="Name" error={problem('name')}>
          <Input
            ref={nameField}
            value={draft.name}
            maxLength={160}
            autoComplete="off"
            onChange={(event) => set('name', event.target.value)}
          />
        </Field>
        <div className="sw-sform__row">
          <Field label="Kind of party">
            <Select
              value={draft.category}
              onChange={(event) =>
                set('category', event.target.value as StakeholderDraft['category'])
              }
            >
              {STAKEHOLDER_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {STAKEHOLDER_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How directly">
            <Select
              value={draft.directness}
              onChange={(event) =>
                set('directness', event.target.value as StakeholderDraft['directness'])
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
          <span className="sw-field__label" id="sf-priority">
            Priority
          </span>
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
          <span className="sw-field__label">How the change lands on them</span>
          <Segmented
            label="How the change lands on them"
            value={draft.impactDirection}
            onChange={(value) => set('impactDirection', value)}
            block
            options={(['harmed', 'benefited', 'mixed', 'unclear'] as const).map((value) => ({
              value,
              label: IMPACT_LABELS[value],
            }))}
          />
        </div>
        <Disclosure
          summary="More about them"
          defaultOpen={Boolean(draft.description || draft.relevance)}
        >
          <div className="sw-sform__more">
            <Field label="Who they are" error={problem('description')}>
              <Textarea
                rows={2}
                maxRows={5}
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </Field>
            <Field label="Why they matter here" error={problem('relevance')}>
              <Textarea
                rows={2}
                maxRows={5}
                value={draft.relevance}
                onChange={(event) => set('relevance', event.target.value)}
              />
            </Field>
            <Field
              label="Why you think the change lands that way"
              error={problem('impactRationale')}
            >
              <Input
                value={draft.impactRationale}
                autoComplete="off"
                onChange={(event) => set('impactRationale', event.target.value)}
              />
            </Field>
            <Field
              label="How many it stands for"
              hint="A weight for modelling a cohort, never a count of real people. A key actor is always one."
              error={problem('populationSize')}
            >
              <Input
                inputMode="numeric"
                value={draft.populationSize}
                autoComplete="off"
                onChange={(event) => set('populationSize', event.target.value)}
              />
            </Field>
            <div className="sw-sform__row">
              <Field label="How sure you are">
                <Select
                  value={draft.uncertaintyLevel}
                  onChange={(event) =>
                    set(
                      'uncertaintyLevel',
                      event.target.value as StakeholderDraft['uncertaintyLevel'],
                    )
                  }
                >
                  <option value="low">Quite sure (low uncertainty)</option>
                  <option value="medium">Somewhat sure (medium uncertainty)</option>
                  <option value="high">Not sure (high uncertainty)</option>
                </Select>
              </Field>
              <Field label="Why" error={problem('uncertaintyReason')}>
                <Input
                  value={draft.uncertaintyReason}
                  autoComplete="off"
                  onChange={(event) => set('uncertaintyReason', event.target.value)}
                />
              </Field>
            </div>
          </div>
        </Disclosure>
      </div>
      <div className="sw-sform__foot">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy} busyLabel="Saving">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Adding or changing a stakeholder: the few fields that matter first, the rest one press away. It checks them
 * as they are sent and says what is wrong beside the field, and it makes no request itself: `onSubmit` is
 * handed a valid draft. What a person adds is theirs and carries no evidence, and the panel says so.
 */
export function StakeholderDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  busy,
  onSubmit,
}: StakeholderDialogProps) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="sw-scrim sw-scrim--dialog" />
        <RadixDialog.Content
          className="sw-dialog sw-dialog--form sw-glass sw-glass--overlay"
          aria-describedby={undefined}
          ref={returnFocus.remember}
          onCloseAutoFocus={returnFocus.restore}
        >
          <div className="sw-dialog__bar">
            <RadixDialog.Title className="sw-dialog__title">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton label="Close" size="sm">
                <X size={16} aria-hidden="true" />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {open && (
            <Form
              title={title}
              submitLabel={submitLabel}
              initial={initial}
              busy={busy}
              onSubmit={onSubmit}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </Dialog>
  );
}
