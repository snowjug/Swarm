import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Analysis, Finding, SensitivityRow } from '../../shared/analysis.js';
import {
  CRITIC_ROLES,
  CRITIQUE_SEVERITIES,
  critiqueSchema,
  critiqueSetSchema,
  type CriticRole,
  type Critique,
  type CritiqueSeverity,
} from '../../shared/critique.js';
import { scenarioFixture } from '../../shared/lab-fixtures.js';
import { runRuleCritics } from '../src/critics/rules.js';
import type { CriticInput } from '../src/critics/types.js';
import {
  NOW,
  cleanInput,
  ref,
  withActor,
  withAnalysis,
  withBrief,
  withCitations,
  withStakeholder,
  withTrait,
} from './support/critic-world.js';

const raise = (input: CriticInput): Critique[] => runRuleCritics(input);
const idsOf = (critiques: readonly Critique[]): string[] =>
  critiques.map((critique) => critique.id).sort();

// --- small edits of the clean fixture -----------------------------------------------------------

const finding = (id: string, change: Partial<Finding> = {}): Finding => ({
  id,
  kind: 'majority-response',
  variantId: 'proposed-change',
  actorId: 'subscribers',
  statement: 'Most simulated subscribers ended up looking for an alternative or resisting.',
  predicate: 'Switch plus resist is the largest share within the actor.',
  holdsIn: 5,
  of: 10,
  interval: { lo: 0.24, hi: 0.76 },
  classification: 'unstable',
  ...change,
});

const row = (change: Partial<SensitivityRow> = {}): SensitivityRow => ({
  id: 's1',
  target: { kind: 'trait', actorId: 'subscribers', trait: 'switchingCost' },
  label: 'Subscribers: cost of switching, 0.2 higher',
  perturbation: 0.2,
  metric: 'Share ending in switch or resist',
  baseMean: 0.45,
  shift: -0.06,
  standardError: 0.01,
  classification: 'assumption-sensitive',
  assumptionOrigin: 'system-assumption',
  ...change,
});

/** The mean share of simulated members ending in switch or resist, over a variant's runs. */
function share(analysis: Analysis, variantId: string): number {
  const runs = analysis.variants.find((variant) => variant.variantId === variantId)?.runs ?? [];
  return (
    runs.reduce((sum, run) => sum + run.responseShares.switch + run.responseShares.resist, 0) /
    runs.length
  );
}

/** A sensitivity row whose tested change covers `fraction` of the gap between the two variants. */
function closing(input: CriticInput, fraction: number, change: Partial<SensitivityRow> = {}) {
  const proposed = share(input.analysis, 'proposed-change');
  const gap = proposed - share(input.analysis, 'baseline');
  return row({ baseMean: proposed, shift: -gap * fraction, ...change });
}

type Document = CriticInput['evidenceSummary']['documents'][number];

const withRows = (input: CriticInput, rows: SensitivityRow[]) =>
  withAnalysis(input, { sensitivity: rows });
const withFindings = (input: CriticInput, findings: Finding[]) => withAnalysis(input, { findings });
const headline = (input: CriticInput): Finding => {
  const first = input.analysis.findings.find((candidate) => candidate.id === 'f1');
  if (!first) throw new Error('The fixture has no f1.');
  return first;
};
const withRuns = (input: CriticInput, runsPerVariant: number) =>
  withAnalysis(input, { config: { ...input.analysis.config, runsPerVariant } });
const withFidelity = (input: CriticInput, change: Partial<Analysis['fidelity']>) =>
  withAnalysis(input, { fidelity: { ...input.analysis.fidelity, ...change } });
const withDocuments = (
  input: CriticInput,
  change: (document: Document) => Document,
): CriticInput => ({
  ...input,
  evidenceSummary: {
    ...input.evidenceSummary,
    documents: input.evidenceSummary.documents.map(change),
  },
});
const withScenario = (input: CriticInput, change: Parameters<typeof scenarioFixture>[0]) => ({
  ...input,
  scenario: scenarioFixture(change),
});
const withoutStakeholder = (input: CriticInput, id: string): CriticInput => ({
  ...input,
  stakeholders: input.stakeholders && {
    ...input.stakeholders,
    stakeholders: input.stakeholders.stakeholders.filter((stakeholder) => stakeholder.id !== id),
  },
});
const withStances = (input: CriticInput, key: 'priorStance' | 'impact', value: number) => ({
  ...input,
  actors: {
    actors: input.actors.actors.map((actor) => ({
      ...actor,
      traits: { ...actor.traits, [key]: { ...actor.traits[key], value } },
    })),
  },
});
const recommendation = (input: CriticInput) => {
  const first = withBrief(input).brief?.recommendations[0];
  if (!first) throw new Error('The fixture brief has no recommendation.');
  return first;
};
const withRecommendation = (input: CriticInput, change: Record<string, unknown>) =>
  withBrief(input, { recommendations: [{ ...recommendation(input), ...change }] });
const withStatements = (
  input: CriticInput,
  statements: { id: string; text: string; origin: string }[],
) =>
  withBrief(input, {
    sections: [
      { id: 'executive-answer', title: 'Executive answer', statements, visuals: [] },
    ] as never,
  });

const ONE_DOCUMENT = {
  provider: [ref('d1', 1), ref('d1', 2)],
  subscribers: [ref('d1', 3), ref('d1', 4)],
  'rival-provider': [ref('d1', 5), ref('d1', 6)],
  regulator: [ref('d1', 7), ref('d1', 8)],
  resellers: [ref('d1', 9), ref('d1', 10)],
};

// --- the rules ----------------------------------------------------------------------------------

type Expected = Record<string, [CriticRole, CritiqueSeverity]>;

interface Case {
  name: string;
  edit: (input: CriticInput) => CriticInput;
  expected: Expected;
}

const none: Expected = {};

const CASES: Case[] = [
  // evidence
  {
    name: 'evidence: a key stakeholder cites no passage',
    edit: (i) => withStakeholder(i, 'provider', { evidence: [] }),
    expected: { 'evidence-uncited-stakeholders': ['evidence', 'major'] },
  },
  {
    name: 'evidence: only a standard stakeholder cites no passage',
    edit: (i) => withStakeholder(i, 'subscribers', { evidence: [] }),
    expected: { 'evidence-uncited-stakeholders': ['evidence', 'minor'] },
  },
  {
    name: 'evidence: a background stakeholder with no passage is not counted',
    edit: (i) => withStakeholder(i, 'resellers', { evidence: [], priority: 'background' }),
    expected: none,
  },
  {
    name: 'evidence: one document supplies most of the passages (four fifths)',
    edit: (i) => withCitations(i, { ...ONE_DOCUMENT, resellers: [ref('d2', 1), ref('d2', 2)] }),
    expected: { 'evidence-single-source': ['evidence', 'major'] },
  },
  {
    name: 'evidence: one document supplies most of the passages (three fifths)',
    edit: (i) =>
      withCitations(i, {
        provider: [ref('d1', 1), ref('d1', 2)],
        subscribers: [ref('d1', 3), ref('d1', 4)],
        'rival-provider': [ref('d1', 5), ref('d1', 6)],
        regulator: [ref('d2', 1), ref('d3', 1)],
        resellers: [ref('d2', 2), ref('d3', 2)],
      }),
    expected: { 'evidence-single-source': ['evidence', 'minor'] },
  },
  {
    name: 'evidence: a web page this server did not fetch',
    edit: (i) =>
      withDocuments(i, (document) =>
        document.id === 'd1'
          ? { ...document, provenance: { kind: 'url', fetchedByServer: false, asOf: '2026-01-10' } }
          : document,
      ),
    expected: { 'evidence-unverified-web-sources': ['evidence', 'minor'] },
  },
  {
    name: 'evidence: a web page with no word on who fetched it is not taken as fetched',
    edit: (i) =>
      withDocuments(i, (document) =>
        document.id === 'd1'
          ? { ...document, provenance: { kind: 'url', asOf: '2026-01-10' } }
          : document,
      ),
    expected: { 'evidence-unverified-web-sources': ['evidence', 'minor'] },
  },
  {
    name: 'evidence: open conflicts between sources',
    edit: (i) => ({ ...i, evidenceSummary: { ...i.evidenceSummary, openConflicts: 2 } }),
    expected: { 'evidence-open-conflicts': ['evidence', 'minor'] },
  },
  {
    name: 'evidence: open conflicts that touch a cited passage',
    edit: (i) =>
      withStakeholder(
        { ...i, evidenceSummary: { ...i.evidenceSummary, openConflicts: 1 } },
        'provider',
        { evidence: [ref('d1', 1, { conflictId: 'X1' }), ref('d2', 1)] },
      ),
    expected: { 'evidence-open-conflicts': ['evidence', 'major'] },
  },
  {
    name: 'evidence: a ledger that was never built is not read as "no conflicts"',
    edit: (i) => ({ ...i, evidenceSummary: { ...i.evidenceSummary, openConflicts: null } }),
    expected: none,
  },
  {
    name: 'evidence: a document with no date when the scenario has a horizon',
    edit: (i) =>
      withDocuments(i, (document) =>
        document.id === 'd2' ? { ...document, provenance: { kind: 'upload' } } : document,
      ),
    expected: { 'evidence-undated-sources': ['evidence', 'minor'] },
  },
  {
    name: 'evidence: a document with no provenance at all counts as undated',
    edit: (i) =>
      withDocuments(i, (document) =>
        document.id === 'd2' ? { ...document, provenance: null } : document,
      ),
    expected: { 'evidence-undated-sources': ['evidence', 'minor'] },
  },
  {
    name: 'evidence: an undated document matters only when the scenario looks ahead',
    edit: (i) =>
      withScenario(
        withDocuments(i, (document) => ({ ...document, provenance: { kind: 'upload' } })),
        { horizon: null },
      ),
    expected: none,
  },
  // assumption
  {
    name: 'assumption: a sensitive assumption that is a system assumption',
    edit: (i) => withRows(i, [row()]),
    expected: { 'assumption-sensitive-s1': ['assumption', 'major'] },
  },
  {
    name: 'assumption: a sensitive assumption a person set, without evidence',
    edit: (i) => withRows(i, [row({ assumptionOrigin: 'user' })]),
    expected: { 'assumption-sensitive-s1': ['assumption', 'minor'] },
  },
  {
    name: 'assumption: a sensitive assumption a model proposed',
    edit: (i) => withRows(i, [row({ assumptionOrigin: 'model' })]),
    expected: { 'assumption-sensitive-s1': ['assumption', 'minor'] },
  },
  {
    name: 'assumption: a sensitive assumption backed by evidence is not criticised',
    edit: (i) => withRows(i, [row({ assumptionOrigin: 'evidence' })]),
    expected: none,
  },
  {
    name: 'assumption: a row that is not sensitive is not criticised',
    edit: (i) => withRows(i, [row({ classification: 'inconclusive' })]),
    expected: none,
  },
  {
    name: 'assumption: defaults nobody edited on a key actor',
    edit: (i) =>
      withTrait(withActor(i, 'provider', { edited: false }), 'provider', 'influence', {
        origin: 'system-assumption',
      }),
    expected: { 'assumption-defaults-provider': ['assumption', 'minor'] },
  },
  {
    name: 'assumption: defaults on a cohort are not flagged here',
    edit: (i) =>
      withTrait(withActor(i, 'subscribers', { edited: false }), 'subscribers', 'influence', {
        origin: 'system-assumption',
      }),
    expected: none,
  },
  {
    name: 'assumption: a key actor a person edited is not flagged for its remaining defaults',
    edit: (i) => withTrait(i, 'provider', 'influence', { origin: 'system-assumption' }),
    expected: none,
  },
  {
    name: 'assumption: an impact sign on a cohort that nobody confirmed',
    edit: (i) => withTrait(i, 'subscribers', 'impact', { origin: 'system-assumption' }),
    expected: { 'assumption-unconfirmed-impact': ['assumption', 'minor'] },
  },
  {
    name: 'assumption: an impact sign on a key actor that only a model proposed',
    edit: (i) => withTrait(i, 'provider', 'impact', { origin: 'model', value: -0.3 }),
    expected: { 'assumption-unconfirmed-impact': ['assumption', 'major'] },
  },
  {
    name: 'assumption: an impact of zero has no sign to confirm',
    edit: (i) => withTrait(i, 'resellers', 'impact', { origin: 'system-assumption' }),
    expected: none,
  },
  // methodology
  {
    name: 'methodology: five runs per variant',
    edit: (i) => withRuns(i, 5),
    expected: { 'methodology-few-runs': ['methodology', 'major'] },
  },
  {
    name: 'methodology: ten runs per variant',
    edit: (i) => withRuns(i, 10),
    expected: { 'methodology-few-runs': ['methodology', 'minor'] },
  },
  {
    name: 'methodology: nineteen runs per variant',
    edit: (i) => withRuns(i, 19),
    expected: { 'methodology-few-runs': ['methodology', 'minor'] },
  },
  {
    name: 'methodology: twenty runs per variant is enough',
    edit: (i) => withRuns(i, 20),
    expected: none,
  },
  {
    name: 'methodology: the fidelity is rules only',
    edit: (i) =>
      withFidelity(i, {
        engine: 'rules',
        keyActors: 'rules',
        modelRepeats: 0,
        label: 'Rules: outcomes follow from the declared assumptions',
      }),
    expected: { 'methodology-rules-only': ['methodology', 'minor'] },
  },
  {
    name: 'methodology: a model drove part of it and it was repeated once',
    edit: (i) => withFidelity(i, { modelRepeats: 1 }),
    expected: { 'methodology-model-repeats': ['methodology', 'major'] },
  },
  {
    name: 'methodology: a model drove part of it and it was never repeated',
    edit: (i) => withFidelity(i, { modelRepeats: 0 }),
    expected: { 'methodology-model-repeats': ['methodology', 'major'] },
  },
  {
    name: 'methodology: most findings are unstable',
    edit: (i) => withFindings(i, [headline(i), finding('f2'), finding('f3')]),
    expected: {
      'methodology-unstable-findings': ['methodology', 'major'],
      'adversarial-unstable-f2': ['adversarial', 'minor'],
      'adversarial-unstable-f3': ['adversarial', 'minor'],
    },
  },
  {
    name: 'methodology: a third of the findings are unstable',
    edit: (i) =>
      withFindings(i, [
        headline(i),
        finding('f2'),
        finding('f3'),
        finding('f4', { classification: 'repeatable', holdsIn: 10, interval: { lo: 0.72, hi: 1 } }),
        finding('f5', { classification: 'repeatable', holdsIn: 10, interval: { lo: 0.72, hi: 1 } }),
      ]),
    expected: {
      'methodology-unstable-findings': ['methodology', 'minor'],
      'adversarial-unstable-f2': ['adversarial', 'minor'],
      'adversarial-unstable-f3': ['adversarial', 'minor'],
    },
  },
  {
    name: 'methodology: no cross-check was made',
    edit: (i) => withAnalysis(i, { crossCheck: null }),
    expected: { 'methodology-no-cross-check': ['methodology', 'minor'] },
  },
  {
    name: 'methodology: the cross-check lies outside the ensemble',
    edit: (i) =>
      withAnalysis(i, {
        crossCheck: {
          primaryStanceMean: 0.4,
          withinEnsembleRange: false,
          note: 'Different engines.',
        },
      }),
    expected: { 'methodology-cross-check-disagrees': ['methodology', 'major'] },
  },
  {
    name: 'methodology: a headline finding with a very wide interval',
    edit: (i) =>
      withFindings(i, [
        { ...headline(i), interval: { lo: 0.3, hi: 0.95 } },
        ...i.analysis.findings.filter((candidate) => candidate.id !== 'f1'),
      ]),
    expected: { 'methodology-wide-intervals': ['methodology', 'major'] },
  },
  {
    name: 'methodology: a headline finding with a wide interval that stays above one half',
    edit: (i) =>
      withFindings(i, [
        { ...headline(i), interval: { lo: 0.55, hi: 0.99 } },
        ...i.analysis.findings.filter((candidate) => candidate.id !== 'f1'),
      ]),
    expected: { 'methodology-wide-intervals': ['methodology', 'minor'] },
  },
  {
    name: 'methodology: a wide interval on a finding about one actor is not a headline',
    edit: (i) =>
      withFindings(i, [
        headline(i),
        finding('f2', { classification: 'repeatable', interval: { lo: 0.2, hi: 0.9 } }),
      ]),
    expected: none,
  },
  // stakeholder coverage
  {
    name: 'coverage: the scenario lists a competitor, the set has none',
    edit: (i) => withStakeholder(i, 'rival-provider', { category: 'other' }),
    expected: { 'coverage-missing-competitor': ['stakeholder-coverage', 'major'] },
  },
  {
    name: 'coverage: the scenario only mentions a competitor in its own words',
    edit: (i) =>
      withStakeholder(
        withScenario(i, {
          likelyStakeholders: ['subscribers', 'regulator'],
          baseline: 'Competing offers stay as they are.',
        }),
        'rival-provider',
        { category: 'other' },
      ),
    expected: { 'coverage-missing-competitor': ['stakeholder-coverage', 'minor'] },
  },
  {
    name: 'coverage: the scenario lists a regulator, the set has none',
    edit: (i) => withStakeholder(i, 'regulator', { category: 'other' }),
    expected: { 'coverage-missing-regulator': ['stakeholder-coverage', 'major'] },
  },
  {
    name: 'coverage: a kind of stakeholder the scenario never implies is not asked for',
    edit: (i) =>
      withoutStakeholder(
        withScenario(i, { likelyStakeholders: ['subscribers', 'regulator'] }),
        'rival-provider',
      ),
    expected: none,
  },
  {
    name: 'coverage: a removed stakeholder does not count as covered',
    edit: (i) => withStakeholder(i, 'regulator', { status: 'removed' }),
    expected: {
      'coverage-missing-regulator': ['stakeholder-coverage', 'major'],
      'coverage-unmatched-likely': ['stakeholder-coverage', 'minor'],
    },
  },
  {
    name: 'coverage: one listed stakeholder matches nobody',
    edit: (i) =>
      withScenario(i, {
        likelyStakeholders: ['subscribers', 'regulator', 'rival provider', 'industry observers'],
      }),
    expected: { 'coverage-unmatched-likely': ['stakeholder-coverage', 'minor'] },
  },
  {
    name: 'coverage: most listed stakeholders match nobody',
    edit: (i) =>
      withScenario(i, { likelyStakeholders: ['industry observers', 'media outlets', 'regulator'] }),
    expected: { 'coverage-unmatched-likely': ['stakeholder-coverage', 'major'] },
  },
  {
    name: 'coverage: a listed kind of stakeholder matches by its category',
    edit: (i) =>
      withScenario(i, { likelyStakeholders: ['subscribers', 'competitors', 'regulator'] }),
    expected: none,
  },
  {
    name: 'coverage: a key stakeholder with high uncertainty',
    edit: (i) =>
      withStakeholder(i, 'provider', {
        uncertainty: { level: 'high', reason: 'Little is known.' },
      }),
    expected: { 'coverage-uncertain-key-stakeholders': ['stakeholder-coverage', 'minor'] },
  },
  {
    name: 'coverage: a standard stakeholder with high uncertainty is not flagged',
    edit: (i) =>
      withStakeholder(i, 'subscribers', {
        uncertainty: { level: 'high', reason: 'Little is known.' },
      }),
    expected: none,
  },
  {
    name: 'coverage: a cohort for a large population with a handful of members',
    edit: (i) => withActor(i, 'subscribers', { sampleSize: 3 }),
    expected: { 'coverage-thin-cohorts': ['stakeholder-coverage', 'minor'] },
  },
  {
    name: 'coverage: a small population with a handful of members is not thin',
    edit: (i) => withActor(i, 'resellers', { size: 40, sampleSize: 3 }),
    expected: none,
  },
  // bias
  {
    name: 'bias: every actor starts in favour',
    edit: (i) => withStances(i, 'priorStance', 0.5),
    expected: { 'bias-one-sided-priors': ['bias', 'minor'] },
  },
  {
    name: 'bias: every actor starts against',
    edit: (i) => withStances(i, 'priorStance', -0.5),
    expected: { 'bias-one-sided-priors': ['bias', 'minor'] },
  },
  {
    name: 'bias: neutral priors are not one-sided',
    edit: (i) => withStances(i, 'priorStance', 0),
    expected: none,
  },
  {
    name: 'bias: every impact is negative',
    edit: (i) => withStances(i, 'impact', -0.4),
    expected: { 'bias-one-sided-impact': ['bias', 'minor'] },
  },
  {
    name: 'bias: every impact is positive',
    edit: (i) => withStances(i, 'impact', 0.4),
    expected: { 'bias-one-sided-impact': ['bias', 'minor'] },
  },
  {
    name: 'bias: a cast of two cannot be one-sided',
    edit: (i) => {
      const favour = withStances(i, 'priorStance', 0.5);
      return { ...favour, actors: { actors: favour.actors.actors.slice(0, 2) } };
    },
    expected: none,
  },
  {
    name: 'bias: all the evidence comes from one document',
    edit: (i) => withCitations(i, ONE_DOCUMENT),
    expected: {
      'bias-single-viewpoint': ['bias', 'minor'],
      'evidence-single-source': ['evidence', 'major'],
    },
  },
  {
    name: 'bias: confident wording in the headline',
    edit: (i) =>
      withBrief(i, {
        headline: 'The proposed change will certainly lower favour among simulated members.',
      }),
    expected: { 'bias-confident-wording': ['bias', 'major'] },
  },
  {
    name: 'bias: "will" alone is a lesser fault',
    edit: (i) =>
      withBrief(i, {
        headline: 'Simulated members will end less favourable in the simulated runs.',
      }),
    expected: { 'bias-confident-wording': ['bias', 'minor'] },
  },
  {
    name: 'bias: a recommendation that claims to prove something',
    edit: (i) => withRecommendation(i, { text: 'This proves that the change is safe.' }),
    expected: { 'bias-confident-wording': ['bias', 'major'] },
  },
  {
    name: 'bias: a disclaimer is not confident wording',
    edit: (i) =>
      withBrief(i, {
        headline:
          'Swarm does not guarantee any real-world outcome; simulated members ended less favourable in 10 of 10 runs.',
      }),
    expected: none,
  },
  {
    name: 'bias: a percentage that is not labelled as simulated',
    edit: (i) =>
      withStatements(i, [
        {
          id: 'st-1',
          text: '58% of members ended up looking for an alternative.',
          origin: 'simulation-aggregation',
        },
      ]),
    expected: { 'bias-real-world-percentages': ['bias', 'major'] },
  },
  {
    name: 'bias: a percentage labelled as simulated is fine',
    edit: (i) =>
      withStatements(i, [
        {
          id: 'st-1',
          text: 'In 10 simulated runs, 58% of simulated members looked for an alternative.',
          origin: 'simulation-aggregation',
        },
      ]),
    expected: none,
  },
  {
    name: 'bias: a percentage quoted from a source is fine',
    edit: (i) =>
      withStatements(i, [
        { id: 'st-1', text: 'The source reports growth of 12%.', origin: 'supplied-evidence' },
      ]),
    expected: none,
  },
  // recommendation
  {
    name: 'recommendation: tied to no finding of this analysis',
    edit: (i) => withRecommendation(i, { linkedFindingIds: ['nope'] }),
    expected: { 'recommendation-no-finding-r1': ['recommendation', 'major'] },
  },
  {
    name: 'recommendation: no way to check it',
    edit: (i) => withRecommendation(i, { validation: '' }),
    expected: { 'recommendation-no-validation-r1': ['recommendation', 'major'] },
  },
  {
    name: 'recommendation: no validation text, but an experiment in the plan targets its finding',
    edit: (i) =>
      withBrief(i, {
        recommendations: [{ ...recommendation(i), validation: '' }],
        validationPlan: [
          {
            id: 'v1',
            targets: ['f1'],
            question: 'Does the direction hold?',
            method: 'Pilot with one group.',
            successSignal: 'The same direction.',
            effort: 'low',
            duration: 'Two weeks',
          },
        ],
      }),
    expected: none,
  },
  {
    name: 'recommendation: nobody to act on it',
    edit: (i) => withRecommendation(i, { ownerFunction: '' }),
    expected: { 'recommendation-no-owner-r1': ['recommendation', 'minor'] },
  },
  {
    name: 'recommendation: it rests only on a rare finding',
    edit: (i) =>
      withRecommendation(
        withFindings(i, [
          headline(i),
          finding('f2', { classification: 'rare', holdsIn: 1, interval: { lo: 0.02, hi: 0.4 } }),
        ]),
        { linkedFindingIds: ['f2'] },
      ),
    expected: { 'recommendation-weak-basis-r1': ['recommendation', 'major'] },
  },
  {
    name: 'recommendation: one firm finding among its findings is enough',
    edit: (i) =>
      withRecommendation(
        withFindings(i, [
          headline(i),
          finding('f2', { classification: 'rare', holdsIn: 1, interval: { lo: 0.02, hi: 0.4 } }),
        ]),
        { linkedFindingIds: ['f1', 'f2'] },
      ),
    expected: none,
  },
  // adversarial
  {
    name: 'adversarial: a system assumption whose tested change covers most of the gap',
    edit: (i) => withRows(i, [closing(i, 0.86)]),
    expected: {
      'adversarial-gap-s1': ['adversarial', 'major'],
      'assumption-sensitive-s1': ['assumption', 'major'],
    },
  },
  {
    name: 'adversarial: an unevidenced assumption whose tested change could erase the gap',
    edit: (i) => withRows(i, [closing(i, 1.2)]),
    expected: {
      'adversarial-gap-s1': ['adversarial', 'blocking'],
      'assumption-sensitive-s1': ['assumption', 'major'],
    },
  },
  {
    name: 'adversarial: an evidence-backed assumption that could erase the gap is serious, not blocking',
    edit: (i) => withRows(i, [closing(i, 1.2, { assumptionOrigin: 'evidence' })]),
    expected: { 'adversarial-gap-s1': ['adversarial', 'major'] },
  },
  {
    name: 'adversarial: a tested change that covers a third of the gap',
    edit: (i) => withRows(i, [closing(i, 0.3, { assumptionOrigin: 'evidence' })]),
    expected: { 'adversarial-gap-s1': ['adversarial', 'minor'] },
  },
  {
    name: 'adversarial: a change that widens the gap does not close it',
    edit: (i) => withRows(i, [closing(i, -0.9, { assumptionOrigin: 'evidence' })]),
    expected: none,
  },
  {
    name: 'adversarial: a row about some other measure is not set against this gap',
    edit: (i) => withRows(i, [closing(i, 0.9, { baseMean: 0.9, assumptionOrigin: 'evidence' })]),
    expected: none,
  },
  {
    name: 'adversarial: an unstable finding about one actor',
    edit: (i) => withFindings(i, [headline(i), finding('f2')]),
    expected: { 'adversarial-unstable-f2': ['adversarial', 'minor'] },
  },
  {
    name: 'adversarial: an unstable headline finding',
    edit: (i) =>
      withFindings(i, [
        headline(i),
        finding('f2', { actorId: null, interval: { lo: 0.4, hi: 0.7 } }),
      ]),
    expected: { 'adversarial-unstable-f2': ['adversarial', 'major'] },
  },
];

describe('the rules critics, each on a fixture made to trigger it', () => {
  it.each(CASES)('$name', ({ edit, expected }) => {
    const critiques = raise(edit(cleanInput()));
    expect(idsOf(critiques)).toEqual(Object.keys(expected).sort());
    for (const critique of critiques) {
      const [role, severity] = expected[critique.id] ?? [];
      expect(critique.role, critique.id).toBe(role);
      expect(critique.severity, critique.id).toBe(severity);
      expect(critique.origin).toBe('rules');
      expect(critique.status).toBe('open');
      expect(critique.response).toBeNull();
      expect(critique.remainingDisagreement).toBeNull();
      expect(critique.basis.length, critique.id).toBeGreaterThan(0);
      expect(critique.impactOnConclusion, critique.id).toMatch(/^If this stands/u);
      expect(critique.createdAt).toBe(NOW);
      expect(critiqueSchema.safeParse(critique).success, critique.id).toBe(true);
    }
  });

  it('covers every role', () => {
    const covered = new Set(
      CASES.flatMap((entry) => Object.values(entry.expected)).map(([role]) => role),
    );
    expect([...covered].sort()).toEqual([...CRITIC_ROLES].sort());
  });

  it('is silent when the scenario, the stakeholders or the brief are missing, as far as they are needed', () => {
    expect(raise({ ...cleanInput(), scenario: null })).toEqual([]);
    expect(raise({ ...cleanInput(), stakeholders: null })).toEqual([]);
    expect(raise({ ...cleanInput(), brief: null })).toEqual([]);
  });
});

describe('what the critics quote', () => {
  it('writes the checked facts into the basis, so that an objection can be checked', () => {
    const few = raise(withRuns(cleanInput(), 10)).find((c) => c.id === 'methodology-few-runs');
    expect(few?.basis.join(' ')).toContain('Runs per variant: 10');
    expect(few?.basis.join(' ')).toContain('0.72');

    const base = cleanInput();
    const conflicted = { ...base, evidenceSummary: { ...base.evidenceSummary, openConflicts: 2 } };
    expect(raise(conflicted).find((c) => c.id === 'evidence-open-conflicts')?.basis).toContain(
      'Open conflicts in the ledger: 2.',
    );

    const gap = raise(withRows(base, [closing(base, 0.86)])).find(
      (c) => c.id === 'adversarial-gap-s1',
    );
    const text = gap?.basis.join(' ') ?? '';
    expect(text).toContain('No change');
    expect(text).toContain('Proposed change');
    expect(text).toContain('Subscribers: cost of switching');
    expect(text).toContain('system-assumption (no evidence supplied)');
    expect(gap?.target).toEqual({ kind: 'assumption', id: 's1' });
  });

  it('quotes the passages it relies on, up to five', () => {
    const dominant = raise(withCitations(cleanInput(), ONE_DOCUMENT)).find(
      (c) => c.id === 'evidence-single-source',
    );
    expect(dominant?.evidence.length).toBe(3);
    expect(dominant?.evidence[0]?.passageId).toBe('d1-p1');

    const base = cleanInput();
    const conflicted = {
      ...base,
      evidenceSummary: {
        ...base.evidenceSummary,
        openConflicts: 6,
        conflictEvidence: Array.from({ length: 8 }, (_, n) => ref('d2', n + 20)),
      },
    };
    const found = raise(conflicted).find((c) => c.id === 'evidence-open-conflicts');
    expect(found?.evidence.length).toBe(5);
  });

  it('names the assumption whose plausible change closes the gap, with the runner-up', () => {
    const input = cleanInput();
    const first = closing(input, 0.9, { id: 's1', label: 'First assumption' });
    const second = closing(input, 0.4, { id: 's2', label: 'Second assumption' });
    const found = raise(withRows(input, [second, first])).find((c) =>
      c.id.startsWith('adversarial-gap-'),
    );
    expect(found?.id).toBe('adversarial-gap-s1');
    expect(found?.basis.join(' ')).toContain('Next: Second assumption');
  });
});

// --- the set as a whole -------------------------------------------------------------------------

/** One edit of every kind at once, to look at the list as a person would. */
function worst(): CriticInput {
  let input = cleanInput();
  input = withStakeholder(input, 'provider', {
    evidence: [],
    uncertainty: { level: 'high', reason: 'Little is known about this.' },
  });
  input = withDocuments(
    { ...input, evidenceSummary: { ...input.evidenceSummary, openConflicts: 3 } },
    (document) =>
      document.id === 'd1'
        ? { ...document, provenance: { kind: 'url', fetchedByServer: false } }
        : document,
  );
  input = withActor(input, 'subscribers', { sampleSize: 3 });
  input = withStances(input, 'priorStance', 0.5);
  input = withAnalysis(input, {
    config: { ...input.analysis.config, runsPerVariant: 5 },
    fidelity: { ...input.analysis.fidelity, engine: 'rules', keyActors: 'rules', modelRepeats: 0 },
    crossCheck: null,
    findings: [
      { ...headline(input), interval: { lo: 0.3, hi: 0.95 } },
      finding('f2'),
      finding('f3'),
    ],
    sensitivity: [closing(input, 1.2)],
  });
  return withBrief(input, {
    headline: 'The change will certainly lower favour.',
    recommendations: [
      { ...recommendation(input), linkedFindingIds: ['nope'], ownerFunction: '', validation: '' },
    ],
  });
}

describe('the set of critiques', () => {
  it('is ordered with the most severe first, then by role, then by id', () => {
    const critiques = raise(worst());
    expect(critiques.length).toBeGreaterThan(15);
    expect(critiques[0]?.severity).toBe('blocking');
    expect(critiques[0]?.id).toBe('adversarial-gap-s1');
    const rank = (critique: Critique) => CRITIQUE_SEVERITIES.indexOf(critique.severity);
    const roleRank = (critique: Critique) => CRITIC_ROLES.indexOf(critique.role);
    for (let index = 1; index < critiques.length; index += 1) {
      const before = critiques[index - 1]!;
      const after = critiques[index]!;
      expect(rank(before)).toBeGreaterThanOrEqual(rank(after));
      if (rank(before) === rank(after)) {
        expect(roleRank(before)).toBeLessThanOrEqual(roleRank(after));
        if (roleRank(before) === roleRank(after)) expect(before.id < after.id).toBe(true);
      }
    }
  });

  it('is honest about severity: a gap that could be erased is blocking, a missing owner is minor', () => {
    const critiques = raise(worst());
    const severity = (id: string) => critiques.find((critique) => critique.id === id)?.severity;
    expect(severity('adversarial-gap-s1')).toBe('blocking');
    expect(severity('evidence-uncited-stakeholders')).toBe('major');
    expect(severity('recommendation-no-owner-r1')).toBe('minor');
    expect(severity('methodology-few-runs')).toBe('major');
    expect(new Set(critiques.map((critique) => critique.severity))).toEqual(
      new Set(['blocking', 'major', 'minor']),
    );
  });

  it('has unique ids, every critique valid, and fits the stored set', () => {
    const critiques = raise(worst());
    expect(new Set(critiques.map((critique) => critique.id)).size).toBe(critiques.length);
    for (const critique of critiques) {
      expect(critique.id.length).toBeLessThanOrEqual(80);
      expect(critique.objection.length).toBeLessThanOrEqual(800);
      expect(critique.basis.length).toBeLessThanOrEqual(6);
      expect(critique.impactOnConclusion.length).toBeLessThanOrEqual(500);
    }
    expect(
      critiqueSetSchema.safeParse({
        analysisId: 'analysis-1',
        generatedAt: NOW,
        mode: 'rules',
        critiques,
      }).success,
    ).toBe(true);
    expect(new Set(critiques.map((critique) => critique.role))).toEqual(new Set(CRITIC_ROLES));
  });

  it('is deterministic: the same input gives the same critiques, ids included', () => {
    const first = raise(worst());
    expect(raise(worst())).toEqual(first);
    expect(raise(structuredClone(worst()))).toEqual(first);
  });

  it('never edits what it reads', () => {
    const input = worst();
    const before = JSON.stringify(input);
    raise(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('stamps the time it is given, or the current time when it is given none', () => {
    const { now: _now, ...rest } = worst();
    void _now;
    const stamped = raise(rest);
    expect(stamped.length).toBeGreaterThan(0);
    for (const critique of stamped)
      expect(Number.isNaN(Date.parse(critique.createdAt))).toBe(false);
  });
});

describe('the critics are domain neutral', () => {
  // Generic lenses (competitor, regulator, partner) are allowed; the words of any one scenario are not.
  const FORBIDDEN =
    /\b(?:pric(?:e|es|ing)|subscri\w*|customers?|churn\w*|e-?commerce|checkout|shopp\w*|teams|copilot|aws|azure|microsoft|amazon|revenue|retail\w*|patients?|students?|ferry|transit|tariffs?|cloud|website)\b/iu;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = [
    ...readdirSync(join(root, 'src', 'critics')).map((name) => join(root, 'src', 'critics', name)),
    join(root, 'src', 'routes', 'critiques.ts'),
    join(root, '..', 'shared', 'critique.ts'),
  ];

  it('finds the source it is meant to guard', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('has no domain word in %s', (file) => {
    expect(FORBIDDEN.exec(readFileSync(file, 'utf8'))?.[0] ?? null).toBeNull();
  });
});
