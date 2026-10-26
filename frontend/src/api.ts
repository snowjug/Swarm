import type {
  ApiErrorBody,
  AppConfig,
  ChatMessage,
  CreateProjectInput,
  EvidenceMatch,
  ProjectDetail,
  ProjectSummary,
} from '../../shared/types';

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
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  config: (signal?: AbortSignal) => request<AppConfig>('/api/config', { signal }),
  projects: (signal?: AbortSignal) =>
    request<{ projects: ProjectSummary[]; total: number }>('/api/projects', { signal }),
  project: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(projectPath(id), { signal }),
  create: (input: CreateProjectInput, signal?: AbortSignal) =>
    request<ProjectDetail>('/api/projects', { ...json(input), signal }),
  run: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/run`, { method: 'POST', signal }),
  cancel: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(`${projectPath(id)}/cancel`, { method: 'POST', signal }),
  remove: async (id: string, signal?: AbortSignal) => {
    await checkedFetch(projectPath(id), { method: 'DELETE', signal });
  },
  evidence: (id: string, query: string, signal?: AbortSignal) =>
    request<{ matches: EvidenceMatch[]; query: string }>(
      `${projectPath(id)}/evidence?query=${encodeURIComponent(query)}`,
      { signal },
    ),
  chat: (id: string, target: string, signal?: AbortSignal) =>
    request<{ messages: ChatMessage[] }>(
      `${projectPath(id)}/chat?target=${encodeURIComponent(target)}`,
      { signal },
    ),
  sendChat: (id: string, target: string, message: string, signal?: AbortSignal) =>
    request<{ messages: ChatMessage[] }>(`${projectPath(id)}/chat`, {
      ...json({ target, message }),
      signal,
    }),
  export: async (id: string, format: 'markdown' | 'json', signal?: AbortSignal) => {
    const response = await checkedFetch(
      `${projectPath(id)}/export?format=${encodeURIComponent(format)}`,
      { signal },
    );
    return response.blob();
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
