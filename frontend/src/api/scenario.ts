import type {
  ScenarioDocument,
  ScenarioFrame,
  ScenarioParseResult,
  ScenarioView,
} from '../../../shared/scenario';
import { jsonBody, request } from '../api';

const scenarioPath = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/scenario`;

export const scenarioApi = {
  /** Reads a question into a scenario. Nothing is stored: the person decides what to keep. */
  parse: (question: string, documents: readonly ScenarioDocument[], signal?: AbortSignal) =>
    request<ScenarioParseResult>('/api/scenario/parse', {
      ...jsonBody({ question, documents }),
      signal,
    }),
  /** The scenario a project keeps, or null, with the revision to change it against. */
  get: (projectId: string, signal?: AbortSignal) =>
    request<ScenarioView>(scenarioPath(projectId), { signal }),
  /** Changes it. With `expectedRevision`, a change made on a page that is out of date is refused. */
  put: (
    projectId: string,
    scenario: ScenarioFrame,
    expectedRevision?: number,
    signal?: AbortSignal,
  ) =>
    request<ScenarioView>(scenarioPath(projectId), {
      ...jsonBody({ scenario, expectedRevision }),
      method: 'PUT',
      signal,
    }),
};
