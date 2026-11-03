import type { ResearchStatus } from '../../../shared/research';

/** A run is under way, or waits for a person to let it go on: its state will change without anyone asking. */
export function isLive(status: ResearchStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'paused';
}
