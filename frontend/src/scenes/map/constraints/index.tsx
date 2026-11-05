import { useEffect, useMemo, useRef, useState } from 'react';
import { List, Network, Plus, ShieldAlert, Wand2, Bot } from 'lucide-react';
import {
  type Clarification,
  type Constraint,
  type ConstraintsView,
} from '../../../../../shared/constraints';
import { useWorkspace } from '../../../app/context';
import {
  Button,
  Disclosure,
  EmptyState,
  Notice,
  Segmented,
  SkeletonText,
} from '../../../design/ui';
import type { ReviewAction } from '../../../api/constraints';
import { CONSTRAINTS_FALLBACK_LABEL, withoutRulesUsed } from '../../../../../shared/model-failure';
import { ConstraintRow, type Names } from './ConstraintRow';
import { Editor } from './Editor';
import { Gate } from './Gate';
import { Questions } from './Questions';
import { Views } from './Views';
import {
  draftOfConstraint,
  hasChanges,
  inputOfDraft,
  patchOfDraft,
  sectionsOf,
  type EditorDraft,
  type ReviewChoice,
} from './model';
import type { MapView } from '../Toolbar';
import { useConstraints, type ConstraintsState } from './useConstraints';
import './constraints.css';

type Editing = { mode: 'add' } | { mode: 'edit'; constraint: Constraint } | null;

const TRUTH =
  'An inferred constraint is a suggestion until you confirm it. The simulation applies only the constraints it can express, and lists the others as read, not modelled. Simulated results are not forecasts.';

export interface ConstraintsPageProps {
  state: ConstraintsState;
  onView: (view: MapView) => void;
  onSimulate: () => void;
}

function ViewSwitch({ onView }: { onView: (view: MapView) => void }) {
  return (
    <Segmented<MapView>
      size="sm"
      label="Show as"
      value="constraints"
      onChange={onView}
      options={[
        {
          value: 'map',
          label: <span className="sw-cons__vlabel">Map</span>,
          icon: <Network size={15} aria-hidden="true" />,
        },
        {
          value: 'list',
          label: <span className="sw-cons__vlabel">List</span>,
          icon: <List size={15} aria-hidden="true" />,
        },
        {
          value: 'constraints',
          label: <span className="sw-cons__vlabel">Constraints</span>,
          icon: <ShieldAlert size={15} aria-hidden="true" />,
        },
      ]}
    />
  );
}

function namesOfView(view: ConstraintsView): Names {
  return {
    actors: new Map(view.actors.map((actor) => [actor.id, actor.name])),
    alternatives: new Map(view.alternatives.map((option) => [option.id, option.label])),
    constraints: new Map(view.constraints?.constraints.map((item) => [item.id, item]) ?? []),
  };
}

/** The action a choice on one constraint stands for. `edit` opens the editor and is not one. */
function actionOf(choice: Exclude<ReviewChoice, 'edit'>, constraint: Constraint): ReviewAction {
  return choice === 'accept'
    ? { action: 'accept', ids: [constraint.id] }
    : { action: choice, id: constraint.id };
}

function Start({
  view,
  state,
  onAdd,
}: {
  view: ConstraintsView;
  state: ConstraintsState;
  onAdd: () => void;
}) {
  const { may, model } = view;
  const working = state.working === 'proposing';
  return (
    <section className="sw-cons__start" aria-label="Start with the constraints">
      <EmptyState
        level={2}
        icon={<ShieldAlert size={22} aria-hidden="true" />}
        title="No constraints have been read yet"
      >
        Swarm reads your question, your scenario, your sources and who is involved for the limits on
        this decision. You review each one before any simulation uses it. Until you do, simulations
        run without any.
      </EmptyState>
      <div className="sw-cons__start-actions">
        {may.run && model.available && (
          <Button
            variant="primary"
            icon={<Bot size={16} aria-hidden="true" />}
            busy={working}
            busyLabel="Reading"
            disabled={state.working !== null}
            onClick={() => void state.propose('model')}
          >
            Ask the model to read them
          </Button>
        )}
        {may.run && (
          <Button
            variant={model.available ? 'glass' : 'primary'}
            icon={<Wand2 size={16} aria-hidden="true" />}
            busy={working && !model.available}
            busyLabel="Reading"
            disabled={state.working !== null}
            onClick={() => void state.propose('rules')}
          >
            Read my sources for constraints
          </Button>
        )}
        {may.edit && (
          <Button
            variant="ghost"
            icon={<Plus size={16} aria-hidden="true" />}
            disabled={state.working !== null}
            onClick={onAdd}
          >
            Add one yourself
          </Button>
        )}
      </div>
      {may.run && !model.available && model.reason && <p className="sw-caption">{model.reason}</p>}
      {!may.run && !may.edit && (
        <Notice tone="info">
          You can read the constraints here. Reading the sources for them, or adding one, needs more
          access to this project.
        </Notice>
      )}
    </section>
  );
}

function Section({
  id,
  title,
  note,
  items,
  names,
  canEdit,
  busy,
  onChoose,
}: {
  id: string;
  title: string;
  note: string;
  items: readonly Constraint[];
  names: Names;
  canEdit: boolean;
  busy: boolean;
  onChoose: (choice: ReviewChoice, constraint: Constraint) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="sw-cons__section" aria-labelledby={id}>
      <h2 id={id} className="sw-title">
        {title} <span className="sw-cons__count">{items.length}</span>
      </h2>
      <p className="sw-caption">{note}</p>
      <ul className="sw-cons__list">
        {items.map((constraint) => (
          <ConstraintRow
            key={constraint.id}
            constraint={constraint}
            names={names}
            canEdit={canEdit}
            busy={busy}
            onChoose={onChoose}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * What limits the decision, as a page to read from the top: whether a simulation may start and with what
 * label, what Swarm still has to ask, then each constraint by how hard it is, with where it came from and
 * whether the simulation runs under it. It reads the state it is given and makes no request itself.
 */
export function ConstraintsPage({ state, onView, onSimulate }: ConstraintsPageProps) {
  const { view, loading, error, working, problem } = state;
  const title = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);

  const set = view?.constraints ?? null;
  const names = useMemo(() => (view ? namesOfView(view) : null), [view]);
  const sections = useMemo(() => (set ? sectionsOf(set) : null), [set]);
  const draft = useMemo<EditorDraft>(
    () =>
      editing?.mode === 'edit'
        ? draftOfConstraint(editing.constraint)
        : draftOfConstraint(undefined, 'budget'),
    [editing],
  );

  const choose = async (choice: ReviewChoice, constraint: Constraint): Promise<void> => {
    if (choice === 'edit') {
      setEditing({ mode: 'edit', constraint });
      return;
    }
    await state.review(actionOf(choice, constraint));
  };
  const ask = (action: ReviewAction): void => void state.review(action);
  const respond = (
    question: Clarification,
    action: 'mark-unknown' | 'use-assumption' | 'exclude',
  ) => ask({ action, clarificationId: question.id });

  const submit = async (next: EditorDraft): Promise<void> => {
    if (!editing) return;
    if (editing.mode === 'add') {
      if (await state.review({ action: 'add', constraint: inputOfDraft(next) })) setEditing(null);
      return;
    }
    const patch = patchOfDraft(next, editing.constraint);
    if (!hasChanges(patch)) {
      setEditing(null);
      return;
    }
    if (await state.review({ action: 'edit', id: editing.constraint.id, patch })) setEditing(null);
  };

  const canEdit = view?.may.edit ?? false;
  const busy = working !== null;
  const body = (() => {
    if (!view && loading) {
      return (
        <div role="status" aria-label="Reading the constraints">
          <SkeletonText lines={4} />
        </div>
      );
    }
    if (!view) {
      return (
        <Notice
          tone="error"
          title="The constraints could not be read"
          action={
            <Button size="sm" variant="glass" onClick={state.reload}>
              Try again
            </Button>
          }
        >
          {error}
        </Notice>
      );
    }
    if (!set || !sections || !names) {
      return <Start view={view} state={state} onAdd={() => setEditing({ mode: 'add' })} />;
    }
    const waiting = set.constraints.filter((item) => item.review === 'proposed');
    return (
      <>
        {set.modelFailure && (
          <Notice
            tone="caution"
            title={CONSTRAINTS_FALLBACK_LABEL}
            action={
              view.may.run && view.model.available ? (
                <Button
                  size="sm"
                  variant="glass"
                  icon={<Bot size={14} aria-hidden="true" />}
                  disabled={busy}
                  onClick={() => void state.propose('model')}
                >
                  Ask the model again
                </Button>
              ) : undefined
            }
          >
            {withoutRulesUsed(set.modelFailure.detail)} Rules read these constraints instead, so no
            model proposed them.
          </Notice>
        )}{' '}
        {view.gate && (
          <Gate
            gate={view.gate}
            constraints={set.constraints}
            stale={view.stale}
            canEdit={canEdit}
            canRun={view.may.run}
            working={working === 'reviewing' || working === 'measuring'}
            sensitivity={state.sensitivity}
            onAcceptAll={() => ask({ action: 'accept', ids: waiting.map((item) => item.id) })}
            onConfirmSet={() => ask({ action: 'confirm-set' })}
            onMeasure={() => void state.measure()}
            onSimulate={onSimulate}
          />
        )}
        <Questions
          open={view.open}
          totalOpen={set.clarifications.filter((question) => question.status === 'open').length}
          canEdit={canEdit}
          working={busy}
          onAnswer={(question, constraint) =>
            ask({ action: 'answer', clarificationId: question.id, constraint })
          }
          onUnknown={(question) => respond(question, 'mark-unknown')}
          onAssume={(question) => respond(question, 'use-assumption')}
          onExclude={(question) => respond(question, 'exclude')}
        />
        <Section
          id="hard-title"
          title="Hard limits"
          note="A rule, a ceiling or a requirement. A hard limit that nobody has settled can stop a simulation."
          items={sections.hard}
          names={names}
          canEdit={canEdit}
          busy={busy}
          onChoose={(choice, constraint) => void choose(choice, constraint)}
        />
        <Section
          id="soft-title"
          title="Soft limits"
          note="A pressure, a preference or a dependence. It weighs on the result without ruling anything out."
          items={sections.soft}
          names={names}
          canEdit={canEdit}
          busy={busy}
          onChoose={(choice, constraint) => void choose(choice, constraint)}
        />
        {set.constraints.length > 0 && sections.hard.length + sections.soft.length === 0 && (
          <p className="sw-caption">Every constraint has been set aside.</p>
        )}
        {sections.setAside.length > 0 && (
          <Disclosure summary={`Set aside (${sections.setAside.length})`}>
            <ul className="sw-cons__list">
              {sections.setAside.map((constraint) => (
                <ConstraintRow
                  key={constraint.id}
                  constraint={constraint}
                  names={names}
                  canEdit={canEdit}
                  busy={busy}
                  onChoose={(choice, item) => void choose(choice, item)}
                />
              ))}
            </ul>
          </Disclosure>
        )}
        <div className="sw-cons__more">
          {view.may.run && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={<Wand2 size={14} aria-hidden="true" />}
                busy={working === 'proposing'}
                busyLabel="Reading"
                disabled={busy}
                onClick={() => void state.propose('rules')}
              >
                Read my sources again
              </Button>
              {view.model.available && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Bot size={14} aria-hidden="true" />}
                  disabled={busy}
                  onClick={() => void state.propose('model')}
                >
                  Ask the model to read them again
                </Button>
              )}
            </>
          )}
          {canEdit && (
            <Button
              variant="glass"
              size="sm"
              icon={<Plus size={14} aria-hidden="true" />}
              disabled={busy}
              onClick={() => setEditing({ mode: 'add' })}
            >
              Add a constraint
            </Button>
          )}
        </div>
        {set.note && (
          <Disclosure summary="How these were found">
            <p className="sw-read">{set.note}</p>
          </Disclosure>
        )}
        <Views
          views={state.counterfactuals}
          ready={view.actors.length > 0 && set.constraints.length > 0}
          canRun={view.may.run}
          working={working === 'viewing'}
          onRun={() => void state.runViews()}
        />
      </>
    );
  })();

  return (
    <div className="sw-cons" aria-labelledby="cons-title" role="region" data-busy={busy}>
      <header className="sw-cons__head">
        <ViewSwitch onView={onView} />
        <h1 id="cons-title" ref={title} className="sw-display sw-cons__title" tabIndex={-1}>
          What <em>limits</em> the decision
        </h1>
        <p className="sw-read sw-cons__lede">
          The limits on this decision: money, time, rules, capacity, who has to agree. Swarm reads
          them from your words and your sources, and you decide which of them hold.
        </p>
      </header>
      <div className="sw-cons__status" role="status" aria-live="polite">
        {working === 'proposing' && 'Reading your sources for constraints…'}
        {working === 'reviewing' && 'Saving…'}
      </div>
      {problem && (
        <Notice
          tone="error"
          title="That was not saved"
          action={
            <Button size="sm" variant="ghost" onClick={state.dismissProblem}>
              Dismiss
            </Button>
          }
        >
          {problem}
        </Notice>
      )}
      {body}
      <p className="sw-caption sw-cons__truth">{TRUTH}</p>
      <Editor
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        mode={editing?.mode ?? 'add'}
        initial={draft}
        actors={view?.actors ?? []}
        alternatives={view?.alternatives ?? []}
        busy={working === 'reviewing'}
        problem={editing ? problem : null}
        onSubmit={(next) => void submit(next)}
      />
    </div>
  );
}

/** The Constraints view of the Map: the page, joined to the project and to the server. */
export function ConstraintsScene() {
  const ws = useWorkspace();
  const state = useConstraints(ws.project.id);
  return (
    <ConstraintsPage
      state={state}
      onView={(next) => ws.setView(next === 'map' ? null : next)}
      onSimulate={() => ws.go('simulate')}
    />
  );
}

export default ConstraintsScene;
