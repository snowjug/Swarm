import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { Owner, Repository } from '../storage/repository.js';
import { policyFor } from './policy.js';
import { LOCAL_PRINCIPAL, atLeast, type Principal } from './principal.js';
import { TokenVerifier, bearerToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set for every API request: the signed-in caller, or the local user when there is no sign-in. */
    principal: Principal | null;
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

/**
 * Authenticates and authorises every API request against the table in `policy.ts`, before the
 * request body is read. With `AUTH_MODE=none` the caller is the local user and nothing is checked:
 * the application is then only as exposed as the address it listens on. With `entra`, a missing
 * token, a missing policy entry, a missing role and a project in another tenant all refuse the
 * request, and a project in another tenant is reported as not found.
 */
export function registerAuth(
  app: FastifyInstance,
  options: { config: AuthConfig; repository: Repository; verifier?: TokenVerifier },
): void {
  const { config, repository } = options;
  const verifier = config.mode === 'entra' ? (options.verifier ?? new TokenVerifier(config)) : null;
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request) => {
    const url = request.routeOptions.url;
    // The single-page app's files and unknown paths hold nothing to protect.
    if (!url?.startsWith('/api')) return;
    if (!verifier) {
      request.principal = LOCAL_PRINCIPAL;
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

    const principal = await verifier.verify(bearerToken(request.headers.authorization));
    request.principal = principal;
    if (!atLeast(principal, access.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Your role does not allow this action.');
    }
    if (access.kind === 'signed-in') return;

    const { id } = projectParams.parse(request.params);
    const owner = repository.ownership(id);
    // Another tenant's project is indistinguishable from one that does not exist.
    if (!owner || owner.tenantId !== principal.tenantId) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    }
    if (access.owner && owner.ownerId !== principal.id && principal.role !== 'admin') {
      throw new AppError(
        403,
        'NOT_OWNER',
        'Only the experiment’s owner or an administrator can do this.',
      );
    }
  });
}
