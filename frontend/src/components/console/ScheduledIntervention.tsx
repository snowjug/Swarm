import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Intervention, ProjectDetail } from '../../../../shared/types';
import { errorMessage } from '../../api';
import { canEditIntervention, validateIntervention } from '../../lib/whatIf';
import { Notice, Spinner } from '../ui';
import { InterventionFields } from './InterventionFields';

export function ScheduledIntervention({
  project,
  busy,
  onSave,
}: {
  project: ProjectDetail;
  busy: boolean;
  onSave: (value: Intervention | null) => Promise<void>;
}) {
  const existing = project.settings.intervention;
  const [draft, setDraft] = useState<Intervention>(() => ({
    round: Math.max(project.currentRound + 1, existing?.round ?? project.currentRound + 1),
    label: existing?.label ?? '',
    stance: existing?.stance ?? 0,
    strength: existing?.strength ?? 0.5,
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const id = useId();
  const allowed = canEditIntervention(project);
  const save = async (value: Intervention | null) => {
    if (lock.current || busy || !allowed) return;
    const result = validateIntervention(value, project);
    if (result.error) {
      setError(result.error);
      return;
    }
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await onSave(result.data!);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(draft);
  };
  return (
    <form
      className="scheduled-intervention view-stack"
      noValidate
      onSubmit={submit}
      aria-describedby={`${id}-help ${id}-error`}
      onChangeCapture={() => setError(null)}
    >
      <p id={`${id}-help`} className="field-help">
        Live injection means <strong>pause → schedule → resume</strong>. It applies at the selected
        future round boundary, never in the middle of a round. A paused in-flight round is
        discarded, not half-saved.
      </p>
      <p className="record-meta">
        {existing
          ? `Recorded schedule: round ${existing.round} — ${existing.label}`
          : 'No intervention is currently scheduled.'}
      </p>
      <InterventionFields
        value={draft}
        minRound={project.currentRound + 1}
        maxRound={project.roundCount}
        disabled={!allowed || busy || pending}
        onChange={setDraft}
      />
      {!allowed && (
        <p className="field-help">
          Pause the simulation, or recover a failed run with a saved checkpoint, to edit a future
          intervention. At least one unsaved round must remain.
        </p>
      )}
      <div id={`${id}-error`} aria-live="polite">
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <div className="stage-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={!allowed || busy || pending}
        >
          {pending && <Spinner label="Saving scheduled intervention" />} Save future intervention
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={!allowed || busy || pending || !existing}
          onClick={() => void save(null)}
        >
          Remove scheduled intervention
        </button>
      </div>
      {!existing && (
        <p className="field-help">Remove is disabled because no intervention is scheduled.</p>
      )}
      {(busy || pending) && (
        <p className="field-help" role="status">
          Waiting for the server operation to finish; editing and submission are temporarily
          disabled.
        </p>
      )}
    </form>
  );
}
