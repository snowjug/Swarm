import type { Analysis, Finding, Variant } from '../../../../shared/analysis';
import { NO_DIRECTION_NOTICE } from '../../../../shared/signal';
import {
  SHOWN_FINDINGS,
  STABILITY,
  cannotMoveAnyone,
  chainOf,
  comparisonSummary,
  durationText,
  holdsText,
  rankFindings,
  unsupportedSensitive,
  variantDistributions,
} from '../../lib/analysis';
import { dateTime } from '../../lib/format';
import { ToneChip } from '../console/LedgerParts';
import { Notice } from '../ui';
import { BandChart, DistributionBars, SensitivityBars } from './AnalysisCharts';

/** One finding: what was counted, how often it held across the seeded runs, and what that class does and does not mean. */
function FindingItem({ finding }: { finding: Finding }) {
  const stability = STABILITY[finding.classification];
  return (
    <li className="analysis-finding">
      <p className="analysis-finding-statement">{finding.statement}</p>
      <p className="analysis-finding-count">
        <ToneChip tone={stability.tone} label={stability.label} />
        <span>It {holdsText(finding)}.</span>
      </p>
      <details className="analysis-predicate">
        <summary>What this means and how it was tested</summary>
        <p>{stability.explain(finding.of)}</p>
        <p>{finding.predicate}</p>
      </details>
    </li>
  );
}

/**
 * What was found: the findings to read first, each with how often it held across the seeded runs, and
 * the rest one disclosure away. Each says what it counted and what its class does and does not mean.
 */
export function FindingsList({
  findings,
  variants,
}: {
  findings: Finding[];
  variants: Pick<Variant, 'id' | 'kind'>[];
}) {
  if (findings.length === 0) {
    return <p className="field-help">No findings could be counted from these runs.</p>;
  }
  const ranked = rankFindings(findings, variants);
  const shown = ranked.slice(0, SHOWN_FINDINGS);
  const rest = ranked.slice(SHOWN_FINDINGS);
  return (
    <>
      <p className="field-help">
        Each finding is a statement that is either true of a seeded run or not. “Repeatable”
        describes how steady it is under the simulation’s own randomness. It is not the chance of
        anything happening in the world. The repeatable findings, and any rare outcome that a change
        might set off, come first; then the mostly repeatable ones, then the unstable ones.
      </p>
      <ol className="analysis-findings">
        {shown.map((finding) => (
          <FindingItem key={finding.id} finding={finding} />
        ))}
      </ol>
      {rest.length > 0 && (
        <details className="analysis-more">
          <summary>Show all {findings.length} findings</summary>
          <p className="field-help">The other {rest.length}, in the same order.</p>
          <ol className="analysis-findings" start={shown.length + 1}>
            {rest.map((finding) => (
              <FindingItem key={finding.id} finding={finding} />
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

/** Three lines first, made only of what the comparison already states, so that the answer is not buried under its evidence. */
export function ComparisonSummary({ analysis }: { analysis: Analysis }) {
  return (
    <section className="analysis-section" aria-labelledby="analysis-summary-title">
      <h3 id="analysis-summary-title">What this comparison says</h3>
      <ul className="analysis-says">
        {comparisonSummary(analysis).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
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

/** Everything a finished comparison shows, in the order a decision is made: the answer, the spread, what holds, what it rests on. */
export function AnalysisResults({ analysis }: { analysis: Analysis }) {
  const distributions = variantDistributions(analysis);
  const unsupported = unsupportedSensitive(analysis.sensitivity);
  const seeds = analysis.config.baseSeed;
  // Where nothing can move anyone, every difference below is noise, and nothing it says is about the change.
  const noEffect = cannotMoveAnyone(analysis);
  return (
    <div className="analysis-results">
      {noEffect && (
        <Notice tone="warning" title="This comparison cannot say anything about the change">
          {NO_DIRECTION_NOTICE}
        </Notice>
      )}
      <ComparisonSummary analysis={analysis} />
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
        <FindingsList findings={analysis.findings} variants={analysis.config.variants} />
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
          <SensitivityBars rows={analysis.sensitivity} noEffect={noEffect} />
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
