import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  STAKEHOLDER_CATEGORIES,
  type ModelAvailability,
  type Stakeholder,
  type StakeholderCategory,
} from '../../../../shared/stakeholders';
import { Notice, Spinner } from '../ui';
import { StakeholderForm } from './StakeholderForm';
import type { ReviewHooks } from './focus';
import { EMPTY_DRAFT, addedStakeholder } from './review';

export type FindMode = 'rules' | 'model';

/** The truth about what is on this page, said in full before anything is shown. */
export function SyntheticNote() {
  return (
    <p className="stk-truth">
      Stakeholders are the groups and roles around a change. The actors made from them are synthetic
      stand-ins, not real people, and every number they carry is a modelling assumption you can
      change. Swarm explores scenarios; it does not predict what real people will do.
    </p>
  );
}

/** The same truth in a line, for where the full note would push the main action away. */
export function SyntheticLine() {
  return (
    <p className="stk-truth-line">
      Actors are synthetic stand-ins, not real people: every number is an assumption you can change.
    </p>
  );
}

/** What each way of finding stakeholders costs and cannot do, said before the person chooses one. */
export function FindExplanation({ model }: { model: ModelAvailability }) {
  return (
    <dl className="stk-how">
      <div>
        <dt>Reading the text for roles</dt>
        <dd>
          No model is used. Swarm looks for role words (customers, administrators, regulators and
          the like), the groups your question names and the people and organisations in your source
          graph, and quotes the sentence for each. It is always available, and it will miss groups
          it has no word for.
        </dd>
      </div>
      <div>
        <dt>Asking the model</dt>
        <dd>
          Sends your source text to the model, which proposes stakeholders with quotes. Swarm checks
          every quote against your sources: one it cannot find is dropped. A stakeholder left
          without a quote is kept, marked inferred, only if your question or scenario names that
          group; otherwise it is dropped. If the model fails, Swarm reads the text for roles instead
          and says so.
          {!model.available && model.reason && (
            <span className="stk-hint"> Not available here: {model.reason}</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/**
 * The ways to start finding stakeholders. With a model the model is the main one, since the project
 * chose to use one; without, reading the text is. The one that sends text to a model says so first.
 */
export function FindButtons({
  model,
  working,
  pendingMode,
  allowed,
  onFind,
  primary = true,
  children,
}: {
  model: ModelAvailability;
  working: boolean;
  pendingMode: FindMode | null;
  allowed: boolean;
  onFind: (mode: FindMode) => void;
  /** Whether the main way is the next thing to do, or only a way to start over. */
  primary?: boolean;
  /** Other ways forward, in the same row. */
  children?: ReactNode;
}) {
  if (!allowed) {
    return (
      <p className="field-help">
        You can read the stakeholders but not run this: it needs the right to run the project.
      </p>
    );
  }
  const rulesMain = primary && !model.available;
  const modelMain = primary && model.available;
  return (
    <>
      <div className="stk-buttons">
        <button
          className={`button ${rulesMain ? 'button-primary' : 'button-secondary'}`}
          type="button"
          disabled={working}
          data-stk-focus={rulesMain ? 'primary' : undefined}
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
            className={`button ${modelMain ? 'button-primary' : 'button-secondary'}`}
            type="button"
            disabled={working}
            data-stk-focus={modelMain ? 'primary' : undefined}
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
        {children}
      </div>
      {working && (
        <p className="inline-pending" role="status">
          {pendingMode === 'model'
            ? 'Asking the model and checking its quotes against your sources. This can take a minute.'
            : 'Reading your evidence for roles.'}
        </p>
      )}
    </>
  );
}

/** How stakeholders can be found, what each costs and cannot do, and the means to start. */
export function FindControls(props: {
  model: ModelAvailability;
  working: boolean;
  pendingMode: FindMode | null;
  allowed: boolean;
  onFind: (mode: FindMode) => void;
}) {
  return (
    <div className="stk-find">
      <FindExplanation model={props.model} />
      <FindButtons {...props} primary={false} />
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
  hooks,
  onOpen,
  onClose,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  taken: readonly string[];
  hooks: ReviewHooks;
  onOpen: () => void;
  onClose: () => void;
  onAdd: (stakeholder: Stakeholder) => Promise<boolean>;
}) {
  const [key, setKey] = useState(0);
  if (!open) {
    return (
      <div className="stk-add">
        <button
          className="button button-secondary button-small"
          type="button"
          data-stk-focus="add"
          onClick={onOpen}
        >
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
        level={5}
        initial={EMPTY_DRAFT}
        submitLabel="Add stakeholder"
        busy={busy}
        onCancel={() => {
          onClose();
          hooks.focus(['add']);
        }}
        onSubmit={(draft) => {
          const added = addedStakeholder(draft, taken);
          void onAdd(added).then((saved) => {
            if (!saved) return;
            setKey((old) => old + 1);
            onClose();
            hooks.focus([`toggle:${added.id}`, 'add']);
            hooks.say(`Added ${added.name}. It carries no evidence: it is your own.`);
          });
        }}
      />
    </div>
  );
}
