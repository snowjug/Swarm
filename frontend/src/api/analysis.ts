import type { Analysis } from '../../../shared/analysis';
import type { AnalysisList, StartAnalysisInput } from '../../../shared/analysis-plan';
import { jsonBody, request } from '../api';

const base = (projectId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/analysis`;

/** Comparisons of scenarios: a baseline against alternatives, over many seeded runs. */
export const analysisApi = {
  /** The saved comparisons of a project, and what the next one would use. An empty list is not an error. */
  list: (projectId: string, signal?: AbortSignal) =>
    request<AnalysisList>(base(projectId), { signal }),
  get: async (projectId: string, id: string, signal?: AbortSignal): Promise<Analysis> =>
    (
      await request<{ analysis: Analysis }>(`${base(projectId)}/${encodeURIComponent(id)}`, {
        signal,
      })
    ).analysis,
  /** Starts one; the answer is the comparison as running, and its progress is read by asking again. */
  start: async (
    projectId: string,
    input: StartAnalysisInput,
    signal?: AbortSignal,
  ): Promise<Analysis> =>
    (await request<{ analysis: Analysis }>(base(projectId), { ...jsonBody(input), signal }))
      .analysis,
  cancel: async (projectId: string, id: string, signal?: AbortSignal): Promise<Analysis> =>
    (
      await request<{ analysis: Analysis }>(`${base(projectId)}/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        signal,
      })
    ).analysis,
};
