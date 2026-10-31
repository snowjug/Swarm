import { Check, GitMerge, Pencil, Trash2, Undo2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { Stakeholder } from '../../../../shared/stakeholders';
import { Spinner } from '../ui';
import { OriginBadge, StakeholderChips } from './Chips';
import { EvidenceList } from './EvidenceList';
import { StakeholderForm } from './StakeholderForm';
import { IMPACT_LABELS, PRIORITY_LABELS } from './labels';
import { applyDraft, draftOf, restoredStatus, type StakeholderDraft } from './review';

type Mode = 'view' | 'edit' | 'merge';

const NO_EVIDENCE: Record<Stakeholder['origin'], string> = {
  rules: 'No quote was kept for this stakeholder.',
  scenario: 'Named in your question. No passage of your sources mentions this group.',
  model: 'Inferred by the model: it could not quote a passage that supports this stakeholder.',
  user: 'Added by you. Evidence comes from your sources, so none is attached.',
};

function size(stakeholder: Stakeholder): string {
  return stakeholder.priority === 'key'
    ? 'Modelled as one actor'
    : `Stands for about ${stakeholder.populationSize.toLocaleString('en-GB')} (a modelling assumption, not a count)`;
}

export interface StakeholderRowProps {
  stakeholder: Stakeholder;
  /** The stakeholders this one could be merged into: those not removed, and not itself. */
  mergeTargets: readonly Stakeholder[];
  /** The stakeholder this one was merged into, if it was. */
  mergedInto: Stakeholder | null;
  editable: boolean;
  busy: boolean;
  onSave: (next: Stakeholder) => Promise<boolean>;
  onMerge: (targetId: string) => Promise<boolean>;
  onUndoMerge: () => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}

/** One stakeholder with what is known about it, and the means to accept, edit, merge, remove or restore it. */
export function StakeholderRow({
  stakeholder,
  mergeTargets,
  mergedInto,
  editable,
  busy,
  onSave,
  onMerge,
  onUndoMerge,
  onRemove,
}: StakeholderRowProps) {
  const id = useId();
  const [mode, setMode] = useState<Mode>('view');
  const [target, setTarget] = useState('');
  const removed = stakeholder.status === 'removed';
  const impactOrigin = stakeholder.expectedImpact.origin ?? 'system-assumption';

  const edit = async (draft: StakeholderDraft): Promise<void> => {
    if (await onSave(applyDraft(stakeholder, draft))) setMode('view');
  };
  const merge = async (): Promise<void> => {
    if (target && (await onMerge(target))) setMode('view');
  };

  return (
    <li className={`stk-row${removed ? ' stk-row-removed' : ''}`} aria-label={stakeholder.name}>
      <div className="stk-row-head">
        <h5 className="stk-name">{stakeholder.name}</h5>
        <span className="stk-size">{size(stakeholder)}</span>
      </div>
      <StakeholderChips stakeholder={stakeholder} />
      {stakeholder.description && <p className="stk-description">{stakeholder.description}</p>}
      {stakeholder.relevance && (
        <p className="stk-why">
          <strong>Why it matters:</strong> {stakeholder.relevance}
        </p>
      )}
      <p className="stk-impact">
        <strong>Expected impact:</strong> {IMPACT_LABELS[stakeholder.expectedImpact.direction]}{' '}
        <OriginBadge origin={impactOrigin} /> {stakeholder.expectedImpact.rationale}
      </p>
      <p className="stk-reason">
        <strong>Uncertainty:</strong> {stakeholder.uncertainty.reason || 'No reason was given.'}
      </p>
      <EvidenceList evidence={stakeholder.evidence} empty={NO_EVIDENCE[stakeholder.origin]} />
      {stakeholder.assumptions.length > 0 && (
        <details className="stk-assumptions">
          <summary>Assumptions ({stakeholder.assumptions.length})</summary>
          <ul>
            {stakeholder.assumptions.map((assumption, index) => (
              <li key={index}>{assumption}</li>
            ))}
          </ul>
        </details>
      )}
      {stakeholder.mergedFrom.length > 0 && (
        <p className="stk-merged">
          Merged from {stakeholder.mergedFrom.length} other stakeholder(s); they stay in the record
          as removed.
        </p>
      )}
      {removed && mergedInto && (
        <p className="stk-merged">Merged into {mergedInto.name}. It stays in the record.</p>
      )}

      {mode === 'edit' && (
        <StakeholderForm
          heading={`Edit ${stakeholder.name}`}
          initial={draftOf(stakeholder)}
          submitLabel="Save changes"
          busy={busy}
          onSubmit={(draft) => void edit(draft)}
          onCancel={() => setMode('view')}
        />
      )}
      {mode === 'merge' && (
        <div className="stk-merge view-stack">
          <label htmlFor={`${id}-into`}>Merge {stakeholder.name} into</label>
          <select
            id={`${id}-into`}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">Choose a stakeholder…</option>
            {mergeTargets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <p className="field-help">
            {stakeholder.name} is marked removed and stays in the record. The one you choose takes
            its evidence.
          </p>
          <div className="stk-form-actions">
            <button
              className="button button-primary button-small"
              type="button"
              disabled={!target || busy}
              onClick={() => void merge()}
            >
              {busy && <Spinner label="Merging" />} Merge
            </button>
            <button
              className="button button-secondary button-small"
              type="button"
              disabled={busy}
              onClick={() => setMode('view')}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editable && mode === 'view' && (
        <div className="stk-actions">
          {removed ? (
            mergedInto ? (
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={busy}
                onClick={() => void onUndoMerge()}
              >
                <Undo2 size={14} aria-hidden="true" /> Undo the merge of {stakeholder.name}
              </button>
            ) : (
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={busy}
                onClick={() => void onSave({ ...stakeholder, status: restoredStatus(stakeholder) })}
              >
                <Undo2 size={14} aria-hidden="true" /> Restore {stakeholder.name}
              </button>
            )
          ) : (
            <>
              {(stakeholder.status === 'proposed' || stakeholder.status === 'edited') && (
                <button
                  className="button button-secondary button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => void onSave({ ...stakeholder, status: 'accepted' })}
                >
                  <Check size={14} aria-hidden="true" /> Accept
                  <span className="sr-only"> {stakeholder.name}</span>
                </button>
              )}
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={busy}
                onClick={() => setMode('edit')}
              >
                <Pencil size={14} aria-hidden="true" /> Edit
                <span className="sr-only"> {stakeholder.name}</span>
              </button>
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={busy || mergeTargets.length === 0}
                onClick={() => setMode('merge')}
              >
                <GitMerge size={14} aria-hidden="true" /> Merge
                <span className="sr-only"> {stakeholder.name}</span>
              </button>
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={busy}
                onClick={() => void onRemove()}
              >
                <Trash2 size={14} aria-hidden="true" /> Remove
                <span className="sr-only"> {stakeholder.name}</span>
              </button>
              <span className="stk-priority">
                <label htmlFor={`${id}-priority`}>Priority</label>
                <select
                  id={`${id}-priority`}
                  value={stakeholder.priority}
                  disabled={busy}
                  onChange={(event) =>
                    void onSave({
                      ...stakeholder,
                      priority: event.target.value as Stakeholder['priority'],
                    })
                  }
                >
                  {(['key', 'standard', 'background'] as const).map((value) => (
                    <option key={value} value={value}>
                      {PRIORITY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </span>
            </>
          )}
        </div>
      )}
    </li>
  );
}
