import { useId, useRef, useState } from 'react';
import type { Intervention, ProjectDetail } from '../../../../shared/types';
import { errorMessage } from '../../api';
import { isBusy, stepStatus } from '../../lib/console';
import { canBranch, canResume, hasCheckpoint, resumeActionLabel } from '../../lib/whatIf';
import { Notice, Spinner } from '../ui';
import { ScheduledIntervention } from './ScheduledIntervention';
import { CheckpointActions, RestartSimulationDialog } from './CheckpointActions';

export function CheckpointControls({
  project,
  busy,
  enabled,
  onPause,
  onResume,
  onRestart,
  onIntervention,
  onBranch,
}: {
  project: ProjectDetail;
  busy: boolean;
  enabled: boolean;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onRestart: () => Promise<void>;
  onIntervention: (value: Intervention | null) => Promise<void>;
  onBranch: () => void;
}) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const headingId = useId();
  if (!enabled) return null;
  const status = stepStatus(project, 'simulation');
  const running = isBusy(project) && (status === 'queued' || status === 'running');
  const checkpoint = hasCheckpoint(project);
  const recovery = (status === 'failed' || status === 'cancelled') && checkpoint;
  const resumable = canResume(project);
  const branchable = canBranch(project);
  const act = async (action: () => Promise<void>, close = false) => {
    if (lock.current || busy) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      if (close) setRestartOpen(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <section className="checkpoint-controls view-stack" aria-labelledby={headingId}>
      <h3 id={headingId}>Checkpoint actions</h3>
      <p className="field-help">Manage saved execution or branch without changing this run.</p>
      {status === 'paused' && (
        <Notice
          title={`Paused after round ${project.currentRound} of ${project.roundCount} — saved and resumable`}
        >
          Saved rounds are preserved and will not run again. {resumeActionLabel(project)}. Restart
          discards {project.rounds.length} saved rounds. The interrupted in-flight round was
          discarded, never half-saved.
        </Notice>
      )}
      {recovery && (
        <Notice tone="warning" title={`Saved checkpoint at round ${project.currentRound}`}>
          Saved rounds will not run again. {resumeActionLabel(project)}, or explicitly discard{' '}
          {project.rounds.length} saved rounds and retry from round 1.
        </Notice>
      )}
      <CheckpointActions
        project={project}
        busy={busy || pending}
        onPause={() => act(onPause)}
        onResume={() => act(onResume)}
        onRequestRestart={() => {
          setError(null);
          setRestartOpen(true);
        }}
        onBranch={onBranch}
      />
      {running && (
        <p className="field-help">
          Pause requests a safe boundary: saved rounds stay; the in-flight round is discarded. With
          no saved rounds, the stage becomes cancelled instead of paused. Pause is non-error; Cancel
          marks the stage cancelled. Any persisted checkpoint remains available for recovery.
        </p>
      )}
      {!branchable && (
        <p className="field-help">
          Branching is disabled until simulation is paused, ready or failed. It never mutates the
          source project.
        </p>
      )}
      {(status === 'paused' || recovery) && !resumable && (
        <p className="field-help">
          Resume is disabled: a saved checkpoint and at least one remaining round are required.
        </p>
      )}
      {(busy || pending) && (
        <p className="field-help" role="status">
          <Spinner /> Waiting for the server; checkpoint actions are temporarily disabled.
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {(status === 'paused' || (status === 'failed' && checkpoint)) && (
        <details className="record-details">
          <summary>
            Edit scheduled intervention — applies on resume at a future round boundary
          </summary>
          <div className="checkpoint-editor">
            <ScheduledIntervention
              key={`${project.currentRound}:${JSON.stringify(project.settings.intervention)}`}
              project={project}
              busy={busy || pending}
              onSave={onIntervention}
            />
          </div>
        </details>
      )}
      {restartOpen && (
        <RestartSimulationDialog
          savedRounds={project.rounds.length}
          busy={busy || pending}
          error={error}
          onConfirm={() => act(onRestart, true)}
          onClose={() => setRestartOpen(false)}
        />
      )}
    </section>
  );
}
