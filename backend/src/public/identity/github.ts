import { pkceChallenge } from '../../auth/oidc.js';
import type { ProviderCredentials } from '../config.js';
import {
  SignInRefused,
  normalizeEmail,
  providerRequest,
  readJson,
  type AuthorizeInput,
  type CompleteInput,
  type IdentityProvider,
  type VerifiedIdentity,
} from './provider.js';

/**
 * GitHub, by OAuth 2.0: it is not OpenID Connect, so there is no ID token. The endpoints are GitHub's own, from
 * "Authorizing OAuth apps" and "List email addresses for the authenticated user" in its documentation, and are
 * constants. The authorization carries a PKCE challenge (`S256`, the only method GitHub supports), so a stolen code is
 * useless without this server's verifier. The access token is used for exactly two calls to the fixed API host, to learn
 * the numeric id and the primary address that GitHub has **verified**, and is then dropped.
 */
export const GITHUB = {
  authorize: 'https://github.com/login/oauth/authorize',
  token: 'https://github.com/login/oauth/access_token',
  user: 'https://api.github.com/user',
  emails: 'https://api.github.com/user/emails',
} as const;

const API_HEADERS = (accessToken: string): Record<string, string> => ({
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${accessToken}`,
  'user-agent': 'swarm-public-edition',
});

export class GitHubProvider implements IdentityProvider {
  readonly id = 'github' as const;
  readonly label = 'GitHub';

  constructor(
    private readonly credentials: ProviderCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  authorizeUrl(input: AuthorizeInput): string {
    const url = new URL(GITHUB.authorize);
    url.search = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: input.redirectUri,
      scope: 'user:email',
      state: input.state,
      code_challenge: pkceChallenge(input.verifier),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async complete(input: CompleteInput): Promise<VerifiedIdentity> {
    const exchanged = await providerRequest(this.fetcher, GITHUB.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.verifier,
      }),
    });
    if (!exchanged.ok) throw new SignInRefused('provider-error');
    // GitHub answers 200 with an `error` field for a code that did not work.
    const grant = (await readJson(exchanged)) as { access_token?: unknown } | null;
    const accessToken = grant?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0 || accessToken.length > 500) {
      throw new SignInRefused('invalid-token');
    }
    const profile = await providerRequest(this.fetcher, GITHUB.user, {
      headers: API_HEADERS(accessToken),
    });
    if (!profile.ok) throw new SignInRefused('provider-error');
    const identity = (await readJson(profile)) as { id?: unknown } | null;
    const id = identity?.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new SignInRefused('invalid-token');
    }
    const listed = await providerRequest(this.fetcher, GITHUB.emails, {
      headers: API_HEADERS(accessToken),
    });
    if (!listed.ok) throw new SignInRefused('provider-error');
    const emails = await readJson(listed, 262_144);
    if (!Array.isArray(emails)) throw new SignInRefused('provider-error');
    // Only the address that is both the primary and verified counts: the others may belong to someone else.
    const primary = emails.find(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { primary?: unknown }).primary === true &&
        (entry as { verified?: unknown }).verified === true,
    ) as { email?: unknown } | undefined;
    const email = normalizeEmail(primary?.email);
    if (email === null) throw new SignInRefused('unverified-email');
    return { provider: 'github', subject: String(id), email };
  }
}
