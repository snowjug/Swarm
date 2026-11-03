import type { ResearchIntakeInput, ResearchStatus } from '../../../shared/research';

/** A run is under way, or waits for a person to let it go on: its state will change without anyone asking. */
export function isLive(status: ResearchStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'paused';
}

const typed = new Map<string, ResearchIntakeInput>();

/**
 * What a person asked of research when the project was made. The server does not keep it, so a start that is made
 * afterwards (a try again that follows a start that did not get through) repeats it. It lasts as long as the page.
 */
export function rememberIntake(projectId: string, intake: ResearchIntakeInput | undefined): void {
  if (intake) typed.set(projectId, intake);
}

export function recalledIntake(projectId: string): ResearchIntakeInput | undefined {
  return typed.get(projectId);
}
