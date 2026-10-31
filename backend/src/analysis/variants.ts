import type { Variant } from '../../../shared/analysis.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';

/**
 * The scenarios a comparison runs when the person has not chosen their own: a baseline where nothing
 * changes, the proposed change, and one for each alternative the scenario names. How strongly each
 * change lands is not something the scenario states, so the intensities are system assumptions, said
 * so in each description, and a person can edit them before running.
 */
export const PROPOSED_INTENSITY = 0.7;
export const ALTERNATIVE_INTENSITY = 0.5;
export const CHANGE_ROUND = 2;

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

function uniqueId(wanted: string, used: Set<string>): string {
  let id = wanted;
  for (let attempt = 2; used.has(id); attempt += 1) {
    const suffix = `-${attempt}`;
    id = `${wanted.slice(0, 48 - suffix.length)}${suffix}`;
  }
  used.add(id);
  return id;
}

export function autoVariants(scenario: ScenarioFrame | null): Variant[] {
  const used = new Set<string>();
  const baseline: Variant = {
    id: uniqueId('baseline', used),
    label: 'No change',
    kind: 'baseline',
    description: clip(
      `${scenario?.baseline.trim() || 'Nothing changes: the declared starting assumptions only.'} Intensity 0: no change lands.`,
      600,
    ),
    round: 1,
    intensity: 0,
    impactOverrides: {},
    traitEdits: [],
  };
  const decision = scenario?.decision.trim();
  const proposed: Variant = {
    id: uniqueId('proposed-change', used),
    label: 'Proposed change',
    kind: 'alternative',
    description: clip(
      `${decision ? `The change as framed: ${decision}. ` : ''}Intensity ${PROPOSED_INTENSITY} from round ${CHANGE_ROUND} is a system assumption: edit it to say how strongly the change lands.`,
      600,
    ),
    round: CHANGE_ROUND,
    intensity: PROPOSED_INTENSITY,
    impactOverrides: {},
    traitEdits: [],
  };
  const alternatives = (scenario?.alternatives ?? []).map((alternative): Variant => ({
    id: uniqueId(alternative.id, used),
    label: alternative.label,
    kind: 'alternative',
    description: clip(
      `${alternative.description.trim()} Intensity ${ALTERNATIVE_INTENSITY} from round ${CHANGE_ROUND} is a system assumption (the proposed change is ${PROPOSED_INTENSITY}): edit it to say how much stronger or weaker this alternative is.`.trim(),
      600,
    ),
    round: CHANGE_ROUND,
    intensity: ALTERNATIVE_INTENSITY,
    impactOverrides: {},
    traitEdits: [],
  }));
  return [baseline, proposed, ...alternatives];
}
