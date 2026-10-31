import type { ProjectDetail } from '../../../../shared/types';

export interface StakeholderPanelProps {
  project: ProjectDetail;
  /** Called after anything that changes what the next stages will use, such as approving the set. */
  onChanged: () => void;
}

/** Discover, review and approve stakeholders, then turn them into actors. Replaced by that feature. */
export function StakeholderPanel(_props: StakeholderPanelProps) {
  return null;
}
