import type { Finding, SensitivityRow } from '../../../shared/analysis.js';
import type { ValidationExperiment } from '../../../shared/brief.js';
import {
  TRAIT_KEYS,
  type Actor,
  type StakeholderCategory,
  type TraitKey,
} from '../../../shared/stakeholders.js';
import type { Facts } from './facts.js';
import type { Level } from './rules.js';
import { clip, decimals, embed } from './text.js';

/**
 * A real-world check that would settle one assumption or one result: a survey, interviews, a data
 * pull, an expert review or a staged rollout. The wording is generic and is adapted only by the
 * trait being checked and by the kind of group; nothing here belongs to a market or a product.
 */
export interface Check {
  question: string;
  method: string;
  successSignal: string;
  effort: Level;
  duration: string;
  /** What to measure, in a few words, for the recommendation's leading indicators. */
  measure: string;
}

export const TRAIT_CHECKS: Record<TraitKey, Check> = {
  priorStance: {
    question: 'Where does {group} stand today, before any change?',
    method:
      'A short survey or a handful of interviews with members of the group, asking for their current position on the matter.',
    successSignal:
      'The measured position is close to the assumed starting stance of {value} on a scale from -1 to 1, or the difference is recorded and the assumption updated.',
    effort: 'low',
    duration: '1 to 2 weeks',
    measure: 'Measured starting position of the group on the matter',
  },
  impact: {
    question: 'How much does the change actually affect {group}, for better or worse?',
    method:
      'Compare the situation of a few members before and after a small, reversible rollout, or work through the change with members and an owner who knows the group.',
    successSignal:
      'The measured effect has the same sign as the assumed impact of {value} and a similar size, or the difference is recorded.',
    effort: 'medium',
    duration: '2 to 6 weeks',
    measure: 'Measured effect of the change on the group',
  },
  influence: {
    question: 'How much do others weigh what {group} do?',
    method:
      'Expert review, plus a data pull of who follows or refers to the group (for example referrals, mentions or dependencies).',
    successSignal:
      'Independent indicators rank the reach of the group in the same order as the assumed influence of {value}.',
    effort: 'medium',
    duration: '2 to 3 weeks',
    measure: 'Observed reach of the group among the others',
  },
  openness: {
    question: 'How readily does {group} move toward what others do?',
    method:
      'A data pull of past cases where others changed behaviour, measuring how many in the group followed and how quickly, plus a few interviews.',
    successSignal: 'Observed follow-through is in line with the assumed openness of {value}.',
    effort: 'medium',
    duration: '2 to 4 weeks',
    measure: 'Observed follow-through of the group when others changed',
  },
  sensitivity: {
    question: 'How strongly does {group} respond to a change like this one?',
    method:
      'A small staged rollout or an A/B test with a comparison group, or past data on reactions to comparable changes.',
    successSignal:
      'The measured size of the response is close to the assumed sensitivity of {value}; record the measured range.',
    effort: 'high',
    duration: '4 to 8 weeks',
    measure: 'Measured size of the group response to a comparable change',
  },
  riskTolerance: {
    question: 'How much uncertainty or loss is {group} ready to accept?',
    method:
      'A survey with scenario questions, or interviews about past decisions taken under uncertainty.',
    successSignal: 'The stated tolerance is in line with the assumed value of {value}.',
    effort: 'low',
    duration: '1 to 3 weeks',
    measure: 'Stated tolerance for uncertainty or loss in the group',
  },
  switchingCost: {
    question: 'How long and how costly is it for {group} to change what they use or do today?',
    method:
      'A short survey and a few interviews with members of the group, backed by a data pull of how often and how quickly they changed in the past.',
    successSignal:
      'Measured time and cost to switch are in line with the assumed switching cost of {value}; record the measured range and update the assumption if it differs.',
    effort: 'medium',
    duration: '2 to 4 weeks',
    measure: 'Measured time and cost for the group to switch',
  },
  trust: {
    question: 'How far does {group} trust the party making the change?',
    method:
      'A survey with a standard trust question, or a review of recent feedback and complaint data from the group.',
    successSignal:
      'Measured trust matches the assumed trust of {value}, or the difference is recorded.',
    effort: 'low',
    duration: '1 to 2 weeks',
    measure: 'Measured trust of the group in the party making the change',
  },
  adoptionTendency: {
    question: 'How ready is {group} to take up something new?',
    method: 'A data pull of past take-up of comparable changes, plus a few interviews.',
    successSignal: 'Past take-up is in line with the assumed adoption tendency of {value}.',
    effort: 'low',
    duration: '1 to 2 weeks',
    measure: 'Past take-up of comparable changes by the group',
  },
  authority: {
    question: 'How much power does {group} have to decide or act on their own?',
    method: 'An expert review of the decision rights, contracts and rules that apply to the group.',
    successSignal: 'The documented decision rights match the assumed authority of {value}.',
    effort: 'low',
    duration: '1 to 2 weeks',
    measure: 'Documented decision rights of the group',
  },
  reactivity: {
    question: 'How quickly does {group} respond to what others do?',
    method: 'A data pull of response times in comparable past situations, plus interviews.',
    successSignal: 'Observed response times are in line with the assumed reactivity of {value}.',
    effort: 'medium',
    duration: '2 to 3 weeks',
    measure: 'Observed response time of the group in comparable situations',
  },
};

export const INTENSITY_CHECK: Check = {
  question: 'How strongly does the change land on the groups it affects?',
  method:
    'A small, reversible pilot or staged rollout with a comparison group (an A/B test), measuring the reaction as it is experienced.',
  successSignal:
    'The measured size of the reaction is in line with the simulated strength of the change; record the measured range.',
  effort: 'high',
  duration: '4 to 8 weeks',
  measure: 'Measured size of the reaction in a pilot or staged rollout',
};

export const POPULATION_CHECK: Check = {
  question: 'How large is {group} in fact?',
  method: 'A data pull from records or an independent count, in place of the assumed size.',
  successSignal:
    'The measured size is within the range the model assumes; update the assumption if it is not.',
  effort: 'low',
  duration: '1 week',
  measure: 'Measured size of the group',
};

export const UNSTABLE_CHECK: Check = {
  question:
    'Does the unstable result hold when the analysis is repeated, and does the real group react as the simulation shows?',
  method:
    'Repeat the analysis with more seeded runs; then observe a small staged rollout (an A/B test or a pilot) for the group concerned.',
  successSignal:
    'The share of runs in which the result holds settles clearly above or below one half, and the reaction in the pilot points the same way.',
  effort: 'medium',
  duration: '2 to 6 weeks',
  measure: 'Share of seeded runs in which the result holds, as the number of runs grows',
};

const GAP_CHECKS: { categories: readonly StakeholderCategory[]; check: Check }[] = [
  {
    categories: ['regulator', 'governance'],
    check: {
      question: 'Which rules and past decisions apply to {group}, and how have they been applied?',
      method:
        'An expert review of the rules, past rulings and public filings that bear on the change.',
      successSignal: 'A cited passage for each rule or past decision that bears on the change.',
      effort: 'low',
      duration: '1 to 2 weeks',
      measure: 'Cited rules and past decisions that bear on the change',
    },
  },
  {
    categories: ['competitor', 'substitute'],
    check: {
      question: 'How has {group} reacted to comparable moves before?',
      method: 'Desk research of public statements and past moves, or an expert review.',
      successSignal: 'At least one documented comparable reaction, cited, for the group.',
      effort: 'low',
      duration: '1 to 2 weeks',
      measure: 'Documented reactions of the group to comparable moves',
    },
  },
];

export const GENERAL_GAP_CHECK: Check = {
  question: 'What do members of {group} actually think and need?',
  method: 'Interviews with a few members, followed by a short survey.',
  successSignal:
    'Passages from the interviews or the survey are attached to the stakeholder record, and the analysis is run again.',
  effort: 'medium',
  duration: '2 to 4 weeks',
  measure: 'What members of the group report in interviews and a survey',
};

/** The check that comes first when no stakeholder has an expected direction of impact. */
export const DIRECTION_CHECK: Check = {
  question: 'Who is helped and who is harmed by the change, and by how much?',
  method:
    'Ask the stakeholders themselves, in interviews or a short survey, or someone who knows each group, whether the change helps or harms it and by how much; record a direction for each group in the stakeholder review.',
  successSignal:
    'Each key group has a stated direction of impact from people who know it, and the comparison, run again, can tell the change from no change.',
  effort: 'low',
  duration: '1 to 2 weeks',
  measure: 'Stakeholders with a stated direction of impact',
};

export const gapCheckFor = (category: StakeholderCategory): Check =>
  GAP_CHECKS.find((entry) => entry.categories.includes(category))?.check ?? GENERAL_GAP_CHECK;

export function fill(template: string, group: string, value = ''): string {
  return template.replaceAll('{group}', group).replaceAll('{value}', value);
}

/** The check for one assumption the runs moved, with the group and the assumed value filled in. */
export function checkForSensitivity(
  row: SensitivityRow,
  actor: Actor | undefined,
): { check: Check; group: string; value: string } {
  const group = actor ? embed(actor.name, 60) : 'the group concerned';
  if (row.target.kind === 'trait' && actor && TRAIT_KEYS.includes(row.target.trait as TraitKey)) {
    const key = row.target.trait as TraitKey;
    return { check: TRAIT_CHECKS[key], group, value: decimals(actor.traits[key].value) };
  }
  if (row.target.kind === 'population') {
    return { check: POPULATION_CHECK, group, value: actor ? String(actor.size) : '' };
  }
  return { check: INTENSITY_CHECK, group, value: '' };
}

const byShift = (a: SensitivityRow, b: SensitivityRow): number =>
  Math.abs(b.shift) - Math.abs(a.shift) || (a.id < b.id ? -1 : 1);

/** The unstable or rare findings, those about the headline variant and the whole cast first. */
export function weakFindings(facts: Facts): Finding[] {
  const headline = facts.headline?.variant.variant.id;
  return facts.analysis.findings
    .filter((finding) => finding.classification === 'unstable' || finding.classification === 'rare')
    .sort(
      (a, b) =>
        Number(b.variantId === headline) - Number(a.variantId === headline) ||
        Number(a.actorId !== null) - Number(b.actorId !== null) ||
        (a.id < b.id ? -1 : 1),
    );
}

/** Key actors that no cited passage supports. */
export function unevidencedKeyActors(facts: Facts): Actor[] {
  const priority = new Map(
    facts.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder.priority]),
  );
  return facts.analysis.actors.filter(
    (actor) =>
      (actor.kind === 'key' || priority.get(actor.stakeholderId) === 'key') &&
      !facts.evidence.supports(actor),
  );
}

export const MAX_EXPERIMENTS = 8;

/**
 * The checks that would settle what the result most depends on, in this order: the assumptions the
 * runs were sensitive to that nothing cited backs; the results that were not stable across seeded
 * runs; the key actors nothing cited supports. When no stakeholder has an expected direction of
 * impact, the first check settles that, and repeating runs that cannot tell the change from no
 * change is not proposed.
 */
export function validationPlan(facts: Facts): ValidationExperiment[] {
  const plan: ValidationExperiment[] = [];
  const add = (target: string, check: Check, group: string, value: string): void => {
    plan.push({
      id: `val-${plan.length + 1}`,
      targets: [clip(target, 120)],
      question: clip(fill(check.question, group, value), 300),
      method: clip(fill(check.method, group, value), 400),
      successSignal: clip(fill(check.successSignal, group, value), 300),
      effort: check.effort,
      duration: check.duration,
    });
  };

  const noDirection = facts.signal.state === 'no-direction';
  if (noDirection) {
    const { finding } = facts.signal;
    add(
      finding
        ? `finding ${finding.id}: the comparison could not tell the change from no change`
        : 'assumption: the direction of impact of every stakeholder',
      DIRECTION_CHECK,
      'the stakeholders',
      '',
    );
  }

  const sensitive = facts.analysis.sensitivity
    .filter(
      (row) => row.classification === 'assumption-sensitive' && row.assumptionOrigin !== 'evidence',
    )
    .sort(byShift)
    .slice(0, 5);
  for (const row of sensitive) {
    const actor = row.target.actorId ? facts.actorById.get(row.target.actorId) : undefined;
    const { check, group, value } = checkForSensitivity(row, actor);
    add(`sensitivity ${row.id}: ${row.label}`, check, group, value);
  }
  for (const finding of noDirection ? [] : weakFindings(facts).slice(0, 3)) {
    add(`finding ${finding.id}: ${finding.statement}`, UNSTABLE_CHECK, 'the group concerned', '');
  }
  for (const actor of unevidencedKeyActors(facts).slice(0, 2)) {
    add(
      `evidence gap ${actor.stakeholderId}: ${actor.name}`,
      gapCheckFor(actor.category),
      embed(actor.name, 60),
      '',
    );
  }
  return plan.slice(0, MAX_EXPERIMENTS);
}
