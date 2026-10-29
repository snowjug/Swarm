import type { Role } from './principal.js';

/**
 * What a route requires. Written as data, in one place, so that every API route's authorisation can
 * be read, reviewed and tested together. A route with no entry here is refused, not allowed.
 */
export type Access =
  /** No sign-in: only liveness. */
  | { kind: 'public' }
  /** Any signed-in principal with at least this role; nothing about one project. */
  | { kind: 'signed-in'; role: Role }
  /**
   * An existing project in the caller's own tenant. A project in another tenant is reported as
   * missing, so its existence is not disclosed. `owner` additionally requires the project's owner
   * (administrators count as owners).
   *
   * This covers only the project named by `:id` in the path. A handler that is given another
   * project's identifier anywhere else (the query or the body) must check it itself with
   * `ownerInTenant`; `GET /api/projects/:id/compare?with=` once read another tenant's run for want
   * of that. `auth.test.ts` lists every identifier field the routes accept, so a new one has to be
   * looked at, but it cannot tell whether the handler checked it.
   */
  | { kind: 'project'; role: Role; owner?: boolean };

const read: Access = { kind: 'project', role: 'reader' };
const own: Access = { kind: 'project', role: 'analyst', owner: true };
const review: Access = { kind: 'project', role: 'reviewer' };

export const ROUTE_POLICY: Readonly<Record<string, Access>> = {
  'GET /api/health': { kind: 'public' },
  'GET /api/config': { kind: 'signed-in', role: 'reader' },
  'GET /api/provider/status': { kind: 'signed-in', role: 'reader' },
  // A real model round trip costs money and is rate-limited by the provider, not by a person.
  'POST /api/provider/check': { kind: 'signed-in', role: 'admin' },
  'GET /api/audit/verify': { kind: 'signed-in', role: 'admin' },
  'POST /api/documents/extract': { kind: 'signed-in', role: 'analyst' },

  'GET /api/projects': { kind: 'signed-in', role: 'reader' },
  'POST /api/projects': { kind: 'signed-in', role: 'analyst' },
  'GET /api/projects/:id': read,
  'DELETE /api/projects/:id': own,
  'GET /api/projects/:id/export': read,
  'GET /api/projects/:id/evidence': read,
  'GET /api/projects/:id/memories': read,
  'GET /api/projects/:id/compare': read,
  'GET /api/projects/:id/ledger': read,
  'GET /api/projects/:id/claims/:claimId': read,
  'GET /api/projects/:id/chat': read,

  'POST /api/projects/:id/chat': own,
  'POST /api/projects/:id/run': own,
  'POST /api/projects/:id/cancel': own,
  'POST /api/projects/:id/pause': own,
  'POST /api/projects/:id/steps/:step': own,
  'PUT /api/projects/:id/intervention': own,
  'PATCH /api/projects/:id/environment': own,
  'POST /api/projects/:id/surveys': own,
  'POST /api/projects/:id/surveys/:surveyId/cancel': own,
  // Branching reads the parent and creates a new project that the caller owns.
  'POST /api/projects/:id/branches': { kind: 'project', role: 'analyst' },

  // Reviewing is a separate duty from running, so it does not need ownership.
  'POST /api/projects/:id/claims/:claimId/review': review,
  'POST /api/projects/:id/conflicts/:conflictId/review': review,
  'GET /api/projects/:id/audit': review,
};

/** HEAD is answered by the GET handler and is authorised exactly like it. */
export function policyFor(method: string, routeUrl: string): Access | undefined {
  const verb = method === 'HEAD' ? 'GET' : method;
  return ROUTE_POLICY[`${verb} ${routeUrl}`];
}
