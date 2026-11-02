import type { SensitivityRow } from '../../../../shared/analysis';
import { sensitivityView } from '../../lib/analysis';
import { niceStep } from './scale';

/** The assumptions that moved the result most first, in either direction; ties keep the order the engine gave. */
export function tornadoOrder(rows: readonly SensitivityRow[]): SensitivityRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => Math.abs(y.row.shift) - Math.abs(x.row.shift) || x.index - y.index)
    .map((entry) => entry.row);
}

/**
 * How far the bars run, to a round figure: the largest shift with its noise, so that every bar and every
 * whisker fits and the biggest is not squeezed into a corner by a scale made for something else.
 */
export function tornadoReach(rows: readonly SensitivityRow[]): number {
  const largest = Math.max(0, ...rows.map((row) => Math.abs(row.shift) + row.standardError));
  const steps = [0.02, 0.05, 0.1, 0.2, 0.5, 1];
  return steps.find((step) => step >= largest * 1.05) ?? niceStep(largest);
}

/** How many of the assumptions moved the result clearly, as the page says it, and whether that is a finding at all. */
export function sensitivityTally(
  rows: readonly SensitivityRow[],
  noEffect: boolean,
): { total: number; sensitive: number; untestable: number } {
  const labels = rows.map((row) => sensitivityView(row.classification, noEffect).label);
  return {
    total: rows.length,
    sensitive: rows.filter((row) => row.classification === 'assumption-sensitive').length,
    untestable: labels.filter((label) => label === 'No effect to test').length,
  };
}
