import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
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
 * Google, by OpenID Connect. The endpoints are Google's own, as its discovery document
 * (https://accounts.google.com/.well-known/openid-configuration) publishes them, and are constants: nothing configures
 * them. The ID token is the proof; the access token Google may also return is never read.
 */
export const GOOGLE = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  keys: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
} as const;

const MAX_ID_TOKEN_LENGTH = 8_192;
const same = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class GoogleProvider implements IdentityProvider {
  readonly id = 'google' as const;
  readonly label = 'Google';
  private readonly keys: JWTVerifyGetKey;

  constructor(
    private readonly credentials: ProviderCredentials,
    private readonly fetcher: typeof fetch = fetch,
    /** Test hook: a key resolver that does not touch the network. */
    keys?: JWTVerifyGetKey,
  ) {
    this.keys =
      keys ??
      createRemoteJWKSet(new URL(GOOGLE.keys), {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 6 * 60 * 60 * 1_000,
      });
  }

  authorizeUrl(input: AuthorizeInput): string {
    const url = new URL(GOOGLE.authorize);
    url.search = new URLSearchParams({
      client_id: this.credentials.clientId,
      response_type: 'code',
      redirect_uri: input.redirectUri,
      scope: 'openid email',
      state: input.state,
      nonce: input.nonce,
      code_challenge: pkceChallenge(input.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async complete(input: CompleteInput): Promise<VerifiedIdentity> {
    const response = await providerRequest(this.fetcher, GOOGLE.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        code_verifier: input.verifier,
      }),
    });
    if (!response.ok) throw new SignInRefused('provider-error');
    const body = (await readJson(response)) as { id_token?: unknown } | null;
    const token = body?.id_token;
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_ID_TOKEN_LENGTH) {
      throw new SignInRefused('invalid-token');
    }
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(token, this.keys, {
        issuer: [...GOOGLE.issuers],
        audience: this.credentials.clientId,
        algorithms: ['RS256'],
        clockTolerance: 60,
        requiredClaims: ['exp', 'iat', 'sub', 'nonce', 'email'],
      }));
    } catch (error) {
      // A key-set outage is Google's, not the person's.
      throw new SignInRefused(
        error instanceof errors.JWKSTimeout ? 'provider-error' : 'invalid-token',
      );
    }
    if (typeof claims.nonce !== 'string' || !same(claims.nonce, input.nonce)) {
      throw new SignInRefused('invalid-token');
    }
    const subject = claims.sub;
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 255) {
      throw new SignInRefused('invalid-token');
    }
    // Google sends a boolean; a string is accepted only in the one spelling it has used.
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    const email = normalizeEmail(claims.email);
    if (!verified || email === null) throw new SignInRefused('unverified-email');
    return { provider: 'google', subject, email };
  }
}
