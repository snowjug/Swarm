import type { MouseEventHandler } from 'react';
import type { ConsoleStep } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { useCritiques } from '../../hooks/useCritiques';
import { CriticPanel } from '../critics/CriticPanel';
import { reviewStatus } from '../critics/reviewStatus';
import { DecisionBriefView } from './DecisionBriefView';
import { ReportJumpBar } from './ReportJumpBar';

export interface ReportSeamProps {
  project: ProjectDetail;
  onClickCapture?: MouseEventHandler<HTMLDivElement>;
  /** The brief is read again whenever this changes: a fresh read of the project, or a change to the review beside it. */
  briefRefreshToken?: string;
  /** The review is read again whenever this changes: a fresh read of the project, or a change to the lab's record. */
  reviewRefreshToken?: string;
  /** Told after the server took a change to the review, so that the brief beside it can read its freshness again. */
  onReviewChanged?: () => void;
  /** Moves to another stage, so that a person with no current analysis can be sent to run one. */
  onNavigate?: (step: ConsoleStep) => void;
  /**
   * Changes each time a hand-off asks for focus on the brief. It is given once the brief has settled,
   * since the element that took focus while the brief was loading is replaced by the one that stays.
   */
  focusBriefToken?: number;
}

/**
 * The top of the Report stage: the way around it, then the decision brief and the independent review.
 * The review is read here, once, so that the bar can say where it stands and the panel shows the same
 * review; a project that is switched to starts both afresh.
 */
function ReportParts({
  project,
  onClickCapture,
  briefRefreshToken,
  reviewRefreshToken,
  onReviewChanged,
  onNavigate,
  focusBriefToken,
}: ReportSeamProps) {
  const critiques = useCritiques(project.id, {
    refreshOn: reviewRefreshToken,
    onChanged: onReviewChanged,
  });
  return (
    <>
      <ReportJumpBar review={reviewStatus(critiques.view, critiques.error !== null)} />
      <div className="seam-stack" onClickCapture={onClickCapture}>
        <DecisionBriefView
          project={project}
          refreshToken={briefRefreshToken}
          onNavigate={onNavigate}
          focusToken={focusBriefToken}
        />
        <CriticPanel project={project} state={critiques} onNavigate={onNavigate} />
      </div>
    </>
  );
}

export function ReportSeam(props: ReportSeamProps) {
  return <ReportParts key={props.project.id} {...props} />;
}
