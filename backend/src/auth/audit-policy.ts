import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuditDetail } from '../storage/audit.js';
import type { Repository } from '../storage/repository.js';
import { principalOf } from './guard.js';

/**
 * What the audit log records about a request, written as data in one place, like the authorisation
 * table, so that a new route cannot be added without deciding what is recorded about it.
 *
 * The log holds who did what to which experiment and when, with identifiers, counts and short
 * labels. Never a question, an answer, a passage, a name or a credential.
 */
export type AuditRule =
  /** Recorded here, just before the answer is sent, and only when the request succeeded. */
  | {
      kind: 'request';
      action: string;
      /** The service as a whole, not one experiment. */
      scope?: 'service';
      detail?: (request: FastifyRequest) => AuditDetail;
    }
  /** Recorded by the storage or domain code, in the transaction of the change itself. */
  | { kind: 'inside'; action: string }
  /** Not recorded, and why. */
  | { kind: 'none'; reason: string };

const body = (request: FastifyRequest): Record<string, unknown> =>
  request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
const params = (request: FastifyRequest): Record<string, unknown> =>
  (request.params ?? {}) as Record<string, unknown>;
const query = (request: FastifyRequest): Record<string, unknown> =>
  (request.query ?? {}) as Record<string, unknown>;
const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const reads = (reason: string): AuditRule => ({ kind: 'none', reason });

export const AUDIT_POLICY: Readonly<Record<string, AuditRule>> = {
  'GET /api/health': reads('A liveness probe: no caller, no data.'),
  'GET /api/health/live': reads('Whether the process is running: no caller, no data.'),
  'GET /api/health/ready': reads('Whether the database answers: no caller, no data.'),
  'GET /api/config': reads('Public settings only.'),
  'GET /api/provider/status': reads('Counters the provider reports about itself.'),
  'POST /api/provider/check': {
    kind: 'request',
    action: 'provider.checked',
    scope: 'service',
  },
  'GET /api/audit/verify': reads('Reads the integrity of the log itself; it changes nothing.'),
  'POST /api/documents/extract': reads('Reads a file in memory and stores nothing.'),

  'GET /api/projects': reads('A list of the caller’s own experiments.'),
  'POST /api/projects': { kind: 'inside', action: 'project.created' },
  'GET /api/projects/:id': reads('Reading is not recorded; handing data over (export, chat) is.'),
  'DELETE /api/projects/:id': { kind: 'inside', action: 'project.deleted' },
  'GET /api/projects/:id/export': {
    kind: 'request',
    action: 'export.downloaded',
    detail: (request) => ({ format: query(request).format === 'json' ? 'json' : 'markdown' }),
  },
  'GET /api/projects/:id/evidence': reads('Reads passages the caller may already read.'),
  'GET /api/projects/:id/memories': reads('Reads recorded simulation memories.'),
  'GET /api/projects/:id/jobs': reads('Reads the state of the stage jobs of a project.'),
  'GET /api/projects/:id/compare': reads('A comparison computed from two recorded runs.'),
  'GET /api/projects/:id/ledger': reads(
    'Reads the ledger; building it is recorded as ledger.built.',
  ),
  'GET /api/projects/:id/claims/:claimId': reads('Reads one statement of the ledger.'),
  'GET /api/projects/:id/chat': reads('Reads a conversation the caller already holds.'),
  'GET /api/projects/:id/audit': reads(
    'Reading the log is not itself logged, or it would grow as it is read.',
  ),
  'GET /api/projects/:id/studio': reads(
    'Reads the studio document; handing it over (export) is what is recorded.',
  ),
  'GET /api/workspace': reads('The caller’s own role.'),
  'GET /api/session': reads('Whether, how and until when the caller is signed in.'),
  'GET /api/workspace/members': reads('Lists who belongs to the workspace and in what role.'),
  'GET /api/projects/:id/members': reads('Lists who may use the experiment and in what role.'),
  'GET /api/projects/:id/budget': reads('Reads what the project has used and may use.'),

  'PUT /api/workspace/members/:principalId': {
    kind: 'inside',
    // Recorded as `workspace.member.changed` when the person already belonged to the workspace.
    action: 'workspace.member.added',
  },
  'DELETE /api/workspace/members/:principalId': {
    kind: 'inside',
    action: 'workspace.member.removed',
  },
  'PUT /api/projects/:id/members/:principalId': {
    kind: 'inside',
    // Recorded as `project.member.changed` when the person already had a role on the project.
    action: 'project.member.added',
  },
  'DELETE /api/projects/:id/members/:principalId': {
    kind: 'inside',
    action: 'project.member.removed',
  },

  'PUT /api/projects/:id/budget': {
    kind: 'request',
    action: 'project.budget.changed',
    detail: (request) => ({
      callLimit:
        typeof body(request).callLimit === 'number' ? (body(request).callLimit as number) : null,
      tokenLimit:
        typeof body(request).tokenLimit === 'number' ? (body(request).tokenLimit as number) : null,
    }),
  },

  'POST /api/projects/:id/chat': {
    kind: 'request',
    action: 'chat.asked',
    detail: (request) => ({ target: body(request).target === 'report' ? 'analyst' : 'actor' }),
  },
  'POST /api/projects/:id/run': { kind: 'request', action: 'run.started' },
  'POST /api/projects/:id/cancel': { kind: 'request', action: 'run.cancelled' },
  'POST /api/projects/:id/pause': { kind: 'request', action: 'run.paused' },
  'POST /api/projects/:id/steps/:step': {
    kind: 'request',
    action: 'step.started',
    detail: (request) => ({
      step: String(params(request).step),
      resume: body(request).resume === true,
    }),
  },
  'PUT /api/projects/:id/intervention': {
    kind: 'request',
    action: 'intervention.set',
    detail: (request) => ({
      removed: request.body === null,
      round: typeof body(request).round === 'number' ? (body(request).round as number) : null,
    }),
  },
  'PATCH /api/projects/:id/environment': {
    kind: 'request',
    action: 'environment.edited',
    detail: (request) => ({ actors: count(body(request).agents) }),
  },
  'POST /api/projects/:id/surveys': { kind: 'request', action: 'survey.started' },
  'POST /api/projects/:id/surveys/:surveyId/cancel': {
    kind: 'request',
    action: 'survey.cancelled',
  },
  'POST /api/projects/:id/branches': { kind: 'inside', action: 'branch.created' },

  'GET /api/projects/:id/studio/export': {
    kind: 'request',
    action: 'studio.exported',
    detail: (request) => ({
      format:
        query(request).format === 'json' || query(request).format === 'memo'
          ? String(query(request).format)
          : 'markdown',
    }),
  },
  // Recorded by the studio, in the transaction of the change, with ids, counts and versions: never text.
  // Recorded as `studio.restarted` when it replaces a document made from an older report.
  'POST /api/projects/:id/studio': { kind: 'inside', action: 'studio.started' },
  'PUT /api/projects/:id/studio/sections/:sectionId': {
    kind: 'inside',
    action: 'studio.section.edited',
  },
  // Recorded as `studio.section.unlocked` when the lock is removed.
  'PUT /api/projects/:id/studio/sections/:sectionId/lock': {
    kind: 'inside',
    action: 'studio.section.locked',
  },
  'POST /api/projects/:id/studio/sections/:sectionId/notes': {
    kind: 'inside',
    action: 'studio.note.added',
  },
  'POST /api/projects/:id/studio/sections/:sectionId/restore': {
    kind: 'inside',
    action: 'studio.section.restored',
  },
  'POST /api/projects/:id/studio/sections/:sectionId/regenerate': {
    kind: 'inside',
    action: 'studio.regeneration.proposed',
  },
  // Recorded as `studio.proposal.rejected` when the regenerated text is turned down.
  'POST /api/projects/:id/studio/sections/:sectionId/proposal': {
    kind: 'inside',
    action: 'studio.proposal.accepted',
  },
  'POST /api/projects/:id/studio/submit': { kind: 'inside', action: 'studio.submitted' },
  'POST /api/projects/:id/studio/approve': { kind: 'inside', action: 'studio.approved' },
  'POST /api/projects/:id/studio/request-changes': {
    kind: 'inside',
    action: 'studio.changes.requested',
  },
  'POST /api/projects/:id/studio/reopen': { kind: 'inside', action: 'studio.reopened' },

  'POST /api/projects/:id/claims/:claimId/review': { kind: 'inside', action: 'claim.reviewed' },
  'POST /api/projects/:id/conflicts/:conflictId/review': {
    kind: 'inside',
    action: 'conflict.reviewed',
  },

  // Scenario Lab: one block per feature, each edited only by the feature that owns it.
  // [url-ingest audit]

  // [scenario audit]

  // [stakeholders audit]

  // [analysis audit]
  'GET /api/projects/:id/analysis': reads(
    'Lists the saved comparisons of a project; changes nothing.',
  ),
  'GET /api/projects/:id/analysis/:aid': reads('Reads one saved comparison; changes nothing.'),
  // Recorded by the service, with identifiers and counts only: never a scenario label or description.
  'POST /api/projects/:id/analysis': { kind: 'inside', action: 'analysis.started' },
  'POST /api/projects/:id/analysis/:aid/cancel': { kind: 'inside', action: 'analysis.cancelled' },

  // [critics audit]

  // [brief audit]
};

/**
 * Writes the entry for a successful request before its answer leaves, so a client that has been
 * told it worked can rely on the log saying so.
 */
export function registerAudit(app: FastifyInstance, repository: Repository): void {
  app.addHook('onSend', async (request, reply, payload) => {
    const url = request.routeOptions.url;
    if (!url?.startsWith('/api') || reply.statusCode >= 400) return payload;
    const rule = AUDIT_POLICY[`${request.method === 'HEAD' ? 'GET' : request.method} ${url}`];
    if (rule?.kind !== 'request') return payload;
    const id = typeof params(request).id === 'string' ? (params(request).id as string) : null;
    const service = rule.scope === 'service' || id === null;
    repository.audit.record({
      actor: principalOf(request).id,
      action: rule.action,
      targetType: service ? 'service' : 'project',
      targetId: service ? rule.action : id,
      projectId: service ? null : id,
      ...(rule.detail ? { detail: rule.detail(request) } : {}),
    });
    return payload;
  });
}
