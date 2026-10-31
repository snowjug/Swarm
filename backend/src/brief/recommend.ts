import type { Finding } from '../../../shared/analysis.js';
import type { Recommendation } from '../../../shared/brief.js';
import { CRITIC_ROLE_LABELS } from '../../../shared/critique.js';
import {
  EXTERNAL_RESPONDER_CATEGORIES,
  type Actor,
  type StakeholderCategory,
} from '../../../shared/stakeholders.js';
import type { Facts } from './facts.js';
import { pairRuns } from './measures.js';
import { LEVEL_WEIGHT, directionOf, levelOfSize } from './rules.js';
import { approx, clip, embed, listed, plural, signed, traitLabel } from './text.js';
import {
  UNSTABLE_CHECK,
  checkForSensitivity,
  fill,
  gapCheckFor,
  unevidencedKeyActors,
  weakFindings,
} from './validation.js';

/**
 * Recommendations follow from findings by a few generic rules, none of which knows what the scenario
 * is about:
 *  - an adverse, repeatable finding for a harmed group: mitigate, or stage the change;
 *  - an assumption the result is sensitive to that nothing cited backs: validate it first;
 *  - key actors, or evidence the question itself named, that nothing cited supports: collect evidence;
 *  - a repeatable event from an actor outside the organisation: prepare a response;
 *  - an unstable finding: repeat the analysis before relying on it;
 *  - a favourable, repeatable finding for a benefited group: build on it;
 *  - open serious critiques: resolve them first.
 * The order is impact times repeatability divided by effort (`rank`).
 */

export const OWNER_BY_CATEGORY: Record<StakeholderCategory, string> = {
  'decision-maker': 'leadership',
  'end-user': 'product',
  'cost-bearer': 'finance',
  'risk-bearer': 'operations',
  beneficiary: 'product',
  influencer: 'communications',
  competitor: 'strategy',
  substitute: 'strategy',
  partner: 'partnerships',
  channel: 'partnerships',
  regulator: 'legal and compliance',
  governance: 'legal and compliance',
  operations: 'operations',
  other: 'product',
};

export type RecommendationKind =
  | 'mitigate'
  | 'validate'
  | 'collect-evidence'
  | 'prepare-response'
  | 'repeat'
  | 'build-on'
  | 'resolve-critiques';

export interface Candidate extends Omit<Recommendation, 'id' | 'priority'> {
  kind: RecommendationKind;
  /** The best lower bound of the Wilson interval among the findings the recommendation follows from. */
  repeatability: number;
}

/**
 * The ordering rule: impact (low 1, medium 2, high 3) times repeatability (the largest lower bound
 * of the interval of any finding it follows from, from 0 to 1) divided by effort (low 1, medium 2,
 * high 3). Ties go to the higher impact, then the lower effort, then the order they were found in.
 */
export const rank = (candidate: Pick<Candidate, 'impact' | 'effort' | 'repeatability'>): number =>
  (LEVEL_WEIGHT[candidate.impact] * candidate.repeatability) / LEVEL_WEIGHT[candidate.effort];

export const ORDERING_RULE =
  'Recommendations are ordered by impact times repeatability divided by effort. Impact is the size of the simulated shift (at least 0.3 is high, at least 0.1 is medium). Repeatability is the largest lower bound of the Wilson interval among the findings a recommendation follows from. Effort is a generic planning default for the kind of action. Ties go to the higher impact, then the lower effort.';

const lowerBound = (findings: readonly Finding[]): number =>
  findings.reduce((best, finding) => Math.max(best, finding.interval.lo), 0);

const repeatable = (finding: Finding): boolean =>
  finding.classification === 'repeatable' || finding.classification === 'mostly-repeatable';

const idsOf = (findings: readonly Finding[]): string[] =>
  [...new Set(findings.map((finding) => finding.id))].slice(0, 4);

const ownerOf = (actor: Actor): string => OWNER_BY_CATEGORY[actor.category];

function mitigations(facts: Facts): Candidate[] {
  const { baseline, analysis } = facts;
  if (!baseline) return [];
  const found: Candidate[] = [];
  const done = new Set<string>();
  const adverse = analysis.findings
    .filter(
      (finding) =>
        finding.actorId !== null &&
        repeatable(finding) &&
        (finding.kind === 'majority-response' || finding.kind === 'direction-vs-baseline'),
    )
    .sort((a, b) => b.interval.lo - a.interval.lo || (a.id < b.id ? -1 : 1));
  for (const finding of adverse) {
    const actor = facts.actorById.get(finding.actorId ?? '');
    const variant = facts.measures.find((measure) => measure.variant.id === finding.variantId);
    if (!actor || !variant || variant.variant.kind !== 'alternative') continue;
    if (directionOf(actor) !== 'harmed' || done.has(`${actor.id}|${variant.variant.id}`)) continue;
    const pairing = pairRuns(variant.runs, baseline.runs, actor.id);
    const members =
      variant.runs[0]?.byActor.find((entry) => entry.actorId === actor.id)?.members ?? 0;
    if (pairing.pairs === 0 || pairing.adverseDelta <= 0 || members === 0) continue;
    done.add(`${actor.id}|${variant.variant.id}`);
    const related = analysis.findings.filter(
      (candidate) => candidate.actorId === actor.id && candidate.variantId === variant.variant.id,
    );
    found.push({
      kind: 'mitigate',
      text: `Mitigate or stage the change for ${embed(actor.name, 60)}: about ${approx(pairing.adverseDelta)} more of its ${members} simulated members ended up looking for an alternative or resisting under ${embed(variant.variant.label, 60)} than under ${embed(baseline.variant.label, 60)}, and the finding held in ${finding.holdsIn} of ${finding.of} seeded runs.`,
      linkedFindingIds: idsOf([finding, ...related]),
      impact: levelOfSize(pairing.adverseDelta / members),
      effort: 'medium',
      reversibility: 'easy',
      horizon: 'Before committing, then through a staged rollout',
      ownerFunction: ownerOf(actor),
      leadingIndicators: [
        'Members of the affected group who ask to change or leave in the first weeks of a staged rollout, against a comparison group.',
        'Contact and complaint volumes from the affected group, against the weeks before the change.',
      ],
      assumptions: analysis.sensitivity
        .filter(
          (row) => row.target.actorId === actor.id && row.classification === 'assumption-sensitive',
        )
        .map((row) => row.label)
        .slice(0, 3),
      validation: `Stage the change with a small group drawn from ${embed(actor.name, 60)}, compare their measured reaction with the simulated one, and adjust or stop before a wider rollout.`,
      repeatability: lowerBound([finding]),
    });
  }
  return found.slice(0, 4);
}

function validations(facts: Facts): Candidate[] {
  const { analysis } = facts;
  const headline = facts.headline?.finding ? [facts.headline.finding] : [];
  const rows = analysis.sensitivity
    .filter(
      (row) => row.classification === 'assumption-sensitive' && row.assumptionOrigin !== 'evidence',
    )
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift) || (a.id < b.id ? -1 : 1))
    .slice(0, 4);
  const found: Candidate[] = [];
  for (const row of rows) {
    const actor = row.target.actorId ? facts.actorById.get(row.target.actorId) : undefined;
    const own = actor ? analysis.findings.filter((finding) => finding.actorId === actor.id) : [];
    const linked =
      own.length > 0 ? own : headline.length > 0 ? headline : analysis.findings.slice(0, 1);
    if (linked.length === 0) continue;
    const { check, group, value } = checkForSensitivity(row, actor);
    const subject =
      row.target.kind === 'trait' && actor
        ? `${embed(actor.name, 60)}: ${traitLabel(row.target.trait ?? '')}`
        : embed(row.label, 100);
    found.push({
      kind: 'validate',
      text: `Validate the assumption ${subject} before committing: moving it by ${signed(row.perturbation)} changed the simulated measure ${embed(row.metric, 60)} by ${signed(row.shift)}, and no cited passage backs it.`,
      linkedFindingIds: idsOf(linked),
      impact: levelOfSize(Math.abs(row.shift)),
      effort: check.effort,
      reversibility: 'easy',
      horizon: 'Before committing',
      ownerFunction: 'research and analytics',
      leadingIndicators: [
        clip(`${check.measure}, against the assumed value${value ? ` of ${value}` : ''}.`, 200),
      ],
      assumptions: [clip(subject, 300)],
      validation: clip(
        `${fill(check.method, group, value)} ${fill(check.successSignal, group, value)}`,
        400,
      ),
      repeatability: lowerBound(linked),
    });
  }
  return found;
}

function evidenceGaps(facts: Facts): Candidate[] {
  const { analysis } = facts;
  const found: Candidate[] = [];
  const headline = facts.headline?.finding
    ? [facts.headline.finding]
    : analysis.findings.slice(0, 1);
  const missing = unevidencedKeyActors(facts);
  if (missing.length > 0) {
    const own = analysis.findings.filter((finding) =>
      missing.some((actor) => actor.id === finding.actorId),
    );
    const linked = own.length > 0 ? own : headline;
    if (linked.length > 0) {
      const names = listed(missing.slice(0, 4).map((actor) => embed(actor.name, 40)));
      found.push({
        kind: 'collect-evidence',
        text: `Collect evidence for ${missing.length} ${plural(missing.length, 'actor')} that no cited passage supports (${names}${missing.length > 4 ? ' and others' : ''}): their simulated responses rest on declared assumptions alone.`,
        linkedFindingIds: idsOf(linked),
        impact: own.some(repeatable) ? 'medium' : 'low',
        effort: 'medium',
        reversibility: 'easy',
        horizon: 'Before relying on the result',
        ownerFunction: 'research and analytics',
        leadingIndicators: [
          'Cited passages attached to each of these actors, and the analysis run again.',
        ],
        assumptions: [],
        validation: fill(
          gapCheckFor(missing[0]?.category ?? 'other').method,
          'the groups concerned',
        ),
        repeatability: lowerBound(linked),
      });
    }
  }
  const named = facts.scenario?.evidenceMissing ?? [];
  if (named.length > 0 && headline.length > 0) {
    found.push({
      kind: 'collect-evidence',
      text: `Close the ${named.length} evidence ${plural(named.length, 'gap')} the question itself names, such as ${embed(named[0] ?? '', 100)}, before relying on the simulated result.`,
      linkedFindingIds: idsOf(headline),
      impact: 'medium',
      effort: 'medium',
      reversibility: 'easy',
      horizon: 'Before relying on the result',
      ownerFunction: 'research and analytics',
      leadingIndicators: ['Each named gap closed with a cited source, and the analysis run again.'],
      assumptions: [],
      validation:
        'Find or commission a source for each named gap, add it to the project, and run the analysis again to see whether the result moves.',
      repeatability: lowerBound(headline),
    });
  }
  const open = (facts.ledger?.conflicts ?? []).filter(
    (conflict) => conflict.status === 'detected' || conflict.status === 'confirmed',
  );
  if (open.length > 0 && headline.length > 0) {
    found.push({
      kind: 'collect-evidence',
      text: `Resolve the ${open.length} open ${plural(open.length, 'conflict')} between sources, such as ${embed(open[0]?.topic ?? '', 80)}, before relying on the evidence behind the simulated result.`,
      linkedFindingIds: idsOf(headline),
      impact: 'medium',
      effort: 'low',
      reversibility: 'easy',
      horizon: 'Before relying on the result',
      ownerFunction: 'research and analytics',
      leadingIndicators: ['Each conflict confirmed, dismissed or resolved with a note.'],
      assumptions: [],
      validation:
        'Check each pair of conflicting passages against its original source, and record which one holds or that the difference is one of definition.',
      repeatability: lowerBound(headline),
    });
  }
  return found.slice(0, 3);
}

function responses(facts: Facts): Candidate[] {
  const found: Candidate[] = [];
  for (const finding of facts.analysis.findings) {
    if (finding.kind !== 'second-order-event' || finding.classification === 'rare') continue;
    const actor = facts.actorById.get(finding.actorId ?? '');
    if (!actor || !EXTERNAL_RESPONDER_CATEGORIES.includes(actor.category)) continue;
    found.push({
      kind: 'prepare-response',
      text: `Prepare a response to how ${embed(actor.name, 60)} could react: in simulated runs ${embed(finding.statement, 140)} held in ${finding.holdsIn} of ${finding.of} seeded runs.`,
      linkedFindingIds: [finding.id],
      impact: repeatable(finding) ? 'medium' : 'low',
      effort: 'medium',
      reversibility: 'moderate',
      horizon: 'Before announcing the change',
      ownerFunction: ownerOf(actor),
      leadingIndicators: [
        `Any public move by ${embed(actor.name, 60)} after the change is announced, checked weekly.`,
      ],
      assumptions: [],
      validation: `Plan the response with the owner, and check it against what ${embed(actor.name, 60)} has done in comparable situations, using desk research or an expert review.`,
      repeatability: lowerBound([finding]),
    });
  }
  return found
    .sort((a, b) => b.repeatability - a.repeatability || (a.text < b.text ? -1 : 1))
    .slice(0, 3);
}

function repeats(facts: Facts): Candidate[] {
  const headlineVariant = facts.headline?.variant.variant.id;
  return weakFindings(facts)
    .slice(0, 2)
    .map((finding): Candidate => ({
      kind: 'repeat',
      text: `Do not decide on the unstable simulated result ${embed(finding.statement, 140)}, which held in ${finding.holdsIn} of ${finding.of} seeded runs: repeat the analysis with more runs, or narrow the question, before relying on it.`,
      linkedFindingIds: [finding.id],
      impact: finding.variantId === headlineVariant && finding.actorId === null ? 'high' : 'medium',
      effort: 'low',
      reversibility: 'easy',
      horizon: 'Before deciding',
      ownerFunction: 'research and analytics',
      leadingIndicators: [`${UNSTABLE_CHECK.measure}.`],
      assumptions: [],
      validation: clip(`${UNSTABLE_CHECK.method} ${UNSTABLE_CHECK.successSignal}`, 400),
      repeatability: lowerBound([finding]),
    }));
}

function opportunities(facts: Facts): Candidate[] {
  const { baseline, analysis } = facts;
  if (!baseline) return [];
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const ordered = [...analysis.findings].sort(
    (a, b) => b.interval.lo - a.interval.lo || (a.id < b.id ? -1 : 1),
  );
  for (const finding of ordered) {
    const actor = facts.actorById.get(finding.actorId ?? '');
    const variant = facts.measures.find((measure) => measure.variant.id === finding.variantId);
    if (!actor || !variant || variant.variant.kind !== 'alternative' || !repeatable(finding)) {
      continue;
    }
    if (directionOf(actor) !== 'benefited' || seen.has(actor.id)) continue;
    const pairing = pairRuns(variant.runs, baseline.runs, actor.id);
    if (pairing.pairs === 0 || pairing.stanceDelta <= 0) continue;
    seen.add(actor.id);
    found.push({
      kind: 'build-on',
      text: `Build on the favourable response of ${embed(actor.name, 60)}: its simulated members moved toward going along or accepting under ${embed(variant.variant.label, 60)} (mean final stance ${signed(pairing.stanceDelta)} against the baseline), and the finding held in ${finding.holdsIn} of ${finding.of} seeded runs.`,
      linkedFindingIds: [finding.id],
      impact: levelOfSize(pairing.stanceDelta),
      effort: 'low',
      reversibility: 'easy',
      horizon: 'At announcement',
      ownerFunction: ownerOf(actor),
      leadingIndicators: ['Take-up and positive feedback from this group in the first weeks.'],
      assumptions: [],
      validation: `Check with a small sample of ${embed(actor.name, 60)} that they see the benefit the simulation assumes, before making it a central message.`,
      repeatability: lowerBound([finding]),
    });
  }
  return found.slice(0, 2);
}

function critiqueActions(facts: Facts): Candidate[] {
  const serious = facts.critiques.filter(
    (critique) =>
      critique.status !== 'accepted' &&
      (critique.severity === 'major' || critique.severity === 'blocking'),
  );
  if (serious.length === 0) return [];
  const targeted = serious
    .filter((critique) => critique.target.kind === 'finding')
    .map((critique) => facts.findingById.get(critique.target.id))
    .filter((finding): finding is Finding => finding !== undefined);
  const fallback = facts.headline?.finding
    ? [facts.headline.finding]
    : facts.analysis.findings.slice(0, 1);
  const linked = targeted.length > 0 ? targeted : fallback;
  if (linked.length === 0) return [];
  const blocking = serious.some((critique) => critique.severity === 'blocking');
  const roles = [...new Set(serious.map((critique) => CRITIC_ROLE_LABELS[critique.role]))].slice(
    0,
    3,
  );
  return [
    {
      kind: 'resolve-critiques',
      text: `Resolve the ${serious.length} open ${blocking ? 'blocking or major' : 'major'} ${plural(serious.length, 'critique')} before relying on the simulated result: ${listed(roles)}.`,
      linkedFindingIds: idsOf(linked),
      impact: blocking ? 'high' : 'medium',
      effort: 'low',
      reversibility: 'easy',
      horizon: 'Before deciding',
      ownerFunction: 'research and analytics',
      leadingIndicators: ['Open serious critiques, counted again after each response.'],
      assumptions: [],
      validation:
        'Answer each critique, or change the analysis it points at, and record what still stands.',
      repeatability: lowerBound(linked),
    },
  ];
}

export const MAX_RECOMMENDATIONS = 12;

/** Every candidate the rules produce, best first, with a priority from 1 and an id that says so. */
export function recommend(facts: Facts): Recommendation[] {
  const candidates = [
    ...mitigations(facts),
    ...validations(facts),
    ...evidenceGaps(facts),
    ...responses(facts),
    ...repeats(facts),
    ...opportunities(facts),
    ...critiqueActions(facts),
  ].map((candidate, order) => ({ candidate, order }));
  return candidates
    .sort((a, b) => {
      // Scores that differ only by rounding are ties.
      const difference = rank(b.candidate) - rank(a.candidate);
      return (
        (Math.abs(difference) > 1e-9 ? difference : 0) ||
        LEVEL_WEIGHT[b.candidate.impact] - LEVEL_WEIGHT[a.candidate.impact] ||
        LEVEL_WEIGHT[a.candidate.effort] - LEVEL_WEIGHT[b.candidate.effort] ||
        a.order - b.order
      );
    })
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ candidate }, index): Recommendation => ({
      id: `rec-${index + 1}`,
      priority: index + 1,
      text: clip(candidate.text, 500),
      linkedFindingIds: candidate.linkedFindingIds,
      impact: candidate.impact,
      effort: candidate.effort,
      reversibility: candidate.reversibility,
      horizon: clip(candidate.horizon, 80),
      ownerFunction: clip(candidate.ownerFunction, 120),
      leadingIndicators: candidate.leadingIndicators.slice(0, 5).map((text) => clip(text, 200)),
      assumptions: candidate.assumptions.slice(0, 5).map((text) => clip(text, 300)),
      validation: clip(candidate.validation, 400),
    }));
}
