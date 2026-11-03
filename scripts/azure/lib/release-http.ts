/**
 * The one HTTP request the release tooling makes on its own: GET /api/health/ready on a host. The health
 * routes answer for any Host header (every other route is bound to ALLOWED_HOSTS), which is what lets a
 * revision be checked on its own address before it has any traffic. No credential, cookie or body is sent,
 * a redirect is never followed, and only a verdict and a status line are returned, never the response body.
 */

export interface ReadyVerdict {
  ok: boolean;
  detail: string;
}

const READY_PATH = '/api/health/ready';

function reason(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') {
      return cause.code;
    }
    return error.name === 'TimeoutError' ? 'the request timed out' : error.name;
  }
  return 'unknown error';
}

/** Ready means: 200, and a body that says the application is ready with its database ok. */
export async function checkReadyOn(
  host: string,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<ReadyVerdict> {
  if (!/^[a-z0-9.-]+$/iu.test(host)) return { ok: false, detail: 'the host is not a plain name' };
  let response: Response;
  try {
    response = await fetcher(`https://${host}${READY_PATH}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': 'swarm-release-check' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, detail: `cannot reach the host (${reason(error)})` };
  }
  let body: unknown;
  try {
    body = JSON.parse((await response.text()).slice(0, 65_536)) as unknown;
  } catch {
    body = undefined;
  }
  if (response.status !== 200) return { ok: false, detail: `HTTP ${response.status}` };
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const checks =
    record.checks !== null && typeof record.checks === 'object'
      ? (record.checks as Record<string, unknown>)
      : {};
  if (record.status === 'ready' && checks.database === 'ok')
    return { ok: true, detail: 'HTTP 200, ready, database ok' };
  return { ok: false, detail: 'HTTP 200 but the body does not say ready with the database ok' };
}
