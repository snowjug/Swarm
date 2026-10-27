import type {
  ApiErrorBody,
  AppConfig,
  ChatMessage,
  CreateProjectInput,
  EvidenceMatch,
  Intervention,
  ProjectDetail,
  ProjectSummary,
  ProviderStatus,
} from '../../shared/types';
import type {
  EnvironmentUpdate,
  BranchInput,
  ExecutionStep,
  ExtractedPdf,
  Platform,
  RunComparison,
  SimulationMemory,
  SurveyInput,
  SurveyRecord,
} from '../../shared/guided';

export class ApiError extends Error {
  readonly code: string;
  readonly requestId?: string;

  constructor(message: string, code = 'REQUEST_FAILED', requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.requestId = requestId;
  }
}

async function checkedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(180_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (timeout.aborted) {
      throw new ApiError('The server took too long to respond. Try again.', 'TIMEOUT');
    }
    throw new ApiError(
      'Cannot reach the local server. Check that the backend is running, then retry.',
      'NETWORK_ERROR',
    );
  }
  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A proxy or an unavailable server may return a non-JSON response.
    }
    throw new ApiError(
      body?.error?.message || `The request failed (${response.status}). Please retry.`,
      body?.error?.code,
      body?.error?.requestId,
    );
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await checkedFetch(path, init);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('The server returned an unreadable response. Refresh and retry.');
  }
}

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  config: (signal?: AbortSignal) => request<AppConfig>('/api/config', { signal }),
  providerStatus: (signal?: AbortSignal) =>
    request<ProviderStatus>('/api/provider/status', { signal }),
  /** One explicit, user-requested real model round trip; the server never runs it on its own. */
  checkProvider: (signal?: AbortSignal) =>
    request<ProviderStatus>('/api/provider/check', { method: 'POST', signal }),
  projects: (signal?: AbortSignal) =>
    request<{ projects: ProjectSummary[]; total: number }>('/api/projects', { signal }),
  project: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(projectPath(id), { signal }),
  create: (input: CreateProjectInput, signal?: AbortSignal) =>
    request<ProjectDetail>('/api/projects', { ...jsonBody(input), signal }),
  run: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/run`, { method: 'POST', signal }),
  cancel: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/cancel`, { method: 'POST', signal }),
  pause: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/pause`, { method: 'POST', signal }),
  resume: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/steps/simulation`, {
      ...jsonBody({ resume: true }),
      signal,
    }),
  intervention: (id: string, intervention: Intervention | null, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/intervention`, {
      ...jsonBody(intervention),
      method: 'PUT',
      signal,
    }),
  branch: (id: string, input: BranchInput, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/branches`, { ...jsonBody(input), signal }),
  compare: (id: string, otherId: string, signal?: AbortSignal) =>
    request<RunComparison>(`${projectPath(id)}/compare?with=${encodeURIComponent(otherId)}`, {
      signal,
    }),
  step: (id: string, step: ExecutionStep, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/steps/${step}`, { method: 'POST', signal }),
  environment: (id: string, input: EnvironmentUpdate, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/environment`, {
      ...jsonBody(input),
      method: 'PATCH',
      signal,
    }),
  extractPdf: (name: string, data: string, signal?: AbortSignal) =>
    request<ExtractedPdf>('/api/documents/extract', { ...jsonBody({ name, data }), signal }),
  remove: async (id: string, signal?: AbortSignal) => {
    await checkedFetch(projectPath(id), { method: 'DELETE', signal });
  },
  evidence: (id: string, query: string, signal?: AbortSignal) =>
    request<{ matches: EvidenceMatch[]; query: string }>(
      `${projectPath(id)}/evidence?query=${encodeURIComponent(query)}`,
      { signal },
    ),
  memories: (id: string, query: string, platform: Platform | 'all', signal?: AbortSignal) =>
    request<{ query: string; memories: SimulationMemory[]; total: number }>(
      `${projectPath(id)}/memories?query=${encodeURIComponent(query)}&platform=${platform}`,
      { signal },
    ),
  survey: (id: string, input: SurveyInput, signal?: AbortSignal) =>
    request<SurveyRecord>(`${projectPath(id)}/surveys`, { ...jsonBody(input), signal }),
  cancelSurvey: (id: string, surveyId: string, signal?: AbortSignal) =>
    request<SurveyRecord>(`${projectPath(id)}/surveys/${encodeURIComponent(surveyId)}/cancel`, {
      method: 'POST',
      signal,
    }),
  chat: (id: string, target: string, signal?: AbortSignal) =>
    request<{ messages: ChatMessage[] }>(
      `${projectPath(id)}/chat?target=${encodeURIComponent(target)}`,
      { signal },
    ),
  sendChat: (id: string, target: string, message: string, signal?: AbortSignal) =>
    request<{ messages: ChatMessage[] }>(`${projectPath(id)}/chat`, {
      ...jsonBody({ target, message }),
      signal,
    }),
  export: async (id: string, format: 'markdown' | 'json', signal?: AbortSignal) => {
    const response = await checkedFetch(
      `${projectPath(id)}/export?format=${encodeURIComponent(format)}`,
      { signal },
    );
    const blob = await response.blob();
    const markdownType =
      /^text\/(?:markdown|plain)(?:;|$)/u.test(blob.type) ||
      blob.type.startsWith('application/octet-stream');
    if (!blob.size || (format === 'markdown' && !markdownType)) {
      throw new ApiError('The server did not return a Markdown report. Refresh and retry.');
    }
    return blob;
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ''}`;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
