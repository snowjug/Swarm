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

// ---- Arcs between the documents --------------------------------------------------------------------

export interface ArcInput {
  id: string;
  status: ContradictionStatus;
  /** Row of each side's document in the list. */
  from: number;
  to: number;
}

export interface Arc {
  id: string;
  status: ContradictionStatus;
  d: string;
  /** The two ends, where the dots go. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** The widest point of the curve. */
  apex: { x: number; y: number };
}

/**
 * Curves that join the places two conflicting statements sit (a row of the list, or a passage in it) on their
 * right edge, as an arc diagram. Arcs that cover some of the same height are stacked at different depths, the
 * shorter inside the longer, so that each can be seen and pointed at; arcs that do not meet share a depth.
 * Arcs that end in the same place are spread so that their dots do not sit on one another. A place that has not
 * been measured yet (not a number) leaves its arc out.
 */
export function arcGeometry(
  inputs: readonly ArcInput[],
  centres: readonly number[],
  gutter: number,
  x0 = 0,
): Arc[] {
  const total = new Map<number, number>();
  for (const input of inputs) {
    total.set(input.from, (total.get(input.from) ?? 0) + 1);
    total.set(input.to, (total.get(input.to) ?? 0) + 1);
  }
  const taken = new Map<number, number>();
  const spacing = 7;
  const place = (row: number, centre: number) => {
    const slot = taken.get(row) ?? 0;
    taken.set(row, slot + 1);
    return centre + (slot - ((total.get(row) ?? 1) - 1) / 2) * spacing;
  };

  const ends = inputs.flatMap((input) => {
    const ya = centres[input.from];
    const yb = centres[input.to];
    if (ya === undefined || yb === undefined || !Number.isFinite(ya) || !Number.isFinite(yb))
      return [];
    const y1 = place(input.from, ya);
    const y2 = place(input.to, yb);
    return [{ input, y1, y2, top: Math.min(y1, y2), bottom: Math.max(y1, y2) }];
  });

  // Shortest first, each at the first depth where nothing it overlaps in height already is.
  const levels = new Map<string, number>();
  const placed: { top: number; bottom: number; level: number }[] = [];
  for (const end of [...ends].sort(
    (a, b) => a.bottom - a.top - (b.bottom - b.top) || a.top - b.top,
  )) {
    let level = 0;
    while (
      placed.some(
        (other) =>
          other.level === level && other.top < end.bottom + 6 && end.top < other.bottom + 6,
      )
    ) {
      level += 1;
    }
    placed.push({ top: end.top, bottom: end.bottom, level });
    levels.set(end.input.id, level);
  }

  return ends.map(({ input, y1, y2 }) => {
    const level = levels.get(input.id) ?? 0;
    const span = Math.abs(y2 - y1);
    const depth = Math.min(Math.max(gutter - 6, 12), 18 + level * 17 + Math.min(span * 0.05, 10));
    const right = (x0 + depth).toFixed(1);
    return {
      id: input.id,
      status: input.status,
      d: `M${x0},${y1.toFixed(1)} C${right},${y1.toFixed(1)} ${right},${y2.toFixed(1)} ${x0},${y2.toFixed(1)}`,
      a: { x: x0, y: y1 },
      b: { x: x0, y: y2 },
      apex: { x: x0 + depth * 0.75, y: (y1 + y2) / 2 },
    };
  });
}
