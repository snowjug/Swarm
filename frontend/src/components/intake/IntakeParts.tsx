import { Check, Pencil, Trash2 } from 'lucide-react';
import type { ScenarioFrame } from '../../../../shared/scenario';
import { originLabel } from '../../lib/intake';

/** One line on how the scenario came to be, then what the server noted while reading it. */
export function IntakeNotes({
  frame,
  mode,
  model,
  notes,
}: {
  frame: ScenarioFrame;
  mode: 'rules' | 'model' | null;
  model: string | null;
  notes: readonly string[];
}) {
  const label = originLabel(frame, mode);
  return (
    <div className="intake-notes">
      <p className="intake-origin">
        <span className={`intake-chip intake-chip-${frame.origin}`}>{label}</span>
        {frame.origin !== 'user' && mode === 'model' && model && (
          <span className="field-help"> {model}</span>
        )}
      </p>
      {notes.length > 0 && (
        <ul className="intake-plain" aria-label="Notes on how the question was read">
          {notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The scenario that will be used, in brief, with the means to change or drop it. */
export function IntakeSummary({
  frame,
  stale,
  disabled,
  onEdit,
  onRemove,
}: {
  frame: ScenarioFrame;
  /** The question has been changed since it was read. */
  stale: boolean;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const counts = [
    [frame.changes.length, 'change', 'changes'],
    [frame.alternatives.length, 'alternative', 'alternatives'],
    [
      frame.likelyStakeholders.length,
      'group likely to be affected',
      'groups likely to be affected',
    ],
  ] as const;
  return (
    <div className="intake-summary">
      <div className="intake-summary-head">
        <h3 className="intake-title">
          <Check size={16} aria-hidden="true" /> This scenario will be used
        </h3>
        <span className={`intake-chip intake-chip-${frame.origin}`}>
          {originLabel(frame, null)}
        </span>
      </div>
      <p className="intake-decision">{frame.decision}</p>
      <ul className="intake-facts" aria-label="What the scenario holds">
        {frame.system && <li>Affects: {frame.system}</li>}
        {frame.geography && <li>Where: {frame.geography}</li>}
        {frame.horizon && <li>Period: {frame.horizon}</li>}
        {counts.map(([count, one, many]) => (
          <li key={one}>
            {count} {count === 1 ? one : many}
          </li>
        ))}
      </ul>
      {stale && (
        <p className="intake-stale" role="status">
          The question has changed since it was read. Read it again to update the scenario, or edit
          the scenario yourself.
        </p>
      )}
      <div className="intake-actions">
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil size={14} aria-hidden="true" /> Edit the scenario
        </button>
        <button type="button" className="text-button" disabled={disabled} onClick={onRemove}>
          <Trash2 size={14} aria-hidden="true" /> Do not use a scenario
        </button>
      </div>
    </div>
  );
}
