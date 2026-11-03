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

export const researchApi = {
  /** The latest run of the project's research, or none, with what the person may do to it. */
  get: (id: string, signal?: AbortSignal) => view(researchPath(id), { signal }),
  /** Starts a run. Without a body it uses what the person asked for when the project was made. */
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
};
