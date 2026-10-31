import { describe, expect, it } from 'vitest';
import { analysisSchema, type Analysis } from '../../shared/analysis.js';
import {
  BRIEF_SECTION_IDS,
  BRIEF_SECTION_TITLES,
  STATEMENT_ORIGINS,
  decisionBriefSchema,
  type BriefRefs,
  type DecisionBrief,
  type StatementOrigin,
} from '../../shared/brief.js';
import { analysisFixture, actorFixture } from '../../shared/lab-fixtures.js';
import { stakeholderSchema, type Actor } from '../../shared/stakeholders.js';
import { buildBrief } from '../src/brief/build.js';
import { lintBrief } from '../src/brief/lint.js';
import {
  baseInputs,
  passage,
  richAnalysis,
  richInputs,
  richStakeholders,
  TIME,
} from './support/brief-world.js';

// What each origin has to rest on, written out here on its own so that the builder is held to it
// and not to its own copy of it.
const NEEDS: Record<StatementOrigin, (refs: BriefRefs) => boolean> = {
  'supplied-evidence': (refs) => refs.evidence.length + refs.documentIds.length > 0,
  'retrieved-public-evidence': (refs) => refs.evidence.length + refs.documentIds.length > 0,
  'historical-comparison': (refs) => refs.evidence.length + refs.documentIds.length > 0,
  'user-assumption': (refs) => refs.assumptions.length > 0,
  'system-assumption': (refs) => refs.assumptions.length > 0,
  'inferred-stakeholder': (refs) => refs.stakeholderIds.length > 0,
  'actor-behavior': (refs) => refs.stakeholderIds.length + refs.findingIds.length > 0,
  'simulation-aggregation': (refs) =>
    refs.findingIds.length + refs.sensitivityIds.length + refs.variantIds.length > 0,
  'model-interpretation': (refs) => refs.findingIds.length > 0,
  'unresolved-uncertainty': () => true,
};

const statementsOf = (brief: DecisionBrief) =>
  brief.sections.flatMap((section) => section.statements);
const sectionOf = (brief: DecisionBrief, id: (typeof BRIEF_SECTION_IDS)[number]) =>
  brief.sections.find((section) => section.id === id)!;
const textOf = (brief: DecisionBrief, id: (typeof BRIEF_SECTION_IDS)[number]) =>
  sectionOf(brief, id)
    .statements.map((statement) => statement.text)
    .join('\n');

const inputs = [
  ['the plain fixtures', () => baseInputs()],
  [
    'fixtures with evidence, a competitor chain, critiques and every kind of source',
    () => richInputs(),
  ],
] as const;

describe.each(inputs)('the brief made from %s', (_name, make) => {
  const brief = buildBrief(make());

  it('has the seventeen sections, in the order they are read, and is valid against its schema', () => {
    expect(brief.sections.map((section) => section.id)).toEqual([...BRIEF_SECTION_IDS]);
    expect(brief.sections.map((section) => section.title)).toEqual(
      BRIEF_SECTION_IDS.map((id) => BRIEF_SECTION_TITLES[id]),
    );
    expect(decisionBriefSchema.safeParse(brief).success).toBe(true);
    expect(brief.generatedBy).toBe('rules');
    expect(brief.generatedAt).toBe(TIME);
  });

  it('gives every statement one of the ten origins and what that origin has to rest on', () => {
    const statements = statementsOf(brief);
    expect(statements.length).toBeGreaterThan(40);
    const ids = new Set<string>();
    for (const statement of statements) {
      expect(STATEMENT_ORIGINS, statement.id).toContain(statement.origin);
      expect(NEEDS[statement.origin](statement.refs), `${statement.id} (${statement.origin})`).toBe(
        true,
      );
      expect(statement.text.length, statement.id).toBeGreaterThan(0);
      expect(statement.text.length, statement.id).toBeLessThanOrEqual(700);
      expect(ids.has(statement.id), `duplicate id ${statement.id}`).toBe(false);
      ids.add(statement.id);
    }
    for (const section of brief.sections) expect(section.statements.length).toBeLessThanOrEqual(40);
  });

  it('says that everything that sums up the simulation is simulated', () => {
    for (const statement of statementsOf(brief)) {
      if (
        ['simulation-aggregation', 'actor-behavior', 'model-interpretation'].includes(
          statement.origin,
        )
      ) {
        expect(statement.text, statement.id).toMatch(/\bsimulated\b/iu);
      }
    }
    expect(brief.headline).toMatch(/\bsimulated\b/iu);
    for (const recommendation of brief.recommendations) {
      expect(recommendation.text, recommendation.id).toMatch(/\bsimulated\b/iu);
    }
  });

  it('keeps every recommendation tied to findings that exist, with everything needed to act on it', () => {
    const findings = new Set(make().analysis.findings.map((finding) => finding.id));
    expect(brief.recommendations.length).toBeGreaterThan(0);
    brief.recommendations.forEach((recommendation, index) => {
      expect(recommendation.id).toBe(`rec-${index + 1}`);
      expect(recommendation.priority).toBe(index + 1);
      expect(recommendation.linkedFindingIds.length).toBeGreaterThanOrEqual(1);
      for (const id of recommendation.linkedFindingIds) expect(findings.has(id), id).toBe(true);
      expect(['low', 'medium', 'high']).toContain(recommendation.impact);
      expect(['low', 'medium', 'high']).toContain(recommendation.effort);
      expect(['easy', 'moderate', 'hard']).toContain(recommendation.reversibility);
      expect(recommendation.ownerFunction.length).toBeGreaterThan(0);
      expect(recommendation.horizon.length).toBeGreaterThan(0);
      expect(recommendation.leadingIndicators.length).toBeGreaterThanOrEqual(1);
      expect(recommendation.validation.length).toBeGreaterThan(0);
    });
    const section = sectionOf(brief, 'recommendations');
    for (const recommendation of brief.recommendations) {
      expect(section.statements.some((statement) => statement.id === recommendation.id)).toBe(true);
    }
  });

  it('puts the charts in the sections they belong to', () => {
    const visuals = Object.fromEntries(
      brief.sections.map((section) => [section.id, section.visuals]),
    );
    expect(visuals['stakeholders']).toEqual(['stakeholder-map']);
    expect(visuals['evidence-base']).toEqual(['evidence-map']);
    expect(visuals['reaction-patterns']).toEqual(['outcome-distribution']);
    expect(visuals['alternative-outcomes']).toEqual(['scenario-comparison']);
    expect(visuals['uncertainty']).toEqual(['sensitivity']);
    expect(visuals['assumptions']).toEqual(['assumption-register']);
  });

  it('passes the wording guard, and no statement was withheld or lost its origin', () => {
    expect(lintBrief(brief)).toEqual([]);
    expect(brief.methodology.notes.join(' ')).not.toMatch(/withheld|nothing to rest on/u);
  });

  it('is the same brief every time, apart from the time it was made', () => {
    const again = buildBrief(make());
    expect(again).toEqual(brief);
    const later = buildBrief({ ...make(), generatedAt: '2027-03-04T05:06:07.000Z' });
    expect({ ...later, generatedAt: brief.generatedAt }).toEqual(brief);
    expect(later.generatedAt).toBe('2027-03-04T05:06:07.000Z');
  });
});

describe('the executive answer', () => {
  const analysis = analysisFixture();
  const brief = buildBrief(baseInputs({ analysis }));
  const executive = sectionOf(brief, 'executive-answer');

  it('compares the change with the baseline in simulated members, says how stable that is and which fidelity produced it', () => {
    const members = analysis.actors.reduce((total, actor) => total + actor.sampleSize, 0);
    const adverse = (variantId: string) => {
      const runs = analysis.variants.find((variant) => variant.variantId === variantId)!.runs;
      return (
        (runs.reduce(
          (total, run) => total + run.responseShares.resist + run.responseShares.switch,
          0,
        ) /
          runs.length) *
        members
      );
    };
    const [first] = executive.statements;
    expect(first?.origin).toBe('simulation-aggregation');
    expect(first?.text).toContain('the rules engine');
    expect(first?.text).toContain(`${members} simulated members`);
    expect(first?.text).toContain(
      `about ${Math.round(adverse('proposed-change'))} simulated members`,
    );
    expect(first?.text).toContain(`about ${Math.round(adverse('baseline'))} under “No change”`);
    expect(first?.text).toContain('in 10 of 10 paired runs');
    expect(first?.refs.findingIds).toEqual(['f1']);
    expect(first?.refs.variantIds).toEqual(['proposed-change', 'baseline']);
    expect(executive.statements[1]?.text).toContain('held in 10 of 10 seeded simulated runs');
    expect(executive.statements[1]?.text).toContain('mostly repeatable');
    expect(executive.statements[1]?.text).toContain('There is no confidence score');
  });

  it('names the biggest open caveat, and ends with what the answer does not tell you', () => {
    expect(executive.statements[2]?.text).toContain('Biggest open caveat');
    expect(executive.statements[2]?.text).toContain(
      'sensitive to “Subscribers: cost of switching, 0.2 higher”',
    );
    expect(executive.statements[2]?.origin).toBe('unresolved-uncertainty');
    const last = executive.statements.at(-1);
    expect(last?.text).toMatch(/^What this does not tell you/u);
    expect(last?.text).toMatch(/neither rates nor forecasts/u);
  });

  it('makes a headline of one or two sentences from the answer and the caveat, never longer than a statement', () => {
    expect(brief.headline.length).toBeLessThanOrEqual(700);
    expect(brief.headline).toContain(executive.statements[0]!.text);
    expect(brief.headline).toContain('Biggest open caveat');
    expect(brief.headline).not.toMatch(/\bwill\b|%/u);
  });

  it('chooses the next caveat when nothing sensitive is left: an unstable headline, then missing evidence', () => {
    const unstable = analysisSchema.parse({
      ...analysisFixture(),
      sensitivity: [],
      findings: analysisFixture().findings.map((finding) =>
        finding.id === 'f1'
          ? { ...finding, classification: 'unstable', holdsIn: 5, interval: { lo: 0.24, hi: 0.76 } }
          : finding,
      ),
    });
    const caveat = sectionOf(buildBrief(baseInputs({ analysis: unstable })), 'executive-answer')
      .statements[2]!;
    expect(caveat.text).toContain('the headline comparison was unstable');
    expect(caveat.refs.findingIds).toEqual(['f1']);
    const noFindings = analysisSchema.parse({
      ...analysisFixture(),
      sensitivity: [],
      findings: [],
    });
    const evidence = sectionOf(
      buildBrief(baseInputs({ analysis: noFindings })),
      'executive-answer',
    );
    expect(evidence.statements[1]?.origin).toBe('unresolved-uncertainty');
    expect(evidence.statements[1]?.text).toContain('no finding about the direction');
    expect(evidence.statements[2]?.text).toContain(
      'no cited passage supports any of the 5 simulated actors',
    );
  });

  it('says so, and invents no comparison, when there is no baseline or no run', () => {
    const noBaseline = analysisSchema.parse({
      ...analysisFixture(),
      config: { ...analysisFixture().config, variants: [analysisFixture().config.variants[1]] },
      variants: [analysisFixture().variants[1]],
      findings: [],
      sensitivity: [],
    });
    const text = textOf(buildBrief(baseInputs({ analysis: noBaseline })), 'executive-answer');
    expect(text).toContain('No baseline was run, so nothing is compared');
    const empty = analysisSchema.parse({
      ...analysisFixture(),
      variants: [],
      findings: [],
      sensitivity: [],
    });
    const none = buildBrief(baseInputs({ analysis: empty }));
    expect(none.headline).toContain('recorded no simulated runs');
    expect(none.sections).toHaveLength(17);
    expect(lintBrief(none)).toEqual([]);
  });
});

describe('where each source came from', () => {
  const brief = buildBrief(richInputs());
  const sources = sectionOf(brief, 'sources').statements;
  const named = (name: string) => sources.find((statement) => statement.text.includes(name))!;

  it('calls a page retrieved only when this server fetched it, and says how to find it again', () => {
    const page = named('Public page');
    expect(page.origin).toBe('retrieved-public-evidence');
    expect(page.text).toContain('Retrieved by this server from “https://example.test/page”');
    expect(page.text).toContain(`on ${TIME.slice(0, 10)}`);
    expect(page.text).toContain('SHA-256 bbbbbbbbbbbb');
    expect(page.refs.documentIds).toEqual(['doc-2']);
    expect(page.refs.evidence.map((ref) => ref.passageId)).toEqual(['P2']);
  });

  it('keeps an address a person gave, and text they supplied, as supplied by the person', () => {
    const pasted = named('Pasted address.md');
    expect(pasted.origin).toBe('supplied-evidence');
    expect(pasted.text).toContain('this server did not fetch it');
    expect(pasted.text).toContain('No stakeholder or actor cites a passage from it');
    const supplied = named('Supplied notes.md');
    expect(supplied.origin).toBe('supplied-evidence');
    expect(supplied.text).toContain('Supplied by the person.');
    expect(supplied.refs.evidence.map((ref) => ref.passageId)).toEqual(['P1']);
  });

  it('labels historical material as a historical comparison, with the date it describes', () => {
    const earlier = named('Earlier case.md');
    expect(earlier.origin).toBe('historical-comparison');
    expect(earlier.text).toContain('as of 2020-06-01');
  });

  it('shows the evidence base: coverage, the conflict between sources, and what is missing', () => {
    const base = sectionOf(brief, 'evidence-base').statements;
    const conflict = base.find((statement) => statement.text.includes('conflict between sources'))!;
    expect(conflict.text).toContain('Open conflict between sources (detected)');
    expect(conflict.text).toContain('“monthly volume”');
    expect(conflict.refs.evidence.map((ref) => ref.passageId).sort()).toEqual(['P1', 'P3']);
    const coverage = base.find((statement) => statement.text.includes('cited supporting passage'))!;
    expect(coverage.text).toContain(
      '1 of 5 simulated actors have at least one cited supporting passage',
    );
    expect(coverage.origin).toBe('unresolved-uncertainty');
    expect(base.map((statement) => statement.text).join(' ')).toContain(
      'Evidence the person lists as available',
    );
    const missing = base.find((statement) => statement.text.startsWith('Evidence still missing'))!;
    expect(missing.text).toContain('“Independent counts of the group the change affects”');
    expect(missing.origin).toBe('unresolved-uncertainty');
    expect(sectionOf(brief, 'evidence-base').statements[0]?.origin).toBe('supplied-evidence');
    const kinds = base.map((statement) => statement.origin);
    expect(kinds).toContain('retrieved-public-evidence');
    expect(kinds).toContain('historical-comparison');
  });

  it('says that conflicts were not checked when nobody looked, rather than that there were none', () => {
    const text = textOf(buildBrief(baseInputs()), 'evidence-base');
    expect(text).toContain('Conflicts between the sources were not checked');
    expect(text).toContain('No source document is attached');
  });
});

describe('the stakeholders', () => {
  it('lists each with its category, who proposed it, how many passages support it and what is uncertain', () => {
    const brief = buildBrief(richInputs());
    const statements = sectionOf(brief, 'stakeholders').statements;
    const subscribers = statements.find((statement) => statement.text.startsWith('“Subscribers”'))!;
    expect(subscribers.origin).toBe('inferred-stakeholder');
    expect(subscribers.text).toContain('(Bears cost; standard stakeholder, direct)');
    expect(subscribers.text).toContain('2 cited passages support it');
    expect(subscribers.text).toContain('Uncertainty medium');
    expect(subscribers.text).toContain('population assumed at 5000, which is not a count');
    expect(subscribers.refs.stakeholderIds).toEqual(['subscribers']);
    expect(subscribers.refs.evidence.map((ref) => ref.passageId)).toEqual(['P1', 'P2']);
    expect(subscribers.refs.assumptions).toEqual([
      'The group is assumed to be reachable by the provider.',
    ]);
    expect(subscribers.reliance).toBe('moderate');
    const provider = statements.find((statement) => statement.text.startsWith('“Provider”'))!;
    expect(provider.text).toContain('No passage is cited for it');
    expect(provider.reliance).toBe('low');
    const order = statements
      .slice(1, 6)
      .map((statement) => statement.text.split('(')[1]?.split(';')[0]);
    expect(order).toEqual(['Decision maker', 'Bears cost', 'Competitor', 'Partner', 'Regulator']);
    expect(textOf(brief, 'stakeholders')).toContain(
      'Nobody was found for: “No source speaks for the regulator”',
    );
  });

  it('calls a stakeholder a person edited or added theirs, and says what the person removed', () => {
    const set = richStakeholders();
    const edited = set.stakeholders.find((entry) => entry.id === 'resellers')!;
    edited.status = 'edited';
    set.stakeholders.push(
      stakeholderSchema.parse({
        ...set.stakeholders[0],
        id: 'press',
        name: 'Press',
        status: 'removed',
      }),
    );
    const brief = buildBrief(richInputs({ stakeholders: set }));
    const statements = sectionOf(brief, 'stakeholders').statements;
    expect(statements.find((statement) => statement.text.startsWith('“Resellers”'))?.origin).toBe(
      'user-assumption',
    );
    expect(statements.some((statement) => statement.text.startsWith('“Press”'))).toBe(false);
    const removed = statements.find((statement) =>
      statement.text.includes('The person removed 1 proposed stakeholder'),
    )!;
    expect(removed.origin).toBe('user-assumption');
    expect(removed.refs.stakeholderIds).toEqual(['press']);
  });

  it('reads the landscape from the actors when no stakeholder set was recorded, and says so', () => {
    const brief = buildBrief(baseInputs({ stakeholders: null }));
    const statements = sectionOf(brief, 'stakeholders').statements;
    expect(statements[0]?.origin).toBe('unresolved-uncertainty');
    expect(statements[0]?.text).toContain('read from the simulated actors alone');
    expect(statements).toHaveLength(6);
  });
});

describe('how far each statement can be relied on', () => {
  const reliance = (brief: DecisionBrief, start: string) =>
    statementsOf(brief).find((statement) => statement.text.startsWith(start))?.reliance;

  it('is high for a repeatable finding about actors that cited passages support', () => {
    const brief = buildBrief(richInputs());
    expect(reliance(brief, 'Simulated “Subscribers”')).toBe('high');
  });

  it('drops to moderate when the same finding rests on assumptions alone', () => {
    const brief = buildBrief(
      richInputs({ stakeholders: richStakeholders(), analysis: richAnalysis() }),
    );
    const without = buildBrief(
      richInputs({ stakeholders: baseInputs().stakeholders, analysis: richAnalysis() }),
    );
    expect(reliance(brief, 'Simulated “Subscribers”')).toBe('high');
    expect(reliance(without, 'Simulated “Subscribers”')).toBe('moderate');
  });

  it('is moderate for a mostly repeatable finding and low for an unstable one, whatever the evidence', () => {
    const brief = buildBrief(richInputs());
    const executive = sectionOf(brief, 'executive-answer').statements;
    expect(executive[0]?.reliance).toBe('moderate');
    const unstable = sectionOf(brief, 'uncertainty').statements.find((statement) =>
      statement.text.startsWith('Unstable simulated result'),
    );
    expect(unstable?.reliance).toBe('low');
  });

  it('is the weakest of the findings a statement rests on, and absent where there is nothing to judge', () => {
    const brief = buildBrief(richInputs());
    const recommendations = sectionOf(brief, 'recommendations').statements;
    expect(recommendations[0]?.reliance).toBeNull();
    for (const statement of recommendations.slice(1)) expect(statement.reliance).not.toBeNull();
    const decision = sectionOf(brief, 'decision').statements;
    for (const statement of decision) expect(statement.reliance).toBeNull();
    const mitigation = recommendations.find((statement) => statement.text.startsWith('Mitigate'))!;
    expect(mitigation.reliance).toBe('high');
  });
});

describe('the assumptions', () => {
  it('puts the ones the result is sensitive to first, biggest first, and says who owns each', () => {
    const brief = buildBrief(richInputs());
    const statements = sectionOf(brief, 'assumptions').statements;
    const rows = statements
      .filter((statement) => statement.refs.sensitivityIds.length > 0)
      .map((statement) => statement.refs.sensitivityIds[0]);
    // Sensitive by the size of the shift (s3, s1, s2), then the inconclusive one, then the robust one.
    expect(rows).toEqual(['s3', 's1', 's2', 's5', 's4']);
    expect(statements.slice(0, 5).map((statement) => statement.refs.sensitivityIds[0])).toEqual(
      rows,
    );
    const first = statements.find((statement) => statement.refs.sensitivityIds.includes('s1'))!;
    expect(first.text).toContain('“Subscribers”: switching cost is set at 0.40');
    expect(first.text).toContain('The simulated result is sensitive to it');
    expect(first.origin).toBe('system-assumption');
    const intensity = statements.find((statement) => statement.refs.sensitivityIds.includes('s3'))!;
    expect(intensity.origin).toBe('system-assumption');
    const evidenced = statements.find((statement) => statement.refs.sensitivityIds.includes('s2'))!;
    expect(evidenced.origin).toBe('supplied-evidence');
    expect(evidenced.refs.evidence.length).toBeGreaterThan(0);
    const person = statements.find((statement) => statement.refs.sensitivityIds.includes('s4'))!;
    expect(person.origin).toBe('user-assumption');
    expect(person.text).toContain('did not change the simulated result by more than its noise');
    const inconclusive = statements.find((statement) =>
      statement.refs.sensitivityIds.includes('s5'),
    )!;
    expect(inconclusive.text).toContain('could not be settled from these runs');
    expect(
      statements.some((statement) => statement.text.startsWith('Population sizes are assumptions')),
    ).toBe(true);
  });

  it('lists the scenario assumptions with their owners, then the rest of the traits by who set them', () => {
    const inputs = baseInputs();
    inputs.scenario = {
      ...inputs.scenario!,
      assumptions: [
        { id: 'a-one', text: 'The group is reachable.', origin: 'user' },
        { id: 'a-two', text: 'The change is announced once.', origin: 'system' },
      ],
    };
    const actors = analysisFixture().actors.map((actor, index) => ({
      ...actor,
      traits: {
        ...actor.traits,
        trust: {
          ...actor.traits.trust,
          origin: index === 0 ? ('user' as const) : ('model' as const),
        },
        reactivity: { ...actor.traits.reactivity, origin: 'evidence' as const },
      },
    }));
    inputs.analysis = analysisSchema.parse({ ...analysisFixture(), actors });
    const statements = sectionOf(buildBrief(inputs), 'assumptions').statements;
    const one = statements.find((statement) => statement.text.includes('The group is reachable'))!;
    expect(one.origin).toBe('user-assumption');
    expect(one.text).toContain('written or accepted by a person');
    const two = statements.find((statement) => statement.text.includes('announced once'))!;
    expect(two.origin).toBe('system-assumption');
    expect(two.text).toContain('filled in by Swarm and open to edit');
    expect(
      statements.find((statement) => statement.text.includes('were set by a person'))?.origin,
    ).toBe('user-assumption');
    const model = statements.find((statement) => statement.text.includes('proposed by a model'))!;
    expect(model.origin).toBe('system-assumption');
    // Labelled as evidence, but nothing is cited: never shown as evidence.
    const labelled = statements.find((statement) =>
      statement.text.includes('labelled as resting on evidence'),
    )!;
    expect(labelled.origin).toBe('unresolved-uncertainty');
    expect(labelled.text).toContain('no passage is cited');
  });
});

describe('uncertainty', () => {
  const brief = buildBrief(richInputs());
  const statements = sectionOf(brief, 'uncertainty').statements;

  it('lists the unstable results with their numbers, and says that there is no confidence score', () => {
    expect(statements[0]?.text).toContain(
      'Across 4 findings, 1 were repeatable, 2 mostly repeatable, 1 unstable and 0 rare',
    );
    expect(statements[0]?.text).toContain('there is no confidence score');
    const unstable = statements.find((statement) =>
      statement.text.startsWith('Unstable simulated result'),
    )!;
    expect(unstable.refs.findingIds).toEqual(['f4']);
    expect(unstable.text).toContain('held in 5 of 10 seeded runs (Wilson interval 0.24 to 0.76)');
    expect(unstable.text).toContain('do not rely on it');
  });

  it('counts the assumptions the result moved with, and how many have nothing cited behind them', () => {
    const summary = statements.find((statement) =>
      statement.text.includes('perturbed assumptions moved'),
    )!;
    expect(summary.text).toContain('3 of 5 perturbed assumptions moved the simulated outcome');
    expect(summary.text).toContain('2 of those have no cited passage');
  });

  it('shows the fidelity and its caveats, and the open critiques with their status, but not the closed ones', () => {
    expect(statements.some((statement) => statement.text.startsWith('Fidelity: “Rules:'))).toBe(
      true,
    );
    expect(
      statements.some((statement) =>
        statement.text.startsWith('Caveat about how the simulation was run'),
      ),
    ).toBe(true);
    expect(brief.openCritiques).toBe(1);
    const summary = statements.find((statement) => statement.text.includes('not yet closed'))!;
    expect(summary.text).toContain(
      '1 of 2 critiques is not yet closed (0 blocking, 1 major, 0 minor, 0 notes)',
    );
    const open = statements.find(
      (statement) =>
        statement.refs.critiqueIds.includes('c1') && statement.text.startsWith('Open critique'),
    )!;
    expect(open.text).toContain('(major, open)');
    expect(open.refs.findingIds).toEqual(['f2']);
    expect(
      statements.some(
        (statement) =>
          statement.refs.critiqueIds.length === 1 && statement.refs.critiqueIds[0] === 'c2',
      ),
    ).toBe(false);
  });

  it('does not count critiques of another analysis, and says so', () => {
    const other = richInputs();
    other.critiques = { ...other.critiques!, analysisId: 'another-analysis' };
    const result = buildBrief(other);
    expect(result.openCritiques).toBe(0);
    expect(textOf(result, 'uncertainty')).toContain('written for a different analysis');
    expect(result.limitations.join(' ')).toContain('written for a different analysis');
  });

  it('notes that the actors were edited after the analysis ran', () => {
    const inputs = richInputs();
    const edited = actorFixture('subscribers', 'cost-bearer', { size: 9_999 });
    inputs.actors = {
      ...inputs.actors!,
      actors: inputs.actors!.actors.map((actor) => (actor.id === 'subscribers' ? edited : actor)),
    };
    const result = buildBrief(inputs);
    expect(textOf(result, 'uncertainty')).toContain('actors were edited after this analysis ran');
    expect(result.limitations.join(' ')).toContain('edited after the analysis ran');
    expect(textOf(buildBrief(richInputs()), 'uncertainty')).not.toContain('edited after');
  });

  it('says what could not be checked about a model-driven run', () => {
    const analysis = richAnalysis();
    analysis.fidelity = {
      ...analysis.fidelity,
      engine: 'hybrid',
      keyActors: 'model',
      modelRepeats: 1,
      label: 'Hybrid: key actors by a model',
    };
    const text = textOf(buildBrief(richInputs({ analysis })), 'uncertainty');
    expect(text).toContain('run 1 time; its run-to-run variation is not measured');
    expect(text).toContain('still a model’s reading');
  });
});

describe('second-order effects and risks', () => {
  const brief = buildBrief(richInputs());

  it('reads an event chain back from the representative run, without calling it an observation', () => {
    const statements = sectionOf(brief, 'second-order').statements;
    const counter = statements.find((statement) => statement.text.includes('followed in round 3'))!;
    expect(counter.text).toContain('after “The provider announced the change” in round 2');
    expect(counter.text).toContain(
      '“The rival provider answered with an offer aimed at the affected group” followed in round 3',
    );
    expect(counter.text).toContain('not an observation');
    expect(counter.origin).toBe('actor-behavior');
    expect(counter.refs.stakeholderIds).toEqual(['rival-provider']);
    const scrutiny = statements.find((statement) =>
      statement.text.includes('followed in round 4'),
    )!;
    expect(scrutiny.text).toContain('“The regulator asked for information” followed in round 4');
    expect(scrutiny.refs.stakeholderIds).toEqual(['regulator']);
    const finding = statements.find((statement) => statement.refs.findingIds.includes('f3'))!;
    expect(finding.origin).toBe('simulation-aggregation');
    expect(finding.text).toContain('held in 9 of 10 seeded simulated runs');
    expect(finding.text).toContain('an actor outside the organisation (competitor)');
    expect(finding.reliance).toBe('moderate');
  });

  it('lists the risk from a harmed group, and from an actor outside the organisation', () => {
    const statements = sectionOf(brief, 'risks-opportunities').statements;
    const harmed = statements.find((statement) =>
      statement.text.startsWith('Risk: simulated “Subscribers”'),
    )!;
    expect(harmed.origin).toBe('actor-behavior');
    expect(harmed.text).toContain('is set as harmed by the change');
    expect(harmed.refs.findingIds).toEqual(['f2']);
    const outside = statements.find((statement) =>
      statement.text.startsWith('Risk from outside the organisation'),
    )!;
    expect(outside.text).toContain('“Rival provider” (competitor) acted in round 3');
    expect(outside.refs.findingIds).toEqual(['f3']);
    expect(
      statements.some((statement) => statement.text.startsWith('No opportunity is listed')),
    ).toBe(true);
  });

  it('says that nothing was recorded when no second-order event was', () => {
    const text = textOf(buildBrief(baseInputs()), 'second-order');
    expect(text).toContain('No second-order or competitor event was recorded');
  });

  it('lists an opportunity for a benefited group whose simulated members moved toward going along', () => {
    const inputs = baseInputs();
    const analysis = analysisFixture();
    const resellers = analysis.actors.find((actor) => actor.id === 'resellers')!;
    resellers.traits.impact.value = 0.6;
    for (const result of analysis.variants) {
      if (result.variantId !== 'proposed-change') continue;
      for (const run of result.runs) {
        const actor = run.byActor.find((entry) => entry.actorId === 'resellers')!;
        actor.responseShares = {
          ...actor.responseShares,
          adopt: 0.5,
          'accept-with-conditions': 0.4,
          wait: 0.1,
          switch: 0,
          resist: 0,
          'adapt-defensively': 0,
        };
        actor.stanceMean = 0.7;
      }
    }
    inputs.analysis = analysisSchema.parse({
      ...analysis,
      findings: [
        ...analysis.findings,
        {
          id: 'f9',
          kind: 'direction-vs-baseline',
          variantId: 'proposed-change',
          actorId: 'resellers',
          statement:
            'Simulated resellers ended more favourable than under no change in 10 of 10 runs.',
          predicate: 'The actor stance is above the baseline on the same seed.',
          holdsIn: 10,
          of: 10,
          interval: { lo: 0.72, hi: 1 },
          classification: 'repeatable',
        },
      ],
    });
    const brief = buildBrief(inputs);
    const opportunity = sectionOf(brief, 'risks-opportunities').statements.find((statement) =>
      statement.text.startsWith('Opportunity: simulated “Resellers”'),
    )!;
    expect(opportunity.text).toContain('about 9 of its 10 simulated members ended up going along');
    expect(opportunity.refs.findingIds).toEqual(['f9']);
    expect(
      brief.recommendations.some((recommendation) =>
        recommendation.text.startsWith('Build on the favourable response of “Resellers”'),
      ),
    ).toBe(true);
  });
});

describe('the limitations and the appendix', () => {
  const brief = buildBrief(richInputs());

  it('say that actors are synthetic, that counts are not rates, that population sizes are assumed and that nothing was checked against history', () => {
    const text = brief.limitations.join('\n');
    expect(text).toContain('Synthetic actors are not real people');
    expect(text).toContain('None is a rate');
    expect(text).toContain('Population sizes are assumptions');
    expect(text).toContain(
      'one machine with one configuration (10 seeded runs of 8 rounds for each variant, from base seed 100)',
    );
    expect(text).toContain('No historical comparison was made');
    expect(text).toContain('Fidelity: “Rules:');
    expect(sectionOf(brief, 'limitations').statements.map((statement) => statement.text)).toEqual(
      brief.limitations,
    );
  });

  it('gives the seeds, the variants with their strength, the rounds, the cost and every trait with its origin', () => {
    const appendix = textOf(brief, 'technical-appendix');
    expect(appendix).toContain('2 variants, each run 10 times over 8 rounds, from base seed 100');
    expect(appendix).toContain('the recorded seeds run from 100 to 109');
    expect(appendix).toContain('The same seeds are used for every variant');
    expect(appendix).toContain(
      '“Proposed change” (id proposed-change) is an alternative; the change lands in round 2 at strength 0.70',
    );
    expect(appendix).toContain(
      'Cost: 20 simulated runs covering 1300 simulated members; 0 model calls',
    );
    expect(appendix).toContain(
      'Traits of “Subscribers” (cohort, 30 simulated members, population assumed 5000): prior stance 0.00 [s], impact -0.60 [s]',
    );
    expect(appendix).toContain('[s] filled in by Swarm as a default');
    expect(brief.methodology).toMatchObject({
      runsPerVariant: 10,
      baseSeed: 100,
      rounds: 8,
      variants: ['No change', 'Proposed change'],
    });
  });
});

describe('inputs that are large, odd or hostile', () => {
  it('writes a valid brief, withholds nothing and keeps every section within bounds for sixty actors', () => {
    const base = analysisFixture();
    const actors: Actor[] = Array.from({ length: 60 }, (_, index) =>
      actorFixture(`actor-${index + 1}`, index % 5 === 0 ? 'regulator' : 'cost-bearer', {
        kind: 'cohort',
        sampleSize: 3,
      }),
    );
    const runs = (adverse: number) =>
      Array.from({ length: 10 }, (_, index) => ({
        seed: 100 + index,
        stanceMean: 0.1 - adverse,
        responseShares: base.variants[0]!.runs[0]!.responseShares,
        byActor: actors.map((actor) => ({
          actorId: actor.id,
          members: 3,
          stanceMean: 0.1 - adverse,
          responseShares: { ...base.variants[0]!.runs[0]!.responseShares },
        })),
      }));
    const analysis: Analysis = analysisSchema.parse({
      ...base,
      actors,
      relations: [],
      variants: [
        { variantId: 'baseline', runs: runs(0.1), trajectory: base.variants[0]!.trajectory },
        { variantId: 'proposed-change', runs: runs(0.4), trajectory: base.variants[1]!.trajectory },
      ],
      sensitivity: Array.from({ length: 30 }, (_, index) => ({
        ...base.sensitivity[0]!,
        id: `s${index + 1}`,
        shift: -0.01 * (index + 1),
        target: { kind: 'trait', actorId: `actor-${(index % 60) + 1}`, trait: 'switchingCost' },
      })),
      findings: Array.from({ length: 40 }, (_, index) => ({
        ...base.findings[1]!,
        id: `finding-${index + 1}`,
        actorId: `actor-${index + 1}`,
        classification: index % 3 === 0 ? 'unstable' : 'repeatable',
      })),
    });
    const brief = buildBrief({ ...baseInputs({ analysis }), stakeholders: null, actors: null });
    expect(decisionBriefSchema.safeParse(brief).success).toBe(true);
    for (const section of brief.sections)
      expect(section.statements.length, section.id).toBeLessThanOrEqual(40);
    expect(brief.recommendations.length).toBeLessThanOrEqual(12);
    expect(brief.validationPlan.length).toBeLessThanOrEqual(8);
    expect(lintBrief(brief)).toEqual([]);
    expect(brief.methodology.notes.join(' ')).not.toMatch(/withheld/u);
    expect(textOf(brief, 'stakeholders')).toContain('further stakeholders are not listed here');
    expect(textOf(brief, 'technical-appendix')).toContain(
      '36 further simulated actors are not listed here',
    );
  });

  it('keeps names that contain forbidden words, percentages, quotation marks, markup and line breaks as quoted text', () => {
    const hostile =
      'Customers who will certainly leave, 58% of them; <script>alert(1)</script> “quoted” \n new line';
    const set = richStakeholders();
    set.stakeholders[1] = stakeholderSchema.parse({
      ...set.stakeholders[1],
      name: hostile.slice(0, 120),
      relevance: hostile,
    });
    const analysis = richAnalysis();
    analysis.actors = analysis.actors.map((actor) =>
      actor.id === 'subscribers' ? { ...actor, name: hostile.slice(0, 120) } : actor,
    );
    const inputs = richInputs({
      stakeholders: set,
      analysis,
      project: {
        id: 'p',
        name: hostile.slice(0, 100),
        question: `${hostile} ${'x'.repeat(2_000)}`.slice(0, 2_000),
      },
      scenario: { ...richInputs().scenario!, decision: hostile.slice(0, 400), baseline: hostile },
    });
    const brief = buildBrief(inputs);
    expect(decisionBriefSchema.safeParse(brief).success).toBe(true);
    expect(lintBrief(brief)).toEqual([]);
    expect(brief.methodology.notes.join(' ')).not.toMatch(/withheld|nothing to rest on/u);
    for (const statement of statementsOf(brief)) {
      expect(statement.text, statement.id).not.toMatch(/[\r\n]/u);
      expect(statement.text.length).toBeLessThanOrEqual(700);
    }
    expect(textOf(brief, 'decision')).toContain('Customers who will certainly leave, 58% of them');
  });

  it('copes with evidence whose quotation or names are longer than the schema allows', () => {
    const set = richStakeholders();
    set.stakeholders[1]!.evidence = [
      passage({ quote: 'q'.repeat(600), documentName: 'n'.repeat(200) }),
    ];
    const brief = buildBrief(richInputs({ stakeholders: set }));
    expect(decisionBriefSchema.safeParse(brief).success).toBe(true);
    const long = richInputs();
    long.ledgerSummary!.conflicts[0]!.left = passage({
      quote: 'q'.repeat(5_000),
      documentName: 'd'.repeat(900),
    });
    const second = buildBrief(long);
    expect(decisionBriefSchema.safeParse(second).success).toBe(true);
    expect(
      second.sections
        .flatMap((section) => section.statements)
        .flatMap((statement) => statement.refs.evidence)
        .every((ref) => (ref.quote?.length ?? 0) <= 600),
    ).toBe(true);
  });
});
