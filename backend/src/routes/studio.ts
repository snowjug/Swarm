import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EXPORT_FORMATS,
  addNoteSchema,
  editSectionSchema,
  lockSectionSchema,
  proposalDecisionSchema,
  regenerateSchema,
  restoreVersionSchema,
  sectionIdSchema,
  startStudioSchema,
  transitionSchema,
  type StudioCapabilities,
  type StudioView,
} from '../../../shared/studio.js';
import { principalOf } from '../auth/guard.js';
import { projectAllows } from '../auth/roles.js';
import { AppError } from '../errors.js';
import { MEMO_CSP, buildMemo, memoHtml, studioJson, studioMarkdown } from '../studio/export.js';
import type { StudioService } from '../studio/service.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });
const sectionParams = idParams.extend({ sectionId: sectionIdSchema });

/** A regeneration is bounded in calls, and in time: a model that does not answer does not hold the report. */
const REGENERATION_TIMEOUT_MS = 5 * 60_000;

function capabilitiesOf(request: FastifyRequest): StudioCapabilities {
  return {
    edit: projectAllows('edit', request.membership),
    review: projectAllows('review', request.membership),
    export: projectAllows('export', request.membership),
  };
}

export function studioRoutes(
  app: FastifyInstance,
  repository: Repository,
  studio: StudioService,
  rateScale = 1,
): void {
  const limit = (max: number) => ({ rateLimit: { max: max * rateScale, timeWindow: '1 minute' } });
  /** Every change answers with the studio as it now is, so the page needs no second request. */
  const view = (request: FastifyRequest, id: string): StudioView =>
    studio.view(id, capabilitiesOf(request));

  app.get('/api/projects/:id/studio', async (request) =>
    view(request, idParams.parse(request.params).id),
  );

  // Opens the report in the studio; when the generated report has been replaced since, starts again
  // from the newer one, keeping the old text in the archive.
  app.post('/api/projects/:id/studio', { config: limit(10) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const input = startStudioSchema.parse(request.body ?? {});
    studio.start(id, input, principalOf(request).id);
    return reply.code(201).send(view(request, id));
  });

  app.put(
    '/api/projects/:id/studio/sections/:sectionId',
    { config: limit(60) },
    async (request) => {
      const { id, sectionId } = sectionParams.parse(request.params);
      studio.editSection(
        id,
        sectionId,
        editSectionSchema.parse(request.body),
        principalOf(request).id,
      );
      return view(request, id);
    },
  );

  app.put(
    '/api/projects/:id/studio/sections/:sectionId/lock',
    { config: limit(60) },
    async (request) => {
      const { id, sectionId } = sectionParams.parse(request.params);
      const { locked } = lockSectionSchema.parse(request.body);
      studio.setLock(id, sectionId, locked, principalOf(request).id);
      return view(request, id);
    },
  );

  app.post(
    '/api/projects/:id/studio/sections/:sectionId/notes',
    { config: limit(60) },
    async (request, reply) => {
      const { id, sectionId } = sectionParams.parse(request.params);
      const { text } = addNoteSchema.parse(request.body);
      studio.addNote(id, sectionId, text, principalOf(request).id);
      return reply.code(201).send(view(request, id));
    },
  );

  app.post(
    '/api/projects/:id/studio/sections/:sectionId/restore',
    { config: limit(30) },
    async (request) => {
      const { id, sectionId } = sectionParams.parse(request.params);
      studio.restoreVersion(
        id,
        sectionId,
        restoreVersionSchema.parse(request.body),
        principalOf(request).id,
      );
      return view(request, id);
    },
  );

  app.post(
    '/api/projects/:id/studio/sections/:sectionId/regenerate',
    { config: limit(6) },
    async (request, reply) => {
      const { id, sectionId } = sectionParams.parse(request.params);
      const input = regenerateSchema.parse(request.body);
      const controller = new AbortController();
      const onClose = (): void => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.once('close', onClose);
      try {
        await studio.regenerate(
          id,
          sectionId,
          input,
          principalOf(request).id,
          AbortSignal.any([controller.signal, AbortSignal.timeout(REGENERATION_TIMEOUT_MS)]),
        );
      } finally {
        reply.raw.removeListener('close', onClose);
      }
      return reply.code(201).send(view(request, id));
    },
  );

  app.post(
    '/api/projects/:id/studio/sections/:sectionId/proposal',
    { config: limit(30) },
    async (request) => {
      const { id, sectionId } = sectionParams.parse(request.params);
      studio.decideProposal(
        id,
        sectionId,
        proposalDecisionSchema.parse(request.body),
        principalOf(request).id,
      );
      return view(request, id);
    },
  );

  for (const [path, kind] of [
    ['submit', 'submit'],
    ['approve', 'approve'],
    ['request-changes', 'request-changes'],
    ['reopen', 'reopen'],
  ] as const) {
    app.post(`/api/projects/:id/studio/${path}`, { config: limit(30) }, async (request) => {
      const { id } = idParams.parse(request.params);
      studio.transition(id, kind, transitionSchema.parse(request.body), principalOf(request).id);
      return view(request, id);
    });
  }

  app.get('/api/projects/:id/studio/export', { config: limit(20) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { format } = z
      .object({ format: z.enum(EXPORT_FORMATS).default('markdown') })
      .parse(request.query);
    const current = view(request, id);
    if (!current.document) {
      throw new AppError(
        409,
        'STUDIO_NOT_STARTED',
        'Nobody has opened this report in the studio yet. Open it there first.',
      );
    }
    const input = {
      view: { ...current, document: current.document },
      project: { id, name: repository.get(id).name },
      exportedAt: new Date().toISOString(),
    };
    reply.header('x-content-type-options', 'nosniff').header('cache-control', 'no-store');
    if (format === 'json') {
      return reply
        .header('content-disposition', 'attachment; filename="swarm-report-studio.json"')
        .type('application/json; charset=utf-8')
        .send(JSON.stringify(studioJson(input), null, 2));
    }
    if (format === 'memo') {
      return reply
        .header('content-security-policy', MEMO_CSP)
        .header('content-disposition', 'inline; filename="swarm-decision-memo.html"')
        .type('text/html; charset=utf-8')
        .send(memoHtml(buildMemo(input)));
    }
    return reply
      .header('content-disposition', 'attachment; filename="swarm-report-studio.md"')
      .type('text/markdown; charset=utf-8')
      .send(studioMarkdown(input));
  });
}
