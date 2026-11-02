import { useState } from 'react';
import { Flag, Trash2 } from 'lucide-react';
import { useWorkspace } from '../../../app/context';
import { Button, Field, Notice, Textarea, useToast } from '../../../design/ui';
import { errorMessage } from '../../../api';
import { stanceWord } from '../../../viz/palette';
import { INTERVENTION_HELP, STANCE_HELP, STRENGTH_HELP } from './copy';
import { useDeep } from './context';
import { SliderField } from './Fields';
import { SectionHead } from './parts';
import { RoundTrack } from './RoundTrack';
import { deepPhase, interventionMark, stanceText, type DeepPhase } from './model';
import {
  checkIntervention,
  checkScheduled,
  startingIntervention,
  type InterventionDraft,
  type InterventionField,
} from './validation';
import './scheduled.css';

/**
 * The four fields of an assumed event, as a branch and a pause both ask for them: which round it lands
 * before, what it says, and its stance and strength. A mistake is said under the field it is made in, once
 * the field has been touched.
 */
export function EventFields({
  draft,
  onChange,
  total,
  saved,
  minRound,
  disabled,
  errors,
  touched,
  onTouch,
}: {
  draft: InterventionDraft;
  onChange: (next: InterventionDraft) => void;
  total: number;
  saved: number;
  minRound: number;
  disabled?: boolean;
  errors: Partial<Record<InterventionField | 'form', string>>;
  touched: ReadonlySet<InterventionField>;
  onTouch: (field: InterventionField) => void;
}) {
  const shown = (field: InterventionField) => (touched.has(field) ? errors[field] : undefined);
  const length = draft.label.trim().length;
  return (
    <div className="sw-deep-ev">
      <div className="sw-deep-ev__round">
        <p className="sw-deep-ev__ask">
          Apply it before round <strong className="num">{draft.round}</strong>
          <span className="sw-deep-ev__of"> of {total}</span>
        </p>
        <RoundTrack
          label="Round the event is applied before"
          total={total}
          saved={saved}
          value={draft.round}
          min={minRound}
          max={total}
          disabled={disabled || minRound > total}
          onChange={(round) => {
            onTouch('round');
            onChange({ ...draft, round });
          }}
          valueText={(round) => `Before round ${round} of ${total}`}
        />
        {errors.round && touched.has('round') && (
          <p className="sw-deep-ev__error" role="alert">
            {errors.round}
          </p>
        )}
      </div>
      <Field
        label="What happens"
        hint={`${length} of 300 characters. Say it as an assumption, in a sentence.`}
        error={shown('label')}
      >
        <Textarea
          value={draft.label}
          maxLength={300}
          maxRows={5}
          placeholder="A regulator publishes new guidance."
          disabled={disabled}
          onBlur={() => onTouch('label')}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
        />
      </Field>
      <div className="sw-deep-ev__pair">
        <SliderField
          label="Stance"
          value={draft.stance}
          min={-1}
          max={1}
          diverging
          words={(value) => `${stanceText(value)} · ${stanceWord(value, 0.5)}`}
          hint={STANCE_HELP}
          error={shown('stance')}
          disabled={disabled}
          onChange={(stance) => {
            onTouch('stance');
            onChange({ ...draft, stance });
          }}
        />
        <SliderField
          label="Strength"
          value={draft.strength}
          min={0}
          max={1}
          words={(value) => value.toFixed(2)}
          hint={STRENGTH_HELP}
          error={shown('strength')}
          disabled={disabled}
          onChange={(strength) => {
            onTouch('strength');
            onChange({ ...draft, strength });
          }}
        />
      </div>
    </div>
  );
}

function Recorded() {
  const { project } = useDeep();
  const mark = interventionMark(project);
  if (!mark) return <p className="sw-deep-ev__none">No event is scheduled.</p>;
  return (
    <div className="sw-deep-ev__recorded" data-applied={mark.applied}>
      <Flag size={18} aria-hidden="true" className="sw-deep-ev__flag" />
      <div>
        <p className="sw-deep-ev__line">
          <strong>
            {mark.applied
              ? `Applied in round ${mark.round}`
              : `Scheduled before round ${mark.round}`}
          </strong>
          <span className="sw-deep-ev__facts num">
            stance {stanceText(mark.stance)} · strength {mark.strength.toFixed(2)}
          </span>
        </p>
        <p className="sw-deep-ev__label">“{mark.label}”</p>
      </div>
    </div>
  );
}

function Form() {
  const { project, announce } = useDeep();
  const ws = useWorkspace();
  const toast = useToast();
  const existing = project.settings.intervention;
  const [draft, setDraft] = useState<InterventionDraft>(() => startingIntervention(project));
  const [touched, setTouched] = useState<ReadonlySet<InterventionField>>(new Set());
  const [pending, setPending] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const minRound = project.currentRound + 1;
  const check = checkIntervention(draft, { minRound, maxRound: project.roundCount });
  const busy = ws.busy || pending !== null;

  const touch = (field: InterventionField) =>
    setTouched((old) => (old.has(field) ? old : new Set(old).add(field)));
  const apply = async (value: 'save' | 'remove') => {
    if (busy) return;
    setError(null);
    if (value === 'save') {
      const result = checkScheduled(draft, project);
      if (!result.ok || !result.data) {
        setTouched(new Set<InterventionField>(['round', 'label', 'stance', 'strength']));
        setError(result.fields.form ?? null);
        return;
      }
      setPending('save');
      try {
        await ws.setIntervention(result.data);
        announce(`The event is scheduled before round ${result.data.round}.`);
        toast({
          title: 'Event scheduled',
          description: `It lands before round ${result.data.round}. Resume to run it.`,
          tone: 'success',
        });
      } catch (failure) {
        setError(errorMessage(failure));
      } finally {
        setPending(null);
      }
      return;
    }
    setPending('remove');
    try {
      await ws.setIntervention(null);
      announce('The scheduled event was removed.');
      toast({ title: 'Event removed', tone: 'success' });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(null);
    }
  };

  return (
    <form
      className="sw-deep-ev__form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void apply('save');
      }}
    >
      <p className="sw-deep-fine">{INTERVENTION_HELP}</p>
      <EventFields
        draft={draft}
        onChange={(next) => {
          setError(null);
          setDraft(next);
        }}
        total={project.roundCount}
        saved={project.currentRound}
        minRound={minRound}
        disabled={busy}
        errors={check.fields}
        touched={touched}
        onTouch={touch}
      />
      <div aria-live="polite">{error && <Notice tone="error">{error}</Notice>}</div>
      <div className="sw-deep-ev__buttons">
        <Button
          type="submit"
          variant="primary"
          busy={pending === 'save'}
          busyLabel="Saving the event"
          disabled={busy || !check.ok}
        >
          {existing ? 'Replace the event' : 'Schedule the event'}
        </Button>
        {existing && (
          <Button
            variant="ghost"
            icon={<Trash2 size={15} aria-hidden="true" />}
            busy={pending === 'remove'}
            busyLabel="Removing"
            disabled={busy}
            onClick={() => void apply('remove')}
          >
            Remove it
          </Button>
        )}
      </div>
    </form>
  );
}

const WHY: Partial<Record<DeepPhase, string>> = {
  queued: 'Pause the run to schedule or change an event.',
  running: 'Pause the run to schedule or change an event.',
  ready: 'An event can be scheduled once the run has been paused after a saved round.',
  complete: 'A finished run is never rewritten. Branch it to try a different event.',
  failed: 'There is no saved round to continue from, so there is nothing to schedule into.',
  cancelled: 'There is no saved round to continue from, so there is nothing to schedule into.',
  paused: 'No round is left to schedule an event into.',
};

/** The one assumed event of a run: what is scheduled, and where it can be changed. */
export function Scheduled() {
  const { project, controls, whatIf } = useDeep();
  const existing = interventionMark(project);
  if (!whatIf && !existing) return null;
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-event">
      <SectionHead
        id="deep-event"
        title="An assumed event"
        lead="One assumption you add at the start of a future round. It is yours to change, and it is not a finding."
      />
      <Recorded />
      {whatIf &&
        (controls.intervention ? (
          <Form key={`${project.currentRound}:${JSON.stringify(project.settings.intervention)}`} />
        ) : (
          <p className="sw-deep-fine sw-deep-ev__why">{WHY[deepPhase(project)] ?? ''}</p>
        ))}
    </section>
  );
}
