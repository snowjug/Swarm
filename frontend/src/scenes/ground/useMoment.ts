import { useEffect, useMemo, useState } from 'react';
import { useGroundData } from './context';
import { knowledgePhases, momentOf, type Moment, type Phase } from './model';

/** How long the conflicts are looked for before the page says so: a check that is over at once is not announced. */
const CHECKING_AFTER_MS = 350;

function useAfter(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setLate(true), ms);
    return () => window.clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}

/**
 * What the evidence is doing now, for the parts of the page that say it (the status, the progress, the rows of the
 * tray): the stage the engine's step is in, the phase it is in, and whether the conflicts are still being looked for.
 */
export function useMoment(): { moment: Moment; checking: boolean; phases: Phase[] } {
  const { project, stage, conflictsKnown, ledger } = useGroundData();
  const phases = useMemo(() => knowledgePhases(project), [project]);
  // The engine is done and the sources are being compared for conflicts: the last thing before they are ready.
  const checking = useAfter(
    conflictsKnown && ledger.ledger === null && ledger.error === null,
    CHECKING_AFTER_MS,
  );
  return { moment: momentOf(stage, phases, checking), checking, phases };
}
