import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  STAKEHOLDER_CATEGORIES,
  type ModelAvailability,
  type Stakeholder,
  type StakeholderCategory,
} from '../../../../shared/stakeholders';
import { Notice, Spinner } from '../ui';
import { StakeholderForm } from './StakeholderForm';
import { EMPTY_DRAFT, addedStakeholder } from './review';

export type FindMode = 'rules' | 'model';

/** The truth about what is on this page, said before anything is shown. */
export function SyntheticNote() {
  return (
    <p className="stk-truth">
      Stakeholders are the groups and roles around a change. The actors made from them are synthetic
      stand-ins, not real people, and every number they carry is a modelling assumption you can
      change. Swarm explores scenarios; it does not predict what real people will do.
    </p>
  );
}

/** How stakeholders can be found, what each costs and what each cannot do, and the means to start. */
export function FindControls({
  model,
  working,
  pendingMode,
  allowed,
  heading,
  onFind,
}: {
  model: ModelAvailability;
  working: boolean;
  pendingMode: FindMode | null;
  allowed: boolean;
  heading?: string;
  onFind: (mode: FindMode) => void;
}) {
  return (
    <div className="stk-find">
      {heading && <h4>{heading}</h4>}
      <dl className="stk-how">
        <div>
          <dt>Reading the text for roles</dt>
          <dd>
            No model is used. Swarm looks for role words (customers, administrators, regulators and
            the like), the groups your question names and the people and organisations in your
            source graph, and quotes the sentence for each. It is always available, and it will miss
            groups it has no word for.
          </dd>
        </div>
        <div>
          <dt>Asking the model</dt>
          <dd>
            Sends your source text to the model, which proposes stakeholders with quotes. Swarm
            checks every quote against your sources: one it cannot find is dropped, and a
            stakeholder left without a quote is marked inferred. If the model fails, Swarm reads the
            text for roles instead and says so.
            {!model.available && model.reason && (
              <span className="stk-hint"> Not available here: {model.reason}</span>
            )}
          </dd>
        </div>
      </dl>
      {allowed ? (
        <div className="stk-buttons">
          <button
            className={`button ${model.available ? 'button-secondary' : 'button-primary'}`}
            type="button"
            disabled={working}
            onClick={() => onFind('rules')}
          >
            {working && pendingMode === 'rules' ? (
              <Spinner label="Reading your evidence" />
            ) : (
              <Search size={16} aria-hidden="true" />
            )}{' '}
            Find stakeholders by reading the text
          </button>
          {model.available && (
            <button
              className="button button-primary"
              type="button"
              disabled={working}
              onClick={() => onFind('model')}
            >
              {working && pendingMode === 'model' ? (
                <Spinner label="Asking the model" />
              ) : (
                <Search size={16} aria-hidden="true" />
              )}{' '}
              Find stakeholders with the model
            </button>
          )}
        </div>
      ) : (
        <p className="field-help">
          You can read the stakeholders but not run this: it needs the right to run the project.
        </p>
      )}
      {working && (
        <p className="inline-pending" role="status">
          {pendingMode === 'model'
            ? 'Asking the model and checking its quotes against your sources. This can take a minute.'
            : 'Reading your evidence for roles.'}
        </p>
      )}
    </div>
  );
}

/** Categories nothing was found for, as a prompt to look, not as an error. */
export function GapsPrompt({
  gaps,
  canAdd,
  onAdd,
}: {
  gaps: readonly string[];
  canAdd: boolean;
  onAdd: () => void;
}) {
  if (gaps.length === 0) return null;
  const labels = gaps.map((gap) =>
    (STAKEHOLDER_CATEGORIES as readonly string[]).includes(gap)
      ? STAKEHOLDER_CATEGORY_LABELS[gap as StakeholderCategory].toLowerCase()
      : gap,
  );
  return (
    <Notice
      tone="info"
      title="Perspectives that may be missing"
      action={
        canAdd ? (
          <button className="button button-secondary button-small" type="button" onClick={onAdd}>
            Add a stakeholder
          </button>
        ) : undefined
      }
    >
      Nobody was found for: {labels.join(', ')}. These are prompts, not errors: add a stakeholder if
      one of them matters for this change.
    </Notice>
  );
}

/** A form for a stakeholder the person adds themselves, which is theirs and carries no evidence. */
export function AddStakeholder({
  open,
  busy,
  taken,
  onOpen,
  onClose,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  taken: readonly string[];
  onOpen: () => void;
  onClose: () => void;
  onAdd: (stakeholder: Stakeholder) => Promise<boolean>;
}) {
  const [key, setKey] = useState(0);
  if (!open) {
    return (
      <div className="stk-add">
        <button className="button button-secondary button-small" type="button" onClick={onOpen}>
          <Plus size={14} aria-hidden="true" /> Add a stakeholder
        </button>
      </div>
    );
  }
  return (
    <div className="stk-add">
      <StakeholderForm
        key={key}
        heading="Add a stakeholder"
        initial={EMPTY_DRAFT}
        submitLabel="Add stakeholder"
        busy={busy}
        onCancel={onClose}
        onSubmit={(draft) => {
          void onAdd(addedStakeholder(draft, taken)).then((added) => {
            if (added) {
              setKey((old) => old + 1);
              onClose();
            }
          });
        }}
      />
    </div>
  );
}
