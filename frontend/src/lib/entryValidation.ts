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
