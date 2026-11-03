import { APP_VERSION } from '../../../shared/types.js';
import {
  COMPARISON_INPUTS_UNRECORDED,
  NEWER_ANALYSIS_EXISTS,
  UNRECORDED_INPUTS_ADVICE,
  inputsInWords,
} from '../../../shared/analysis.js';
import { MAX_ARTIFACT_BYTES } from '../../../shared/artifacts.js';
import type { BriefView, DecisionBrief } from '../../../shared/brief.js';
import { isOpenConflict } from '../../../shared/evidence.js';
import { AppError } from '../errors.js';
import {
  detectContradictions,
  reconcileConflicts,
  type ContradictionScanStats,
} from '../grounding/contradictions.js';
import { assessSufficiency } from '../grounding/ledger.js';
import { LedgerService } from '../grounding/service.js';
import { changedInputs, inputRevisionsNow, type Revisions } from '../lab/lineage.js';
import type { ArtifactRecord } from '../storage/artifacts.js';
import type { Repository } from '../storage/repository.js';
import { buildBrief } from './build.js';
import { DecisionService } from '../decision/service.js';
import type { BriefExportInput } from './export.js';
import { gatherFacts, type BriefInputs, type BriefLedgerSummary } from './facts.js';
import { briefVisuals } from './visuals.js';

type AnalysisRecord = ArtifactRecord<'analysis'>;

const when = (record: AnalysisRecord): string => record.data.completedAt ?? record.data.createdAt;

/** The brief as the routes hand it out: the snapshot of its charts is sent as `visuals`, not twice. */
function withoutSnapshot(brief: DecisionBrief): DecisionBrief {
  const shown = { ...brief };
  delete shown.snapshot;
  return shown;
}

/** What the brief needs from the project, read without changing anything. */
function ledgerSummaryOf(repository: Repository, projectId: string): BriefLedgerSummary {
  const built = repository.ledger.state(projectId) !== null;
  const stats: ContradictionScanStats = {
    sentences: 0,
    skippedLists: 0,
    postingVisits: 0,
    pairsCompared: 0,
    cappedSentences: 0,
  };
  // One search of the sources serves both what is found and how far it read. A ledger built earlier
  // keeps what a person decided about its conflicts, and a candidate that this search finds and it
  // does not hold is shown as detected, so that a ledger built before the search improved is not
  // paired with the coverage of a search that it never made.
  const scanned = detectContradictions(repository.chunks(projectId), new Date(), stats);
  const conflicts = built
    ? reconcileConflicts(repository.ledger.contradictions(projectId), scanned)
    : scanned;
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
    scan: {
      sentences: stats.sentences,
      skippedLists: stats.skippedLists,
      cappedSentences: stats.cappedSentences,
    },
  };
}

/** Makes, stores and reads the decision brief of a project, from the documents the project already holds. */
export class BriefService {
  constructor(
    private readonly repository: Repository,
    private readonly clock: () => Date = () => new Date(),
    /** The most a brief may take with the data of its charts kept in it; beyond that they are left out. */
    private readonly keepChartsUpTo: number = MAX_ARTIFACT_BYTES,
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
        constraints: artifacts.get(projectId, 'constraints')?.revision ?? 0,
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
    // A conflict that a fresh search finds and a built ledger does not hold is added to the ledger first,
    // so that what the brief shows can be reviewed there too.
    new LedgerService(this.repository, this.clock).addFoundConflicts(projectId);
    const inputs = this.inputs(projectId, record, this.clock().toISOString());
    const made = buildBrief(inputs);
    // The brief's words describe the scenario and the stakeholders as they are now, and its numbers
    // come from a comparison that may have been run on earlier ones: it says so, in the brief itself.
    const earlier = changedInputs(
      record.data.inputRevisions,
      undefined,
      inputs.inputRevisions ?? {},
    );
    const notes =
      earlier.length > 0 && made.methodology.notes.length < 10
        ? [
            ...made.methodology.notes,
            `The comparison this brief rests on was run before ${inputsInWords(earlier)} changed, so the brief describes the project as it was. Run the comparison again, then write the brief again.`,
          ]
        : record.data.inputRevisions === undefined && made.methodology.notes.length < 10
          ? [
              ...made.methodology.notes,
              `${UNRECORDED_INPUTS_ADVICE} Run the comparison again, then write the brief again.`,
            ]
          : made.methodology.notes;
    const brief: DecisionBrief = {
      ...made,
      methodology: { ...made.methodology, notes },
      snapshot: briefVisuals(gatherFacts(inputs)),
    };
    // A snapshot that would not fit is left out: the page and the exports then say they draw from the project as it is.
    if (Buffer.byteLength(JSON.stringify(brief), 'utf8') > this.keepChartsUpTo) {
      delete brief.snapshot;
    }
    return this.repository.artifacts.put(projectId, 'brief', 'default', brief);
  }

  /** What the project's documents are now, in the names a brief records them by. */
  private revisionsNow(projectId: string, analysis: AnalysisRecord | null): Revisions {
    const { artifacts } = this.repository;
    return {
      ...inputRevisionsNow(artifacts, projectId),
      ...(analysis ? { analysis: analysis.revision } : {}),
      critiques: artifacts.get(projectId, 'critiques')?.revision ?? 0,
    };
  }

  /**
   * What has changed since the brief was made. The scenario, the stakeholders and the actors are
   * checked against what the comparison recorded, not against when the brief was written, so that
   * writing it again from the same comparison does not make it look current.
   */
  private changedSince(
    stored: ArtifactRecord<'brief'>,
    analysis: AnalysisRecord | null,
    latest: AnalysisRecord | null,
    now: Revisions,
  ): string[] {
    const made = stored.data.inputRevisions;
    const changed: string[] = changedInputs(analysis?.data.inputRevisions, made, now);
    if (now.critiques !== (made.critiques ?? now.critiques)) changed.push('critiques');
    if (!analysis) changed.push('analysis (no longer stored)');
    else if (analysis.revision !== (made.analysis ?? analysis.revision)) changed.push('analysis');
    // A comparison that recorded nothing of what it was made from cannot be told from a current one: that stays said.
    if (analysis && analysis.data.inputRevisions === undefined) {
      changed.push(COMPARISON_INPUTS_UNRECORDED);
    }
    if (latest && latest.key !== stored.data.analysisId) changed.push(NEWER_ANALYSIS_EXISTS);
    return changed;
  }

  /**
   * The charts' data: the snapshot kept with the brief, so that they agree with its words whatever has
   * changed since, or, for a brief made before one was kept, the project's documents as they are now.
   */
  private visualsOf(
    projectId: string,
    stored: ArtifactRecord<'brief'>,
    analysis: AnalysisRecord | null,
  ): Pick<BriefView, 'visuals' | 'visualsFrom'> {
    if (stored.data.snapshot) return { visuals: stored.data.snapshot, visualsFrom: 'snapshot' };
    if (!analysis) return { visuals: null, visualsFrom: null };
    return {
      visuals: briefVisuals(gatherFacts(this.inputs(projectId, analysis))),
      visualsFrom: 'current',
    };
  }

  /** The stored brief, its charts' data, and whether anything it was made from has since changed. */
  view(projectId: string, may: BriefView['may']): BriefView {
    const { artifacts } = this.repository;
    const latest = this.latestAnalysis(projectId);
    const latestAnalysis = latest ? { id: latest.key, completedAt: latest.data.completedAt } : null;
    const stored = artifacts.get(projectId, 'brief');
    if (!stored) {
      return {
        brief: null,
        visuals: null,
        visualsFrom: null,
        latestAnalysis,
        changedSince: [],
        may,
      };
    }
    const analysis = artifacts.get(projectId, 'analysis', stored.data.analysisId);
    return {
      brief: withoutSnapshot(stored.data),
      ...this.visualsOf(projectId, stored, analysis),
      latestAnalysis,
      changedSince: this.changedSince(
        stored,
        analysis,
        latest,
        this.revisionsNow(projectId, analysis),
      ),
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
    const now = this.revisionsNow(projectId, analysis);
    const { visuals, visualsFrom } = this.visualsOf(projectId, stored, analysis);
    return {
      brief: withoutSnapshot(stored.data),
      visuals,
      project: { id: projectId, name: projectName },
      appVersion: APP_VERSION,
      canvas: new DecisionService(this.repository, this.clock).canvasFor(
        projectId,
        stored.data.analysisId,
      ),
      freshness: {
        changedSince: this.changedSince(stored, analysis, this.latestAnalysis(projectId), now),
        currentRevisions: now,
        visuals: visualsFrom === 'snapshot' ? 'snapshot' : 'current',
      },
    };
  }
}
