import type { Clarification, Constraint, ConstraintSet } from '../../../shared/constraints.js';
import { withoutRulesUsed } from '../../../shared/model-failure.js';
import type { TaskObserver } from '../models/task.js';
import { modelFailureCode } from '../models/task.js';
import type { ModelGateway } from '../models/client.js';
import { plural, truncate } from '../stakeholders/names.js';
import {
  buildConstraints,
  mergeProposed,
  emptySet,
  type BuildContext,
  type BuildStats,
} from './build.js';
import { discoverByRules, readablePassages, select } from './discover.js';
import { proposeWithModel, type ModelProposals } from './model.js';
import { newQuestions } from './questions.js';
import type { DiscoveryContext } from './types.js';

export interface ProposeInput {
  /** The set as it stands, or null when there is none: what a person decided about it is kept. */
  existing: ConstraintSet | null;
  context: DiscoveryContext;
  /** `model` asks the project's model, when the person chose it and one can be used. */
  mode: 'rules' | 'model';
  model: ModelGateway | null;
  modelName: string | null;
  signal: AbortSignal;
  observer?: TaskObserver | null;
  revisions: { scenario: number; actors: number };
  assumptionIds: ReadonlySet<string>;
  now: Date;
}

export interface ProposeResult {
  set: ConstraintSet;
  /** What was added: how many constraints and questions are new to the set. */
  added: { constraints: number; questions: number };
  stats: BuildStats;
  /** Whether a model's reply was used. */
  modelUsed: boolean;
  /** Why the rules were used when a model was asked, in fixed words; null when none was asked or it answered. */
  failure: { code: string; detail: string } | null;
}

const NOTE_LIMIT = 500;

function noteOf(input: {
  mode: 'rules' | 'model';
  modelName: string | null;
  modelUsed: boolean;
  failure: ProposeResult['failure'];
  added: ProposeResult['added'];
  stats: BuildStats;
  notes: readonly string[];
  shown: ModelProposals['shown'] | null;
}): string {
  const parts: string[] = [];
  if (input.mode === 'model' && input.modelUsed) {
    parts.push(
      `Read by a model${input.modelName ? ` (${input.modelName})` : ''} and by rules: it saw ${plural(input.shown?.passages ?? 0, 'passage')} of ${input.shown?.of ?? 0}.`,
    );
  } else if (input.failure) {
    parts.push(
      `${withoutRulesUsed(input.failure.detail)} Rules read the constraints instead, so no model proposed them.`,
    );
  } else {
    parts.push(
      'Read by rules from your words, your sources and who is involved; no model was used.',
    );
  }
  parts.push(
    `${plural(input.added.constraints, 'constraint')} and ${plural(input.added.questions, 'question')} added. Every quote was checked against its passage: ${input.stats.quotesKept} kept, ${input.stats.quotesDropped} dropped.`,
  );
  if (input.stats.downgraded > 0) {
    parts.push(
      `${plural(input.stats.downgraded, 'constraint')} the model proposed could not be quoted and ${input.stats.downgraded === 1 ? 'is' : 'are'} marked inferred.`,
    );
  }
  parts.push(...input.notes);
  return truncate(parts.join(' '), NOTE_LIMIT);
}

/**
 * Proposes constraints and questions and merges them into the set. Rules always read the person's own
 * words, the sources, the cast and who is involved; a model, when the person chose one, reads the
 * sources again and its proposals are checked like any other. Nothing proposed is reviewed or validated,
 * and nothing the person has already decided is undone.
 */
export async function proposeConstraints(input: ProposeInput): Promise<ProposeResult> {
  const { context } = input;
  const rules = discoverByRules(context);
  let modelResult: ModelProposals | null = null;
  if (input.mode === 'model') {
    modelResult = await proposeWithModel({
      context,
      model: input.model,
      signal: input.signal,
      observer: input.observer ?? null,
    });
  }
  const modelUsed = modelResult?.source === 'model';

  const buildContext: BuildContext = {
    // A model can only quote what it was shown: a passage that was held back cannot be cited.
    passages: new Map(readablePassages(context).readable.map((passage) => [passage.id, passage])),
    actorIds: new Set(context.actors.map((actor) => actor.id)),
    alternativeIds: new Set(context.alternatives.map((alternative) => alternative.id)),
    assumptionIds: input.assumptionIds,
    ...(context.exampleDocuments ? { exampleDocuments: context.exampleDocuments } : {}),
  };
  const existing = input.existing ?? emptySet(input.now, input.mode, input.revisions);
  const used = new Set(existing.constraints.map((constraint) => constraint.id));
  const built = buildConstraints(
    select([...rules.proposals, ...(modelResult?.proposals ?? [])]),
    buildContext,
    used,
  );
  const merged = mergeProposed(existing.constraints, built.constraints);

  const asked: Clarification[] = newQuestions({
    context,
    passages: readablePassages(context).readable,
    undecided: rules.undecided,
    modelQuestions: modelResult?.questions ?? [],
    constraints: merged.constraints,
    existing: existing.clarifications,
  });
  const failure = modelResult?.failure ?? null;
  const added = { constraints: merged.added, questions: asked.length };
  const constraints: Constraint[] = merged.constraints;

  const set: ConstraintSet = {
    ...existing,
    constraints,
    clarifications: [...existing.clarifications, ...asked],
    generatedAt: input.now.toISOString(),
    mode: modelUsed ? 'model' : 'rules',
    model: modelUsed ? input.modelName : null,
    // What the last ask of the model came to: its failure, or nothing once its reply was used; a rules run asks nothing.
    modelFailure:
      input.mode === 'model'
        ? failure
          ? { code: modelFailureCode(failure.code), detail: failure.detail }
          : null
        : (existing.modelFailure ?? null),
    note: noteOf({
      mode: input.mode,
      modelName: input.modelName,
      modelUsed,
      failure,
      added,
      stats: built.stats,
      notes: rules.notes,
      shown: modelResult?.shown ?? null,
    }),
    scenarioRevision: input.revisions.scenario,
    actorsRevision: input.revisions.actors,
    // New things to look at mean the set has not been reviewed as it now stands.
    reviewedAt: added.constraints > 0 || added.questions > 0 ? null : existing.reviewedAt,
  };
  return { set, added, stats: built.stats, modelUsed, failure };
}
