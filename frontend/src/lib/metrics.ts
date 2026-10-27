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

export function metricValue(
  value: number | null | undefined,
  metric: keyof RoundMetrics,
  delta = false,
): string {
  if (value === undefined || value === null) return 'Not recorded';
  return `${delta && value > 0 ? '+' : ''}${metric === 'activityCount' ? value : value.toFixed(3)}`;
}
