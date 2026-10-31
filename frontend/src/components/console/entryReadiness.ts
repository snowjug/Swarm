import { createProjectSchema } from '../../../../shared/types';
import type { CreateProjectInput } from '../../../../shared/types';

export interface EntryReadiness {
  /** Whether a question has been written that is long enough to build from: from then on the bar stays in reach. */
  asked: boolean;
  /** Whether the form would be accepted as it is. */
  ready: boolean;
  /** What the person needs to know beside the button that builds, in a few words. */
  text: string;
}

const MIN_QUESTION = 10;

/**
 * Where the entry form stands, from the same rules that accept or refuse it when it is sent, so that
 * "ready to build" is never said of a form that would be refused. It reads nothing but what the form holds.
 */
export function entryReadiness(input: CreateProjectInput): EntryReadiness {
  const asked = input.question.trim().length >= MIN_QUESTION;
  const documents = input.documents.length;
  const parsed = createProjectSchema.safeParse(input);
  if (parsed.success) {
    return {
      asked,
      ready: true,
      text: `${documents} ${documents === 1 ? 'document' : 'documents'} attached · ready to build`,
    };
  }
  const failing = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  const text = failing.has('question')
    ? `Write your question first: ${MIN_QUESTION} characters or more`
    : failing.has('documents')
      ? documents === 0
        ? 'No documents attached yet · attach at least one to build'
        : 'Check the attached documents before building'
      : failing.has('name')
        ? 'Check the project name before building'
        : failing.has('settings')
          ? 'Check the run settings before building'
          : 'Check the form before building';
  return { asked, ready: false, text };
}
