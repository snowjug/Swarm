import { afterEach, describe, expect, it } from 'vitest';
import {
  analysisSchema,
  emptyResponseShares,
  type Analysis,
  type Finding,
  type Variant,
} from '../../shared/analysis.js';
import {
  BRIEF_READING_NOTES,
  BRIEF_SECTION_IDS,
  BRIEF_SIGNAL_NOTICES,
  NO_DIFFERENCE_NOTICE,
  type BriefView,
  type DecisionBrief,
} from '../../shared/brief.js';
import { actorSetFixture, analysisFixture, scenarioFixture } from '../../shared/lab-fixtures.js';
import type { ActorSet } from '../../shared/stakeholders.js';
import { CHANGE_CANNOT_MOVE_ID, type CritiquesView } from '../../shared/critique.js';
import type { AnalysisReadiness } from '../../shared/analysis-plan.js';
import { NO_DIRECTION_NOTICE, UNDIRECTED_NOTICE } from '../../shared/signal.js';
import { buildApp } from '../src/app.js';
import { buildBrief } from '../src/brief/build.js';
import { briefHtml, briefJson, briefMarkdown, type BriefExportInput } from '../src/brief/export.js';
import { gatherFacts, type BriefInputs } from '../src/brief/facts.js';
import { lintBrief, lintText } from '../src/brief/lint.js';
import { pairShares, pairedRunsWords } from '../src/brief/measures.js';
import { SAY_DIRECTION, SAY_DIRECTION_UNDIRECTED, advise } from '../src/brief/recommend.js';
import { isAboutTheSame, UNDIRECTED_READING_NOTE } from '../src/brief/signal.js';
import { briefVisuals } from '../src/brief/visuals.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { TIME, baseInputs, richAnalysis, richInputs } from './support/brief-world.js';

// When the comparison cannot tell the change from no change, the brief says so first and puts no count
// of adverse members forward as a result. These tests build analyses with and without that problem,
// and run the real engine on a cast that has no direction of impact, so that what the engine writes
// and what the brief reads are the same thing.

const SAME_ID = 'direction-same';

const shares = (adverse: number) => {
  const value = emptyResponseShares();
  value.resist = adverse * 0.4;
  value.switch = adverse * 0.6;
  value.wait = (1 - adverse) * 0.4;
  value['adapt-defensively'] = (1 - adverse) * 0.3;
  value['accept-with-conditions'] = (1 - adverse) * 0.2;
  value.adopt = (1 - adverse) * 0.1;
  return value;
};

interface Settings {
  /** Every stakeholder's impact; the fixture's own directions when left out. Members of a group do not differ in it unless `impactSpread` says so. */
  impact?: number;
  impactSpread?: number;
  baselineAdverse?: number;
  changeAdverse?: number;
  changeStance?: number;
  /** One stakeholder that moves clearly under the change, whatever the overall comparison says. */
  moved?: { actorId: string; adverse: number; stance: number };
  /** What the engine's direction finding says, and how often it held. */
  finding?: 'same' | 'lower' | 'none';
  holdsIn?: number;
  classification?: Finding['classification'];
  /** Another direction finding for the same variant, as an engine with finer findings could write. */
  alsoLower?: Finding['classification'];
  intensity?: number;
  overrides?: Record<string, number>;
  edits?: Variant['traitEdits'];
  withSensitivity?: boolean;
}

const OF = 10;

const sameStatement = (holds: number) =>
  `In ${holds} of ${OF} seeded runs, simulated members ended up about the same under Proposed change as under No change on the same seed (overall stance within 0.01).`;
const lowerStatement = (holds: number) =>
  `In ${holds} of ${OF} seeded runs, simulated members ended up less favourable under Proposed change than under No change on the same seed (overall stance lower by more than 0.01).`;

function directionFinding(
  id: string,
  statement: string,
  holdsIn: number,
  classification: Finding['classification'],
  actorId: string | null = null,
): Finding {
  return {
    id,
    kind: 'direction-vs-baseline',
    variantId: 'proposed-change',
    actorId,
    statement,
    predicate: 'The overall final stance is compared with the baseline on the same seed.',
    holdsIn,
    of: OF,
    interval: { lo: holdsIn / OF - 0.2, hi: 1 },
    classification,
  };
}

function analysisWith(settings: Settings = {}): Analysis {
  const base = analysisFixture();
  const actors = base.actors.map((actor) =>
    settings.impact === undefined
      ? actor
      : {
          ...actor,
          traits: {
            ...actor.traits,
            impact: {
              ...actor.traits.impact,
              value: settings.impact,
              spread: settings.impactSpread ?? 0,
            },
          },
        },
  );
  const runs = (adverse: number, stance: number, moved?: Settings['moved']) =>
    Array.from({ length: OF }, (_, index) => ({
      seed: 100 + index,
      stanceMean: stance,
      responseShares: shares(adverse),
      byActor: actors.map((actor) => {
        const shifts = moved?.actorId === actor.id;
        return {
          actorId: actor.id,
          members: actor.sampleSize,
          stanceMean: shifts ? moved.stance : stance,
          responseShares: shares(shifts ? moved.adverse : adverse),
        };
      }),
    }));
  const holdsIn = settings.holdsIn ?? OF;
  const classification = settings.classification ?? 'mostly-repeatable';
  // Whatever else the engine found, so that the analysis has findings even without a direction one.
  const findings: Finding[] = [...base.findings.slice(1)];
  if (settings.finding !== 'none') {
    findings.unshift(
      settings.finding === 'lower'
        ? directionFinding(SAME_ID, lowerStatement(holdsIn), holdsIn, classification)
        : directionFinding(SAME_ID, sameStatement(holdsIn), holdsIn, classification),
    );
  }
  if (settings.alsoLower) {
    findings.push(
      directionFinding(
        'direction-lower',
        lowerStatement(OF),
        OF,
        settings.alsoLower,
        'subscribers',
      ),
    );
  }
  const variants = base.config.variants.map((variant) =>
    variant.kind === 'baseline'
      ? variant
      : {
          ...variant,
          intensity: settings.intensity ?? variant.intensity,
          impactOverrides: settings.overrides ?? variant.impactOverrides,
          traitEdits: settings.edits ?? variant.traitEdits,
        },
  );
  return analysisSchema.parse({
    ...base,
    actors,
    config: { ...base.config, variants },
    variants: [
      {
        variantId: 'baseline',
        runs: runs(settings.baselineAdverse ?? 0.05, 0.1),
        trajectory: base.variants[0]?.trajectory ?? [],
      },
      {
        variantId: 'proposed-change',
        runs: runs(settings.changeAdverse ?? 0.09, settings.changeStance ?? 0.1, settings.moved),
        trajectory: base.variants[1]?.trajectory ?? [],
      },
    ],
    findings,
    sensitivity: settings.withSensitivity ? base.sensitivity : [],
  });
}

function inputsFor(analysis: Analysis, overrides: Partial<BriefInputs> = {}): BriefInputs {
  const actors = actorSetFixture();
  actors.actors = analysis.actors;
  return baseInputs({ analysis, actors, ...overrides });
}

const section = (brief: DecisionBrief, id: (typeof BRIEF_SECTION_IDS)[number]) => {
  const found = brief.sections.find((entry) => entry.id === id);
  if (!found) throw new Error(`No section ${id}.`);
  return found;
};

const COUNTS = /looking for an alternative or resisting/u;

describe('when no stakeholder has an expected direction of impact', () => {
  const noise = () => analysisWith({ impact: 0, baselineAdverse: 0.05, changeAdverse: 0.09 });
  const make = () => buildBrief(inputsFor(noise()));

  it('is read from the analysis with the shared rule, and says so in the brief', () => {
    expect(make().signal).toBe('no-direction');
    expect(isAboutTheSame(noise().findings[0]!)).toBe(true);
  });

  it('says in the headline that the change could not be told from no change, and quotes no count of adverse members', () => {
    const { headline } = make();
    expect(headline).toContain('could not tell the change from no change');
    expect(headline).toContain(NO_DIRECTION_NOTICE);
    expect(headline).toMatch(/\bsimulated\b/u);
    expect(headline).toContain('“Proposed change”');
    expect(headline).toContain('“No change”');
    expect(headline).not.toMatch(COUNTS);
    expect(headline).not.toMatch(/paired runs|about \d/u);
  });

  it('gives the executive answer the same words, under the origin that names what is not known', () => {
    const executive = section(make(), 'executive-answer');
    const [answer, stability, notTold] = executive.statements;
    expect(answer?.text).toContain(NO_DIRECTION_NOTICE);
    expect(answer?.origin).toBe('unresolved-uncertainty');
    expect(answer?.refs.findingIds).toEqual([SAME_ID]);
    expect(answer?.refs.variantIds).toEqual(['proposed-change', 'baseline']);
    expect(stability?.text).toContain('Stability: the finding');
    expect(stability?.text).toContain('says nothing about the change');
    expect(stability?.refs.findingIds).toEqual([SAME_ID]);
    expect(stability?.reliance).toBe('low');
    expect(notTold?.text).toContain('what the change does');
    expect(executive.statements).toHaveLength(3);
    for (const statement of executive.statements) {
      expect(statement.text, statement.text).not.toMatch(COUNTS);
    }
  });

  it('puts "say who is helped or harmed" first, linked to the finding that found the two about the same', () => {
    const brief = make();
    const [first, ...rest] = brief.recommendations;
    expect(first?.text).toBe(SAY_DIRECTION);
    expect(first?.text).toMatch(/^Say who is helped or harmed/u);
    expect(first?.text).toContain('stakeholder review');
    expect(first?.text).toContain('read the evidence with a model');
    expect(first?.text).toContain('run the comparison again');
    expect(first?.linkedFindingIds).toEqual([SAME_ID]);
    expect(first).toMatchObject({ id: 'rec-1', priority: 1, impact: 'high', effort: 'low' });
    expect(first?.validation).toContain('stakeholder review');
    expect(rest.map((recommendation) => recommendation.priority)).toEqual(
      rest.map((_, index) => index + 2),
    );
    for (const recommendation of brief.recommendations) {
      expect(recommendation.text).not.toMatch(/^(Mitigate|Build on|Do not decide)/u);
      expect(recommendation.text).not.toMatch(/ended up looking for an alternative or resisting/u);
      expect(recommendation.linkedFindingIds.length).toBeGreaterThan(0);
    }
  });

  it('keeps the first recommendation first in its section, as an assumption and not as a result', () => {
    const recommendations = section(make(), 'recommendations');
    const [rule, first] = recommendations.statements;
    expect(rule?.text).toContain('comes first whatever its score');
    expect(first).toMatchObject({ id: 'rec-1', origin: 'system-assumption', reliance: null });
    expect(first?.refs.findingIds).toEqual([SAME_ID]);
    expect(first?.refs.assumptions.length).toBeGreaterThan(0);
  });

  it('makes the first check one that confirms the direction of impact with the stakeholders themselves', () => {
    const brief = make();
    const [first] = brief.validationPlan;
    expect(first?.id).toBe('val-1');
    expect(first?.question).toBe('Who is helped and who is harmed by the change, and by how much?');
    expect(first?.method).toContain('Ask the stakeholders themselves');
    expect(first?.method).toContain('stakeholder review');
    expect(first?.targets[0]).toMatch(new RegExp(`^finding ${SAME_ID}: `, 'u'));
    expect(first?.effort).toBe('low');
    for (const experiment of brief.validationPlan) {
      expect(experiment.method).not.toContain('Repeat the analysis with more seeded runs');
    }
    const statement = section(brief, 'validation-plan').statements.find(
      (entry) => entry.id === 'val-1',
    );
    expect(statement?.origin).toBe('unresolved-uncertainty');
    expect(statement?.refs.findingIds).toEqual([SAME_ID]);
    expect(section(brief, 'validation-plan').statements[0]?.text).toContain(
      'The first check below settles who is helped or harmed',
    );
  });

  it('leads the limitations with it, under an assumption of the system', () => {
    const brief = make();
    expect(brief.limitations[0]).toBe(NO_DIRECTION_NOTICE);
    const [first, second] = section(brief, 'limitations').statements;
    expect(first?.text).toBe(NO_DIRECTION_NOTICE);
    expect(first?.origin).toBe('system-assumption');
    expect(second?.text).toContain('Synthetic actors are not real people');
  });

  it('does not set one variant against another as an effect anywhere in the body', () => {
    const brief = make();
    const outcomes = section(brief, 'alternative-outcomes').statements;
    expect(outcomes[0]).toMatchObject({
      origin: 'system-assumption',
      text: BRIEF_READING_NOTES['no-direction'],
    });
    for (const statement of outcomes) {
      expect(statement.text, statement.text).not.toMatch(/^Against /u);
      expect(statement.text, statement.text).not.toMatch(/^From fewest to most/u);
      expect(statement.text, statement.text).not.toMatch(/least favourable change/u);
    }
    expect(section(brief, 'reaction-patterns').statements[0]?.text).toBe(
      BRIEF_READING_NOTES['no-direction'],
    );
    for (const statement of section(brief, 'reaction-patterns').statements) {
      expect(statement.text, statement.text).not.toMatch(/, against about/u);
    }
    const risks = section(brief, 'risks-opportunities').statements;
    expect(risks).toHaveLength(1);
    expect(risks[0]?.text).toContain('No risk or opportunity is attributed to the change');
    expect(section(brief, 'uncertainty').statements[0]?.text).toContain(
      'shows only that the simulation repeats itself',
    );
  });

  it('rates every statement that rests on a finding as low reliance, however often the finding held', () => {
    const brief = make();
    const rated = brief.sections
      .flatMap((entry) => entry.statements)
      .filter((statement) => statement.refs.findingIds.length > 0 && statement.reliance !== null);
    expect(rated.length).toBeGreaterThan(0);
    for (const statement of rated) expect(statement.reliance, statement.text).toBe('low');
  });

  it('passes the wording guard, withholds nothing, and notes it in the method', () => {
    const brief = make();
    expect(lintBrief(brief)).toEqual([]);
    expect(brief.methodology.notes.join(' ')).not.toContain('withheld');
    expect(brief.methodology.notes).toContain(
      'The comparison could not tell the change from no change, so this brief reports no result about the change; see the first limitation.',
    );
    expect(brief.sections.map((entry) => entry.id)).toEqual([...BRIEF_SECTION_IDS]);
    expect(lintText(NO_DIRECTION_NOTICE)).toEqual([]);
    expect(lintText(BRIEF_READING_NOTES['no-direction'])).toEqual([]);
  });

  it('is the same brief every time', () => {
    expect(make()).toEqual(make());
  });

  it('still links the first recommendation, and says so, when the analysis wrote no direction finding', () => {
    const analysis = analysisWith({ impact: 0, finding: 'none' });
    const brief = buildBrief(inputsFor(analysis));
    expect(brief.signal).toBe('no-direction');
    expect(brief.recommendations[0]?.text).toBe(SAY_DIRECTION);
    expect(brief.recommendations[0]?.linkedFindingIds).toEqual([analysis.findings[0]?.id]);
    expect(brief.validationPlan[0]?.targets[0]).toBe(
      'assumption: the direction of impact of every stakeholder',
    );
    const stability = section(brief, 'executive-answer').statements[1];
    expect(stability?.text).toContain('no finding about the direction against the baseline');
    expect(stability?.origin).toBe('unresolved-uncertainty');
  });

  it('is not claimed when a variant gives someone a direction of its own', () => {
    const brief = buildBrief(
      inputsFor(analysisWith({ impact: 0, overrides: { subscribers: -0.5 }, finding: 'lower' })),
    );
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toMatch(COUNTS);
  });

  it('keeps the whole notice in the headline however long the labels and the engine description are', () => {
    const base = analysisWith({ impact: 0 });
    const long = 'L'.repeat(120);
    const analysis = analysisSchema.parse({
      ...base,
      config: {
        ...base.config,
        variants: base.config.variants.map((variant) => ({ ...variant, label: long })),
      },
      fidelity: {
        ...base.fidelity,
        engine: 'hybrid',
        keyActors: 'model',
        modelRepeats: 3,
        label: 'Hybrid: key actors driven by a model, cohorts by rules',
      },
    });
    const { headline } = buildBrief(inputsFor(analysis));
    expect(headline.length).toBeLessThanOrEqual(700);
    expect(headline).toContain(NO_DIRECTION_NOTICE);
    expect(headline).toContain(
      'the hybrid engine (key actors driven by a model, cohorts by rules)',
    );
  });

  it('keeps the lead, the limits and the guard with everything a rich project has', () => {
    const rich = richAnalysis();
    const analysis = analysisSchema.parse({
      ...rich,
      actors: rich.actors.map((actor) => ({
        ...actor,
        traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0, spread: 0 } },
      })),
    });
    const actors = actorSetFixture();
    actors.actors = analysis.actors;
    const brief = buildBrief(richInputs({ analysis, actors }));
    expect(brief.signal).toBe('no-direction');
    expect(brief.recommendations[0]?.text).toBe(SAY_DIRECTION);
    expect(brief.recommendations[0]?.linkedFindingIds).toEqual(['f1']);
    expect(brief.recommendations.length).toBeLessThanOrEqual(12);
    expect(brief.validationPlan[0]?.question).toContain('Who is helped');
    expect(brief.validationPlan.length).toBeLessThanOrEqual(8);
    expect(brief.limitations[0]).toBe(NO_DIRECTION_NOTICE);
    expect(lintBrief(brief)).toEqual([]);
    expect(brief.methodology.notes.join(' ')).not.toContain('withheld');
    expect(brief.sections.map((entry) => entry.id)).toEqual([...BRIEF_SECTION_IDS]);
  });
});

describe('when the stakeholders have directions and the two still come out about the same', () => {
  const quiet = (settings: Settings = {}) =>
    analysisWith({ baselineAdverse: 0.1, changeAdverse: 0.12, ...settings });
  const make = (settings: Settings = {}) => buildBrief(inputsFor(quiet(settings)));

  it('says "no measurable difference under these assumptions" instead of leading with counts', () => {
    const brief = make();
    expect(brief.signal).toBe('no-difference');
    expect(brief.headline).toContain('there is no measurable difference under these assumptions');
    expect(brief.headline).toContain('ended up about the same under “Proposed change”');
    expect(brief.headline).toContain('in 10 of 10 paired runs');
    expect(brief.headline).toContain('no simulated group moved clearly on its own');
    expect(brief.headline).not.toMatch(COUNTS);
    expect(brief.headline).toMatch(/^With the rules engine, there is no measurable difference/u);
  });

  it('keeps the answer a statement about the simulation, linked to the finding, with the caveat after it', () => {
    const executive = section(make(), 'executive-answer');
    const [answer, stability, caveat, notTold] = executive.statements;
    expect(answer).toMatchObject({ origin: 'simulation-aggregation', reliance: 'moderate' });
    expect(answer?.refs.findingIds).toEqual([SAME_ID]);
    expect(stability?.text).toContain('not as the same in the world');
    expect(caveat?.text).toContain('Biggest open caveat');
    expect(notTold?.text).toContain('that the change makes no difference in the world');
    expect(make().headline).toContain('Biggest open caveat');
  });

  it('keeps the first limitation for it, and does not turn it into a recommendation to do nothing', () => {
    const brief = make();
    expect(brief.limitations[0]).toBe(NO_DIFFERENCE_NOTICE);
    expect(section(brief, 'limitations').statements[0]?.origin).toBe('unresolved-uncertainty');
    expect(brief.recommendations.map((recommendation) => recommendation.text)).not.toContain(
      SAY_DIRECTION,
    );
    for (const recommendation of brief.recommendations) {
      expect(recommendation.text).not.toMatch(/^(Mitigate|Build on)/u);
    }
    expect(brief.validationPlan[0]?.question).not.toContain('Who is helped');
  });

  it('reads the comparison in stance, not in counts, and attributes no risk or opportunity to the change', () => {
    const brief = make();
    const outcomes = section(brief, 'alternative-outcomes').statements;
    expect(outcomes[0]?.text).toBe(BRIEF_READING_NOTES['no-difference']);
    const against = outcomes.find((statement) => statement.text.startsWith('Against '));
    expect(against?.text).toContain('moved the mean final stance of simulated members by');
    expect(against?.text).toContain('which the comparison reads as about the same');
    expect(against?.text).not.toMatch(COUNTS);
    expect(outcomes.some((statement) => statement.text.startsWith('From fewest to most'))).toBe(
      false,
    );
    expect(section(brief, 'first-order').statements[1]?.text).toContain(
      'No first-order effect is singled out',
    );
    expect(section(brief, 'risks-opportunities').statements).toHaveLength(1);
    expect(section(brief, 'reaction-patterns').statements[0]?.text).toBe(
      BRIEF_READING_NOTES['no-difference'],
    );
  });

  it('passes the wording guard', () => {
    expect(lintBrief(make())).toEqual([]);
    expect(lintText(NO_DIFFERENCE_NOTICE)).toEqual([]);
    expect(lintText(BRIEF_READING_NOTES['no-difference'])).toEqual([]);
  });

  it('also holds when every change has no strength, which is not a missing direction', () => {
    const brief = make({ intensity: 0, baselineAdverse: 0.1, changeAdverse: 0.1 });
    expect(brief.signal).toBe('no-difference');
    expect(brief.limitations[0]).not.toContain('No stakeholder has an expected direction');
  });

  it.each([
    ['the finding did not hold often enough', { classification: 'unstable' as const, holdsIn: 5 }],
    [
      'another finding says the change moved things, repeatably',
      { alsoLower: 'mostly-repeatable' as const },
    ],
    ['the analysis found the change less favourable', { finding: 'lower' as const }],
    ['there is no direction finding to rest on', { finding: 'none' as const }],
    [
      'one group moved clearly on its own, though the overall stance did not',
      { moved: { actorId: 'subscribers', adverse: 0.4, stance: -0.3 } },
    ],
    [
      'one group moved in how many looked for an alternative, with the same stance',
      { moved: { actorId: 'subscribers', adverse: 0.3, stance: 0.1 } },
    ],
  ])('is not claimed when %s', (_, settings) => {
    const brief = make(settings);
    expect(brief.signal).toBe('clear');
    expect(brief.headline).not.toContain('no measurable difference');
  });

  it('is still claimed when the finding against it was not repeatable', () => {
    expect(make({ alsoLower: 'unstable' }).signal).toBe('no-difference');
  });

  it('does not touch a brief that can be read: the paired comparison leads, as the answer', () => {
    const brief = make({ finding: 'lower', changeAdverse: 0.45 });
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toMatch(
      /the mean share of simulated members looking for an alternative or resisting was about \d+(?:\.\d+)? in 100 under/u,
    );
    expect(brief.recommendations.map((recommendation) => recommendation.text)).not.toContain(
      SAY_DIRECTION,
    );
    expect(brief.limitations[0]).toContain('Synthetic actors are not real people');
    expect(lintBrief(brief)).toEqual([]);
  });

  it('has nothing to compare when no baseline was run, and then says what it said before', () => {
    const base = analysisWith({ impact: 0 });
    const alone = analysisSchema.parse({
      ...base,
      config: { ...base.config, variants: base.config.variants.slice(1) },
      variants: base.variants.slice(1),
    });
    const brief = buildBrief(inputsFor(alone));
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toContain('No baseline was run, so nothing is compared.');
  });
});

/** The analysis with more scenarios, each compared with no change by a finding of its own. */
function withScenarios(
  analysis: Analysis,
  extra: {
    id: string;
    label: string;
    adverse: number;
    stance: number;
    finding: 'same' | 'lower';
  }[],
): Analysis {
  const proposed = analysis.config.variants.find((variant) => variant.id === 'proposed-change')!;
  const template = analysis.variants.find((result) => result.variantId === 'proposed-change')!;
  const runsOf = (adverse: number, stance: number) =>
    template.runs.map((run) => ({
      ...run,
      stanceMean: stance,
      responseShares: shares(adverse),
      byActor: run.byActor.map((entry) => ({
        ...entry,
        stanceMean: stance,
        responseShares: shares(adverse),
      })),
    }));
  return analysisSchema.parse({
    ...analysis,
    config: {
      ...analysis.config,
      variants: [
        ...analysis.config.variants,
        ...extra.map((entry) => ({ ...proposed, id: entry.id, label: entry.label })),
      ],
    },
    variants: [
      ...analysis.variants,
      ...extra.map((entry) => ({
        variantId: entry.id,
        runs: runsOf(entry.adverse, entry.stance),
        trajectory: template.trajectory,
      })),
    ],
    findings: [
      ...analysis.findings,
      ...extra.map((entry) => ({
        ...directionFinding(
          `direction-${entry.id}`,
          (entry.finding === 'same' ? sameStatement(OF) : lowerStatement(OF)).replace(
            'Proposed change',
            entry.label,
          ),
          OF,
          'mostly-repeatable',
        ),
        variantId: entry.id,
      })),
    ],
  });
}

describe('when the proposed change comes out about the same and another scenario does not', () => {
  const world = () =>
    withScenarios(analysisWith({ baselineAdverse: 0.1, changeAdverse: 0.12 }), [
      {
        id: 'strong-alternative',
        label: 'Strong alternative',
        adverse: 0.45,
        stance: -0.3,
        finding: 'lower',
      },
      {
        id: 'mild-alternative',
        label: 'Mild alternative',
        adverse: 0.1,
        stance: 0.1,
        finding: 'same',
      },
    ]);
  const brief = () => buildBrief(inputsFor(world()));
  const outcomes = () => section(brief(), 'alternative-outcomes').statements;

  it('reads the state of the proposed change, and each other scenario against no change on its own findings', () => {
    const { signal } = gatherFacts(inputsFor(world()));
    expect(signal.state).toBe('no-difference');
    expect(signal.finding?.variantId).toBe('proposed-change');
    expect([...signal.sameAs.keys()]).toEqual(['proposed-change', 'mild-alternative']);
    expect(brief().signal).toBe('no-difference');
  });

  it('words as about the same only the scenarios whose own findings say so', () => {
    const against = (label: string) =>
      outcomes().find((statement) => statement.text.startsWith(`Against “No change”, “${label}”`));
    expect(against('Proposed change')?.text).toContain(
      'which the comparison reads as about the same',
    );
    expect(against('Mild alternative')?.text).toContain(
      'which the comparison reads as about the same',
    );
    const strong = against('Strong alternative');
    expect(strong?.text).not.toContain('about the same');
    expect(strong?.text).toMatch(/higher under the change in 10 of 10 paired runs/u);
    expect(strong?.text).toMatch(/looking for an alternative or resisting/u);
    expect(strong?.refs.findingIds).toEqual(['direction-strong-alternative']);
    expect(strong?.refs.variantIds).toEqual(['strong-alternative', 'baseline']);
  });

  it('never says of a scenario that it is about the same, or within noise, where its own finding says it moved things', () => {
    const statements = brief()
      .sections.flatMap((entry) => entry.statements)
      .filter((statement) => statement.text.includes('Strong alternative'));
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.text, statement.text).not.toMatch(/about the same|within noise/u);
    }
  });

  it('says in the notice and in the note of each section that no difference is said of the proposed change only', () => {
    expect(NO_DIFFERENCE_NOTICE).toContain('between the proposed change and no change');
    expect(NO_DIFFERENCE_NOTICE).toContain(
      'Other scenarios are read against no change on their own',
    );
    expect(BRIEF_SIGNAL_NOTICES['no-difference'].title).toContain('for the proposed change');
    expect(BRIEF_READING_NOTES['no-difference']).toContain('said of the proposed change only');
    for (const text of [NO_DIFFERENCE_NOTICE, BRIEF_READING_NOTES['no-difference']]) {
      expect(text).not.toMatch(/\bnoise\b/u);
      expect(lintText(text)).toEqual([]);
    }
    expect(outcomes()[0]?.text).toBe(BRIEF_READING_NOTES['no-difference']);
    expect(brief().limitations[0]).toBe(NO_DIFFERENCE_NOTICE);
    expect(brief().methodology.notes.join(' ')).toContain('said of the proposed change only');
    const risks = section(brief(), 'risks-opportunities').statements;
    expect(risks[0]?.text).toContain('attributed to the proposed change');
    expect(section(brief(), 'first-order').statements[1]?.text).toContain(
      'singled out for the proposed change',
    );
  });

  it('does not leave the scenario that moved things out of the answer: it says that no difference is said of the proposed change only', () => {
    const answer = section(brief(), 'executive-answer').statements;
    const other = answer.find((statement) => statement.text.startsWith('This is said of'));
    expect(other?.text).toContain(
      '“Proposed change” only. In the simulated runs another scenario did differ from no change:',
    );
    expect(other?.text).toContain('less favourable under Strong alternative than under No change');
    expect(other?.text).not.toContain('Mild alternative');
    expect(other?.origin).toBe('simulation-aggregation');
    expect(other?.refs.findingIds).toEqual(['direction-strong-alternative']);
    expect(other?.refs.variantIds).toEqual(['strong-alternative']);
    expect(brief().headline).not.toContain('Strong alternative');
    expect(lintBrief(brief())).toEqual([]);
    // Nothing of the kind where the proposed change is the one that moved, or where every scenario came out the same.
    const nothing = (analysis: Analysis) =>
      section(buildBrief(inputsFor(analysis)), 'executive-answer').statements.some((statement) =>
        statement.text.startsWith('This is said of'),
      );
    expect(nothing(analysisWith({ baselineAdverse: 0.1, changeAdverse: 0.12 }))).toBe(false);
    expect(
      nothing(
        withScenarios(analysisWith({ finding: 'lower', changeAdverse: 0.45 }), [
          {
            id: 'mild-alternative',
            label: 'Mild alternative',
            adverse: 0.05,
            stance: 0.1,
            finding: 'same',
          },
        ]),
      ),
    ).toBe(false);
  });

  it('does not word the proposed change as about the same when it is the one that moved, whatever the others did', () => {
    const moved = withScenarios(analysisWith({ finding: 'lower', changeAdverse: 0.45 }), [
      {
        id: 'mild-alternative',
        label: 'Mild alternative',
        adverse: 0.05,
        stance: 0.1,
        finding: 'same',
      },
    ]);
    const { signal } = gatherFacts(inputsFor(moved));
    expect(signal.state).toBe('clear');
    expect([...signal.sameAs.keys()]).toEqual(['mild-alternative']);
    const statements = section(buildBrief(inputsFor(moved)), 'alternative-outcomes').statements;
    expect(statements.some((statement) => /reads as about the same/u.test(statement.text))).toBe(
      false,
    );
  });
});

describe('what is called no difference', () => {
  it('is not said of a shift that is small but holds the same way in every paired run', () => {
    // Six points of the simulated members adverse more, in every one of ten paired runs, with the stance as it was.
    const steady = analysisWith({ baselineAdverse: 0.05, changeAdverse: 0.11 });
    expect(gatherFacts(inputsFor(steady)).signal.state).toBe('clear');
    const faint = analysisWith({ baselineAdverse: 0.05, changeAdverse: 0.09 });
    expect(gatherFacts(inputsFor(faint)).signal.state).toBe('no-difference');
  });

  it('compares the totals kept for each scenario where the runs kept no detail of their groups, and claims nothing without them', () => {
    const quiet = analysisWith({ baselineAdverse: 0.1, changeAdverse: 0.12 });
    const elided = (totals: 'same' | 'moved' | 'none') =>
      analysisSchema.parse({
        ...quiet,
        variants: quiet.variants.map((result) => ({
          ...result,
          runs: result.runs.map((run) => ({ ...run, byActor: [] })),
          ...(totals === 'none'
            ? {}
            : {
                actors: quiet.actors.map((actor) => {
                  const moves =
                    totals === 'moved' &&
                    result.variantId === 'proposed-change' &&
                    actor.id === 'subscribers';
                  return {
                    actorId: actor.id,
                    members: actor.sampleSize,
                    stanceMean: moves ? -0.3 : 0.1,
                    responseShares: shares(moves ? 0.4 : 0.1),
                  };
                }),
              }),
        })),
      });
    expect(gatherFacts(inputsFor(elided('same'))).signal.state).toBe('no-difference');
    expect(gatherFacts(inputsFor(elided('moved'))).signal.state).toBe('clear');
    expect(gatherFacts(inputsFor(elided('none'))).signal.state).toBe('clear');
  });
});

describe('a change that helps a group and leaves the share looking for an alternative where it was', () => {
  const MORE_FAVOURABLE =
    'In 10 of 10 seeded runs, simulated members ended up more favourable under Proposed change than under No change on the same seed (overall stance higher by more than 0.01).';
  const helped = () => {
    const base = analysisWith({
      impact: 0,
      overrides: { subscribers: 0.8 },
      baselineAdverse: 0.05,
      changeAdverse: 0.05,
      changeStance: 0.5,
      finding: 'none',
      moved: { actorId: 'subscribers', adverse: 0.05, stance: 0.9 },
    });
    return analysisSchema.parse({
      ...base,
      findings: [
        directionFinding('direction-higher', MORE_FAVOURABLE, 10, 'repeatable'),
        directionFinding(
          'direction-subscribers',
          MORE_FAVOURABLE.replace('simulated members', 'simulated Subscribers'),
          10,
          'repeatable',
          'subscribers',
        ),
        ...base.findings,
      ],
    });
  };

  it('calls a tie in every paired run a steady result, not a rare rise to be repeated, and says what the stance did', () => {
    const brief = buildBrief(inputsFor(helped()));
    expect(brief.signal).toBe('clear');
    const executive = section(brief, 'executive-answer').statements;
    const stability = executive.find((statement) => statement.text.startsWith('Stability'))!;
    expect(stability.text).toContain(
      'the same with the change as without it in all 10 paired runs',
    );
    expect(stability.text).not.toMatch(/\brare\b|repeat the analysis/u);
    const conditional = executive.find((statement) => statement.text.startsWith('Recommendation'))!;
    expect(conditional.text).not.toContain('do not decide');
    expect(conditional.text).toContain('build on the favourable response of “Subscribers”');
    expect(brief.headline).toContain('no net difference in the mean');
    expect(brief.headline).toContain(
      'the same with the change as without it in all 10 paired runs',
    );
    expect(brief.headline).toContain(
      'The overall final stance, a different measure, was more favourable under the change',
    );
    expect(lintBrief(brief)).toEqual([]);
  });

  it('plans a check of the benefit that the advice builds on', () => {
    const brief = buildBrief(inputsFor(helped()));
    expect(brief.recommendations.some((entry) => entry.text.startsWith('Build on'))).toBe(true);
    const check = brief.validationPlan.find((experiment) =>
      experiment.question.startsWith('Is “Subscribers” harmed, helped or unaffected'),
    )!;
    expect(check).toBeDefined();
    expect(check.targets[0]).toContain(
      'assumed helped (set by the scenario that proposes the change)',
    );
  });

  it('keeps a tie out of the count of rises: the paired runs are divided into higher, lower and the same', () => {
    const quiet = pairShares(helped().variants[1]!.runs, helped().variants[0]!.runs);
    expect(quiet).toMatchObject({ pairs: 10, higher: 0, lower: 0, equal: 10 });
    expect(pairedRunsWords(quiet)).toBe(
      'the same with the change as without it in all 10 paired runs',
    );
  });
});

describe('when the proposed change comes out about the same and another scenario helps a group', () => {
  const world = () => {
    const base = withScenarios(analysisWith({ baselineAdverse: 0.1, changeAdverse: 0.12 }), [
      { id: 'option-b', label: 'Option B', adverse: 0.1, stance: 0.6, finding: 'same' },
    ]);
    return analysisSchema.parse({
      ...base,
      config: {
        ...base.config,
        variants: base.config.variants.map((variant) =>
          variant.id === 'option-b'
            ? { ...variant, impactOverrides: { subscribers: 0.9 } }
            : variant,
        ),
      },
      findings: [
        ...base.findings.filter((finding) => finding.variantId !== 'option-b'),
        {
          ...directionFinding(
            'direction-option-b-subscribers',
            'In 10 of 10 seeded runs, simulated Subscribers ended up more favourable under Option B than under No change on the same seed (overall stance higher by more than 0.01).',
            10,
            'repeatable',
            'subscribers',
          ),
          variantId: 'option-b',
        },
      ],
    });
  };

  it('keeps the proposed change free of advice and gives the helped scenario advice of its own', () => {
    const facts = gatherFacts(inputsFor(world()));
    expect(facts.signal.state).toBe('no-difference');
    const advice = advise(facts);
    const buildOn = advice.filter((entry) => entry.kind === 'build-on');
    expect(buildOn).toHaveLength(1);
    expect(buildOn[0]!.text).toContain('under “Option B”');
    expect(buildOn[0]!.refs.variantIds).toContain('option-b');
    expect(buildOn[0]!.linkedFindingIds).toEqual(['direction-option-b-subscribers']);
    expect(advice.some((entry) => entry.kind === 'mitigate')).toBe(false);
  });
});

describe('when nobody has an expected direction but the members of a group can still move', () => {
  const spread = (settings: Settings = {}) =>
    analysisWith({ impact: 0, impactSpread: 0.15, ...settings });

  it('is not read as a change that cannot move anyone, and says only that nobody has a direction', () => {
    const analysis = spread({ baselineAdverse: 0.1, changeAdverse: 0.12 });
    const { signal } = gatherFacts(inputsFor(analysis));
    expect(signal).toMatchObject({ state: 'no-difference', undirected: true });
    const brief = buildBrief(inputsFor(analysis));
    expect(brief.signal).toBe('no-difference');
    expect(brief.headline).not.toMatch(/cannot move anyone|\bnoise\b/u);
    expect(brief.limitations).not.toContain(NO_DIRECTION_NOTICE);
    const note = section(brief, 'alternative-outcomes').statements[0];
    expect(note?.origin).toBe('unresolved-uncertainty');
    expect(note?.text).toBe(`${BRIEF_READING_NOTES['no-difference']} ${UNDIRECTED_READING_NOTE}`);
    expect(lintBrief(brief)).toEqual([]);
  });

  it('keeps the missing direction in the headline however long the names of the scenarios are', () => {
    const analysis = spread({ finding: 'lower', changeAdverse: 0.45 });
    const named = (analysisWith: Analysis, length: number): Analysis =>
      analysisSchema.parse({
        ...analysisWith,
        config: {
          ...analysisWith.config,
          variants: analysisWith.config.variants.map((variant) => ({
            ...variant,
            label: `${variant.label} `.padEnd(length, 'x'),
          })),
        },
      });
    for (const length of [20, 115]) {
      const { headline } = buildBrief(inputsFor(named(analysis, length)));
      expect(headline.length).toBeLessThanOrEqual(700);
      expect(headline).toContain(
        'Biggest open caveat: no stakeholder has an expected direction of impact',
      );
      expect(headline).toMatch(COUNTS);
    }
  });

  it('keeps the limitation that nobody has a direction after the one that says what was found, and says nothing of nothing moving', () => {
    const quiet = buildBrief(inputsFor(spread({ baselineAdverse: 0.1, changeAdverse: 0.12 })));
    expect(quiet.limitations.slice(0, 2)).toEqual([NO_DIFFERENCE_NOTICE, UNDIRECTED_NOTICE]);
    const clear = buildBrief(inputsFor(spread({ finding: 'lower', changeAdverse: 0.45 })));
    expect(clear.limitations[0]).toBe(UNDIRECTED_NOTICE);
    expect(section(clear, 'limitations').statements[0]).toMatchObject({
      origin: 'system-assumption',
      text: UNDIRECTED_NOTICE,
    });
    // Nor does a cast in which someone has a direction carry it.
    const own = buildBrief(inputsFor(analysisWith({ finding: 'lower', changeAdverse: 0.45 })));
    expect(own.limitations).not.toContain(UNDIRECTED_NOTICE);
  });

  it('leads with the counts where the comparison found a difference, under a note that nobody has a direction', () => {
    const brief = buildBrief(inputsFor(spread({ finding: 'lower', changeAdverse: 0.45 })));
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toMatch(COUNTS);
    const note = section(brief, 'alternative-outcomes').statements[0];
    expect(note).toMatchObject({ origin: 'system-assumption', text: UNDIRECTED_READING_NOTE });
    expect(note?.refs.assumptions).toEqual(['No stakeholder has an expected direction of impact.']);
    expect(section(brief, 'reaction-patterns').statements[0]?.text).toBe(UNDIRECTED_READING_NOTE);
    expect(brief.recommendations[0]?.text).not.toBe(SAY_DIRECTION);
    expect(UNDIRECTED_READING_NOTE).not.toMatch(/cannot move anyone|\bnoise\b/u);
    expect(lintBrief(brief)).toEqual([]);
    expect(lintText(UNDIRECTED_READING_NOTE)).toEqual([]);
    expect(lintText(UNDIRECTED_NOTICE)).toEqual([]);
  });

  it('says nothing of it when someone has a direction, as a person or as a scenario gives it', () => {
    const own = buildBrief(inputsFor(analysisWith({ finding: 'lower', changeAdverse: 0.45 })));
    const edited = buildBrief(
      inputsFor(
        analysisWith({
          impact: 0,
          finding: 'lower',
          changeAdverse: 0.45,
          edits: [{ actorId: 'subscribers', trait: 'impact', value: -1 }],
        }),
      ),
    );
    for (const brief of [own, edited]) {
      expect(brief.signal).toBe('clear');
      const texts = brief.sections.flatMap((entry) => entry.statements.map((item) => item.text));
      expect(texts).not.toContain(UNDIRECTED_READING_NOTE);
    }
  });
});

function exportOf(brief: DecisionBrief, inputs: BriefInputs): BriefExportInput {
  return {
    brief,
    visuals: briefVisuals(gatherFacts(inputs)),
    project: { id: 'project-1', name: 'Fee review' },
    exportedAt: TIME,
    appVersion: '1.2.3',
  };
}

describe('the exports say so before anything else', () => {
  const noDirection = inputsFor(analysisWith({ impact: 0 }));
  const noDifference = inputsFor(analysisWith({ baselineAdverse: 0.1, changeAdverse: 0.12 }));
  const clear = inputsFor(analysisWith({ finding: 'lower', changeAdverse: 0.45 }));

  it.each([
    ['no-direction', noDirection],
    ['no-difference', noDifference],
  ] as const)(
    'puts the notice for %s first in the Markdown, ahead of the headline and the facts',
    (state, inputs) => {
      const brief = buildBrief(inputs);
      expect(brief.signal).toBe(state);
      const markdown = briefMarkdown(exportOf(brief, inputs));
      const { title, text } = BRIEF_SIGNAL_NOTICES[state];
      const notice = markdown.indexOf(`> **${title}**`);
      expect(notice).toBeGreaterThan(-1);
      expect(markdown.slice(notice)).toContain(text.slice(0, 60));
      expect(notice).toBeLessThan(markdown.indexOf('- **Question:**'));
      expect(notice).toBeLessThan(markdown.indexOf('## In short'));
      expect(markdown).toMatch(/not read as (?:effects|an effect) of the change/u);
      if (state === 'no-difference')
        expect(markdown).toContain('every other row is read on its own');
    },
  );

  it.each([
    ['no-direction', noDirection],
    ['no-difference', noDifference],
  ] as const)(
    'puts the notice for %s first in the printable page, boxed, ahead of the headline',
    (state, inputs) => {
      const brief = buildBrief(inputs);
      const html = briefHtml(exportOf(brief, inputs));
      const { title, text } = BRIEF_SIGNAL_NOTICES[state];
      const notice = html.indexOf(`<p class="alert"><strong>${title}</strong> `);
      expect(notice).toBeGreaterThan(-1);
      expect(html.slice(notice, notice + 1_000)).toContain(text.slice(0, 60));
      expect(notice).toBeLessThan(html.indexOf('<dl>'));
      expect(notice).toBeLessThan(html.indexOf('id="in-short"'));
      expect(html).toContain('.alert { border: 2px solid #111;');
      expect(html).not.toMatch(/<script|<img|<link|javascript:/iu);
    },
  );

  it('says nothing of the kind when the comparison can be read', () => {
    const brief = buildBrief(clear);
    const input = exportOf(brief, clear);
    expect(briefMarkdown(input)).not.toContain('could not tell the change from no change');
    expect(briefMarkdown(input)).not.toContain('not read as effects');
    expect(briefHtml(input)).not.toContain('class="alert"');
  });

  it('keeps the state in the data export', () => {
    const brief = buildBrief(noDirection);
    const parsed = JSON.parse(JSON.stringify(briefJson(exportOf(brief, noDirection)))) as {
      brief: DecisionBrief;
    };
    expect(parsed.brief.signal).toBe('no-direction');
  });
});

// ---- the real engine

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 1_500; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The condition was not reached in time.');
}

interface EngineWorldOptions {
  /** Changes the cast after its impacts are set. */
  cast?: (actors: ActorSet) => void;
  /** The scenarios to compare, where the person chose their own. */
  variants?: Variant[];
}

/** A project whose cast has the stated impact, compared by the real engine in rules mode. */
async function engineWorld(impact: number | null, options: EngineWorldOptions = {}) {
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: '50' }),
  });
  applications.push(instance);
  const { app, repository } = instance;
  const project = repository.create(fixtureInput({ workflow: 'guided' }));
  const actors = actorSetFixture();
  if (impact !== null) {
    for (const actor of actors.actors) {
      actor.traits.impact = { ...actor.traits.impact, value: impact, spread: 0 };
    }
  }
  options.cast?.(actors);
  repository.artifacts.put(project.id, 'actors', 'default', actors);
  repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
  const base = `/api/projects/${project.id}`;
  const started = await app.inject({
    method: 'POST',
    url: `${base}/analysis`,
    payload: {
      runsPerVariant: 10,
      baseSeed: 4242,
      sensitivity: true,
      ...(options.variants ? { variants: options.variants } : {}),
    },
  });
  expect(started.statusCode, started.body).toBe(202);
  const id = (started.json().analysis as Analysis).id;
  const analysis = await until(
    async () => (await app.inject(`${base}/analysis/${id}`)).json().analysis as Analysis,
    (value) => !['running', 'queued'].includes(value.status),
  );
  expect(analysis.status).toBe('completed');
  const made = await app.inject({ method: 'POST', url: `${base}/brief`, payload: {} });
  expect(made.statusCode, made.body).toBe(201);
  return { app, base, analysis, view: made.json() as BriefView };
}

const NO_CHANGE: Variant = {
  id: 'baseline',
  label: 'No change',
  kind: 'baseline',
  description: 'Nothing changes.',
  round: 1,
  intensity: 0,
  impactOverrides: {},
  traitEdits: [],
};
const scenario = (change: Partial<Variant>): Variant => ({
  ...NO_CHANGE,
  id: 'proposed-change',
  label: 'Proposed change',
  kind: 'alternative',
  description: 'The change as framed. Its intensity was set by you.',
  round: 2,
  intensity: 0.7,
  ...change,
});

/** How many simulated members ended up looking for an alternative or resisting, summed over the runs of a scenario. */
const adverseOver = (analysis: Analysis, variantId: string): number =>
  analysis.variants
    .find((result) => result.variantId === variantId)!
    .runs.reduce(
      (total, run) =>
        total +
        run.byActor.reduce(
          (sum, entry) =>
            sum + (entry.responseShares.switch + entry.responseShares.resist) * entry.members,
          0,
        ),
      0,
    );

describe('on the real engine', () => {
  it('does not present noise as a result when no stakeholder has a direction of impact', async () => {
    const { app, base, analysis, view } = await engineWorld(0);
    expect(analysis.findings.some(isAboutTheSame)).toBe(true);
    const brief = view.brief!;
    expect(brief.signal).toBe('no-direction');
    expect(brief.headline).toContain('could not tell the change from no change');
    expect(brief.headline).toContain(NO_DIRECTION_NOTICE);
    expect(brief.headline).not.toMatch(COUNTS);
    expect(brief.recommendations[0]?.text).toBe(SAY_DIRECTION);
    expect(analysis.findings.map((finding) => finding.id)).toContain(
      brief.recommendations[0]?.linkedFindingIds[0],
    );
    expect(brief.validationPlan[0]?.question).toContain('Who is helped and who is harmed');
    expect(brief.limitations[0]).toBe(NO_DIRECTION_NOTICE);
    expect(lintBrief(brief)).toEqual([]);

    const markdown = (await app.inject(`${base}/brief/export?format=md`)).body;
    expect(markdown).toContain('> **The simulation could not tell the change from no change**');
    expect(markdown).toContain('No stakeholder has an expected direction of impact');
    const html = (await app.inject(`${base}/brief/export?format=html`)).body;
    expect(html).toContain('<p class="alert"><strong>The simulation could not tell');
  });

  it('does not call the change unable to move anyone when nobody has a direction but a large group differs in how it lands on its members', async () => {
    const { app, base, analysis, view } = await engineWorld(0, {
      cast: (set) => {
        const group = set.actors.find((actor) => actor.id === 'subscribers')!;
        group.sampleSize = 200;
        group.traits.impact = { ...group.traits.impact, spread: 0.5 };
      },
    });
    // The change does move members here, and nothing but chance sits on the other side of the comparison.
    expect(adverseOver(analysis, 'proposed-change')).toBeGreaterThan(
      adverseOver(analysis, 'baseline') + 100,
    );
    const brief = view.brief!;
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toMatch(COUNTS);
    expect(brief.headline).not.toMatch(/cannot move anyone|\bnoise\b|no measurable difference/u);
    expect(brief.limitations[0]).not.toBe(NO_DIRECTION_NOTICE);
    expect(section(brief, 'alternative-outcomes').statements[0]?.text).toBe(
      UNDIRECTED_READING_NOTE,
    );
    // The answer itself is not given as if a direction were set: the missing direction is the first
    // caveat and the first thing to settle, and no go-ahead is offered on a plan that omits it.
    const answer = section(brief, 'executive-answer').statements.map((statement) => statement.text);
    expect(answer.find((text) => text.startsWith('Biggest open caveat'))).toContain(
      'no stakeholder has an expected direction of impact',
    );
    expect(answer.find((text) => text.startsWith('Recommendation'))).toMatch(
      /^Recommendation: do not decide on this simulated comparison yet\. No stakeholder has an expected direction of impact/u,
    );
    expect(brief.recommendations[0]?.text).toBe(SAY_DIRECTION_UNDIRECTED);
    expect(brief.validationPlan[0]?.question).toContain('Who is helped and who is harmed');
    expect(lintBrief(brief)).toEqual([]);
    const listed = (await app.inject(`${base}/analysis`)).json() as {
      readiness: AnalysisReadiness;
    };
    expect(listed.readiness.warnings).toEqual([UNDIRECTED_NOTICE]);
    const review = await app.inject({ method: 'POST', url: `${base}/critiques/run`, payload: {} });
    const ids = (review.json() as CritiquesView).critiques!.critiques.map(
      (critique) => critique.id,
    );
    expect(ids).toContain('methodology-no-declared-direction');
    expect(ids).not.toContain(CHANGE_CANNOT_MOVE_ID);
  });

  it('does not call the change unable to move anyone when a scenario edits the impact of an actor', async () => {
    const edited = scenario({
      traitEdits: [{ actorId: 'subscribers', trait: 'impact', value: -1 }],
    });
    const { analysis, view } = await engineWorld(0, { variants: [NO_CHANGE, edited] });
    expect(adverseOver(analysis, 'proposed-change')).toBeGreaterThan(
      adverseOver(analysis, 'baseline') + 20,
    );
    const direction = analysis.findings.find((finding) => finding.kind === 'direction-vs-baseline');
    expect(direction?.statement).toContain('less favourable');
    const brief = view.brief!;
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toMatch(COUNTS);
    expect(brief.headline).not.toMatch(/cannot move anyone|\bnoise\b|no measurable difference/u);
    expect(brief.limitations[0]).not.toBe(NO_DIRECTION_NOTICE);
    expect(
      brief.sections.flatMap((entry) => entry.statements.map((statement) => statement.text)),
    ).not.toContain(UNDIRECTED_READING_NOTE);
  });

  it('words a scenario that moved things by its own findings when the proposed change came out about the same', async () => {
    const weak = scenario({ impactOverrides: { provider: -0.02 } });
    const strong = scenario({
      id: 'strong-alternative',
      label: 'Strong alternative',
      intensity: 1,
      impactOverrides: { subscribers: -1 },
    });
    const { analysis, view } = await engineWorld(0, { variants: [NO_CHANGE, weak, strong] });
    const directions = (variantId: string) =>
      analysis.findings.find(
        (finding) => finding.kind === 'direction-vs-baseline' && finding.variantId === variantId,
      );
    expect(directions('proposed-change')?.statement).toContain('about the same');
    expect(directions('strong-alternative')?.statement).toContain('less favourable');
    const brief = view.brief!;
    expect(brief.signal).toBe('no-difference');
    const outcomes = section(brief, 'alternative-outcomes').statements.map(
      (statement) => statement.text,
    );
    const against = (label: string) =>
      outcomes.find((text) => text.startsWith(`Against “No change”, “${label}”`));
    expect(against('Proposed change')).toContain('reads as about the same');
    expect(against('Strong alternative')).toMatch(
      /higher under the change in \d+ of 10 paired runs/u,
    );
    expect(against('Strong alternative')).not.toContain('about the same');
    expect(brief.limitations[0]).toContain('between the proposed change and no change');
    expect(lintBrief(brief)).toEqual([]);
  });

  it('keeps the paired comparison as the answer when the stakeholders have directions of impact', async () => {
    const { analysis, view } = await engineWorld(null);
    const brief = view.brief!;
    expect(analysis.findings.some(isAboutTheSame)).toBe(false);
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toMatch(
      /the mean share of simulated members looking for an alternative or resisting was about \d+(?:\.\d+)? in 100 under “Proposed change” against \d+(?:\.\d+)? in 100 under “No change”/u,
    );
    expect(brief.recommendations.map((recommendation) => recommendation.text)).not.toContain(
      SAY_DIRECTION,
    );
    expect(lintBrief(brief)).toEqual([]);
  });
});
