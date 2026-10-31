import type { MouseEventHandler } from 'react';
import type { ProjectDetail } from '../../../../shared/types';
import { useCritiques } from '../../hooks/useCritiques';
import { CriticPanel } from '../critics/CriticPanel';
import { reviewStatus } from '../critics/reviewStatus';
import { DecisionBriefView } from './DecisionBriefView';
import { ReportJumpBar } from './ReportJumpBar';

export interface ReportSeamProps {
  project: ProjectDetail;
  onClickCapture?: MouseEventHandler<HTMLDivElement>;
}

/**
 * The top of the Report stage: the way around it, then the decision brief and the independent review.
 * The review is read here, once, so that the bar can say where it stands and the panel shows the same
 * review; a project that is switched to starts both afresh.
 */
function ReportParts({ project, onClickCapture }: ReportSeamProps) {
  const critiques = useCritiques(project.id);
  return (
    <>
      <ReportJumpBar review={reviewStatus(critiques.view, critiques.error !== null)} />
      <div className="seam-stack" onClickCapture={onClickCapture}>
        <DecisionBriefView project={project} />
        <CriticPanel project={project} state={critiques} />
      </div>
    </>
  );
}

export function ReportSeam(props: ReportSeamProps) {
  return <ReportParts key={props.project.id} {...props} />;
}
