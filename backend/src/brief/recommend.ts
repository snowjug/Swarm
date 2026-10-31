import type { Finding } from '../../../shared/analysis.js';
import type { BriefRefs, Recommendation, StatementOrigin } from '../../../shared/brief.js';
import { CRITIC_ROLE_LABELS } from '../../../shared/critique.js';
import { EXTERNAL_RESPONDER_CATEGORIES, type Actor } from '../../../shared/stakeholders.js';
import type { Facts } from './facts.js';
import { groupShifts } from './measures.js';
import {
  LEVEL_WEIGHT,
  OWNER_BY_CATEGORY,
  directionOf,
  levelOfSize,
  type Reliance,
} from './rules.js';
import { approx, clip, embed, listed, plural, signed, traitLabel } from './text.js';
import {
  REPEAT_CHECK,
  checkForGap,
  checkForRow,
  openConflicts,
  rareFindings,
  unevidencedKeyActors,
  unstableFindings,
} from './validation.js';

/**
 * Recommendations follow from findings by a few generic rules, none of which knows what the scenario
 * is about:
 *  - an adverse, repeatable finding for a harmed group: mitigate, or stage the change;
 *  - an assumption the result is sensitive to that nothing cited backs: validate it first;
 *  - key actors, or evidence the question itself named, that nothing cited supports: collect evidence;
 *  - sources that disagree: get the underlying data from both owners;
 *  - a repeatable event from an actor outside the organisation: prepare a response;
 *  - a headline result that disagrees across seeded runs: repeat the analysis before relying on it;
 *  - a headline result that seldom or never held: do not plan around it, and test what keeps it away;
 *  - a favourable, repeatable finding for a benefited group: build on it;
 *  - open serious critiques: resolve them first.
 * The order is impact times repeatability divided by effort (`rank`).
 *
 * Each recommendation carries the origin it can stand behind. What follows from a count over seeded
 * runs is a simulation aggregation, with the reliance of the findings it rests on. What is about the
 * evidence, the assumptions or the critiques is unresolved uncertainty, rests on the ids of the
 * passages, actors or critiques it is about, and carries no reliance, because how often a stance
 * finding held says nothing about whether two sources agree.
 */

export { OWNER_BY_CATEGORY };

export type RecommendationKind =
  | 'say-direction'
  | 'mitigate'
  | 'validate'
  | 'collect-evidence'
  | 'resolve-conflicts'
  | 'prepare-response'
  | 'repeat'
  | 'rare'
  | 'build-on'
  | 'resolve-critiques';

export interface Candidate extends Omit<Recommendation, 'id' | 'priority'> {
  kind: RecommendationKind;
  /** The best lower bound of the Wilson interval among the findings the recommendation follows from. */
  repeatability: number;
  /** What the recommendation can stand behind, and the ids it rests on. */
  origin: StatementOrigin;
  refs: Partial<BriefRefs>;
  /** Carried only by what rests on findings; advice about evidence, assumptions or critiques has none. */
  reliance: Reliance | null;
  /** The quoted name of the group it is about, for the answer-first section. */
  subject: string | null;
}

/** A recommendation as the stored brief holds it, with what the rest of the brief needs to say about it. */
export interface Advice extends Candidate {
  recommendation: Recommendation;
}

/**
 * The ordering rule: impact (low 1, medium 2, high 3) times repeatability (the largest lower bound
 * of the interval of any finding it follows from, from 0 to 1) divided by effort (low 1, medium 2,
 * high 3). Ties go to the higher impact, then the lower effort, then the order they were found in.
 */
export const rank = (candidate: Pick<Candidate, 'impact' | 'effort' | 'repeatability'>): number =>
  (LEVEL_WEIGHT[candidate.impact] * candidate.repeatability) / LEVEL_WEIGHT[candidate.effort];

export const ORDERING_RULE =
  'Recommendations are ordered by impact times repeatability divided by effort. Impact is the size of the simulated shift (at least 0.3 is high, at least 0.1 is medium). Repeatability is the largest lower bound of the Wilson interval among the findings a recommendation follows from; advice about evidence, assumptions or critiques takes that of the headline result it protects. Effort is a generic planning default for the kind of action. Ties go to the higher impact, then the lower effort.';

/** Said after the ordering rule when the comparison could not tell the change from no change. */
export const LEAD_EXCEPTION =
  'The first recommendation comes first whatever its score, because nothing else in this brief can be read until it is done.';

/** The recommendation that comes first when no stakeholder has an expected direction of impact. */
export const SAY_DIRECTION =
  'Say who is helped or harmed by the change, in the stakeholder review, or read the evidence with a model, then run the comparison again: no stakeholder has an expected direction of impact, so the simulated comparison could not tell the change from no change.';

const lowerBound = (findings: readonly Finding[]): number =>
  findings.reduce((best, finding) => Math.max(best, finding.interval.lo), 0);

const repeatable = (finding: Finding): boolean =>
  finding.classification === 'repeatable' || finding.classification === 'mostly-repeatable';

const idsOf = (findings: readonly Finding[]): string[] =>
  [...new Set(findings.map((finding) => finding.id))].slice(0, 4);

const ownerOf = (actor: Actor): string => OWNER_BY_CATEGORY[actor.category];

/** The finding the answer is about, which advice about evidence or critiques bears on, or the first one there is. */
const headlineFindings = (facts: Facts): Finding[] =>
  facts.headline?.finding ? [facts.headline.finding] : facts.analysis.findings.slice(0, 1);

function mitigations(facts: Facts): Candidate[] {
  const { baseline, analysis, headline } = facts;
  if (!baseline || !headline) return [];
  // The groups the answer names, in the order it names them: the change that is proposed, not its siblings.
  const variant = headline.variant;
  if (variant.variant.kind !== 'alternative') return [];
  const found: Candidate[] = [];
  for (const shift of headline.groups) {
    if (shift.delta === null || shift.delta <= 0 || shift.members === 0) continue;
    const actor = facts.actorById.get(shift.actorId);
    if (!actor || directionOf(actor) !== 'harmed') continue;
    const related = analysis.findings.filter(
      (candidate) => candidate.actorId === actor.id && candidate.variantId === variant.variant.id,
    );
    // Advice about a group rests on a finding about that group that held in most seeded runs.
    const finding = related
      .filter(
        (candidate) =>
          repeatable(candidate) &&
          (candidate.kind === 'majority-response' || candidate.kind === 'direction-vs-baseline'),
      )
      .sort((a, b) => b.interval.lo - a.interval.lo || (a.id < b.id ? -1 : 1))[0];
    if (!finding) continue;
    const runs = variant.runs.length;
    const here = embed(variant.variant.label, 60);
    const there = embed(baseline.variant.label, 60);
    const adverseWords = 'ended up looking for an alternative or resisting';
    let how: string;
    if (shift.members > 1) {
      how = `about ${approx(shift.delta * shift.members)} more of its ${shift.members} simulated members ${adverseWords} under ${here} than under ${there}`;
    } else if (shift.higherIn !== null && shift.pairs) {
      how = `its one simulated member ${adverseWords} more often under ${here} than under ${there}, in ${shift.higherIn} of ${shift.pairs} paired runs`;
    } else {
      // The runs kept no per-actor results, so only the means over them can be counted back.
      how = `its one simulated member ${adverseWords} in about ${Math.round(shift.share * runs)} of ${runs} seeded runs under ${here}, against ${Math.round((shift.baselineShare ?? 0) * runs)} under ${there}`;
    }
    const subject = embed(actor.name, 60);
    found.push({
      kind: 'mitigate',
      text: `Mitigate or stage the change for ${subject}: ${how}, and the finding held in ${finding.holdsIn} of ${finding.of} seeded runs.`,
      linkedFindingIds: idsOf([finding, ...related]),
      impact: levelOfSize(shift.delta),
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
      validation: `Stage the change with a small group drawn from ${subject}, compare what they do with a group that is not exposed, and adjust or stop before a wider rollout; decide beforehand what difference would make you stop.`,
      repeatability: lowerBound([finding]),
      origin: 'simulation-aggregation',
      refs: {
        findingIds: idsOf([finding, ...related]),
        stakeholderIds: [actor.stakeholderId],
        variantIds: [variant.variant.id, baseline.variant.id],
      },
      reliance: facts.relianceOf([finding, ...related.slice(0, 3)]),
      subject,
    });
  }
  return found.slice(0, 4);
}

function validations(facts: Facts): Candidate[] {
  const { analysis } = facts;
  const headline = headlineFindings(facts);
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
    const linked = own.length > 0 ? own : headline;
    if (linked.length === 0) continue;
    const check = checkForRow(facts, row, actor);
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
      leadingIndicators: [clip(`${check.measure}.`, 200)],
      assumptions: [clip(subject, 300)],
      validation: clip(`${check.method} ${check.decision}`, 400),
      repeatability: lowerBound(linked),
      // The sensitivity row is what it rests on; the findings are the result it bears on, not its premise.
      origin: 'simulation-aggregation',
      refs: { sensitivityIds: [row.id], assumptions: [clip(subject, 300)] },
      reliance: null,
      subject: actor ? embed(actor.name, 60) : null,
    });
  }
  return found;
}

function evidenceGaps(facts: Facts): Candidate[] {
  const found: Candidate[] = [];
  const headline = headlineFindings(facts);
  const missing = unevidencedKeyActors(facts);
  if (missing.length > 0) {
    const own = facts.analysis.findings.filter((finding) =>
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
        validation: clip(
          `${checkForGap(facts, missing[0]!).method} Attach what is found to the stakeholder record and run the analysis again.`,
          400,
        ),
        repeatability: lowerBound(linked),
        origin: 'unresolved-uncertainty',
        refs: { stakeholderIds: missing.slice(0, 8).map((actor) => actor.stakeholderId) },
        reliance: null,
        subject: null,
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
      origin: 'unresolved-uncertainty',
      refs: { assumptions: named.slice(0, 6) },
      reliance: null,
      subject: null,
    });
  }
  return found.slice(0, 3);
}

function conflicts(facts: Facts): Candidate[] {
  const open = openConflicts(facts);
  const headline = headlineFindings(facts);
  if (open.length === 0 || headline.length === 0) return [];
  const sources = open
    .slice(0, 2)
    .flatMap((conflict) => [conflict.left, conflict.right])
    .slice(0, 4);
  return [
    {
      kind: 'resolve-conflicts',
      text: `Resolve the ${open.length} open ${plural(open.length, 'conflict')} between sources, such as ${embed(open[0]?.topic ?? '', 80)}, by getting the underlying data from the owner of each source, before relying on the evidence behind the simulated result.`,
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
      origin: 'unresolved-uncertainty',
      refs: { evidence: sources },
      reliance: null,
      subject: null,
    },
  ];
}

/** Whether a finding is the better one to advise on than the one already held: the proposed change's, then the most repeatable. */
const preferred = (finding: Finding, held: Finding, proposed: string | null): boolean => {
  const own = finding.variantId === proposed;
  return own !== (held.variantId === proposed) ? own : finding.interval.lo > held.interval.lo;
};

function responses(facts: Facts): Candidate[] {
  const proposed = facts.headline?.variant.variant.id ?? null;
  // One piece of advice per outside actor.
  const chosen = new Map<string, Finding>();
  for (const finding of facts.analysis.findings) {
    if (finding.kind !== 'second-order-event' || !repeatable(finding)) continue;
    const actor = facts.actorById.get(finding.actorId ?? '');
    if (!actor || !EXTERNAL_RESPONDER_CATEGORIES.includes(actor.category)) continue;
    const held = chosen.get(actor.id);
    if (!held || preferred(finding, held, proposed)) chosen.set(actor.id, finding);
  }
  const found: Candidate[] = [];
  for (const [actorId, finding] of chosen) {
    const actor = facts.actorById.get(actorId);
    if (!actor) continue;
    const subject = embed(actor.name, 60);
    found.push({
      kind: 'prepare-response',
      text: `Prepare a response to how ${subject} could react: in simulated runs ${embed(finding.statement, 260)}. What would trigger it, and how soon, follows from assumed traits and is open to check in the world.`,
      linkedFindingIds: [finding.id],
      impact: 'medium',
      effort: 'medium',
      reversibility: 'moderate',
      horizon: 'Before announcing the change',
      ownerFunction: ownerOf(actor),
      leadingIndicators: [
        `Any public move by ${subject} after the change is announced, checked weekly.`,
      ],
      assumptions: [],
      validation: `Plan the response with the owner, and check it against what ${subject} has done in comparable situations, using desk research or an expert review.`,
      repeatability: lowerBound([finding]),
      origin: 'simulation-aggregation',
      refs: {
        findingIds: [finding.id],
        stakeholderIds: [actor.stakeholderId],
        variantIds: [finding.variantId],
      },
      reliance: facts.relianceOf([finding]),
      subject,
    });
  }
  return found
    .sort((a, b) => b.repeatability - a.repeatability || (a.text < b.text ? -1 : 1))
    .slice(0, 3);
}

/** A headline result that disagrees across seeded runs: run more of them. Only what the answer leans on. */
function repeats(facts: Facts): Candidate[] {
  return unstableFindings(facts)
    .slice(0, 2)
    .map((finding): Candidate => ({
      kind: 'repeat',
      text:
        finding.holdsIn === 0
          ? `The simulated result ${embed(finding.statement, 260)} held in none of ${finding.of} seeded runs, which is too few to call it rare: repeat the analysis with more runs before relying on its absence.`
          : `Do not decide on the unstable simulated result ${embed(finding.statement, 260)}, which held in ${finding.holdsIn} of ${finding.of} seeded runs: repeat the analysis with more runs, or narrow the question, before relying on it.`,
      linkedFindingIds: [finding.id],
      impact: finding.kind === 'direction-vs-baseline' ? 'high' : 'medium',
      effort: 'low',
      reversibility: 'easy',
      horizon: 'Before deciding',
      ownerFunction: 'research and analytics',
      leadingIndicators: [`${REPEAT_CHECK.measure}.`],
      assumptions: [],
      validation: clip(`${REPEAT_CHECK.method} ${REPEAT_CHECK.decision}`, 400),
      repeatability: lowerBound([finding]),
      origin: 'simulation-aggregation',
      refs: { findingIds: [finding.id], variantIds: [finding.variantId] },
      reliance: 'low',
      subject: null,
    }));
}

/** A headline result that seldom or never held: the runs agree that it is unusual, which is not the same as disagreeing. */
function rarities(facts: Facts): Candidate[] {
  return rareFindings(facts)
    .slice(0, 1)
    .map((finding): Candidate => ({
      kind: 'rare',
      text: `The simulated result ${embed(finding.statement, 230)} held in ${finding.holdsIn} of ${finding.of} seeded runs, so the runs agree that it is rare rather than disagree. Do not plan around it as likely, and do not read its absence as safety: test the assumptions that keep it from happening, such as the strength of the change.`,
      linkedFindingIds: [finding.id],
      impact: finding.kind === 'threshold-crossing' ? 'medium' : 'low',
      effort: 'low',
      reversibility: 'easy',
      horizon: 'Before relying on its absence',
      ownerFunction: 'research and analytics',
      leadingIndicators: [
        'The same result in a run with a stronger change, or with the assumptions it is sensitive to moved.',
      ],
      assumptions: [],
      validation:
        'Run the analysis again with the strength of the change and the assumptions it is sensitive to moved, and see whether the result stays rare.',
      repeatability: lowerBound([finding]),
      origin: 'simulation-aggregation',
      refs: { findingIds: [finding.id], variantIds: [finding.variantId] },
      reliance: facts.relianceOf([finding]),
      subject: null,
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
    const shift = groupShifts(variant, baseline).find((entry) => entry.actorId === actor.id);
    if (!shift || shift.stanceDelta === null || shift.stanceDelta <= 0) continue;
    seen.add(actor.id);
    const subject = embed(actor.name, 60);
    found.push({
      kind: 'build-on',
      text: `Build on the favourable response of ${subject}: its simulated members moved toward going along or accepting under ${embed(variant.variant.label, 60)} (mean final stance ${signed(shift.stanceDelta)} against the baseline), and the finding held in ${finding.holdsIn} of ${finding.of} seeded runs.`,
      linkedFindingIds: [finding.id],
      impact: levelOfSize(shift.stanceDelta),
      effort: 'low',
      reversibility: 'easy',
      horizon: 'At announcement',
      ownerFunction: ownerOf(actor),
      leadingIndicators: ['Take-up and positive feedback from this group in the first weeks.'],
      assumptions: [],
      validation: `Check with a small sample of ${subject} that they see the benefit the simulation assumes, before making it a central message.`,
      repeatability: lowerBound([finding]),
      origin: 'simulation-aggregation',
      refs: {
        findingIds: [finding.id],
        stakeholderIds: [actor.stakeholderId],
        variantIds: [variant.variant.id, baseline.variant.id],
      },
      reliance: facts.relianceOf([finding]),
      subject,
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
  const linked = targeted.length > 0 ? targeted : headlineFindings(facts);
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
      origin: 'unresolved-uncertainty',
      refs: { critiqueIds: serious.slice(0, 8).map((critique) => critique.id) },
      reliance: null,
      subject: null,
    },
  ];
}

export const MAX_RECOMMENDATIONS = 12;

/** Saying who is helped or harmed, linked to the finding the comparison could not tell apart. */
function sayDirection(facts: Facts): Candidate | null {
  const linked = facts.signal.finding ?? facts.analysis.findings[0] ?? null;
  if (!linked) return null;
  return {
    kind: 'say-direction',
    text: SAY_DIRECTION,
    linkedFindingIds: [linked.id],
    impact: 'high',
    effort: 'low',
    reversibility: 'easy',
    horizon: 'Before reading anything into the results',
    ownerFunction: 'research and analytics',
    leadingIndicators: ['Stakeholders with a stated direction of impact, out of all stakeholders.'],
    assumptions: [
      'Each stakeholder’s direction of impact is an assumption until a person or a model sets it.',
    ],
    validation:
      'Ask the stakeholders, or someone who knows each group, whether the change helps or harms it, record the direction in the stakeholder review, and run the comparison again.',
    repeatability: lowerBound([linked]),
    // Saying who is helped or harmed rests on an assumption, not on what the runs showed.
    origin: 'system-assumption',
    refs: {
      findingIds: [linked.id],
      assumptions: [
        'Each stakeholder’s direction of impact is an assumption until a person or a model sets it.',
      ],
    },
    reliance: null,
    subject: null,
  };
}

/**
 * Every candidate the rules produce, best first, with a priority from 1 and an id that says so. When
 * the comparison could not tell the change from no change, nothing else can be read until someone says
 * who is helped or harmed, so that comes first whatever its score and no result is built on the noise:
 * no mitigation, no building on a favourable response, and no repeating of runs that cannot help.
 */
export function advise(facts: Facts): Advice[] {
  const { state } = facts.signal;
  const candidates = [
    ...(state === 'clear' ? mitigations(facts) : []),
    ...validations(facts),
    ...evidenceGaps(facts),
    ...conflicts(facts),
    ...responses(facts),
    ...(state === 'no-direction' ? [] : [...repeats(facts), ...rarities(facts)]),
    ...(state === 'clear' ? opportunities(facts) : []),
    ...critiqueActions(facts),
  ].map((candidate, order) => ({ candidate, order }));
  const ordered = candidates
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
    .map(({ candidate }) => candidate);
  const lead = state === 'no-direction' ? sayDirection(facts) : null;
  return [...(lead ? [lead] : []), ...ordered]
    .slice(0, MAX_RECOMMENDATIONS)
    .map((candidate, index): Advice => ({
      ...candidate,
      recommendation: {
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
      },
    }));
}

/** The recommendations as the stored brief holds them. */
export const recommend = (facts: Facts): Recommendation[] =>
  advise(facts).map((advice) => advice.recommendation);
