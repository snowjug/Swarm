import type {
  CritiqueResponseInput,
  CritiquesView,
  RunCritiquesInput,
} from '../../../shared/critique';
import { jsonBody, request } from '../api';

const base = (projectId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/critiques`;

/** The independent review of an analysis. Every change answers with the review as it now is. */
export const criticsApi = {
  read: (projectId: string, signal?: AbortSignal) =>
    request<CritiquesView>(base(projectId), { signal }),
  run: (projectId: string, input: RunCritiquesInput, signal?: AbortSignal) =>
    request<CritiquesView>(`${base(projectId)}/run`, { ...jsonBody(input), signal }),
  respond: (
    projectId: string,
    critiqueId: string,
    input: CritiqueResponseInput,
    signal?: AbortSignal,
  ) =>
    request<CritiquesView>(`${base(projectId)}/${encodeURIComponent(critiqueId)}/response`, {
      ...jsonBody(input),
      method: 'PUT',
      signal,
    }),
};
