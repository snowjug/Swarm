import {
  COMPARISON_INPUTS_UNRECORDED,
  NEWER_ANALYSIS_EXISTS,
  inputsInWords,
} from '../../../shared/analysis.js';
import { DEFAULT_ARTIFACT_KEY } from '../../../shared/artifacts.js';
import type {
  CritiqueResponseBody,
  CritiqueSet,
  CritiquesView,
  RunCritiquesBody,
} from '../../../shared/critique.js';
import { isOpenConflict } from '../../../shared/evidence.js';
import { AppError, publicFailure } from '../errors.js';
import { changedInputs, inputRevisionsNow, type Revisions } from '../lab/lineage.js';
import type { ModelFactory } from '../models/factory.js';
import type { ArtifactRecord } from '../storage/artifacts.js';
import type { Repository } from '../storage/repository.js';
import { carryResponses } from './merge.js';
import { modelCritiques, type ModelReview } from './model.js';
import { runRuleCritics, sortCritiques } from './rules.js';
import { byText, clip, plural } from './text.js';
import type { CriticInput } from './types.js';

/** The most deterministic critiques kept in a set; the model's are added to these (at most 12). */
export const MAX_RULE_CRITIQUES = 100;
/** One call, and the repairs a reply that fails its checks may be given. */
const MODEL_CALLS = 3;

const notReady = (): AppError =>
  new AppError(
    409,
    'ANALYSIS_NOT_READY',
    'There is no finished analysis to review yet. Compare scenarios first, then run the independent review.',
  );

/** Said where a model review is offered or asked for on a project that was made to run without one. */
const RUNS_WITHOUT_MODEL =
  'This project runs without a model, so nothing is sent to one. Only the deterministic checks run.';

type AnalysisRecord = ArtifactRecord<'analysis'>;

function newestCompleted(records: readonly AnalysisRecord[]): AnalysisRecord | null {
  const done = records.filter((record) => record.data.status === 'completed');
  return (
    done.sort(
      (a, b) =>
        byText(b.data.completedAt ?? b.data.createdAt, a.data.completedAt ?? a.data.createdAt) ||
        byText(b.data.id, a.data.id),
    )[0] ?? null
  );
}

export interface CritiqueServiceOptions {
  createModel: ModelFactory;
  /** Whether a model is configured; the page uses it to say what "with a model" would do. */
  modelAvailable: boolean;
  now?: () => Date;
}

/**
 * Runs the independent review of an analysis, keeps what people say to it, and never edits the
 * analysis, the stakeholders or the brief it reads.
 */
export class CritiqueService {
  private readonly running = new Set<string>();

  constructor(
    private readonly repository: Repository,
    private readonly options: CritiqueServiceOptions,
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** The newest analysis that has finished, which is the one a review without an id is about. */
  private newest(projectId: string): AnalysisRecord | null {
    return newestCompleted(this.repository.artifacts.list(projectId, 'analysis'));
  }

  /**
   * What has changed since the comparison the review is of was run, checked against what that
   * comparison recorded, so that running the review again on it does not make it look current.
   */
  private changedSince(
    projectId: string,
    stored: ArtifactRecord<'critiques'>,
    latest: AnalysisRecord | null,
  ): string[] {
    const { artifacts } = this.repository;
    const analysisId = stored.data.analysisId;
    const analysis = analysisId ? artifacts.get(projectId, 'analysis', analysisId) : null;
    const changed: string[] = changedInputs(
      analysis?.data.inputRevisions,
      stored.data.inputRevisions,
      inputRevisionsNow(artifacts, projectId),
    );
    if (analysisId && !analysis) changed.push('analysis (no longer stored)');
    // A comparison that recorded nothing of what it was made from cannot be told from a current one.
    if (analysis && analysis.data.inputRevisions === undefined) {
      changed.push(COMPARISON_INPUTS_UNRECORDED);
    }
    if (analysisId && latest && latest.data.id !== analysisId) changed.push(NEWER_ANALYSIS_EXISTS);
    return changed;
  }

  view(projectId: string, may: CritiquesView['may']): CritiquesView {
    const stored = this.repository.artifacts.get(projectId, 'critiques');
    const latest = this.newest(projectId);
    const runsWithoutModel = this.repository.get(projectId).mode !== 'llm';
    return {
      critiques: stored?.data ?? null,
      revision: stored?.revision ?? null,
      changedSince: stored ? this.changedSince(projectId, stored, latest) : [],
      analysis: latest ? { id: latest.data.id, completedAt: latest.data.completedAt } : null,
      may,
      model: {
        available: this.options.modelAvailable && !runsWithoutModel,
        reason: runsWithoutModel ? RUNS_WITHOUT_MODEL : null,
      },
    };
  }

  private completedAnalysis(projectId: string, analysisId: string | undefined): AnalysisRecord {
    if (analysisId !== undefined) {
      const found = this.repository.artifacts.get(projectId, 'analysis', analysisId);
      if (!found) {
        throw new AppError(
          409,
          'ANALYSIS_NOT_READY',
          'There is no analysis with that id to review. Choose a finished analysis, or leave the id out to review the newest.',
        );
      }
      if (found.data.status !== 'completed') {
        throw new AppError(
          409,
          'ANALYSIS_NOT_READY',
          `That analysis has not finished (it is ${found.data.status}). Wait for it to finish, then run the review.`,
        );
      }
      return found;
    }
    const latest = this.newest(projectId);
    if (!latest) throw notReady();
    return latest;
  }

  /** What the critics read, and what is missing from it, in words. */
  private gather(
    projectId: string,
    record: AnalysisRecord,
  ): { input: Omit<CriticInput, 'now'>; notes: string[]; revisions: Revisions } {
    const { artifacts, ledger } = this.repository;
    const analysis = record.data;
    const scenario = artifacts.get(projectId, 'scenario')?.data ?? null;
    const stakeholders = artifacts.get(projectId, 'stakeholders')?.data ?? null;
    const storedBrief = artifacts.get(projectId, 'brief')?.data ?? null;
    const brief = storedBrief?.analysisId === analysis.id ? storedBrief : null;
    const revisions = { ...inputRevisionsNow(artifacts, projectId), analysis: record.revision };
    const notes: string[] = [];
    const earlier = changedInputs(analysis.inputRevisions, undefined, revisions);
    if (earlier.length > 0) {
      notes.push(
        `This comparison was run before ${inputsInWords(earlier)} changed, so a check that sets it against ${earlier.length === 1 ? 'that document' : 'those documents'} reads two different versions. Run the comparison again, then this review.`,
      );
    }
    if (analysis.inputRevisions === undefined) {
      notes.push(
        'This comparison was saved before Swarm recorded what a comparison is made from, so a check that sets it against the scenario, the stakeholders or the actors cannot tell whether it reads two different versions. Run the comparison again, then this review.',
      );
    }
    if (!scenario) {
      notes.push('No scenario was recorded, so the checks that compare against it were skipped.');
    }
    if (!stakeholders) {
      notes.push(
        'No stakeholders were recorded, so the checks on who is cited and who is missing were skipped.',
      );
    }
    if (storedBrief && !brief) {
      notes.push(
        'The brief was made from a different analysis, so its wording and recommendations were not reviewed.',
      );
    }
    const built = ledger.state(projectId) !== null;
    if (!built) {
      notes.push(
        'The ledger of conflicts between sources has not been built, so those conflicts were not checked.',
      );
    }
    const open = built
      ? ledger.contradictions(projectId).filter((conflict) => isOpenConflict(conflict.status))
      : [];
    const documents = this.repository.get(projectId).documents.map((document) => ({
      id: document.id,
      name: document.name,
      provenance: document.provenance ?? null,
    }));
    return {
      input: {
        scenario,
        stakeholders,
        actors: { actors: analysis.actors },
        analysis,
        brief,
        evidenceSummary: {
          documents,
          openConflicts: built ? open.length : null,
          conflictEvidence: open
            .slice(0, 3)
            .flatMap((conflict) => [conflict.left, conflict.right])
            .slice(0, 5),
        },
      },
      notes,
      revisions,
    };
  }

  /**
   * Reviews a finished analysis and stores the result. The deterministic critics always run; the
   * model's are added when asked for and when the model answers, and a failure is said in a note.
   */
  async run(
    projectId: string,
    body: RunCritiquesBody,
    actor: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (body.useModel && this.repository.get(projectId).mode !== 'llm') {
      throw new AppError(409, 'MODEL_NOT_AVAILABLE', RUNS_WITHOUT_MODEL);
    }
    if (this.running.has(projectId)) {
      throw new AppError(
        409,
        'CRITIQUES_RUNNING',
        'An independent review is already running for this experiment. Wait for it to finish.',
      );
    }
    this.running.add(projectId);
    try {
      const record = this.completedAnalysis(projectId, body.analysisId);
      const analysis = record.data;
      const { input, notes, revisions } = this.gather(projectId, record);
      const now = this.now().toISOString();
      const rules = runRuleCritics({ ...input, now });
      const kept = rules.slice(0, MAX_RULE_CRITIQUES);
      if (rules.length > kept.length) {
        notes.push(
          `${plural(rules.length - kept.length, 'minor critique')} had to be left out to keep the list readable.`,
        );
      }

      let review: ModelReview | null = null;
      let modelFailed = false;
      if (body.useModel) {
        try {
          const gateway = this.options.createModel(this.repository.modelUse(projectId), {
            maxCalls: MODEL_CALLS,
          });
          review = await modelCritiques(gateway, { ...input, now }, rules, signal);
          const left = review.proposed - review.critiques.length - review.dropped;
          if (review.dropped > 0) {
            const one = review.dropped === 1;
            notes.push(
              `The model offered ${plural(review.proposed, 'critique')}; ${review.dropped} ${one ? 'was' : 'were'} dropped because ${one ? 'it' : 'they'} named something the model was not given, or repeated another.`,
            );
          }
          if (left > 0)
            notes.push(
              `${plural(left, 'model critique')} went over the limit of 12 and ${left === 1 ? 'was' : 'were'} left out.`,
            );
        } catch (error) {
          modelFailed = true;
          const reason =
            error instanceof AppError && error.code === 'MODEL_OUTPUT_INVALID'
              ? 'The model’s reply did not pass the server’s checks, even after corrective retries.'
              : publicFailure(error).message;
          notes.push(
            `The model review could not be completed, so only the deterministic checks are shown. ${reason}`,
          );
        }
      }

      // Read what is stored only now, after the model has answered, so that a response given while
      // it was working is kept.
      this.repository.atomic(() => {
        const previous = this.repository.artifacts.get(projectId, 'critiques');
        const critiques = carryResponses(
          sortCritiques([...kept, ...(review?.critiques ?? [])]),
          previous?.data.critiques ?? [],
        );
        const set: CritiqueSet = {
          analysisId: analysis.id,
          generatedAt: now,
          mode: review ? 'both' : 'rules',
          critiques,
          ...(notes.length > 0 ? { notes: notes.slice(0, 10).map((note) => clip(note, 400)) } : {}),
          inputRevisions: revisions,
        };
        this.repository.artifacts.put(projectId, 'critiques', DEFAULT_ARTIFACT_KEY, set, {
          expectedRevision: previous?.revision ?? 0,
        });
        this.repository.audit.record({
          actor,
          action: 'critiques.run',
          targetType: 'project',
          targetId: projectId,
          projectId,
          detail: {
            analysis: analysis.id,
            critiques: critiques.length,
            rules: kept.length,
            model: review?.critiques.length ?? 0,
            modelRequested: body.useModel,
            modelFailed,
          },
        });
      });
    } finally {
      this.running.delete(projectId);
    }
  }

  /**
   * Records a person's response. It replaces any earlier response to the same critique, and only if
   * the review is still the one the person was looking at: when someone else has responded, or the
   * review has been run again, since then, it is refused rather than silently replacing theirs.
   */
  respond(projectId: string, critiqueId: string, body: CritiqueResponseBody, actor: string): void {
    this.repository.atomic(() => {
      const stored = this.repository.artifacts.get(projectId, 'critiques');
      if (stored && stored.revision !== body.expectedRevision) {
        throw new AppError(
          409,
          'CRITIQUES_CHANGED',
          'This review changed while you were reading it: someone else responded, or the review was run again. Reload the review to see how it stands now, then answer again.',
        );
      }
      const target = stored?.data.critiques.find((critique) => critique.id === critiqueId);
      if (!stored || !target) {
        throw new AppError(
          404,
          'CRITIQUE_NOT_FOUND',
          'This critique is not in the review. Run the independent review again and choose one from the list.',
        );
      }
      const at = this.now().toISOString();
      const remaining = body.remainingDisagreement?.trim() || null;
      const critiques = stored.data.critiques.map((critique) =>
        critique.id === critiqueId
          ? {
              ...critique,
              status: body.status,
              response: { text: body.text, by: 'user' as const, at },
              remainingDisagreement: remaining,
            }
          : critique,
      );
      this.repository.artifacts.put(
        projectId,
        'critiques',
        DEFAULT_ARTIFACT_KEY,
        { ...stored.data, critiques },
        { expectedRevision: stored.revision },
      );
      this.repository.audit.record({
        actor,
        action: 'critique.responded',
        targetType: 'project',
        targetId: projectId,
        projectId,
        detail: { critique: critiqueId, role: target.role, status: body.status },
      });
    });
  }
}
