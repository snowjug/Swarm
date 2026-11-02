import { Check, Copy, GitMerge, Pencil, Trash2, Undo2 } from 'lucide-react';
import type { Stakeholder } from '../../../../shared/stakeholders';
import {
  Button,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
} from '../../design/ui';

export interface PartyActionsProps {
  stakeholder: Stakeholder;
  /** Where it could be merged: parties that are not removed, not itself, and that can take another. */
  mergeTargets: readonly Stakeholder[];
  mergedInto: Stakeholder | null;
  busy: boolean;
  /** The short strip on a phone: merging is in the sheet that opens from it, where there is room for it. */
  compact?: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onMerge: (targetId: string) => void;
}

/** What a person can do to a stakeholder: accept it, change it, join it to another, take it off, or bring it back. */
export function PartyActions({
  stakeholder,
  mergeTargets,
  mergedInto,
  busy,
  compact = false,
  onAccept,
  onEdit,
  onDuplicate,
  onRemove,
  onRestore,
  onMerge,
}: PartyActionsProps) {
  const removed = stakeholder.status === 'removed';
  const canAccept = stakeholder.status === 'proposed' || stakeholder.status === 'edited';
  if (removed) {
    return (
      <div className="sw-insp__actions">
        <Button
          variant="primary"
          icon={<Undo2 size={16} aria-hidden="true" />}
          disabled={busy}
          onClick={onRestore}
          data-stk-focus="action"
        >
          {mergedInto ? 'Undo the merge' : 'Restore'}
        </Button>
      </div>
    );
  }
  return (
    <div className="sw-insp__actions">
      {canAccept && (
        <Button
          variant="primary"
          icon={<Check size={16} aria-hidden="true" />}
          disabled={busy}
          onClick={onAccept}
          data-stk-focus="action"
        >
          Accept
        </Button>
      )}
      <IconButton
        label={`Edit ${stakeholder.name}`}
        tone="glass"
        disabled={busy}
        onClick={onEdit}
        data-stk-focus={canAccept ? undefined : 'action'}
      >
        <Pencil size={16} aria-hidden="true" />
      </IconButton>
      {!compact && (
        <IconButton
          label={`Duplicate ${stakeholder.name}`}
          tone="glass"
          disabled={busy}
          onClick={onDuplicate}
        >
          <Copy size={16} aria-hidden="true" />
        </IconButton>
      )}
      {!compact && (
        <Menu>
          <MenuTrigger asChild>
            <IconButton
              label={`Merge ${stakeholder.name} into another`}
              tone="glass"
              disabled={busy || mergeTargets.length === 0}
            >
              <GitMerge size={16} aria-hidden="true" />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end" side="top" className="sw-menu--tall">
            <MenuLabel>Merge into</MenuLabel>
            {mergeTargets.map((target) => (
              <MenuItem key={target.id} onSelect={() => onMerge(target.id)}>
                {target.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
      <IconButton
        label={`Remove ${stakeholder.name}`}
        tone="glass"
        disabled={busy}
        onClick={onRemove}
        className="sw-insp__remove"
      >
        <Trash2 size={16} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
