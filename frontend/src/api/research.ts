import { z } from 'zod';
import {
  discoveryStatusSchema,
  researchRunSchema,
  type ResearchBudget,
  type ResearchIntakeInput,
  type ResearchView,
} from '../../../shared/research';
import { ApiError, jsonBody, request } from '../api';

const viewSchema = z.object({
  run: researchRunSchema.nullable(),
  revision: z.number().int().min(0),
  discovery: discoveryStatusSchema,
  may: z.object({ start: z.boolean(), pause: z.boolean(), cancel: z.boolean() }),
});

/**
 * What the server sent, held to the contract. Every enumeration the page words (a stage, an outcome, a category) is
 * then a member of its list, so that nothing here is looked up by a value the page has no words for.
 */
export function parseResearchView(value: unknown): ResearchView {
  const parsed = viewSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      'The server sent research results that this page cannot read. Refresh and retry.',
      'UNREADABLE_RESPONSE',
    );
  }
  return parsed.data;
}

const researchPath = (id: string) => `/api/projects/${encodeURIComponent(id)}/research`;

async function view(path: string, init: RequestInit): Promise<ResearchView> {
  return parseResearchView(await request<unknown>(path, init));
}

const post = (path: string, signal?: AbortSignal) => view(path, { method: 'POST', signal });

/** A source of a person's own, as the server takes it: text with a name, and for a PDF the pages it had. */
export interface OwnDocument {
  name: string;
  content: string;
  pageCount?: number;
}

export const researchApi = {
  /** The latest run of the project's research, or none, with what the person may do to it. */
  get: (id: string, signal?: AbortSignal) => view(researchPath(id), { signal }),
  /** Starts a run. The server keeps nothing of what was typed when the project was made: a start repeats it. */
  start: (
    id: string,
    input: { intake?: ResearchIntakeInput; budget?: Partial<ResearchBudget> } = {},
    signal?: AbortSignal,
  ) => view(researchPath(id), { ...jsonBody(input), signal }),
  pause: (id: string, signal?: AbortSignal) => post(`${researchPath(id)}/pause`, signal),
  resume: (id: string, signal?: AbortSignal) => post(`${researchPath(id)}/resume`, signal),
  cancel: (id: string, signal?: AbortSignal) => post(`${researchPath(id)}/cancel`, signal),
  /** Stops reading and carries on with what was found. */
  finish: (id: string, signal?: AbortSignal) => post(`${researchPath(id)}/finish`, signal),
  /** A page or a site the person names. The server applies the same safety rules as to any other address. */
  addSource: (id: string, url: string, signal?: AbortSignal) =>
    view(`${researchPath(id)}/sources`, { ...jsonBody({ url }), signal }),
  /**
   * Text a person pasted or attached, added as the sources of a project that has none (or room for more) and that has
   * not been grounded. The server queues the grounding with it, so nothing else is asked; what it answers is the
   * project, which the page reads again.
   */
  addDocuments: async (id: string, documents: readonly OwnDocument[], signal?: AbortSignal) => {
    await request<unknown>(`/api/projects/${encodeURIComponent(id)}/evidence/documents`, {
      ...jsonBody({
        documents: documents.map(({ name, content, pageCount }) => ({
          name,
          content,
          ...(pageCount === undefined ? {} : { pageCount }),
        })),
      }),
      signal,
    });
  },
};
