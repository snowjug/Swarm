import { useCallback, useEffect, useRef } from 'react';
import type {
  Stakeholder,
  StakeholderRelation,
  StakeholderSet,
} from '../../../../shared/stakeholders';
import { useToast } from '../../design/ui';
import type { RequestFocus } from '../../hooks/useFocusRequest';
import type { StakeholderState } from '../../hooks/useStakeholders';
import { PRIORITY_LABELS } from '../../lib/stakeholders/labels';
import {
  addedStakeholder,
  applyDraft,
  mergeStakeholders,
  mergedIntoMap,
  orderForReview,
  replace,
  restoredStatus,
  undoMerge,
  type StakeholderDraft,
} from '../../lib/stakeholders/review';

export interface ReviewArgs {
  state: StakeholderState;
  set: StakeholderSet | null;
  select: (id: string | null) => void;
  say: (message: string) => void;
  focus: RequestFocus;
}

const stakeholderOf = (set: StakeholderSet | null, id: string): Stakeholder | undefined =>
  set?.stakeholders.find((item) => item.id === id);

/**
 * What a person does to the list of stakeholders. Every change sends the whole list, which the server checks;
 * what comes back is shown. The control that had focus often goes (an accepted stakeholder loses its Accept
 * button), so each change says what happened and asks for focus to go to the next place to be. Removing and
 * merging can be taken back from the message that says they happened.
 */
export function useReview(args: ReviewArgs) {
  const toast = useToast();
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });

  const save = useCallback(
    (stakeholders: Stakeholder[], relations: StakeholderRelation[]) =>
      latest.current.state.save(stakeholders, relations),
    [],
  );

  const change = useCallback(
    (id: string, next: Stakeholder) => {
      const { set } = latest.current;
      if (!set) return Promise.resolve(false);
      return save(
        replace(set.stakeholders, id, () => next),
        [...set.relations],
      );
    },
    [save],
  );

  const accept = useCallback(
    async (id: string) => {
      const target = stakeholderOf(latest.current.set, id);
      if (!target) return;
      if (await change(id, { ...target, status: 'accepted' })) {
        latest.current.focus(['action', 'inspector']);
        latest.current.say(`Accepted ${target.name}.`);
      }
    },
    [change],
  );

  const edit = useCallback(
    async (id: string, draft: StakeholderDraft): Promise<boolean> => {
      const target = stakeholderOf(latest.current.set, id);
      if (!target) return false;
      const saved = await change(id, applyDraft(target, draft));
      if (saved) {
        latest.current.focus(['action', 'inspector']);
        latest.current.say(`Saved changes to ${draft.name.trim()}.`);
      }
      return saved;
    },
    [change],
  );

  const prioritise = useCallback(
    async (id: string, priority: Stakeholder['priority']) => {
      const target = stakeholderOf(latest.current.set, id);
      if (!target) return;
      if (await change(id, { ...target, priority }))
        latest.current.say(`${target.name} is now ${PRIORITY_LABELS[priority].toLowerCase()}.`);
    },
    [change],
  );

  const restore = useCallback(
    async (id: string) => {
      const { set } = latest.current;
      const target = stakeholderOf(latest.current.set, id);
      if (!set || !target) return;
      const into = mergedIntoMap(set.stakeholders).get(id);
      const saved = into
        ? await save(undoMerge(set.stakeholders, id), [...set.relations])
        : await change(id, { ...target, status: restoredStatus(target) });
      if (saved) {
        latest.current.select(id);
        latest.current.focus(['inspector', `node:${id}`]);
        latest.current.say(
          into
            ? `Undid the merge of ${target.name}. It is back in the list.`
            : `Restored ${target.name}.`,
        );
      }
    },
    [change, save],
  );

  const remove = useCallback(
    async (id: string) => {
      const { set } = latest.current;
      const target = stakeholderOf(latest.current.set, id);
      if (!set || !target) return;
      const ordered = orderForReview(set.stakeholders);
      const at = ordered.findIndex((item) => item.id === id);
      const neighbour = ordered[at + 1] ?? ordered[at - 1];
      if (await change(id, { ...target, status: 'removed' })) {
        latest.current.select(null);
        latest.current.focus([...(neighbour ? [`node:${neighbour.id}`] : []), 'add']);
        latest.current.say(`Removed ${target.name}. It stays in the record and can be restored.`);
        toast({
          title: `Removed ${target.name}`,
          description: 'It stays in the record.',
          action: { label: 'Undo', onPress: () => void restore(id) },
        });
      }
    },
    [change, restore, toast],
  );

  const merge = useCallback(
    async (sourceId: string, targetId: string) => {
      const { set } = latest.current;
      const source = stakeholderOf(latest.current.set, sourceId);
      const into = stakeholderOf(latest.current.set, targetId);
      if (!set || !source || !into) return;
      const merged = mergeStakeholders(set.stakeholders, set.relations, sourceId, targetId);
      if (await save(merged.stakeholders, merged.relations)) {
        latest.current.select(targetId);
        latest.current.focus([`node:${targetId}`, 'inspector']);
        latest.current.say(
          `Merged ${source.name} into ${into.name}. ${source.name} stays in the record, under Removed.`,
        );
        toast({
          title: `Merged ${source.name} into ${into.name}`,
          description: 'It stays in the record.',
          action: { label: 'Undo', onPress: () => void restore(sourceId) },
        });
      }
    },
    [restore, save, toast],
  );

  const add = useCallback(
    async (draft: StakeholderDraft): Promise<boolean> => {
      const { set } = latest.current;
      const existing = set?.stakeholders ?? [];
      const added = addedStakeholder(
        draft,
        existing.map((item) => item.id),
      );
      const saved = await save([...existing, added], [...(set?.relations ?? [])]);
      if (saved) {
        latest.current.select(added.id);
        latest.current.focus(['inspector', `node:${added.id}`]);
        latest.current.say(`Added ${added.name}. It carries no evidence: it is your own.`);
      }
      return saved;
    },
    [save],
  );

  return { accept, edit, prioritise, restore, remove, merge, add };
}
