import type { ConsoleStep } from '../../../../shared/guided';
import {
  COMPARISON_INPUTS_UNRECORDED,
  UNRECORDED_INPUTS_ADVICE,
  comparisonInputsUnrecorded,
  inputsInWords,
  staleComparisonInputs,
} from '../../../../shared/analysis';
import type { BriefView } from '../../../../shared/brief';
import { Notice } from '../ui';

/**
 * One notice, above a brief that no longer matches what it was made from. What changed is listed, and
 * the way back to a current brief depends on what it is: a change to the scenario, the stakeholders
 * or the actors means the comparison itself has to be run again, since writing the brief again from
 * the same comparison would describe the new decision with the old runs; anything else, such as an
 * answer to a critique or a newer comparison, is brought up to date by writing the brief again. A
 * comparison that recorded nothing of what it was made from cannot be told from a current one, so
 * that is said for as long as the brief rests on it.
 */
export function BriefFreshness({
  view,
  onNavigate,
}: {
  view: Pick<BriefView, 'changedSince' | 'visualsFrom' | 'may'>;
  onNavigate?: (step: ConsoleStep) => void;
}) {
  const { changedSince } = view;
  if (changedSince.length === 0) return null;
  const unrecorded = comparisonInputsUnrecorded(changedSince);
  const changed = changedSince.filter((entry) => entry !== COMPARISON_INPUTS_UNRECORDED);
  const rerun = staleComparisonInputs(changedSince);
  const again = view.may.generate
    ? 'Run the comparison again in the Simulation stage, then generate the brief again.'
    : 'Ask someone who can edit the project to run the comparison again and generate the brief again.';
  const advice =
    rerun.length > 0
      ? `The comparison it rests on was run before ${inputsInWords(rerun)} changed, so it describes the project as it was. ${again}`
      : changed.length === 0
        ? ''
        : view.may.generate
          ? 'Generate it again to bring it up to date.'
          : 'Ask someone who can edit the project to generate it again.';
  return (
    <Notice
      tone="warning"
      title="This brief may be out of date"
      action={
        (rerun.length > 0 || unrecorded) && onNavigate ? (
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={() => onNavigate('simulation')}
          >
            Open the Simulation stage
          </button>
        ) : undefined
      }
    >
      {changed.length > 0 ? `Since it was made, this has changed: ${changed.join(', ')}. ` : ''}
      {advice}
      {unrecorded ? `${advice ? ' ' : ''}${UNRECORDED_INPUTS_ADVICE} ${again}` : ''}
      {view.visualsFrom === 'current'
        ? ' Its charts show the project as it is now, not as it was when the brief was made.'
        : ''}
    </Notice>
  );
}
