import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  MAX_REVIEW_NOTE_LENGTH,
  REVIEW_RESULTS,
  contradictionReviewSchema,
  type ClaimRecord,
  type ReviewResult,
} from '../../../shared/evidence.js';
import type { SimulationMemory } from '../../../shared/guided.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { LedgerService, deriveScenarioAssumptions } from '../grounding/service.js';
import type { LedgerAssumption } from '../grounding/ledger.js';
import type { Repository } from '../storage/repository.js';

const projectParams = z.object({ id: z.uuid() });
const claimParams = projectParams.extend({ claimId: z.string().regex(/^C\d{1,4}$/u) });
const conflictParams = projectParams.extend({ conflictId: z.string().regex(/^X\d{1,3}$/u) });

const claimReviewBody = z.object({
  result: z.enum(
    REVIEW_RESULTS.filter((result) => result !== 'pending') as [ReviewResult, ...ReviewResult[]],
  ),
  note: z.string().trim().max(MAX_REVIEW_NOTE_LENGTH).nullable().default(null),
  /** The version the reviewer was looking at. A different current version is a conflict. */
  expectedVersion: z.int().positive().optional(),
});

export interface ClaimDetail {
  claim: ClaimRecord;
  /** The cited passages, whole, so the exact quotation can be seen in its context. */
  passages: EvidenceChunk[];
  /** The simulation memories the statement rests on, if any. */
  memories: SimulationMemory[];
  assumptions: LedgerAssumption[];
}

export function ledgerRoutes(
  app: FastifyInstance,
  repository: Repository,
  ledger: LedgerService,
  rateScale = 1,
): void {
  const limit = (max: number) => ({ rateLimit: { max: max * rateScale, timeWindow: '1 minute' } });

  app.get('/api/projects/:id/ledger', async (request) => {
    return ledger.get(projectParams.parse(request.params).id);
  });

  app.get('/api/projects/:id/claims/:claimId', async (request): Promise<ClaimDetail> => {
    const { id, claimId } = claimParams.parse(request.params);
    const claim = ledger.claim(id, claimId);
    const project = repository.get(id);
    const wanted = new Set(
      [...claim.supporting, ...claim.contradicting].map((ref) => ref.passageId),
    );
    const wantedMemories = new Set(claim.simulationEvents.map((event) => event.memoryId));
    const wantedAssumptions = new Set(claim.assumptionIds);
    return {
      claim,
      passages: repository.chunks(id).filter((chunk) => wanted.has(chunk.id)),
      memories: (project.console?.memories ?? []).filter((memory) => wantedMemories.has(memory.id)),
      assumptions: deriveScenarioAssumptions(project).filter((assumption) =>
        wantedAssumptions.has(assumption.id),
      ),
    };
  });

  app.post('/api/projects/:id/claims/:claimId/review', { config: limit(30) }, async (request) => {
    const { id, claimId } = claimParams.parse(request.params);
    const { expectedVersion, ...review } = claimReviewBody.parse(request.body);
    return { claim: ledger.reviewClaim(id, claimId, review, expectedVersion) };
  });

  app.post(
    '/api/projects/:id/conflicts/:conflictId/review',
    { config: limit(30) },
    async (request) => {
      const { id, conflictId } = conflictParams.parse(request.params);
      return ledger.reviewContradiction(
        id,
        conflictId,
        contradictionReviewSchema.parse(request.body),
      );
    },
  );

  app.get('/api/projects/:id/audit', async (request) => {
    const { id } = projectParams.parse(request.params);
    repository.get(id);
    return { events: repository.audit.list({ projectId: id, limit: 200 }) };
  });

  app.get('/api/audit/verify', async () => repository.audit.verify());
}
