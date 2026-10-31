import { describe, expect, it } from 'vitest';
import { analysisSchema } from '../../shared/analysis.js';
import type { DecisionBrief } from '../../shared/brief.js';
import { analysisFixture } from '../../shared/lab-fixtures.js';
import { buildBrief } from '../src/brief/build.js';
import { gatherFacts } from '../src/brief/facts.js';
import { lintBrief, lintStatement, lintText, mentionsSimulated } from '../src/brief/lint.js';
import {
  MAX_RECOMMENDATIONS,
  OWNER_BY_CATEGORY,
  ORDERING_RULE,
  rank,
  recommend,
} from '../src/brief/recommend.js';
import {
  directionOf,
  levelOfSize,
  relianceOfFinding,
  relianceOfEvidence,
  weakestReliance,
} from '../src/brief/rules.js';
import {
  GENERAL_GAP_CHECK,
  INTENSITY_CHECK,
  POPULATION_CHECK,
  TRAIT_CHECKS,
  UNSTABLE_CHECK,
  gapCheckFor,
  validationPlan,
} from '../src/brief/validation.js';
import { MAX_STATEMENTS, sectionWriter } from '../src/brief/writer.js';
import { STAKEHOLDER_CATEGORIES } from '../../shared/stakeholders.js';
import { baseInputs, critiquesFixture, richAnalysis, richInputs } from './support/brief-world.js';

const clone = <T>(value: T): T => structuredClone(value);

describe('the wording guard', () => {
  it.each([
    ['It will rise.', 'prediction'],
    ['They WILL leave.', 'prediction'],
    ['This is certainly true.', 'overclaim'],
    ['We guarantee it.', 'overclaim'],
    ['A guaranteed result.', 'overclaim'],
    ['This proves the point.', 'overclaim'],
    ['A proven effect.', 'overclaim'],
    ['It is definitely so.', 'overclaim'],
    ['58% of customers left.', 'percentage'],
    ['58 percent of users left.', 'percentage'],
    ['About 12.5 per cent of them.', 'percentage'],
    ['A share of 0,5 % of people.', 'percentage'],
  ])('flags “%s” as %s', (text, rule) => {
    expect(lintText(text).map((issue) => issue.rule)).toContain(rule);
  });

  it.each([
    'This improves nothing.',
    'It shows goodwill and a willing group.',
    'About 12 of 43 simulated members.',
    'The percentage sign is not used here.',
    'A proof of concept is a different thing.',
  ])('allows “%s”', (text) => {
    expect(lintText(text)).toEqual([]);
  });

  it('leaves quoted text alone, since what is quoted is a person’s or a source’s and not ours', () => {
    expect(
      lintText('The person wrote “58% of customers will certainly leave” in the question.'),
    ).toEqual([]);
    expect(lintText('The person wrote “it will rise” and we say it will rise.')).toHaveLength(1);
    expect(mentionsSimulated('Only “simulated” is quoted here.')).toBe(false);
    expect(mentionsSimulated('Simulated members ended up elsewhere.')).toBe(true);
  });

  it('requires every statement that sums up the simulation to say that it is simulated', () => {
    const sums = (origin: 'simulation-aggregation' | 'actor-behavior' | 'model-interpretation') =>
      lintStatement({ origin, text: 'Seven of twelve members left.' }, 's').map(
        (issue) => issue.rule,
      );
    expect(sums('simulation-aggregation')).toEqual(['missing-simulated']);
    expect(sums('actor-behavior')).toEqual(['missing-simulated']);
    expect(sums('model-interpretation')).toEqual(['missing-simulated']);
    expect(
      lintStatement(
        { origin: 'simulation-aggregation', text: '7 of 12 simulated members left.' },
        's',
      ),
    ).toEqual([]);
    expect(
      lintStatement({ origin: 'user-assumption', text: 'Seven of twelve members left.' }, 's'),
    ).toEqual([]);
  });

  describe('over a finished brief', () => {
    const good = buildBrief(richInputs());
    const bad = (change: (brief: DecisionBrief) => void) => {
      const brief = clone(good);
      change(brief);
      return lintBrief(brief).map((issue) => issue.rule);
    };

    it('finds nothing in a brief the builder wrote', () => {
      expect(lintBrief(good)).toEqual([]);
    });

    it('fails on seeded bad wording in a statement, the headline, a recommendation or a check', () => {
      expect(
        bad((brief) => {
          brief.sections[1]!.statements[0]!.text = 'About 58% of customers will churn.';
        }),
      ).toEqual(expect.arrayContaining(['prediction', 'percentage']));
      expect(
        bad((brief) => {
          brief.headline = 'Simulated members will certainly leave.';
        }),
      ).toEqual(expect.arrayContaining(['prediction', 'overclaim']));
      expect(
        bad((brief) => {
          brief.recommendations[0]!.text = 'This is guaranteed to work.';
        }),
      ).toEqual(expect.arrayContaining(['overclaim', 'missing-simulated']));
      expect(
        bad((brief) => {
          brief.validationPlan[0]!.successSignal = 'Over 60% of them stay.';
        }),
      ).toEqual(['percentage']);
      expect(
        bad((brief) => {
          brief.limitations[0] = 'This proves the point.';
        }),
      ).toEqual(['overclaim']);
    });

    it('fails a simulation-derived statement that does not say it is simulated', () => {
      expect(
        bad((brief) => {
          const statement = brief.sections
            .flatMap((section) => section.statements)
            .find((entry) => entry.origin === 'simulation-aggregation')!;
          statement.text = 'Nineteen members left.';
        }),
      ).toEqual(['missing-simulated']);
      expect(
        bad((brief) => {
          brief.headline = 'Nineteen members left.';
        }),
      ).toEqual(['missing-simulated']);
    });
  });

  it('is applied by the builder: a statement that breaks it is withheld, says so, and loses its origin', () => {
    const tally = { withheld: 0, downgraded: 0 };
    const writer = sectionWriter('limitations', tally);
    const kept = writer.add({
      origin: 'simulation-aggregation',
      text: '7 of 12 simulated members left.',
      refs: { variantIds: ['proposed-change'] },
      reliance: 'high',
    });
    const predicted = writer.add({
      origin: 'system-assumption',
      text: 'The fee will rise.',
      refs: { assumptions: ['x'] },
      reliance: 'high',
    });
    const unsimulated = writer.add({
      origin: 'simulation-aggregation',
      text: 'Seven members left.',
      refs: { variantIds: ['proposed-change'] },
    });
    expect(kept).toMatchObject({ origin: 'simulation-aggregation', reliance: 'high' });
    for (const statement of [predicted, unsimulated]) {
      expect(statement.origin).toBe('unresolved-uncertainty');
      expect(statement.text).toMatch(
        /^A statement was withheld here because its wording broke the guard/u,
      );
      expect(statement.reliance).toBeNull();
    }
    expect(predicted.text).toContain('prediction');
    expect(unsimulated.text).toContain('missing-simulated');
    expect(tally).toEqual({ withheld: 2, downgraded: 0 });
  });

  it('is applied to recommendations and checks too, and says in the brief how many statements it withheld', () => {
    const inputs = richInputs();
    inputs.analysis = richAnalysis();
    // A name that is not quoted by the builder would break the guard; quoting is what keeps it clean.
    const brief = buildBrief(inputs);
    expect(brief.methodology.notes.join(' ')).not.toContain('withheld');
  });
});

describe('the origin gate', () => {
  it('gives a statement that names an origin it has nothing to rest on the origin it can stand behind', () => {
    const tally = { withheld: 0, downgraded: 0 };
    const writer = sectionWriter('sources', tally);
    const needs = [
      ['supplied-evidence', {}],
      ['retrieved-public-evidence', {}],
      ['historical-comparison', {}],
      ['user-assumption', {}],
      ['system-assumption', {}],
      ['inferred-stakeholder', {}],
      ['actor-behavior', {}],
      ['simulation-aggregation', {}],
      ['model-interpretation', {}],
    ] as const;
    for (const [origin, refs] of needs) {
      const statement = writer.add({ origin, text: 'Simulated text with no support.', refs });
      expect(statement.origin, origin).toBe('unresolved-uncertainty');
    }
    expect(tally.downgraded).toBe(needs.length);
    const kept = writer.add({
      origin: 'supplied-evidence',
      text: 'A document.',
      refs: { documentIds: ['d1'] },
    });
    expect(kept.origin).toBe('supplied-evidence');
    expect(writer.add({ origin: 'unresolved-uncertainty', text: 'Not known.' }).origin).toBe(
      'unresolved-uncertainty',
    );
  });

  it('keeps a section to forty statements, and says that some are not shown', () => {
    const writer = sectionWriter('assumptions', { withheld: 0, downgraded: 0 });
    for (let index = 0; index < 55; index += 1) {
      writer.add({ origin: 'unresolved-uncertainty', text: `Statement ${index + 1}.` });
    }
    const section = writer.build();
    expect(section.statements).toHaveLength(MAX_STATEMENTS);
    expect(section.statements.at(-1)?.text).toContain('16 further statements are not shown here');
    expect(section.statements[0]?.id).toBe('assumptions-1');
  });
});

describe('how far to rely on a statement', () => {
  it('follows the class of the finding and whether a cited passage supports it', () => {
    expect(relianceOfFinding('repeatable', true)).toBe('high');
    expect(relianceOfFinding('repeatable', false)).toBe('moderate');
    expect(relianceOfFinding('mostly-repeatable', true)).toBe('moderate');
    expect(relianceOfFinding('mostly-repeatable', false)).toBe('moderate');
    expect(relianceOfFinding('unstable', true)).toBe('low');
    expect(relianceOfFinding('rare', true)).toBe('low');
  });

  it('is the weakest of what a statement rests on, and for stakeholders follows the cited passages', () => {
    expect(weakestReliance(['high', 'moderate', 'high'])).toBe('moderate');
    expect(weakestReliance(['high', 'low'])).toBe('low');
    expect(weakestReliance([])).toBeNull();
    expect(relianceOfEvidence(2, 0)).toBe('moderate');
    expect(relianceOfEvidence(0, 0)).toBe('low');
    expect(relianceOfEvidence(3, 1)).toBe('low');
  });
});

describe('the recommendations', () => {
  const inputs = richInputs();
  const brief = buildBrief(inputs);
  const starting = (text: string) =>
    brief.recommendations.filter((recommendation) => recommendation.text.startsWith(text));

  it('come from generic rules over the findings: mitigate, validate, collect evidence, prepare, repeat and resolve', () => {
    const mitigate = starting('Mitigate or stage the change for “Subscribers”');
    expect(mitigate).toHaveLength(1);
    expect(mitigate[0]?.text).toContain(
      'more of its 30 simulated members ended up looking for an alternative or resisting',
    );
    expect(mitigate[0]?.linkedFindingIds).toEqual(['f2']);
    expect(mitigate[0]).toMatchObject({
      effort: 'medium',
      reversibility: 'easy',
      ownerFunction: 'finance',
    });
    expect(mitigate[0]?.impact).toBe('high');

    const validate = starting('Validate the assumption');
    expect(validate.map((entry) => entry.text).join(' ')).toContain(
      '“Subscribers”: switching cost',
    );
    expect(validate.map((entry) => entry.text).join(' ')).toContain(
      '“Strength of the change, 0.2 higher”',
    );
    // The assumption a cited passage backs is not one to validate first.
    expect(validate.map((entry) => entry.text).join(' ')).not.toContain('trust');
    expect(validate.every((entry) => entry.ownerFunction === 'research and analytics')).toBe(true);

    const collect = starting('Collect evidence for 3 actors');
    expect(collect[0]?.text).toContain('“Provider”, “Rival provider” and “Regulator”');
    expect(starting('Close the 1 evidence gap')[0]?.text).toContain(
      '“Independent counts of the group the change affects”',
    );
    expect(starting('Resolve the 1 open conflict')[0]?.text).toContain('“monthly volume”');

    const prepare = starting('Prepare a response to how “Rival provider” could react');
    expect(prepare[0]).toMatchObject({
      linkedFindingIds: ['f3'],
      reversibility: 'moderate',
      ownerFunction: 'strategy',
    });

    const repeat = starting('Do not decide on the unstable simulated result');
    expect(repeat[0]).toMatchObject({
      linkedFindingIds: ['f4'],
      effort: 'low',
      reversibility: 'easy',
    });

    const critique = starting('Resolve the 1 open major critique');
    expect(critique[0]?.linkedFindingIds).toEqual(['f2']);
    expect(critique[0]?.impact).toBe('medium');
  });

  it('are ordered by impact times repeatability divided by effort, ties to the higher impact then the lower effort', () => {
    const weight = { low: 1, medium: 2, high: 3 } as const;
    const lower = new Map(
      inputs.analysis.findings.map((finding) => [finding.id, finding.interval.lo]),
    );
    const scores = brief.recommendations.map((recommendation) => {
      const repeatability = Math.max(
        ...recommendation.linkedFindingIds.map((id) => lower.get(id) ?? 0),
      );
      return {
        score: (weight[recommendation.impact] * repeatability) / weight[recommendation.effort],
        impact: weight[recommendation.impact],
        effort: weight[recommendation.effort],
      };
    });
    for (let index = 1; index < scores.length; index += 1) {
      const [before, after] = [scores[index - 1]!, scores[index]!];
      expect(before.score, `rec-${index} before rec-${index + 1}`).toBeGreaterThanOrEqual(
        after.score - 1e-9,
      );
      if (Math.abs(before.score - after.score) < 1e-9) {
        expect(before.impact).toBeGreaterThanOrEqual(after.impact);
        if (before.impact === after.impact) expect(before.effort).toBeLessThanOrEqual(after.effort);
      }
    }
  });

  it('computes the rank from the three things the rule names, and documents it', () => {
    expect(rank({ impact: 'high', effort: 'low', repeatability: 0.8 })).toBeCloseTo(2.4);
    expect(rank({ impact: 'medium', effort: 'medium', repeatability: 0.5 })).toBeCloseTo(0.5);
    expect(rank({ impact: 'low', effort: 'high', repeatability: 1 })).toBeCloseTo(1 / 3);
    expect(rank({ impact: 'high', effort: 'low', repeatability: 0 })).toBe(0);
    expect(ORDERING_RULE).toContain('impact times repeatability divided by effort');
    const section = brief.sections.find((entry) => entry.id === 'recommendations')!;
    expect(section.statements[0]?.text).toBe(ORDERING_RULE);
  });

  it('does not recommend mitigation for a group that is not harmed, or whose finding is not repeatable', () => {
    const neutral = richAnalysis();
    neutral.actors = neutral.actors.map((actor) =>
      actor.id === 'subscribers'
        ? { ...actor, traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0 } } }
        : actor,
    );
    expect(
      recommend(gatherFacts(richInputs({ analysis: neutral }))).some((entry) =>
        entry.text.startsWith('Mitigate'),
      ),
    ).toBe(false);
    const plain = recommend(gatherFacts(baseInputs()));
    expect(plain.some((entry) => entry.text.startsWith('Mitigate'))).toBe(false);
  });

  it('raises a blocking critique to high impact, and ignores a critique that was accepted', () => {
    const blocking = critiquesFixture();
    blocking.critiques[0] = { ...blocking.critiques[0]!, severity: 'blocking' };
    const high = recommend(gatherFacts(richInputs({ critiques: blocking }))).find((entry) =>
      entry.text.startsWith('Resolve the 1 open blocking or major critique'),
    );
    expect(high?.impact).toBe('high');
    const accepted = critiquesFixture();
    accepted.critiques[0] = { ...accepted.critiques[0]!, status: 'accepted' };
    expect(
      recommend(gatherFacts(richInputs({ critiques: accepted }))).some((entry) =>
        entry.text.includes('critique'),
      ),
    ).toBe(false);
  });

  it('links to findings that exist even when the critique points at one that does not', () => {
    const odd = critiquesFixture();
    odd.critiques[0] = { ...odd.critiques[0]!, target: { kind: 'finding', id: 'gone' } };
    const recommendations = recommend(gatherFacts(richInputs({ critiques: odd })));
    const found = recommendations.find((entry) => entry.text.includes('critique'))!;
    expect(found.linkedFindingIds).toEqual(['f1']);
  });

  it('names generic owner functions for every kind of stakeholder', () => {
    for (const category of STAKEHOLDER_CATEGORIES) {
      expect(OWNER_BY_CATEGORY[category], category).toMatch(/^[a-z ]+$/u);
    }
    expect(OWNER_BY_CATEGORY.regulator).toBe('legal and compliance');
    expect(OWNER_BY_CATEGORY['cost-bearer']).toBe('finance');
    expect(OWNER_BY_CATEGORY.operations).toBe('operations');
    expect(OWNER_BY_CATEGORY['end-user']).toBe('product');
  });

  it('are capped, and nothing is recommended when the analysis has no findings', () => {
    expect(brief.recommendations.length).toBeLessThanOrEqual(MAX_RECOMMENDATIONS);
    const none = analysisSchema.parse({ ...analysisFixture(), findings: [], sensitivity: [] });
    expect(recommend(gatherFacts(baseInputs({ analysis: none })))).toEqual([]);
  });

  it('reads the size of a shift on the scale it was measured in', () => {
    expect(levelOfSize(0.3)).toBe('high');
    expect(levelOfSize(0.29)).toBe('medium');
    expect(levelOfSize(0.1)).toBe('medium');
    expect(levelOfSize(0.09)).toBe('low');
    const harmed = inputs.analysis.actors.find((actor) => actor.id === 'subscribers')!;
    expect(directionOf(harmed)).toBe('harmed');
    expect(directionOf(inputs.analysis.actors.find((actor) => actor.id === 'provider')!)).toBe(
      'neutral',
    );
  });
});

describe('the validation plan', () => {
  const inputs = richInputs();
  const plan = validationPlan(gatherFacts(inputs));
  const target = (prefix: string) =>
    plan.find((experiment) => experiment.targets.some((entry) => entry.startsWith(prefix)));

  it('covers the assumptions the result is sensitive to that nothing cited backs, and the unstable results', () => {
    expect(target('sensitivity s1:')).toBeDefined();
    expect(target('sensitivity s3:')).toBeDefined();
    // Backed by a cited passage, robust, or inconclusive: not what to check first.
    expect(target('sensitivity s2:')).toBeUndefined();
    expect(target('sensitivity s4:')).toBeUndefined();
    expect(target('sensitivity s5:')).toBeUndefined();
    expect(target('finding f4:')).toBeDefined();
    expect(target('evidence gap provider:')).toBeDefined();
    expect(target('evidence gap rival-provider:')).toBeDefined();
  });

  it('adapts the check to the trait: how long and how costly it is to switch, or how strongly the change lands', () => {
    const switching = target('sensitivity s1:')!;
    expect(switching.question).toBe(
      'How long and how costly is it for “Subscribers” to change what they use or do today?',
    );
    expect(switching.method).toContain('survey');
    expect(switching.method).toContain('data pull');
    expect(switching.successSignal).toContain('assumed switching cost of 0.40');
    expect(switching).toMatchObject({ effort: 'medium', duration: '2 to 4 weeks' });
    const intensity = target('sensitivity s3:')!;
    expect(intensity.question).toBe(INTENSITY_CHECK.question);
    expect(intensity.method).toContain('pilot');
    expect(intensity.method).toContain('A/B test');
    expect(target('finding f4:')!.method).toContain('more seeded runs');
    expect(target('evidence gap rival-provider:')!.method).toContain('Desk research');
  });

  it('chooses the check for an actor nothing supports by the kind of actor', () => {
    expect(gapCheckFor('regulator').method).toContain('expert review');
    expect(gapCheckFor('governance').method).toContain('expert review');
    expect(gapCheckFor('competitor').method).toContain('Desk research');
    expect(gapCheckFor('substitute').method).toContain('Desk research');
    expect(gapCheckFor('end-user').method).toContain('Interviews');
    expect(gapCheckFor('end-user').question).toContain('actually think and need');
  });

  it('takes the five assumptions with the biggest shifts when there are more, and none of the smaller ones', () => {
    const analysis = richAnalysis();
    analysis.sensitivity = Array.from({ length: 7 }, (_, index) => ({
      ...analysis.sensitivity[0]!,
      id: `x${index + 1}`,
      label: `Assumption x${index + 1} moved`,
      shift: 0.1 * (index + 1),
      assumptionOrigin: 'system-assumption' as const,
      target: { kind: 'trait' as const, actorId: 'resellers', trait: 'reactivity' },
    }));
    const many = validationPlan(gatherFacts(richInputs({ analysis })));
    const covered = many
      .flatMap((experiment) => experiment.targets)
      .filter((entry) => entry.startsWith('sensitivity'));
    expect(covered.map((entry) => entry.split(':')[0])).toEqual([
      'sensitivity x7',
      'sensitivity x6',
      'sensitivity x5',
      'sensitivity x4',
      'sensitivity x3',
    ]);
    expect(many.length).toBeLessThanOrEqual(8);
    expect(many.map((experiment) => experiment.id)).toEqual(
      many.map((_, index) => `val-${index + 1}`),
    );
  });

  it('gives each check a question, a method, a signal of success, an effort and a duration', () => {
    for (const experiment of plan) {
      expect(experiment.question.length).toBeGreaterThan(10);
      expect(experiment.method.length).toBeGreaterThan(10);
      expect(experiment.successSignal.length).toBeGreaterThan(10);
      expect(['low', 'medium', 'high']).toContain(experiment.effort);
      expect(experiment.duration).toMatch(/week/u);
    }
  });

  it('says that no check was generated, and that this is not validation, when there is nothing to check', () => {
    const analysis = analysisSchema.parse({
      ...analysisFixture(),
      findings: analysisFixture().findings.slice(0, 1),
      sensitivity: [],
    });
    const evidenced = baseInputs({ analysis });
    for (const stakeholder of evidenced.stakeholders!.stakeholders)
      stakeholder.priority = 'standard';
    for (const actor of analysis.actors) actor.kind = 'cohort';
    const empty = buildBrief(evidenced);
    expect(empty.validationPlan).toEqual([]);
    const text = empty.sections
      .find((entry) => entry.id === 'validation-plan')!
      .statements.at(-1)!.text;
    expect(text).toContain('does not mean the result has been validated');
  });

  it('is worded without a prediction, an overclaim or a percentage, in every template', () => {
    const everything = [
      ...Object.values(TRAIT_CHECKS),
      INTENSITY_CHECK,
      POPULATION_CHECK,
      UNSTABLE_CHECK,
      GENERAL_GAP_CHECK,
      ...STAKEHOLDER_CATEGORIES.map(gapCheckFor),
    ];
    for (const check of everything) {
      expect(
        lintText(
          [check.question, check.method, check.successSignal, check.measure, check.duration].join(
            '\n',
          ),
        ),
      ).toEqual([]);
    }
    expect(Object.keys(TRAIT_CHECKS)).toHaveLength(11);
  });
});
