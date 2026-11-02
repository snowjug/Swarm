import {
  ANALYSIS_INPUT_NAMES,
  comparisonInputsUnrecorded,
  inputsInWords,
  staleComparisonInputs,
  type AnalysisInput,
} from '../../../../shared/analysis';
import type { AnalysisSummary } from '../../../../shared/analysis-plan';
import type { BriefView } from '../../../../shared/brief';

/**
 * Where a comparison stands against the project as it is now. The comparison records which version of the scenario,
 * the stakeholders and the actors it was made from; the brief's view says which of them have changed since. That is
 * the only place the data layer says so, so it is only known when a brief exists that rests on this comparison.
 */
export interface Freshness {
  /** Whether anything says; when nothing does, the page says nothing either. */
  known: boolean;
  /** The documents changed since this comparison ran, whose change only running it again brings up to date. */
  changed: AnalysisInput[];
  /** Saved before what a comparison is made from was recorded, so that it cannot be told. */
  unrecorded: boolean;
}

export const UNKNOWN: Freshness = { known: false, changed: [], unrecorded: false };

export function freshnessOf(
  view: Pick<BriefView, 'brief' | 'changedSince'> | null,
  analysisId: string,
): Freshness {
  if (!view?.brief || view.brief.analysisId !== analysisId) return UNKNOWN;
  return {
    known: true,
    changed: staleComparisonInputs(view.changedSince),
    unrecorded: comparisonInputsUnrecorded(view.changedSince),
  };
}

/** "the scenario and the stakeholders changed", said once, in the words the brief uses. */
export function changedSentence(changed: readonly AnalysisInput[]): string {
  const words = inputsInWords(changed);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${changed.length === 1 && changed[0] !== 'actors' ? 'has' : 'have'} changed since this comparison ran, so it describes the project as it was.`;
}

export const CHANGED_NAMES = ANALYSIS_INPUT_NAMES;

/** The newest finished comparison, when it is not the one on show: an older one is being read. */
export function newerThan(
  summaries: readonly AnalysisSummary[],
  current: { id: string; createdAt: string },
): AnalysisSummary | null {
  const newest = summaries
    .filter((summary) => summary.status === 'completed')
    .sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))[0];
  if (!newest || newest.id === current.id) return null;
  return Date.parse(newest.createdAt) > Date.parse(current.createdAt) ? newest : null;
}
