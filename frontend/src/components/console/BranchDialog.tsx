import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { BranchInput } from '../../../../shared/guided';
import type { Intervention, ProjectDetail } from '../../../../shared/types';
import { errorMessage } from '../../api';
import { canBranch, maxBranchRound, validateBranch } from '../../lib/whatIf';
import { Modal, Notice, Spinner } from '../ui';
import { BranchProxyEdits } from './BranchProxyEdits';
import type { ProxyEdit } from './BranchProxyEdits';
import { InterventionFields } from './InterventionFields';

export function BranchDialog({
  project,
  busy,
  onSubmit,
  onClose,
}: {
  project: ProjectDetail;
  busy: boolean;
  onSubmit: (input: BranchInput) => Promise<void>;
  onClose: () => void;
}) {
  const maximum = maxBranchRound(project);
  const [fromRound, setFromRound] = useState(maximum);
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<'inherit' | 'remove' | 'replace'>('inherit');
  const [intervention, setIntervention] = useState<Intervention>({
    round: maximum + 1,
    label: '',
    stance: 0,
    strength: 0.5,
  });
  const [edits, setEdits] = useState<ProxyEdit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const id = useId();
  const allowed = canBranch(project);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || busy || !allowed) return;
    const result = validateBranch(
      {
        ...(name.trim() ? { name: name.trim() } : {}),
        fromRound,
        ...(choice === 'remove'
          ? { intervention: null }
          : choice === 'replace'
            ? { intervention }
            : {}),
        agentEdits: edits,
      },
      project,
    );
    if (result.error) {
      setError(result.error);
      return;
    }
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await onSubmit(result.data!);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <Modal title="Branch from a recorded checkpoint" onClose={onClose}>
      <form
        className="view-stack branch-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-describedby={`${id}-help ${id}-error`}
        onChangeCapture={() => setError(null)}
      >
        <p id={`${id}-help`}>
          Create a separate guided project. The source run is not changed. The new project waits for
          Resume (checkpoint &gt; 0) or Start (round 0); branching never starts simulation
          automatically.
        </p>
        <div className="field">
          <label htmlFor={`${id}-round`}>Last round to copy unchanged</label>
          <select
            id={`${id}-round`}
            value={fromRound}
            disabled={busy || pending}
            onChange={(event) => {
              const round = Number(event.target.value);
              setFromRound(round);
              setIntervention((old) => ({ ...old, round: Math.max(round + 1, old.round) }));
            }}
          >
            {Array.from({ length: maximum + 1 }, (_, index) => (
              <option key={index} value={index}>
                {index === 0 ? 'Round 0 — restart from scratch' : `Round ${index}`}
              </option>
            ))}
          </select>
          <small role="status">
            {fromRound
              ? `Rounds 1–${fromRound} are copied unchanged. Assumption edits affect only the branch from this checkpoint onward.`
              : 'No simulation rounds are copied. The source environment and edited assumptions are used for a new run from round 1.'}
          </small>
        </div>
        <div className="field">
          <label htmlFor={`${id}-name`}>New project name (optional, 3–100 characters)</label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={100}
            disabled={busy || pending}
            onChange={(event) => setName(event.target.value)}
            placeholder="Leave blank for the server’s branch name"
          />
        </div>
        <fieldset className="branch-intervention-choice" disabled={busy || pending}>
          <legend>Scheduled intervention</legend>
          {(['inherit', 'remove', 'replace'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`${id}-intervention`}
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
              />
              {value === 'inherit'
                ? 'Inherit the source schedule'
                : value === 'remove'
                  ? 'Remove from the branch'
                  : 'Replace with a future intervention'}
            </label>
          ))}
        </fieldset>
        {choice === 'replace' && (
          <InterventionFields
            value={intervention}
            minRound={fromRound + 1}
            maxRound={project.roundCount}
            disabled={busy || pending}
            onChange={setIntervention}
          />
        )}
        <BranchProxyEdits
          agents={project.agents}
          edits={edits}
          disabled={busy || pending}
          onChange={setEdits}
        />
        <div id={`${id}-error`} aria-live="polite">
          {error && (
            <Notice tone="error" title="Branch was not created">
              {error}
            </Notice>
          )}
        </div>
        {!allowed && (
          <Notice tone="warning">
            Branching requires a paused, ready or failed simulation and no running project
            operation.
          </Notice>
        )}
        {(busy || pending) && (
          <p className="field-help" role="status">
            Waiting for the current server request. Submission is disabled to prevent duplicate
            branches.
          </p>
        )}
        <div className="stage-actions">
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || pending || !allowed}
          >
            {pending && <Spinner label="Creating branch" />} Create branch and open it
          </button>
          <button className="button button-secondary" type="button" onClick={onClose}>
            Keep source run unchanged
          </button>
        </div>
      </form>
    </Modal>
  );
}
