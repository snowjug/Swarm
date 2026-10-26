import type { ProjectStatus, Stage } from '../../../shared/types';

export const isActive = (status: ProjectStatus) => status === 'queued' || status === 'running';
export const canRun = (status: ProjectStatus) =>
  status === 'draft' || status === 'failed' || status === 'cancelled';
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
export const count = (value: number) => value.toLocaleString();

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
}

export const stageLabels: Record<Stage, string> = {
  intake: 'Source intake',
  knowledge: 'Knowledge map',
  personas: 'Fictional personas',
  simulation: 'Simulation',
  report: 'Report',
  complete: 'Complete',
};

export const stages: Stage[] = [
  'intake',
  'knowledge',
  'personas',
  'simulation',
  'report',
  'complete',
];

export function sourceLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
