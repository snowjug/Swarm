import { timingSafeEqual } from 'node:crypto';
import {
  createRemoteJWKSet,
  decodeJwt,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { z } from 'zod';
import type { AuthConfig } from '../config.js';
import { AppError } from '../errors.js';
import { parseAppRoles } from './roles.js';
import type { Principal } from './principal.js';

/** Far longer than any real access token, short enough that parsing one costs nothing. */
const MAX_TOKEN_LENGTH = 8_192;
const CLOCK_TOLERANCE_SECONDS = 60;

const guid = z.uuid();

/** What the client is told, whatever went wrong. Which check failed is a clue for an attacker. */
export const unauthenticated = (): AppError =>
  new AppError(
    401,
    'UNAUTHENTICATED',
    'Sign in again: the access token is missing, invalid or expired.',
  );
const rejected = unauthenticated;

const sameText = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Turns a Microsoft Entra token into a principal, or refuses it. Signature, issuer, audience,
 * expiry and tenant are all checked; the tenant must be one the server was told to accept, and the
 * issuer is derived from the token's own tenant only after the allow-list agrees.
 *
 * Two kinds of token pass through here and are never interchangeable. An access token is what an API
 * client sends in the Authorization header. An ID token is what Microsoft returns to this server
 * when a person signs in through it; it carries the nonce that sign-in started with and is good for
 * that one purpose. A bearer token that carries a nonce is refused, so an ID token cannot be
 * presented as an access token, whatever audience it was issued for.
 */
export class TokenVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(
    private readonly config: AuthConfig,
    /** Test hook: a key resolver that does not touch the network. */
    keys?: JWTVerifyGetKey,
  ) {
    if (config.mode !== 'entra' || !config.audience || !config.jwksUri) {
      throw new Error('A token verifier needs AUTH_MODE=entra.');
    }
    this.keys =
      keys ??
      createRemoteJWKSet(new URL(config.jwksUri), {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 6 * 60 * 60 * 1_000,
      });
  }

  /** An access token, from an `Authorization: Bearer` header. */
  async verify(token: string | null): Promise<Principal> {
    const { payload, tenant } = await this.claims(token, this.config.audience!, [
      'exp',
      'iat',
      'oid',
      'tid',
    ]);
    if ('nonce' in payload) throw rejected();
    return this.principal(payload, tenant);
  }

  /** The ID token Microsoft returned for the sign-in that was started with this nonce and client. */
  async verifyIdToken(
    token: string | null,
    expected: { audience: string; nonce: string },
  ): Promise<Principal> {
    const { payload, tenant } = await this.claims(token, expected.audience, [
      'exp',
      'iat',
      'oid',
      'tid',
      'nonce',
    ]);
    if (typeof payload.nonce !== 'string' || !sameText(payload.nonce, expected.nonce)) {
      throw rejected();
    }
    return this.principal(payload, tenant);
  }

  private async claims(
    token: string | null,
    audience: string,
    required: string[],
  ): Promise<{ payload: JWTPayload; tenant: string }> {
    if (!token || token.length > MAX_TOKEN_LENGTH || token.split('.').length !== 3) {
      throw rejected();
    }
    let tenant: string;
    try {
      const claimed = decodeJwt(token).tid;
      if (typeof claimed !== 'string' || !guid.safeParse(claimed).success) throw rejected();
      tenant = claimed.toLowerCase();
    } catch {
      throw rejected();
    }
    if (!this.config.tenants.has(tenant)) throw rejected();

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        audience,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: required,
      }));
    } catch (error) {
      // A key-set outage is the server's problem, not the caller's; say so instead of "sign in".
      if (error instanceof errors.JWKSTimeout) {
        throw new AppError(
          503,
          'IDENTITY_UNAVAILABLE',
          'The identity service could not be reached. Retry shortly.',
        );
      }
      throw rejected();
    }
    return { payload, tenant };
  }

  private principal(payload: JWTPayload, tenant: string): Principal {
    const oid = payload.oid;
    if (typeof oid !== 'string' || !guid.safeParse(oid).success || payload.tid !== tenant) {
      throw rejected();
    }
    const roles = parseAppRoles(Array.isArray(payload.roles) ? payload.roles : []);
    if (!roles.user) {
      // Authenticated, but nobody has granted this person anything in this application.
      throw new AppError(
        403,
        'NO_ROLE',
        'You are signed in but have no Swarm role. Ask an administrator to assign one.',
      );
    }
    return {
      id: oid.toLowerCase(),
      tenantId: tenant,
      platformAdmin: roles.platformAdmin,
      bootstrapAdmin: roles.bootstrapAdmin,
    };
  }
}

/** The token from an `Authorization: Bearer` header, or null. Cookies are never consulted. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/u.exec(header ?? '');
  return match?.[1] ?? null;
}
