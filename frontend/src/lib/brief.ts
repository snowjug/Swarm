import type { StabilityClass } from '../../../shared/analysis';
import type { BriefRefs, BriefSectionId, StatementOrigin } from '../../../shared/brief';

/** What each origin means, in a line, for the legend and for a tooltip. */
export const ORIGIN_MEANINGS: Record<StatementOrigin, string> = {
  'supplied-evidence': 'Comes from a source the person supplied.',
  'retrieved-public-evidence': 'Comes from a public page this server fetched itself.',
  'user-assumption': 'An input a person wrote or accepted.',
  'system-assumption': 'A setting Swarm filled in. It is open to edit.',
  'inferred-stakeholder': 'A stakeholder Swarm proposed from the question and the sources.',
  'actor-behavior': 'What simulated actors did in the runs.',
  'simulation-aggregation': 'Counts over many seeded simulated runs.',
  'model-interpretation': 'A model’s reading of the results.',
  'historical-comparison': 'Comes from historical material the person supplied.',
  'unresolved-uncertainty': 'Something that is not known, or that the evidence does not settle.',
};

export type Reliance = 'high' | 'moderate' | 'low';

export const RELIANCE_LABELS: Record<Reliance, string> = {
  high: 'High reliance',
  moderate: 'Moderate reliance',
  low: 'Low reliance',
};

export const RELIANCE_MEANINGS: Record<Reliance, string> = {
  high: 'Held in nearly every seeded run, and cited passages support the actors it is about.',
  moderate:
    'Held in most seeded runs, or held in nearly all but rests on assumptions with no cited passage.',
  low: 'Not stable across seeded runs, or nothing cited supports it.',
};

export const STABILITY_LABELS: Record<StabilityClass, string> = {
  repeatable: 'repeatable',
  'mostly-repeatable': 'mostly repeatable',
  unstable: 'unstable',
  rare: 'rare',
};

/** Anchor of a section of the brief on the page. */
export const sectionAnchor = (id: BriefSectionId): string => `brief-${id}`;

/** A mean number of simulated members: whole above ten, one decimal place below. */
export const approx = (value: number): string =>
  value >= 10 ? String(Math.round(value)) : String(Number(value.toFixed(1)));

export const signedNumber = (value: number, digits = 2): string => {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
};

export const hasRefs = (refs: BriefRefs): boolean =>
  refs.evidence.length +
    refs.stakeholderIds.length +
    refs.findingIds.length +
    refs.sensitivityIds.length +
    refs.critiqueIds.length +
    refs.assumptions.length +
    refs.documentIds.length +
    refs.variantIds.length >
  0;

export const DIRECTION_LABELS = {
  harmed: 'Harmed by the change',
  benefited: 'Benefits from the change',
  mixed: 'Mixed effect',
  unclear: 'Effect unclear',
} as const;

export const CLASSIFICATION_LABELS = {
  'assumption-sensitive': 'Sensitive to this assumption',
  robust: 'Robust to it',
  inconclusive: 'Inconclusive',
} as const;
