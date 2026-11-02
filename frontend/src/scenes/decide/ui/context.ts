import { createContext, useContext } from 'react';
import type { BriefStatement, BriefVisuals, DecisionBrief } from '../../../../../shared/brief';
import type { Critique } from '../../../../../shared/critique';
import type { UiMode } from '../../../lib/mode';
import type { AnalysisFacts } from '../model/analysis-model';
import type { Anchors } from '../model/critique-model';

/** What every part of the document reads of the brief, the review beside it and the analysis behind it. */
export interface DocContextValue {
  projectId: string;
  mode: UiMode;
  brief: DecisionBrief;
  visuals: BriefVisuals | null;
  statementById: ReadonlyMap<string, BriefStatement>;
  critiques: readonly Critique[];
  anchors: Anchors;
  facts: AnalysisFacts | null;
  factsLoading: boolean;
  /** Opens the independent review, on one criticism when it is named. */
  openReview: (critiqueId?: string) => void;
  /** Changes when the review has just been run, so that the notes in the margin arrive rather than appear. */
  arrival: number;
}

export const DocContext = createContext<DocContextValue | null>(null);

export function useDoc(): DocContextValue {
  const value = useContext(DocContext);
  if (!value) throw new Error('A part of the decision document needs the document above it.');
  return value;
}
