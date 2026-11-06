import type { PublicProviderId } from '../../../../shared/public.js';

/** Who signed in, as a provider vouches for it. Nothing here is a token. */
export interface VerifiedIdentity {
  provider: PublicProviderId;
  /** The provider's stable identifier for the person: Google's `sub`, GitHub's numeric id. */
  subject: string;
  /** Lower case, and verified by the provider. */
  email: string;
}

/**
 * Why a sign-in was refused. A closed set, for the log and the audit record; the person is told one plain sentence
 * whichever it was, because which check failed is a clue for an attacker.
 */
export type SignInFailure = 'provider-error' | 'invalid-token' | 'unverified-email';

export class SignInRefused extends Error {
  constructor(readonly reason: SignInFailure) {
    super(`Sign-in refused: ${reason}.`);
    this.name = 'SignInRefused';
  }
}

export interface AuthorizeInput {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
}

export interface CompleteInput {
  code: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
}

/**
 * One way to sign in. The hosts it talks to are constants in its own module, and a test replaces the `fetch` it is
 * given, never a URL: there is no setting that points sign-in at another host. To add Microsoft Entra External ID,
 * Apple or another provider is one more class that implements this, and one more entry in the registry.
 */
export interface IdentityProvider {
  readonly id: PublicProviderId;
  readonly label: string;
  /** Where to send the browser. Authorization Code with PKCE (S256); `state` binds the reply to this browser. */
  authorizeUrl(input: AuthorizeInput): string;
  /** Redeems the code and says who it is, or throws `SignInRefused`. */
  complete(input: CompleteInput): Promise<VerifiedIdentity>;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/u;

/** A verified address in the one form it is compared and stored in, or null when it cannot be one. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** At most `limit` bytes of a response, read as JSON; anything else is the provider misbehaving. */
export async function readJson(response: Response, limit = 65_536): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new SignInRefused('provider-error');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new SignInRefused('provider-error');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new SignInRefused('provider-error');
  }
}

/** One request to a provider: no redirects, a time limit, and any failure is the provider's. */
export async function providerRequest(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new SignInRefused('provider-error');
  }
}
