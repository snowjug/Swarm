import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { Owner, Repository } from '../storage/repository.js';
import type { SessionInfo } from '../storage/sessions.js';
import { mayOnProject, workspaceRoleOf } from './access.js';
import { cookieName, readCookie } from './cookies.js';
import { policyFor } from './policy.js';
import { LOCAL_PRINCIPAL, type Principal } from './principal.js';
import { projectAllows, workspaceAllows, type ProjectRole, type WorkspaceRole } from './roles.js';
import { TokenVerifier, bearerToken } from './tokens.js';

/** The base name of the session cookie; a browser given the Secure attribute also gets `__Host-`. */
export const SESSION_COOKIE = 'swarm_session';
/** Sent by the Swarm page on every change. Another site cannot make a browser add a custom header. */
export const CSRF_HEADER = 'x-swarm-csrf';
const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** What the caller's membership allows on this request, resolved once by the guard. */
export interface Membership {
  workspace: WorkspaceRole | null;
  /** Their role on the project named by `:id`, when the route names one. */
  project: ProjectRole | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set for every API request: the signed-in caller, or the local user when there is no sign-in. */
    principal: Principal | null;
    membership: Membership;
    /** When the caller came in with a session cookie: when it ends. Null for a token or the local user. */
    session: SessionInfo | null;
  }
}

const projectParams = z.object({ id: z.uuid() });

/** The caller of a request. Routes behind the guard always have one. */
export function principalOf(request: FastifyRequest): Principal {
  return request.principal ?? LOCAL_PRINCIPAL;
}

export function ownerOf(principal: Principal): Owner {
  return { tenantId: principal.tenantId, ownerId: principal.id };
}

const notFound = (): AppError =>
  new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');

/**
 * Who owns an experiment of the caller's tenant. Another tenant's experiment is reported exactly as
 * one that does not exist, so knowing its identifier reveals nothing, not even that it exists. The
 * guard applies this to the experiment named in the path; a route that is handed a second one in
 * its query or body must apply `requireReadable` to that one too.
 */
export function ownerInTenant(repository: Repository, id: string, tenantId: string): Owner {
  const owner = repository.ownership(id);
  if (!owner || owner.tenantId !== tenantId) throw notFound();
  return owner;
}

/**
 * An experiment the caller may read: it is in their tenant and they hold a role on it, directly or
 * as an owner or admin of the workspace. Anything else, including an experiment of their own
 * workspace that they were not added to, is reported as missing.
 */
export function requireReadable(repository: Repository, principal: Principal, id: string): Owner {
  const owner = ownerInTenant(repository, id, principal.tenantId);
  if (!mayOnProject(repository, principal, id, 'read')) throw notFound();
  return owner;
}

/**
 * Authenticates and authorises every API request against the table in `policy.ts`, before the
 * request body is read. With `AUTH_MODE=none` the caller is the local user, who owns everything,
 * and nothing is checked: the application is then only as exposed as the address it listens on.
 * With `entra`, a missing token, a missing policy entry, a missing membership, a missing capability
 * and a project in another tenant all refuse the request, and a project the caller cannot see is
 * reported as not found. Membership is read from the database on every request, so removing someone
 * takes effect on their next call, whatever their token still says.
 */
export function registerAuth(
  app: FastifyInstance,
  options: { config: AuthConfig; repository: Repository; verifier?: TokenVerifier },
): void {
  const { config, repository } = options;
  const verifier = config.mode === 'entra' ? (options.verifier ?? new TokenVerifier(config)) : null;
  app.decorateRequest('principal', null);
  // Set to a fresh object at the start of every API request, below; null only for files and unknown paths.
  app.decorateRequest('membership', null as unknown as Membership);
  app.decorateRequest('session', null);

  const signIn = config.session;
  const sessionCookie = signIn ? cookieName(SESSION_COOKIE, signIn.secureCookies) : null;
  const idleMs = (signIn?.idleMinutes ?? 0) * 60_000;

  /**
   * Who is calling. An Authorization header means a bearer token, and nothing else is consulted then,
   * so a bad token is not rescued by a cookie. Without one, a session cookie from signing in through
   * this server is the only other way in. There is no third: no credential is not the local user.
   * A change made with a cookie must also carry the anti-forgery header, which another site cannot
   * make a browser add.
   */
  const authenticate = async (request: FastifyRequest): Promise<Principal> => {
    if (!verifier) throw new Error('Authentication was asked for without sign-in configured.');
    if (request.headers.authorization !== undefined || !signIn || !sessionCookie) {
      return verifier.verify(bearerToken(request.headers.authorization));
    }
    const token = readCookie(request.headers.cookie, sessionCookie);
    const found = token ? repository.sessions.find(token, idleMs) : null;
    if (!found) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
    request.session = found.info;
    if (UNSAFE_METHODS.has(request.method) && request.headers[CSRF_HEADER] !== '1') {
      const attempted = projectParams.safeParse(request.params);
      repository.audit.record({
        actor: found.principal.id,
        action: 'access.refused',
        targetType: 'route',
        targetId: request.routeOptions.url ?? 'unknown',
        projectId: null,
        detail: {
          method: request.method,
          status: 403,
          code: 'CSRF_REQUIRED',
          ...(attempted.success ? { experiment: attempted.data.id } : {}),
        },
      });
      throw new AppError(
        403,
        'CSRF_REQUIRED',
        'This change must be made from the Swarm page itself. Reload it and try again.',
      );
    }
    return found.principal;
  };

  app.addHook('onRequest', async (request) => {
    const url = request.routeOptions.url;
    // The single-page app's files and unknown paths hold nothing to protect.
    if (!url?.startsWith('/api')) return;
    request.membership = { workspace: null, project: null };
    if (!verifier) {
      request.principal = LOCAL_PRINCIPAL;
      request.membership = { workspace: 'owner', project: 'lead' };
      return;
    }
    const access = policyFor(request.method, url);
    if (!access) {
      throw new AppError(
        403,
        'ROUTE_NOT_AUTHORIZED',
        'This route has no authorization policy, so it is refused.',
      );
    }
    if (access.kind === 'public') return;

    const principal = await authenticate(request);
    request.principal = principal;
    // A signed-in caller that is refused is evidence worth keeping. An anonymous one is not: the
    // log would fill with whatever the internet sends, and the rate limiter already counts it.
    const refuse = (error: AppError): never => {
      const attempted = projectParams.safeParse(request.params);
      repository.audit.record({
        actor: principal.id,
        action: 'access.refused',
        targetType: 'route',
        targetId: url,
        projectId: null,
        detail: {
          method: request.method,
          status: error.statusCode,
          code: error.code,
          ...(attempted.success ? { experiment: attempted.data.id } : {}),
        },
      });
      throw error;
    };

    if (access.kind === 'platform') {
      if (!principal.platformAdmin) {
        return refuse(new AppError(403, 'FORBIDDEN', 'Only a platform administrator can do this.'));
      }
      return;
    }

    const workspace = workspaceRoleOf(repository, principal);
    request.membership.workspace = workspace;
    if (access.kind === 'signed-in') return;
    if (access.kind === 'workspace') {
      if (!workspaceAllows(access.capability, workspace)) {
        return refuse(
          new AppError(
            403,
            'FORBIDDEN',
            access.capability === 'manage-members'
              ? 'Only a workspace owner or admin can manage members.'
              : 'You are not a member of this workspace.',
          ),
        );
      }
      return;
    }

    const { id } = projectParams.parse(request.params);
    try {
      ownerInTenant(repository, id, principal.tenantId);
    } catch (error) {
      if (error instanceof AppError) return refuse(error);
      throw error;
    }
    const project = repository.members.projectRole(id, principal.id);
    request.membership.project = project;
    const roles = { project, workspace };
    // Holding no role at all is reported as "not found", so a project's existence is not disclosed
    // to someone who was not added to it. Every role includes reading.
    if (!projectAllows('read', roles)) return refuse(notFound());
    if (!projectAllows(access.capability, roles)) {
      return refuse(
        new AppError(403, 'FORBIDDEN', 'Your role on this experiment does not allow this action.'),
      );
    }
  });
}
