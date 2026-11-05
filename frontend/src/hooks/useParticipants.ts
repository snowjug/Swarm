import { useCallback, useEffect, useRef } from 'react';
import { proposalWasStopped, type ModelFailureCode } from '../../../shared/model-failure';
import type {
  ParticipantWhy,
  StakeholderSet,
  StakeholdersView,
} from '../../../shared/stakeholders';
import {
  participantsApi,
  thenActors,
  type AddMissingInput,
  type ParticipantChanges,
} from '../api/participants';
import { useToast } from '../design/ui';
import {
  mergedIntoMap,
  orderForReview,
  replace,
  restoredStatus,
  undoMerge,
} from '../lib/stakeholders/review';
import type { RequestFocus } from './useFocusRequest';
import type { StakeholderState } from './useStakeholders';

export interface ParticipantsArgs {
  projectId: string;
  state: StakeholderState;
  set: StakeholderSet | null;
  /** The revision of the list the person is looking at, which every change is made against. */
  revision: number | null;
  say: (message: string) => void;
  focus: RequestFocus;
}

export interface MergeGroup {
  keep: string;
  merge: string[];
}

export interface ParticipantActions {
  /** Accepts the participants named, or every one that is only proposed. */
  accept: (ids?: readonly string[]) => Promise<boolean>;
  edit: (id: string, changes: ParticipantChanges) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  restore: (id: string) => Promise<boolean>;
  /**
   * Proposes one participant again from the rest of the list; `confirm` replaces what the person changed. False
   * when the model could not be used (the stop is on the page state) or the change was refused: the participant
   * is as it was. `fallbackFrom` is the failure the person is going on from, when they chose rules after it.
   */
  regenerate: (
    id: string,
    options: { mode: 'rules' | 'model'; confirm: boolean; fallbackFrom?: ModelFailureCode },
  ) => Promise<boolean>;
  /** Merges the groups named, or every set of participants that is certainly one. */
  mergeDuplicates: (groups?: MergeGroup[]) => Promise<boolean>;
  addMissing: (input: AddMissingInput) => Promise<boolean>;
  /** Reads why a participant is on the list; it asks the server for nothing that is not already stored. */
  why: (id: string, signal?: AbortSignal) => Promise<ParticipantWhy>;
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * What a person does to the participants. Every change is made against the revision they were looking at,
 * is checked again by the server, and answers with the list and its checks, which is what the page then shows.
 * Like the other reviews it says what happened for a screen reader and asks for focus to go somewhere that
 * still exists, since the control that was pressed is often gone once it has done its work.
 */
export function useParticipants(args: ParticipantsArgs): ParticipantActions {
  const toast = useToast();
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });

  /** Runs one change as the work of the page: one at a time, a refusal said, the list and the actors read again. */
  const change = useCallback(
    (make: (projectId: string, revision: number) => Promise<StakeholdersView>) => {
      const { state, projectId, revision } = latest.current;
      if (revision === null) return Promise.resolve(false);
      return state.exec('reviewing', () => thenActors(projectId, make(projectId, revision)));
    },
    [],
  );

  const accept = useCallback(
    async (ids?: readonly string[]) => {
      const before = latest.current.set?.stakeholders.filter((item) => item.status === 'proposed');
      const named = ids ? new Set(ids) : null;
      const touched = (before ?? []).filter((item) => !named || named.has(item.id));
      const accepted = await change((projectId, expectedRevision) =>
        participantsApi.accept(projectId, { expectedRevision, ...(ids ? { ids: [...ids] } : {}) }),
      );
      if (accepted) {
        // One participant: focus stays on its card, so that the page does not jump. Several: the summary says how it stands.
        latest.current.focus(ids?.length === 1 ? [`rv:${ids[0]}`, 'rv:top'] : ['rv:top']);
        latest.current.say(
          touched.length === 0
            ? 'Nothing was waiting to be accepted.'
            : touched.length === 1
              ? `Accepted ${touched[0]!.name}.`
              : `Accepted ${count(touched.length, 'participant', 'participants')}.`,
        );
      }
      return accepted;
    },
    [change],
  );

  const edit = useCallback(
    async (id: string, changes: ParticipantChanges) => {
      const name = latest.current.set?.stakeholders.find((item) => item.id === id)?.name ?? 'it';
      const saved = await change((projectId, expectedRevision) =>
        participantsApi.edit(projectId, id, { expectedRevision, changes }),
      );
      if (saved) {
        latest.current.focus([`rv:${id}`, 'rv:top']);
        latest.current.say(`Saved your changes to ${changes.name ?? name}.`);
      }
      return saved;
    },
    [change],
  );

  const restore = useCallback(async (id: string) => {
    const { set, state } = latest.current;
    const target = set?.stakeholders.find((item) => item.id === id);
    if (!set || !target) return false;
    const into = mergedIntoMap(set.stakeholders).get(id);
    const saved = await state.save(
      into
        ? undoMerge(set.stakeholders, id)
        : replace(set.stakeholders, id, (item) => ({ ...item, status: restoredStatus(item) })),
      [...set.relations],
    );
    if (saved) {
      latest.current.focus([`rv:${id}`, 'rv:top']);
      latest.current.say(
        into
          ? `Undid the merge of ${target.name}. It is back in the list.`
          : `Restored ${target.name}.`,
      );
    }
    return saved;
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const { set } = latest.current;
      const target = set?.stakeholders.find((item) => item.id === id);
      if (!set || !target) return false;
      const ordered = orderForReview(set.stakeholders);
      const at = ordered.findIndex((item) => item.id === id);
      const neighbour = ordered[at + 1] ?? ordered[at - 1];
      const removed = await change((projectId, expectedRevision) =>
        participantsApi.remove(projectId, id, expectedRevision),
      );
      if (removed) {
        latest.current.focus([...(neighbour ? [`rv:${neighbour.id}`] : []), 'rv:top']);
        latest.current.say(`Removed ${target.name}. It stays in the record and can be restored.`);
        toast({
          title: `Removed ${target.name}`,
          description: 'It stays in the record.',
          action: { label: 'Undo', onPress: () => void restore(id) },
        });
      }
      return removed;
    },
    [change, restore, toast],
  );

  const regenerate = useCallback(
    async (
      id: string,
      options: { mode: 'rules' | 'model'; confirm: boolean; fallbackFrom?: ModelFailureCode },
    ) => {
      const name = latest.current.set?.stakeholders.find((item) => item.id === id)?.name ?? 'it';
      const { state, projectId, revision } = latest.current;
      if (revision === null) return false;
      const done = await state.exec('reviewing', async () => {
        const answer = await participantsApi.regenerate(projectId, id, {
          expectedRevision: revision,
          ...options,
        });
        return proposalWasStopped(answer)
          ? {
              stopped: {
                step: 'regenerate',
                stop: answer.stopped,
                confirm: options.confirm,
                participantId: id,
              },
            }
          : thenActors(projectId, Promise.resolve(answer));
      });
      if (done) {
        latest.current.focus([`rv:${id}`, 'rv:top']);
        latest.current.say(
          options.fallbackFrom
            ? `Proposed ${name} again by rules, from the rules fallback. It is waiting for your review.`
            : `Proposed ${name} again. It is waiting for your review.`,
        );
      }
      return done;
    },
    [],
  );

  const mergeDuplicates = useCallback(
    async (groups?: MergeGroup[]) => {
      const merged = await change((projectId, expectedRevision) =>
        participantsApi.mergeDuplicates(projectId, {
          expectedRevision,
          ...(groups ? { groups } : {}),
        }),
      );
      if (merged) {
        latest.current.focus(['rv:top']);
        latest.current.say('Merged the duplicates. Each stays in the record under Removed.');
      }
      return merged;
    },
    [change],
  );

  const addMissing = useCallback(async (input: AddMissingInput) => {
    const known = new Set(latest.current.set?.stakeholders.map((item) => item.id));
    const { state, projectId, revision } = latest.current;
    if (revision === null) return false;
    const added: { id: string | null } = { id: null };
    const saved = await state.exec('reviewing', async () => {
      const shown = await thenActors(
        projectId,
        participantsApi.addMissing(projectId, { ...input, expectedRevision: revision }),
      );
      added.id =
        shown.view.stakeholders?.stakeholders.find((item) => !known.has(item.id))?.id ?? null;
      return shown;
    });
    if (saved) {
      latest.current.focus([...(added.id ? [`rv:${added.id}`] : []), 'rv:top']);
      latest.current.say(`Added ${input.name.trim()}. It carries no evidence: it is your own.`);
    }
    return saved;
  }, []);

  const why = useCallback(
    (id: string, signal?: AbortSignal) => participantsApi.why(latest.current.projectId, id, signal),
    [],
  );

  return { accept, edit, remove, restore, regenerate, mergeDuplicates, addMissing, why };
}
