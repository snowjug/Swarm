import type { Finding } from '../../../../shared/analysis';

/** The findings that count what a change sets off, across all the runs, for one scenario. */
export const secondOrderFindings = (findings: readonly Finding[], variantId: string): Finding[] =>
  findings.filter(
    (finding) => finding.kind === 'second-order-event' && finding.variantId === variantId,
  );

/**
 * How often an event like this one occurred across the runs, when the engine counted it: the finding about the same
 * kind of event by the same actor in the same scenario. The count is the finding's own; nothing is worked out here.
 */
export function acrossRuns(
  findings: readonly Finding[],
  variantId: string,
  event: { kind: string; actorId: string | null },
): Finding | null {
  return (
    secondOrderFindings(findings, variantId).find(
      (finding) => finding.actorId === event.actorId && finding.statement.includes(event.kind),
    ) ?? null
  );
}
