import type { ProjectDetail } from '../../../../shared/types';
import { useStakeholders } from '../../hooks/useStakeholders';
import { StakeholderWorkspace } from './StakeholderWorkspace';

export interface StakeholderPanelProps {
  project: ProjectDetail;
  /** Called after anything that changes what the next stages will use, such as approving the set. */
  onChanged: () => void;
}

/**
 * Discover, review and approve stakeholders, then turn them into actors. It sits at the top of the
 * Environment stage, where the actors it makes become the agents of the simulation.
 */
export function StakeholderPanel({ project, onChanged }: StakeholderPanelProps) {
  const state = useStakeholders(project.id, onChanged);
  return <StakeholderWorkspace state={state} />;
}
