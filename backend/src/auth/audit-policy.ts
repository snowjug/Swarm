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
  'GET /api/projects/:id/compare': reads('A comparison computed from two recorded runs.'),
  'GET /api/projects/:id/ledger': reads(
    'Reads the ledger; building it is recorded as ledger.built.',
  ),
  'GET /api/projects/:id/claims/:claimId': reads('Reads one statement of the ledger.'),
  'GET /api/projects/:id/chat': reads('Reads a conversation the caller already holds.'),
  'GET /api/projects/:id/audit': reads(
    'Reading the log is not itself logged, or it would grow as it is read.',
  ),

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

  'POST /api/projects/:id/claims/:claimId/review': { kind: 'inside', action: 'claim.reviewed' },
  'POST /api/projects/:id/conflicts/:conflictId/review': {
    kind: 'inside',
    action: 'conflict.reviewed',
  },
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
