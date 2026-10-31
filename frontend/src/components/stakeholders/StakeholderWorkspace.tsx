import { Bot, ChevronRight, TriangleAlert, UserRound, Wand2 } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Stakeholder, StakeholderSet } from '../../../../shared/stakeholders';
import type { StakeholderState } from '../../hooks/useStakeholders';
import { ToneChip } from '../console/LedgerParts';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { ActorTable } from './ActorTable';
import { ApproveCard } from './ApproveCard';
import {
  AddStakeholder,
  FindButtons,
  FindControls,
  FindExplanation,
  GapsPrompt,
  SyntheticLine,
  SyntheticNote,
  type FindMode,
} from './ReviewParts';
import { StakeholderForm } from './StakeholderForm';
import { StakeholderList } from './StakeholderList';
import { NextButton, SummaryStats } from './SummaryStrip';
import { useAnnouncer, useFocusRequest, type ReviewHooks } from './focus';
import { STATUS_LABELS } from './labels';
import {
  EMPTY_DRAFT,
  MAX_STAKEHOLDERS,
  addedStakeholder,
  isReviewed,
  liveStakeholders,
  nextAction,
  orderForReview,
  statusCounts,
  summarise,
  type NextActionId,
  type StakeholderDraft,
} from './review';

const FAILED_MODEL = /could not be used|did not answer in time/u;

type Region = 'stakeholders' | 'actors' | 'how';

function counts(set: StakeholderSet): string {
  const live = liveStakeholders(set.stakeholders);
  const tally = statusCounts(set.stakeholders);
  const parts = (['proposed', 'accepted', 'edited', 'added', 'removed'] as const)
    .filter((status) => tally[status] > 0)
    .map((status) => `${tally[status]} ${STATUS_LABELS[status].toLowerCase()}`);
  const key = live.filter((stakeholder) => stakeholder.priority === 'key').length;
  return `${live.length} stakeholder${live.length === 1 ? '' : 's'} (${key} key). ${parts.join(', ')}.`;
}

/** A button that opens and closes a part of the panel that would otherwise push the page's own action away. */
function RegionToggle({
  open,
  controls,
  focusKey,
  onToggle,
  children,
}: {
  open: boolean;
  controls: string;
  focusKey: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="stk-toggle"
      aria-expanded={open}
      aria-controls={controls}
      data-stk-focus={focusKey}
      onClick={onToggle}
    >
      <ChevronRight className="stk-chevron" size={14} aria-hidden="true" /> {children}
    </button>
  );
}

const WORKING_WORDS = {
  finding: 'Finding stakeholders…',
  approving: 'Approving the list…',
  'making-actors': 'Making the actors…',
  saving: 'Saving…',
  'saving-actors': 'Saving…',
} as const;

/**
 * Finding, reviewing and approving stakeholders, and the actors made from them. It is a view of one
 * `StakeholderState`: it asks for nothing itself, so that a project that never used this feature
 * makes no call that can fail.
 *
 * The panel is small until the person opens it: a title with four counts, the one thing to do next,
 * and two buttons that open the list and the actors. The list and the actors are where the work is
 * done, and they are not in the way of the stage's own action while they are shut. Whatever the
 * person does takes away the control they used, so each change says what happened to a screen reader
 * and puts focus on the next place to be.
 */
export function StakeholderWorkspace({ state }: { state: StakeholderState }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const focus = useFocusRequest(panel);
  const [announcement, say] = useAnnouncer();
  const hooks = useMemo<ReviewHooks>(() => ({ focus, say }), [focus, say]);
  const [pending, setPending] = useState<FindMode | null>(null);
  const [adding, setAdding] = useState(false);
  const [byHand, setByHand] = useState(false);
  const [replacing, setReplacing] = useState<FindMode | null>(null);
  const [open, setOpen] = useState<Record<Region, boolean>>({
    stakeholders: false,
    actors: false,
    how: false,
  });
  const { view, actors, loading, error, working, problem } = state;
  const ids = {
    title: `${id}-title`,
    stakeholders: `${id}-stakeholders`,
    actors: `${id}-actors`,
    how: `${id}-how`,
  };
  const reveal = (region: Region): void => setOpen((old) => ({ ...old, [region]: true }));
  const toggle = (region: Region): void => setOpen((old) => ({ ...old, [region]: !old[region] }));

  const shell = (children: ReactNode, aside?: ReactNode) => (
    <section ref={panel} className="stk card" aria-labelledby={ids.title}>
      <div className="stk-header">
        <h3 id={ids.title}>Stakeholders and actors</h3>
        {aside}
      </div>
      {children}
      <p className="sr-only" role="status">
        {announcement}
      </p>
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
    const found = await state.discover(mode, confirm);
    setPending(null);
    if (found) {
      reveal('stakeholders');
      focus(['region:stakeholders']);
      say('Stakeholders found. The list is open below.');
    }
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
    const addFirst = (draft: StakeholderDraft): void => {
      const first = addedStakeholder(draft, []);
      void state.save([first], []).then((saved) => {
        if (!saved) return;
        setByHand(false);
        reveal('stakeholders');
        focus([`toggle:${first.id}`, 'region:stakeholders']);
        say(`Added ${first.name}. It carries no evidence: it is your own.`);
      });
    };
    return shell(
      <>
        <SyntheticLine />
        {failure}
        <FindButtons
          model={view.model}
          working={working === 'finding'}
          pendingMode={pending}
          allowed={view.may.run}
          onFind={(mode) => void find(mode)}
        >
          {view.may.edit && !byHand && (
            <button
              className="button button-secondary"
              type="button"
              data-stk-focus="by-hand"
              onClick={() => setByHand(true)}
            >
              Or add stakeholders yourself
            </button>
          )}
        </FindButtons>
        {view.may.edit && byHand && (
          <div className="stk-by-hand">
            <StakeholderForm
              heading="Add the first stakeholder yourself"
              initial={EMPTY_DRAFT}
              submitLabel="Add stakeholder"
              busy={busy}
              onCancel={() => {
                setByHand(false);
                focus(['by-hand']);
              }}
              onSubmit={addFirst}
            />
          </div>
        )}
        <section id={ids.how} className="stk-region" hidden={!open.how}>
          <FindExplanation model={view.model} />
          <SyntheticNote />
        </section>
      </>,
      <RegionToggle
        open={open.how}
        controls={ids.how}
        focusKey="toggle-how"
        onToggle={() => toggle('how')}
      >
        How stakeholders are found
      </RegionToggle>,
    );
  }

  const made = actors?.actors?.actors;
  const summary = summarise(set, made);
  const editedActors = made?.filter((actor) => actor.edited).length ?? 0;
  const action = nextAction({ set, actors: made, may: view.may, editedActors });
  const modelFailed = FAILED_MODEL.test(set.discovery.note);
  const canAdd = view.may.edit && set.stakeholders.length < MAX_STAKEHOLDERS;
  const firstToReview = orderForReview(set.stakeholders).find(
    (stakeholder) => stakeholder.status === 'proposed',
  );

  const approve = async (options: { model: boolean }): Promise<void> => {
    if (await state.approve(options)) {
      setOpen((old) => ({ ...old, stakeholders: false }));
      focus(['primary']);
      say(
        editedActors > 0
          ? 'Approved. The actors you changed were kept as they are.'
          : 'Approved. The actors were made from the approved stakeholders.',
      );
    }
  };
  const makeActors = async (options: { model: boolean }): Promise<void> => {
    if (await state.makeActors({ ...options, confirm: false })) {
      setOpen((old) => ({ ...old, stakeholders: false }));
      focus(['primary']);
      say('The actors were made from the approved stakeholders.');
    }
  };
  /** A project with a model asks first, in the approval card, whether the model may read the key actors. */
  const act = (next: NextActionId): void => {
    switch (next) {
      case 'review':
        reveal('stakeholders');
        focus([
          firstToReview ? `toggle:${firstToReview.id}` : 'region:stakeholders',
          'region:stakeholders',
        ]);
        break;
      case 'add':
        reveal('stakeholders');
        setAdding(true);
        break;
      case 'approve':
        if (view.model.available) {
          reveal('stakeholders');
          focus(['approve']);
        } else void approve({ model: false });
        break;
      case 'make-actors':
        if (view.model.available) {
          reveal('stakeholders');
          focus(['make-actors']);
        } else void makeActors({ model: false });
        break;
      case 'review-actors':
        reveal('actors');
        focus(['region:actors']);
        break;
    }
  };

  return shell(
    <>
      <div className="stk-controls">
        {action && <NextButton action={action} working={busy} onAction={act} />}
        <RegionToggle
          open={open.stakeholders}
          controls={ids.stakeholders}
          focusKey="toggle-stakeholders"
          onToggle={() => toggle('stakeholders')}
        >
          Stakeholders <span className="stk-count">{summary.found}</span>
        </RegionToggle>
        {actors?.actors && (
          <RegionToggle
            open={open.actors}
            controls={ids.actors}
            focusKey="toggle-actors"
            onToggle={() => toggle('actors')}
          >
            Actors <span className="stk-count">{summary.actors}</span>
          </RegionToggle>
        )}
      </div>
      {working !== null && (
        <p className="inline-pending" role="status">
          <Spinner label="Working" /> {WORKING_WORDS[working]}
        </p>
      )}
      {failure}
      {modelFailed && (
        <Notice tone="warning" title="How these were found">
          {set.discovery.note}
        </Notice>
      )}
      {actors?.stale && (
        <p className="stk-warn">
          <TriangleAlert size={14} aria-hidden="true" /> The actors are out of date: the
          stakeholders changed after they were made.
        </p>
      )}

      <section id={ids.stakeholders} className="stk-region" hidden={!open.stakeholders}>
        <div className="stk-set-head">
          <h4 tabIndex={-1} data-stk-focus="region:stakeholders">
            Stakeholders ({summary.found})
          </h4>
          <ToneChip
            tone={set.discovery.mode === 'model' ? 'info' : 'neutral'}
            icon={
              set.discovery.mode === 'model'
                ? Bot
                : set.discovery.mode === 'rules'
                  ? Wand2
                  : UserRound
            }
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
        <StakeholderList
          stakeholders={set.stakeholders}
          relations={set.relations}
          editable={view.may.edit}
          busy={busy}
          onSave={state.save}
          hooks={hooks}
        />
        {canAdd && (
          <AddStakeholder
            open={adding}
            busy={busy}
            hooks={hooks}
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
            The list holds {MAX_STAKEHOLDERS} stakeholders, counting the removed ones, and cannot
            take more.
          </p>
        )}
        <GapsPrompt gaps={set.gaps} canAdd={canAdd} onAdd={() => setAdding(true)} />
        {set.discovery.note && !modelFailed && (
          <Notice tone="info" title="How these were found">
            {set.discovery.note}
          </Notice>
        )}
        <SyntheticNote />
        <ApproveCard
          set={set}
          model={view.model}
          canEdit={view.may.edit}
          canRun={view.may.run}
          working={busy}
          hasActors={made !== undefined}
          editedActors={editedActors}
          onApprove={(options) => void approve(options)}
          onMakeActors={(options) => void makeActors(options)}
        />
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
      </section>

      {actors?.actors && (
        <div id={ids.actors} className="stk-region" hidden={!open.actors}>
          <ActorTable
            key={`${actors.revision}-${actors.actors.generatedAt}`}
            view={actors}
            working={working === 'saving-actors' || working === 'making-actors'}
            canEdit={actors.may.edit}
            canRun={actors.may.run}
            hooks={hooks}
            onSave={state.saveActors}
            onMakeAgain={(confirm) => state.makeActors({ model: false, confirm })}
          />
        </div>
      )}
    </>,
    <SummaryStats summary={summary} />,
  );
}
