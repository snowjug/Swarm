import type { FastifyRequest } from 'fastify';
import { CSRF_HEADER, type PublicGuard } from '../auth/guard.js';
import { readCookie } from '../auth/cookies.js';
import { policyFor, type Access } from '../auth/policy.js';
import type { Principal } from '../auth/principal.js';
import { AppError } from '../errors.js';
import type { PublicContext } from './context.js';

const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The routes the public edition adds, in the same form as `auth/policy.ts`. A route with no entry in either table is
 * refused, exactly as in the pilot. `backend/test/public/policy.test.ts` fails if a route and this table disagree.
 */
export const PUBLIC_ROUTE_POLICY: Readonly<Record<string, Access>> = {
  'GET /api/public/session': { kind: 'public' },
  'GET /api/public/status': { kind: 'public' },
  'GET /api/public/legal/:doc': { kind: 'public' },
  // Authenticated by its own key, never by a session.
  'POST /api/ops/free-tier/off': { kind: 'public' },
  'GET /api/account': { kind: 'signed-in' },
  'DELETE /api/account': { kind: 'signed-in' },
  'GET /api/usage': { kind: 'signed-in' },
  'POST /api/byok/connect': { kind: 'signed-in' },
  'DELETE /api/byok': { kind: 'signed-in' },
  'GET /api/admin/usage': { kind: 'platform' },
  'GET /api/admin/audit': { kind: 'platform' },
  'POST /api/admin/free-tier': { kind: 'platform' },
  'POST /api/admin/signups': { kind: 'platform' },
  'POST /api/admin/users/:id/disable': { kind: 'platform' },
};

/**
 * What the public edition does not have. A person owns exactly one workspace and nobody is ever added to it, or to a
 * project of it, so these answer 404 whoever asks, before anything about the caller is read.
 */
export const PUBLIC_REFUSED_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/workspace/members',
  'PUT /api/workspace/members/:principalId',
  'DELETE /api/workspace/members/:principalId',
  'GET /api/projects/:id/members',
  'PUT /api/projects/:id/members/:principalId',
  'DELETE /api/projects/:id/members/:principalId',
]);

const unauthenticated = (): AppError =>
  new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');

/** The guard of the public edition. Built once per app. */
export function createPublicGuard(context: PublicContext): PublicGuard {
  const { repository, users, pub } = context;

  return {
    policy(method, routeUrl) {
      const verb = method === 'HEAD' ? 'GET' : method;
      return PUBLIC_ROUTE_POLICY[`${verb} ${routeUrl}`] ?? policyFor(method, routeUrl);
    },

    refuses(method, routeUrl) {
      const verb = method === 'HEAD' ? 'GET' : method;
      return PUBLIC_REFUSED_ROUTES.has(`${verb} ${routeUrl}`)
        ? new AppError(404, 'NOT_AVAILABLE', 'This is not available in the public edition.')
        : null;
    },

    async authenticate(request: FastifyRequest) {
      // A bearer token is how a pilot's API client signs in. Here the cookie is the only way, and a request that
      // offers a token as well is not guessed at.
      if (request.headers.authorization !== undefined) throw unauthenticated();
      const token = readCookie(request.headers.cookie, context.sessionCookie);
      const found = token ? repository.sessions.find(token, context.lifetime.idleMs) : null;
      if (!found || !token) throw unauthenticated();
      const user = users.get(found.principal.id);
      // A deleted account, or a session that names a workspace the account does not have, ends here.
      if (!user || user.workspaceId !== found.principal.tenantId) {
        repository.sessions.revoke(token);
        throw unauthenticated();
      }
      if (user.disabled) {
        repository.sessions.revoke(token);
        throw new AppError(
          403,
          'ACCOUNT_DISABLED',
          'This account has been switched off. If you think that is a mistake, contact the site owner.',
        );
      }
      if (UNSAFE_METHODS.has(request.method)) {
        const crossSite = request.headers['sec-fetch-site'] === 'cross-site';
        if (request.headers[CSRF_HEADER] !== '1' || crossSite) {
          context.audit('public.csrf.refused', user.id, { method: request.method });
          throw new AppError(
            403,
            'CSRF_REQUIRED',
            'This change must be made from the Swarm page itself. Reload it and try again.',
          );
        }
      }
      const principal: Principal = {
        id: user.id,
        tenantId: user.workspaceId,
        // Decided from the address on every request, so that removing an administrator takes effect at once.
        platformAdmin: pub.adminEmails.has(user.email),
        bootstrapAdmin: false,
      };
      return { principal, session: found.info };
    },
  };
}
