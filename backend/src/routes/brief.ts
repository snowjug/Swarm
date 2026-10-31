import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BRIEF_EXPORT_FORMATS, type BriefView } from '../../../shared/brief.js';
import { idSchema } from '../../../shared/stakeholders.js';
import { projectAllows } from '../auth/roles.js';
import { BRIEF_CSP, briefHtml, briefJson, briefMarkdown } from '../brief/export.js';
import { BriefService } from '../brief/service.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });
const generateBody = z.object({ analysisId: idSchema.optional() });
const exportQuery = z.object({ format: z.enum(BRIEF_EXPORT_FORMATS).default('md') });

/**
 * The answer-first decision brief of a project: made from the project's own analysis, stakeholders,
 * scenario and sources by rules, stored with it, read, and handed over as Markdown, JSON or a
 * printable page. Who may call what is in `auth/policy.ts` (generating needs `edit`, reading `read`,
 * handing it over `export`), and what is recorded is in `auth/audit-policy.ts`.
 */
export function briefRoutes(app: FastifyInstance, repository: Repository, rateScale = 1): void {
  const service = new BriefService(repository);
  const limit = (max: number) => ({ rateLimit: { max: max * rateScale, timeWindow: '1 minute' } });

  // Signed in, the guard has vouched for the project. Without sign-in nothing has.
  const exists = (id: string): void => {
    if (!repository.ownership(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    }
  };
  const may = (request: FastifyRequest): BriefView['may'] => ({
    generate: projectAllows('edit', request.membership),
    export: projectAllows('export', request.membership),
  });

  app.get('/api/projects/:id/brief', async (request) => {
    const { id } = idParams.parse(request.params);
    exists(id);
    return service.view(id, may(request));
  });

  app.post('/api/projects/:id/brief', { config: limit(20) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const input = generateBody.parse(request.body ?? {});
    exists(id);
    service.generate(id, input.analysisId);
    return reply.code(201).send(service.view(id, may(request)));
  });

  app.get('/api/projects/:id/brief/export', { config: limit(20) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { format } = exportQuery.parse(request.query);
    exists(id);
    const input = {
      ...service.forExport(id, repository.get(id).name),
      exportedAt: new Date().toISOString(),
    };
    reply.header('x-content-type-options', 'nosniff').header('cache-control', 'no-store');
    if (format === 'json') {
      return reply
        .header('content-disposition', 'attachment; filename="swarm-decision-brief.json"')
        .type('application/json; charset=utf-8')
        .send(JSON.stringify(briefJson(input), null, 2));
    }
    if (format === 'html') {
      return reply
        .header('content-security-policy', BRIEF_CSP)
        .header('content-disposition', 'inline; filename="swarm-decision-brief.html"')
        .type('text/html; charset=utf-8')
        .send(briefHtml(input));
    }
    return reply
      .header('content-disposition', 'attachment; filename="swarm-decision-brief.md"')
      .type('text/markdown; charset=utf-8')
      .send(briefMarkdown(input));
  });
}
