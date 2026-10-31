import { USER_SET_NOTE, isSetByPerson } from '../../../shared/analysis-plan.js';
import type { Variant } from '../../../shared/analysis.js';
import type {
  ScenarioAlternative,
  ScenarioFrame,
  ScenarioVariable,
} from '../../../shared/scenario.js';

/**
 * The scenarios a comparison runs when the person has not chosen their own: a baseline where nothing
 * changes, the proposed change, and one for each alternative the scenario names. How strongly each
 * change lands is not something the scenario states, so the intensities are system assumptions, said
 * so in each description, and a person can edit them before running. An alternative states the same
 * amount as the proposed change in other numbers (half of it, twice it) lands in proportion, capped
 * at 1, so that a larger version is never milder than the change it enlarges; any other alternative
 * has a middling intensity, because nothing says whether it is stronger or weaker.
 */
export const PROPOSED_INTENSITY = 0.7;
export const ALTERNATIVE_INTENSITY = 0.5;
export const CHANGE_ROUND = 2;

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const NUMBER = /\d[\d,]*(?:\.\d+)?|\.\d+/u;
const NUMBERS = /\d[\d,]*(?:\.\d+)?|\.\d+/gu;

/** What a stated amount says besides its number, so that "$1" is only compared with "$2" and never with "2%". */
const shapeOf = (text: string): string =>
  text.replace(NUMBERS, '#').replace(/\s+/gu, ' ').trim().toLowerCase();

function numberIn(text: string | null): number | null {
  const found = text === null ? null : NUMBER.exec(text)?.[0];
  const value =
    found === undefined || found === null ? Number.NaN : Number(found.replaceAll(',', ''));
  return Number.isFinite(value) ? value : null;
}

/** How large a change is, in the unit its words state: the amount of an increase, or the gap between two stated values. */
function sizeOf(change: ScenarioVariable): { size: number; shape: string } | null {
  const to = numberIn(change.to);
  if (to === null || change.to === null) return null;
  const from = numberIn(change.from);
  // Two values of one kind ("$10" and "$12") are a gap; "increased by $1" is the amount itself.
  const gap = from !== null && change.from !== null && shapeOf(change.from) === shapeOf(change.to);
  const size = gap ? Math.abs(to - from) : to;
  return size > 0 ? { size, shape: shapeOf(change.to) } : null;
}

/** How many times the proposed change the alternative states, when both say it in the same kind of amount. */
export function statedRatio(
  alternative: Pick<ScenarioAlternative, 'changes'>,
  scenario: Pick<ScenarioFrame, 'changes'> | null,
): number | null {
  for (const change of alternative.changes) {
    const base = scenario?.changes.find((candidate) => candidate.name === change.name);
    const own = sizeOf(change);
    const reference = base ? sizeOf(base) : null;
    if (own && reference && own.shape === reference.shape) return own.size / reference.size;
  }
  return null;
}

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
  const alternatives = (scenario?.alternatives ?? []).map((alternative): Variant => {
    const ratio = statedRatio(alternative, scenario);
    const intensity =
      ratio === null
        ? ALTERNATIVE_INTENSITY
        : Math.min(1, Math.max(0.05, Math.round(PROPOSED_INTENSITY * ratio * 100) / 100));
    const basis =
      ratio === null
        ? `(the proposed change is ${PROPOSED_INTENSITY})`
        : `(the proposed change is ${PROPOSED_INTENSITY}; this one is scaled by the amount the scenario states for it, ${Math.round(ratio * 100) / 100} times as much, and kept to 1 at most)`;
    return {
      id: uniqueId(alternative.id, used),
      label: alternative.label,
      kind: 'alternative',
      description: clip(
        `${alternative.description.trim()} Intensity ${intensity} from round ${CHANGE_ROUND} is a system assumption ${basis}: edit it to say how much stronger or weaker this alternative is.`.trim(),
        600,
      ),
      round: CHANGE_ROUND,
      intensity,
      impactOverrides: {},
      traitEdits: [],
    };
  });
  return [baseline, proposed, ...alternatives];
}

/** The sentence a system-made description has about its own strength and timing. */
const ASSUMPTION_SENTENCE = /\s*Intensity [\d.]+ from round \d+ [^]*$/u;

/**
 * Says in a scenario's own description that a person chose how strongly and when it lands, from what
 * was submitted and not from what its text happens to say: a scenario the system did not offer, or one
 * whose strength or timing differs from the offer, was set by a person. The brief and the sensitivity
 * step name the source from that note, so a request that changes the numbers and keeps the system's
 * wording is not left labelled as a system assumption. The baseline has no strength to attribute.
 */
export function attributeSettings(
  submitted: readonly Variant[],
  scenario: ScenarioFrame | null,
): Variant[] {
  const offered = new Map(autoVariants(scenario).map((variant) => [variant.id, variant]));
  return submitted.map((variant) => {
    if (variant.kind === 'baseline' || isSetByPerson(variant)) return variant;
    const offer = offered.get(variant.id);
    if (offer && offer.intensity === variant.intensity && offer.round === variant.round) {
      return variant;
    }
    const note = `Intensity ${variant.intensity} from round ${variant.round} ${USER_SET_NOTE}.`;
    const base = clip(
      variant.description.replace(ASSUMPTION_SENTENCE, '').trim(),
      600 - note.length - 1,
    );
    return { ...variant, description: `${base ? `${base} ` : ''}${note}` };
  });
}
