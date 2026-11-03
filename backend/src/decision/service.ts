import { DEFAULT_ARTIFACT_KEY } from '../../../shared/artifacts.js';
import type { Analysis } from '../../../shared/analysis.js';
import type { DecisionCanvas, DecisionReadiness, DecisionView } from '../../../shared/decision.js';
import { isOpenConflict } from '../../../shared/evidence.js';
import type { ResearchRun } from '../../../shared/research.js';
import { autoVariants } from '../analysis/variants.js';
import type { BriefLedgerSummary } from '../brief/facts.js';
import { gateWorldOf } from '../constraints/plan.js';
import { refreshSet } from '../constraints/refresh.js';
import { assessSufficiency } from '../grounding/ledger.js';
import { inputRevisionsNow } from '../lab/lineage.js';
import type { ArtifactRecord } from '../storage/artifacts.js';
import type { Repository } from '../storage/repository.js';
import { productSignals } from '../telemetry/product-signals.js';
import { buildCanvas, readinessOf, statusWithoutAnalysis } from './build.js';
import { consequentialScope, type ConsequentialScope } from './scope.js';
import { scopeSection } from './scope-words.js';
import { Guard } from './words.js';

type AnalysisRecord = ArtifactRecord<'analysis'>;

const when = (record: AnalysisRecord): string => record.data.completedAt ?? record.data.createdAt;

const hasRuns = (analysis: Analysis): boolean =>
  analysis.variants.some((variant) => variant.runs.length > 0);

/**
 * What the evidence ledger holds, read without changing it or searching the sources again. A ledger
 * that has not been built has nothing to say about conflicts, and one that holds no statement has
 * nothing to say about sufficiency, so each is then absent and the canvas says it was not assessed.
 */
function ledgerOf(repository: Repository, projectId: string): BriefLedgerSummary | null {
  if (repository.ledger.state(projectId) === null) return null;
  const conflicts = repository.ledger.contradictions(projectId);
  const claims = repository.ledger.claims(projectId);
  const open = conflicts.filter((conflict) => isOpenConflict(conflict.status)).length;
  const sufficiency = claims.length > 0 ? assessSufficiency(claims, open) : null;
  return {
    conflicts: conflicts.map(({ id, topic, status, left, right, leftValue, rightValue }) => ({
      id,
      topic,
      status,
      left,
      right,
      leftValue,
      rightValue,
    })),
    sufficiency: sufficiency ? { level: sufficiency.level, reasons: sufficiency.reasons } : null,
  };
}

/**
 * Reads the stored documents of a project and puts the decision canvas on them. Nothing is stored:
 * the canvas is worked out again at every read, from the newest finished comparison and the project
 * as it is now, so it cannot be older than what it describes.
 */
export class DecisionService {
  constructor(
    private readonly repository: Repository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private analyses(projectId: string): {
    latest: AnalysisRecord | null;
    pending: AnalysisRecord | null;
    failed: AnalysisRecord | null;
  } {
    const all = this.repository.artifacts.list(projectId, 'analysis');
    const completed = all
      .filter((record) => record.data.status === 'completed' && hasRuns(record.data))
      .sort((a, b) => {
        const [left, right] = [when(a), when(b)];
        return left < right ? 1 : left > right ? -1 : a.key < b.key ? 1 : -1;
      });
    const newest = (records: AnalysisRecord[]): AnalysisRecord | null =>
      [...records].sort((a, b) => (a.data.createdAt < b.data.createdAt ? 1 : -1))[0] ?? null;
    return {
      latest: completed[0] ?? null,
      pending: newest(
        all.filter((record) => record.data.status === 'queued' || record.data.status === 'running'),
      ),
      failed: newest(
        all.filter(
          (record) =>
            record.data.status === 'failed' ||
            record.data.status === 'cancelled' ||
            record.data.status === 'interrupted',
        ),
      ),
    };
  }

  /** The newest research run, when one can be read: it is context for the evidence, never required. */
  private research(projectId: string): ResearchRun | null {
    try {
      const runs = this.repository.artifacts.list(projectId, 'research');
      return (
        [...runs].sort((a, b) => (a.data.startedAt < b.data.startedAt ? 1 : -1))[0]?.data ?? null
      );
    } catch {
      return null;
    }
  }

  /** What stops there being a canvas yet, in the order a person would settle it. */
  private whatIsMissing(projectId: string, state: DecisionReadiness['state']): DecisionReadiness {
    const { artifacts } = this.repository;
    const scenario = artifacts.get(projectId, 'scenario');
    const stakeholders = artifacts.get(projectId, 'stakeholders');
    const actors = artifacts.get(projectId, 'actors');
    const constraints = artifacts.get(projectId, 'constraints');
    let missing: string;
    let next: DecisionReadiness['next'];
    if (state === 'running') {
      missing = 'A comparison is running. The decision picture appears when it finishes.';
      next = 'simulate';
    } else if (!scenario) {
      missing = 'The question has not been turned into a scenario yet.';
      next = 'ask';
    } else if (!stakeholders?.data.approvedAt) {
      missing = 'The stakeholders have not been reviewed and approved yet.';
      next = 'map';
    } else if (!actors) {
      missing = 'The simulated actors have not been made yet.';
      next = 'map';
    } else if (constraints && constraints.data.coverage?.status === 'blocked') {
      missing =
        'A hard constraint stops the comparison until it is settled, so there is nothing to compare yet.';
      next = 'map';
    } else {
      missing =
        state === 'failed'
          ? 'The last comparison did not finish, so there is no result to read.'
          : 'No comparison has been run yet.';
      next = 'simulate';
    }
    let scope: ConsequentialScope | null = null;
    try {
      scope = consequentialScope(this.repository.get(projectId).question, scenario?.data ?? null);
    } catch {
      scope = null;
    }
    return {
      state,
      missing: [missing],
      next,
      status: statusWithoutAnalysis(missing, scope ?? undefined),
      scope: scope ? { ...scopeSection(scope, new Guard()), exploration: null } : null,
    };
  }

  /**
   * The canvas for the comparison named, or the newest finished one, or null when there is none or it
   * could not be made. An export asks for the comparison its brief is of, so that the two agree.
   */
  canvasFor(projectId: string, analysisId?: string): DecisionCanvas | null {
    try {
      return this.view(projectId, { run: false, export: false }, analysisId).canvas;
    } catch {
      return null;
    }
  }

  view(projectId: string, may: DecisionView['may'], analysisId?: string): DecisionView {
    const started = performance.now();
    const { artifacts } = this.repository;
    const found = this.analyses(projectId);
    const { pending, failed } = found;
    const named = analysisId ? artifacts.get(projectId, 'analysis', analysisId) : null;
    const latest =
      named && named.data.status === 'completed' && hasRuns(named.data) ? named : found.latest;
    if (!latest) {
      const state = pending ? 'running' : failed ? 'failed' : 'no-analysis';
      return { canvas: null, readiness: this.whatIsMissing(projectId, state), may };
    }
    try {
      const project = this.repository.get(projectId);
      const scenario = artifacts.get(projectId, 'scenario');
      const actors = artifacts.get(projectId, 'actors');
      const stored = artifacts.get(projectId, 'constraints');
      const records = { scenario, actors };
      const constraints = stored
        ? refreshSet(
            stored.data,
            gateWorldOf(
              stored.data,
              records,
              latest.data.config.variants.length > 0
                ? latest.data.config.variants
                : autoVariants(scenario?.data ?? null),
            ),
            this.clock(),
          )
        : null;
      const counterfactuals = artifacts.get(
        projectId,
        'constraint-counterfactuals',
        DEFAULT_ARTIFACT_KEY,
      );
      const canvas = buildCanvas({
        project: { id: project.id, name: project.name, question: project.question },
        scenario: scenario?.data ?? null,
        stakeholders: artifacts.get(projectId, 'stakeholders')?.data ?? null,
        analysis: latest.data,
        constraints,
        counterfactuals: counterfactuals
          ? {
              set: counterfactuals.data,
              current:
                counterfactuals.data.inputs.constraints === (stored?.revision ?? 0) &&
                counterfactuals.data.inputs.actors === (actors?.revision ?? 0) &&
                counterfactuals.data.inputs.scenario === (scenario?.revision ?? 0),
            }
          : null,
        critiques: artifacts.get(projectId, 'critiques')?.data ?? null,
        documents: project.documents.map((document) => ({
          id: document.id,
          name: document.name,
          ...(document.pageCount === undefined ? {} : { pageCount: document.pageCount }),
          ...(document.provenance ? { provenance: document.provenance } : {}),
        })),
        ledger: ledgerOf(this.repository, projectId),
        research: this.research(projectId),
        revisionsNow: inputRevisionsNow(artifacts, projectId),
        newerRunning: pending !== null && pending.data.createdAt > when(latest),
      });
      productSignals.reportDuration({
        durationMs: Math.round(performance.now() - started),
        outcome: 'completed',
      });
      return { canvas, readiness: readinessOf(canvas), may };
    } catch (error) {
      productSignals.reportDuration({
        durationMs: Math.round(performance.now() - started),
        outcome: 'failed',
      });
      throw error;
    }
  }
}
