import { describe, expect, it } from 'vitest';
import type { Analysis, ResponseShares, RunSummary } from '../../../../../shared/analysis';
import { BRIEF_SIGNAL_NOTICES } from '../../../../../shared/brief';
import {
  COMPARISON_INPUTS_UNRECORDED,
  NEWER_ANALYSIS_EXISTS,
} from '../../../../../shared/analysis';
import { briefFixture, visualsFixture } from '../../../test/brief';
import { critiqueFixture } from '../../../test/critics';
import { factsOf, movementOf, pairedRunsOf } from './analysis-model';
import {
  answerParts,
  answerRole,
  chapterFromHash,
  chapterStatements,
  chaptersOf,
  deriveHero,
  freshnessOf,
  gistOf,
  leadIn,
  riskKind,
  verdictOf,
} from './brief-model';
import {
  anchorCritiques,
  bySeriousness,
  filterCritiques,
  NO_FILTER,
  reviewHeadline,
  subjectOf,
  tally,
  mentionsConflicts,
} from './critique-model';
import { clip, listed, perHundred, signedPerHundred } from './format';
import {
  evidenceByThinness,
  filterAssumptions,
  plotCells,
  stabilityBands,
  tornadoReach,
  tornadoRows,
} from './visual-model';

describe('numbers as the brief writes them', () => {
  it('writes a share of simulated members in 100, never as a percent', () => {
    expect(perHundred(0.06258)).toBe('6.3');
    expect(perHundred(0.00416)).toBe('0.42');
    expect(perHundred(0.098)).toBe('9.8');
    expect(perHundred(0.1)).toBe('10');
    expect(perHundred(0.456)).toBe('46');
    expect(perHundred(0)).toBe('0');
  });

  it('signs a difference with a real minus and shows a tiny one as not zero', () => {
    expect(signedPerHundred(0.0584)).toBe('+5.8');
    expect(signedPerHundred(-0.0045)).toBe('\u22120.45');
    expect(signedPerHundred(0)).toBe('0');
    expect(signedPerHundred(0.00004)).toBe('0');
  });

  it('lists in words and clips at a word', () => {
    expect(listed(['a', 'b', 'c'])).toBe('a, b and c');
    expect(listed(['a'])).toBe('a');
    expect(clip('The quick brown fox jumps over the lazy dog', 20)).toBe(
      'The quick brown fox\u2026',
    );
    expect(clip('short', 20)).toBe('short');
  });
});

describe('the executive answer', () => {
  const brief = briefFixture();
  it('recognises the parts the engine labels, and leaves the others alone', () => {
    const parts = answerParts([
      { ...brief.sections[0]!.statements[0]!, text: 'Biggest open caveat: it rests on a default.' },
      {
        ...brief.sections[0]!.statements[0]!,
        text: 'Stability: the finding held in 30 of 30 runs.',
      },
      { ...brief.sections[0]!.statements[0]!, text: 'Something nobody labelled.' },
    ]);
    expect(Object.keys(parts).sort()).toEqual(['caveat', 'stability']);
    expect(answerRole({ ...brief.sections[0]!.statements[0]!, text: 'Nothing here' })).toBeNull();
  });

  it('splits a label from what it labels, and only when there is one', () => {
    expect(leadIn('Change examined: \u201cCopilot\u201d to \u201cintegrated\u201d.')).toEqual({
      label: 'Change examined',
      rest: '\u201cCopilot\u201d to \u201cintegrated\u201d.',
    });
    expect(leadIn('No label in this one.')).toBeNull();
    expect(leadIn('\u201cSubscribers\u201d (Bears cost): 1 cited passage.')).toBeNull();
  });

  it('tells a risk from an opportunity by the label the engine opens with', () => {
    expect(riskKind('Risk: simulated \u201cStaff\u201d is set as harmed.')).toBe('risk');
    expect(riskKind('Risk from outside the organisation: a competitor answered.')).toBe('risk');
    expect(riskKind('Opportunity: a group set as benefited went along.')).toBe('opportunity');
    expect(riskKind('No opportunity is listed.')).toBeNull();
  });
});

describe('the answer the page leads with', () => {
  const visuals = visualsFixture();

  it('is the first alternative against the baseline, in the brief\u2019s own numbers', () => {
    const hero = deriveHero(briefFixture(), visuals)!;
    expect(hero.rows).toHaveLength(1);
    const [row] = hero.rows;
    expect(row).toMatchObject({
      label: 'Proposed change',
      baselineLabel: 'No change',
      share: 0.44,
      baselineShare: 0.09,
      direction: 'higher',
      steadiness: 'steady',
      unread: false,
    });
    expect(verdictOf(row!, 'clear')).toBe(
      'Proposed change raised the share of simulated members looking for an alternative or resisting.',
    );
  });

  it('says lowered for a fall and no net difference for a mean that did not move', () => {
    const lowered = deriveHero(
      briefFixture(),
      visualsFixture({
        scenarioComparison: [
          { ...visuals.scenarioComparison[0]!, shareDelta: -0.03, worseInRuns: 1 },
        ],
      }),
    )!.rows[0]!;
    expect(lowered.direction).toBe('lower');
    expect(verdictOf(lowered, 'clear')).toContain('lowered');
    const flat = deriveHero(
      briefFixture(),
      visualsFixture({
        scenarioComparison: [{ ...visuals.scenarioComparison[0]!, shareDelta: 0.0001 }],
      }),
    )!.rows[0]!;
    expect(flat.direction).toBe('same');
    expect(verdictOf(flat, 'clear')).toContain('no net difference');
  });

  it('does not call a split result steady', () => {
    const mixed = deriveHero(
      briefFixture(),
      visualsFixture({
        scenarioComparison: [{ ...visuals.scenarioComparison[0]!, worseInRuns: 6, pairedRuns: 10 }],
      }),
    )!.rows[0]!;
    expect(mixed.steadiness).toBe('mixed');
  });

  it('leads with the notice, not a result, when the comparison cannot be read as one', () => {
    const none = deriveHero(briefFixture({ signal: 'no-direction' }), visuals)!;
    expect(none.rows[0]!.unread).toBe(true);
    expect(verdictOf(none.rows[0]!, 'no-direction')).toBe(
      BRIEF_SIGNAL_NOTICES['no-direction'].title,
    );
    const same = deriveHero(briefFixture({ signal: 'no-difference' }), visuals)!;
    expect(verdictOf(same.rows[0]!, 'no-difference')).toBe(
      BRIEF_SIGNAL_NOTICES['no-difference'].title,
    );
  });

  it('says no difference of the proposed change only, and no direction of every scenario', () => {
    const second = {
      ...visuals.scenarioComparison[0]!,
      variantId: 'larger',
      label: 'Larger change',
    };
    const two = visualsFixture({ scenarioComparison: [visuals.scenarioComparison[0]!, second] });
    expect(
      deriveHero(briefFixture({ signal: 'no-difference' }), two)!.rows.map((row) => row.unread),
    ).toEqual([true, false]);
    expect(
      deriveHero(briefFixture({ signal: 'no-direction' }), two)!.rows.map((row) => row.unread),
    ).toEqual([true, true]);
  });

  it('has no numbers to lead with when the data behind the charts is gone', () => {
    expect(deriveHero(briefFixture(), null)).toBeNull();
  });
});

describe('the chapters', () => {
  const brief = briefFixture();

  it('reads in the page\u2019s order, with the evidence after the checks and the review beside it', () => {
    const ids = chaptersOf(brief).map((chapter) => chapter.spec.id);
    expect(ids).toEqual([
      'decision',
      'stakeholders',
      'reaction-patterns',
      'alternative-outcomes',
      'first-order',
      'second-order',
      'drivers',
      'assumptions',
      'uncertainty',
      'risks-opportunities',
      'recommendations',
      'validation-plan',
      'evidence-base',
      'sources',
      'review',
      'limitations',
      'technical-appendix',
    ]);
    expect(ids).not.toContain('executive-answer');
  });

  it('skips a section the brief does not hold and keeps one it does not know', () => {
    const trimmed = {
      ...brief,
      sections: [
        ...brief.sections.filter((section) => section.id !== 'second-order'),
        { id: 'unknown-new' as never, title: 'A new section', statements: [], visuals: [] },
      ],
    };
    const ids = chaptersOf(trimmed).map((chapter) => chapter.spec.id);
    expect(ids).not.toContain('second-order');
    expect(ids.at(-1)).toBe('unknown-new');
  });

  it('keeps the reference chapters closed and the story open', () => {
    const closed = chaptersOf(brief)
      .filter((chapter) => chapter.spec.reference)
      .map((chapter) => chapter.spec.id);
    expect(closed).toEqual([
      'assumptions',
      'evidence-base',
      'sources',
      'limitations',
      'technical-appendix',
    ]);
  });

  it('draws recommendations and checks from their own lists, not as statements', () => {
    const recommendations = brief.sections.find((section) => section.id === 'recommendations')!;
    expect(recommendations.statements.some((statement) => statement.id === 'rec-1')).toBe(true);
    expect(
      chapterStatements(recommendations).some((statement) => statement.id.startsWith('rec-')),
    ).toBe(false);
    const checks = brief.sections.find((section) => section.id === 'validation-plan')!;
    expect(chapterStatements(checks).some((statement) => statement.id.startsWith('val-'))).toBe(
      false,
    );
  });

  it('opens the chapter an address names', () => {
    const present = chaptersOf(brief).map((chapter) => chapter.spec.id);
    expect(chapterFromHash('#brief-sources', present)).toBe('sources');
    expect(chapterFromHash('#brief-answer', present)).toBe('answer');
    expect(chapterFromHash('#elsewhere', present)).toBeNull();
  });

  it('counts only what the data holds', () => {
    const visuals = visualsFixture();
    expect(gistOf('validation-plan', brief, visuals)).toBe('1 check \u00b7 none has been run');
    expect(gistOf('recommendations', brief, visuals)).toBe('2 recommendations, best first');
    expect(gistOf('sources', brief, null)).toBeNull();
    expect(gistOf('technical-appendix', brief, null)).toBe(
      '10 runs of 8 rounds \u00b7 seeds 100 to 109',
    );
  });
});

describe('freshness', () => {
  it('is current when nothing changed', () => {
    expect(freshnessOf({ changedSince: [], visualsFrom: 'snapshot' })).toMatchObject({
      current: true,
      action: null,
      summary: '',
      chartsFromNow: false,
    });
  });

  it('asks for the comparison to be run again when what it was made from changed', () => {
    const fresh = freshnessOf({
      changedSince: ['scenario', 'stakeholders'],
      visualsFrom: 'snapshot',
    });
    expect(fresh.action).toBe('rerun');
    expect(fresh.rerun).toEqual(['scenario', 'stakeholders']);
    expect(fresh.summary).toContain('was run before the scenario and the stakeholders changed');
  });

  it('asks for the brief to be written again when only the review or a newer comparison changed', () => {
    const review = freshnessOf({ changedSince: ['critiques'], visualsFrom: 'snapshot' });
    expect(review.action).toBe('regenerate');
    expect(review.summary).toBe('Since it was made, the independent review changed.');
    const newer = freshnessOf({
      changedSince: ['scenario', NEWER_ANALYSIS_EXISTS],
      visualsFrom: 'snapshot',
    });
    expect(newer.action).toBe('regenerate');
    expect(newer.summary).toContain('A newer comparison exists.');
  });

  it('keeps saying so when the comparison recorded nothing of what it was made from', () => {
    const fresh = freshnessOf({
      changedSince: [COMPARISON_INPUTS_UNRECORDED],
      visualsFrom: 'current',
    });
    expect(fresh.unrecorded).toBe(true);
    expect(fresh.action).toBe('rerun');
    expect(fresh.chartsFromNow).toBe(true);
    expect(fresh.current).toBe(false);
  });
});

describe('where a criticism stands in the document', () => {
  const brief = briefFixture();
  const order = chaptersOf(brief).flatMap((chapter) =>
    chapter.section ? [chapter.section.id] : [],
  );

  it('stands beside the first statement, in reading order, that cites what it is about', () => {
    const finding = critiqueFixture({
      id: 'adversarial-f1',
      target: { kind: 'finding', id: 'f1' },
    });
    // Only two chapters cite the finding, so that the first of them in reading order is the one it stands in.
    const cited = briefFixture();
    for (const section of cited.sections) {
      const keeps = section.id === 'alternative-outcomes' || section.id === 'uncertainty';
      for (const statement of section.statements) {
        if (!keeps) statement.refs.findingIds = [];
      }
    }
    const anchors = anchorCritiques(cited, [finding], order);
    const [statementId] = [...anchors.byStatement.keys()];
    const section = cited.sections.find((entry) =>
      entry.statements.some((s) => s.id === statementId),
    )!;
    expect(section.id).toBe('alternative-outcomes');
    expect(anchors.bySection.get('alternative-outcomes')).toEqual([finding]);
  });

  it('stands beside the statement it names, and the one that lists it when nothing else matches', () => {
    const named = critiqueFixture({ id: 'a', target: { kind: 'statement', id: 'stakeholders-1' } });
    const anchors = anchorCritiques(brief, [named], order);
    expect(anchors.byStatement.get('stakeholders-1')).toEqual([named]);
    const listed = critiqueFixture({ id: 'cited', target: { kind: 'brief', id: 'x' } });
    const withRef = briefFixture();
    withRef.sections.find(
      (section) => section.id === 'uncertainty',
    )!.statements[0]!.refs.critiqueIds = ['cited'];
    expect(anchorCritiques(withRef, [listed], order).byStatement.get('uncertainty-1')).toEqual([
      listed,
    ]);
  });

  it('keeps a criticism of the whole with the chapter that is about it', () => {
    const whole = critiqueFixture({ id: 'whole', target: { kind: 'analysis', id: 'analysis-1' } });
    const anchors = anchorCritiques(brief, [whole], order);
    expect(anchors.ofTheWhole).toEqual([whole]);
    expect(anchors.bySection.get('technical-appendix')).toEqual([whole]);
    expect(anchors.byStatement.size).toBe(0);
  });
});

describe('the review', () => {
  const minor = critiqueFixture({ id: 'm', severity: 'minor', status: 'open' });
  const major = critiqueFixture({ id: 'j', severity: 'major', status: 'responded' });
  const blocking = critiqueFixture({ id: 'b', severity: 'blocking', status: 'accepted' });
  const note = critiqueFixture({ id: 'n', severity: 'note', status: 'open', role: 'bias' });

  it('puts the most serious first and an unanswered objection ahead of an answered one', () => {
    expect(bySeriousness([note, minor, major, blocking]).map((c) => c.id)).toEqual([
      'b',
      'j',
      'm',
      'n',
    ]);
    const answered = critiqueFixture({ id: 'x', severity: 'minor', status: 'disputed' });
    expect(bySeriousness([answered, minor]).map((c) => c.id)).toEqual(['m', 'x']);
  });

  it('tallies by severity, status and role', () => {
    const counts = tally([minor, major, blocking, note]);
    expect(counts).toMatchObject({ total: 4, open: 2, answered: 2 });
    expect(counts.bySeverity.major).toBe(1);
    expect(counts.byRole.bias).toBe(1);
    expect(counts.byStatus.accepted).toBe(1);
  });

  it('filters by severity, role and whether anyone has answered', () => {
    const all = [minor, major, blocking, note];
    expect(filterCritiques(all, NO_FILTER)).toHaveLength(4);
    expect(filterCritiques(all, { ...NO_FILTER, status: 'open' }).map((c) => c.id)).toEqual([
      'm',
      'n',
    ]);
    expect(filterCritiques(all, { ...NO_FILTER, status: 'answered' }).map((c) => c.id)).toEqual([
      'j',
      'b',
    ]);
    expect(filterCritiques(all, { ...NO_FILTER, role: 'bias' }).map((c) => c.id)).toEqual(['n']);
    expect(filterCritiques(all, { ...NO_FILTER, severity: 'major' }).map((c) => c.id)).toEqual([
      'j',
    ]);
  });

  it('names what a criticism is about in words the reader knows', () => {
    const brief = briefFixture();
    const visuals = visualsFixture();
    expect(subjectOf({ kind: 'analysis', id: 'a' }, brief, visuals)).toBe(
      'The analysis as a whole',
    );
    expect(subjectOf({ kind: 'stakeholder', id: 'subscribers' }, brief, visuals)).toBe(
      'The group \u201cSubscribers\u201d',
    );
    expect(subjectOf({ kind: 'finding', id: 'f1' }, brief, visuals)).toContain(
      'Under the proposed change',
    );
    expect(subjectOf({ kind: 'finding', id: 'gone' }, brief, null)).toBe('Finding gone');
  });

  it('reports where it stands without a request', () => {
    expect(reviewHeadline(null, false)).toBeNull();
    expect(reviewHeadline(null, true)).toBe('could not be read');
    const view = {
      critiques: {
        analysisId: 'analysis-1',
        generatedAt: '2026-01-01T00:00:00.000Z',
        mode: 'rules' as const,
        critiques: [minor, major],
      },
      revision: 1,
      changedSince: [],
      analysis: { id: 'analysis-1', completedAt: null },
      may: { run: true, respond: true },
      model: { available: false },
    };
    expect(reviewHeadline(view, false)).toBe('1 open');
    expect(reviewHeadline({ ...view, critiques: null }, false)).toBe('not run yet');
    expect(reviewHeadline({ ...view, analysis: { id: 'newer', completedAt: null } }, false)).toBe(
      '1 open, of an earlier comparison',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------------------------

const shares = (adverse: number, wait = 1 - adverse): ResponseShares => ({
  adopt: 0,
  'accept-with-conditions': 0,
  wait,
  'adapt-defensively': 0,
  switch: adverse / 2,
  resist: adverse / 2,
});

const run = (seed: number, adverse: number, byActor: Record<string, number> = {}): RunSummary => ({
  seed,
  stanceMean: -adverse,
  responseShares: shares(adverse),
  byActor: Object.entries(byActor).map(([actorId, own]) => ({
    actorId,
    members: 10,
    stanceMean: -own,
    responseShares: shares(own),
  })),
});

function analysisFixture(variantRuns: RunSummary[], baselineRuns: RunSummary[]): Analysis {
  return {
    id: 'analysis-1',
    config: {
      variants: [
        { id: 'baseline', label: 'No change', kind: 'baseline' },
        { id: 'change', label: 'Change', kind: 'alternative' },
      ],
    },
    actors: [
      { id: 'a', stakeholderId: 'sa', name: 'Staff', kind: 'cohort', category: 'operations' },
      { id: 'b', stakeholderId: 'sb', name: 'Finance', kind: 'cohort', category: 'governance' },
      { id: 'c', stakeholderId: 'sc', name: 'Partners', kind: 'key', category: 'partner' },
    ],
    variants: [
      { variantId: 'baseline', runs: baselineRuns, trajectory: [] },
      { variantId: 'change', runs: variantRuns, trajectory: [] },
    ],
  } as unknown as Analysis;
}

describe('the runs the brief was made from', () => {
  const baseline = [
    run(1, 0.01, { a: 0.01, b: 0.02, c: 0 }),
    run(2, 0.03, { a: 0.03, b: 0.02, c: 0 }),
  ];
  const change = [
    run(1, 0.07, { a: 0.5, b: 0.05, c: 0 }),
    run(2, 0.09, { a: 0.4, b: 0.05, c: 0.01 }),
  ];

  it('pairs each seed with the baseline\u2019s and averages the differences', () => {
    const paired = pairedRunsOf(change, baseline, { variantId: 'change', baselineId: 'baseline' })!;
    expect(paired.runs.map((entry) => Math.round(entry.delta * 100))).toEqual([6, 6]);
    expect(paired.mean).toBeCloseTo(0.06, 6);
    expect(paired.higher).toBe(2);
    expect(paired.lower).toBe(0);
    expect(paired.error).toBeCloseTo(0, 6);
  });

  it('has no pairs when no seed was run under both', () => {
    expect(pairedRunsOf([run(9, 0.1)], baseline, { variantId: 'v', baselineId: 'b' })).toBeNull();
  });

  it('ranks the groups by how far their own share moved, never by how many were sampled', () => {
    const rows = movementOf(analysisFixture(change, baseline), 'change', 'baseline')!;
    expect(rows.map((row) => row.name)).toEqual(['Staff', 'Finance', 'Partners']);
    expect(rows[0]!.delta).toBeCloseTo(0.43, 6);
    expect(rows[0]!.affected).toBe(true);
    expect(rows[2]!.affected).toBe(false);
    expect(rows[0]!.stakeholderId).toBe('sa');
  });

  it('says nothing of which group moved when the two did not run the same seeds', () => {
    expect(
      movementOf(analysisFixture([run(5, 0.1, { a: 0.1 })], baseline), 'change', 'baseline'),
    ).toBeNull();
  });

  it('builds the facts for every alternative against the baseline', () => {
    const facts = factsOf(analysisFixture(change, baseline));
    expect(facts.baselineId).toBe('baseline');
    expect(Object.keys(facts.paired)).toEqual(['change']);
    expect(facts.movement.change).toHaveLength(3);
  });
});

describe('what the charts need', () => {
  it('groups findings by how steadily they held, the steadiest first', () => {
    const bands = stabilityBands([
      {
        id: 'a',
        statement: 'a',
        classification: 'unstable',
        holdsIn: 6,
        of: 10,
        interval: { lo: 0.3, hi: 0.8 },
      },
      {
        id: 'b',
        statement: 'b',
        classification: 'repeatable',
        holdsIn: 10,
        of: 10,
        interval: { lo: 0.7, hi: 1 },
      },
      {
        id: 'c',
        statement: 'c',
        classification: 'repeatable',
        holdsIn: 9,
        of: 10,
        interval: { lo: 0.6, hi: 0.98 },
      },
    ]);
    expect(bands.map((band) => band.classification)).toEqual(['repeatable', 'unstable']);
    expect(bands[0]!.findings.map((finding) => finding.id)).toEqual(['b', 'c']);
  });

  it('puts the assumption that moved the outcome most first and scales every bar to one reach', () => {
    const rows = visualsFixture().sensitivity;
    expect(tornadoRows(rows).map((row) => row.id)).toEqual(['s1', 's2']);
    expect(tornadoReach(rows)).toBeCloseTo(0.19, 6);
  });

  it('puts the thinnest evidence first', () => {
    const rows = evidenceByThinness(visualsFixture().evidenceMap);
    expect(rows[0]!.gap).toBe(true);
  });

  it('filters the assumptions the result is sensitive to', () => {
    const rows = visualsFixture().assumptionRegister;
    expect(filterAssumptions(rows, 'all')).toHaveLength(2);
    expect(filterAssumptions(rows, 'sensitive')).toHaveLength(1);
    expect(filterAssumptions(rows, 'unevidenced')).toHaveLength(2);
  });

  it('places each recommendation by its impact and effort, high impact at the top and low effort on the left', () => {
    const cells = plotCells(briefFixture().recommendations);
    expect(cells).toHaveLength(9);
    const quick = cells.find((cell) => cell.row === 0 && cell.column === 1)!;
    expect(quick.impact).toBe('high');
    expect(quick.effort).toBe('medium');
    expect(quick.recommendations.map((recommendation) => recommendation.id)).toEqual(['rec-1']);
    const second = cells.find((cell) => cell.impact === 'medium' && cell.effort === 'medium')!;
    expect(second.recommendations.map((recommendation) => recommendation.id)).toEqual(['rec-2']);
  });
});

describe('the notes on how a review was made', () => {
  it('finds the ones that speak of the conflicts between the sources, in whatever words the server puts them', () => {
    expect(
      mentionsConflicts(
        'Conflicts between sources were not checked: the sources had not been compared when this review ran. Open Ground to compare them, then run this review again.',
      ),
    ).toBe(true);
    expect(
      mentionsConflicts(
        'The ledger of conflicts between sources has not been built, so those conflicts were not checked.',
      ),
    ).toBe(true);
    expect(mentionsConflicts('Conflict checks were skipped.')).toBe(true);
    expect(
      mentionsConflicts('No scenario was recorded, so the checks against it were skipped.'),
    ).toBe(false);
    expect(mentionsConflicts('The comparison was run before the stakeholders changed.')).toBe(
      false,
    );
  });
});
