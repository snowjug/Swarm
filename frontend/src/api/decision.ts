import type { DecisionView } from '../../../shared/decision';
import { request } from '../api';

const base = (projectId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/decision`;

/** The call the decision canvas makes. It is worked out from the project at every read; nothing is stored. */
export const decisionApi = {
  get: (projectId: string, signal?: AbortSignal) =>
    request<DecisionView>(base(projectId), { signal }),
};
