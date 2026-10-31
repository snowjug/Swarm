import {
  STAKEHOLDER_CATEGORY_LABELS,
  type Stakeholder,
  type StakeholderRelation,
} from '../../../../shared/stakeholders';
import { StakeholderRow } from './StakeholderRow';
import {
  MAX_MERGED,
  groupByCategory,
  liveStakeholders,
  mergeStakeholders,
  mergedIntoMap,
  replace,
  undoMerge,
} from './review';

/**
 * The stakeholders by category, key actors first, with the removed ones below where they can be
 * restored. Every action sends the whole list: the server checks it, and what comes back is shown.
 */
export function StakeholderList({
  stakeholders,
  relations,
  editable,
  busy,
  onSave,
}: {
  stakeholders: readonly Stakeholder[];
  relations: readonly StakeholderRelation[];
  editable: boolean;
  busy: boolean;
  onSave: (stakeholders: Stakeholder[], relations: StakeholderRelation[]) => Promise<boolean>;
}) {
  const groups = groupByCategory(stakeholders);
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
      onSave={(next) => change(stakeholder.id, next)}
      onMerge={(targetId) => {
        const merged = mergeStakeholders(stakeholders, relations, stakeholder.id, targetId);
        return onSave(merged.stakeholders, merged.relations);
      }}
      onUndoMerge={() => onSave(undoMerge(stakeholders, stakeholder.id), [...relations])}
      onRemove={() => change(stakeholder.id, { ...stakeholder, status: 'removed' })}
    />
  );

  return (
    <div className="stk-groups">
      {groups.map(({ category, items }) => (
        <section
          className="stk-group"
          key={category}
          aria-label={STAKEHOLDER_CATEGORY_LABELS[category]}
        >
          <h4>
            {STAKEHOLDER_CATEGORY_LABELS[category]}{' '}
            <span className="stk-count">{items.length}</span>
          </h4>
          <ul className="stk-rows">{items.map(row)}</ul>
        </section>
      ))}
      {removed.length > 0 && (
        <details className="stk-group stk-removed">
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
