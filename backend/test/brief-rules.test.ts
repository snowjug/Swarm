import { describe, expect, it, vi } from 'vitest';
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
  advise,
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
  CONFLICT_CHECK,
  DIRECTION_CHECK,
  GENERAL_GAP_CHECK,
  POPULATION_CHECK,
  REPEAT_CHECK,
  RESPONDER_CHECK,
  SPREAD_CHECK,
  STRENGTH_CHECK,
  TRAIT_CHECKS,
  gapCheckFor,
  planChecks,
  validationPlan,
} from '../src/brief/validation.js';
import { MAX_STATEMENTS, sectionWriter } from '../src/brief/writer.js';
import { STAKEHOLDER_CATEGORIES } from '../../shared/stakeholders.js';
import {
  baseInputs,
  critiquesFixture,
  richAnalysis,
  richInputs,
  richStakeholders,
  totalsOnly,
} from './support/brief-world.js';

const clone = <T>(value: T): T => structuredClone(value);

// The builder runs what the rules advise and plan through the guard. These pass the real functions
// through, so that a test can put one wording of its own in front of the guard.
vi.mock('../src/brief/recommend.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/brief/recommend.js')>();
  return { ...actual, advise: vi.fn(actual.advise) };
});
vi.mock('../src/brief/validation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/brief/validation.js')>();
  return { ...actual, planChecks: vi.fn(actual.planChecks) };
});

describe('the wording guard', () => {
  it.each([
    ['It will rise.', 'prediction'],
    ['They WILL leave.', 'prediction'],
    ['Real-world adoption is certain to rise.', 'prediction'],
    ['The fee is expected to rise.', 'prediction'],
    ['Members shall leave.', 'prediction'],
    ['Providers are bound to follow.', 'prediction'],
    ['Simulated members are likely to leave.', 'prediction'],
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
    ['Simulated counts show conversion increased by 18 real customers.', 'real-world-claim'],
  ])('flags “%s” as %s', (text, rule) => {
    expect(lintText(text).map((issue) => issue.rule)).toContain(rule);
  });

  it.each([
    'This improves nothing.',
    'It shows goodwill and a willing group.',
    'About 12 of 43 simulated members.',
    'The percentage sign is not used here.',
    'A proof of concept is a different thing.',
    'Expected effect on it: unclear.',
    'Intensity is set to 0.7 for the change.',
    'The group was not certain of the date.',
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

  it('says nothing was withheld when every recommendation and check is worded cleanly', () => {
    // A name that is not quoted by the builder would break the guard; quoting is what keeps it clean.
    const brief = buildBrief(richInputs({ analysis: richAnalysis() }));
    expect(brief.methodology.notes.join(' ')).not.toContain('withheld');
    expect(brief.recommendations.length).toBeGreaterThan(1);
    expect(brief.validationPlan.length).toBeGreaterThan(1);
  });

  it('is applied to recommendations and checks too: a claim in either is withheld, in the fields the tables and exports read, and counted', async () => {
    const claim = 'Simulated members will certainly improve.';
    const question = 'Will real-world conversion rise?';
    const [{ advise: wording }, { planChecks: checks }] = await Promise.all([
      vi.importActual<typeof import('../src/brief/recommend.js')>('../src/brief/recommend.js'),
      vi.importActual<typeof import('../src/brief/validation.js')>('../src/brief/validation.js'),
    ]);
    const inputs = richInputs();
    const clean = buildBrief(inputs);

    vi.mocked(advise).mockImplementationOnce((facts) => {
      const [first, ...rest] = wording(facts);
      return [{ ...first!, recommendation: { ...first!.recommendation, text: claim } }, ...rest];
    });
    vi.mocked(planChecks).mockImplementationOnce((facts) => {
      const [first, ...rest] = checks(facts);
      return [{ ...first!, question }, ...rest];
    });
    const brief = buildBrief(inputs);

    expect(brief.recommendations[0]!.text).toMatch(
      /^A recommendation was withheld because its wording broke the guard \(prediction, overclaim\)/u,
    );
    expect(brief.recommendations[0]).toMatchObject({
      validation: 'See the findings it followed from.',
      leadingIndicators: [],
    });
    expect(brief.validationPlan[0]).toMatchObject({
      question: 'A check was withheld because its wording broke the guard (prediction).',
      method: 'See the assumption or finding it was meant to test.',
      successSignal: 'Not stated.',
    });
    // Neither claim is shown anywhere in the brief, and nothing else was touched.
    const shown = JSON.stringify(brief);
    expect(shown).not.toContain(claim);
    expect(shown).not.toContain(question);
    expect(brief.recommendations.slice(1)).toEqual(clean.recommendations.slice(1));
    expect(brief.validationPlan.slice(1)).toEqual(clean.validationPlan.slice(1));
    expect(brief.methodology.notes).toContain(
      '2 statements were withheld because their wording broke the guard.',
    );
    expect(lintBrief(brief)).toEqual([]);
  });

  // Every field of a recommendation that the guard reads is replaced when it is withheld, so that a
  // wording that broke the guard is shown nowhere in the brief.
  it.each([
    ['validation', 'Check that members will certainly stay.', true],
    ['leadingIndicators', 'Over 60% of them stay.', true],
    ['horizon', 'Within a year it is guaranteed.', true],
    ['ownerFunction', 'the team that will own it', true],
  ] as const)(
    'looks at the %s of a recommendation, not only at what it says',
    async (field, wording, replaced) => {
      const { advise: rules } = await vi.importActual<typeof import('../src/brief/recommend.js')>(
        '../src/brief/recommend.js',
      );
      vi.mocked(advise).mockImplementationOnce((facts) => {
        const [first, ...rest] = rules(facts);
        const recommendation = {
          ...first!.recommendation,
          [field]: field === 'leadingIndicators' ? [wording] : wording,
        };
        return [{ ...first!, recommendation }, ...rest];
      });
      const brief = buildBrief(richInputs());
      if (replaced) expect(JSON.stringify(brief)).not.toContain(wording);
      expect(brief.recommendations[0]!.text).toMatch(/^A recommendation was withheld/u);
      expect(brief.methodology.notes).toContain(
        '1 statements were withheld because their wording broke the guard.',
      );
    },
  );

  it.each([
    ['method', 'Ask them, which proves it.'],
    ['successSignal', 'Over 60% of them stay.'],
  ] as const)('looks at the %s of a check, not only at its question', async (field, wording) => {
    const { planChecks: rules } = await vi.importActual<
      typeof import('../src/brief/validation.js')
    >('../src/brief/validation.js');
    vi.mocked(planChecks).mockImplementationOnce((facts) => {
      const [first, ...rest] = rules(facts);
      return [{ ...first!, [field]: wording }, ...rest];
    });
    const brief = buildBrief(richInputs());
    expect(JSON.stringify(brief)).not.toContain(wording);
    expect(brief.validationPlan[0]!.question).toMatch(/^A check was withheld/u);
    expect(brief.methodology.notes).toContain(
      '1 statements were withheld because their wording broke the guard.',
    );
  });

  it('withholds a recommendation that does not say it is simulated, as well as one that predicts', async () => {
    const { advise: wording } = await vi.importActual<typeof import('../src/brief/recommend.js')>(
      '../src/brief/recommend.js',
    );
    vi.mocked(advise).mockImplementationOnce((facts) => {
      const [first, second, ...rest] = wording(facts);
      const said = (entry: typeof first, text: string) => ({
        ...entry!,
        recommendation: { ...entry!.recommendation, text },
      });
      return [
        said(first, 'Stage the change for the group before it lands.'),
        said(second, 'Simulated members will gain.'),
        ...rest,
      ];
    });
    const brief = buildBrief(richInputs());
    expect(brief.recommendations[0]!.text).toContain('(missing-simulated)');
    expect(brief.recommendations[1]!.text).toContain('(prediction)');
    expect(brief.methodology.notes).toContain(
      '2 statements were withheld because their wording broke the guard.',
    );
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

  it('come from generic rules over the findings: mitigate, validate, collect evidence, prepare and resolve', () => {
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
    // It names the actor and how often it acted, from the finding that is about that actor.
    expect(prepare[0]?.text).toContain('rival provider followed in 9 of 10 runs');

    const critique = starting('Resolve the 1 open major critique');
    expect(critique[0]?.linkedFindingIds).toEqual(['f2']);
    expect(critique[0]?.impact).toBe('medium');
  });

  describe('each says what it can stand behind, and the ids it rests on', () => {
    const statements = brief.sections.find(
      (section) => section.id === 'recommendations',
    )!.statements;
    const of = (text: string) => {
      const id = starting(text)[0]!.id;
      return statements.find((statement) => statement.id === id)!;
    };

    it('takes the reliance of the findings only when it follows from a count over seeded runs', () => {
      expect(of('Mitigate or stage the change for “Subscribers”')).toMatchObject({
        origin: 'simulation-aggregation',
        reliance: 'high',
      });
      expect(of('Mitigate or stage the change for “Subscribers”').refs).toMatchObject({
        stakeholderIds: ['subscribers'],
        findingIds: expect.arrayContaining(['f2']),
      });
      const prepare = of('Prepare a response to how “Rival provider” could react');
      expect(prepare).toMatchObject({ origin: 'simulation-aggregation', reliance: 'moderate' });
      expect(prepare.refs.stakeholderIds).toEqual(['rival-provider']);
      expect(prepare.refs.findingIds).toEqual(['f3']);
    });

    it('is unresolved uncertainty with no reliance, and the ids of the passages, actors and critiques, for evidence, gaps and critiques', () => {
      const conflicts = of('Resolve the 1 open conflict');
      expect(conflicts.origin).toBe('unresolved-uncertainty');
      expect(conflicts.reliance).toBeNull();
      expect(conflicts.refs.evidence.map((ref) => ref.passageId).sort()).toEqual(['P1', 'P3']);
      expect(conflicts.refs.findingIds).toEqual([]);
      const actors = of('Collect evidence for 3 actors');
      expect(actors).toMatchObject({ origin: 'unresolved-uncertainty', reliance: null });
      expect(actors.refs.stakeholderIds).toEqual(['provider', 'rival-provider', 'regulator']);
      const named = of('Close the 1 evidence gap');
      expect(named).toMatchObject({ origin: 'unresolved-uncertainty', reliance: null });
      expect(named.refs.assumptions).toContain(
        'Independent counts of the group the change affects',
      );
      const critique = of('Resolve the 1 open major critique');
      expect(critique).toMatchObject({ origin: 'unresolved-uncertainty', reliance: null });
      expect(critique.refs.critiqueIds).toEqual(['c1']);
    });

    it('rests an assumption to validate on the sensitivity row, not on a stance finding it was not about', () => {
      const validate = of('Validate the assumption');
      expect(validate.origin).toBe('simulation-aggregation');
      expect(validate.reliance).toBeNull();
      expect(validate.refs.sensitivityIds).toHaveLength(1);
      expect(validate.refs.findingIds).toEqual([]);
    });
  });

  it('keeps a repeat for a headline result that disagrees across runs, and gives a rare result its own advice', () => {
    const base = richAnalysis();
    const variants = (change: Partial<(typeof base.findings)[number]>, id: string) =>
      base.findings.map((finding) => (finding.id === id ? { ...finding, ...change } : finding));
    // The headline comparison itself is not stable: do not decide on it.
    const unstableHeadline = analysisSchema.parse({
      ...base,
      findings: variants(
        { classification: 'unstable', holdsIn: 5, interval: { lo: 0.24, hi: 0.76 } },
        'f1',
      ),
    });
    const repeat = recommend(gatherFacts(richInputs({ analysis: unstableHeadline }))).find(
      (entry) => entry.text.startsWith('Do not decide on the unstable simulated result'),
    );
    expect(repeat).toMatchObject({
      linkedFindingIds: ['f1'],
      effort: 'low',
      reversibility: 'easy',
      impact: 'high',
    });
    // An ordering of groups is unstable as a matter of course: nothing is decided on it, so no repeat.
    expect(
      brief.recommendations.some((entry) => entry.text.startsWith('Do not decide on the unstable')),
    ).toBe(false);
    // A threshold that was never crossed is rare, which is not the same as disagreeing across seeds.
    const rare = analysisSchema.parse({
      ...base,
      findings: [
        ...base.findings,
        {
          id: 'f5',
          kind: 'threshold-crossing',
          variantId: 'proposed-change',
          actorId: null,
          statement:
            'In 0 of 10 seeded runs, the share of simulated members looking for an alternative or resisting, counting each actor equally and not each member, reached at least 30 in 100 at some round under Proposed change.',
          predicate: 'At some round the mean share is at least 0.3.',
          holdsIn: 0,
          of: 10,
          interval: { lo: 0, hi: 0.28 },
          classification: 'rare',
        },
      ],
    });
    const advice = recommend(gatherFacts(richInputs({ analysis: rare }))).find((entry) =>
      entry.linkedFindingIds.includes('f5'),
    )!;
    expect(advice.text).toContain('so the runs agree that it is rare rather than disagree');
    expect(advice.text).toContain('do not read its absence as safety');
    expect(advice.text).not.toMatch(/unstable/u);
    expect(advice.impact).toBe('medium');
  });

  it('still advises on a group from the totals over the runs when the runs lost their per-actor lists', () => {
    const reduced = recommend(
      gatherFacts(richInputs({ analysis: totalsOnly(richAnalysis()) })),
    ).find((entry) => entry.text.startsWith('Mitigate or stage the change for “Subscribers”'));
    expect(reduced?.text).toContain(
      'more of its 30 simulated members ended up looking for an alternative or resisting',
    );
    expect(reduced?.linkedFindingIds).toEqual(['f2']);
  });

  it('says plainly that a group is one simulated member, instead of "1 more of its 1 members"', () => {
    const analysis = clone(richAnalysis());
    for (const variant of analysis.variants) {
      for (const run of variant.runs) {
        for (const entry of run.byActor) if (entry.actorId === 'subscribers') entry.members = 1;
      }
    }
    const single = buildBrief(richInputs({ analysis })).recommendations.find((recommendation) =>
      recommendation.text.startsWith('Mitigate or stage the change for “Subscribers”'),
    );
    expect(single?.text).toContain(
      'its one simulated member ended up looking for an alternative or resisting more often under',
    );
    expect(single?.text).toMatch(/in \d+ of \d+ paired runs/u);
    expect(single?.text).not.toMatch(/of its 1 simulated members/u);
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

  it('does not stand a mitigation on a finding about another response of the group', () => {
    const other = richAnalysis();
    other.findings = other.findings.map((finding) =>
      finding.id === 'f2'
        ? {
            ...finding,
            statement:
              'In 9 of 10 seeded runs, the largest group of simulated members of Subscribers ended up adapting to limit the impact under Proposed change.',
          }
        : finding,
    );
    const advice = recommend(gatherFacts(richInputs({ analysis: other })));
    expect(advice.some((entry) => entry.text.startsWith('Mitigate'))).toBe(false);
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

  it('asks about the outcome that the evidence records for a group, and not only whether it switches', () => {
    const quote = richStakeholders()
      .stakeholders.find((entry) => entry.id === 'subscribers')!
      .evidence.find((ref) => ref.role === 'supports')!.quote!;
    const check = plan.find((experiment) =>
      experiment.question.startsWith('Is “Subscribers” harmed'),
    )!;
    expect(check.measure).toContain(`“${quote.slice(0, 40)}`);
    expect(check.measure).toContain('whether they also start using an alternative');
    // A group that cites nothing keeps the general measure, which names no outcome of its own.
    const bare = validationPlan(gatherFacts(baseInputs()));
    const general = bare.find((experiment) =>
      experiment.question.includes('harmed, helped or unaffected'),
    );
    expect(general?.measure ?? '').not.toContain('the evidence records');
  });

  it('plans a check for a sensitive assumption that nothing cited backs and for none that a passage backs, whatever else is in the plan', () => {
    const analysis = richAnalysis();
    const row = analysis.sensitivity.find((entry) => entry.id === 's2')!;
    const targetsWith = (changed: typeof row) =>
      validationPlan(
        gatherFacts(richInputs({ analysis: { ...analysis, sensitivity: [changed] } })),
      ).flatMap((experiment) => experiment.targets);
    // Alone in the plan, so that nothing else can be what keeps it out.
    expect(row.classification).toBe('assumption-sensitive');
    expect(targetsWith(row).some((entry) => entry.startsWith('sensitivity s2:'))).toBe(false);
    expect(
      targetsWith({ ...row, assumptionOrigin: 'system-assumption' }).some((entry) =>
        entry.startsWith('sensitivity s2:'),
      ),
    ).toBe(true);
  });

  it('covers the premises of the answer, the assumptions the result is sensitive to, the open conflicts, what triggers a repeated responder and the actors nothing supports', () => {
    // How large the change is in practice, and the assumption the runs were sensitive to about it.
    expect(target('assumption: strength and timing of Proposed change')).toBeDefined();
    expect(target('sensitivity s1:')).toBeDefined();
    expect(target('sensitivity s3:')).toBe(target('assumption: strength and timing'));
    // Backed by a cited passage, robust, or inconclusive: not what to check first.
    expect(target('sensitivity s2:')).toBeUndefined();
    expect(target('sensitivity s4:')).toBeUndefined();
    expect(target('sensitivity s5:')).toBeUndefined();
    // The sources that disagree, by name, and the outside actor that responded in most runs.
    expect(target('conflict X1:')).toBeDefined();
    expect(target('finding f3:')).toBeDefined();
    expect(target('evidence gap provider:')).toBeDefined();
    // A group the answer names that stands for a population nobody counted gets its size counted.
    const counted = target('assumption: the size of Resellers');
    expect(counted?.question).toBe('How many members does “Resellers” have in fact?');
    expect(counted?.measure).toContain('independent count');
    // An ordering of groups is not something to repeat the runs for.
    expect(target('finding f4:')).toBeUndefined();
    expect(plan.some((experiment) => experiment.method.includes('more seeded runs'))).toBe(false);
  });

  it('names the group and what would be observed in the scenario’s own words, with a comparison, an owner and a decision rule left to the person', () => {
    expect(plan.length).toBeGreaterThanOrEqual(5);
    for (const experiment of plan) {
      expect(experiment.question.length, experiment.id).toBeGreaterThan(10);
      expect(experiment.measure.length, experiment.id).toBeGreaterThan(20);
      expect(experiment.comparison.length, experiment.id).toBeGreaterThan(10);
      expect(experiment.method.length, experiment.id).toBeGreaterThan(10);
      expect(experiment.ownerFunction, experiment.id).toMatch(/^[a-z ]+$/u);
      expect(['low', 'medium', 'high']).toContain(experiment.effort);
      expect(experiment.duration).toMatch(/week|day/u);
      // The threshold is the person's to set: the check says so and supplies none.
      expect(experiment.successSignal, experiment.id).toMatch(
        /Decide beforehand|before the check starts|Before the check starts/u,
      );
    }
    const switching = target('sensitivity s1:')!;
    expect(switching.question).toBe(
      'How long and how costly is it for “Subscribers” to change what they use or do today?',
    );
    expect(switching.measure).toContain('out-of-pocket cost');
    expect(switching.measure).toContain('“Subscribers”');
    expect(switching.ownerFunction).toBe('finance');
    const strength = target('assumption: strength and timing')!;
    // The scenario's own words for the change are quoted into the question.
    expect(strength.question).toContain(
      '“Monthly fee” (from “current fee” to “current fee plus a fixed amount”)',
    );
    const conflict = target('conflict X1:')!;
    expect(conflict.question).toBe(
      'Which figure holds for “monthly volume”: “Supplied notes.md” (“12”) or “Pasted address.md” (“15”)?',
    );
    expect(conflict.method).toContain('underlying data');
    expect(conflict.ownerFunction).toBe('research and analytics');
    const responder = target('finding f3:')!;
    expect(responder.question).toContain('What would lead “Rival provider” to respond');
    expect(responder.ownerFunction).toBe('strategy');
    expect(responder.targets.some((entry) => entry.startsWith('evidence gap rival-provider'))).toBe(
      true,
    );
  });

  it('never asks the world to match an internal score or setting of the simulation', () => {
    const text = plan
      .flatMap((experiment) => [
        experiment.question,
        experiment.measure,
        experiment.comparison,
        experiment.method,
        experiment.successSignal,
      ])
      .join('\n');
    expect(text).not.toMatch(/in line with the (assumed|simulated)/iu);
    expect(text).not.toMatch(/assumed (impact|sensitivity|switching cost|trust|openness|value)/iu);
    expect(text).not.toMatch(/from -1 to 1|strength (of )?\d|\b0\.[0-9]+\b/u);
    expect(text).not.toMatch(/matches? (the|a) (assumed|simulated)/iu);
    // What replaces a setting is the observation.
    expect(
      plan.some((experiment) =>
        /replaces? the (assumed|simulated)/iu.test(experiment.successSignal),
      ),
    ).toBe(true);
  });

  it('keeps the strength check from tuning a setting to the reaction that it is meant to test', () => {
    const strength = plan.find((experiment) =>
      experiment.question.startsWith('How large is the change'),
    );
    expect(strength).toBeDefined();
    expect(strength!.successSignal).toMatch(/not to the reaction seen/u);
    expect(strength!.successSignal).toMatch(/not used to set them/u);
    for (const experiment of plan) {
      expect(experiment.successSignal).not.toMatch(/so that the simulated/iu);
    }
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

  it('does not repeat a check: the same check for several results is one check with several targets', () => {
    const analysis = richAnalysis();
    analysis.sensitivity = [
      ...analysis.sensitivity,
      ...['up', 'down'].map((direction, index) => ({
        ...analysis.sensitivity[0]!,
        id: `s1-${direction}`,
        label: `Subscribers: cost of switching, ${direction}`,
        shift: 0.12 + index / 100,
      })),
    ];
    const merged = validationPlan(gatherFacts(richInputs({ analysis })));
    const texts = merged.map(
      (experiment) => `${experiment.question}|${experiment.method}|${experiment.successSignal}`,
    );
    expect(new Set(texts).size).toBe(texts.length);
    const switching = merged.find(
      (experiment) =>
        experiment.question ===
        TRAIT_CHECKS.switchingCost.question.replace('{group}', '“Subscribers”'),
    )!;
    expect(switching.targets.filter((entry) => entry.startsWith('sensitivity '))).toHaveLength(3);
    expect(merged.map((experiment) => experiment.id)).toEqual(
      merged.map((_, index) => `val-${index + 1}`),
    );
  });

  it('repeats the analysis only for a headline result that disagrees across runs, never for an ordering of groups or a single event', () => {
    const base = richAnalysis();
    const weaken = (id: string) =>
      analysisSchema.parse({
        ...base,
        findings: base.findings.map((finding) =>
          finding.id === id
            ? {
                ...finding,
                classification: 'unstable',
                holdsIn: 5,
                interval: { lo: 0.24, hi: 0.76 },
              }
            : finding,
        ),
      });
    const headline = validationPlan(gatherFacts(richInputs({ analysis: weaken('f1') })));
    const repeat = headline.find((experiment) => experiment.question === REPEAT_CHECK.question)!;
    expect(repeat.targets[0]).toMatch(/^finding f1: /u);
    expect(repeat.ownerFunction).toBe('research and analytics');
    expect(repeat.method).toContain('more seeded runs');
    expect(repeat.comparison).toContain('different first seed');
    // The event, and the ordering that was already unstable, are only described by the runs.
    const event = validationPlan(gatherFacts(richInputs({ analysis: weaken('f3') })));
    expect(event.some((experiment) => experiment.question === REPEAT_CHECK.question)).toBe(false);
    expect(plan.some((experiment) => experiment.question === REPEAT_CHECK.question)).toBe(false);
  });

  it('is not the same plan for different findings and evidence: the groups, conflicts and responders it names are the analysis’s own', () => {
    const other = richInputs();
    other.ledgerSummary = { conflicts: [], sufficiency: null };
    other.analysis = analysisSchema.parse({
      ...richAnalysis(),
      sensitivity: [],
      findings: richAnalysis().findings.filter((finding) => finding.id !== 'f3'),
    });
    const bare = validationPlan(gatherFacts(other));
    const text = (list: typeof plan) => list.map((experiment) => experiment.question).join('\n');
    expect(text(bare)).not.toBe(text(plan));
    expect(text(bare)).not.toContain('monthly volume');
    expect(text(bare)).not.toContain('respond to the change');
    expect(text(plan)).toContain('monthly volume');
    expect(text(plan)).toContain('respond to the change');
  });

  it('says that no check was generated, and that this is not validation, when there is nothing to check', () => {
    // A baseline and nothing else was run: no change to premise, no group moved, nothing to repeat.
    const analysis = analysisSchema.parse({
      ...analysisFixture(),
      config: { ...analysisFixture().config, variants: [analysisFixture().config.variants[0]] },
      variants: [analysisFixture().variants[0]],
      findings: [],
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
      STRENGTH_CHECK,
      SPREAD_CHECK,
      POPULATION_CHECK,
      CONFLICT_CHECK,
      RESPONDER_CHECK,
      REPEAT_CHECK,
      DIRECTION_CHECK,
      GENERAL_GAP_CHECK,
      ...STAKEHOLDER_CATEGORIES.map(gapCheckFor),
    ];
    for (const check of everything) {
      expect(
        lintText(
          [
            check.question,
            check.measure,
            check.comparison,
            check.method,
            check.decision,
            check.gist,
            check.duration,
          ].join('\n'),
        ),
      ).toEqual([]);
      // "Share" is kept for the simulated share of simulated members; what a check observes is a proportion.
      expect(`${check.question} ${check.measure} ${check.comparison}`).not.toMatch(/\bshares?\b/iu);
    }
    expect(Object.keys(TRAIT_CHECKS)).toHaveLength(11);
  });
});
