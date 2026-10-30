import {
  contradictionReviewSchema,
  emptySupportCounts,
  isOpenConflict,
  reviewInputSchema,
  type ClaimRecord,
  type ContradictionRecord,
  type ContradictionReviewInput,
  type Ledger,
  type ReviewInput,
} from '../../../shared/evidence.js';
import type { SimulationMemory } from '../../../shared/guided.js';
import type { ProjectDetail } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';
import { signals } from '../telemetry/signals.js';
import { detectContradictions } from './contradictions.js';
import {
  applyReview,
  assessSufficiency,
  buildClaimRecords,
  reconcileClaim,
  type LedgerAssumption,
  type SourceConflict,
} from './ledger.js';

/** Until accounts exist, every action is taken by the one local user. */
export const LOCAL_ACTOR = 'local-user';

/**
 * The inputs that shape every simulated result: the intervention, the seed posts and the fact that
 * the proxies start from recorded, not measured, opinions. Listed on simulated statements so they
 * are never mistaken for observations.
 */
export function deriveScenarioAssumptions(project: ProjectDetail): LedgerAssumption[] {
  const assumptions: LedgerAssumption[] = [];
  const add = (statement: string): void => {
    assumptions.push({ id: `A${assumptions.length + 1}`, statement, scope: 'scenario' });
  };
  const intervention = project.settings.intervention;
  if (intervention) {
    add(
      `Intervention at round ${intervention.round}: ${intervention.label} (stance ${intervention.stance}, strength ${intervention.strength}).`,
    );
  }
  for (const post of project.console?.environment?.initialPosts ?? []) {
    add(`Seed post ${post.id} on ${post.platform}: ${post.text}`);
  }
  add(
    'The fictional proxies start from the opinions, influence and openness recorded for them; none of these is a measured value.',
  );
  return assumptions;
}

function ledgerOf(
  claims: ClaimRecord[],
  contradictions: ContradictionRecord[],
  reviewedAt: string | null,
  assumptions: LedgerAssumption[],
): Ledger {
  const open = contradictions.filter((conflict) => isOpenConflict(conflict.status)).length;
  return {
    claims,
    contradictions,
    sufficiency: assessSufficiency(claims, open),
    assumptions,
    reviewedAt,
  };
}

/** The conflicts that still weigh on the statements citing them. */
function openConflicts(contradictions: readonly ContradictionRecord[]): SourceConflict[] {
  return contradictions
    .filter((conflict) => isOpenConflict(conflict.status))
    .map(({ id, topic, leftValue, rightValue, left, right }) => ({
      id,
      topic,
      leftValue,
      rightValue,
      left,
      right,
    }));
}

/** Owns how the ledger is built and changed. Every change is audited in the same transaction. */
export class LedgerService {
  constructor(
    private readonly repository: Repository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Builds the ledger from the project's sources and its grounding review. Conflicts between
   * sources that a person already reviewed are kept; statements are rebuilt, because a new report
   * has new statements.
   */
  rebuild(projectId: string): Ledger {
    const now = this.clock();
    const project = this.repository.get(projectId);
    const chunks = this.repository.chunks(projectId);
    const existing = this.repository.ledger.state(projectId);
    const contradictions = existing
      ? this.repository.ledger.contradictions(projectId)
      : detectContradictions(chunks, now);
    const grounding = project.report?.grounding ?? null;
    const memories = new Map<string, SimulationMemory>(
      (project.console?.memories ?? []).map((memory) => [memory.id, memory]),
    );
    const claims = grounding
      ? buildClaimRecords({
          projectId,
          parentId: project.console?.branch?.parentId ?? null,
          branchFromRound: project.console?.branch?.fromRound ?? null,
          review: grounding,
          passages: new Map(chunks.map((chunk) => [chunk.id, chunk])),
          memories,
          assumptions: deriveScenarioAssumptions(project),
          conflicts: openConflicts(contradictions),
          now,
        })
      : [];
    const reviewedAt = grounding?.checkedAt ?? null;
    this.repository.atomic(() => {
      this.repository.ledger.replaceInside(projectId, { claims, contradictions, reviewedAt }, now);
      this.repository.audit.record(
        {
          actor: 'system',
          action: 'ledger.built',
          targetType: 'project',
          targetId: projectId,
          projectId,
          detail: { claims: claims.length, conflicts: contradictions.length },
        },
        now,
      );
    });
    const byClass: Record<string, number> = {};
    for (const claim of claims)
      byClass[claim.supportClass] = (byClass[claim.supportClass] ?? 0) + 1;
    signals.grounding(byClass);
    return ledgerOf(claims, contradictions, reviewedAt, deriveScenarioAssumptions(project));
  }

  /** The ledger for a project, built on first use so projects that predate it still work. */
  get(projectId: string): Ledger {
    const project = this.repository.get(projectId);
    const state = this.repository.ledger.state(projectId);
    const reviewedAt = project.report?.grounding?.checkedAt ?? null;
    if (state === null || state.reviewedAt !== reviewedAt) return this.rebuild(projectId);
    return ledgerOf(
      this.repository.ledger.claims(projectId),
      this.repository.ledger.contradictions(projectId),
      state.reviewedAt,
      deriveScenarioAssumptions(project),
    );
  }

  claim(projectId: string, claimId: string): ClaimRecord {
    this.get(projectId);
    const record = this.repository.ledger.claim(projectId, claimId);
    if (!record) throw new AppError(404, 'CLAIM_NOT_FOUND', 'This statement does not exist.');
    return record;
  }

  reviewClaim(
    projectId: string,
    claimId: string,
    input: ReviewInput,
    expectedVersion?: number,
    actor: string = LOCAL_ACTOR,
  ): ClaimRecord {
    const parsed = reviewInputSchema.parse(input);
    const existing = this.claim(projectId, claimId);
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new AppError(
        409,
        'CLAIM_CONFLICT',
        'Someone else changed this statement. Reload it and review the latest version.',
      );
    }
    const now = this.clock();
    const updated = applyReview(existing, parsed, now);
    this.repository.atomic(() => {
      this.repository.ledger.saveClaim(projectId, updated, existing.version);
      this.repository.audit.record(
        {
          actor,
          action: 'claim.reviewed',
          targetType: 'claim',
          targetId: claimId,
          projectId,
          detail: {
            result: parsed.result,
            version: updated.version,
            support: updated.supportClass,
            noteChars: parsed.note?.length ?? 0,
          },
        },
        now,
      );
    });
    return updated;
  }

  reviewContradiction(
    projectId: string,
    id: string,
    input: ContradictionReviewInput,
    actor: string = LOCAL_ACTOR,
  ): { conflict: ContradictionRecord; ledger: Ledger } {
    const parsed = contradictionReviewSchema.parse(input);
    this.get(projectId);
    const existing = this.repository.ledger.contradiction(projectId, id);
    if (!existing) throw new AppError(404, 'CONFLICT_NOT_FOUND', 'This conflict does not exist.');
    const now = this.clock();
    const conflict: ContradictionRecord = {
      ...existing,
      status: parsed.status,
      note: parsed.note,
      updatedAt: now.toISOString(),
    };
    let recalculated = 0;
    this.repository.atomic(() => {
      // The operation can run again if it loses a race on a shared database, so it starts from zero.
      recalculated = 0;
      this.repository.ledger.saveContradiction(projectId, conflict, existing.updatedAt);
      // Open conflicts weigh on the statements that cite them, so those are recalculated. Their
      // history and reviews are kept: only the evidence and the class they depend on move.
      const open = openConflicts(this.repository.ledger.contradictions(projectId));
      for (const record of this.repository.ledger.claims(projectId)) {
        const next = reconcileClaim(record, open, now);
        if (next !== record) {
          this.repository.ledger.saveClaim(projectId, next, record.version);
          recalculated += 1;
        }
      }
      this.repository.audit.record(
        {
          actor,
          action: 'conflict.reviewed',
          targetType: 'conflict',
          targetId: id,
          projectId,
          detail: {
            status: parsed.status,
            noteChars: parsed.note?.length ?? 0,
            claimsRecalculated: recalculated,
          },
        },
        now,
      );
    });
    return { conflict, ledger: this.get(projectId) };
  }

  /** Counts for dashboards and the export manifest. */
  summary(projectId: string): { claims: number; byClass: ReturnType<typeof emptySupportCounts> } {
    const { claims } = this.get(projectId);
    const byClass = emptySupportCounts();
    for (const record of claims) byClass[record.supportClass] += 1;
    return { claims: claims.length, byClass };
  }
}
