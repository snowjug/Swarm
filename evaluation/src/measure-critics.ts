import { rateOf, type Rate } from './measure-stats.js';

export interface CritiqueLike {
  id: string;
  role: string;
  target: { kind: string; id: string };
}

/** The critiques of the flawed input that the unflawed input does not raise, by their stable ids. */
export function newCritiques<T extends CritiqueLike>(
  baseline: readonly CritiqueLike[],
  flawed: readonly T[],
): T[] {
  const known = new Set(baseline.map((critique) => critique.id));
  return flawed.filter((critique) => !known.has(critique.id));
}

export interface FlawRun {
  id: string;
  class: string;
  /** The roles in which an objection to this flaw would be at home. */
  roles: readonly string[];
  targetKinds?: readonly string[] | undefined;
  baseline: readonly CritiqueLike[];
  flawed: readonly CritiqueLike[];
}

/** Caught: a new critique, in an accepted role, and about an accepted kind of target when the label says. */
export function caughtBy(run: FlawRun): CritiqueLike[] {
  return newCritiques(run.baseline, run.flawed).filter(
    (critique) =>
      run.roles.includes(critique.role) &&
      (run.targetKinds === undefined || run.targetKinds.includes(critique.target.kind)),
  );
}

export interface CatchScores {
  overall: Rate;
  byClass: Record<string, Rate>;
  missed: string[];
}

export function scoreCatches(runs: readonly FlawRun[]): CatchScores {
  const classes = [...new Set(runs.map((run) => run.class))].sort();
  const caught = (run: FlawRun): boolean => caughtBy(run).length > 0;
  const byClass: Record<string, Rate> = {};
  for (const name of classes) {
    const own = runs.filter((run) => run.class === name);
    byClass[name] = rateOf(own.filter(caught).length, own.length);
  }
  return {
    overall: rateOf(runs.filter(caught).length, runs.length),
    byClass,
    missed: runs.filter((run) => !caught(run)).map((run) => run.id),
  };
}

export interface ControlRun {
  id: string;
  baseline: readonly CritiqueLike[];
  changed: readonly CritiqueLike[];
}

/** Inputs that carry no planted flaw must not raise a critique the unflawed input does not. */
export function scoreFalseAlarms(controls: readonly ControlRun[]): {
  count: number;
  of: number;
  where: { id: string; critique: string }[];
} {
  const where = controls.flatMap((control) =>
    newCritiques(control.baseline, control.changed).map((critique) => ({
      id: control.id,
      critique: critique.id,
    })),
  );
  return { count: where.length, of: controls.length, where };
}
