import { Check, ChevronRight, GitMerge, Pencil, Trash2, Undo2 } from 'lucide-react';
import { useId, useState } from 'react';
import { STAKEHOLDER_CATEGORY_LABELS, type Stakeholder } from '../../../../shared/stakeholders';
import { Spinner } from '../ui';
import { OriginBadge, ProvenanceChips, StakeholderChips } from './Chips';
import { EvidenceList } from './EvidenceList';
import { StakeholderForm } from './StakeholderForm';
import type { ReviewHooks } from './focus';
import { IMPACT_LABELS, PRIORITY_LABELS } from './labels';
import {
  applyDraft,
  describedFurther,
  draftOf,
  restoredStatus,
  whyLine,
  type StakeholderDraft,
} from './review';

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
  /** Looks after focus and tells a screen reader what happened, since the control that had focus often goes. */
  hooks: ReviewHooks;
}

/**
 * One stakeholder as a line to scan: its name, role, direction of impact, uncertainty, whether it
 * cites evidence, and in a line why it is listed. Opening it shows the quotes it rests on, what is
 * assumed, and the means to accept, edit, merge, remove or restore it.
 */
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
  hooks,
}: StakeholderRowProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('view');
  const [target, setTarget] = useState('');
  const removed = stakeholder.status === 'removed';
  const impactOrigin = stakeholder.expectedImpact.origin ?? 'system-assumption';
  const toggleKey = `toggle:${stakeholder.id}`;
  const canAccept =
    editable && (stakeholder.status === 'proposed' || stakeholder.status === 'edited');
  const { focus, say } = hooks;
  const back = (button: string): void => focus([`${button}:${stakeholder.id}`, toggleKey]);

  const accept = async (): Promise<void> => {
    if (await onSave({ ...stakeholder, status: 'accepted' })) {
      focus([toggleKey]);
      say(`Accepted ${stakeholder.name}.`);
    }
  };
  const edit = async (draft: StakeholderDraft): Promise<void> => {
    if (await onSave(applyDraft(stakeholder, draft))) {
      setMode('view');
      back('edit');
      say(`Saved changes to ${draft.name.trim()}.`);
    }
  };
  const merge = async (): Promise<void> => {
    if (target && (await onMerge(target))) setMode('view');
  };
  // A new priority moves the row to another place in the list, which would drop focus from the control.
  const prioritise = async (priority: Stakeholder['priority']): Promise<void> => {
    if (await onSave({ ...stakeholder, priority })) {
      focus([`priority:${stakeholder.id}`]);
      say(`${stakeholder.name} is now ${PRIORITY_LABELS[priority].toLowerCase()}.`);
    }
  };
  const restore = async (): Promise<void> => {
    if (mergedInto) {
      await onUndoMerge();
      return;
    }
    if (await onSave({ ...stakeholder, status: restoredStatus(stakeholder) })) {
      focus([toggleKey]);
      say(`Restored ${stakeholder.name}.`);
    }
  };
  const leave = (button: string): void => {
    setMode('view');
    back(button);
  };

  return (
    <li className={`stk-row${removed ? ' stk-row-removed' : ''}`} aria-label={stakeholder.name}>
      <div className="stk-row-head">
        <h5 className="stk-row-title">
          <button
            type="button"
            className="stk-row-toggle"
            aria-expanded={open}
            aria-controls={`${id}-detail`}
            data-stk-focus={toggleKey}
            onClick={() => setOpen((old) => !old)}
          >
            <ChevronRight className="stk-chevron" size={14} aria-hidden="true" />
            <span className="stk-name">{stakeholder.name}</span>
          </button>
        </h5>
        <span className="stk-role">
          {PRIORITY_LABELS[stakeholder.priority]} ·{' '}
          {STAKEHOLDER_CATEGORY_LABELS[stakeholder.category]}
        </span>
        {canAccept && (
          <button
            className="button button-secondary button-small stk-quick"
            type="button"
            disabled={busy}
            onClick={() => void accept()}
          >
            <Check size={14} aria-hidden="true" /> Accept
            <span className="sr-only"> {stakeholder.name}</span>
          </button>
        )}
        {editable && removed && (
          <button
            className="button button-secondary button-small stk-quick"
            type="button"
            disabled={busy}
            onClick={() => void restore()}
          >
            <Undo2 size={14} aria-hidden="true" />{' '}
            {mergedInto ? `Undo the merge of ${stakeholder.name}` : `Restore ${stakeholder.name}`}
          </button>
        )}
      </div>
      <StakeholderChips stakeholder={stakeholder} />
      <p className="stk-why">
        <span className="sr-only">Why it is listed: </span>
        {whyLine(stakeholder)}
      </p>

      <div id={`${id}-detail`} className="stk-detail" hidden={!open}>
        {describedFurther(stakeholder) && (
          <p className="stk-description">{describedFurther(stakeholder)}</p>
        )}
        {stakeholder.relevance && (
          <p className="stk-full-why">
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
        <p className="stk-size">{size(stakeholder)}</p>
        <ProvenanceChips stakeholder={stakeholder} />
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
            Merged from {stakeholder.mergedFrom.length} other stakeholder(s); they stay in the
            record as removed.
          </p>
        )}
        {removed && mergedInto && (
          <p className="stk-merged">Merged into {mergedInto.name}. It stays in the record.</p>
        )}

        {mode === 'edit' && (
          <StakeholderForm
            heading={`Edit ${stakeholder.name}`}
            level={6}
            initial={draftOf(stakeholder)}
            submitLabel="Save changes"
            busy={busy}
            onSubmit={(draft) => void edit(draft)}
            onCancel={() => leave('edit')}
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
                onClick={() => leave('merge')}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {editable && !removed && mode === 'view' && (
          <div className="stk-actions">
            <button
              className="button button-secondary button-small"
              type="button"
              disabled={busy}
              data-stk-focus={`edit:${stakeholder.id}`}
              onClick={() => setMode('edit')}
            >
              <Pencil size={14} aria-hidden="true" /> Edit
              <span className="sr-only"> {stakeholder.name}</span>
            </button>
            <button
              className="button button-secondary button-small"
              type="button"
              disabled={busy || mergeTargets.length === 0}
              data-stk-focus={`merge:${stakeholder.id}`}
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
                data-stk-focus={`priority:${stakeholder.id}`}
                onChange={(event) => void prioritise(event.target.value as Stakeholder['priority'])}
              >
                {(['key', 'standard', 'background'] as const).map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </span>
          </div>
        )}
      </div>
    </li>
  );
}
