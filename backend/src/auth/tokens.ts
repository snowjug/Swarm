import { createRemoteJWKSet, decodeJwt, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { AuthConfig } from '../config.js';
import { AppError } from '../errors.js';
import { highestRole, type Principal } from './principal.js';

/** Far longer than any real access token, short enough that parsing one costs nothing. */
const MAX_TOKEN_LENGTH = 8_192;
const CLOCK_TOLERANCE_SECONDS = 60;

const guid = z.uuid();

/** What the client is told, whatever went wrong. Which check failed is a clue for an attacker. */
const rejected = (): AppError =>
  new AppError(
    401,
    'UNAUTHENTICATED',
    'Sign in again: the access token is missing, invalid or expired.',
  );

/**
 * Turns a Microsoft Entra access token into a principal, or refuses it. Signature, issuer,
 * audience, expiry and tenant are all checked; the tenant must be one the server was told to
 * accept, and the issuer is derived from the token's own tenant only after the allow-list agrees.
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

  async verify(token: string | null): Promise<Principal> {
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

    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        audience: this.config.audience ?? undefined,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['exp', 'iat', 'oid', 'tid'],
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
    const oid = payload.oid;
    if (typeof oid !== 'string' || !guid.safeParse(oid).success || payload.tid !== tenant) {
      throw rejected();
    }
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    const role = highestRole(roles);
    if (!role) {
      // Authenticated, but nobody has granted this person anything in this application.
      throw new AppError(
        403,
        'NO_ROLE',
        'You are signed in but have no Swarm role. Ask an administrator to assign one.',
      );
    }
    return { id: oid.toLowerCase(), tenantId: tenant, role };
  }
}

/** The token from an `Authorization: Bearer` header, or null. Cookies are never consulted. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/u.exec(header ?? '');
  return match?.[1] ?? null;
}
