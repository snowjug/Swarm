import type { Stakeholder, StakeholderRelation } from '../../../../shared/stakeholders';
import { StakeholderRow } from './StakeholderRow';
import type { ReviewHooks } from './focus';
import {
  MAX_MERGED,
  liveStakeholders,
  mergeStakeholders,
  mergedIntoMap,
  orderForReview,
  replace,
  undoMerge,
} from './review';

/**
 * The stakeholders in the order of their priority, key actors first, with the removed ones below where
 * they can be restored. Every action sends the whole list: the server checks it, and what comes back is
 * shown. A change that takes a row out of its place leaves focus on its neighbour, and says what happened.
 */
export function StakeholderList({
  stakeholders,
  relations,
  editable,
  busy,
  onSave,
  hooks,
}: {
  stakeholders: readonly Stakeholder[];
  relations: readonly StakeholderRelation[];
  editable: boolean;
  busy: boolean;
  onSave: (stakeholders: Stakeholder[], relations: StakeholderRelation[]) => Promise<boolean>;
  hooks: ReviewHooks;
}) {
  const ordered = orderForReview(stakeholders);
  const live = liveStakeholders(stakeholders);
  const removed = stakeholders.filter((stakeholder) => stakeholder.status === 'removed');
  const mergedInto = mergedIntoMap(stakeholders);
  const change = (id: string, next: Stakeholder) =>
    onSave(
      replace(stakeholders, id, () => next),
      [...relations],
    );
  const row = (stakeholder: Stakeholder) => (
    <StakeholderRow
      key={stakeholder.id}
      stakeholder={stakeholder}
      mergeTargets={live.filter(
        (candidate) => candidate.id !== stakeholder.id && candidate.mergedFrom.length < MAX_MERGED,
      )}
      mergedInto={mergedInto.get(stakeholder.id) ?? null}
      editable={editable}
      busy={busy}
      hooks={hooks}
      onSave={(next) => change(stakeholder.id, next)}
      onMerge={async (targetId) => {
        const merged = mergeStakeholders(stakeholders, relations, stakeholder.id, targetId);
        const saved = await onSave(merged.stakeholders, merged.relations);
        if (saved) {
          const into = stakeholders.find((candidate) => candidate.id === targetId);
          hooks.focus([`toggle:${targetId}`, 'region:stakeholders']);
          hooks.say(
            `Merged ${stakeholder.name} into ${into?.name ?? 'the other'}. ${stakeholder.name} stays in the record, under Removed.`,
          );
        }
        return saved;
      }}
      onUndoMerge={async () => {
        const saved = await onSave(undoMerge(stakeholders, stakeholder.id), [...relations]);
        if (saved) {
          hooks.focus([`toggle:${stakeholder.id}`, 'region:stakeholders']);
          hooks.say(`Undid the merge of ${stakeholder.name}. It is back in the list.`);
        }
        return saved;
      }}
      onRemove={async () => {
        const at = ordered.findIndex((candidate) => candidate.id === stakeholder.id);
        const neighbour = ordered[at + 1] ?? ordered[at - 1];
        const saved = await change(stakeholder.id, { ...stakeholder, status: 'removed' });
        if (saved) {
          hooks.focus([...(neighbour ? [`toggle:${neighbour.id}`] : []), 'region:stakeholders']);
          hooks.say(
            `Removed ${stakeholder.name}. It stays in the record: restore it from Removed, below the list.`,
          );
        }
        return saved;
      }}
    />
  );

  return (
    <div className="stk-groups">
      <ul className="stk-rows" aria-label="Stakeholders, key actors first">
        {ordered.map(row)}
      </ul>
      {removed.length > 0 && (
        <details className="stk-removed">
          <summary>
            Removed <span className="stk-count">{removed.length}</span>{' '}
            <span className="stk-hint">Any of them can be restored.</span>
          </summary>
          <ul className="stk-rows">{removed.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
