import { APP_VERSION } from '../../../shared/types.js';
import type { BriefView } from '../../../shared/brief.js';
import { isOpenConflict } from '../../../shared/evidence.js';
import { AppError } from '../errors.js';
import { detectContradictions } from '../grounding/contradictions.js';
import { assessSufficiency } from '../grounding/ledger.js';
import type { ArtifactRecord } from '../storage/artifacts.js';
import type { Repository } from '../storage/repository.js';
import { buildBrief } from './build.js';
import type { BriefExportInput } from './export.js';
import { gatherFacts, type BriefInputs, type BriefLedgerSummary } from './facts.js';
import { briefVisuals } from './visuals.js';

type AnalysisRecord = ArtifactRecord<'analysis'>;

const when = (record: AnalysisRecord): string => record.data.completedAt ?? record.data.createdAt;

/** What the brief needs from the project, read without changing anything. */
function ledgerSummaryOf(repository: Repository, projectId: string): BriefLedgerSummary {
  const built = repository.ledger.state(projectId) !== null;
  const conflicts = built
    ? repository.ledger.contradictions(projectId)
    : detectContradictions(repository.chunks(projectId), new Date());
  const open = conflicts.filter((conflict) => isOpenConflict(conflict.status)).length;
  const sufficiency = built ? assessSufficiency(repository.ledger.claims(projectId), open) : null;
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

/** Makes, stores and reads the decision brief of a project, from the documents the project already holds. */
export class BriefService {
  constructor(
    private readonly repository: Repository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The completed analysis that finished last. */
  latestAnalysis(projectId: string): AnalysisRecord | null {
    const completed = this.repository.artifacts
      .list(projectId, 'analysis')
      .filter((record) => record.data.status === 'completed');
    return (
      completed.sort((a, b) => {
        const [left, right] = [when(a), when(b)];
        return left < right ? 1 : left > right ? -1 : a.key < b.key ? 1 : -1;
      })[0] ?? null
    );
  }

  private inputs(projectId: string, analysis: AnalysisRecord, generatedAt?: string): BriefInputs {
    const { artifacts } = this.repository;
    const project = this.repository.get(projectId);
    const scenario = artifacts.get(projectId, 'scenario');
    const stakeholders = artifacts.get(projectId, 'stakeholders');
    const actors = artifacts.get(projectId, 'actors');
    const critiques = artifacts.get(projectId, 'critiques');
    return {
      project: { id: project.id, name: project.name, question: project.question },
      scenario: scenario?.data ?? null,
      stakeholders: stakeholders?.data ?? null,
      actors: actors?.data ?? null,
      analysis: analysis.data,
      critiques: critiques?.data ?? null,
      documents: project.documents.map((document) => ({
        id: document.id,
        name: document.name,
        ...(document.pageCount === undefined ? {} : { pageCount: document.pageCount }),
        ...(document.provenance ? { provenance: document.provenance } : {}),
      })),
      ledgerSummary: ledgerSummaryOf(this.repository, projectId),
      inputRevisions: {
        scenario: scenario?.revision ?? 0,
        stakeholders: stakeholders?.revision ?? 0,
        actors: actors?.revision ?? 0,
        analysis: analysis.revision,
        critiques: critiques?.revision ?? 0,
      },
      ...(generatedAt ? { generatedAt } : {}),
    };
  }

  /** Builds the brief from an analysis (the newest completed one when none is named) and stores it. */
  generate(projectId: string, analysisId?: string): ArtifactRecord<'brief'> {
    const record = analysisId
      ? this.repository.artifacts.get(projectId, 'analysis', analysisId)
      : this.latestAnalysis(projectId);
    if (!record) {
      throw analysisId
        ? new AppError(404, 'ANALYSIS_NOT_FOUND', 'That analysis does not exist in this project.')
        : new AppError(
            409,
            'NO_ANALYSIS',
            'There is no completed analysis to write a brief from. Run the analysis in the Simulation stage first.',
          );
    }
    if (record.data.status !== 'completed') {
      throw new AppError(
        409,
        'ANALYSIS_NOT_COMPLETED',
        'That analysis has not finished, so a brief cannot be written from it yet.',
      );
    }
    if (record.data.variants.length === 0) {
      throw new AppError(
        409,
        'ANALYSIS_EMPTY',
        'That analysis recorded no runs, so there is nothing to write a brief from. Run it again.',
      );
    }
    const brief = buildBrief(this.inputs(projectId, record, this.clock().toISOString()));
    return this.repository.artifacts.put(projectId, 'brief', 'default', brief);
  }

  /** The stored brief, its charts' data, and whether anything it was made from has since changed. */
  view(projectId: string, may: BriefView['may']): BriefView {
    const { artifacts } = this.repository;
    const latest = this.latestAnalysis(projectId);
    const latestAnalysis = latest ? { id: latest.key, completedAt: latest.data.completedAt } : null;
    const stored = artifacts.get(projectId, 'brief');
    if (!stored) return { brief: null, visuals: null, latestAnalysis, changedSince: [], may };
    const analysis = artifacts.get(projectId, 'analysis', stored.data.analysisId);
    const changed: string[] = [];
    for (const kind of ['scenario', 'stakeholders', 'actors', 'critiques'] as const) {
      const now = artifacts.get(projectId, kind)?.revision ?? 0;
      if (now !== (stored.data.inputRevisions[kind] ?? now)) changed.push(kind);
    }
    if (!analysis) changed.push('analysis (no longer stored)');
    else if (analysis.revision !== (stored.data.inputRevisions.analysis ?? analysis.revision)) {
      changed.push('analysis');
    }
    if (latest && latest.key !== stored.data.analysisId) changed.push('a newer analysis exists');
    return {
      brief: stored.data,
      visuals: analysis ? briefVisuals(gatherFacts(this.inputs(projectId, analysis))) : null,
      latestAnalysis,
      changedSince: changed,
      may,
    };
  }

  /** Everything an export prints, or a 409 that says what is missing. */
  forExport(projectId: string, projectName: string): Omit<BriefExportInput, 'exportedAt'> {
    const stored = this.repository.artifacts.get(projectId, 'brief');
    if (!stored) {
      throw new AppError(
        409,
        'BRIEF_NOT_GENERATED',
        'No decision brief has been generated for this project yet. Generate it first.',
      );
    }
    const analysis = this.repository.artifacts.get(projectId, 'analysis', stored.data.analysisId);
    return {
      brief: stored.data,
      visuals: analysis ? briefVisuals(gatherFacts(this.inputs(projectId, analysis))) : null,
      project: { id: projectId, name: projectName },
      appVersion: APP_VERSION,
    };
  }
}
