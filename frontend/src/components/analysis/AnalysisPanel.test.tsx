import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runOutcomeSchema,
  type Analysis,
  type Finding,
  type SensitivityRow,
  type Variant,
} from '../../../../shared/analysis';
import type { AnalysisReadiness, AnalysisSummary } from '../../../../shared/analysis-plan';
import { FIXTURE_VARIANTS, analysisFixture } from '../../../../shared/lab-fixtures';
import { NO_DIRECTION_NOTICE } from '../../../../shared/signal';
import type { AnalysisState } from '../../hooks/useAnalysis';
import { projectFixture } from '../../test/project';
import { visibleText } from '../../test/provider';
import { AnalysisPanel, AnalysisView } from './AnalysisPanel';

const STATEMENT =
  'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.';

const alternative: Variant = {
  id: 'smaller-rise',
  label: 'Smaller rise',
  kind: 'alternative',
  description:
    'Half the proposed amount. Intensity 0.5 from round 2 is a system assumption (the proposed change is 0.7): edit it to say how much stronger or weaker this alternative is.',
  round: 2,
  intensity: 0.5,
  impactOverrides: {},
  traitEdits: [],
};

const readiness = (patch: Partial<AnalysisReadiness> = {}): AnalysisReadiness => ({
  actors: { count: 5, members: 43 },
  suggestedVariants: [...FIXTURE_VARIANTS, alternative],
  perturbations: 38,
  rounds: 12,
  warnings: [],
  may: { run: true },
  ...patch,
});

const state = (patch: Partial<AnalysisState> = {}): AnalysisState => ({
  readiness: readiness(),
  summaries: [],
  current: null,
  loading: false,
  error: null,
  starting: false,
  startError: null,
  cancelling: false,
  reload: () => undefined,
  start: async () => true,
  cancel: async () => undefined,
  select: () => undefined,
  ...patch,
});

const view = (patch: Partial<AnalysisState> = {}, onOpenStep?: () => void) =>
  renderToStaticMarkup(<AnalysisView state={state(patch)} onOpenStep={onOpenStep} />);

const sensitivityRow = (patch: Partial<SensitivityRow>): SensitivityRow => ({
  ...analysisFixture().sensitivity[0]!,
  ...patch,
});

/** A finished comparison with every part the screen shows: a chain of events, sensitivity of each kind and a cross-check. */
function finished(patch: Partial<Analysis> = {}): Analysis {
  const base = analysisFixture();
  const shares = {
    adopt: 0,
    'accept-with-conditions': 0,
    wait: 1,
    'adapt-defensively': 0,
    switch: 0,
    resist: 0,
  };
  return {
    ...base,
    sensitivity: [
      sensitivityRow({
        id: 's1',
        label: 'Subscribers: cost of switching, 0.2 higher',
        shift: -0.12,
        assumptionOrigin: 'system-assumption',
      }),
      sensitivityRow({
        id: 's2',
        label: 'Regulator: trust in the party making the change, 0.2 lower',
        shift: 0.08,
        classification: 'assumption-sensitive',
        assumptionOrigin: 'evidence',
      }),
      sensitivityRow({
        id: 's3',
        label: 'Intensity of Proposed change: 25% higher (0.7 to 0.875)',
        shift: 0.01,
        standardError: 0.002,
        classification: 'robust',
        assumptionOrigin: 'scenario',
      }),
    ],
    representativeRun: runOutcomeSchema.parse({
      seed: 104,
      variantId: 'proposed-change',
      rounds: [{ round: 1, stanceMean: 0, responseShares: shares, byActor: [], signals: {} }],
      final: { stanceMean: -0.2, responseShares: shares, byActor: [] },
      events: [
        {
          id: 'event-1',
          round: 3,
          kind: 'counter-move',
          actorId: 'rival-provider',
          description: 'A simulated counter-move followed the rise in adverse responses.',
          causedBy: ['adverse-share'],
        },
        {
          id: 'event-2',
          round: 4,
          kind: 'switching-pressure',
          actorId: 'subscribers',
          description: 'Switching became cheaper.',
          causedBy: ['event-1'],
        },
      ],
      work: { members: 10, updates: 10 },
    }),
    crossCheck: {
      primaryStanceMean: -0.05,
      withinEnsembleRange: false,
      note: 'The deep-dive run’s final mean stance (-0.05) is outside the range from the 10th to the 90th percentile (-0.3 to -0.1) of the 10 seeded runs of “Proposed change”. The two use different engines, so this is a plausibility check, not a validation.',
    },
    ...patch,
  };
}

/** The same comparison, of a cast in which no stakeholder has an expected direction of impact. */
const withoutDirection = (analysis: Analysis): Analysis => ({
  ...analysis,
  actors: analysis.actors.map((actor) => ({
    ...actor,
    traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0 } },
  })),
});

const GROUPS = [
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'India',
  'Juliet',
  'Kilo',
  'Lima',
  'Mike',
  'November',
];

/** Fourteen findings, the unstable ones first as a server may leave them, to be put in the order to read them. */
function crowdedFindings(): Finding[] {
  const make = (
    name: string,
    classification: Finding['classification'],
    holdsIn: number,
    interval: Finding['interval'],
  ): Finding => ({
    id: `finding-${name.toLowerCase()}`,
    kind: 'majority-response',
    variantId: 'proposed-change',
    actorId: 'subscribers',
    statement: `In ${holdsIn} of 10 seeded runs, the largest group of simulated members of ${name} ended up waiting and seeing under Proposed change.`,
    predicate: `Waiting and seeing is the largest of the response groups among the simulated members of ${name}.`,
    holdsIn,
    of: 10,
    interval,
    classification,
  });
  return [
    ...GROUPS.slice(0, 5).map((name) => make(name, 'unstable', 5, { lo: 0.24, hi: 0.76 })),
    ...GROUPS.slice(5, 8).map((name) => make(name, 'mostly-repeatable', 8, { lo: 0.49, hi: 0.94 })),
    ...GROUPS.slice(8).map((name) => make(name, 'repeatable', 10, { lo: 0.72, hi: 1 })),
  ];
}

/** Nine assumptions that were moved, the sensitive ones first as the server puts them. */
function crowdedSensitivity(): SensitivityRow[] {
  return Array.from({ length: 9 }, (_, index) =>
    sensitivityRow({
      id: `row-${index + 1}`,
      label: `Assumption number ${index + 1}`,
      shift: 0.2 - index * 0.02,
      classification: index < 4 ? 'assumption-sensitive' : index < 7 ? 'inconclusive' : 'robust',
      assumptionOrigin: index % 2 === 0 ? 'system-assumption' : 'evidence',
    }),
  );
}

/** One disclosure, and the page without it, so that what is behind it can be told from what is not. */
function disclosed(html: string, label: RegExp): { inside: string; outside: string } {
  const at = html.search(label);
  if (at < 0) throw new Error(`No disclosure says ${String(label)}.`);
  const start = html.lastIndexOf('<details', at);
  let depth = 0;
  for (const match of html.slice(start).matchAll(/<(\/?)details\b/gu)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) {
      const end = start + match.index + '</details>'.length;
      return { inside: html.slice(start, end), outside: html.slice(0, start) + html.slice(end) };
    }
  }
  throw new Error('The disclosure never closes.');
}

const summary = (patch: Partial<AnalysisSummary> = {}): AnalysisSummary => ({
  id: 'analysis-1',
  status: 'completed',
  createdAt: '2026-01-15T10:00:00.000Z',
  completedAt: '2026-01-15T10:00:04.000Z',
  runsPerVariant: 10,
  variants: [{ id: 'baseline', label: 'No change' }],
  sensitivity: true,
  progress: { completedRuns: 20, totalRuns: 20 },
  findings: 2,
  sensitivityRows: 1,
  cost: {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    simulatedRuns: 21,
    simulatedMembers: 1_300,
    wallMs: 4_000,
  },
  fidelityLabel: 'Rules: outcomes follow from the declared assumptions',
  error: null,
  ...patch,
});

afterEach(() => vi.restoreAllMocks());

describe('before anything has run', () => {
  it('says that it is reading, and calls no API while it renders', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const html = renderToStaticMarkup(<AnalysisPanel project={projectFixture()} />);
    expect(visibleText(html)).toContain('Reading saved comparisons');
    expect(html).not.toContain('<form');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('says that the saved comparisons could not be read, and offers to try again', () => {
    const html = view({ readiness: null, error: 'The server returned an unreadable response.' });
    const text = visibleText(html);
    expect(text).toContain('Saved comparisons could not be read');
    expect(text).toContain('The server returned an unreadable response.');
    expect(text).toContain('Retry');
    expect(html).toContain('role="alert"');
  });

  it('explains that actors are needed first, and offers a way to the step that makes them', () => {
    const plain = view({
      readiness: readiness({ actors: null, suggestedVariants: [], perturbations: 0 }),
    });
    expect(visibleText(plain)).toContain('No simulated actors yet');
    expect(visibleText(plain)).toContain(
      'Approve the stakeholders and create the actors in the Env Setup step',
    );
    expect(plain).not.toContain('<form');
    expect(plain).not.toContain('Open Env Setup');
    const linked = view(
      { readiness: readiness({ actors: null, suggestedVariants: [] }) },
      () => undefined,
    );
    expect(visibleText(linked)).toContain('Open Env Setup');
  });
});

describe('the scenarios to compare', () => {
  it('shows the baseline, the proposed change and each alternative, each editable, with its assumption stated', () => {
    const html = view();
    const text = visibleText(html);
    expect(html).toContain('<form');
    expect(text).toContain('Baseline');
    expect(text).toContain('Nothing changes: intensity 0');
    expect(text).toContain('Alternative 1');
    expect(text).toContain('Alternative 2');
    expect(html).toContain('value="Proposed change"');
    expect(html).toContain('value="Smaller rise"');
    expect(html.match(/How strongly it lands \(0 to 1\)/gu)).toHaveLength(2);
    expect(html.match(/Starts in round \(1 to 12\)/gu)).toHaveLength(2);
    expect(html).toMatch(/type="number"[^>]*min="0"[^>]*max="1"[^>]*step="0.05"[^>]*value="0.7"/u);
    expect(text).toContain('is a system assumption');
    expect(text).toContain('Add an alternative');
  });

  it('labels every field, and ties each label to its input', () => {
    const html = view();
    for (const match of html.matchAll(/<label for="([^"]+)"/gu)) {
      expect(html, match[1]).toContain(`id="${match[1]}"`);
    }
    expect((html.match(/<label for=/gu) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(html.match(/<input[^>]*type="checkbox"/gu)).toHaveLength(1);
  });

  it('offers 10, 30 and 100 seeded runs, with 30 chosen, and has sensitivity on', () => {
    const html = view();
    expect(html).toContain('<option value="10">10 runs</option>');
    expect(html).toMatch(/<option value="30" selected="">30 runs<\/option>/u);
    expect(html).toContain('<option value="100">100 runs</option>');
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/u);
    expect(visibleText(html)).toContain('Also test which assumptions the result is sensitive to');
  });

  it('says what it will cost before it starts: runs, no model, and how long the last one took', () => {
    const text = visibleText(
      view({ summaries: [summary({ cost: { ...summary().cost, wallMs: 4_200 } })] }),
    );
    expect(text).toContain('This runs 90 simulated runs (3 scenarios × 30 seeds)');
    expect(text).toContain('1,140 for sensitivity');
    expect(text).toContain('No model is called');
    expect(text).toContain('The last comparison on this project took 4.2 s.');
  });

  it('has one button that starts it, and disables it while it is starting', () => {
    const html = view();
    expect(visibleText(html)).toContain('Compare scenarios');
    expect(html).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>/u);
    const starting = view({ starting: true });
    expect(starting).toMatch(
      /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/u,
    );
    expect(visibleText(starting)).toContain('Starting the comparison');
  });

  it('says why a person who may not run cannot start one, and shows what failed to start', () => {
    const viewer = view({ readiness: readiness({ may: { run: false } }) });
    expect(visibleText(viewer)).toContain('You can read comparisons but not start one');
    expect(viewer).toMatch(
      /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/u,
    );
    const failed = view({
      startError: 'A comparison of scenarios is already running for this project.',
    });
    expect(visibleText(failed)).toContain('The comparison did not start');
    expect(visibleText(failed)).toContain('already running');
  });
});

describe('before the run: the time it takes, and a warning that the change cannot move anyone', () => {
  const warned = readiness({ warnings: [NO_DIRECTION_NOTICE] });

  it('says how long it takes from the measured speed of the engine, in one line, and not from an assumed speed', () => {
    const small = visibleText(view());
    expect(small).toContain('server time only, about 2 to 4 seconds.');
    expect(small).toContain(
      'The time is estimated from the engine’s measured speed, not an assumed one',
    );
    expect(small).toContain('about 2 to 3 ms a run for a typical cast');
    expect(small.split('measured speed')).toHaveLength(2);
    const large = visibleText(
      view({ readiness: readiness({ actors: { count: 60, members: 12_000 } }) }),
    );
    expect(large).toContain(
      '1,140 for sensitivity (30 seeds, 38 assumptions moved one at a time): 1,230 in all',
    );
    expect(large).toContain('server time only, about 20 to 40 seconds.');
  });

  it('shows the notice before the button that starts it, with the way to the stakeholder review', () => {
    const html = view({ readiness: warned }, () => undefined);
    const text = visibleText(html);
    expect(text).toContain('Nothing in this change can move anyone yet');
    expect(text).toContain(NO_DIRECTION_NOTICE);
    expect(text).toContain('Open the stakeholder review');
    const start = html.indexOf('type="submit"');
    expect(html.indexOf('Nothing in this change can move anyone yet')).toBeGreaterThan(-1);
    expect(html.indexOf('Nothing in this change can move anyone yet')).toBeLessThan(start);
    expect(html.indexOf('Open the stakeholder review')).toBeLessThan(start);
    expect(html).toContain('role="status"');
  });

  it('does not stop the run: a comparison with no change is a fair test of chance', () => {
    const html = view({ readiness: warned });
    expect(html).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>/u);
    expect(visibleText(html)).toContain(
      'You can still run it: with nothing to move, it shows only how much the simulation varies by chance.',
    );
    // Without a way to open another step the notice still says what to do, and offers no button.
    expect(html).not.toContain('Open the stakeholder review');
  });

  it('says nothing of it when someone is helped or harmed, or whoever may not run it can still read it', () => {
    expect(visibleText(view())).not.toContain('Nothing in this change can move anyone yet');
    const viewer = view({
      readiness: readiness({ warnings: [NO_DIRECTION_NOTICE], may: { run: false } }),
    });
    expect(visibleText(viewer)).toContain(NO_DIRECTION_NOTICE);
    expect(visibleText(viewer)).toContain('You can read comparisons but not start one');
  });

  it('shows any other warning as it was written', () => {
    const other = visibleText(
      view({ readiness: readiness({ warnings: ['Something else to know.'] }) }),
    );
    expect(other).toContain('Something else to know.');
    expect(other).not.toContain('Open the stakeholder review');
  });

  it('calls no API while it renders, with or without a warning', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    view({ readiness: warned }, () => undefined);
    view();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('while it runs', () => {
  const running = analysisFixture({
    status: 'running',
    completedAt: null,
    progress: { completedRuns: 12, totalRuns: 90 },
    variants: [],
    findings: [],
    sensitivity: [],
  });

  it('shows how far it has got, as a labelled progress bar and in words, with a way to cancel', () => {
    const html = view({ current: running });
    expect(html).toMatch(/role="progressbar"[^>]*aria-label="Comparison progress"/u);
    expect(html).toContain('aria-valuemax="90"');
    expect(html).toContain('aria-valuenow="12"');
    expect(html).toContain('aria-valuetext="12 of 90 simulated runs finished"');
    // Announced to a screen reader in tenths, so that it is not read out on every run.
    expect(html).toMatch(
      /<p class="sr-only" role="status">Comparing scenarios: about 10% of the simulated runs are finished\.<\/p>/u,
    );
    expect(html).not.toContain('aria-live');
    expect(visibleText(html)).toContain('Running: 12 of 90 simulated runs finished.');
    expect(visibleText(html)).toContain('Cancel the comparison');
    expect(html).not.toContain('<form');
  });

  it('says that it is cancelling, and does not offer cancel to someone who may not run it', () => {
    const cancelling = view({ current: running, cancelling: true });
    expect(visibleText(cancelling)).toContain('Cancelling: it stops after the run in progress.');
    expect(cancelling).toMatch(/<button[^>]*disabled=""/u);
    const viewer = view({ current: running, readiness: readiness({ may: { run: false } }) });
    expect(visibleText(viewer)).not.toContain('Cancel the comparison');
  });
});

describe('a comparison that did not finish', () => {
  it('says that it was cancelled, why nothing is shown, and offers to run it again', () => {
    const html = view({
      current: analysisFixture({
        status: 'cancelled',
        progress: { completedRuns: 14, totalRuns: 90 },
        variants: [],
        findings: [],
        sensitivity: [],
      }),
    });
    const text = visibleText(html);
    expect(text).toContain('This comparison was cancelled');
    expect(text).toContain('stopped after 14 of 90 runs');
    expect(text).toContain('Nothing is shown from a partial comparison');
    expect(text).toContain('Run it again with the same settings');
    expect(text).toContain('Run another comparison');
  });

  it('says that it was interrupted, that it can be reproduced from its seeds, and offers to run it again', () => {
    const html = view({
      current: analysisFixture({
        status: 'interrupted',
        completedAt: null,
        variants: [],
        findings: [],
        sensitivity: [],
        error: {
          code: 'INTERRUPTED',
          message:
            'The server stopped before this comparison finished. It can be reproduced exactly from its seeds: run it again with the same settings.',
        },
      }),
    });
    const text = visibleText(html);
    expect(text).toContain('This comparison was interrupted');
    expect(text).toContain('reproduced exactly from its seeds');
    expect(text).toContain('Run it again with the same settings');
  });

  it('says that it failed, and why, with the means to run it again', () => {
    const html = view({
      current: analysisFixture({
        status: 'failed',
        variants: [],
        findings: [],
        sensitivity: [],
        error: {
          code: 'ANALYSIS_FAILED',
          message: 'The comparison could not be completed. Run it again with the same settings.',
        },
      }),
    });
    const text = visibleText(html);
    expect(text).toContain('This comparison failed');
    expect(text).toContain('The comparison could not be completed');
    expect(text).toContain('Run it again with the same settings');
    expect(html).toContain('role="alert"');
  });
});

describe('the results', () => {
  const html = view({ current: finished(), summaries: [summary()] });
  const text = visibleText(html);

  it('shows the distribution of final responses for each scenario, as bars with words and as a table', () => {
    expect(text).toContain(
      'Final responses of the simulated members, averaged over the seeded runs',
    );
    expect(text).toContain('No change');
    expect(text).toContain('Proposed change');
    expect(html).toMatch(
      /class="analysis-bar"[^>]*role="img"[^>]*aria-label="No change, averaged over 10 seeded runs: Go along/u,
    );
    expect(html).toContain('analysis-seg-switch');
    expect(text).toContain('Looking for an alternative or resisting:');
    expect(text).toContain('the middle 80% of runs ranged from');
    expect(text).toContain('View the distribution as a table');
    expect(html).toContain('<caption>Mean share of the simulated members in each final response');
  });

  it('shows the spread across rounds as a band chart with a description and a table', () => {
    expect(html).toMatch(
      /<svg[^>]*role="img"[^>]*aria-labelledby="[^"]+-caption [^"]+-description"/u,
    );
    expect(text).toContain(
      'How the overall simulated stance spreads across the seeded runs, round by round',
    );
    expect(text).toContain('shaded band runs from their 10th to their 90th percentile');
    expect(text).toContain('View the trajectory as a table');
    expect(html).toContain('<th scope="col">10th percentile</th>');
    expect(html).toContain('fill-opacity="0.16"');
  });

  it('lists each finding with how many seeded runs it held in, its interval, a class and what the class means', () => {
    expect(text).toContain('holds in 10 of 10 seeded runs (95% interval 72–100%)');
    expect(text).toContain('It holds in 6 of 10 seeded runs (95% interval 31–83%)');
    expect(text).toContain('Mostly repeatable');
    expect(text).toContain('Unstable');
    expect(text).toContain('does not settle this');
    expect(text).toContain('not the chance of anything happening in the world');
    expect(text).toContain('What this means and how it was tested');
  });

  it('shows sensitivity as bars with the shift, the noise, the class and where each assumption came from', () => {
    expect(text).toContain('Which assumptions the result is sensitive to');
    expect(text).toContain('Subscribers: cost of switching, 0.2 higher');
    expect(text).toContain('-12 points of the simulated share');
    expect(text).toContain('System assumption: no evidence supplied');
    expect(text).toContain('Backed by supplied evidence');
    expect(text).toContain('Set by the scenario');
    expect(text).toContain('Sensitive');
    expect(text).toContain('Robust');
    expect(html).toContain('analysis-sens-warn');
    expect(html.match(/analysis-sens-warn/gu)).toHaveLength(1);
    expect(text).toContain('View the sensitivity as a table');
  });

  it('points out when part of the result rests on an assumption that nothing supplied backs', () => {
    expect(text).toContain('Part of this result rests on assumptions with no evidence behind them');
    expect(text).toContain(
      'One assumption that the result is sensitive to has no supplied evidence: Subscribers: cost of switching',
    );
    expect(text).toContain('Treat conclusions that depend on them as hypotheses');
  });

  it('reads one run as a chain of "because, then", from the representative run', () => {
    expect(text).toContain('Second-order effects in one typical run');
    expect(text).toContain('seed 104');
    expect(text).toContain(
      'Because the “adverse-share” signal, then in round 3, a simulated “counter-move” event by Rival provider',
    );
    expect(text).toContain(
      'Because the counter-move in round 3, then in round 4, a simulated “switching-pressure” event by Subscribers',
    );
  });

  it('says how far to rely on it: the fidelity, what was not measured, the cost and the cross-check', () => {
    expect(text).toContain('How far to rely on this');
    expect(text).toContain('Rules: outcomes follow from the declared assumptions');
    expect(text).toContain('No model was used to decide any actor’s behaviour.');
    expect(text).toContain(
      'Cost: 20 simulated runs of 1,300 simulated members in 40 ms; 0 model calls.',
    );
    expect(text).toContain('Deep-dive run outside the range');
    expect(text).toContain('plausibility check, not a validation');
  });

  it('says where each seeded run came from, and what the intensities are', () => {
    expect(text).toContain(
      '2 scenarios × 10 seeded runs, seeds 100 to 109, the same for every scenario',
    );
    expect(text).toContain('Origin: simulation aggregation of rules-engine runs');
    expect(text).toContain('system assumption');
  });

  it('offers a saved comparison to choose from only when there is more than one, and a way to run another', () => {
    expect(text).not.toContain('Saved comparisons');
    const several = visibleText(
      view({
        current: finished(),
        summaries: [
          summary(),
          summary({ id: 'analysis-0', createdAt: '2026-01-14T09:00:00.000Z' }),
        ],
      }),
    );
    expect(several).toContain('Saved comparisons');
    expect(text).toContain('Run another comparison');
  });

  it('says plainly when sensitivity was turned off, and when there was nothing to move', () => {
    const off = visibleText(
      view({
        current: finished({
          sensitivity: [],
          config: { ...analysisFixture().config, sensitivity: false },
        }),
      }),
    );
    expect(off).toContain('Sensitivity was turned off for this comparison');
    const none = visibleText(view({ current: finished({ sensitivity: [] }) }));
    expect(none).toContain('Sensitivity was asked for but there was nothing to move');
  });

  it('says that no event followed, rather than showing an empty chain', () => {
    const quiet = finished();
    quiet.representativeRun = { ...quiet.representativeRun!, events: [] };
    expect(visibleText(view({ current: quiet }))).toContain(
      'No simulated follow-on events occurred in this run.',
    );
  });
});

describe('the answer first', () => {
  const crowded = finished({ findings: crowdedFindings(), sensitivity: crowdedSensitivity() });
  const html = view({ current: crowded, summaries: [summary()] });
  const text = visibleText(html);

  it('says in three lines what the comparison says, above the spread and the findings', () => {
    const own = view({ current: finished(), summaries: [summary()] });
    expect(visibleText(own)).toContain('What this comparison says');
    const list = own.match(/<ul class="analysis-says">((?:(?!<\/ul>)[^])*)<\/ul>/u)?.[1] ?? '';
    expect(list.match(/<li>/gu)).toHaveLength(3);
    expect(visibleText(list)).toBe(
      'Compared No change and Proposed change: 10 seeded runs of each, on the same seeds. ' +
        'Under the proposed change, simulated members ended less favourable than under no change in 10 of 10 runs. ' +
        'Mostly repeatable: it holds in 10 of 10 seeded runs (95% interval 72–100%).',
    );
    const at = own.indexOf('What this comparison says');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(own.indexOf('The spread of outcomes'));
    expect(at).toBeLessThan(own.indexOf('What held across the seeded runs'));
  });

  it('shows the first eight findings, the steadiest first, and the other six behind one disclosure', () => {
    expect(text).toContain('Show all 14 findings');
    const { inside, outside } = disclosed(html, /<summary>Show all 14 findings/u);
    expect(outside.match(/class="analysis-finding"/gu)).toHaveLength(8);
    expect(inside.match(/class="analysis-finding"/gu)).toHaveLength(6);
    const groups = (part: string) =>
      [...part.matchAll(/members of (\w+) ended up waiting/gu)].map((match) => match[1]);
    expect(groups(outside)).toEqual([
      'India',
      'Juliet',
      'Kilo',
      'Lima',
      'Mike',
      'November',
      'Foxtrot',
      'Golf',
    ]);
    expect(groups(inside)).toEqual(['Hotel', 'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    expect(visibleText(inside)).toContain('The other 6, in the same order.');
  });

  it('gives each finding its statement, its class and how many runs it held in, and keeps the rest in the same form', () => {
    const { inside, outside } = disclosed(html, /<summary>Show all 14 findings/u);
    for (const part of [outside, inside]) {
      const items = part.match(/<li class="analysis-finding">(?:(?!<\/li>)[^])*<\/li>/gu) ?? [];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item).toMatch(/class="analysis-finding-statement"/u);
        expect(item).toMatch(/It holds in \d+ of 10 seeded runs \(95% interval \d+–\d+%\)\./u);
        expect(item).toMatch(/Repeatable|Mostly repeatable|Unstable|Rare/u);
        expect(item).toContain('What this means and how it was tested');
      }
    }
  });

  it('shows the first six assumptions, and the other three behind one disclosure on the same scale', () => {
    expect(text).toContain('Show all 9 assumptions');
    const { inside, outside } = disclosed(html, /<summary>Show all 9 assumptions/u);
    expect(outside.match(/class="analysis-sens-row/gu)).toHaveLength(6);
    expect(inside.match(/class="analysis-sens-row/gu)).toHaveLength(3);
    for (const label of ['Assumption number 7', 'Assumption number 8', 'Assumption number 9']) {
      expect(inside).toContain(label);
      expect(outside.replace(/<table[^]*<\/table>/u, '')).not.toContain(label);
    }
  });

  it('keeps the table of every assumption beside the chart, and every chart’s table', () => {
    const start = html.indexOf('<caption>Shift of the headline');
    const table = html.slice(start, html.indexOf('</table>', start));
    expect(table.match(/<th scope="row">Assumption number \d/gu)).toHaveLength(9);
    expect(html.match(/<details class="analysis-table-toggle"/gu)).toHaveLength(3);
    expect(html.match(/<table/gu)).toHaveLength(3);
  });

  it('adds no disclosure when everything fits, and one as soon as something does not', () => {
    expect(visibleText(view({ current: finished() }))).not.toContain('Show all');
    const exact = visibleText(
      view({
        current: finished({
          findings: crowdedFindings().slice(0, 8),
          sensitivity: crowdedSensitivity().slice(0, 6),
        }),
      }),
    );
    expect(exact).not.toContain('Show all');
    const over = visibleText(
      view({
        current: finished({
          findings: crowdedFindings().slice(0, 9),
          sensitivity: crowdedSensitivity().slice(0, 7),
        }),
      }),
    );
    expect(over).toContain('Show all 9 findings');
    expect(over).toContain('Show all 7 assumptions');
  });
});

describe('a comparison whose change could not move anyone', () => {
  const flat = withoutDirection(finished());
  const html = view({ current: flat, summaries: [summary()] });
  const text = visibleText(html);

  it('puts the notice at the very top of the results, once', () => {
    const results = html.slice(html.indexOf('<div class="analysis-results">'));
    expect(
      visibleText(results).startsWith(
        `This comparison cannot say anything about the change ${NO_DIRECTION_NOTICE}`,
      ),
    ).toBe(true);
    expect(text.split(NO_DIRECTION_NOTICE)).toHaveLength(2);
    expect(html.slice(html.indexOf('<div class="analysis-results">'))).toMatch(
      /^<div class="analysis-results"><div class="notice notice-warning" role="status">/u,
    );
  });

  it('does not let a sensitivity row read as robust when there was nothing to move', () => {
    expect(text).toContain('No effect to test');
    expect(text).not.toContain('Robust');
    expect(text).toContain('That is not evidence that the result is robust');
    expect(html).toMatch(/aria-label="[^"]*Intensity of Proposed change[^"]*No effect to test\./u);
    const start = html.indexOf('<caption>Shift of the headline');
    const table = html.slice(start, html.indexOf('</table>', start));
    expect(table).toContain('<td>No effect to test</td>');
    expect(table).not.toContain('<td>Robust</td>');
    // What did move is still reported as it is.
    expect(table).toContain('<td>Sensitive</td>');
  });

  it('does not state a direction in the summary, only that nothing can move', () => {
    const own = html.match(/<ul class="analysis-says">((?:(?!<\/ul>)[^])*)<\/ul>/u)?.[1] ?? '';
    expect(visibleText(own)).toContain('Nothing in the change can move anyone in this cast');
    expect(visibleText(own)).not.toContain('holds in');
  });

  it('says none of it about a comparison whose change could move someone', () => {
    const normal = visibleText(view({ current: finished() }));
    expect(normal).not.toContain('This comparison cannot say anything about the change');
    expect(normal).not.toContain('No effect to test');
    expect(normal).toContain('Robust');
  });

  it('calls no API while it renders', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    view({ current: flat });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('what every state says, and never says', () => {
  const states: [string, string][] = [
    ['reading', view({ readiness: null, loading: true })],
    ['no actors', view({ readiness: readiness({ actors: null }) })],
    ['ready', view()],
    [
      'ready, with a warning',
      view({ readiness: readiness({ warnings: [NO_DIRECTION_NOTICE] }) }, () => undefined),
    ],
    [
      'running',
      view({
        current: analysisFixture({
          status: 'running',
          completedAt: null,
          variants: [],
          findings: [],
          sensitivity: [],
        }),
      }),
    ],
    ['results', view({ current: finished(), summaries: [summary()] })],
    [
      'results of many findings',
      view({
        current: finished({ findings: crowdedFindings(), sensitivity: crowdedSensitivity() }),
      }),
    ],
    ['results where nothing can move', view({ current: withoutDirection(finished()) })],
    [
      'interrupted',
      view({
        current: analysisFixture({
          status: 'interrupted',
          variants: [],
          findings: [],
          sensitivity: [],
          error: { code: 'INTERRUPTED', message: 'Stopped.' },
        }),
      }),
    ],
  ];

  it.each(states)(
    'says once that Swarm explores scenarios and does not predict, in the %s state',
    (_name, html) => {
      const text = visibleText(html);
      expect(text.split(STATEMENT)).toHaveLength(2);
    },
  );

  it.each(states)(
    'never promises an outcome or describes real people, in the %s state',
    (_name, html) => {
      const text = visibleText(html);
      expect(text).not.toMatch(/\bwill\b/iu);
      expect(text).not.toMatch(
        /\b(?:customers?|users?|people|employees?|citizens?|consumers?)\b/iu,
      );
      expect(text).not.toMatch(/\bconfidence\b/iu);
      for (const match of text.matchAll(/\d+%\s+of\s+(?!the simulated|simulated|runs)/gu)) {
        throw new Error(`A percentage that is not of simulated members or runs: ${match[0]}`);
      }
    },
  );

  it('puts a chart’s table beside every chart, and names each chart for a screen reader', () => {
    const html = view({ current: finished(), summaries: [summary()] });
    expect(html.match(/<details class="analysis-table-toggle"/gu)).toHaveLength(3);
    expect(html.match(/<table/gu)).toHaveLength(3);
    for (const table of html.matchAll(/<table[^>]*>(?:(?!<\/table>)[^])*<\/table>/gu)) {
      expect(table[0]).toContain('<caption>');
      expect(table[0]).toContain('scope="col"');
    }
    expect((html.match(/role="img"/gu) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html.match(/<h2/gu)).toHaveLength(1);
    expect((html.match(/<h3/gu) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
