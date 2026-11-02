/**
 * Which two scenarios the page sets against each other. `a` is the reference (the baseline, unless the person
 * chose otherwise) and `b` is the one set against it. Everything on the page that is a difference is `b` minus
 * `a`, read on the seeds both ran. With one scenario there is nothing to set against, and `b` is null.
 */
export interface Pair {
  a: string;
  b: string | null;
}

interface Choice {
  id: string;
  kind: 'baseline' | 'alternative';
}

/** The baseline against the proposed change: the first alternative, as the engine's own summary reads it. */
export function defaultPair(scenarios: readonly Choice[]): Pair {
  const a = scenarios.find((scenario) => scenario.kind === 'baseline') ?? scenarios[0];
  if (!a) return { a: '', b: null };
  const b =
    scenarios.find((scenario) => scenario.kind === 'alternative' && scenario.id !== a.id) ??
    scenarios.find((scenario) => scenario.id !== a.id);
  return { a: a.id, b: b?.id ?? null };
}

/** The pair, kept to scenarios that exist: one that was removed, or never was, falls back to the default. */
export function validPair(pair: Pair | null, scenarios: readonly Choice[]): Pair {
  if (!pair) return defaultPair(scenarios);
  const has = (id: string): boolean => scenarios.some((scenario) => scenario.id === id);
  if (!has(pair.a)) return defaultPair(scenarios);
  if (pair.b !== null && has(pair.b) && pair.b !== pair.a) return pair;
  const other =
    scenarios.find((scenario) => scenario.kind === 'alternative' && scenario.id !== pair.a) ??
    scenarios.find((scenario) => scenario.id !== pair.a);
  return { a: pair.a, b: other?.id ?? null };
}

/** Sets the scenario that is set against the reference. Choosing the reference itself swaps the two. */
export function setAgainst(pair: Pair, scenarios: readonly Choice[], id: string): Pair {
  if (!scenarios.some((scenario) => scenario.id === id)) return pair;
  if (id === pair.a) return pair.b === null ? pair : { a: pair.b, b: pair.a };
  return { a: pair.a, b: id };
}

/** Sets the reference. Choosing the scenario that is set against it swaps the two. */
export function setReference(pair: Pair, scenarios: readonly Choice[], id: string): Pair {
  if (!scenarios.some((scenario) => scenario.id === id)) return pair;
  if (id === pair.b) return { a: pair.b, b: pair.a };
  return { a: id, b: pair.b };
}

export function swapPair(pair: Pair): Pair {
  return pair.b === null ? pair : { a: pair.b, b: pair.a };
}

export const samePair = (x: Pair, y: Pair): boolean => x.a === y.a && x.b === y.b;
