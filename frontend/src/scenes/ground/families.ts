import { BookOpenCheck, CircleDashed, Lightbulb, Orbit } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { STATEMENT_TYPE_LABELS, type StatementType } from '../../../../shared/evidence';

/**
 * The four kinds of thing a page can say, so that a person can tell at a glance what they are reading without
 * reading how it was made: what the sources say, what was assumed, what the simulation did, and what was concluded.
 * Each of the ledger's ten statement types belongs to one.
 */
export type StatementFamily = 'fact' | 'assumption' | 'simulation' | 'interpretation';

export const FAMILY_ORDER: readonly StatementFamily[] = [
  'fact',
  'assumption',
  'simulation',
  'interpretation',
];

export const FAMILY_LABEL: Record<StatementFamily, string> = {
  fact: 'Fact',
  assumption: 'Assumption',
  simulation: 'Simulation observation',
  interpretation: 'Interpretation',
};

/** What each kind means, in a line: shown on hover and in the key, never needed to read the page. */
export const FAMILY_HELP: Record<StatementFamily, string> = {
  fact: 'Something a source says, quoted or pointed to.',
  assumption: 'Something taken as given, or not yet known.',
  simulation: 'Something that happened inside a simulated run.',
  interpretation: 'Something concluded or suggested from the rest.',
};

export const FAMILY_ICON: Record<StatementFamily, LucideIcon> = {
  fact: BookOpenCheck,
  assumption: CircleDashed,
  simulation: Orbit,
  interpretation: Lightbulb,
};

const FAMILY_OF: Record<StatementType, StatementFamily> = {
  'source-fact': 'fact',
  'extracted-claim': 'fact',
  'contradicting-evidence': 'fact',
  'user-assumption': 'assumption',
  'unresolved-uncertainty': 'assumption',
  'simulated-event': 'simulation',
  'inferred-relationship': 'interpretation',
  'ai-hypothesis': 'interpretation',
  'analytical-conclusion': 'interpretation',
  recommendation: 'interpretation',
};

export const familyOf = (type: StatementType): StatementFamily => FAMILY_OF[type];

/** A type whose own name only repeats its kind is not said twice: the kind is, and the type is left to a screen reader. */
export const repeatsFamily = (type: StatementType): boolean =>
  STATEMENT_TYPE_LABELS[type].toLowerCase().endsWith(FAMILY_LABEL[FAMILY_OF[type]].toLowerCase());
