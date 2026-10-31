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
  'GET /api/projects/:id/jobs': project('read'),
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

  // Report Studio. Writing the report and judging it are separate duties and separate capabilities:
  // the author edits, regenerates and submits; the reviewer notes, approves and sends it back.
  'GET /api/projects/:id/studio': project('read'),
  'POST /api/projects/:id/studio': project('edit'),
  'PUT /api/projects/:id/studio/sections/:sectionId': project('edit'),
  'PUT /api/projects/:id/studio/sections/:sectionId/lock': project('edit'),
  'POST /api/projects/:id/studio/sections/:sectionId/notes': project('review'),
  'POST /api/projects/:id/studio/sections/:sectionId/restore': project('edit'),
  'POST /api/projects/:id/studio/sections/:sectionId/regenerate': project('edit'),
  'POST /api/projects/:id/studio/sections/:sectionId/proposal': project('edit'),
  'POST /api/projects/:id/studio/submit': project('edit'),
  'POST /api/projects/:id/studio/approve': project('review'),
  'POST /api/projects/:id/studio/request-changes': project('review'),
  'POST /api/projects/:id/studio/reopen': project('edit'),
  'GET /api/projects/:id/studio/export': project('export'),

  'GET /api/projects/:id/members': project('read'),
  'PUT /api/projects/:id/members/:principalId': project('members'),
  'DELETE /api/projects/:id/members/:principalId': project('members'),

  // What a project may spend on the model. Anyone who can read the project sees it; only a workspace
  // owner or administrator, who hold every capability, change it.
  'GET /api/projects/:id/budget': project('read'),
  'PUT /api/projects/:id/budget': project('budget'),

  'GET /api/workspace/members': { kind: 'workspace', capability: 'manage-members' },
  'PUT /api/workspace/members/:principalId': { kind: 'workspace', capability: 'manage-members' },
  'DELETE /api/workspace/members/:principalId': {
    kind: 'workspace',
    capability: 'manage-members',
  },

  // Scenario Lab: one block per feature, each edited only by the feature that owns it.
  // [url-ingest policy]
  // Reads a page from the public web for the caller, so it is open to whoever may start a project.
  'POST /api/evidence/url': { kind: 'workspace', capability: 'create-project' },

  // [scenario policy]
  // Reading a question may call a model, so it is for someone who may create projects. A stored
  // scenario is read like the project it belongs to, and changed by whoever may edit the project.
  'POST /api/scenario/parse': { kind: 'workspace', capability: 'create-project' },
  'GET /api/projects/:id/scenario': project('read'),
  'PUT /api/projects/:id/scenario': project('edit'),

  // [stakeholders policy]

  // [analysis policy]
  'GET /api/projects/:id/analysis': project('read'),
  'GET /api/projects/:id/analysis/:aid': project('read'),
  'POST /api/projects/:id/analysis': project('run'),
  'POST /api/projects/:id/analysis/:aid/cancel': project('run'),

  // [critics policy]
  // The independent review: reading is for anyone who can read the project, running it is a duty of
  // those who run the analysis, and answering a critique is an edit.
  'GET /api/projects/:id/critiques': project('read'),
  'POST /api/projects/:id/critiques/run': project('run'),
  'PUT /api/projects/:id/critiques/:cid/response': project('edit'),

  // [brief policy]
  // The decision brief: made by someone who may edit the project, read by anyone who may read it, and
  // handed over (Markdown, JSON, printable page) by anyone who may export.
  'GET /api/projects/:id/brief': project('read'),
  'POST /api/projects/:id/brief': project('edit'),
  'GET /api/projects/:id/brief/export': project('export'),
};

/** HEAD is answered by the GET handler and is authorised exactly like it. */
export function policyFor(method: string, routeUrl: string): Access | undefined {
  const verb = method === 'HEAD' ? 'GET' : method;
  return ROUTE_POLICY[`${verb} ${routeUrl}`];
}
