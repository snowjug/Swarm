import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  CONSTRAINT_CATEGORIES,
  CONSTRAINT_CATEGORY_LABELS,
  CONSTRAINT_SEVERITIES,
  EFFECT_CATALOGUE,
  ENFORCED_EFFECT_KINDS,
  LIMITABLE_RESPONSES,
  type ConstraintActorOption,
  type ConstraintAlternativeOption,
  type LimitableResponse,
} from '../../../../../shared/constraints';
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
} from '../../../design/ui';
import { useReturnFocus } from '../../../design/useReturnFocus';
import { problemWith, type EditorDraft, type EffectChoice, type EffectDraft } from './model';

export interface EditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  /** The draft to start from; a new one is read each time the dialog opens. */
  initial: EditorDraft;
  actors: readonly ConstraintActorOption[];
  alternatives: readonly ConstraintAlternativeOption[];
  busy: boolean;
  /** What was refused when the last change was sent, so that it is said where the person is looking. */
  problem?: string | null;
  onSubmit: (draft: EditorDraft) => void;
}

const SEVERITY_WORDS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
} as const;

const RESPONSE_WORDS: Record<LimitableResponse, string> = {
  adopt: 'Adopt',
  switch: 'Switch away',
  resist: 'Resist',
};

function Checks<T extends string>({
  legend,
  options,
  chosen,
  onChange,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  chosen: readonly T[];
  onChange: (next: T[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="sw-checks">
      <legend className="sw-field__label">{legend}</legend>
      <div className="sw-checks__list">
        {options.map((option) => (
          <label key={option.value} className="sw-checks__item">
            <input
              type="checkbox"
              checked={chosen.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...chosen, option.value]
                    : chosen.filter((value) => value !== option.value),
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EffectFields({
  effect,
  actors,
  onChange,
}: {
  effect: EffectDraft;
  actors: readonly ConstraintActorOption[];
  onChange: (next: EffectDraft) => void;
}) {
  const set = <K extends keyof EffectDraft>(key: K, value: EffectDraft[K]): void =>
    onChange({ ...effect, [key]: value });
  const info = effect.kind === 'none' ? null : EFFECT_CATALOGUE[effect.kind];
  const who = actors.map((actor) => ({ value: actor.id, label: actor.name }));
  return (
    <div className="sw-cform__effect">
      <Field
        label="What the simulation does with it"
        hint={
          info
            ? info.engine
            : 'Nothing: it is read and listed, and changes nothing in a run. Choose an effect to have the simulation apply it.'
        }
      >
        <Select
          value={effect.kind}
          onChange={(event) => set('kind', event.target.value as EffectChoice)}
        >
          <option value="none">Nothing: read only</option>
          {ENFORCED_EFFECT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {EFFECT_CATALOGUE[kind].label}
            </option>
          ))}
        </Select>
      </Field>
      {info && info.window === 'none' && (
        <p className="sw-caption">
          The simulation applies this for the whole run; a window is not read for it.
        </p>
      )}
      {effect.kind === 'limit-actions' && (
        <Checks
          legend="Responses taken away"
          options={LIMITABLE_RESPONSES.map((value) => ({ value, label: RESPONSE_WORDS[value] }))}
          chosen={effect.forbid}
          onChange={(next) => set('forbid', next)}
        />
      )}
      {effect.kind === 'delay' && (
        <Field label="Rounds of delay">
          <Input
            inputMode="numeric"
            value={effect.rounds}
            autoComplete="off"
            onChange={(event) => set('rounds', event.target.value)}
          />
        </Field>
      )}
      {(effect.kind === 'reduce-influence' ||
        effect.kind === 'add-risk' ||
        effect.kind === 'add-cost') && (
        <div className="sw-cform__row">
          {effect.kind === 'add-cost' && (
            <Field label="Friction on">
              <Select
                value={effect.target}
                onChange={(event) => set('target', event.target.value as EffectDraft['target'])}
              >
                <option value="adoption">Taking it up</option>
                <option value="switching">Switching</option>
              </Select>
            </Field>
          )}
          <Field label="Amount" hint="A setting of the simulation, not a measurement.">
            <Input
              inputMode="decimal"
              value={effect.amount}
              autoComplete="off"
              onChange={(event) => set('amount', event.target.value)}
            />
          </Field>
        </div>
      )}
      {effect.kind === 'require-approval' && (
        <div className="sw-cform__row">
          <Field label="Who approves">
            <Select
              value={effect.approver}
              onChange={(event) => set('approver', event.target.value)}
            >
              <option value="">Choose an actor</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Stance they have to reach"
            hint="From -1 (against) to 1 (in favour). It is an assumption."
          >
            <Input
              inputMode="decimal"
              value={effect.threshold}
              autoComplete="off"
              onChange={(event) => set('threshold', event.target.value)}
            />
          </Field>
        </div>
      )}
      {effect.kind === 'force-sequencing' && (
        <>
          <Checks
            legend="Who has to hear first"
            options={who}
            chosen={effect.before}
            onChange={(next) => set('before', next)}
          />
          <Field label="Rounds before the others hear">
            <Input
              inputMode="numeric"
              value={effect.rounds}
              autoComplete="off"
              onChange={(event) => set('rounds', event.target.value)}
            />
          </Field>
        </>
      )}
    </div>
  );
}

function Form({
  mode,
  initial,
  actors,
  alternatives,
  busy,
  problem: refused,
  onSubmit,
  onCancel,
}: Omit<EditorProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const statement = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState(false);
  const problem = problemWith(draft);
  useEffect(() => {
    statement.current?.focus();
  }, []);
  const set = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]): void =>
    setDraft((old) => ({ ...old, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setShown(true);
    if (problem === null) onSubmit(draft);
  };
  return (
    <form
      className="sw-cform"
      noValidate
      onSubmit={submit}
      aria-label={mode === 'add' ? 'Add a constraint' : 'Change the constraint'}
    >
      <div className="sw-cform__body">
        <Field
          label="What is the limit?"
          hint="One plain sentence: what is limited, and how."
          error={shown && problem && draft.statement.trim().length < 3 ? problem : undefined}
        >
          <Textarea
            ref={statement}
            rows={2}
            maxRows={6}
            value={draft.statement}
            maxLength={400}
            onChange={(event) => set('statement', event.target.value)}
          />
        </Field>
        <div className="sw-cform__row">
          <Field label="Kind of limit">
            <Select
              value={draft.category}
              onChange={(event) => set('category', event.target.value as EditorDraft['category'])}
            >
              {CONSTRAINT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CONSTRAINT_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sw-cform__group">
            <span className="sw-field__label">How firm</span>
            <Segmented
              label="How firm"
              value={draft.hardness}
              onChange={(value) => set('hardness', value)}
              block
              options={[
                { value: 'soft', label: 'Soft' },
                { value: 'hard', label: 'Hard' },
              ]}
            />
          </div>
        </div>
        {mode === 'add' && (
          <div className="sw-cform__group">
            <span className="sw-field__label">How sure are you?</span>
            <Segmented
              label="How sure are you?"
              value={draft.validation}
              onChange={(value) => set('validation', value)}
              block
              options={[
                { value: 'confirmed', label: 'It holds' },
                { value: 'assumed', label: 'I assume it' },
                { value: 'unknown', label: 'I do not know' },
              ]}
            />
            <p className="sw-caption">
              It is saved as yours, with no source. An assumption is labelled so wherever the result
              is used, and an unknown is not applied.
            </p>
          </div>
        )}
        <EffectFields
          effect={draft.effect}
          actors={actors}
          onChange={(effect) => set('effect', effect)}
        />
        <Disclosure
          summary="Who and what it covers, when, and how serious"
          defaultOpen={Boolean(
            draft.actorIds.length > 0 ||
            draft.alternativeIds.length > 0 ||
            draft.windowText ||
            draft.fromRound ||
            draft.toRound,
          )}
        >
          <div className="sw-cform__more">
            <Checks
              legend="Affects these actors (none chosen: everyone)"
              options={actors.map((actor) => ({ value: actor.id, label: actor.name }))}
              chosen={draft.actorIds}
              onChange={(next) => set('actorIds', next)}
            />
            <Checks
              legend="Applies to these alternatives (none chosen: all)"
              options={alternatives.map((option) => ({ value: option.id, label: option.label }))}
              chosen={draft.alternativeIds}
              onChange={(next) => set('alternativeIds', next)}
            />
            <div className="sw-cform__row">
              <Field label="From round">
                <Input
                  inputMode="numeric"
                  value={draft.fromRound}
                  autoComplete="off"
                  onChange={(event) => set('fromRound', event.target.value)}
                />
              </Field>
              <Field label="Until round">
                <Input
                  inputMode="numeric"
                  value={draft.toRound}
                  autoComplete="off"
                  onChange={(event) => set('toRound', event.target.value)}
                />
              </Field>
            </div>
            <Field
              label="The window in your words"
              hint="For people reading it. The simulation reads only the rounds."
            >
              <Input
                value={draft.windowText}
                maxLength={120}
                autoComplete="off"
                onChange={(event) => set('windowText', event.target.value)}
              />
            </Field>
            <Field label="How serious if it is broken">
              <Select
                value={draft.severity}
                onChange={(event) => set('severity', event.target.value as EditorDraft['severity'])}
              >
                {CONSTRAINT_SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_WORDS[severity]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="A note">
              <Input
                value={draft.note}
                maxLength={300}
                autoComplete="off"
                onChange={(event) => set('note', event.target.value)}
              />
            </Field>
          </div>
        </Disclosure>
        {shown && problem && draft.statement.trim().length >= 3 && (
          <p className="sw-field__error" role="alert">
            {problem}
          </p>
        )}
        {refused && (
          <p className="sw-field__error" role="alert">
            {refused}
          </p>
        )}
      </div>
      <div className="sw-cform__foot">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy} busyLabel="Saving">
          {mode === 'add' ? 'Add the constraint' : 'Save the change'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Adding a constraint or changing one: the few fields that matter first, the rest one press away. It checks them as
 * they are sent and says what is wrong beside the field, and it makes no request itself. What a person writes
 * is theirs and carries no evidence, and the form says so; a source's quote on a constraint they change stays the source's.
 */
export function Editor({ open, onOpenChange, mode, ...rest }: EditorProps) {
  const returnFocus = useReturnFocus();
  const title = mode === 'add' ? 'Add a constraint' : 'Change the constraint';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="sw-scrim sw-scrim--dialog" />
        <RadixDialog.Content
          className="sw-dialog sw-cdialog sw-glass sw-glass--overlay"
          aria-describedby={undefined}
          ref={returnFocus.remember}
          onCloseAutoFocus={returnFocus.restore}
        >
          <div className="sw-cdialog__bar">
            <RadixDialog.Title className="sw-dialog__title">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton label="Close" size="sm">
                <X size={16} aria-hidden="true" />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {open && <Form mode={mode} onCancel={() => onOpenChange(false)} {...rest} />}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </Dialog>
  );
}
