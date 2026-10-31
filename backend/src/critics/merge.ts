import type { Critique } from '../../../shared/critique.js';

/**
 * A critique that comes back with the same id keeps what a person said to it, and when it was first
 * raised. Everything else (the wording, the basis, the severity) is the new run's own.
 */
export function carryResponses(
  next: readonly Critique[],
  previous: readonly Critique[],
): Critique[] {
  const before = new Map(previous.map((critique) => [critique.id, critique]));
  return next.map((critique) => {
    const earlier = before.get(critique.id);
    if (!earlier) return critique;
    return {
      ...critique,
      status: earlier.status,
      response: earlier.response,
      remainingDisagreement: earlier.remainingDisagreement,
      createdAt: earlier.createdAt,
    };
  });
}
