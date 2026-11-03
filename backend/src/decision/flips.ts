import type { SensitivityRow } from '../../../shared/analysis.js';
import type { Counterfactual } from '../../../shared/constraints.js';
import type { Flip } from './status.js';
import { embed, signed } from './words.js';

/**
 * Which of the checks the project has already run could put another option ahead of the leader.
 *
 * The counterfactual views and the sensitivity rows both measure one thing: how far the headline share
 * (simulated members ending in switch or resist, every actor counting equally) of the proposed change
 * moves when one limit or one assumption changes, on the same seeds. That is the headline lens’s own
 * measure, so it can be set beside the options’ values on it. A check could reverse the leader when it
 * moves the proposed option’s value by more than the leader’s margin over it, in the direction that
 * closes the gap; the other options were not re-run under the check, so this says the order could
 * change and never that it would. A check that is not clearly larger than its own noise is not counted.
 */

export interface FlipWorld {
  /** The headline lens value of every option that can be chosen: lower is better. */
  values: ReadonlyMap<string, number>;
  /** The option the views and the rows are about: the proposed change. */
  proposedId: string | null;
}

export function couldReverse(world: FlipWorld, leaderId: string, effect: number): boolean {
  const lead = world.values.get(leaderId);
  const proposed = world.proposedId;
  if (lead === undefined || proposed === null || !Number.isFinite(effect)) return false;
  if (proposed === leaderId) {
    const others = [...world.values]
      .filter(([id]) => id !== leaderId)
      .map(([, value]) => value - lead);
    return others.length > 0 && effect > 0 && effect >= Math.min(...others) - 1e-12;
  }
  const own = world.values.get(proposed);
  return own !== undefined && effect < 0 && -effect >= own - lead - 1e-12;
}

const MOVED = 'the simulated share of members ending in switch or resist';
const CAVEAT = 'The other options were not re-run under it.';

export function counterfactualFlips(
  views: readonly Counterfactual[],
  world: FlipWorld,
  leaderId: string,
): Flip[] {
  return views
    .filter(
      (view) =>
        view.applicable &&
        view.classification === 'material' &&
        view.deltaVsBase !== null &&
        couldReverse(world, leaderId, view.deltaVsBase),
    )
    .map((view) => ({
      kind: 'counterfactual' as const,
      id: view.id,
      text: `the view ${embed(view.label, 80)} held. In the simulation it moved ${MOVED} by ${signed(view.deltaVsBase ?? 0)}, more than the margin it leads by. ${CAVEAT}`,
    }));
}

export function assumptionFlips(
  rows: readonly SensitivityRow[],
  world: FlipWorld,
  leaderId: string,
): Flip[] {
  return rows
    .filter(
      (row) =>
        row.classification === 'assumption-sensitive' && couldReverse(world, leaderId, row.shift),
    )
    .map((row) => ({
      kind: 'assumption' as const,
      id: row.id,
      text: `the assumption ${embed(row.label, 110)} moved the same way. In the simulation that moved ${MOVED} by ${signed(row.shift)}, more than the margin it leads by. ${CAVEAT}`,
    }));
}
