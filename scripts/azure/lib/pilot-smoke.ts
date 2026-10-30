import { isDeepStrictEqual } from 'node:util';
import { UsageError } from './args.js';
import { CheckFailure, describeError, findSecretShapes, redact } from './verify-support.js';

/**
 * A post-deployment smoke test of the hosted pilot. It makes four credential-free GET requests to the
 * public address and decides every check from what came back. It never sends a cookie, a token or a
 * request body, never follows a redirect, and never prints a cookie value, a token or a full URL
 * from a response.
 */

/** What the checks read from one response. Header names are lower-case. */
export interface SmokeResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  /** One entry per Set-Cookie header: they cannot be joined into a single header value. */
  setCookies: readonly string[];
  body: string;
}

/** The only way the smoke test touches the application. */
export interface SmokeHttp {
  get(path: string): Promise<SmokeResponse>;
}

/** The application could not be reached at all, so no later check can say anything. */
export class Unreachable extends CheckFailure {
  constructor(message: string) {
    super(message);
    this.name = 'Unreachable';
  }
}

export const PILOT_CHECKS = [
  { id: 'https', title: 'The address uses HTTPS, so nothing is sent over plain HTTP' },
  { id: 'live', title: 'GET /api/health/live answers 200' },
  { id: 'ready', title: 'GET /api/health/ready answers 200 and reports the database as ok' },
  {
    id: 'sign-in-enforced',
    title: 'GET /api/config without credentials is refused with 401 SIGN_IN_REQUIRED',
  },
  {
    id: 'login-redirect',
    title:
      'GET /auth/login redirects (302) to Microsoft Entra with an authorization-code PKCE request',
  },
  { id: 'login-cookie', title: 'The login cookie is HttpOnly, Secure and SameSite=Lax' },
  { id: 'csp', title: 'Every response carries a Content-Security-Policy' },
  {
    id: 'no-leaks',
    title:
      'No response body holds an identifier, an endpoint or subscription name, or a credential',
  },
] as const;

export type SmokeCheckId = (typeof PILOT_CHECKS)[number]['id'];
export type SmokeStatus = 'pass' | 'fail' | 'skipped';

export interface SmokeResult {
  id: SmokeCheckId;
  title: string;
  status: SmokeStatus;
  detail: string;
}

export interface SmokeReport {
  baseUrl: string;
  checks: SmokeResult[];
  passed: boolean;
}

const LIVE = '/api/health/live';
const READY = '/api/health/ready';
const CONFIG = '/api/config';
const LOGIN = '/auth/login';
/** The paths asked for, in order. Each is requested once; later checks reuse the answer. */
export const SMOKE_PATHS = [LIVE, READY, CONFIG, LOGIN] as const;

const ENTRA_ORIGIN = 'https://login.microsoftonline.com';
/** In `backend/src/routes/session.ts`: `swarm_login`, which an https deployment prefixes with `__Host-`. */
const LOGIN_COOKIE = '__Host-swarm_login';
const READY_BODY = { status: 'ready', checks: { database: 'ok' } };
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
const WHOLE_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SENSITIVE_WORDS = /endpoint|subscription/iu;
const MAX_BODY_CHARS = 65_536;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function failure(response: SmokeResponse): string {
  const body = parseJson(response.body);
  return describeError({ status: response.status, body });
}

/** Exactly one https address: the smoke test never sends anything over plain HTTP. */
export function parseSmokeArgs(argv: readonly string[]): { baseUrl: string } {
  const usage = 'Usage: npx tsx scripts/azure/pilot-smoke.ts https://<address of the deployed app>';
  const [address, ...extra] = argv;
  if (address === undefined || extra.length > 0) throw new UsageError(usage);
  if (!URL.canParse(address)) throw new UsageError(`"${address}" is not a valid address. ${usage}`);
  const url = new URL(address);
  if (url.protocol !== 'https:') {
    throw new UsageError(
      `The address must start with https://. This check never sends a request over plain HTTP. ${usage}`,
    );
  }
  if (url.username || url.password) {
    throw new UsageError('The address must not contain credentials.');
  }
  return { baseUrl: url.origin };
}

function reason(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') {
      return cause.code;
    }
    return error.name === 'TimeoutError' ? 'the request timed out' : error.message;
  }
  return 'unknown error';
}

/**
 * A plain GET client. It sends no cookie, token or body, and a redirect is returned to the caller
 * as it is, never followed.
 */
export function fetchSmoke(
  baseUrl: string,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): SmokeHttp {
  return {
    async get(path): Promise<SmokeResponse> {
      let response: Response;
      try {
        response = await fetcher(new URL(path, baseUrl), {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': 'swarm-pilot-smoke' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          if (name.toLowerCase() !== 'set-cookie') headers[name.toLowerCase()] = value;
        });
        const body = (await response.text()).slice(0, MAX_BODY_CHARS);
        return {
          status: response.status,
          headers,
          setCookies: response.headers.getSetCookie(),
          body,
        };
      } catch (error) {
        throw new Unreachable(`Cannot reach ${new URL(baseUrl).host} (${reason(error)}).`);
      }
    },
  };
}

export function checkHttps(baseUrl: string): string {
  if (!URL.canParse(baseUrl) || new URL(baseUrl).protocol !== 'https:') {
    throw new CheckFailure('The address is not an https:// address. No request was sent.');
  }
  return 'The address is https, and no request is sent over plain HTTP.';
}

export function checkLive(response: SmokeResponse): string {
  if (response.status !== 200) {
    const hint =
      response.status === 503
        ? ' The database connection was lost for good; the platform restarts the replica.'
        : '';
    throw new CheckFailure(`Expected 200 but got ${failure(response)}.${hint}`);
  }
  return 'HTTP 200.';
}

export function checkReady(response: SmokeResponse): string {
  if (response.status !== 200) {
    const body = parseJson(response.body);
    const checks = isRecord(body) && isRecord(body.checks) ? body.checks : {};
    const hint = checks.database === 'failed' ? ' The database did not answer.' : '';
    throw new CheckFailure(`Expected 200 but got ${failure(response)}.${hint}`);
  }
  if (!isDeepStrictEqual(parseJson(response.body), READY_BODY)) {
    throw new CheckFailure(
      'The body is not exactly {"status":"ready","checks":{"database":"ok"}}.',
    );
  }
  return 'HTTP 200 and the body is exactly {"status":"ready","checks":{"database":"ok"}}.';
}

export function checkSignInEnforced(response: SmokeResponse): string {
  if (response.status === 200) {
    throw new CheckFailure(
      'Sign-in is NOT enforced: /api/config answered 200 without credentials. Check that AUTH_MODE is entra.',
    );
  }
  const body = parseJson(response.body);
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  if (response.status !== 401 || error.code !== 'SIGN_IN_REQUIRED') {
    throw new CheckFailure(`Expected 401 SIGN_IN_REQUIRED but got ${failure(response)}.`);
  }
  return 'HTTP 401 with the code SIGN_IN_REQUIRED.';
}

function parameter(url: URL, name: string): string {
  return url.searchParams.get(name) ?? '';
}

export function checkLoginRedirect(response: SmokeResponse, baseUrl: string): string {
  if (response.status === 404) {
    throw new CheckFailure(
      'Browser sign-in is not configured: /auth/login answered 404. Set AUTH_ENTRA_CLIENT_ID and AUTH_ENTRA_REDIRECT_URI.',
    );
  }
  if (response.status !== 302) {
    throw new CheckFailure(`Expected 302 but got ${failure(response)}.`);
  }
  const location = response.headers.location ?? '';
  if (!location.startsWith(`${ENTRA_ORIGIN}/`)) {
    const where = URL.canParse(location) ? new URL(location).origin : 'no usable address';
    throw new CheckFailure(`The redirect goes to ${where}, not to ${ENTRA_ORIGIN}/.`);
  }
  const url = new URL(location);
  const problems: string[] = [];
  if (parameter(url, 'response_type') !== 'code') problems.push('response_type is not code');
  if (parameter(url, 'code_challenge_method') !== 'S256') {
    problems.push('code_challenge_method is not S256');
  }
  if (!parameter(url, 'code_challenge')) problems.push('there is no code_challenge');
  const scopes = parameter(url, 'scope').split(/\s+/u).filter(Boolean).sort();
  if (!isDeepStrictEqual(scopes, ['openid', 'profile'])) {
    problems.push('the scope is not exactly "openid profile"');
  }
  if (!parameter(url, 'state')) problems.push('there is no state');
  if (!parameter(url, 'nonce')) problems.push('there is no nonce');
  if (!WHOLE_GUID.test(parameter(url, 'client_id'))) problems.push('client_id is not a GUID');
  if (parameter(url, 'redirect_uri') !== `${new URL(baseUrl).origin}/auth/callback`) {
    problems.push('redirect_uri is not this address followed by /auth/callback');
  }
  if (/client_(?:secret|assertion)/iu.test(location)) {
    problems.push('a client credential parameter is present');
  }
  if (problems.length > 0)
    throw new CheckFailure(`The authorization request: ${problems.join('; ')}.`);
  return 'HTTP 302 to Microsoft Entra: response_type=code, S256 PKCE challenge, scope "openid profile", state and nonce present, redirect_uri on this address, no client credential.';
}

interface ParsedCookie {
  name: string;
  value: string;
  attributes: ReadonlyMap<string, string>;
}

function parseSetCookie(header: string): ParsedCookie | null {
  const [pair = '', ...rest] = header.split(';').map((part) => part.trim());
  const at = pair.indexOf('=');
  if (at < 1) return null;
  const attributes = new Map<string, string>();
  for (const part of rest) {
    const equals = part.indexOf('=');
    const name = (equals < 0 ? part : part.slice(0, equals)).trim().toLowerCase();
    if (name) attributes.set(name, equals < 0 ? '' : part.slice(equals + 1).trim());
  }
  return { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), attributes };
}

export function checkLoginCookie(response: SmokeResponse): string {
  const cookies = response.setCookies.flatMap((header) => parseSetCookie(header) ?? []);
  const cookie = cookies.find((candidate) => candidate.name === LOGIN_COOKIE);
  if (!cookie) {
    const seen = cookies.map((candidate) => candidate.name).join(', ') || 'none';
    throw new CheckFailure(
      `No Set-Cookie for ${LOGIN_COOKIE} (cookie names seen: ${seen}). Without the Secure flag the app drops the __Host- prefix, so check that the redirect address is https.`,
    );
  }
  const problems: string[] = [];
  if (!cookie.value) problems.push('it has no value');
  if (!cookie.attributes.has('httponly')) problems.push('HttpOnly is missing');
  if (!cookie.attributes.has('secure')) problems.push('Secure is missing');
  if (cookie.attributes.get('samesite')?.toLowerCase() !== 'lax') {
    problems.push('SameSite is not Lax');
  }
  if (cookie.attributes.get('path') !== '/') problems.push('Path is not /');
  if (cookie.attributes.has('domain')) problems.push('a Domain attribute is set');
  if (problems.length > 0) throw new CheckFailure(`${LOGIN_COOKIE}: ${problems.join('; ')}.`);
  return `${LOGIN_COOKIE} is set with HttpOnly, Secure, SameSite=Lax and Path=/, and no Domain.`;
}

export interface Collected {
  path: string;
  response: SmokeResponse;
}

export function checkContentSecurityPolicy(responses: readonly Collected[]): string {
  const missing = responses
    .filter(
      ({ response }) =>
        !/(?:^|;)\s*default-src\b/iu.test(response.headers['content-security-policy'] ?? ''),
    )
    .map(({ path }) => path);
  if (missing.length > 0) {
    throw new CheckFailure(
      `No Content-Security-Policy with a default-src on: ${missing.join(', ')}.`,
    );
  }
  return `All ${responses.length} responses carry a Content-Security-Policy with a default-src.`;
}

/** An error body carries `error.requestId`, a random UUID per request. Nothing else is set aside. */
function withoutRequestId(text: string): string {
  const body = parseJson(text);
  if (!isRecord(body) || !isRecord(body.error)) return text;
  const requestId = body.error.requestId;
  if (typeof requestId !== 'string' || !WHOLE_GUID.test(requestId)) return text;
  const error = { ...body.error };
  delete error.requestId;
  return JSON.stringify({ ...body, error });
}

export function checkNoLeaks(responses: readonly Collected[]): string {
  const problems: string[] = [];
  for (const { path, response } of responses) {
    const text = withoutRequestId(response.body);
    if (GUID.test(text)) problems.push(`${path} holds a GUID-shaped value`);
    if (SENSITIVE_WORDS.test(text)) problems.push(`${path} mentions an endpoint or subscription`);
    for (const shape of findSecretShapes(text)) problems.push(`${path} holds a ${shape}`);
  }
  if (problems.length > 0) throw new CheckFailure(`${problems.join('; ')}.`);
  return `${responses.length} response bodies checked: no GUID-shaped value (the per-request error id is set aside), no endpoint or subscription, no credential shape.`;
}

const LABEL: Record<SmokeStatus, string> = { pass: 'PASS', fail: 'FAIL', skipped: 'SKIP' };

export interface SmokeOptions {
  /** The public address under test, as the user typed it. */
  baseUrl: string;
  log?: (line: string) => void;
}

/** Runs the checks in order. A check that never ran is skipped and can never count as passed. */
export async function runPilotSmoke(http: SmokeHttp, options: SmokeOptions): Promise<SmokeReport> {
  const log = options.log ?? (() => undefined);
  const results: SmokeResult[] = [];
  const answers = new Map<string, SmokeResponse>();

  const fetched = async (path: string): Promise<SmokeResponse> => {
    const known = answers.get(path);
    if (known) return known;
    const response = await http.get(path);
    answers.set(path, response);
    return response;
  };
  const collected = (): Collected[] =>
    SMOKE_PATHS.map((path) => {
      const response = answers.get(path);
      if (!response) throw new CheckFailure(`${path} was not requested.`);
      return { path, response };
    });

  const steps: Record<SmokeCheckId, () => string | Promise<string>> = {
    https: () => checkHttps(options.baseUrl),
    live: async () => checkLive(await fetched(LIVE)),
    ready: async () => checkReady(await fetched(READY)),
    'sign-in-enforced': async () => checkSignInEnforced(await fetched(CONFIG)),
    'login-redirect': async () => checkLoginRedirect(await fetched(LOGIN), options.baseUrl),
    'login-cookie': async () => checkLoginCookie(await fetched(LOGIN)),
    csp: () => checkContentSecurityPolicy(collected()),
    'no-leaks': () => checkNoLeaks(collected()),
  };

  let stopped: string | null = null;
  for (const { id, title } of PILOT_CHECKS) {
    let status: SmokeStatus = 'pass';
    let detail: string;
    if (stopped !== null) {
      status = 'skipped';
      detail = stopped;
    } else {
      try {
        detail = await steps[id]();
      } catch (error) {
        status = 'fail';
        detail =
          error instanceof CheckFailure
            ? error.message
            : `Unexpected error: ${error instanceof Error ? error.message : 'unknown'}`;
        if (error instanceof Unreachable) {
          stopped = 'Not run: the application could not be reached.';
        } else if (id === 'https') {
          stopped = 'Not run: the address is not https, so no request was made.';
        }
      }
    }
    const result: SmokeResult = { id, title, status, detail: redact(detail).slice(0, 500) };
    results.push(result);
    log(`${LABEL[status]}  ${title}\n      ${result.detail}`);
  }
  return {
    baseUrl: options.baseUrl,
    checks: results,
    passed: results.every((result) => result.status === 'pass'),
  };
}

export function formatSmokeSummary(report: SmokeReport): string {
  const notPassed = report.checks.filter((check) => check.status !== 'pass').length;
  return report.passed
    ? `RESULT: PASSED. All ${report.checks.length} checks passed.`
    : `RESULT: FAILED. ${notPassed} of ${report.checks.length} checks did not pass.`;
}
