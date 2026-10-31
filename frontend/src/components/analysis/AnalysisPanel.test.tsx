import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runOutcomeSchema,
  type Analysis,
  type SensitivityRow,
  type Variant,
} from '../../../../shared/analysis';
import type { AnalysisReadiness, AnalysisSummary } from '../../../../shared/analysis-plan';
import { FIXTURE_VARIANTS, analysisFixture } from '../../../../shared/lab-fixtures';
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
    expect(html).toContain('aria-live="polite"');
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
          code: 'SIMULATOR_NOT_CONNECTED',
          message: 'The simulation engine is not connected in this build.',
        },
      }),
    });
    const text = visibleText(html);
    expect(text).toContain('This comparison failed');
    expect(text).toContain('The simulation engine is not connected');
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
    expect(text).toContain('How this was tested');
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

describe('what every state says, and never says', () => {
  const states: [string, string][] = [
    ['reading', view({ readiness: null, loading: true })],
    ['no actors', view({ readiness: readiness({ actors: null }) })],
    ['ready', view()],
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
