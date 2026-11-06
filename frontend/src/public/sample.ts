import type { CreateProjectInput, SimulationSettings } from '../../../shared/types';
import { api } from '../api';
import { entryInput, validateEntry } from '../lib/entryValidation';
import { OFFERED_EXAMPLES, startingFromExample, startingFromStarter } from '../scenes/ask/examples';

/** The rules engine, with the sizes the first screen starts from. Nothing here is ever sent to a model. */
const RULES_ONLY: SimulationSettings = {
  mode: 'local',
  agentCount: 12,
  rounds: 8,
  seed: 42,
  network: 'community',
  intervention: null,
};

const SAMPLE_ID = 'launch-pricing';

/** A question with invented evidence, made as any exploration is made, on the engine that needs no model. */
export function sampleInput(): CreateProjectInput {
  const example = OFFERED_EXAMPLES.find((entry) => entry.id === SAMPLE_ID) ?? OFFERED_EXAMPLES[0];
  const starting = example ? startingFromExample(example) : startingFromStarter();
  return entryInput({
    name: `Sample: ${starting.title}`.slice(0, 100),
    question: starting.question,
    documents: starting.documents,
    settings: RULES_ONLY,
    frame: null,
  });
}

/**
 * Makes the sample and starts reading its evidence, as a new question does. It uses the rules engine only, so it needs
 * no free-tier tokens and no key. Resolves with the id of the new project.
 */
export async function createSample(): Promise<string> {
  const input = sampleInput();
  const checked = validateEntry(input);
  if (checked.error) throw new Error('The sample could not be prepared.');
  const project = await api.create(input);
  try {
    await api.step(project.id, 'knowledge');
  } catch {
    // The sample is saved. Ground offers to read its evidence again.
  }
  return project.id;
}
