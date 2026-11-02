import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Bot, UserRound, Wand2 } from 'lucide-react';
import type { Actor, TraitKey } from '../../../../shared/stakeholders';
import { useWorkspace } from '../../app/context';
import { useTween } from '../../design/motion';
import {
  Button,
  ChipButton,
  Dialog,
  DialogContent,
  Notice,
  Orbit,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useToast,
} from '../../design/ui';
import { useAnnouncer, useFocusRequest } from '../../hooks/useFocusRequest';
import { useElementSize } from '../../hooks/useElementSize';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useStakeholders, type StakeholderWork } from '../../hooks/useStakeholders';
import {
  MAX_MERGED,
  MAX_STAKEHOLDERS,
  EMPTY_DRAFT,
  actorsDiffer,
  draftOf,
  isReviewed,
  liveStakeholders,
  mergedIntoMap,
  moveTrait,
  whyLine,
} from '../../lib/stakeholders/review';
import { Ecosystem } from '../../viz/ecosystem/Ecosystem';
import { DIRECTION_LABEL } from '../../viz/palette';
import type { EcoNode } from '../../viz/ecosystem/model';
import { Discover, SYNTHETIC_LINE, SYNTHETIC_NOTE, type FindMode } from './Discover';
import { Inspector } from './Inspector';
import { Legend } from './Legend';
import { PartyActions } from './PartyActions';
import { Pill, type ApproveModel, type PillModel } from './Pill';
import { Roster } from './Roster';
import { StakeholderDialog } from './StakeholderDialog';
import { Toolbar, type MapView } from './Toolbar';
import {
  buildMapModel,
  canAddMore,
  clusterOptions,
  connectionsOf,
  enoughToApprove,
  nextInQueue,
  partyOf,
  reviewQueue,
  type Ghost,
  type Subject,
} from './model';
import { useReview } from './useReview';
import './map.css';

const FAILED_MODEL = /could not be used|did not answer in time/u;

const WORKING_WORDS: Record<StakeholderWork, string> = {
  finding: 'Finding stakeholders…',
  approving: 'Approving…',
  'making-actors': 'Making the actors…',
  saving: 'Saving…',
  'saving-actors': 'Saving…',
};

const INSPECTOR_SPACE = 440;

function Count({ value }: { value: number }) {
  const shown = useTween(value, { duration: 0.6 });
  return <span className="sw-numeral">{Math.round(shown)}</span>;
}

/** How the list was made, in a few words, with the whole account one press away. */
function SourceChip({
  mode,
  model,
  note,
}: {
  mode: 'rules' | 'model' | 'user';
  model: string | null;
  note: string;
}) {
  const Icon = mode === 'model' ? Bot : mode === 'rules' ? Wand2 : UserRound;
  const label =
    mode === 'model'
      ? 'Found by a model'
      : mode === 'rules'
        ? 'Read from your text'
        : 'Built by you';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ChipButton size="sm" icon={<Icon size={13} aria-hidden="true" />}>
          {label}
        </ChipButton>
      </PopoverTrigger>
      <PopoverContent align="start" width="23rem" className="sw-source">
        <p className="sw-eyebrow">How these were found</p>
        <p>
          {mode === 'model'
            ? `A model proposed them${model ? ` (${model})` : ''}, and Swarm checked every quote against your sources.`
            : mode === 'rules'
              ? 'Swarm read your text for role words and quoted the sentence for each. No model was used.'
              : 'You built this list yourself.'}
        </p>
        {note && <p>{note}</p>}
        <p className="sw-caption">{SYNTHETIC_NOTE}</p>
      </PopoverContent>
    </Popover>
  );
}

function describeNode(node: EcoNode): string {
  const reach = node.direct === null ? '' : node.direct ? ', direct' : ', indirect';
  const review = node.status === 'proposed' ? ', not yet reviewed' : '';
  return `${node.label}, ${node.categoryLabel}, ${node.kind === 'key' ? 'key actor' : 'cohort'}, ${DIRECTION_LABEL[node.direction].toLowerCase()}${reach}, ${node.confidence} confidence${review}`;
}

type DialogState = { mode: 'add'; ghost: Ghost | null } | { mode: 'edit'; id: string } | null;

/**
 * Who is in play: the stakeholders around the change, found in the evidence, as a map to look at and a
 * list to read. A person reviews them here (accepts, changes, merges, removes), approves the list, and the
 * actors made from it appear in the same place, where every number they carry can be read and changed.
 */
export function MapScene() {
  const ws = useWorkspace();
  const { project, go } = ws;
  const state = useStakeholders(project.id, ws.refresh);
  const { view: stakeholdersView, actors: actorsView, working } = state;
  const toast = useToast();
  const wide = useMediaQuery('(min-width: 64rem)');
  // The picture keeps clear of the heading and the controls, however tall the two have become (a notice, a line that wraps).
  const head = useElementSize<HTMLDivElement>();
  const scope = useRef<HTMLElement>(null);
  const focus = useFocusRequest(scope);
  const [announcement, say] = useAnnouncer();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(true);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [subjectChoice, setSubjectChoice] = useState<Subject | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState<FindMode | null>(null);
  const [replacing, setReplacing] = useState<FindMode | null>(null);
  const [resetting, setResetting] = useState(false);
  const [draft, setDraft] = useState<Actor[] | null>(null);

  const set = stakeholdersView?.stakeholders ?? null;
  const actorSet = actorsView?.actors ?? null;
  const hasActors = actorSet !== null;
  const subject: Subject =
    hasActors && (subjectChoice ?? (set?.approvedAt ? 'actors' : 'stakeholders')) === 'actors'
      ? 'actors'
      : 'stakeholders';
  const view: MapView = ws.view === 'list' ? 'list' : 'map';
  const may = stakeholdersView?.may ?? { edit: false, run: false };
  const busy = working !== null;
  const editable = may.edit && !busy;

  // A new saved set of actors replaces any edits that were not saved.
  const actorsKey = actorsView ? `${actorsView.revision}-${actorSet?.generatedAt ?? ''}` : '';
  useEffect(() => {
    setDraft(null);
  }, [actorsKey]);

  const model = useMemo(
    () => (set ? buildMapModel({ set, actors: actorSet, subject }) : null),
    [set, actorSet, subject],
  );
  const nodes = useMemo(
    () => new Map((model?.nodes ?? []).map((node) => [node.id, node])),
    [model],
  );
  const party = selectedId ? partyOf(selectedId, set, actorSet) : null;
  const queue = useMemo(() => (set ? reviewQueue(set) : []), [set]);
  const clusters = useMemo(() => clusterOptions(model?.nodes ?? []), [model]);
  const live = useMemo(() => (set ? liveStakeholders(set.stakeholders) : []), [set]);
  const removed = useMemo(
    () => (set ? set.stakeholders.filter((item) => item.status === 'removed') : []),
    [set],
  );
  const editedActors = actorSet?.actors.filter((actor) => actor.edited).length ?? 0;
  const canAdd = may.edit && set !== null && canAddMore(set, MAX_STAKEHOLDERS);

  const select = useCallback((id: string | null) => setSelectedId(id), []);
  const review = useReview({ state, set, select, say, focus });

  // ---- Finding, approving, and making actors ---------------------------------------------------------------
  const find = async (mode: FindMode, confirm = false): Promise<void> => {
    setPending(mode);
    setReplacing(null);
    const found = await state.discover(mode, confirm);
    setPending(null);
    if (found) {
      focus(['title']);
      say('Stakeholders found. They are on the map.');
    }
  };
  const startFind = (mode: FindMode): void => {
    if (set && isReviewed(set)) setReplacing(mode);
    else void find(mode);
  };
  const approve = async (options: { model: boolean }): Promise<void> => {
    if (await state.approve(options)) {
      setSubjectChoice('actors');
      setSelectedId(null);
      focus(['continue']);
      const message =
        editedActors > 0
          ? 'Approved. The actors you changed were kept as they are.'
          : 'Approved. The actors were made from the approved stakeholders.';
      say(message);
      toast({
        title: 'Approved',
        description:
          editedActors > 0 ? 'The actors you changed were kept.' : 'The actors are ready.',
        tone: 'success',
      });
    }
  };
  const makeActors = async (options: { model: boolean }): Promise<void> => {
    if (await state.makeActors({ ...options, confirm: false })) {
      setSubjectChoice('actors');
      focus(['continue']);
      say('The actors were made from the approved stakeholders.');
      toast({ title: 'Actors made', tone: 'success' });
    }
  };
  const resetActors = async (): Promise<void> => {
    // Changing a stakeholder takes the approval away, and actors are made only from an approved list.
    const made = await state.makeActors({
      model: false,
      confirm: true,
      approveFirst: set !== null && !set.approvedAt,
    });
    setResetting(false);
    if (made) {
      setDraft(null);
      say('Made every actor again from the approved stakeholders.');
      toast({
        title: 'Actors reset',
        description: 'Made again from the approved stakeholders.',
        tone: 'success',
      });
    }
  };

  // ---- Edits to the actors are held until they are saved ----------------------------------------------------
  const working_ = draft ?? actorSet?.actors ?? [];
  const dirtyCount = actorSet
    ? working_.filter((actor) =>
        actorsDiffer([actorSet.actors.find((item) => item.id === actor.id) ?? actor], [actor]),
      ).length
    : 0;
  const invalid = working_.some((actor) => actor.sampleSize > actor.size);
  const onTrait = (id: string, key: TraitKey, value: number): void =>
    setDraft((old) =>
      (old ?? actorSet?.actors ?? []).map((actor) =>
        actor.id === id ? moveTrait(actor, key, value) : actor,
      ),
    );
  const onActor = (next: Actor): void =>
    setDraft((old) =>
      (old ?? actorSet?.actors ?? []).map((actor) => (actor.id === next.id ? next : actor)),
    );
  const saveActors = async (): Promise<void> => {
    if (draft && (await state.saveActors(draft))) {
      focus(['inspector']);
      say('Saved your changes to the actors.');
    }
  };

  // ---- Keyboard: F toggles focus; Escape lets go of the selection ----------------------------------------------
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName)))
        return;
      if (event.key.toLowerCase() === 'f' && view === 'map' && selectedId)
        setFocusMode((old) => !old);
    };
    document.addEventListener('keydown', press);
    return () => document.removeEventListener('keydown', press);
  }, [view, selectedId]);

  // ---- The pill: the one thing to do next --------------------------------------------------------------------
  const pill = useMemo<PillModel | null>(() => {
    if (!set) return null;
    if (working) return { kind: 'working', text: WORKING_WORDS[working] };
    if (dirtyCount > 0)
      return {
        kind: 'dirty',
        count: dirtyCount,
        invalid,
        onSave: () => void saveActors(),
        onDiscard: () => setDraft(null),
      };
    const allowed = may.edit && may.run;
    const enough = enoughToApprove(set);
    const confirm = (mode: ApproveModel['mode']): ApproveModel => ({
      mode,
      modelAvailable: Boolean(stakeholdersView?.model.available),
      keepsEdited: editedActors,
      unreviewed: queue.length,
      disabled: !enough,
      blocked: enough ? undefined : 'Keep or add two or more',
      onConfirm:
        mode === 'approve'
          ? (options) => void approve(options)
          : (options) => void makeActors(options),
    });
    if (!set.approvedAt) {
      if (!allowed)
        return { kind: 'read', text: 'Approving needs the right to edit and to run the project.' };
      return {
        kind: 'review',
        reviewed: live.length - queue.length,
        total: live.length,
        onNext: () => {
          const next = nextInQueue(queue, selectedId);
          if (next) {
            setSubjectChoice('stakeholders');
            setSelectedId(next);
            focus(['inspector']);
          }
        },
        approve: confirm('approve'),
      };
    }
    if (!actorSet)
      return allowed
        ? { kind: 'make', approve: confirm('make') }
        : { kind: 'read', text: 'Approved. The actors are not made yet.' };
    return { kind: 'ready', actors: actorSet.actors.length, onContinue: () => go('simulate') };
    // The handlers close over state that changes with these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    set,
    working,
    dirtyCount,
    invalid,
    may.edit,
    may.run,
    queue,
    live.length,
    editedActors,
    actorSet,
    selectedId,
    stakeholdersView?.model.available,
    go,
  ]);

  // ---- Dialog for adding and editing ------------------------------------------------------------------------------
  const dialogDraft = useMemo(() => {
    if (!dialog) return EMPTY_DRAFT;
    if (dialog.mode === 'edit') {
      const target = set?.stakeholders.find((item) => item.id === dialog.id);
      return target ? draftOf(target) : EMPTY_DRAFT;
    }
    return dialog.ghost
      ? { ...EMPTY_DRAFT, category: dialog.ghost.category, name: dialog.ghost.text ?? '' }
      : EMPTY_DRAFT;
  }, [dialog, set]);
  const submitDialog = async (value: typeof EMPTY_DRAFT): Promise<void> => {
    if (!dialog) return;
    const saved =
      dialog.mode === 'edit' ? await review.edit(dialog.id, value) : await review.add(value);
    if (saved) setDialog(null);
  };

  // ---- Screens that are not the map ----------------------------------------------------------------------------------
  if (!stakeholdersView) {
    return (
      <section className="sw-map-state" aria-live="polite">
        {state.error ? (
          <>
            <Notice
              tone="error"
              title="Stakeholders could not be read"
              action={
                <Button size="sm" variant="glass" onClick={state.reload}>
                  Retry
                </Button>
              }
            >
              {state.error}
            </Notice>
          </>
        ) : (
          <>
            <Orbit size={30} label="Reading stakeholders" />
            <p className="sw-caption">Reading stakeholders…</p>
          </>
        )}
      </section>
    );
  }

  const failure = state.problem && (
    <Notice
      tone="error"
      title="That did not work"
      action={
        <Button size="sm" variant="glass" onClick={state.dismissProblem}>
          Dismiss
        </Button>
      }
    >
      {state.problem}
    </Notice>
  );

  if (!set) {
    return (
      <>
        <Discover
          model={stakeholdersView.model}
          may={may}
          working={working === 'finding'}
          pending={pending}
          onFind={(mode) => void find(mode)}
          onAdd={() => setDialog({ mode: 'add', ghost: null })}
          notice={failure}
        />
        <StakeholderDialog
          open={dialog !== null}
          onOpenChange={(open) => !open && setDialog(null)}
          title="Add the first stakeholder"
          submitLabel="Add stakeholder"
          initial={dialogDraft}
          busy={busy}
          onSubmit={(value) => void submitDialog(value)}
        />
        <p className="sr-only" role="status">
          {announcement}
        </p>
      </>
    );
  }

  // ---- The map ---------------------------------------------------------------------------------------------------------
  const modelFailed = FAILED_MODEL.test(set.discovery.note);
  const stale = actorsView?.stale === true;
  const whyOf = (id: string): string => {
    const stakeholder = set.stakeholders.find((item) => item.id === id);
    const actor = actorSet?.actors.find((item) => item.id === id);
    return subject === 'actors' && actor?.role
      ? actor.role
      : stakeholder
        ? whyLine(stakeholder)
        : (actor?.role ?? '');
  };
  const coveredRight = wide && party ? INSPECTOR_SPACE : 0;
  const ghosts = model?.ghosts ?? [];
  const mergedInto = party?.stakeholder
    ? (mergedIntoMap(set.stakeholders).get(party.stakeholder.id) ?? null)
    : null;
  const connections = party ? connectionsOf(party.id, model?.edges ?? []) : [];
  const stored =
    party?.id && actorSet ? (actorSet.actors.find((item) => item.id === party.id) ?? null) : null;
  const draftActor =
    party?.id && draft ? (draft.find((item) => item.id === party.id) ?? null) : null;
  const total = model?.nodes.length ?? 0;
  const keyCount = model?.nodes.filter((node) => node.kind === 'key').length ?? 0;
  const topInset = Math.round(head.height) + 12;
  const stakeholderActionsOf = (compact: boolean) =>
    party?.stakeholder && subject === 'stakeholders' && may.edit ? (
      <PartyActions
        stakeholder={party.stakeholder}
        mergeTargets={live.filter(
          (item) => item.id !== party.stakeholder!.id && item.mergedFrom.length < MAX_MERGED,
        )}
        mergedInto={mergedInto}
        busy={busy}
        compact={compact}
        onAccept={() => void review.accept(party.id)}
        onEdit={() => setDialog({ mode: 'edit', id: party.id })}
        onRemove={() => void review.remove(party.id)}
        onRestore={() => void review.restore(party.id)}
        onMerge={(target) => void review.merge(party.id, target)}
      />
    ) : null;
  const stakeholderActions = stakeholderActionsOf(false);
  const stripActions = stakeholderActionsOf(true);

  return (
    <section
      ref={scope}
      className="sw-map"
      data-view={view}
      data-subject={subject}
      data-open={party ? 'true' : undefined}
      style={{ '--covered': `${coveredRight}px` } as React.CSSProperties}
      aria-labelledby="map-title"
    >
      {view === 'map' && model && head.ready && (
        <div className="sw-map__canvas">
          <Ecosystem
            nodes={model.nodes}
            edges={model.edges}
            ghosts={ghosts.map((ghost) => ({
              id: ghost.id,
              label: ghost.label,
              cluster: ghost.cluster,
            }))}
            onGhost={(id) =>
              setDialog({ mode: 'add', ghost: ghosts.find((ghost) => ghost.id === id) ?? null })
            }
            ghostLabel={(label) => `Nobody found for ${label}. Add one`}
            label={
              subject === 'actors'
                ? 'Actors and how they relate'
                : 'Stakeholders and how they relate'
            }
            selectedId={party ? party.id : null}
            onSelect={select}
            focus={focusMode && party !== null}
            hiddenClusters={hidden}
            inset={{ top: topInset, bottom: wide ? 104 : 100 }}
            covered={{ right: coveredRight, bottom: !wide && party ? 190 : 0 }}
            controls={wide || !party}
            describe={describeNode}
            zoomLabels={{ group: 'Zoom', in: 'Zoom in', out: 'Zoom out', fit: 'Fit everything' }}
            tooltip={(node) => (
              <>
                <strong>{node.label}</strong>
                <span>{whyOf(node.id).slice(0, 96) || node.categoryLabel}</span>
              </>
            )}
          />
        </div>
      )}

      <div className={view === 'list' ? 'sw-map__scroll' : 'sw-map__overlay'}>
        <div className="sw-map__top" ref={head.ref}>
          <header className="sw-map__head">
            <h1
              id="map-title"
              className="sw-display sw-map__title"
              tabIndex={-1}
              data-stk-focus="title"
            >
              Who is <em>in play</em>
            </h1>
            <p className="sw-map__stats">
              <span>
                <Count value={total} />{' '}
                {subject === 'actors'
                  ? total === 1
                    ? 'actor'
                    : 'actors'
                  : total === 1
                    ? 'party'
                    : 'parties'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <Count value={keyCount} /> key
              </span>
              {subject === 'stakeholders' && queue.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="sw-map__attn">
                    <Count value={queue.length} /> to review
                  </span>
                </>
              )}
              <SourceChip
                mode={set.discovery.mode}
                model={set.discovery.model}
                note={set.discovery.note}
              />
            </p>
            <p className="sw-caption sw-map__truth">
              <span className="sw-hide-sm">{SYNTHETIC_LINE}</span>
              <span className="sw-hide-lg">Synthetic stand-ins, not real people.</span>
            </p>
            <div className="sw-map__notices">
              {failure}
              {modelFailed && (
                <Notice tone="caution" title="How these were found">
                  {set.discovery.note}
                </Notice>
              )}
              {stale && (
                <Notice
                  tone="caution"
                  title="The actors are out of date"
                  action={
                    may.run ? (
                      <Button size="sm" variant="glass" onClick={() => setResetting(true)}>
                        Make them again
                      </Button>
                    ) : undefined
                  }
                >
                  The stakeholders changed after they were made. The simulation uses the actors as
                  they are now.
                </Notice>
              )}
            </div>
          </header>
          <Toolbar
            view={view}
            onView={(next) => ws.setView(next === 'list' ? 'list' : null)}
            subject={subject}
            hasActors={hasActors}
            onSubject={(next) => {
              setSubjectChoice(next);
              say(next === 'actors' ? 'Showing the actors.' : 'Showing the stakeholders.');
            }}
            clusters={clusters}
            hidden={hidden}
            onToggleCluster={(id) =>
              setHidden((old) => {
                const next = new Set(old);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onShowAll={() => setHidden(new Set())}
            focus={focusMode}
            canFocus={party !== null}
            onFocus={setFocusMode}
            canAdd={canAdd && subject === 'stakeholders'}
            onAdd={() => setDialog({ mode: 'add', ghost: null })}
            canFind={may.run && subject === 'stakeholders'}
            onFindAgain={() => startFind(set.discovery.mode === 'model' ? 'model' : 'rules')}
            canMakeAgain={may.run && hasActors && set.approvedAt !== null}
            onMakeAgain={() => setResetting(true)}
          />
        </div>
        {view === 'list' && model && (
          <Roster
            nodes={model.nodes}
            why={whyOf}
            selectedId={party ? party.id : null}
            onSelect={(id) => {
              // A second press on the party that is open puts it away, as it does on the map.
              if (party && party.id === id) {
                setSelectedId(null);
                focus([`node:${id}`]);
                return;
              }
              setSelectedId(id);
              focus(['inspector']);
            }}
            hidden={hidden}
            removed={subject === 'stakeholders' ? removed : []}
            ghosts={ghosts}
            onGhost={may.edit ? (ghost) => setDialog({ mode: 'add', ghost }) : undefined}
            label={subject === 'actors' ? 'Actors' : 'Stakeholders, key actors first'}
          />
        )}
      </div>

      {view === 'map' && (
        <div className="sw-map__legend">
          <Legend subject={subject} />
        </div>
      )}

      {(wide || !party) && <Pill model={pill} />}

      <AnimatePresence>
        {party && (
          <Inspector
            key={wide ? 'panel' : 'peek'}
            layout={wide ? 'panel' : 'peek'}
            party={party}
            subject={subject}
            nodes={nodes}
            connections={connections}
            editable={editable}
            draft={draftActor}
            stored={stored}
            mergedInto={mergedInto}
            onSelect={(id) => setSelectedId(id)}
            onPriority={(priority) => void review.prioritise(party.id, priority)}
            onTrait={(key, value) => onTrait(party.id, key, value)}
            onActor={onActor}
            actions={stakeholderActions}
            stripActions={stripActions}
            aside={
              dirtyCount > 0 && subject === 'actors' ? (
                <p className="sw-caption">Changes are held until you save them.</p>
              ) : undefined
            }
            onClose={() => {
              setSelectedId(null);
              focus([`node:${party.id}`]);
            }}
          />
        )}
      </AnimatePresence>

      <StakeholderDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.mode === 'edit' ? 'Edit stakeholder' : 'Add a stakeholder'}
        submitLabel={dialog?.mode === 'edit' ? 'Save changes' : 'Add stakeholder'}
        initial={dialogDraft}
        busy={busy}
        onSubmit={(value) => void submitDialog(value)}
      />

      <Dialog open={replacing !== null} onOpenChange={(open) => !open && setReplacing(null)}>
        <DialogContent
          tone="danger"
          title="Replace the list?"
          description="This replaces the list you have reviewed, including your changes and the approval. The actors already made stay until you make them again."
          footer={
            <>
              <Button variant="ghost" onClick={() => setReplacing(null)}>
                Keep my list
              </Button>
              <Button
                variant="danger"
                busy={working === 'finding'}
                onClick={() => replacing && void find(replacing, true)}
              >
                Replace my list
              </Button>
            </>
          }
        />
      </Dialog>

      <Dialog open={resetting} onOpenChange={setResetting}>
        <DialogContent
          tone="danger"
          title="Reset all actors?"
          description={`This makes every actor again from the approved stakeholders${editedActors > 0 ? ` and replaces the changes you made to ${editedActors} of them` : ''}.${
            set.approvedAt
              ? ''
              : ` The list changed after it was approved, so it is approved again first${queue.length > 0 ? `, and the ${queue.length} not yet reviewed are accepted` : ''}.`
          }`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setResetting(false)}>
                Keep the actors
              </Button>
              <Button
                variant="danger"
                busy={working === 'making-actors'}
                onClick={() => void resetActors()}
              >
                Reset every actor
              </Button>
            </>
          }
        />
      </Dialog>

      <p className="sr-only" role="status">
        {announcement}
      </p>
    </section>
  );
}
