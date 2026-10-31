import {
  BRIEF_SECTION_IDS,
  decisionBriefSchema,
  type DecisionBrief,
  type Recommendation,
  type ValidationExperiment,
} from '../../../shared/brief.js';
import { gatherFacts, type BriefInputs } from './facts.js';
import { lintText, mentionsSimulated } from './lint.js';
import { recommend } from './recommend.js';
import {
  decision,
  evidenceBase,
  executiveAnswer,
  sources,
  stakeholdersSection,
} from './sections-answer.js';
import {
  assumptionsSection,
  limitationItems,
  limitationsSection,
  recommendationsSection,
  risksOpportunities,
  technicalAppendix,
  uncertainty,
  validationSection,
} from './sections-judgement.js';
import {
  alternativeOutcomes,
  drivers,
  firstOrder,
  reactionPatterns,
  secondOrder,
} from './sections-simulation.js';
import { clip } from './text.js';
import { validationPlan } from './validation.js';
import type { Tally } from './writer.js';

export type { BriefConflict, BriefInputs, BriefLedgerSummary } from './facts.js';

const WITHHELD = (rules: string): string =>
  `A recommendation was withheld because its wording broke the guard (${rules}); the simulated finding it followed from is still listed with the findings.`;

const rulesOf = (texts: readonly string[]): string[] => [
  ...new Set(texts.flatMap((text) => lintText(text).map((issue) => issue.rule))),
];

/** A recommendation whose own words break the guard, or that does not say it is simulated, is not shown as written. */
function guardRecommendations(recommendations: Recommendation[], tally: Tally): Recommendation[] {
  return recommendations.map((recommendation) => {
    const rules = rulesOf([
      recommendation.text,
      recommendation.validation,
      recommendation.horizon,
      recommendation.ownerFunction,
      ...recommendation.leadingIndicators,
    ]);
    if (!mentionsSimulated(recommendation.text)) rules.push('missing-simulated');
    if (rules.length === 0) return recommendation;
    tally.withheld += 1;
    return {
      ...recommendation,
      text: clip(WITHHELD(rules.join(', ')), 500),
      validation: 'See the findings it followed from.',
      leadingIndicators: [],
    };
  });
}

function guardPlan(plan: ValidationExperiment[], tally: Tally): ValidationExperiment[] {
  return plan.map((experiment) => {
    const rules = rulesOf([experiment.question, experiment.method, experiment.successSignal]);
    if (rules.length === 0) return experiment;
    tally.withheld += 1;
    return {
      ...experiment,
      question: `A check was withheld because its wording broke the guard (${rules.join(', ')}).`,
      method: 'See the assumption or finding it was meant to test.',
      successSignal: 'Not stated.',
    };
  });
}

/**
 * Assembles the answer-first brief from a project's own artifacts. Nothing is invented and nothing is
 * worded by a model: every statement is a function of the inputs, with its origin, what it rests on
 * and how far it can be relied on, and the same inputs always give the same brief, apart from the
 * time it is made. The sections are in the order a reader needs them.
 */
export function buildBrief(inputs: BriefInputs): DecisionBrief {
  const facts = gatherFacts(inputs);
  const { analysis } = facts;
  const tally: Tally = { withheld: 0, downgraded: 0 };

  const { section: executive, headline } = executiveAnswer(facts, tally);
  const recommendations = guardRecommendations(recommend(facts), tally);
  const plan = guardPlan(validationPlan(facts), tally);
  const limitations = limitationItems(facts);

  const sections = [
    executive,
    decision(facts, tally),
    evidenceBase(facts, tally),
    stakeholdersSection(facts, tally),
    reactionPatterns(facts, tally),
    alternativeOutcomes(facts, tally),
    firstOrder(facts, tally),
    secondOrder(facts, tally),
    drivers(facts, tally),
    assumptionsSection(facts, tally),
    uncertainty(facts, tally),
    risksOpportunities(facts, tally),
    recommendationsSection(facts, recommendations, tally),
    validationSection(plan, tally),
    sources(facts, tally),
    limitationsSection(limitations, tally),
    technicalAppendix(facts, tally),
  ];

  const notes = [
    'Every statement is assembled by rules from the stored analysis, stakeholders, scenario and sources; no model wrote any of it.',
    'A finding is a count of the seeded runs in which a statement held, with a Wilson interval for that share. There is no confidence score.',
    'The responses are readings of the final simulated stance of each member, not observed behaviour.',
    'Recommendations are ordered by impact times repeatability divided by effort.',
  ];
  if (tally.withheld > 0) {
    notes.push(`${tally.withheld} statements were withheld because their wording broke the guard.`);
  }
  if (tally.downgraded > 0) {
    notes.push(
      `${tally.downgraded} statements are shown as unresolved uncertainty because they named an origin they had nothing to rest on.`,
    );
  }

  return decisionBriefSchema.parse({
    generatedAt: inputs.generatedAt ?? new Date().toISOString(),
    analysisId: analysis.id,
    question: clip(inputs.project.question, 2_000),
    headline,
    sections,
    recommendations,
    validationPlan: plan,
    limitations: limitations.map((item) => item.text),
    fidelity: analysis.fidelity,
    methodology: {
      runsPerVariant: analysis.config.runsPerVariant,
      variants: analysis.config.variants.map((variant) => clip(variant.label, 120)),
      baseSeed: analysis.config.baseSeed,
      rounds: analysis.config.rounds,
      notes,
    },
    openCritiques: facts.critiques.filter((critique) => critique.status !== 'accepted').length,
    generatedBy: 'rules',
    inputRevisions: inputs.inputRevisions ?? {},
  });
}

/** The section ids in the order the brief is read, for the tests and the exports. */
export const SECTION_ORDER = BRIEF_SECTION_IDS;
