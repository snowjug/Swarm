import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isArtifactKind, type ArtifactKind } from '../../../shared/artifacts.js';
import {
  idSchema,
  stakeholderSetSchema,
  type ActorSet,
  type ActorsView,
  type ModelAvailability,
  type ParticipantReview,
  type ParticipantValidationView,
  type ParticipantWhy,
  type StakeholderSet,
  type StakeholdersView,
} from '../../../shared/stakeholders.js';
import type { ProjectDetail } from '../../../shared/types.js';
import { principalOf } from '../auth/guard.js';
import { projectAllows } from '../auth/roles.js';
import type { ProviderConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { ModelFactory } from '../models/factory.js';
import {
  actorEditSchema,
  applyActorEdit,
  generateActors,
  MAX_REFINEMENT_CALLS,
} from '../stakeholders/actors.js';
import { discoverStakeholders } from '../stakeholders/discover.js';
import { MAX_DISCOVERY_CALLS } from '../stakeholders/model.js';
import {
  buildContext,
  constraintsOf,
  summariseResearch,
} from '../stakeholders/participants/context.js';
import { whyOf } from '../stakeholders/participants/explain.js';
import {
  acceptedList,
  addMissingSchema,
  duplicateGroups,
  editedList,
  findParticipant,
  mergedLists,
  missingParticipant,
  participantChangesSchema,
  removedList,
} from '../stakeholders/participants/operations.js';
import {
  MAX_PROPOSAL_CALLS,
  proposeParticipants,
  regenerateParticipant,
} from '../stakeholders/participants/propose.js';
import {
  refusalWords,
  reviewContext,
  reviewParticipants,
} from '../stakeholders/participants/validate.js';
import { applyReview, approveSet, reviewInputSchema } from '../stakeholders/review.js';
import { categoryGaps, isCategoryGap } from '../stakeholders/relations.js';
import type { ArtifactRecord } from '../storage/artifacts.js';
import type { AuditDetail } from '../storage/audit.js';
import type { Repository } from '../storage/repository.js';

const idParams = z.object({ id: z.uuid() });
const participantParams = idParams.extend({ participantId: idSchema });
const proposeInput = z
  .object({
    /** `model` asks the project's model; `rules` reads the text for roles and uses none. */
    mode: z.enum(['rules', 'model']).default('rules'),
    /** Needed to replace a list the person has already reviewed. */
    confirm: z.boolean().default(false),
  })
  .strict();
const revision = z.int().min(1);
const acceptInput = z
  .object({ expectedRevision: revision, ids: z.array(idSchema).min(1).max(40).optional() })
  .strict();
const editInput = z
  .object({ expectedRevision: revision, changes: participantChangesSchema })
  .strict();
const removeQuery = z.object({ expectedRevision: z.coerce.number().int().min(1) }).strict();
const regenerateInput = z
  .object({
    expectedRevision: revision,
    mode: z.enum(['rules', 'model']).default('rules'),
    /** Needed to replace a participant the person has changed. */
    confirm: z.boolean().default(false),
  })
  .strict();
const mergeInput = z
  .object({
    expectedRevision: revision,
    groups: z
      .array(z.object({ keep: idSchema, merge: z.array(idSchema).min(1).max(10) }).strict())
      .min(1)
      .max(10)
      .optional(),
  })
  .strict();
const addMissingInput = z
  .object({ expectedRevision: revision, ...addMissingSchema.shape })
  .strict();
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

  /**
   * An artifact of a kind another feature owns, read only if this build knows the kind and only as far
   * as it is useful: whatever is stored there is treated as data of unknown shape, and a failure to read
   * it is the same as there being nothing.
   */
  const optionalArtifact = (id: string, kind: string): unknown => {
    if (!isArtifactKind(kind)) return null;
    try {
      return repository.artifacts.get(id, kind as ArtifactKind)?.data ?? null;
    } catch {
      return null;
    }
  };
  const researchRuns = (id: string): unknown[] => {
    try {
      return repository.artifacts.list(id, 'research').map((record) => record.data);
    } catch {
      return [];
    }
  };
  const proposalContext = (id: string, project: ProjectDetail) =>
    buildContext({
      question: project.question,
      scenario: scenarioOf(id),
      graph: project.graph,
      passages: repository.chunks(id),
      research: summariseResearch(researchRuns(id)),
      constraints: constraintsOf(optionalArtifact(id, 'constraints')),
    });
  const reviewOf = (id: string, set: StakeholderSet): ParticipantReview => {
    const project = repository.get(id);
    return reviewParticipants(
      set,
      reviewContext({
        passages: repository.chunks(id),
        graph: project.graph,
        scenario: scenarioOf(id),
        question: project.question,
      }),
    );
  };

  const stakeholdersView = (request: FastifyRequest, id: string): StakeholdersView => {
    const project = repository.get(id);
    const record = stakeholdersOf(id);
    return {
      stakeholders: record?.data ?? null,
      revision: record?.revision ?? null,
      model: availability(project),
      may: may(request),
      ...(record ? { review: reviewOf(id, record.data) } : {}),
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
          model: wanted
            ? createModel(repository.modelUse(project.id), { maxCalls: MAX_DISCOVERY_CALLS })
            : null,
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
      // Fewer than two is its own, older refusal; any other blocking issue is the review's.
      const next = approveSet(existing.data, new Date());
      const review = reviewOf(id, existing.data);
      if (!review.valid) {
        throw new AppError(409, 'PARTICIPANTS_INVALID', refusalWords(review));
      }
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
          detail: { ...counts(next), advisory: review.counts.advisory },
        });
      });
      return stakeholdersView(request, id);
    },
  );

  /** The stored set for a change made at `expectedRevision`, or the refusal that says why there is none. */
  const loaded = (id: string, expectedRevision: number): ArtifactRecord<'stakeholders'> => {
    repository.get(id);
    const existing = stakeholdersOf(id);
    if (!existing) {
      throw new AppError(
        409,
        'STAKEHOLDERS_NOT_FOUND',
        'There are no participants yet. Propose them first, or add them by hand.',
      );
    }
    if (existing.revision !== expectedRevision) throw conflict('stakeholders');
    return existing;
  };

  /** Stores the set a person's change led to, with its audit entry, in one transaction. */
  const commit = (
    request: FastifyRequest,
    id: string,
    existing: ArtifactRecord<'stakeholders'>,
    next: StakeholderSet,
    detail: AuditDetail,
  ): void => {
    repository.atomic(() => {
      repository.artifacts.put(id, 'stakeholders', KEY, next, {
        expectedRevision: existing.revision,
      });
      repository.audit.record({
        actor: principalOf(request).id,
        action: 'stakeholders.edited',
        targetType: 'project',
        targetId: id,
        projectId: id,
        detail: {
          ...detail,
          approvalCleared: Boolean(existing.data.approvedAt && !next.approvedAt),
          ...counts(next),
        },
      });
    });
  };
  /** A change to the list, checked by the one review of a person's changes that already stands. */
  const reviewed = (
    existing: ArtifactRecord<'stakeholders'>,
    stakeholders: StakeholderSet['stakeholders'],
    relations: StakeholderSet['relations'] = existing.data.relations,
  ): StakeholderSet =>
    applyReview(
      existing.data,
      { stakeholders, relations: [...relations], expectedRevision: existing.revision },
      new Date(),
    );

  app.get('/api/projects/:id/stakeholders/validation', async (request) => {
    const { id } = idParams.parse(request.params);
    repository.get(id);
    const record = stakeholdersOf(id);
    const view: ParticipantValidationView = {
      revision: record?.revision ?? null,
      review: record ? reviewOf(id, record.data) : null,
    };
    return view;
  });

  app.get('/api/projects/:id/stakeholders/:participantId/why', async (request) => {
    const { id, participantId } = participantParams.parse(request.params);
    repository.get(id);
    const record = stakeholdersOf(id);
    if (!record) {
      throw new AppError(404, 'PARTICIPANT_NOT_FOUND', 'There are no participants yet.');
    }
    const why: ParticipantWhy = whyOf(findParticipant(record.data.stakeholders, participantId));
    return why;
  });

  app.post(
    '/api/projects/:id/stakeholders/propose',
    { config: limit(10), bodyLimit: 4_096 },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const input = proposeInput.parse(request.body ?? {});
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
          'Proposing the participants again replaces the list you have reviewed, including your changes. Confirm to replace it.',
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
      const context = proposalContext(id, project);
      const result = await exclusive(id, reply, (signal) =>
        proposeParticipants({
          context,
          model: wanted
            ? createModel(repository.modelUse(project.id), { maxCalls: MAX_PROPOSAL_CALLS })
            : null,
          modelName: wanted ? provider.model : null,
          signal,
          existing: existing?.data ?? null,
        }),
      );
      repository.atomic(() => {
        repository.artifacts.put(id, 'stakeholders', KEY, result.set, {
          expectedRevision: existing?.revision ?? 0,
        });
        repository.audit.record({
          actor: principalOf(request).id,
          action: 'stakeholders.discovered',
          targetType: 'project',
          targetId: id,
          projectId: id,
          detail: {
            via: 'propose',
            mode: result.set.discovery.mode,
            asked: input.mode,
            failure: result.failure?.code ?? null,
            replaced: existing !== null,
            merged: result.set.proposal?.merged ?? 0,
            dropped: result.set.proposal?.dropped.length ?? 0,
            ...counts(result.set),
          },
        });
      });
      return reply.code(201).send(stakeholdersView(request, id));
    },
  );

  app.post(
    '/api/projects/:id/stakeholders/accept',
    { config: limit(60), bodyLimit: 4_096 },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const input = acceptInput.parse(request.body);
      const existing = loaded(id, input.expectedRevision);
      const next = reviewed(existing, acceptedList(existing.data, input.ids ?? null));
      commit(request, id, existing, next, {
        operation: 'accept',
        selected: input.ids?.length ?? 0,
      });
      return stakeholdersView(request, id);
    },
  );

  app.patch(
    '/api/projects/:id/stakeholders/:participantId',
    { config: limit(120), bodyLimit: 60_000 },
    async (request) => {
      const { id, participantId } = participantParams.parse(request.params);
      const input = editInput.parse(request.body);
      const existing = loaded(id, input.expectedRevision);
      const next = reviewed(existing, editedList(existing.data, participantId, input.changes));
      commit(request, id, existing, next, {
        operation: 'edit',
        fields: Object.keys(input.changes).length,
      });
      return stakeholdersView(request, id);
    },
  );

  app.delete(
    '/api/projects/:id/stakeholders/:participantId',
    { config: limit(120) },
    async (request) => {
      const { id, participantId } = participantParams.parse(request.params);
      const input = removeQuery.parse(request.query);
      const existing = loaded(id, input.expectedRevision);
      const next = reviewed(existing, removedList(existing.data, participantId));
      commit(request, id, existing, next, { operation: 'remove' });
      return stakeholdersView(request, id);
    },
  );

  app.post(
    '/api/projects/:id/stakeholders/:participantId/regenerate',
    { config: limit(20), bodyLimit: 4_096 },
    async (request, reply) => {
      const { id, participantId } = participantParams.parse(request.params);
      const input = regenerateInput.parse(request.body);
      const project = repository.get(id);
      const existing = loaded(id, input.expectedRevision);
      const target = findParticipant(existing.data.stakeholders, participantId);
      if (target.status === 'removed') {
        throw new AppError(
          409,
          'PARTICIPANT_REMOVED',
          'Restore the participant before regenerating it.',
        );
      }
      if (target.origin === 'user') {
        throw new AppError(
          409,
          'PARTICIPANT_NOT_REGENERABLE',
          'You added this participant yourself, so there is nothing in the sources to regenerate it from. Edit it instead.',
        );
      }
      if (target.status === 'edited' && !input.confirm) {
        throw new AppError(
          409,
          'PARTICIPANT_EDITED',
          'Regenerating replaces the changes you made to this participant. Confirm to replace them.',
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
      const context = proposalContext(id, project);
      const result = await exclusive(id, reply, (signal) =>
        regenerateParticipant({
          context,
          set: existing.data,
          targetId: participantId,
          model: wanted
            ? createModel(repository.modelUse(project.id), { maxCalls: MAX_PROPOSAL_CALLS })
            : null,
          modelName: wanted ? provider.model : null,
          signal,
        }),
      );
      const stakeholders = existing.data.stakeholders.map((item) =>
        item.id === participantId ? result.participant : item,
      );
      const next = stakeholderSetSchema.parse({
        ...existing.data,
        stakeholders,
        gaps: [
          ...categoryGaps(stakeholders),
          ...existing.data.gaps.filter((gap) => !isCategoryGap(gap)),
        ].slice(0, 20),
        approvedAt: null,
        proposal: existing.data.proposal && {
          ...existing.data.proposal,
          notes: [...existing.data.proposal.notes, 'One participant was proposed again.'].slice(
            -12,
          ),
        },
      });
      commit(request, id, existing, next, {
        operation: 'regenerate',
        asked: input.mode,
        source: result.source,
        failure: result.failure?.code ?? null,
      });
      return stakeholdersView(request, id);
    },
  );

  app.post(
    '/api/projects/:id/stakeholders/merge-duplicates',
    { config: limit(30), bodyLimit: 4_096 },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const input = mergeInput.parse(request.body);
      const existing = loaded(id, input.expectedRevision);
      const groups = input.groups ?? duplicateGroups(existing.data);
      if (groups.length === 0) {
        throw new AppError(
          409,
          'NO_DUPLICATES',
          'No participants with the same name were found. To merge two that only overlap, choose them yourself.',
        );
      }
      const merged = mergedLists(existing.data, groups);
      const next = reviewed(existing, merged.stakeholders, merged.relations);
      commit(request, id, existing, next, {
        operation: 'merge',
        groups: groups.length,
        merged: groups.reduce((sum, group) => sum + group.merge.length, 0),
      });
      return stakeholdersView(request, id);
    },
  );

  app.post(
    '/api/projects/:id/stakeholders/add-missing',
    { config: limit(60), bodyLimit: 8_192 },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const { expectedRevision, ...input } = addMissingInput.parse(request.body);
      const existing = loaded(id, expectedRevision);
      const added = missingParticipant(existing.data, input);
      const next = reviewed(existing, [...existing.data.stakeholders, added]);
      commit(request, id, existing, next, { operation: 'add-missing', role: input.role });
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
      // A list the proposal made is held to its checks here too, so that nothing that changed after the approval
      // (outside this route) can reach the simulation. A list found before participants existed keeps its approval.
      if (stakeholders.data.proposal) {
        const review = reviewOf(id, stakeholders.data);
        if (!review.valid) throw new AppError(409, 'PARTICIPANTS_INVALID', refusalWords(review));
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
            ? createModel(repository.modelUse(project.id), { maxCalls: MAX_REFINEMENT_CALLS })
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
