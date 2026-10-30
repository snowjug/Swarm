import { createHash, randomBytes } from 'node:crypto';
import type { SessionConfig } from '../config.js';
import { AppError } from '../errors.js';

/** An unguessable, URL-safe value: 256 bits by default. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** What is stored in place of a value that grants access: the hash, so a copy of the table grants nothing. */
export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** The PKCE code challenge for a verifier (RFC 7636, method S256). */
export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

export interface OidcEndpoints {
  authorize: string;
  token: string;
}

/** Microsoft's v2.0 endpoints for the configured authority. */
export function microsoftEndpoints(
  session: Pick<SessionConfig, 'authorityTenant'>,
  host = 'https://login.microsoftonline.com',
): OidcEndpoints {
  const base = `${host}/${session.authorityTenant}/oauth2/v2.0`;
  return { authorize: `${base}/authorize`, token: `${base}/token` };
}

/**
 * Where to send the browser. Authorization Code with PKCE, so the code that comes back is useless
 * without the verifier this server keeps; `state` binds the reply to this browser, and `nonce` binds
 * the ID token to this request. Only `openid profile` is asked for: no API access, no refresh token.
 */
export function authorizeUrl(
  session: Pick<SessionConfig, 'clientId' | 'redirectUri'>,
  endpoints: OidcEndpoints,
  parameters: { state: string; nonce: string; verifier: string },
): string {
  const url = new URL(endpoints.authorize);
  url.search = new URLSearchParams({
    client_id: session.clientId,
    response_type: 'code',
    redirect_uri: session.redirectUri,
    response_mode: 'query',
    scope: 'openid profile',
    state: parameters.state,
    nonce: parameters.nonce,
    code_challenge: pkceChallenge(parameters.verifier),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

const MAX_ID_TOKEN_LENGTH = 8_192;

/** The same answer whatever went wrong, so a failure reveals nothing about which step failed. */
export const signInFailed = (): AppError =>
  new AppError(502, 'SIGN_IN_FAILED', 'Sign-in could not be completed. Try again.');

/** What a managed identity's token is exchanged for at the token endpoint: the audience Entra defines for it. */
export const ASSERTION_SCOPE = 'api://AzureADTokenExchange/.default';
const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** The token that proves to Entra that this is the application, from the platform's managed identity. */
export async function managedIdentityAssertion(): Promise<string> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const token = await new DefaultAzureCredential().getToken(ASSERTION_SCOPE);
  if (!token?.token) throw signInFailed();
  return token.token;
}

/**
 * Redeems the authorization code for an ID token and returns that token and nothing else: the
 * access token, if the identity provider sends one, is discarded unread, so nothing but a short
 * session identifier ever reaches the browser or the database. A confidential client proves itself
 * with a secret, or (preferably, because nothing is stored) with an assertion from its managed identity.
 */
export async function exchangeCode(
  session: Pick<SessionConfig, 'clientId' | 'redirectUri' | 'clientSecret' | 'clientAssertion'>,
  endpoints: OidcEndpoints,
  input: { code: string; verifier: string },
  fetcher: typeof fetch = fetch,
  assertion: () => Promise<string> = managedIdentityAssertion,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: session.clientId,
    code: input.code,
    redirect_uri: session.redirectUri,
    code_verifier: input.verifier,
    scope: 'openid profile',
  });
  if (session.clientSecret) body.set('client_secret', session.clientSecret);
  if (session.clientAssertion === 'managed-identity') {
    let proof: string;
    try {
      proof = await assertion();
    } catch {
      throw signInFailed();
    }
    body.set('client_assertion_type', ASSERTION_TYPE);
    body.set('client_assertion', proof);
  }
  let response: Response;
  try {
    response = await fetcher(endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw signInFailed();
  }
  if (!response.ok) throw signInFailed();
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw signInFailed();
  }
  const idToken = (parsed as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > MAX_ID_TOKEN_LENGTH) {
    throw signInFailed();
  }
  return idToken;
}

/**
 * Where to go after signing in: a path on this site and nothing else. Anything that could leave the
 * site (a scheme, a host, a backslash a browser reads as a slash, a control character) becomes `/`.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/u.test(value)) return '/';
  return value;
}
