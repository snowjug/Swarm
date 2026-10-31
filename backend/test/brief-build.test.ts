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
import { analysisFixture, actorFixture, scenarioFixture } from '../../shared/lab-fixtures.js';
import { stakeholderSchema, type Actor } from '../../shared/stakeholders.js';
import { buildBrief } from '../src/brief/build.js';
import { lintBrief } from '../src/brief/lint.js';
import { perHundred } from '../src/brief/text.js';
import {
  baseInputs,
  passage,
  resampled,
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
  const startingWith = (prefix: string) =>
    executive.statements.find((statement) => statement.text.startsWith(prefix))!;

  it('leads with the engine’s own paired comparison, every actor counting equally, and says how stable it is and which fidelity produced it', () => {
    const shareOf = (variantId: string) => {
      const runs = analysis.variants.find((variant) => variant.variantId === variantId)!.runs;
      return (
        runs.reduce(
          (total, run) => total + run.responseShares.resist + run.responseShares.switch,
          0,
        ) / runs.length
      );
    };
    const comparison = startingWith('With the rules engine');
    expect(comparison.origin).toBe('simulation-aggregation');
    expect(comparison.text).toContain(
      `counting each of the ${analysis.actors.length} simulated actors equally, not each simulated member`,
    );
    expect(comparison.text).toContain(
      `about ${perHundred(shareOf('proposed-change'))} in 100 under “Proposed change” against ${perHundred(shareOf('baseline'))} in 100 under “No change”`,
    );
    expect(comparison.text).toContain('higher under the change in 10 of 10 paired runs');
    expect(comparison.text).toContain('paired standard error');
    // No total of sampled members, which depends on how many were sampled for each group.
    expect(comparison.text).not.toMatch(/\d+ simulated members each/u);
    expect(comparison.refs.findingIds).toEqual(['f1']);
    expect(comparison.refs.variantIds).toEqual(['proposed-change', 'baseline']);
    const stability = startingWith('Stability');
    expect(stability.text).toContain('held in 10 of 10 seeded simulated runs');
    expect(stability.text).toContain('mostly repeatable');
    expect(stability.text).toContain('There is no confidence score');
    expect(stability.text).toContain('does not claim long-run coverage');
  });

  it('carries, in order, the decision, the conditional recommendation, the comparison, the groups it moved, what could change it and what would settle it', () => {
    const starts = executive.statements.map((statement) => statement.text.slice(0, 21));
    expect(starts[0]).toBe('Decision evaluated: “');
    expect(starts[1]).toBe('Recommendation, condi');
    expect(starts[2]).toBe('With the rules engine');
    expect(starts[3]).toBe('The groups whose own ');
    const open = executive.statements.filter((statement) =>
      /^(Biggest open caveat|Also open): /u.test(statement.text),
    );
    // Three assumptions or gaps that could change the answer, the biggest first, each with what it rests on.
    expect(open).toHaveLength(3);
    expect(open[0]?.text).toContain('sensitive to “Subscribers: cost of switching, 0.2 higher”');
    expect(open[0]?.refs.sensitivityIds).toEqual(['s1']);
    expect(open.slice(1).every((statement) => statement.text.startsWith('Also open: '))).toBe(true);
    const settle = startingWith('What would settle');
    expect(settle.text).toMatch(/\(val-\d+\)/u);
    expect(settle.text).toContain('left for you to set');
    expect(executive.statements.indexOf(settle)).toBeGreaterThan(
      executive.statements.indexOf(open[2]!),
    );
    expect(startingWith('Stability')).toBeDefined();
  });

  it('is a conditional recommendation that names its actions and the premises, never an unconditional order', () => {
    const recommendation = startingWith('Recommendation, conditional');
    expect(recommendation.text).toContain(
      'if the checks in the validation plan confirm the premises behind the simulated result',
    );
    expect(recommendation.text).toContain('run the analysis again with the measured values');
    expect(recommendation.text).not.toMatch(/\bwill\b|%/u);
    expect(recommendation.origin).toBe('simulation-aggregation');
    expect(recommendation.refs.findingIds).toContain('f1');
  });

  it('names the groups by their own share, ranked by it, and says why member counts are not used', () => {
    const groups = startingWith('The groups whose own share');
    expect(groups.origin).toBe('actor-behavior');
    expect(groups.text).toMatch(/in 100 of its simulated members, against /u);
    expect(groups.text).toContain('ranked by their own share and never by member counts');
    expect(groups.text).toContain('a numerical resolution');
    expect(groups.refs.stakeholderIds.length).toBeGreaterThan(0);
  });

  it('does not move when only the number of members sampled for a cohort changes', () => {
    // The sampling budget is a numerical resolution: the same shares with five times the members are
    // the same answer. The count of simulated members moves; the lead measure does not.
    const wider = resampled(analysis, 'subscribers', 150);
    const other = buildBrief(baseInputs({ analysis: wider }));
    const lead = (text: DecisionBrief) =>
      sectionOf(text, 'executive-answer')
        .statements.slice(0, 4)
        .map((statement) => statement.text);
    expect(lead(other)).toEqual(lead(brief));
    expect(other.headline).toBe(brief.headline);
    // The count is still there, in the sections that say what it is, and it did move.
    expect(textOf(other, 'reaction-patterns')).toContain('of 163 simulated members');
    expect(textOf(brief, 'reaction-patterns')).toContain('of 43 simulated members');
    expect(textOf(other, 'reaction-patterns')).toContain('a numerical resolution');
  });

  it('ranks the variants by the share of every actor and never by a count of members', () => {
    const text = textOf(brief, 'alternative-outcomes');
    expect(text).toContain(
      'From the lowest to the highest mean share of simulated members looking for an alternative or resisting (each simulated actor counted equally, in every 100)',
    );
    expect(text).not.toContain('From fewest to most simulated members');
  });

  it('ends with what the answer does not tell you', () => {
    const last = executive.statements.at(-1);
    expect(last?.text).toMatch(/^What this does not tell you/u);
    expect(last?.text).toMatch(/neither rates nor forecasts/u);
  });

  it('makes a headline of the comparison, the groups it moved and the biggest caveat, never longer than a statement', () => {
    expect(brief.headline.length).toBeLessThanOrEqual(700);
    expect(brief.headline).toContain(startingWith('With the rules engine').text);
    expect(brief.headline).toContain('The groups moved most were');
    expect(brief.headline).toContain('Biggest open caveat');
    expect(brief.headline).toMatch(/\bsimulated members\b/u);
    expect(brief.headline).toMatch(/\bseeded runs\b/u);
    expect(brief.headline).not.toMatch(/\bwill\b|%/u);
  });

  it('writes the size of a step in an assumption in words, so that no percent sign stands in the headline', () => {
    const stepped = analysisSchema.parse({
      ...analysis,
      sensitivity: analysis.sensitivity.map((row) => ({
        ...row,
        label: `Intensity of Proposed change: 25% higher (${row.id})`,
      })),
    });
    const made = buildBrief(baseInputs({ analysis: stepped }));
    const caveat = sectionOf(made, 'executive-answer').statements.find((statement) =>
      statement.text.startsWith('Biggest open caveat'),
    );
    expect(caveat?.text).toContain('“Intensity of Proposed change: 25 per cent higher (');
    // The headline holds the caveat only if it fits; whatever it holds has no percent sign.
    expect(made.headline).not.toContain('%');
    expect(caveat?.text).not.toContain('%');
  });

  it('advises not deciding when the headline comparison is unstable, and says what is missing when nothing is cited', () => {
    const unstable = analysisSchema.parse({
      ...analysisFixture(),
      sensitivity: [],
      findings: analysisFixture().findings.map((finding) =>
        finding.id === 'f1'
          ? { ...finding, classification: 'unstable', holdsIn: 5, interval: { lo: 0.24, hi: 0.76 } }
          : finding,
      ),
    });
    const caution = sectionOf(
      buildBrief(baseInputs({ analysis: unstable })),
      'executive-answer',
    ).statements.find((statement) => statement.text.startsWith('Recommendation'))!;
    expect(caution.text).toContain('do not decide on this simulated comparison yet');
    expect(caution.text).toContain('held in 5 of 10 seeded runs');
    expect(caution.refs.findingIds).toEqual(['f1']);
    expect(caution.reliance).toBe('low');
    const noFindings = analysisSchema.parse({
      ...analysisFixture(),
      sensitivity: [],
      findings: [],
    });
    const evidence = sectionOf(
      buildBrief(baseInputs({ analysis: noFindings })),
      'executive-answer',
    ).statements;
    const stability = evidence.find((statement) => statement.text.startsWith('Stability'))!;
    expect(stability.origin).toBe('unresolved-uncertainty');
    expect(stability.text).toContain('no finding about the direction');
    expect(
      evidence.some((statement) =>
        statement.text.includes('no cited passage supports “Provider”, “Rival provider”'),
      ),
    ).toBe(true);
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

describe('the scenario', () => {
  const asked = (field: string, message: string) => ({ field, message, question: `${message}?` });
  const openPoints = (brief: DecisionBrief) =>
    sectionOf(brief, 'decision')
      .statements.filter((statement) => statement.text.startsWith('Open point in the scenario'))
      .map((statement) => statement.text);

  it('lists a question the reading left open only while the scenario still leaves it open', () => {
    const scenario = scenarioFixture({
      horizon: null,
      geography: null,
      likelyStakeholders: [],
      ambiguities: [
        asked('horizon', 'The question does not say over what period to look'),
        asked('likelyStakeholders', 'The question does not name the groups that are affected'),
        asked('success', 'The question does not say how a good outcome would be judged'),
      ],
    });
    const open = openPoints(buildBrief(baseInputs({ scenario })));
    expect(open).toHaveLength(3);

    // The person wrote a period and a group into the scenario instead of answering the questions.
    const filled = {
      ...scenario,
      horizon: 'the first twelve months',
      likelyStakeholders: ['Staff'],
    };
    const left = openPoints(buildBrief(baseInputs({ scenario: filled })));
    expect(left).toHaveLength(1);
    expect(left[0]).toContain('how a good outcome would be judged');
    expect(textOf(buildBrief(baseInputs({ scenario: filled })), 'decision')).toContain(
      'horizon “the first twelve months”',
    );
  });

  it('understands a model’s own name for the field a question was about', () => {
    const scenario = scenarioFixture({
      horizon: 'The next two quarters',
      ambiguities: [asked('time horizon', 'The question does not say over what period to look')],
    });
    expect(openPoints(buildBrief(baseInputs({ scenario })))).toEqual([]);
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

  it('does not say the person removed a name that was merged into another group', () => {
    const set = richStakeholders();
    const target = set.stakeholders.find((entry) => entry.id === 'resellers')!;
    const merged = stakeholderSchema.parse({
      ...set.stakeholders[0],
      id: 'small-resellers',
      name: 'Small resellers',
      status: 'removed',
    });
    target.mergedFrom = [merged.id];
    set.stakeholders.push(merged);
    const brief = buildBrief(richInputs({ stakeholders: set }));
    const statements = sectionOf(brief, 'stakeholders').statements;
    expect(statements.some((statement) => statement.text.includes('The person removed'))).toBe(
      false,
    );
    const merge = statements.find((statement) => statement.text.includes('merged into another'))!;
    expect(merge.text).toContain('“Small resellers” into “Resellers”');
    // Who merged them is not known from the record, so it is not said to be the person.
    expect(merge.origin).toBe('inferred-stakeholder');
    expect(merge.refs.stakeholderIds).toEqual(['small-resellers', 'resellers']);
    expect(lintBrief(brief)).toEqual([]);
  });

  it('still says the person removed a stakeholder that nothing was merged into', () => {
    const set = richStakeholders();
    const merged = stakeholderSchema.parse({
      ...set.stakeholders[0],
      id: 'small-resellers',
      name: 'Small resellers',
      status: 'removed',
    });
    set.stakeholders.find((entry) => entry.id === 'resellers')!.mergedFrom = [merged.id];
    set.stakeholders.push(
      merged,
      stakeholderSchema.parse({
        ...set.stakeholders[0],
        id: 'press',
        name: 'Press',
        status: 'removed',
      }),
    );
    const statements = sectionOf(
      buildBrief(richInputs({ stakeholders: set })),
      'stakeholders',
    ).statements;
    const removed = statements.find((statement) => statement.text.includes('The person removed'))!;
    expect(removed.text).toContain('The person removed 1 proposed stakeholder');
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
    expect(
      executive.find((statement) => statement.text.startsWith('With the rules engine'))?.reliance,
    ).toBe('moderate');
    const unstable = sectionOf(brief, 'uncertainty').statements.find((statement) =>
      statement.text.startsWith('Unstable simulated result'),
    );
    expect(unstable?.reliance).toBe('low');
  });

  it('is the weakest of the findings a statement rests on, and absent where there is nothing to judge', () => {
    const brief = buildBrief(richInputs());
    const recommendations = sectionOf(brief, 'recommendations').statements;
    expect(recommendations[0]?.reliance).toBeNull();
    // What follows from a count over seeded runs carries the reliance of its findings; advice about
    // evidence, assumptions or critiques rests on no finding and carries none.
    for (const statement of recommendations.slice(1)) {
      expect(statement.reliance === null, statement.text).toBe(
        statement.origin !== 'simulation-aggregation' || statement.refs.findingIds.length === 0,
      );
    }
    const decision = sectionOf(brief, 'decision').statements;
    for (const statement of decision) expect(statement.reliance).toBeNull();
    const mitigation = recommendations.find((statement) => statement.text.startsWith('Mitigate'))!;
    expect(mitigation.reliance).toBe('high');
  });

  it('does not come from a finding about something else: a distribution rests on the comparison, a group on its adverse response', () => {
    const analysis = richAnalysis();
    // An unstable ordering of groups and an unstable event say nothing of the mean outcome or of a group's share.
    analysis.findings = analysis.findings.map((finding) =>
      finding.kind === 'ordering' || finding.kind === 'second-order-event'
        ? { ...finding, classification: 'unstable' as const }
        : finding,
    );
    const brief = buildBrief(richInputs({ analysis }));
    const patterns = sectionOf(brief, 'reaction-patterns').statements;
    const distribution = patterns.find((statement) =>
      statement.text.startsWith('Under “Proposed change”, counting each simulated actor equally'),
    )!;
    expect(
      distribution.refs.findingIds.map(
        (id) => analysis.findings.find((finding) => finding.id === id)?.kind,
      ),
    ).toEqual(['direction-vs-baseline']);
    expect(distribution.reliance).not.toBe('low');
    for (const statement of patterns.filter((entry) => entry.origin === 'actor-behavior')) {
      for (const id of statement.refs.findingIds) {
        const linked = analysis.findings.find((finding) => finding.id === id);
        expect(linked?.kind, statement.text).toBe('majority-response');
      }
    }
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

  it('reads an impact that rests on a cited passage as an assumption about its size, and shows the passage for its direction only', () => {
    const impact = (origin: 'evidence' | 'system-assumption') => ({
      id: 's6',
      target: { kind: 'trait' as const, actorId: 'subscribers', trait: 'impact' },
      label: 'Subscribers: how the change lands on them (impact), 0.2 lower',
      perturbation: -0.2,
      metric: 'Share ending in switch or resist',
      baseMean: 0.45,
      shift: 0.2,
      standardError: 0.01,
      classification: 'assumption-sensitive' as const,
      assumptionOrigin: origin,
    });
    const made = (cited: boolean) => {
      const given = richInputs();
      // Saved before size and direction were told apart: the whole impact labelled evidence.
      const actors = given.analysis.actors.map((actor) =>
        actor.id === 'subscribers'
          ? {
              ...actor,
              traits: { ...actor.traits, impact: { ...actor.traits.impact, origin: 'evidence' } },
            }
          : actor,
      );
      given.analysis = analysisSchema.parse({
        ...given.analysis,
        actors,
        sensitivity: [...given.analysis.sensitivity, impact('evidence')],
      });
      if (!cited) {
        given.stakeholders = {
          ...given.stakeholders!,
          stakeholders: given.stakeholders!.stakeholders.map((stakeholder) =>
            stakeholder.id === 'subscribers' ? { ...stakeholder, evidence: [] } : stakeholder,
          ),
        };
      }
      const brief = buildBrief(given);
      const row = sectionOf(brief, 'assumptions').statements.find((statement) =>
        statement.refs.sensitivityIds.includes('s6'),
      )!;
      const first = sectionOf(brief, 'first-order').statements.find((statement) =>
        statement.text.startsWith('Simulated “Subscribers”'),
      )!;
      return { row, first };
    };
    const backed = made(true);
    expect(backed.row.origin).toBe('system-assumption');
    expect(backed.row.refs.evidence).toEqual([]);
    expect(backed.row.text).toContain('Subscribers”: impact is set at -0.60');
    expect(backed.row.text).toContain(
      'only its direction rests on a cited passage, which gives no size',
    );
    expect(backed.first.text).toContain(
      'impact -0.60, the direction rests on a cited passage and the size is an assumption',
    );
    const gone = made(false);
    expect(gone.row.origin).toBe('system-assumption');
    expect(gone.row.text).toContain(
      'its direction was labelled as resting on evidence, but no passage is cited for it now',
    );
    expect(gone.row.text).not.toContain('rests on a cited passage');
    expect(gone.first.text).toContain(
      'the direction is labelled as resting on evidence but no passage is cited for it now',
    );
    expect(gone.first.text).not.toContain('labelled as resting on evidence,');
  });

  it('says that a strength or a round the person set is theirs, and leaves the rest to the system', () => {
    const base = analysisFixture();
    const analysis = analysisFixture({
      config: {
        ...base.config,
        variants: base.config.variants.map((variant) =>
          variant.id === 'proposed-change'
            ? {
                ...variant,
                round: 3,
                intensity: 0.6,
                description: 'Intensity 0.6 from round 3 was set by you.',
              }
            : variant,
        ),
      },
    });
    const brief = buildBrief(baseInputs({ analysis }));
    const statements = sectionOf(brief, 'decision').statements;
    const theirs = statements.find((statement) =>
      statement.text.startsWith('Variants whose strength or timing the person set'),
    )!;
    expect(theirs.origin).toBe('user-assumption');
    expect(theirs.text).toContain(
      '“Proposed change” (alternative, lands in round 3 at strength 0.60',
    );
    expect(theirs.refs.variantIds).toEqual(['proposed-change']);
    const system = statements.find((statement) => statement.text.startsWith('Variants simulated'))!;
    expect(system.origin).toBe('system-assumption');
    expect(system.text).toContain('“No change” (baseline)');
    expect(system.text).not.toContain('Proposed change');
    expect(system.refs.variantIds).toEqual(['baseline']);
    expect(lintBrief(brief)).toEqual([]);
    // Nothing the person set means no statement that says so.
    expect(
      sectionOf(buildBrief(baseInputs()), 'decision').statements.some((statement) =>
        statement.text.startsWith('Variants whose strength or timing'),
      ),
    ).toBe(false);
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
    expect(unstable.text).toContain(
      'held in 5 of 10 seeded runs (Wilson interval 0.24 to 0.76, descriptive of these runs)',
    );
    expect(unstable.text).toContain('do not rely on it');
  });

  it('counts the assumptions the result moved with, and how many have nothing cited behind them', () => {
    const summary = statements.find((statement) =>
      statement.text.includes('perturbed assumptions moved'),
    )!;
    expect(summary.text).toContain('3 of 5 perturbed assumptions moved the simulated outcome');
    expect(summary.text).toContain('2 of those have no cited passage');
  });

  it('shows the fidelity and its caveats, and the critiques not yet closed with their status, but not the closed ones', () => {
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
        statement.refs.critiqueIds.includes('c1') &&
        statement.text.startsWith('Critique not yet closed'),
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

  it('says that an earlier event was needed only where the run was replayed without it, and otherwise only that it came first', () => {
    const event = (
      id: string,
      round: number,
      actorId: string,
      description: string,
      extra = {},
    ) => ({
      id,
      round,
      kind: 'counter-move',
      actorId,
      description,
      causedBy: [] as string[],
      ...extra,
    });
    const events = [
      event('e1', 2, 'provider', 'The provider announced the change.'),
      event('e2', 3, 'rival-provider', 'The rival provider made an offer.', {
        causedBy: ['adverse-share', 'e1'],
      }),
      event('e3', 4, 'regulator', 'The regulator asked for information.', {
        causedBy: ['risk-concern'],
        followed: ['e1'],
      }),
    ];
    const made = (explained: boolean) => {
      const given = richInputs();
      given.analysis = analysisSchema.parse({
        ...given.analysis,
        representativeRun: {
          ...given.analysis.representativeRun!,
          events,
          ...(explained ? { explained: true } : {}),
        },
      });
      return sectionOf(buildBrief(given), 'second-order').statements.map(
        (statement) => statement.text,
      );
    };
    const replayed = made(true);
    const needed = replayed.find((text) => text.includes('could not have happened without'))!;
    expect(needed).toContain(
      '“The rival provider made an offer” in round 3 could not have happened without “The provider announced the change” in round 2: a replay of the same seed without that responder had no such event by then.',
    );
    expect(needed).toContain('not an observation');
    const only = replayed.find((text) => text.includes('regulator asked'))!;
    expect(only).toContain(
      'after “The provider announced the change” in round 2, “The regulator asked for information” followed in round 4. Nothing shows that the earlier event mattered: a replay of the same seed without the responder still had this event',
    );
    expect(only).not.toContain('could not have happened');
    // A run that was not replayed says nothing was tested, and an event it names as earlier only came first.
    const older = made(false).join('\n');
    expect(older).not.toContain('could not have happened without');
    expect(older).toContain('the run was not replayed without the responder');
  });

  it('says which signal an event happened after when no event followed another', () => {
    const given = richInputs();
    given.analysis = analysisSchema.parse({
      ...given.analysis,
      representativeRun: {
        ...given.analysis.representativeRun!,
        events: [
          {
            id: 'e1',
            round: 3,
            kind: 'counter-move',
            actorId: 'rival-provider',
            description: 'The rival provider made an offer.',
            causedBy: ['adverse-share'],
          },
        ],
        explained: true,
      },
    });
    const text = textOf(buildBrief(given), 'second-order');
    expect(text).toContain(
      '“The rival provider made an offer” occurred in round 3, when the simulated “adverse-share” signal it watches reached its threshold.',
    );
    expect(text).not.toContain('following from');
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

  it('names what a variant sets for particular actors, so that an intervention is not only a label', () => {
    const analysis = richAnalysis();
    const [subscribers, other] = analysis.actors;
    const withIntervention = buildBrief(
      richInputs({
        analysis: {
          ...analysis,
          config: {
            ...analysis.config,
            variants: analysis.config.variants.map((variant) =>
              variant.kind === 'baseline'
                ? variant
                : {
                    ...variant,
                    impactOverrides: { [subscribers!.id]: 0 },
                    traitEdits: [{ actorId: other!.id, trait: 'switchingCost', value: 0.9 }],
                  },
            ),
          },
        },
      }),
    );
    const decision = textOf(withIntervention, 'decision');
    expect(decision).toContain(
      `lands in round 2 at strength 0.70 of 1; it sets the impact on “${subscribers!.name}” to 0.00 and the switching cost of “${other!.name}” to 0.90)`,
    );
    // The baseline sets nothing, and nothing is said where nothing is set.
    expect(decision).toContain('“No change” (baseline)');
    expect(textOf(brief, 'decision')).not.toContain('it sets');
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
