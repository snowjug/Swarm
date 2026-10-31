import { afterEach, describe, expect, it } from 'vitest';
import {
  analysisSchema,
  emptyResponseShares,
  type Analysis,
  type Finding,
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
import { NO_DIRECTION_NOTICE } from '../../shared/signal.js';
import { buildApp } from '../src/app.js';
import { buildBrief } from '../src/brief/build.js';
import { briefHtml, briefJson, briefMarkdown, type BriefExportInput } from '../src/brief/export.js';
import { gatherFacts, type BriefInputs } from '../src/brief/facts.js';
import { lintBrief, lintText } from '../src/brief/lint.js';
import { SAY_DIRECTION } from '../src/brief/recommend.js';
import { isAboutTheSame } from '../src/brief/signal.js';
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
  /** Every stakeholder's impact; the fixture's own directions when left out. */
  impact?: number;
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
          traits: { ...actor.traits, impact: { ...actor.traits.impact, value: settings.impact } },
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
        traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0 } },
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

  it('does not touch a brief that can be read: counts lead, as before', () => {
    const brief = make({ finding: 'lower', changeAdverse: 0.45 });
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toMatch(
      /about \d+ simulated members ended up looking for an alternative/u,
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
      expect(markdown).toContain('not read as effects of the change');
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

/** A project whose cast has the stated impact, compared by the real engine in rules mode. */
async function engineWorld(impact: number | null) {
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
  repository.artifacts.put(project.id, 'actors', 'default', actors);
  repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
  const base = `/api/projects/${project.id}`;
  const started = await app.inject({
    method: 'POST',
    url: `${base}/analysis`,
    payload: { runsPerVariant: 10, baseSeed: 4242, sensitivity: true },
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

  it('keeps the counts as the answer when the stakeholders have directions of impact', async () => {
    const { analysis, view } = await engineWorld(null);
    const brief = view.brief!;
    expect(analysis.findings.some(isAboutTheSame)).toBe(false);
    expect(brief.signal).toBe('clear');
    expect(brief.headline).toMatch(
      /about \d+ simulated members ended up looking for an alternative or resisting under “Proposed change”/u,
    );
    expect(brief.recommendations.map((recommendation) => recommendation.text)).not.toContain(
      SAY_DIRECTION,
    );
    expect(lintBrief(brief)).toEqual([]);
  });
});
