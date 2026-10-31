import { stakeholderSetSchema, type StakeholderSet } from '../../../shared/stakeholders.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import type { EvidenceChunk, KnowledgeGraph } from '../../../shared/types.js';
import { publicFailure } from '../errors.js';
import type { ModelGateway } from '../models/client.js';
import { clientLeft, failureWords } from './abort.js';
import { discoverByModel, modelNote } from './model.js';
import { plural, truncate } from './names.js';
import { categoryGaps, deriveRelations } from './relations.js';
import { discoverByRules } from './rules.js';

export interface DiscoverInput {
  project: { question: string; graph: KnowledgeGraph | null };
  scenario: ScenarioFrame | null;
  passages: readonly EvidenceChunk[];
  /** A model to ask, or null to read the text for roles without one. */
  model: ModelGateway | null;
  /** Its name, for the note on the set. */
  modelName?: string | null;
  signal?: AbortSignal;
  now?: () => Date;
}

const RULES_NOTE = 'Found by reading the text for roles, not by a model; expect gaps.';

/**
 * Finds the stakeholders of a scenario. With a model it asks for them and checks the reply; if that
 * fails, for whatever reason, it says so in the note and reads the text for roles instead. Without a
 * model it only reads the text. Either way the result says how it was made, quotes are copied from the
 * passages, and the person reviews it before anything is built from it.
 */
export async function discoverStakeholders(input: DiscoverInput): Promise<StakeholderSet> {
  const generatedAt = (input.now ?? (() => new Date()))().toISOString();
  const context = {
    question: input.project.question,
    scenario: input.scenario,
    graph: input.project.graph,
    passages: input.passages,
  };
  let fallback: string | null = null;
  if (input.model) {
    try {
      const result = await discoverByModel(
        context,
        input.model,
        input.signal ?? new AbortController().signal,
      );
      return stakeholderSetSchema.parse({
        stakeholders: result.stakeholders,
        relations: result.relations,
        discovery: {
          mode: 'model',
          model: input.modelName ?? null,
          generatedAt,
          note: modelNote(result, input.modelName ?? null),
        },
        gaps: result.gaps,
        approvedAt: null,
      });
    } catch (error) {
      if (clientLeft(input.signal)) throw error;
      fallback = truncate(failureWords(input.signal, publicFailure(error).message), 200);
    }
  }
  const result = discoverByRules(context);
  const base = fallback
    ? `The model could not be used (${fallback}) so stakeholders were found by reading the text for roles, not by a model; expect gaps.`
    : RULES_NOTE;
  const read = `It read ${plural(result.read.passages, 'passage')} and found ${plural(result.read.groups, 'group')}.`;
  return stakeholderSetSchema.parse({
    stakeholders: result.stakeholders,
    relations: deriveRelations(result.stakeholders),
    discovery: {
      mode: 'rules',
      model: null,
      generatedAt,
      note: truncate([base, read, ...result.notices].join(' '), 500),
    },
    gaps: categoryGaps(result.stakeholders),
    approvedAt: null,
  });
}
