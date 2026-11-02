import type { RoundMetrics } from '../../../shared/guided';

export const metricLabels: Record<keyof RoundMetrics, string> = {
  meanOpinion: 'Mean inclination',
  supportShare: 'Support share',
  oppositionShare: 'Opposition share',
  undecidedShare: 'Undecided share',
  polarization: 'Polarization',
  activityCount: 'Recorded actions',
};
export const trajectoryMetrics = [
  'meanOpinion',
  'supportShare',
  'oppositionShare',
  'undecidedShare',
  'polarization',
] as const;
export const comparisonMetrics: (keyof RoundMetrics)[] = [...trajectoryMetrics, 'activityCount'];
