import {
  isOpenConflict,
  type ContradictionKind,
  type ContradictionRecord,
  type ContradictionStatus,
} from '../../../../shared/evidence';
import type { Tone } from '../../design/ui';

export const CONFLICT_TONE: Record<ContradictionStatus, Tone> = {
  detected: 'caution',
  confirmed: 'critical',
  dismissed: 'neutral',
  resolved: 'favor',
};

/** In words, short: the status as a person says it, never only by its colour. */
export const CONFLICT_STATUS_SHORT: Record<ContradictionStatus, string> = {
  detected: 'Possible conflict',
  confirmed: 'Confirmed',
  dismissed: 'Not a conflict',
  resolved: 'Resolved',
};

export const CONFLICT_KIND_LABEL: Record<ContradictionKind, string> = {
  numeric: 'Different figures',
  polarity: 'Opposite statements',
};

export interface ConflictGroups {
  open: ContradictionRecord[];
  reviewed: ContradictionRecord[];
}

const byId = (a: ContradictionRecord, b: ContradictionRecord) =>
  Number(a.id.replace(/\D/gu, '')) - Number(b.id.replace(/\D/gu, '')) || a.id.localeCompare(b.id);

/** Open ones are what weigh on the statements; reviewed ones are kept, and can be changed. */
export function groupConflicts(conflicts: readonly ContradictionRecord[]): ConflictGroups {
  const sorted = [...conflicts].sort(byId);
  return {
    open: sorted.filter((conflict) => isOpenConflict(conflict.status)),
    reviewed: sorted.filter((conflict) => !isOpenConflict(conflict.status)),
  };
}

/** The words the two statements share, for a person to read at a glance. */
export function sharedWords(topic: string): string[] {
  return topic.split(/\s+/u).filter(Boolean);
}

export function conflictFigures(
  conflict: ContradictionRecord,
): { left: string; right: string } | null {
  return conflict.leftValue && conflict.rightValue
    ? { left: conflict.leftValue, right: conflict.rightValue }
    : null;
}

/** "X1: 44% against 16%": what a screen reader hears for a conflict. */
export function conflictLabel(conflict: ContradictionRecord): string {
  const figures = conflictFigures(conflict);
  return `${conflict.id}: ${
    figures
      ? `${figures.left} against ${figures.right}`
      : CONFLICT_KIND_LABEL[conflict.kind].toLowerCase()
  }, ${CONFLICT_STATUS_SHORT[conflict.status].toLowerCase()}, between ${conflict.left.documentName} and ${conflict.right.documentName}`;
}
