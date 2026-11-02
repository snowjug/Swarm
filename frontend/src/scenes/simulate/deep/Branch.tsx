import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useWorkspace } from '../../../app/context';
import { errorMessage } from '../../../api';
import {
  Button,
  Field,
  IconButton,
  Input,
  Notice,
  Segmented,
  Select,
  Sheet,
  SheetContent,
  useToast,
} from '../../../design/ui';
import { canBranch, maxBranchRound } from '../../../lib/whatIf';
import { BRANCH_HELP } from './copy';
import { useDeep } from './context';
import { NumberInput } from './Fields';
import { EventFields } from './Scheduled';
import { RoundTrack } from './RoundTrack';
import { describeIntervention } from './model';
import {
  PROXY_EDIT_RULES,
  branchSummary,
  checkBranch,
  startingBranch,
  type BranchDraft,
  type InterventionChoice,
  type InterventionField,
  type ProxyEdit,
  type ProxyEditField,
} from './validation';
import './branch.css';

const CHOICES: { value: InterventionChoice; label: string }[] = [
  { value: 'inherit', label: 'Keep' },
  { value: 'remove', label: 'Remove' },
  { value: 'replace', label: 'Replace' },
];

const FIELD_ORDER: ProxyEditField[] = ['opinion', 'influence', 'openness'];

function ProxyEdits({
  edits,
  onChange,
  errors,
  disabled,
}: {
  edits: ProxyEdit[];
  onChange: (next: ProxyEdit[]) => void;
  errors: Partial<Record<string, string>>;
  disabled: boolean;
}) {
  const { project } = useDeep();
  const agents = project.agents;
  const unused = agents.filter((agent) => !edits.some((edit) => edit.id === agent.id));
  const update = (index: number, patch: ProxyEdit | ((edit: ProxyEdit) => ProxyEdit)) =>
    onChange(
      edits.map((edit, at) =>
        at === index ? (typeof patch === 'function' ? patch(edit) : { ...edit, ...patch }) : edit,
      ),
    );
  const setField = (index: number, field: ProxyEditField, value: number) =>
    update(index, (edit) => {
      const next = { ...edit };
      if (Number.isNaN(value)) delete next[field];
      else next[field] = value;
      return next;
    });
  return (
    <div className="sw-deep-bp">
      {edits.map((edit, index) => {
        const agent = agents.find((item) => item.id === edit.id);
        const note = errors[`edit.${index}`];
        // Nothing set yet is a reminder, not a fault: it only becomes one when the proxy itself is wrong.
        const reminder = note?.startsWith('Change at least') === true;
        return (
          <fieldset className="sw-deep-bp__row" key={index} disabled={disabled}>
            <legend className="sr-only">Proxy change {index + 1}</legend>
            <div className="sw-deep-bp__who">
              <Field label="Proxy" error={reminder ? undefined : note}>
                <Select
                  value={edit.id}
                  onChange={(event) => update(index, { id: event.target.value })}
                >
                  {agents.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={edits.some((other, at) => at !== index && other.id === item.id)}
                    >
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <IconButton
                label={`Remove the change to ${agent?.name ?? 'this proxy'}`}
                size="md"
                onClick={() => onChange(edits.filter((_, at) => at !== index))}
              >
                <X size={17} aria-hidden="true" />
              </IconButton>
            </div>
            {reminder && <p className="sw-deep-fine">{note}</p>}
            <div className="sw-deep-bp__numbers">
              {FIELD_ORDER.map((field) => {
                const rule = PROXY_EDIT_RULES[field];
                const key = `edit.${index}.${field}`;
                const now = agent ? (field === 'opinion' ? null : agent[field]) : null;
                return (
                  <div className="sw-deep-bp__num" key={field}>
                    <label className="sw-deep-bp__label" htmlFor={`bp-${index}-${field}`}>
                      {rule.label}
                    </label>
                    <NumberInput
                      id={`bp-${index}-${field}`}
                      label={rule.label}
                      value={edit[field]}
                      min={rule.min}
                      max={rule.max}
                      placeholder={now === null ? 'Inherit' : `Now ${now.toFixed(2)}`}
                      invalid={Boolean(errors[key])}
                      describedBy={errors[key] ? `bp-${index}-${field}-error` : undefined}
                      onChange={(value) => setField(index, field, value)}
                    />
                    {errors[key] && (
                      <p
                        className="sw-deep-bp__error"
                        id={`bp-${index}-${field}-error`}
                        role="alert"
                      >
                        {errors[key]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <Button
        variant="glass"
        size="sm"
        icon={<Plus size={15} aria-hidden="true" />}
        disabled={disabled || unused.length === 0 || edits.length >= 24}
        onClick={() => {
          const next = unused[0];
          if (next) onChange([...edits, { id: next.id }]);
        }}
      >
        {edits.length === 0 ? 'Change a proxy' : 'Change another proxy'}
      </Button>
      {edits.length === 0 && (
        <p className="sw-deep-fine">
          Optional. A blank box inherits the checkpoint’s value. Who they are, and where they come
          from, does not change.
        </p>
      )}
    </div>
  );
}

/**
 * Branching from a checkpoint, as one sheet with its checks live: the checkpoint is chosen on the rounds
 * themselves, what the branch would do is said in plain lines as it is set up, and the button is there only
 * when the request would be accepted.
 */
export function BranchSheet({ from, onClose }: { from: number | undefined; onClose: () => void }) {
  const { project, announce } = useDeep();
  const ws = useWorkspace();
  const toast = useToast();
  const [draft, setDraft] = useState<BranchDraft>(() => startingBranch(project, from));
  const [touched, setTouched] = useState<ReadonlySet<InterventionField>>(new Set());
  const [named, setNamed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maximum = maxBranchRound(project);
  const allowed = canBranch(project);
  const check = checkBranch(draft, project);
  const busy = pending || ws.busy;
  const touch = (field: InterventionField) =>
    setTouched((old) => (old.has(field) ? old : new Set(old).add(field)));
  const change = (next: BranchDraft) => {
    setError(null);
    setDraft(next);
  };
  const eventErrors = {
    round: check.fields['intervention.round'],
    label: check.fields['intervention.label'],
    stance: check.fields['intervention.stance'],
    strength: check.fields['intervention.strength'],
  };
  const problem = Object.values(check.fields)[0] ?? null;

  const submit = async () => {
    if (!check.ok || !check.input || busy || !allowed) return;
    setPending(true);
    setError(null);
    try {
      await ws.branch(check.input);
      announce('The branch was created and is open.');
      toast({
        title: 'Branch created',
        description: 'It is open now, and waits for you to start it.',
        tone: 'success',
      });
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(false);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && !pending && onClose()}>
      <SheetContent
        eyebrow="What if"
        title="Branch from a checkpoint"
        description={BRANCH_HELP}
        width="lg"
        className="sw-deep-bs"
        footer={
          <>
            <div className="sw-deep-bs__status" role="status">
              {error ? (
                <span className="sw-deep-bs__failed">{error}</span>
              ) : problem ? (
                <span className="sw-deep-bs__problem">{problem}</span>
              ) : (
                <span>{branchSummary(draft, project).join(' ')}</span>
              )}
            </div>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Keep the source run unchanged
            </Button>
            <Button
              variant="accent"
              busy={pending}
              busyLabel="Creating the branch"
              disabled={!check.ok || busy || !allowed}
              onClick={() => void submit()}
            >
              Create the branch and open it
            </Button>
          </>
        }
      >
        <form
          className="sw-deep-bs__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {!allowed && (
            <Notice tone="caution">
              Branching needs a paused, finished or failed run, with no other operation in progress.
            </Notice>
          )}

          <section className="sw-deep-bs__part" aria-labelledby="bs-checkpoint">
            <h3 className="sw-deep-bs__title" id="bs-checkpoint">
              Checkpoint
            </h3>
            <p className="sw-deep-bs__sub" aria-live="polite">
              {draft.fromRound === 0
                ? 'Start again from round 1. No rounds are copied.'
                : `Rounds 1 to ${draft.fromRound} are copied unchanged. What you change applies from round ${draft.fromRound + 1}.`}
            </p>
            <RoundTrack
              size="lg"
              label="Last round to copy unchanged"
              total={project.roundCount}
              saved={project.currentRound}
              value={draft.fromRound}
              min={0}
              max={maximum}
              disabled={busy}
              onChange={(round) =>
                change({
                  ...draft,
                  fromRound: round,
                  intervention: {
                    ...draft.intervention,
                    round: Math.max(round + 1, draft.intervention.round),
                  },
                })
              }
              valueText={(round) =>
                round === 0
                  ? 'Round 0: start again from scratch'
                  : `Round ${round} of ${project.roundCount}`
              }
            />
            {check.fields.fromRound && (
              <p className="sw-deep-bs__error" role="alert">
                {check.fields.fromRound}
              </p>
            )}
          </section>

          <section className="sw-deep-bs__part" aria-labelledby="bs-event">
            <h3 className="sw-deep-bs__title" id="bs-event">
              The assumed event
            </h3>
            <p className="sw-deep-bs__sub">
              Now: {describeIntervention(project.settings.intervention)}.
            </p>
            <Segmented<InterventionChoice>
              label="What to do with the scheduled event"
              size="sm"
              value={draft.choice}
              onChange={(choice) => change({ ...draft, choice })}
              options={CHOICES}
            />
            {check.fields.choice && (
              <p className="sw-deep-bs__error" role="alert">
                {check.fields.choice}
              </p>
            )}
            {draft.choice === 'replace' && (
              <EventFields
                draft={draft.intervention}
                onChange={(intervention) => change({ ...draft, intervention })}
                total={project.roundCount}
                saved={draft.fromRound}
                minRound={draft.fromRound + 1}
                disabled={busy}
                errors={eventErrors}
                touched={touched}
                onTouch={touch}
              />
            )}
          </section>

          <section className="sw-deep-bs__part" aria-labelledby="bs-proxies">
            <h3 className="sw-deep-bs__title" id="bs-proxies">
              Proxy assumptions
            </h3>
            <ProxyEdits
              edits={draft.edits}
              onChange={(edits) => change({ ...draft, edits })}
              errors={check.fields}
              disabled={busy}
            />
          </section>

          <section className="sw-deep-bs__part" aria-labelledby="bs-name">
            <h3 className="sw-deep-bs__title" id="bs-name">
              Name
            </h3>
            <Field
              label="Name of the branch (optional)"
              hint="3 to 100 characters. Left blank, the server names it."
              error={named ? check.fields.name : undefined}
            >
              <Input
                value={draft.name}
                maxLength={100}
                disabled={busy}
                onBlur={() => setNamed(true)}
                onChange={(event) => change({ ...draft, name: event.target.value })}
              />
            </Field>
          </section>
        </form>
      </SheetContent>
    </Sheet>
  );
}
