import {
  BYOK_HEADERS,
  BYOK_PROVIDER,
  DELETE_CONFIRMATION,
  type AccountView,
  type AdminSwitches,
  type AdminUsageView,
  type ByokConnectResult,
  type LegalDocument,
  type LegalText,
  type PublicSession,
  type PublicStatus,
  type StartedSignIn,
  type StartedGuest,
  type StartGuest,
  type StartSignIn,
  type UsageView,
} from '../../../shared/public';
import { checkedFetch, jsonBody, request } from '../api';

/**
 * Every request the public edition makes of its own. The ones that need no session (the session itself, the status,
 * the legal texts, the start of a sign-in or of a guest session) use a plain `fetch`, so that a 401 is an answer to
 * read and not a reason to leave for the pilot's sign-in address. The ones for a signed-in person go through the API
 * client, which adds the change header, the person's own key where one is held, and the calm wording of the public
 * error codes.
 */

export type Reply<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string | null; network: boolean };

function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const error = body.error;
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

async function plain<T>(path: string, init: RequestInit = {}): Promise<Reply<T>> {
  const change = init.method !== undefined && init.method.toUpperCase() !== 'GET';
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(change ? { 'X-Swarm-CSRF': '1' } : {}),
        ...init.headers,
      },
    });
  } catch {
    return { ok: false, status: 0, code: null, network: true };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An answer that is not JSON (a proxy's page) has no code to read.
  }
  if (!response.ok) {
    return { ok: false, status: response.status, code: errorCodeOf(body), network: false };
  }
  return { ok: true, status: response.status, data: body as T };
}

export const fetchSession = () => plain<PublicSession>('/api/public/session');

export const fetchStatus = () => plain<PublicStatus>('/api/public/status');

export const fetchLegal = (doc: LegalDocument) => plain<LegalText>(`/api/public/legal/${doc}`);

export const startSignIn = (provider: string, body: StartSignIn) =>
  plain<StartedSignIn>(`/auth/start/${encodeURIComponent(provider)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Asks for a temporary private workspace with no sign-in. The session cookie is in the answer's headers, never in the page. */
export const startGuest = (body: StartGuest = {}) =>
  plain<StartedGuest>('/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const publicApi = {
  /** What a request would be funded by, and how much of the free tier is left. */
  usage: (signal?: AbortSignal) => request<UsageView>('/api/usage', { signal }),
  account: (signal?: AbortSignal) => request<AccountView>('/api/account', { signal }),
  /** Asks the server to check a key with one request that uses no tokens. The key is the one in the field. */
  connectByok: (key: string, signal?: AbortSignal) =>
    request<ByokConnectResult>('/api/byok/connect', {
      method: 'POST',
      headers: { [BYOK_HEADERS.provider]: BYOK_PROVIDER, [BYOK_HEADERS.key]: key },
      signal,
    }),
  deleteAccount: async (signal?: AbortSignal): Promise<void> => {
    await checkedFetch('/api/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: DELETE_CONFIRMATION }),
      signal,
    });
  },
  /** Tells the server to drop the copy of the person's key that it holds in memory for their runs. */
  forgetByok: async (signal?: AbortSignal): Promise<void> => {
    await checkedFetch('/api/byok', { method: 'DELETE', signal });
  },
  adminUsage: (days = 14, signal?: AbortSignal) =>
    request<AdminUsageView>(`/api/admin/usage?days=${days}`, { signal }),
  setFreeTier: (enabled: boolean, signal?: AbortSignal) =>
    request<AdminSwitches>('/api/admin/free-tier', { ...jsonBody({ enabled }), signal }),
  setSignups: (enabled: boolean, signal?: AbortSignal) =>
    request<AdminSwitches>('/api/admin/signups', { ...jsonBody({ enabled }), signal }),
  disableUser: (id: string, disabled: boolean, signal?: AbortSignal) =>
    request<{ accounts: { id: string; disabled: boolean }[] }>(
      `/api/admin/users/${encodeURIComponent(id)}/disable`,
      { ...jsonBody({ disabled }), signal },
    ),
};
