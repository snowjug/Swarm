import { createProjectSchema } from '../../../shared/types';
import type {
  CreateProjectInput,
  SimulationSettings,
  ValidatedProjectInput,
} from '../../../shared/types';
import type { ScenarioFrame } from '../../../shared/scenario';

/**
 * What the entry form sends, before it is validated: a project name from the question when the person
 * gave none, and the scenario read from the question when there is one. Nothing is sent as a scenario
 * that the person did not go through intake for.
 */
export function entryInput(form: {
  name: string;
  question: string;
  documents: CreateProjectInput['documents'];
  settings: SimulationSettings;
  frame: ScenarioFrame | null;
}): CreateProjectInput {
  return {
    name: form.name.trim() ? form.name : nameFromQuestion(form.question),
    question: form.question,
    documents: form.documents,
    settings: form.settings,
    workflow: 'guided',
    ...(form.frame ? { scenario: form.frame } : {}),
  };
}

export function validateEntry(
  input: CreateProjectInput,
): { data: ValidatedProjectInput; error?: never } | { error: string; data?: never } {
  const parsed = createProjectSchema.safeParse(input);
  if (parsed.success) return { data: parsed.data };
  const messages = parsed.error.issues.map((issue) => {
    const field = issue.path[0];
    if (field === 'name') return 'Enter a project name of 3–100 characters.';
    if (field === 'question') return 'Enter a research question of 10–2,000 characters.';
    if (field === 'documents' && !input.documents.length)
      return 'Attach at least one source document (80–40,000 characters). Pasted source text must be attached before submitting.';
    return `${issue.path.join('.')}: ${issue.message}`;
  });
  return { error: [...new Set(messages)].join('\n') };
}

/** A name for a project whose person gave none: the start of the question, cut at a word. */
export function nameFromQuestion(question: string): string {
  const text = question.replace(/\s+/gu, ' ').trim();
  if (text.length < 3) return 'Untitled scenario';
  if (text.length <= 80) return text;
  const cut = text.slice(0, 80);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 40 ? space : 80)}…`;
}
