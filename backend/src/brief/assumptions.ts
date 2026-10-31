import type { Analysis, SensitivityRow } from '../../../shared/analysis.js';
import type { BriefRefs, StatementOrigin } from '../../../shared/brief.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import {
  TRAIT_KEYS,
  directionOrigin,
  type Actor,
  type Trait,
  type TraitKey,
  type TraitOrigin,
} from '../../../shared/stakeholders.js';
import type { EvidenceIndex } from './evidence.js';
import { ROBUST_SHIFT } from '../analysis/sensitivity.js';
import { originOfSensitivity } from './rules.js';
import { decimals, embed, plural, signed, traitLabel } from './text.js';

/** One assumption the simulated result rests on, with where it came from and whether it matters. */
export interface AssumptionRow {
  id: string;
  /** The whole statement, as the brief shows it. */
  text: string;
  /** The value assumed, when it is a number or a short setting. */
  value: string | null;
  origin: StatementOrigin;
  /** The result moved by more than its noise when this assumption was moved. */
  sensitive: boolean;
  /** A cited passage backs it. */
  evidenced: boolean;
  /** What moving it did to the outcome, when it was moved. */
  effect: string | null;
  refs: Partial<BriefRefs>;
}

const TRAIT_SET: ReadonlySet<string> = new Set(TRAIT_KEYS);

function traitOf(actor: Actor | undefined, key: string | null): Trait | null {
  if (!actor || !key || !TRAIT_SET.has(key)) return null;
  return actor.traits[key as TraitKey];
}

/** What an actor's stakeholder cites now, or what the actor itself cites when the brief has no such stakeholder. */
const citedNow = (actor: Actor, evidence: EvidenceIndex): EvidenceRef[] =>
  evidence.has(actor.stakeholderId)
    ? evidence.forStakeholder(actor.stakeholderId)
    : evidence.forActor(actor);

export interface DirectionBasis {
  origin: TraitOrigin;
  /** The direction is labelled as resting on evidence, but no passage is cited for it now. */
  lost: boolean;
}

/**
 * What the direction of an actor's impact rests on today. A label of evidence is a claim about
 * passages, so it is kept only while the actor's stakeholder still cites one that supports it; the
 * number itself is never evidence, whatever its direction rests on.
 */
export function directionBasis(actor: Actor, evidence: EvidenceIndex): DirectionBasis {
  const claimed = directionOrigin(actor.traits.impact);
  if (claimed !== 'evidence') return { origin: claimed, lost: false };
  return citedNow(actor, evidence).some((ref) => ref.role === 'supports')
    ? { origin: 'evidence', lost: false }
    : { origin: 'system-assumption', lost: true };
}

/** How a sentence about an actor's impact says where it comes from: the direction and the size are told apart. */
export function impactOwner(actor: Actor, evidence: EvidenceIndex): string {
  if (actor.traits.impact.origin === 'user') return 'set by a person';
  const direction = directionBasis(actor, evidence);
  if (direction.origin === 'evidence') {
    return 'the direction rests on a cited passage and the size is an assumption';
  }
  if (direction.lost) {
    return 'the direction is labelled as resting on evidence but no passage is cited for it now, and the size is an assumption';
  }
  return 'an assumption';
}

function describeOrigin(
  origin: StatementOrigin,
  traitOrigin: Trait['origin'] | null,
  direction: DirectionBasis | null,
): string {
  if (origin === 'user-assumption') return 'a person set it';
  if (origin === 'unresolved-uncertainty') {
    return 'it is labelled as resting on evidence, but no passage is cited for it';
  }
  if (origin === 'supplied-evidence' || origin === 'retrieved-public-evidence') {
    return 'it rests on a cited passage';
  }
  const own =
    traitOrigin === 'model'
      ? 'a model proposed it and no person has changed it'
      : 'Swarm filled it in as a default and it is open to edit';
  if (direction?.origin === 'evidence') {
    return `${own}; only its direction rests on a cited passage, which gives no size`;
  }
  if (direction?.lost) {
    return `${own}; its direction was labelled as resting on evidence, but no passage is cited for it now`;
  }
  return own;
}

export const effectOf = (row: SensitivityRow): string =>
  `moving it by ${signed(row.perturbation)} changed ${embed(row.metric, 100)} by ${signed(row.shift)} (standard error ${decimals(row.standardError)}) on the same seeds`;

/**
 * The actor an assumption belongs to, the passages cited for it now, and whether the assumption is
 * evidenced. A label of evidence stands only for a passage that is cited today.
 */
export function sensitivityContext(
  row: SensitivityRow,
  analysis: Analysis,
  evidence: EvidenceIndex,
): { actor: Actor | undefined; refs: EvidenceRef[]; origin: StatementOrigin; evidenced: boolean } {
  const actor = analysis.actors.find((candidate) => candidate.id === row.target.actorId);
  const refs = actor ? citedNow(actor, evidence) : evidence.all();
  return {
    actor,
    refs,
    origin: originOfSensitivity(row, refs, evidence.originOf),
    evidenced: row.assumptionOrigin === 'evidence' && refs.length > 0,
  };
}

function sensitivityRow(
  row: SensitivityRow,
  analysis: Analysis,
  evidence: EvidenceIndex,
): AssumptionRow {
  const { actor, refs, origin, evidenced } = sensitivityContext(row, analysis, evidence);
  const trait = row.target.kind === 'trait' ? traitOf(actor, row.target.trait) : null;
  const direction = actor && row.target.trait === 'impact' ? directionBasis(actor, evidence) : null;
  const sensitive = row.classification === 'assumption-sensitive';
  let subject: string;
  let value: string | null = null;
  if (row.target.kind === 'trait' && actor && trait) {
    // A scenario can set the value itself (an override or an edit): that value is what the runs used, not the actor's own.
    const governing = row.setting?.value ?? trait.value;
    const setBy = row.setting
      ? `, as the proposed change sets it (the actor itself carries ${decimals(trait.value)}, which the runs did not use)`
      : '';
    subject = `${embed(actor.name, 60)}: ${traitLabel(row.target.trait ?? '')} is set at ${decimals(governing)}${setBy}`;
    value = decimals(governing);
  } else if (row.target.kind === 'population' && actor) {
    // What is moved is how varied the members of the group are (the spread of every trait), not how many it stands for.
    subject = `${embed(actor.name, 60)}: how varied its members are (the spread of every trait, ${row.perturbation > 0 ? 'twice' : 'half'} as wide when it was moved) is an assumption and not a measurement`;
    value = null;
  } else {
    subject = embed(row.label, 160);
  }
  const verdict = sensitive
    ? 'The simulated result is sensitive to it.'
    : row.classification === 'robust'
      ? `Moving it changed the simulated result by less than ${ROBUST_SHIFT} (the size too small to matter for a decision), measured closely; that is not the same as no change.`
      : 'Whether moving it matters could not be settled from these runs.';
  return {
    id: `sensitivity-${row.id}`,
    text: `${subject} (${describeOrigin(origin, trait?.origin ?? null, direction)}). ${verdict} Moving it: ${effectOf(row)}.`,
    value,
    origin,
    sensitive,
    evidenced,
    effect: effectOf(row),
    refs: {
      sensitivityIds: [row.id],
      assumptions: [subject],
      evidence: evidenced ? refs.slice(0, 4) : [],
      stakeholderIds: actor ? [actor.stakeholderId] : [],
    },
  };
}

const SENSITIVITY_ORDER = { 'assumption-sensitive': 0, inconclusive: 1, robust: 2 } as const;

/**
 * The assumptions the result rests on, the ones the result is sensitive to first: what the runs
 * moved, then what the scenario states, then the size of every population and a count of the rest
 * by who set them. Both the brief and its assumption table are made from these rows.
 */
export function assumptionRows(input: {
  analysis: Analysis;
  scenario: ScenarioFrame | null;
  evidence: EvidenceIndex;
}): AssumptionRow[] {
  const { analysis, scenario, evidence } = input;
  const rows: AssumptionRow[] = [...analysis.sensitivity]
    .sort(
      (a, b) =>
        SENSITIVITY_ORDER[a.classification] - SENSITIVITY_ORDER[b.classification] ||
        Math.abs(b.shift) - Math.abs(a.shift) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, 14)
    .map((row) => sensitivityRow(row, analysis, evidence));

  for (const assumption of scenario?.assumptions ?? []) {
    const origin: StatementOrigin =
      assumption.origin === 'user' ? 'user-assumption' : 'system-assumption';
    const owner =
      origin === 'user-assumption'
        ? 'written or accepted by a person'
        : 'filled in by Swarm and open to edit';
    rows.push({
      id: `scenario-${assumption.id}`,
      text: `Scenario assumption ${embed(assumption.text, 300)} (${owner}).`,
      value: null,
      origin,
      sensitive: false,
      evidenced: false,
      effect: null,
      refs: { assumptions: [assumption.text] },
    });
  }

  const sized = analysis.actors.filter((actor) => actor.size > 1);
  if (sized.length > 0) {
    const shown = sized
      .slice(0, 4)
      .map((actor) => `${embed(actor.name, 40)} ${actor.size}`)
      .join(', ');
    const more = sized.length > 4 ? `, and ${sized.length - 4} more` : '';
    rows.push({
      id: 'population-sizes',
      text: `Population sizes are assumptions used to weight each group, not counts of real people: ${shown}${more}.`,
      value: null,
      origin: 'system-assumption',
      sensitive: false,
      evidenced: false,
      effect: null,
      refs: { assumptions: ['Population sizes are assumptions, not counts.'] },
    });
  }

  const tally = { user: 0, 'system-assumption': 0, model: 0, evidence: 0 };
  for (const actor of analysis.actors) {
    for (const key of TRAIT_KEYS) tally[actor.traits[key].origin] += 1;
  }
  const total = tally.user + tally['system-assumption'] + tally.model + tally.evidence;
  const summary: { key: string; what: string; origin: StatementOrigin; count: number }[] = [
    {
      key: 'default',
      what: 'were filled in by Swarm as defaults',
      origin: 'system-assumption',
      count: tally['system-assumption'],
    },
    {
      key: 'model',
      what: 'were proposed by a model and not changed by a person',
      origin: 'system-assumption',
      count: tally.model,
    },
    { key: 'person', what: 'were set by a person', origin: 'user-assumption', count: tally.user },
  ];
  for (const { key, what, origin, count } of summary) {
    if (count === 0) continue;
    rows.push({
      id: `traits-${key}`,
      text: `${count} of ${total} trait ${plural(total, 'value')} across the simulated actors ${what}; the technical appendix lists every one.`,
      value: String(count),
      origin,
      sensitive: false,
      evidenced: false,
      effect: null,
      refs: { assumptions: [`${count} of ${total} trait values ${what}`] },
    });
  }
  if (tally.evidence > 0) {
    const cited = analysis.actors
      .filter((actor) => TRAIT_KEYS.some((key) => actor.traits[key].origin === 'evidence'))
      .flatMap((actor) => citedNow(actor, evidence));
    const first = cited.find((ref) => ref.role === 'supports') ?? cited[0];
    rows.push({
      id: 'traits-evidence',
      text: first
        ? `${tally.evidence} of ${total} trait values are labelled as resting on evidence, and passages are cited for the actors concerned; a cited passage shows where a value came from, not that the value is right.`
        : `${tally.evidence} of ${total} trait values are labelled as resting on evidence, but no passage is cited for any actor, so none is shown as evidence.`,
      value: String(tally.evidence),
      origin: first ? evidence.originOf(first) : 'unresolved-uncertainty',
      sensitive: false,
      evidenced: first !== undefined,
      effect: null,
      refs: {
        assumptions: [`${tally.evidence} trait values are labelled as resting on evidence`],
        evidence: cited.slice(0, 4),
      },
    });
  }
  return rows;
}
