import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { TokenVerifier } from '../../src/auth/tokens.js';
import { testConfig } from '../fixtures.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';
export const TENANT_C = '33333333-3333-4333-8333-333333333333';
export const AUDIENCE = 'api://swarm-test';

export const entraEnvironment = {
  AUTH_MODE: 'entra',
  AUTH_ENTRA_TENANT_ID: TENANT_A,
  AUTH_ENTRA_ALLOWED_TENANTS: TENANT_B,
  AUTH_ENTRA_AUDIENCE: AUDIENCE,
};

// A test identity provider: real RSA keys and really signed tokens. Only the network fetch of
// Microsoft's published key set is replaced by a local one.
export const idp = await (async () => {
  const pair = await generateKeyPair('RS256');
  const attacker = await generateKeyPair('RS256');
  const jwk: JWK = {
    ...(await exportJWK(pair.publicKey)),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };
  return {
    privateKey: pair.privateKey,
    attackerKey: attacker.privateKey,
    jwk,
    keys: createLocalJWKSet({ keys: [jwk] }),
  };
})();

export interface Minted {
  tid?: string;
  oid?: string | null;
  roles?: string[] | null;
  /** An ID token carries the nonce the sign-in was started with; an access token carries none. */
  nonce?: string | null;
  aud?: string;
  iss?: string;
  iat?: number | null;
  exp?: number | string;
  key?: Parameters<SignJWT['sign']>[0];
  alg?: string;
}

export async function mint(claims: Minted = {}): Promise<string> {
  const tid = claims.tid ?? TENANT_A;
  const body: Record<string, unknown> = { tid, ver: '2.0' };
  if (claims.oid !== null) body.oid = claims.oid ?? 'aaaaaaa1-0000-4000-8000-000000000001';
  if (claims.roles !== null) body.roles = claims.roles ?? ['Swarm.Analyst'];
  if (claims.nonce !== undefined && claims.nonce !== null) body.nonce = claims.nonce;
  const jwt = new SignJWT(body)
    .setProtectedHeader({ alg: claims.alg ?? 'RS256', kid: 'test-key' })
    .setIssuer(claims.iss ?? `https://login.microsoftonline.com/${tid}/v2.0`)
    .setAudience(claims.aud ?? AUDIENCE)
    .setExpirationTime(claims.exp ?? '10m');
  if (claims.iat !== null) jwt.setIssuedAt(claims.iat);
  return jwt.sign(claims.key ?? idp.privateKey);
}

export const authorization = async (claims: Minted) => ({
  authorization: `Bearer ${await mint(claims)}`,
});

export function verifier(environment: Record<string, string> = entraEnvironment): TokenVerifier {
  return new TokenVerifier(testConfig(environment).auth, idp.keys);
}
