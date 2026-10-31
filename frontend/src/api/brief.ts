import type { BriefExportFormat, BriefView } from '../../../shared/brief';
import { jsonBody, request } from '../api';

const base = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/brief`;

/** The calls the decision brief makes. Exports are plain links, so the browser downloads or prints them. */
export const briefApi = {
  get: (projectId: string, signal?: AbortSignal) => request<BriefView>(base(projectId), { signal }),
  generate: (projectId: string, analysisId?: string, signal?: AbortSignal) =>
    request<BriefView>(base(projectId), {
      ...jsonBody(analysisId ? { analysisId } : {}),
      signal,
    }),
  exportUrl: (projectId: string, format: BriefExportFormat): string =>
    `${base(projectId)}/export?format=${format}`,
};
