import {
  BRIEF_READING_NOTES,
  type BriefSignal,
  type BriefVisuals,
} from '../../../../../shared/brief';
import { Chip } from '../../../design/ui';
import { STABILITY_LABELS } from '../../../lib/brief';
import { approx, perHundred, signedDecimals, signedPerHundred } from '../model/format';
import { useDoc } from '../ui/context';
import { PairedStrip, RunDots } from './PairedStrip';
import { FigureHead, TableAlt } from './parts';
import './outcomes.css';

/**
 * Each change against the baseline, on the same seeds. Every seeded run is a dot at the difference the change
 * made on that run's seed, so that "higher in 30 of 30" can be seen and not only read.
 */
export function ComparisonVisual({
  visuals,
  signal,
}: {
  visuals: BriefVisuals;
  signal: BriefSignal;
}) {
  const { facts, factsLoading } = useDoc();
  const rows = visuals.scenarioComparison;
  if (rows.length === 0) {
    return (
      <p className="sw-decide-note-line">
        There is no alternative to compare with a baseline in this analysis.
      </p>
    );
  }
  const baselineLabel =
    visuals.outcomeDistribution.find((row) => row.kind === 'baseline')?.label ?? 'the baseline';
  const everyDelta = rows.flatMap(
    (row) => facts?.paired[row.variantId]?.runs.map((run) => run.delta) ?? [],
  );
  const domain: readonly [number, number] | undefined =
    everyDelta.length > 0 ? [Math.min(...everyDelta), Math.max(...everyDelta)] : undefined;
  return (
    <figure className="sw-decide-fig">
      <FigureHead
        title={`Each change against ${baselineLabel}, on the same seeds`}
        note="Each dot is one seeded run: how much the change moved the share of simulated members looking for an alternative or resisting, on that run’s seed. Right of the line, the change raised it."
      />
      {signal !== 'clear' && <p className="sw-decide-reading">{BRIEF_READING_NOTES[signal]}</p>}
      <div className="sw-decide-cmp">
        {rows.map((row, index) => {
          const paired = facts?.paired[row.variantId];
          const unread = signal === 'no-direction' || (signal === 'no-difference' && index === 0);
          return (
            <section
              className="sw-decide-cmp__row"
              key={row.variantId}
              data-unread={unread || undefined}
              aria-label={row.label}
            >
              <header className="sw-decide-cmp__head">
                <h3>{row.label}</h3>
                {row.classification && row.holdsIn !== null && row.of !== null ? (
                  <Chip size="sm" tone={row.classification === 'repeatable' ? 'accent' : 'neutral'}>
                    {STABILITY_LABELS[row.classification]} · held in{' '}
                    <span className="num">{row.holdsIn}</span> of{' '}
                    <span className="num">{row.of}</span> runs
                  </Chip>
                ) : null}
              </header>
              {row.shareDelta !== null && row.pairedRuns > 0 ? (
                paired ? (
                  <PairedStrip
                    runs={paired.runs}
                    mean={paired.mean}
                    error={paired.error}
                    higher={paired.higher}
                    pairs={paired.runs.length}
                    label={row.label}
                    domain={domain}
                  />
                ) : factsLoading ? (
                  <div className="sw-decide-cmp__wait sw-shimmer" aria-hidden="true" />
                ) : (
                  <RunDots higher={row.worseInRuns} pairs={row.pairedRuns} label={row.label} />
                )
              ) : (
                <p className="sw-decide-note-line">
                  The runs could not be paired with the baseline, so no paired difference is stated.
                </p>
              )}
              <dl className="sw-decide-cmp__facts">
                <div>
                  <dt>Share, in 100</dt>
                  <dd className="num">
                    <b>{perHundred(row.adverseShare)}</b>
                    {row.baselineAdverseShare !== null ? (
                      <span> against {perHundred(row.baselineAdverseShare)}</span>
                    ) : null}
                  </dd>
                </div>
                {row.shareDelta !== null && (
                  <div>
                    <dt>Paired difference</dt>
                    <dd className="num">
                      <b>{signedPerHundred(row.shareDelta)}</b>
                      {row.shareDeltaError !== null ? (
                        <span> ± {perHundred(row.shareDeltaError)}</span>
                      ) : null}
                    </dd>
                  </div>
                )}
                {row.pairedRuns > 0 && (
                  <div>
                    <dt>Higher under the change</dt>
                    <dd className="num">
                      <b>{row.worseInRuns}</b>
                      <span> of {row.pairedRuns} paired runs</span>
                    </dd>
                  </div>
                )}
                {row.stanceDelta !== null && (
                  <div>
                    <dt>Mean stance</dt>
                    <dd className="num">
                      <b>{signedDecimals(row.stanceDelta)}</b>
                      <span> on −1 to 1</span>
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          );
        })}
      </div>
      <TableAlt
        caption="Each change against the baseline"
        headers={[
          'Change',
          'Looking for an alternative or resisting, in 100',
          'Baseline, in 100',
          'Paired difference, in 100',
          'Paired runs',
          'Higher in',
          'Mean stance change',
          'Finding',
          'Mean adverse simulated members (depends on the sampling)',
        ]}
        rows={rows.map((row) => [
          row.label,
          perHundred(row.adverseShare),
          row.baselineAdverseShare === null ? 'no baseline' : perHundred(row.baselineAdverseShare),
          row.shareDelta === null ? 'not paired' : signedPerHundred(row.shareDelta),
          String(row.pairedRuns),
          `${row.worseInRuns} of ${row.pairedRuns} runs`,
          row.stanceDelta === null ? 'not paired' : signedDecimals(row.stanceDelta),
          row.findingId && row.classification
            ? `${row.findingId}: ${STABILITY_LABELS[row.classification]}`
            : 'none recorded',
          row.adverseMean === null
            ? 'not stored'
            : `${approx(row.adverseMean)} against ${row.baselineAdverseMean === null ? 'not stored' : approx(row.baselineAdverseMean)}`,
        ])}
      />
    </figure>
  );
}
