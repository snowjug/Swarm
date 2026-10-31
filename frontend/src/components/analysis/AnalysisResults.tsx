import type { Analysis, Finding } from '../../../../shared/analysis';
import {
  STABILITY,
  chainOf,
  durationText,
  holdsText,
  unsupportedSensitive,
  variantDistributions,
} from '../../lib/analysis';
import { dateTime } from '../../lib/format';
import { ToneChip } from '../console/LedgerParts';
import { Notice } from '../ui';
import { BandChart, DistributionBars, SensitivityBars } from './AnalysisCharts';

/** What was found, each with how often it held across the seeded runs and what that does and does not mean. */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="field-help">No findings could be counted from these runs.</p>;
  }
  return (
    <>
      <p className="field-help">
        Each finding is a statement that is either true of a seeded run or not. “Repeatable”
        describes how steady it is under the simulation’s own randomness. It is not the chance of
        anything happening in the world.
      </p>
      <ol className="analysis-findings">
        {findings.map((finding) => {
          const stability = STABILITY[finding.classification];
          return (
            <li key={finding.id} className="analysis-finding">
              <p className="analysis-finding-statement">{finding.statement}</p>
              <p className="analysis-finding-count">
                <ToneChip tone={stability.tone} label={stability.label} />
                <span>It {holdsText(finding)}.</span>
              </p>
              <p className="field-help">{stability.explain(finding.of)}</p>
              <details className="analysis-predicate">
                <summary>How this was tested</summary>
                <p>{finding.predicate}</p>
              </details>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** One run read in detail: what happened, because of what, and then what. */
export function ChainView({ analysis }: { analysis: Analysis }) {
  const run = analysis.representativeRun;
  const proposed = analysis.config.variants.find((variant) => variant.kind === 'alternative');
  if (!run) return null;
  const steps = chainOf(run, analysis.actors);
  return (
    <section className="analysis-section" aria-labelledby="analysis-chain-title">
      <h3 id="analysis-chain-title">Second-order effects in one typical run</h3>
      <p className="field-help">
        This is the seeded run (seed {run.seed}) whose overall stance was nearest the median under{' '}
        {proposed?.label ?? 'the proposed change'}, read event by event. The findings above say how
        often each kind of event occurred across all the runs.
      </p>
      {steps.length === 0 ? (
        <p className="field-help">No simulated follow-on events occurred in this run.</p>
      ) : (
        <ol className="analysis-chain">
          {steps.slice(0, 12).map((step) => (
            <li key={step.id}>
              <p>
                {step.because.length > 0 ? (
                  <>
                    <strong>Because</strong> {step.because.map((cause) => cause.text).join(' and ')}
                    , <strong>then</strong>{' '}
                  </>
                ) : null}
                in round {step.round}, a simulated “{step.kind}” event
                {step.actor ? ` by ${step.actor}` : ''}: {step.description}
              </p>
            </li>
          ))}
          {steps.length > 12 && (
            <li className="field-help">{steps.length - 12} more events are not shown.</li>
          )}
        </ol>
      )}
    </section>
  );
}

/** How reliable the whole exercise is: what drove the behaviour, what was not measured, what it cost. */
export function Reliability({ analysis }: { analysis: Analysis }) {
  const { fidelity, cost, crossCheck } = analysis;
  return (
    <section className="analysis-section" aria-labelledby="analysis-reliability-title">
      <h3 id="analysis-reliability-title">How far to rely on this</h3>
      <Notice tone="info" title={fidelity.label}>
        <ul className="analysis-caveats">
          {fidelity.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </Notice>
      <p className="analysis-cost">
        Cost: {cost.simulatedRuns.toLocaleString('en-GB')} simulated runs of{' '}
        {cost.simulatedMembers.toLocaleString('en-GB')} simulated members in{' '}
        {durationText(cost.wallMs)}; {cost.modelCalls} model calls.
      </p>
      {crossCheck && (
        <p className="analysis-crosscheck">
          <ToneChip
            tone={crossCheck.withinEnsembleRange === false ? 'caution' : 'info'}
            label={
              crossCheck.withinEnsembleRange === null
                ? 'Deep-dive run: no comparison'
                : crossCheck.withinEnsembleRange
                  ? 'Deep-dive run inside the range'
                  : 'Deep-dive run outside the range'
            }
          />{' '}
          {crossCheck.note}
        </p>
      )}
    </section>
  );
}

/** Everything a finished comparison shows, in the order a decision is made: the spread, what holds, what it rests on. */
export function AnalysisResults({ analysis }: { analysis: Analysis }) {
  const distributions = variantDistributions(analysis);
  const unsupported = unsupportedSensitive(analysis.sensitivity);
  const seeds = analysis.config.baseSeed;
  return (
    <div className="analysis-results">
      <p className="analysis-meta">
        {analysis.completedAt ? `Finished ${dateTime(analysis.completedAt)}. ` : ''}
        {analysis.config.variants.length} scenarios × {analysis.config.runsPerVariant} seeded runs,
        seeds {seeds} to {seeds + analysis.config.runsPerVariant - 1}, the same for every scenario.
        Origin: simulation aggregation of rules-engine runs; how strongly each change lands is a
        system assumption unless it says it was set by you.
      </p>
      <section className="analysis-section" aria-labelledby="analysis-spread-title">
        <h3 id="analysis-spread-title">The spread of outcomes</h3>
        {distributions.length > 0 && <DistributionBars distributions={distributions} />}
        <BandChart analysis={analysis} />
      </section>
      <section className="analysis-section" aria-labelledby="analysis-findings-title">
        <h3 id="analysis-findings-title">What held across the seeded runs</h3>
        <FindingsList findings={analysis.findings} />
      </section>
      {analysis.sensitivity.length > 0 ? (
        <section className="analysis-section" aria-labelledby="analysis-sensitivity-title">
          <h3 id="analysis-sensitivity-title">Which assumptions the result is sensitive to</h3>
          {unsupported.length > 0 && (
            <Notice
              tone="warning"
              title="Part of this result rests on assumptions with no evidence behind them"
            >
              {unsupported.length === 1
                ? 'One assumption that the result is sensitive to has no supplied evidence: '
                : `${unsupported.length} assumptions that the result is sensitive to have no supplied evidence: `}
              {unsupported.map((row) => row.label).join('; ')}. Treat conclusions that depend on
              them as hypotheses until evidence is supplied or the value is confirmed.
            </Notice>
          )}
          <SensitivityBars rows={analysis.sensitivity} />
        </section>
      ) : analysis.config.sensitivity ? (
        <section className="analysis-section">
          <h3>Which assumptions the result is sensitive to</h3>
          <p className="field-help">Sensitivity was asked for but there was nothing to move.</p>
        </section>
      ) : (
        <section className="analysis-section">
          <h3>Which assumptions the result is sensitive to</h3>
          <p className="field-help">
            Sensitivity was turned off for this comparison, so how far the result depends on its
            assumptions has not been tested.
          </p>
        </section>
      )}
      <ChainView analysis={analysis} />
      <Reliability analysis={analysis} />
    </div>
  );
}
