import type { ProjectCapability, WorkspaceCapability } from './roles.js';

/**
 * What a route requires. Written as data, in one place, so that every API route's authorisation can
 * be read, reviewed and tested together. A route with no entry here is refused, not allowed.
 */
export type Access =
  /** No sign-in: only liveness. */
  | { kind: 'public' }
  /** Any signed-in principal who may use Swarm; nothing about one workspace or project. */
  | { kind: 'signed-in' }
  /** A platform administrator: runs the platform, and sees no workspace's projects. */
  | { kind: 'platform' }
  /** A member of the caller's own workspace with this capability. */
  | { kind: 'workspace'; capability: WorkspaceCapability }
  /**
   * An existing project of the caller's own workspace on which they hold a role that allows this.
   * A project in another tenant, and one the caller was not added to, is reported as missing, so
   * its existence is not disclosed; a member whose role does not allow it is told so.
   *
   * This covers only the project named by `:id` in the path. A handler that is given another
   * project's identifier anywhere else (the query or the body) must check it itself with
   * `requireReadable`; `GET /api/projects/:id/compare?with=` once read another tenant's run for want
   * of that. `auth.test.ts` lists every identifier field the routes accept, so a new one has to be
   * looked at, but it cannot tell whether the handler checked it.
   */
  | { kind: 'project'; capability: ProjectCapability };

const project = (capability: ProjectCapability): Access => ({ kind: 'project', capability });

export const ROUTE_POLICY: Readonly<Record<string, Access>> = {
  'GET /api/health': { kind: 'public' },
  'GET /api/health/live': { kind: 'public' },
  'GET /api/health/ready': { kind: 'public' },
  'GET /api/config': { kind: 'signed-in' },
  'GET /api/provider/status': { kind: 'signed-in' },
  'GET /api/workspace': { kind: 'signed-in' },
  'GET /api/session': { kind: 'signed-in' },
  // A real model round trip costs money and is rate-limited by the provider, not by a person.
  'POST /api/provider/check': { kind: 'platform' },
  'GET /api/audit/verify': { kind: 'platform' },
  'POST /api/documents/extract': { kind: 'workspace', capability: 'create-project' },

  'GET /api/projects': { kind: 'signed-in' },
  'POST /api/projects': { kind: 'workspace', capability: 'create-project' },
  'GET /api/projects/:id': project('read'),
  'DELETE /api/projects/:id': project('delete'),
  'GET /api/projects/:id/export': project('export'),
  'GET /api/projects/:id/evidence': project('read'),
  'GET /api/projects/:id/memories': project('read'),
  'GET /api/projects/:id/compare': project('read'),
  'GET /api/projects/:id/ledger': project('read'),
  'GET /api/projects/:id/claims/:claimId': project('read'),
  'GET /api/projects/:id/chat': project('read'),

  'POST /api/projects/:id/chat': project('chat'),
  'POST /api/projects/:id/run': project('run'),
  'POST /api/projects/:id/cancel': project('run'),
  'POST /api/projects/:id/pause': project('run'),
  'POST /api/projects/:id/steps/:step': project('run'),
  'PUT /api/projects/:id/intervention': project('run'),
  'PATCH /api/projects/:id/environment': project('run'),
  'POST /api/projects/:id/surveys': project('chat'),
  'POST /api/projects/:id/surveys/:surveyId/cancel': project('chat'),
  // Branching reads the parent and creates a new project that the caller leads.
  'POST /api/projects/:id/branches': project('run'),

  // Reviewing is a separate duty from running: a reviewer never runs what they review.
  'POST /api/projects/:id/claims/:claimId/review': project('review'),
  'POST /api/projects/:id/conflicts/:conflictId/review': project('review'),
  'GET /api/projects/:id/audit': project('review'),

  'GET /api/projects/:id/members': project('read'),
  'PUT /api/projects/:id/members/:principalId': project('members'),
  'DELETE /api/projects/:id/members/:principalId': project('members'),

  'GET /api/workspace/members': { kind: 'workspace', capability: 'manage-members' },
  'PUT /api/workspace/members/:principalId': { kind: 'workspace', capability: 'manage-members' },
  'DELETE /api/workspace/members/:principalId': {
    kind: 'workspace',
    capability: 'manage-members',
  },
};

/** HEAD is answered by the GET handler and is authorised exactly like it. */
export function policyFor(method: string, routeUrl: string): Access | undefined {
  const verb = method === 'HEAD' ? 'GET' : method;
  return ROUTE_POLICY[`${verb} ${routeUrl}`];
}
