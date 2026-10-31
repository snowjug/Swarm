import type { Analysis } from '../../../shared/analysis.js';
import { DEFAULT_ARTIFACT_KEY } from '../../../shared/artifacts.js';
import type {
  CritiqueResponseBody,
  CritiqueSet,
  CritiquesView,
  RunCritiquesBody,
} from '../../../shared/critique.js';
import { isOpenConflict } from '../../../shared/evidence.js';
import { AppError, publicFailure } from '../errors.js';
import type { ModelFactory } from '../models/factory.js';
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

function newestCompleted(analyses: readonly Analysis[]): Analysis | null {
  const done = analyses.filter((analysis) => analysis.status === 'completed');
  return (
    done.sort(
      (a, b) =>
        byText(b.completedAt ?? b.createdAt, a.completedAt ?? a.createdAt) || byText(b.id, a.id),
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
  private newest(projectId: string): Analysis | null {
    return newestCompleted(
      this.repository.artifacts.list(projectId, 'analysis').map((record) => record.data),
    );
  }

  view(projectId: string, may: CritiquesView['may']): CritiquesView {
    const stored = this.repository.artifacts.get(projectId, 'critiques');
    const latest = this.newest(projectId);
    return {
      critiques: stored?.data ?? null,
      analysis: latest ? { id: latest.id, completedAt: latest.completedAt } : null,
      may,
      model: { available: this.options.modelAvailable },
    };
  }

  private completedAnalysis(projectId: string, analysisId: string | undefined): Analysis {
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
      return found.data;
    }
    const latest = this.newest(projectId);
    if (!latest) throw notReady();
    return latest;
  }

  /** What the critics read, and what is missing from it, in words. */
  private gather(
    projectId: string,
    analysis: Analysis,
  ): { input: Omit<CriticInput, 'now'>; notes: string[] } {
    const { artifacts, ledger } = this.repository;
    const scenario = artifacts.get(projectId, 'scenario')?.data ?? null;
    const stakeholders = artifacts.get(projectId, 'stakeholders')?.data ?? null;
    const storedBrief = artifacts.get(projectId, 'brief')?.data ?? null;
    const brief = storedBrief?.analysisId === analysis.id ? storedBrief : null;
    const notes: string[] = [];
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
    if (this.running.has(projectId)) {
      throw new AppError(
        409,
        'CRITIQUES_RUNNING',
        'An independent review is already running for this experiment. Wait for it to finish.',
      );
    }
    this.running.add(projectId);
    try {
      const analysis = this.completedAnalysis(projectId, body.analysisId);
      const { input, notes } = this.gather(projectId, analysis);
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

  /** Records a person's response. It replaces any earlier response to the same critique. */
  respond(projectId: string, critiqueId: string, body: CritiqueResponseBody, actor: string): void {
    const stored = this.repository.artifacts.get(projectId, 'critiques');
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
    this.repository.atomic(() => {
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
