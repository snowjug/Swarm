import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Bot, Plus, UserRound, Users, Wand2 } from 'lucide-react';
import type { Actor, TraitKey } from '../../../../shared/stakeholders';
import { useWorkspace } from '../../app/context';
import { useUnsavedWork } from '../../app/unsaved-context';
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
import { useParticipants } from '../../hooks/useParticipants';
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
import { gateOf } from './review/logic';
import { ReviewSurface } from './review/ReviewSurface';
import { UnsavedBar } from './UnsavedBar';
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
  proposing: 'Proposing participants…',
  reviewing: 'Saving…',
  approving: 'Approving…',
  'making-actors': 'Making the actors…',
  saving: 'Saving…',
  'saving-actors': 'Saving…',
};

/** The width of the panel that floats over the right of the map. */
const PANEL_WIDTH = 424;
/** The page's grid (tokens.css: `--gutter` and `--w-wide`): the panel keeps to the same right edge as the bar above it. */
const gridInset = (width: number): number =>
  Math.max(Math.min(40, Math.max(16, 6.4 + 0.026 * width)), (width - 1472) / 2);

function Count({ value }: { value: number }) {
  const shown = useTween(value, { duration: 0.6 });
  return <span className="sw-numeral">{Math.round(shown)}</span>;
}

/** The engine's account, a sentence at a time, so that what it did is read as a list and not as one block. */
const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.?!])\s+(?=[A-Z\u201c"])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

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
          <span className="sw-tb-label">{label}</span>
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
        {note && (
          <ul className="sw-source__facts">
            {sentencesOf(note).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        )}
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

const INFLUENCE_WORD = (value: number): string =>
  value < 0.34 ? 'Low' : value < 0.67 ? 'Medium' : 'High';

/** What a bead says on hover before the panel is opened: who matters, how sure Swarm is, and where the evidence stands. */
function tipFacts(node: EcoNode, subject: 'stakeholders' | 'actors'): string {
  const facts: string[] = [node.kind === 'key' ? 'Key' : 'Cohort'];
  if (subject === 'actors' && node.influence !== undefined)
    facts.push(`${INFLUENCE_WORD(node.influence)} influence`);
  if (node.direction !== 'unclear') facts.push(DIRECTION_LABEL[node.direction]);
  facts.push(
    node.evidenceCount === 0
      ? 'assumed'
      : `${node.evidenceCount} ${node.evidenceCount === 1 ? 'quote' : 'quotes'}`,
  );
  return facts.join(' · ');
}

type DialogState =
  { mode: 'add'; ghost: Ghost | null; copyOf?: string } | { mode: 'edit'; id: string } | null;

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
  const narrow = useMediaQuery('(max-width: 40rem)');
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
  const view: MapView = ws.view === 'list' ? 'list' : ws.view === 'review' ? 'review' : 'map';
  const may = stakeholdersView?.may ?? { edit: false, run: false };
  const busy = working !== null;
  const editable = may.edit && !busy;
  // What the server found when it checked the participants. A server that does not check says nothing, and nothing is held back.
  const checks = stakeholdersView?.review ?? null;
  const gate = gateOf(checks);

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
  const participants = useParticipants({
    projectId: project.id,
    state,
    set,
    revision: stakeholdersView?.revision ?? null,
    say,
    focus,
  });

  // ---- Finding, approving, and making actors ---------------------------------------------------------------
  const find = async (mode: FindMode, confirm = false): Promise<void> => {
    setPending(mode);
    setReplacing(null);
    // The participants are proposed, and checked, whichever way they are found.
    const found = await state.propose(mode, confirm);
    setPending(null);
    if (found) {
      focus(view === 'review' ? ['rv:top', 'title'] : ['title']);
      say(
        view === 'review'
          ? 'Participants proposed again. They are in the review.'
          : 'Stakeholders found. They are on the map.',
      );
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
  // Leaving the Map by any way the shell controls (the journey, the dock, the palette, another exploration, a new
  // question) asks first while there are changes that are not saved: they live only here, until they are.
  useUnsavedWork(
    dirtyCount > 0
      ? `${dirtyCount} ${dirtyCount === 1 ? 'actor has' : 'actors have'} changes that have not been saved.`
      : null,
  );
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
  // The button that saves is built when the number of changed actors changes, not on every change: what it saves is read
  // from here, when it is pressed, so that the last thing the person changed is what is saved.
  const draftNow = useRef(draft);
  useEffect(() => {
    draftNow.current = draft;
  });
  const saveActors = async (): Promise<void> => {
    // A line that was added and left empty is nothing, not a want with no words.
    const trimmed = draftNow.current?.map((actor) => ({
      ...actor,
      role: actor.role.trim(),
      priorBelief: actor.priorBelief.trim(),
      objectives: actor.objectives.map((line) => line.trim()).filter(Boolean),
      concerns: actor.concerns.map((line) => line.trim()).filter(Boolean),
      constraints: actor.constraints.map((line) => line.trim()).filter(Boolean),
    }));
    if (trimmed && (await state.saveActors(trimmed))) {
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
      // Actors are made only from a list that passes its checks: until then the way on is shut, and says why.
      disabled: !enough || !gate.open,
      blocked: enough ? gate.hint : 'Keep or add two or more',
      label: view === 'review' && mode === 'approve' ? 'Use these actors' : undefined,
      onConfirm:
        mode === 'approve'
          ? (options) => void approve(options)
          : (options) => void makeActors(options),
    });
    if (!set.approvedAt) {
      if (!allowed)
        return { kind: 'read', text: 'Approving needs the right to edit and to run the project.' };
      if (view === 'review') {
        // The surface beside it says what is wrong; the pill says how much, and holds the one way on.
        return {
          kind: 'gate',
          blocking: gate.blocking,
          waiting: queue.length,
          total: live.length,
          approve: { ...confirm('approve'), blocked: undefined },
        };
      }
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
    return {
      kind: 'ready',
      actors: actorSet.actors.length,
      onContinue: () => go('simulate'),
      onConstraints: () => ws.setView('constraints'),
    };
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
    view,
    gate.open,
    gate.hint,
    gate.blocking,
    go,
  ]);

  // ---- Dialog for adding and editing ------------------------------------------------------------------------------
  const dialogDraft = useMemo(() => {
    if (!dialog) return EMPTY_DRAFT;
    if (dialog.mode === 'edit') {
      const target = set?.stakeholders.find((item) => item.id === dialog.id);
      return target ? draftOf(target) : EMPTY_DRAFT;
    }
    if (dialog.copyOf) {
      // A copy keeps what the person can say of the party (its kind, size and reasons) and leaves behind what only the
      // sources can: its evidence cannot be added, so the copy says it is the person's own.
      const original = set?.stakeholders.find((item) => item.id === dialog.copyOf);
      if (original) {
        const copy: typeof EMPTY_DRAFT = {
          ...draftOf(original),
          name: `${original.name} (copy)`.slice(0, 120),
          uncertaintyLevel: 'high',
          uncertaintyReason: 'Copied by you; no evidence has been checked for it.',
        };
        return copy;
      }
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
          working={working === 'finding' || working === 'proposing'}
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
  const coveredRight = wide && party ? PANEL_WIDTH + Math.round(gridInset(head.width)) : 0;
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
        onDuplicate={() => setDialog({ mode: 'add', ghost: null, copyOf: party.id })}
        onRemove={() => void review.remove(party.id)}
        onRestore={() => void review.restore(party.id)}
        onMerge={(target) => void review.merge(party.id, target)}
      />
    ) : null;
  // An actor is made from its stakeholder, so removing, duplicating or regrouping it is done there.
  const actorActions =
    party?.stakeholder && subject === 'actors' && may.edit ? (
      <div className="sw-insp__actions">
        <Button
          variant="glass"
          icon={<Users size={16} aria-hidden="true" />}
          onClick={() => {
            setSubjectChoice('stakeholders');
            say('Showing the stakeholders. Changing them makes the actors out of date.');
          }}
          data-stk-focus="action"
        >
          Edit as a stakeholder
        </Button>
      </div>
    ) : null;
  const stakeholderActions = stakeholderActionsOf(false) ?? actorActions;
  const stripActions = stakeholderActionsOf(true) ?? actorActions;

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
            ghosts={(narrow ? [] : ghosts).map((ghost) => ({
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
            inset={{ top: topInset, bottom: narrow ? 128 : 104 }}
            covered={{
              right: coveredRight,
              bottom: !wide && party ? (dirtyCount > 0 ? 244 : 190) : 0,
            }}
            controls={wide || !party}
            describe={describeNode}
            zoomLabels={{ group: 'Zoom', in: 'Zoom in', out: 'Zoom out', fit: 'Fit everything' }}
            tooltip={(node) =>
              node.ghost ? (
                <>
                  <strong>Nobody found</strong>
                  <span>{node.label}: press to add one</span>
                </>
              ) : (
                <>
                  <strong>{node.label}</strong>
                  <span className="sw-eco__tip-facts">{tipFacts(node, subject)}</span>
                  <span>{whyOf(node.id).slice(0, 96) || node.categoryLabel}</span>
                </>
              )
            }
          />
        </div>
      )}

      {view === 'map' && model && model.nodes.length === 0 && (narrow || ghosts.length === 0) && (
        <div className="sw-map__empty">
          <p className="sw-map__empty-title">Nobody drawn yet</p>
          <p>
            {may.edit
              ? 'Add the groups and roles this change touches. Two or more are needed to make actors.'
              : 'There is nobody to show.'}
          </p>
          {may.edit && (
            <Button
              variant="glass"
              icon={<Plus size={16} aria-hidden="true" />}
              onClick={() => setDialog({ mode: 'add', ghost: null })}
            >
              Add one yourself
            </Button>
          )}
        </div>
      )}

      <div className={view === 'map' ? 'sw-map__overlay' : 'sw-map__scroll'}>
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
              {checks && view !== 'review' && !set.approvedAt && (set.proposal || !gate.open) && (
                <Notice
                  tone={gate.open ? 'info' : 'caution'}
                  title={
                    gate.open
                      ? 'Swarm proposed these participants'
                      : `${gate.blocking === 1 ? 'One check stands' : `${gate.blocking} checks stand`} in the way of using these participants`
                  }
                  action={
                    <Button
                      size="sm"
                      variant="glass"
                      onClick={() => {
                        setSelectedId(null);
                        ws.setView('review');
                      }}
                    >
                      Review participants
                    </Button>
                  }
                >
                  <span className="sw-hide-sm">
                    {gate.open
                      ? 'Read why each is here and what it rests on, then use them to make the actors.'
                      : 'Actors are made only from a list that passes its checks. The review says what to fix.'}
                  </span>
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
            onView={(next) => {
              if (next === 'review') setSelectedId(null);
              ws.setView(next === 'map' ? null : next);
            }}
            checks={gate.blocking}
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
            canAdd={canAdd && subject === 'stakeholders' && view !== 'review'}
            onAdd={() => setDialog({ mode: 'add', ghost: null })}
            gaps={narrow && may.edit && canAdd && subject === 'stakeholders' ? ghosts : []}
            onGap={(ghost) => setDialog({ mode: 'add', ghost })}
            canFind={may.run && subject === 'stakeholders'}
            onFindAgain={() => startFind(set.discovery.mode === 'model' ? 'model' : 'rules')}
            canMakeAgain={may.run && hasActors && set.approvedAt !== null}
            onMakeAgain={() => setResetting(true)}
          />
        </div>
        {view === 'review' && (
          <ReviewSurface
            set={set}
            review={checks}
            may={may}
            modelAvailable={Boolean(stakeholdersView.model.available)}
            busy={busy}
            problem={state.problem}
            actions={participants}
            focus={focus}
            onProposeAgain={() => startFind(set.discovery.mode === 'model' ? 'model' : 'rules')}
          />
        )}
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
            subject={subject}
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
                wide ? (
                  <p className="sw-caption">Changes are held until you save them.</p>
                ) : (
                  // The pill is not on the screen while a party is open here: the strip carries what it would say.
                  <UnsavedBar
                    count={dirtyCount}
                    invalid={invalid}
                    onSave={() => void saveActors()}
                    onDiscard={() => setDraft(null)}
                  />
                )
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
        title={
          dialog?.mode === 'edit'
            ? 'Edit stakeholder'
            : dialog?.mode === 'add' && dialog.copyOf
              ? 'Duplicate stakeholder'
              : 'Add a stakeholder'
        }
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
                busy={working === 'finding' || working === 'proposing'}
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
