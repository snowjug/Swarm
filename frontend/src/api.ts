import type {
  ApiErrorBody,
  AppConfig,
  AuditEntry,
  AuditVerification,
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
import type {
  ClaimDetail,
  ClaimRecord,
  ContradictionRecord,
  ContradictionReviewInput,
  Ledger,
  ReviewInput,
} from '../../shared/evidence';
import type { EditSectionInput, StudioExportFormat, StudioView } from '../../shared/studio';

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
  const unsafe = !['GET', 'HEAD', undefined].includes(init.method?.toUpperCase());
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal,
      // A custom header on every change cannot be sent by another site, so the session cookie alone
      // is never enough to make one: the server refuses a change that arrives without it.
      headers: {
        Accept: 'application/json',
        ...(unsafe ? { 'X-Swarm-CSRF': '1' } : {}),
        ...init.headers,
      },
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
    if (response.status === 401 && body?.error?.code === 'SIGN_IN_REQUIRED') {
      return await signIn();
    }
    throw new ApiError(
      body?.error?.message || `The request failed (${response.status}). Please retry.`,
      body?.error?.code,
      body?.error?.requestId,
    );
  }
  return response;
}

const SIGN_IN_ATTEMPT = 'swarm.signin.attempted';

/**
 * The server wants a person who is not signed in to sign in with Microsoft. The browser is sent to
 * the server's sign-in address and returns here with a session cookie; no token ever reaches this
 * code. Sent once: if signing in produces no session (cookies blocked), the page says so rather
 * than going round again.
 */
async function signIn(): Promise<never> {
  const last = Number(window.sessionStorage.getItem(SIGN_IN_ATTEMPT) ?? '0');
  if (Date.now() - last > 30_000) {
    window.sessionStorage.setItem(SIGN_IN_ATTEMPT, String(Date.now()));
    const back = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/auth/login?returnTo=${encodeURIComponent(back)}`);
    // The page is leaving; nothing that called the server should go on while it does.
    return new Promise<never>(() => undefined);
  }
  throw new ApiError(
    'Sign-in did not complete. Allow cookies for this site, then reload to try again.',
    'SIGN_IN_REQUIRED',
  );
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
  ledger: (id: string, signal?: AbortSignal) =>
    request<Ledger>(`${projectPath(id)}/ledger`, { signal }),
  audit: (id: string, signal?: AbortSignal) =>
    request<{ events: AuditEntry[] }>(`${projectPath(id)}/audit`, { signal }),
  verifyAudit: (signal?: AbortSignal) =>
    request<AuditVerification>('/api/audit/verify', { signal }),
  /** Ends the signed-in session on the server and removes its cookie. */
  signOut: async (signal?: AbortSignal): Promise<void> => {
    await checkedFetch('/auth/logout', { method: 'POST', signal });
    // Signing out on purpose is not a sign-in that failed: the next visit may start another at once.
    window.sessionStorage.removeItem(SIGN_IN_ATTEMPT);
  },
  claim: (id: string, claimId: string, signal?: AbortSignal) =>
    request<ClaimDetail>(`${projectPath(id)}/claims/${encodeURIComponent(claimId)}`, { signal }),
  reviewClaim: (
    id: string,
    claimId: string,
    review: ReviewInput & { expectedVersion?: number },
    signal?: AbortSignal,
  ) =>
    request<{ claim: ClaimRecord }>(
      `${projectPath(id)}/claims/${encodeURIComponent(claimId)}/review`,
      { ...jsonBody(review), signal },
    ),
  reviewConflict: (
    id: string,
    conflictId: string,
    review: ContradictionReviewInput,
    signal?: AbortSignal,
  ) =>
    request<{ conflict: ContradictionRecord; ledger: Ledger }>(
      `${projectPath(id)}/conflicts/${encodeURIComponent(conflictId)}/review`,
      { ...jsonBody(review), signal },
    ),
  studio: (id: string, signal?: AbortSignal) =>
    request<StudioView>(`${projectPath(id)}/studio`, { signal }),
  /** Opens the report in the studio, or starts it again from a newer generated report. */
  startStudio: (id: string, confirm: boolean, signal?: AbortSignal) =>
    request<StudioView>(`${projectPath(id)}/studio`, { ...jsonBody({ confirm }), signal }),
  editSection: (
    id: string,
    sectionId: string,
    input: Pick<EditSectionInput, 'body' | 'expectedVersion' | 'reason'>,
    signal?: AbortSignal,
  ) =>
    request<StudioView>(`${projectPath(id)}/studio/sections/${encodeURIComponent(sectionId)}`, {
      ...jsonBody(input),
      method: 'PUT',
      signal,
    }),
  lockSection: (id: string, sectionId: string, locked: boolean, signal?: AbortSignal) =>
    request<StudioView>(
      `${projectPath(id)}/studio/sections/${encodeURIComponent(sectionId)}/lock`,
      { ...jsonBody({ locked }), method: 'PUT', signal },
    ),
  addNote: (id: string, sectionId: string, text: string, signal?: AbortSignal) =>
    request<StudioView>(
      `${projectPath(id)}/studio/sections/${encodeURIComponent(sectionId)}/notes`,
      { ...jsonBody({ text }), signal },
    ),
  restoreVersion: (
    id: string,
    sectionId: string,
    input: { version: number; expectedVersion: number; reason: string | null },
    signal?: AbortSignal,
  ) =>
    request<StudioView>(
      `${projectPath(id)}/studio/sections/${encodeURIComponent(sectionId)}/restore`,
      { ...jsonBody(input), signal },
    ),
  regenerateSection: (
    id: string,
    sectionId: string,
    input: { expectedVersion: number; instruction: string | null },
    signal?: AbortSignal,
  ) =>
    request<StudioView>(
      `${projectPath(id)}/studio/sections/${encodeURIComponent(sectionId)}/regenerate`,
      { ...jsonBody(input), signal },
    ),
  decideProposal: (
    id: string,
    sectionId: string,
    input: { decision: 'accept' | 'reject'; proposalId: string; expectedVersion: number },
    signal?: AbortSignal,
  ) =>
    request<StudioView>(
      `${projectPath(id)}/studio/sections/${encodeURIComponent(sectionId)}/proposal`,
      { ...jsonBody(input), signal },
    ),
  /** One step of the review workflow, taken on the revision the person was looking at. */
  studioStep: (
    id: string,
    step: 'submit' | 'approve' | 'request-changes' | 'reopen',
    input: { expectedRevision: number; note: string | null },
    signal?: AbortSignal,
  ) => request<StudioView>(`${projectPath(id)}/studio/${step}`, { ...jsonBody(input), signal }),
  /** Where the printable memo is: a page of its own, opened in a new tab. */
  studioExportUrl: (id: string, format: StudioExportFormat) =>
    `${projectPath(id)}/studio/export?format=${encodeURIComponent(format)}`,
  exportStudio: async (id: string, format: 'markdown' | 'json', signal?: AbortSignal) => {
    const response = await checkedFetch(api.studioExportUrl(id, format), { signal });
    const blob = await response.blob();
    if (!blob.size) throw new ApiError('The server returned an empty export. Refresh and retry.');
    return blob;
  },
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
