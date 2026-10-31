import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  ActorSet,
  ActorsView,
  ModelAvailability,
  StakeholderSet,
  StakeholdersView,
} from '../../../shared/stakeholders.js';
import type { ProjectDetail } from '../../../shared/types.js';
import { principalOf } from '../auth/guard.js';
import { projectAllows } from '../auth/roles.js';
import type { ProviderConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { ModelUsage, ModelUsageSink } from '../models/client.js';
import type { ModelFactory } from '../models/factory.js';
import {
  actorEditSchema,
  applyActorEdit,
  generateActors,
  MAX_REFINEMENT_CALLS,
} from '../stakeholders/actors.js';
import { discoverStakeholders } from '../stakeholders/discover.js';
import { MAX_DISCOVERY_CALLS } from '../stakeholders/model.js';
import { applyReview, approveSet, reviewInputSchema } from '../stakeholders/review.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });
const discoverInput = z
  .object({
    /** `model` asks the project's model; `rules` reads the text for roles and uses none. */
    mode: z.enum(['rules', 'model']).default('rules'),
    /** Needed to replace a list the person has already reviewed. */
    confirm: z.boolean().default(false),
  })
  .strict();
const generateInput = z
  .object({
    /** Have a model read the key actors against the evidence, rather than using category priors alone. */
    model: z.boolean().default(false),
    /** Needed to replace actors the person has changed. */
    confirm: z.boolean().default(false),
  })
  .strict();
const approveInput = z.object({ expectedRevision: z.int().min(1) }).strict();

const KEY = 'default';
/** Finding stakeholders may wait for a model; it does not wait for ever. */
const MODEL_TIMEOUT_MS = 170_000;

const conflict = (what: string): AppError =>
  new AppError(
    409,
    'ARTIFACT_CONFLICT',
    `The ${what} changed while you were looking at them. Reload them and make your change again.`,
  );

/**
 * Stakeholders and actors. Who may call what is in `auth/policy.ts` and what is recorded in
 * `auth/audit-policy.ts`; every change is written with its audit entry in one transaction, and the
 * audit entry holds counts, never a name or a quote.
 */
export function stakeholderRoutes(
  app: FastifyInstance,
  repository: Repository,
  createModel: ModelFactory,
  provider: Pick<ProviderConfig, 'configured' | 'reason' | 'model'>,
  rateScale = 1,
): void {
  const limit = (max: number) => ({ rateLimit: { max: max * rateScale, timeWindow: '1 minute' } });
  /** One discovery or generation at a time for a project, so that two clicks are one piece of work. */
  const busy = new Set<string>();

  const availability = (project: ProjectDetail): ModelAvailability => {
    if (project.mode !== 'llm') {
      return {
        available: false,
        reason:
          'This project runs without a model, so nothing is sent to one. Stakeholders are found by reading the text for roles.',
      };
    }
    return provider.configured
      ? { available: true, reason: null }
      : { available: false, reason: provider.reason };
  };
  const may = (request: FastifyRequest) => ({
    edit: projectAllows('edit', request.membership),
    run: projectAllows('run', request.membership),
  });

  /** Model calls count against the project's budget; the project's own record only when it has one. */
  const usageOf = (project: ProjectDetail): ModelUsageSink =>
    project.execution
      ? repository.modelUse(project.id)
      : Object.assign(
          (usage: ModelUsage) =>
            repository.usage.record(project.id, usage.inputTokens, usage.outputTokens),
          { admit: () => repository.usage.admit(project.id) },
        );

  /** Runs one piece of work that may wait for a model, ended by the client leaving or by the timeout. */
  const exclusive = async <T>(
    id: string,
    reply: FastifyReply,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    if (busy.has(id)) {
      throw new AppError(
        409,
        'STAKEHOLDERS_BUSY',
        'Stakeholders or actors are already being made for this project. Wait for that to finish.',
      );
    }
    busy.add(id);
    const controller = new AbortController();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once('close', onClose);
    try {
      return await work(
        AbortSignal.any([controller.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
      );
    } finally {
      reply.raw.removeListener('close', onClose);
      busy.delete(id);
    }
  };

  const scenarioOf = (id: string) => repository.artifacts.get(id, 'scenario')?.data ?? null;
  const stakeholdersOf = (id: string) => repository.artifacts.get(id, 'stakeholders');
  const actorsOf = (id: string) => repository.artifacts.get(id, 'actors');

  const stakeholdersView = (request: FastifyRequest, id: string): StakeholdersView => {
    const project = repository.get(id);
    const record = stakeholdersOf(id);
    return {
      stakeholders: record?.data ?? null,
      revision: record?.revision ?? null,
      model: availability(project),
      may: may(request),
    };
  };
  const actorsView = (request: FastifyRequest, id: string): ActorsView => {
    const project = repository.get(id);
    const record = actorsOf(id);
    const current = stakeholdersOf(id);
    return {
      actors: record?.data ?? null,
      revision: record?.revision ?? null,
      stale: Boolean(record && current && record.data.stakeholderRevision !== current.revision),
      model: availability(project),
      may: may(request),
    };
  };

  const counts = (set: StakeholderSet) => {
    const live = set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
    return {
      stakeholders: live.length,
      key: live.filter((stakeholder) => stakeholder.priority === 'key').length,
      removed: set.stakeholders.length - live.length,
      gaps: set.gaps.length,
    };
  };
  const actorCounts = (set: ActorSet) => ({
    actors: set.actors.length,
    key: set.actors.filter((actor) => actor.kind === 'key').length,
    edited: set.actors.filter((actor) => actor.edited).length,
  });

  app.get('/api/projects/:id/stakeholders', async (request) =>
    stakeholdersView(request, idParams.parse(request.params).id),
  );

  app.post(
    '/api/projects/:id/stakeholders/discover',
    { config: limit(10), bodyLimit: 4_096 },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const input = discoverInput.parse(request.body ?? {});
      const project = repository.get(id);
      const existing = stakeholdersOf(id);
      if (
        existing &&
        !input.confirm &&
        (existing.data.approvedAt !== null ||
          existing.data.stakeholders.some((stakeholder) => stakeholder.status !== 'proposed'))
      ) {
        throw new AppError(
          409,
          'STAKEHOLDERS_REVIEWED',
          'Finding stakeholders again replaces the list you have reviewed, including your changes. Confirm to replace it.',
        );
      }
      const wanted = input.mode === 'model';
      const model = availability(project);
      if (wanted && !model.available) {
        throw new AppError(
          409,
          'MODEL_NOT_AVAILABLE',
          model.reason ?? 'No model is available for this project.',
        );
      }
      const set = await exclusive(id, reply, (signal) =>
        discoverStakeholders({
          project: { question: project.question, graph: project.graph },
          scenario: scenarioOf(id),
          passages: repository.chunks(id),
          model: wanted ? createModel(usageOf(project), { maxCalls: MAX_DISCOVERY_CALLS }) : null,
          modelName: wanted ? provider.model : null,
          signal,
        }),
      );
      repository.atomic(() => {
        repository.artifacts.put(id, 'stakeholders', KEY, set, {
          expectedRevision: existing?.revision ?? 0,
        });
        repository.audit.record({
          actor: principalOf(request).id,
          action: 'stakeholders.discovered',
          targetType: 'project',
          targetId: id,
          projectId: id,
          detail: {
            mode: set.discovery.mode,
            asked: input.mode,
            replaced: existing !== null,
            ...counts(set),
          },
        });
      });
      return reply.code(201).send(stakeholdersView(request, id));
    },
  );

  app.put(
    '/api/projects/:id/stakeholders',
    { config: limit(120), bodyLimit: 600_000 },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const input = reviewInputSchema.parse(request.body);
      repository.get(id);
      const existing = stakeholdersOf(id);
      if (!existing && input.expectedRevision !== 0) {
        throw new AppError(
          409,
          'STAKEHOLDERS_NOT_FOUND',
          'There are no stakeholders yet. Find them first, or add them by hand.',
        );
      }
      if ((existing?.revision ?? 0) !== input.expectedRevision) throw conflict('stakeholders');
      const next = applyReview(existing?.data ?? null, input, new Date());
      repository.atomic(() => {
        repository.artifacts.put(id, 'stakeholders', KEY, next, {
          expectedRevision: input.expectedRevision,
        });
        repository.audit.record({
          actor: principalOf(request).id,
          action: 'stakeholders.edited',
          targetType: 'project',
          targetId: id,
          projectId: id,
          detail: {
            approvalCleared: Boolean(existing?.data.approvedAt && !next.approvedAt),
            ...counts(next),
          },
        });
      });
      return stakeholdersView(request, id);
    },
  );

  app.post(
    '/api/projects/:id/stakeholders/approve',
    { config: limit(30), bodyLimit: 4_096 },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const input = approveInput.parse(request.body);
      repository.get(id);
      const existing = stakeholdersOf(id);
      if (!existing) {
        throw new AppError(
          409,
          'STAKEHOLDERS_NOT_FOUND',
          'There are no stakeholders to approve. Find them first.',
        );
      }
      if (existing.revision !== input.expectedRevision) throw conflict('stakeholders');
      const next = approveSet(existing.data, new Date());
      repository.atomic(() => {
        repository.artifacts.put(id, 'stakeholders', KEY, next, {
          expectedRevision: input.expectedRevision,
        });
        repository.audit.record({
          actor: principalOf(request).id,
          action: 'stakeholders.approved',
          targetType: 'project',
          targetId: id,
          projectId: id,
          detail: counts(next),
        });
      });
      return stakeholdersView(request, id);
    },
  );

  app.get('/api/projects/:id/actors', async (request) =>
    actorsView(request, idParams.parse(request.params).id),
  );

  app.post(
    '/api/projects/:id/actors/generate',
    { config: limit(10), bodyLimit: 4_096 },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const input = generateInput.parse(request.body ?? {});
      const project = repository.get(id);
      const stakeholders = stakeholdersOf(id);
      if (!stakeholders?.data.approvedAt) {
        throw new AppError(
          409,
          'STAKEHOLDERS_NOT_APPROVED',
          'Approve the stakeholders before making actors from them.',
        );
      }
      const existing = actorsOf(id);
      if (existing && !input.confirm && existing.data.actors.some((actor) => actor.edited)) {
        throw new AppError(
          409,
          'ACTORS_EDITED',
          'Making the actors again replaces the changes you made to them. Confirm to replace them.',
        );
      }
      const model = availability(project);
      if (input.model && !model.available) {
        throw new AppError(
          409,
          'MODEL_NOT_AVAILABLE',
          model.reason ?? 'No model is available for this project.',
        );
      }
      const set = await exclusive(id, reply, (signal) =>
        generateActors({
          stakeholders: stakeholders.data.stakeholders,
          relations: stakeholders.data.relations,
          scenario: scenarioOf(id),
          stakeholderRevision: stakeholders.revision,
          question: project.question,
          passages: repository.chunks(id),
          model: input.model
            ? createModel(usageOf(project), { maxCalls: MAX_REFINEMENT_CALLS })
            : null,
          signal,
        }),
      );
      repository.atomic(() => {
        repository.artifacts.put(id, 'actors', KEY, set, {
          expectedRevision: existing?.revision ?? 0,
        });
        repository.audit.record({
          actor: principalOf(request).id,
          action: 'actors.generated',
          targetType: 'project',
          targetId: id,
          projectId: id,
          detail: { mode: set.mode, asked: input.model ? 'model' : 'rules', ...actorCounts(set) },
        });
      });
      return reply.code(201).send(actorsView(request, id));
    },
  );

  app.put(
    '/api/projects/:id/actors',
    { config: limit(120), bodyLimit: 600_000 },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const input = actorEditSchema.parse(request.body);
      repository.get(id);
      const existing = actorsOf(id);
      if (!existing) {
        throw new AppError(
          409,
          'ACTORS_NOT_FOUND',
          'There are no actors yet. Approve the stakeholders and make them first.',
        );
      }
      if (existing.revision !== input.expectedRevision) throw conflict('actors');
      const next = applyActorEdit(existing.data, input.actors);
      repository.atomic(() => {
        repository.artifacts.put(id, 'actors', KEY, next, {
          expectedRevision: input.expectedRevision,
        });
        repository.audit.record({
          actor: principalOf(request).id,
          action: 'actors.edited',
          targetType: 'project',
          targetId: id,
          projectId: id,
          detail: actorCounts(next),
        });
      });
      return actorsView(request, id);
    },
  );
}
