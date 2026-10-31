import { createProjectSchema } from '../../../shared/types';
import type { CreateProjectInput, ValidatedProjectInput } from '../../../shared/types';

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
