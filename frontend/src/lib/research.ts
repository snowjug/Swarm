import type { ResearchIntakeInput, ResearchStatus } from '../../../shared/research';

/** A run is under way, or waits for a person to let it go on: its state will change without anyone asking. */
export function isLive(status: ResearchStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'paused';
}

const typed = new Map<string, ResearchIntakeInput>();

/**
 * Whether making a project starts research, rather than the reading of its evidence. Research starts when it was
 * asked for (`auto`) and there is something for it to do: the project has no source of its own, or the person named
 * a site or a page for it to read. A project with sources of its own and no site named is grounded on them, as it
 * always was, and so is every project that did not ask for research. The first screen says what will happen by
 * this rule, and the hook that makes the project does it.
 */
export function startsResearch(input: {
  documents: readonly unknown[];
  research?: ResearchIntakeInput | undefined;
}): boolean {
  const { research } = input;
  if (research?.auto !== true) return false;
  return input.documents.length === 0 || Boolean(research.url || research.domain);
}

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
