import type { Analysis, SensitivityRow } from '../../../shared/analysis.js';
import type { BriefRefs, StatementOrigin } from '../../../shared/brief.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import { TRAIT_KEYS, type Actor, type Trait, type TraitKey } from '../../../shared/stakeholders.js';
import type { EvidenceIndex } from './evidence.js';
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

function describeOrigin(origin: StatementOrigin, traitOrigin: Trait['origin'] | null): string {
  if (origin === 'user-assumption') return 'a person set it';
  if (origin === 'unresolved-uncertainty') {
    return 'it is labelled as resting on evidence, but no passage is cited for it';
  }
  if (origin === 'supplied-evidence' || origin === 'retrieved-public-evidence') {
    return 'it rests on a cited passage';
  }
  return traitOrigin === 'model'
    ? 'a model proposed it and no person has changed it'
    : 'Swarm filled it in as a default and it is open to edit';
}

export const effectOf = (row: SensitivityRow): string =>
  `moving it by ${signed(row.perturbation)} changed ${embed(row.metric, 80)} by ${signed(row.shift)} (standard error ${decimals(row.standardError)}) on the same seeds`;

/** The actor an assumption belongs to, the passages cited for it, and whether the assumption is evidenced. */
export function sensitivityContext(
  row: SensitivityRow,
  analysis: Analysis,
  evidence: EvidenceIndex,
): { actor: Actor | undefined; refs: EvidenceRef[]; origin: StatementOrigin; evidenced: boolean } {
  const actor = analysis.actors.find((candidate) => candidate.id === row.target.actorId);
  const refs = actor ? evidence.forActor(actor) : evidence.all();
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
  const sensitive = row.classification === 'assumption-sensitive';
  let subject: string;
  let value: string | null = null;
  if (row.target.kind === 'trait' && actor && trait) {
    subject = `${embed(actor.name, 60)}: ${traitLabel(row.target.trait ?? '')} is set at ${decimals(trait.value)}`;
    value = decimals(trait.value);
  } else if (row.target.kind === 'population' && actor) {
    subject = `${embed(actor.name, 60)} stands for a population of ${actor.size}, which is an assumption and not a count`;
    value = String(actor.size);
  } else {
    subject = embed(row.label, 160);
  }
  const verdict = sensitive
    ? 'The simulated result is sensitive to it.'
    : row.classification === 'robust'
      ? 'Moving it did not change the simulated result by more than its noise.'
      : 'Whether moving it matters could not be settled from these runs.';
  return {
    id: `sensitivity-${row.id}`,
    text: `${subject} (${describeOrigin(origin, trait?.origin ?? null)}). ${verdict} Moving it: ${effectOf(row)}.`,
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
    const cited = analysis.actors.flatMap((actor) => evidence.forActor(actor));
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
