import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { Stakeholder, StakeholderSet } from '../../../../shared/stakeholders';
import type { StakeholderState } from '../../hooks/useStakeholders';
import { ToneChip } from '../console/LedgerParts';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { ActorTable } from './ActorTable';
import { ApproveCard } from './ApproveCard';
import {
  AddStakeholder,
  FindControls,
  GapsPrompt,
  SyntheticNote,
  type FindMode,
} from './ReviewParts';
import { StakeholderForm } from './StakeholderForm';
import { StakeholderList } from './StakeholderList';
import { STATUS_LABELS } from './labels';
import {
  EMPTY_DRAFT,
  MAX_STAKEHOLDERS,
  addedStakeholder,
  isReviewed,
  liveStakeholders,
  statusCounts,
} from './review';

const FAILED_MODEL = /could not be used|did not answer in time/u;

function counts(set: StakeholderSet): string {
  const live = liveStakeholders(set.stakeholders);
  const tally = statusCounts(set.stakeholders);
  const parts = (['proposed', 'accepted', 'edited', 'added', 'removed'] as const)
    .filter((status) => tally[status] > 0)
    .map((status) => `${tally[status]} ${STATUS_LABELS[status].toLowerCase()}`);
  const key = live.filter((stakeholder) => stakeholder.priority === 'key').length;
  return `${live.length} stakeholder${live.length === 1 ? '' : 's'} (${key} key). ${parts.join(', ')}.`;
}

/**
 * Finding, reviewing and approving stakeholders, and the actors made from them. It is a view of one
 * `StakeholderState`: it asks for nothing itself, so that a project that never used this feature
 * makes no call that can fail.
 */
export function StakeholderWorkspace({ state }: { state: StakeholderState }) {
  const titleId = useId();
  const [pending, setPending] = useState<FindMode | null>(null);
  const [adding, setAdding] = useState(false);
  const [byHand, setByHand] = useState(false);
  const [replacing, setReplacing] = useState<FindMode | null>(null);
  const { view, actors, loading, error, working, problem } = state;

  const shell = (children: ReactNode) => (
    <section className="stk card" aria-labelledby={titleId}>
      <div className="section-heading">
        <h3 id={titleId}>Stakeholders and actors</h3>
      </div>
      {children}
    </section>
  );

  if (!view) {
    if (error) {
      return shell(
        <Notice
          tone="error"
          title="Stakeholders could not be read"
          action={
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={state.reload}
            >
              Retry
            </button>
          }
        >
          {error}
        </Notice>,
      );
    }
    return shell(
      loading ? (
        <p className="inline-pending" role="status">
          <Spinner label="Loading stakeholders" /> Reading stakeholders…
        </p>
      ) : (
        <EmptyPanel title="No stakeholders to show">
          This project has not been asked for its stakeholders.
        </EmptyPanel>
      ),
    );
  }

  const set = view.stakeholders;
  const busy = working !== null;
  const find = async (mode: FindMode, confirm = false): Promise<void> => {
    setPending(mode);
    setReplacing(null);
    await state.discover(mode, confirm);
    setPending(null);
  };
  const startFind = (mode: FindMode): void => {
    if (set && isReviewed(set)) setReplacing(mode);
    else void find(mode);
  };
  const failure = problem && (
    <Notice
      tone="error"
      title="That did not work"
      action={
        <button
          className="button button-secondary button-small"
          type="button"
          onClick={state.dismissProblem}
        >
          Dismiss
        </button>
      }
    >
      {problem}
    </Notice>
  );

  if (set === null) {
    return shell(
      <>
        <SyntheticNote />
        {failure}
        <FindControls
          model={view.model}
          working={working === 'finding'}
          pendingMode={pending}
          allowed={view.may.run}
          onFind={(mode) => void find(mode)}
        />
        {view.may.edit && (
          <div className="stk-by-hand">
            {byHand ? (
              <StakeholderForm
                heading="Add the first stakeholder yourself"
                initial={EMPTY_DRAFT}
                submitLabel="Add stakeholder"
                busy={busy}
                onCancel={() => setByHand(false)}
                onSubmit={(draft) =>
                  void state.save([addedStakeholder(draft, [])], []).then((saved) => {
                    if (saved) setByHand(false);
                  })
                }
              />
            ) : (
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={() => setByHand(true)}
              >
                Or add stakeholders yourself
              </button>
            )}
          </div>
        )}
      </>,
    );
  }

  const modelFailed = FAILED_MODEL.test(set.discovery.note);
  const canAdd = view.may.edit && set.stakeholders.length < MAX_STAKEHOLDERS;
  return shell(
    <>
      <SyntheticNote />
      {failure}
      <div className="stk-set-head">
        <ToneChip
          tone={set.discovery.mode === 'model' ? 'info' : 'neutral'}
          label={
            set.discovery.mode === 'model'
              ? `Found by a model${set.discovery.model ? ` (${set.discovery.model})` : ''}`
              : set.discovery.mode === 'rules'
                ? 'Found by reading the text, not by a model'
                : 'Built by you'
          }
        />
        <p className="stk-counts">{counts(set)}</p>
      </div>
      {set.discovery.note && (
        <Notice tone={modelFailed ? 'warning' : 'info'} title="How these were found">
          {set.discovery.note}
        </Notice>
      )}
      <GapsPrompt gaps={set.gaps} canAdd={canAdd} onAdd={() => setAdding(true)} />
      <StakeholderList
        stakeholders={set.stakeholders}
        relations={set.relations}
        editable={view.may.edit}
        busy={busy}
        onSave={state.save}
      />
      {canAdd && (
        <AddStakeholder
          open={adding}
          busy={busy}
          taken={set.stakeholders.map((stakeholder) => stakeholder.id)}
          onOpen={() => setAdding(true)}
          onClose={() => setAdding(false)}
          onAdd={(stakeholder: Stakeholder) =>
            state.save([...set.stakeholders, stakeholder], set.relations)
          }
        />
      )}
      {view.may.edit && !canAdd && (
        <p className="field-help">
          The list holds {MAX_STAKEHOLDERS} stakeholders, counting the removed ones, and cannot take
          more.
        </p>
      )}
      {working !== null && (
        <p className="inline-pending" role="status">
          <Spinner label="Working" />{' '}
          {working === 'making-actors'
            ? 'Making the actors…'
            : working === 'approving'
              ? 'Approving the list…'
              : working === 'finding'
                ? 'Finding stakeholders…'
                : 'Saving…'}
        </p>
      )}
      <ApproveCard
        set={set}
        model={view.model}
        canEdit={view.may.edit}
        canRun={view.may.run}
        working={busy}
        hasActors={actors?.actors != null}
        editedActors={actors?.actors?.actors.filter((actor) => actor.edited).length ?? 0}
        onApprove={(options) => void state.approve(options)}
        onMakeActors={(options) => void state.makeActors({ ...options, confirm: false })}
      />
      {actors?.actors && (
        <ActorTable
          key={`${actors.revision}-${actors.actors.generatedAt}`}
          view={actors}
          working={working === 'saving-actors' || working === 'making-actors'}
          canEdit={actors.may.edit}
          canRun={actors.may.run}
          onSave={state.saveActors}
          onMakeAgain={(confirm) => state.makeActors({ model: false, confirm })}
        />
      )}
      {view.may.run && (
        <details className="stk-again">
          <summary>Find stakeholders again</summary>
          {replacing ? (
            <div className="view-stack">
              <p className="field-help">
                This replaces the list you have reviewed, including your changes and the approval.
                The actors already made stay until you make them again.
              </p>
              <div className="stk-buttons">
                <button
                  className="button button-danger button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => void find(replacing, true)}
                >
                  Replace my list
                </button>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => setReplacing(null)}
                >
                  Keep my list
                </button>
              </div>
            </div>
          ) : (
            <FindControls
              model={view.model}
              working={working === 'finding'}
              pendingMode={pending}
              allowed
              onFind={startFind}
            />
          )}
        </details>
      )}
    </>,
  );
}
