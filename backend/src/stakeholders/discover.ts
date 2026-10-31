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
import { countDirections, describeDirections } from './tone.js';

const NOTE_LIMIT = 500;

/** The folds the rules made, in a sentence: all of them, or only how many when there is no room. */
function mergeSentence(merges: readonly { from: string; into: string }[], short: boolean): string {
  if (merges.length === 0) return '';
  const one = merges.length === 1;
  const folded = plural(merges.length, 'name');
  const certain = `that ${one ? 'is' : 'are'} certainly one group`;
  if (short) return `Folded ${folded} ${certain} into another (see Removed).`;
  const pairs = merges.slice(0, 3).map((merge) => `“${merge.from}” into “${merge.into}”`);
  const more = merges.length > 3 ? ` and ${merges.length - 3} more` : '';
  return `Folded ${folded} ${certain} into another, keeping ${one ? 'it' : 'each'} under Removed: ${pairs.join(', ')}${more}.`;
}

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

const RULES_NOTE =
  'Stakeholders were found by reading the text for roles, not by a model; expect gaps.';

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
  const directions = describeDirections(countDirections(result.stakeholders), 'groups');
  // The counts and the notices must reach the person; the folds say less when there is no room.
  const note =
    [false, true]
      .map((short) =>
        [base, read, directions, mergeSentence(result.merges, short), ...result.notices]
          .filter(Boolean)
          .join(' '),
      )
      .find((candidate) => candidate.length <= NOTE_LIMIT) ??
    truncate([base, read, directions, ...result.notices].filter(Boolean).join(' '), NOTE_LIMIT);
  return stakeholderSetSchema.parse({
    stakeholders: result.stakeholders,
    relations: deriveRelations(result.stakeholders),
    discovery: {
      mode: 'rules',
      model: null,
      generatedAt,
      note,
    },
    gaps: categoryGaps(result.stakeholders),
    approvedAt: null,
  });
}
