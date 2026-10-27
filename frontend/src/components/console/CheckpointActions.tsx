import type { ProjectDetail } from '../../../../shared/types';
import { isBusy, stepStatus } from '../../lib/console';
import { canBranch, canResume, hasCheckpoint, resumeActionLabel } from '../../lib/whatIf';
import { Modal, Notice } from '../ui';

export function CheckpointActions({
  project,
  busy,
  onPause,
  onResume,
  onRequestRestart,
  onBranch,
}: {
  project: ProjectDetail;
  busy: boolean;
  onPause: () => void | Promise<void>;
  onResume: () => void | Promise<void>;
  onRequestRestart: () => void;
  onBranch: () => void;
}) {
  const status = stepStatus(project, 'simulation');
  const running = isBusy(project) && (status === 'queued' || status === 'running');
  const recovery = ['failed', 'cancelled'].includes(status ?? '') && hasCheckpoint(project);
  return (
    <div className="stage-actions">
      {running && (
        <button className="button button-secondary" type="button" disabled={busy} onClick={onPause}>
          Pause at last saved round
        </button>
      )}
      {(status === 'paused' || recovery) && (
        <>
          <button
            className="button button-primary"
            type="button"
            disabled={!canResume(project) || busy}
            onClick={onResume}
          >
            {resumeActionLabel(project)}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={onRequestRestart}
          >
            {recovery ? 'Retry' : 'Restart'} from round 1 — discards {project.rounds.length} saved
            rounds
          </button>
        </>
      )}
      <button
        className="button button-secondary"
        type="button"
        disabled={!canBranch(project) || busy}
        onClick={onBranch}
      >
        Branch from here
      </button>
    </div>
  );
}

export function RestartSimulationDialog({
  savedRounds,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  savedRounds: number;
  busy: boolean;
  error: string | null;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Modal title="Restart simulation from round 1?" onClose={onClose}>
      <div className="view-stack">
        <p>
          This discards {savedRounds} saved rounds and restarts the simulation from round 1 using
          the saved environment. This is not a resume.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        {busy && (
          <p className="field-help" role="status">
            Waiting for the server operation. Restart confirmation is disabled until it finishes.
          </p>
        )}
        <div className="stage-actions">
          <button
            className="button button-danger"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            Discard {savedRounds} saved rounds and restart
          </button>
          <button className="button button-secondary" type="button" onClick={onClose}>
            Keep saved rounds
          </button>
        </div>
      </div>
    </Modal>
  );
}
