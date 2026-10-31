import type { BriefRefs, StatementOrigin } from '../../../shared/brief.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import type { SensitivityRow, StabilityClass } from '../../../shared/analysis.js';
import type { Actor } from '../../../shared/stakeholders.js';
import type { EvidenceOrigin } from './evidence.js';

/**
 * What each origin has to rest on. A statement whose origin names a kind of support it does not have
 * is never shown under that origin: the builder gives it the origin it can stand behind instead.
 */
export const ORIGIN_NEEDS: Record<StatementOrigin, string> = {
  'supplied-evidence': 'a cited passage or a source document',
  'retrieved-public-evidence': 'a cited passage or a source document',
  'historical-comparison': 'a cited passage or a source document',
  'user-assumption': 'the assumption itself',
  'system-assumption': 'the assumption itself',
  'inferred-stakeholder': 'a stakeholder',
  'actor-behavior': 'a stakeholder or a finding',
  'simulation-aggregation': 'a finding, a sensitivity row or the runs of a variant',
  'model-interpretation': 'a finding',
  'unresolved-uncertainty': 'nothing: it names what is not known',
};

const REQUIRED: Record<StatementOrigin, (refs: BriefRefs) => boolean> = {
  'supplied-evidence': (refs) => refs.evidence.length > 0 || refs.documentIds.length > 0,
  'retrieved-public-evidence': (refs) => refs.evidence.length > 0 || refs.documentIds.length > 0,
  'historical-comparison': (refs) => refs.evidence.length > 0 || refs.documentIds.length > 0,
  'user-assumption': (refs) => refs.assumptions.length > 0,
  'system-assumption': (refs) => refs.assumptions.length > 0,
  'inferred-stakeholder': (refs) => refs.stakeholderIds.length > 0,
  'actor-behavior': (refs) => refs.stakeholderIds.length > 0 || refs.findingIds.length > 0,
  'simulation-aggregation': (refs) =>
    refs.findingIds.length > 0 || refs.sensitivityIds.length > 0 || refs.variantIds.length > 0,
  'model-interpretation': (refs) => refs.findingIds.length > 0,
  'unresolved-uncertainty': () => true,
};

export const refsSatisfyOrigin = (origin: StatementOrigin, refs: BriefRefs): boolean =>
  REQUIRED[origin](refs);

export type Reliance = 'high' | 'moderate' | 'low';

/**
 * How far to rely on a statement that rests on a finding. The finding's class already says how often
 * it held across seeded runs; a repeatable finding about actors nothing cited supports is held at
 * moderate, since repeating the same assumptions many times shows they are consistent, not that
 * they are right.
 */
export function relianceOfFinding(classification: StabilityClass, evidenced: boolean): Reliance {
  if (classification === 'repeatable') return evidenced ? 'high' : 'moderate';
  if (classification === 'mostly-repeatable') return 'moderate';
  return 'low';
}

const ORDER: Record<Reliance, number> = { low: 0, moderate: 1, high: 2 };

/** A statement is only as reliable as the least reliable thing it rests on. */
export function weakestReliance(values: readonly Reliance[]): Reliance | null {
  return values.reduce<Reliance | null>(
    (weakest, value) => (weakest === null || ORDER[value] < ORDER[weakest] ? value : weakest),
    null,
  );
}

/** For a statement about a stakeholder: cited support counts for it, and a contradicting passage against. */
export function relianceOfEvidence(supporting: number, contradicting: number): Reliance {
  if (contradicting > 0 || supporting === 0) return 'low';
  return 'moderate';
}

/**
 * The origin of a statement about an assumption the runs moved. An assumption labelled as resting on
 * evidence is shown as evidence only when a passage is actually cited; a model's proposal that no one
 * has changed, and a setting of the scenario, are Swarm's assumptions and not findings.
 */
export function originOfSensitivity(
  row: SensitivityRow,
  evidence: readonly EvidenceRef[],
  originOf: (ref: EvidenceRef) => EvidenceOrigin,
): StatementOrigin {
  if (row.assumptionOrigin === 'user') return 'user-assumption';
  if (row.assumptionOrigin === 'evidence') {
    const first = evidence.find((ref) => ref.role === 'supports') ?? evidence[0];
    return first ? originOf(first) : 'unresolved-uncertainty';
  }
  return 'system-assumption';
}

/** An actor is read as harmed or benefited by the change when its impact setting is at least this far from 0. */
export const DIRECTION_CUT = 0.2;

export type Direction = 'harmed' | 'benefited' | 'neutral';

export function directionOf(actor: Actor): Direction {
  const impact = actor.traits.impact.value;
  if (impact <= -DIRECTION_CUT) return 'harmed';
  if (impact >= DIRECTION_CUT) return 'benefited';
  return 'neutral';
}

export type Level = 'low' | 'medium' | 'high';

/**
 * Impact is the size of a simulated shift, read on the scale it was measured in: the share of a
 * group's simulated members who moved, or a change in stance on the -1 to 1 scale. At least 0.3 is
 * high and at least 0.1 is medium. It describes the simulation's effect, not a forecast of one.
 */
export const IMPACT_CUTS = { high: 0.3, medium: 0.1 } as const;

export const levelOfSize = (size: number): Level =>
  size >= IMPACT_CUTS.high ? 'high' : size >= IMPACT_CUTS.medium ? 'medium' : 'low';

export const LEVEL_WEIGHT: Record<Level, number> = { low: 1, medium: 2, high: 3 };
