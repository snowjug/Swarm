import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, CircleHelp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { RESPONSE_CATEGORIES, RESPONSE_LABELS } from '../../../../shared/analysis';
import {
  BRIEF_READING_NOTES,
  STATEMENT_ORIGIN_LABELS,
  type BriefComparisonRow,
  type BriefSignal,
  type BriefVisuals,
  type VisualKind,
} from '../../../../shared/brief';
import {
  CLASSIFICATION_LABELS,
  DIRECTION_LABELS,
  STABILITY_LABELS,
  approx,
  signedNumber,
} from '../../lib/brief';
import { OriginBadge } from './BriefStatements';

const DIRECTION_ICONS: Record<keyof typeof DIRECTION_LABELS, LucideIcon> = {
  harmed: ArrowDownRight,
  benefited: ArrowUpRight,
  mixed: ArrowLeftRight,
  unclear: CircleHelp,
};

/** The same data as a chart, as a table: for a reader who cannot see the chart, and for print. */
function TableAlternative({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <details className="brief-table-alt">
      <summary>Show this as a table</summary>
      <div className="brief-scroll" role="region" aria-label={caption} tabIndex={0}>
        <table className="brief-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {headers.map((header) => (
                <th scope="col" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, column) =>
                  column === 0 ? (
                    <th scope="row" key={column}>
                      {value}
                    </th>
                  ) : (
                    <td key={column}>{value}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function StakeholderMap({ visuals }: { visuals: BriefVisuals }) {
  const groups = visuals.stakeholderMap;
  return (
    <figure className="brief-figure">
      <figcaption>Stakeholder map by category</figcaption>
      <div className="brief-map">
        {groups.map((group) => (
          <section className="brief-map-group" key={group.category} aria-label={group.label}>
            <h4>{group.label}</h4>
            <ul>
              {group.stakeholders.map((entry) => {
                const Icon = DIRECTION_ICONS[entry.direction];
                return (
                  <li key={entry.id}>
                    <strong>{entry.name}</strong>
                    <span className="brief-map-meta">
                      <Icon size={12} aria-hidden="true" /> {DIRECTION_LABELS[entry.direction]}
                    </span>
                    <span className="brief-map-meta">
                      {entry.priority} stakeholder; {entry.supporting} cited{' '}
                      {entry.supporting === 1 ? 'passage supports' : 'passages support'} it
                      {entry.contradicting > 0 ? `, ${entry.contradicting} contradict it` : ''};
                      uncertainty {entry.uncertainty}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <TableAlternative
        caption="Stakeholder map, as a table"
        headers={[
          'Stakeholder',
          'Category',
          'Priority',
          'Expected effect',
          'Cited support',
          'Uncertainty',
        ]}
        rows={groups.flatMap((group) =>
          group.stakeholders.map((entry) => [
            entry.name,
            group.label,
            entry.priority,
            DIRECTION_LABELS[entry.direction],
            `${entry.supporting} supporting, ${entry.contradicting} contradicting`,
            entry.uncertainty,
          ]),
        )}
      />
    </figure>
  );
}

/** A share of simulated members as members in every 100: a simulated share, never a rate in a population. */
const perHundred = (share: number): string => approx(share * 100);

/** Decimal places for a shift or an error: a value under 0.01 is not shown as 0.00. */
const places = (value: number): number => (value !== 0 && Math.abs(value) < 0.01 ? 3 : 2);

const RESOLUTION =
  'How many simulated members there are depends on how many were sampled for each group: a numerical resolution of the simulation, not a population.';

/** A range over the seeded runs, when the runs were kept. */
const spread = (mean: number, min: number | null, max: number | null): string =>
  min === null || max === null
    ? perHundred(mean)
    : `${perHundred(mean)} (${perHundred(min)} to ${perHundred(max)})`;

function OutcomeDistribution({ visuals }: { visuals: BriefVisuals }) {
  const rows = visuals.outcomeDistribution;
  const counted = rows.every((row) => row.responses !== null && row.adverse !== null);
  return (
    <figure className="brief-figure">
      <figcaption>Where simulated members ended up, variant by variant</figcaption>
      <p className="field-help">
        The mean share of simulated members in each response over the seeded runs, as members in
        every 100, with every group counting equally. These are shares of simulated members, not
        rates in a real population. {RESOLUTION}
      </p>
      {rows.map((row) => (
        <div className="brief-bar-row" key={row.variantId}>
          <div className="brief-bar-label">
            {row.label}{' '}
            <span className="brief-count">
              ({row.kind}; {row.runs} seeded runs
              {row.members === null ? '' : `; ${row.members} simulated members sampled in each run`}
              )
            </span>
          </div>
          <div
            className="brief-bar"
            role="img"
            aria-label={`${row.label}: ${row.shares
              .map((entry) => `${RESPONSE_LABELS[entry.category]} ${perHundred(entry.mean)}`)
              .join(', ')} (in every 100 simulated members, every group counting equally)`}
          >
            {row.shares.map((entry) => (
              <span
                key={entry.category}
                className={`brief-seg brief-seg-${entry.category}`}
                style={{ flexGrow: entry.mean, flexBasis: 0 }}
                title={`${RESPONSE_LABELS[entry.category]}: ${perHundred(entry.mean)} in 100`}
              />
            ))}
          </div>
        </div>
      ))}
      <ul className="brief-legend">
        {RESPONSE_CATEGORIES.map((category) => (
          <li key={category}>
            <span className={`brief-swatch brief-seg-${category}`} aria-hidden="true" />
            {RESPONSE_LABELS[category]}
          </li>
        ))}
      </ul>
      <TableAlternative
        caption="Mean share of simulated members in each response, in every 100"
        headers={[
          'Variant',
          ...RESPONSE_CATEGORIES.map((category) => RESPONSE_LABELS[category]),
          'Looking for an alternative or resisting (lowest to highest)',
        ]}
        rows={rows.map((row) => [
          row.label,
          ...row.shares.map((entry) => perHundred(entry.mean)),
          spread(row.adverseShare.mean, row.adverseShare.min, row.adverseShare.max),
        ])}
      />
      {counted ? (
        <TableAlternative
          caption="Mean number of simulated members in each response (the count depends on how many members were sampled for each group)"
          headers={[
            'Variant',
            'Simulated members sampled',
            ...RESPONSE_CATEGORIES.map((category) => RESPONSE_LABELS[category]),
            'Looking for an alternative or resisting (lowest to highest)',
          ]}
          rows={rows.map((row) => [
            row.label,
            String(row.members),
            ...(row.responses ?? []).map((entry) => approx(entry.mean)),
            row.adverse
              ? row.perRun && row.adverse.min !== null && row.adverse.max !== null
                ? `${approx(row.adverse.mean)} (${approx(row.adverse.min)} to ${approx(row.adverse.max)})`
                : approx(row.adverse.mean)
              : '',
          ])}
        />
      ) : (
        <p className="field-help">
          Counts of simulated members are not shown: this analysis did not keep the results of each
          group in each run, so only shares are drawn.
        </p>
      )}
    </figure>
  );
}

function ScenarioComparison({ visuals, signal }: { visuals: BriefVisuals; signal: BriefSignal }) {
  const rows = visuals.scenarioComparison;
  if (rows.length === 0) {
    return (
      <p className="field-help">
        There is no alternative to compare with a baseline in this analysis.
      </p>
    );
  }
  const baselineLabel =
    visuals.outcomeDistribution.find((row) => row.kind === 'baseline')?.label ?? 'the baseline';
  const width = (share: number): string => `${Math.min(100, Math.max(0, share * 100))}%`;
  const counted = (row: BriefComparisonRow): string =>
    row.adverseDelta !== null && row.members !== null
      ? ` Counted as sampled members, that is ${approx(Math.abs(row.adverseDelta))} ${row.adverseDelta >= 0 ? 'more' : 'fewer'} of ${row.members} simulated members, a number that depends on how many members were sampled for each group.`
      : '';
  return (
    <figure className="brief-figure">
      <figcaption>Each alternative against the baseline, on the same seeds</figcaption>
      {signal !== 'clear' ? (
        <p className="field-help brief-reading-note">{BRIEF_READING_NOTES[signal]}</p>
      ) : null}
      {rows.map((row) => (
        <div className="brief-compare" key={row.variantId}>
          <h4>{row.label}</h4>
          {row.baselineAdverseShare !== null ? (
            <div className="brief-bar-row">
              <div className="brief-bar-label">{baselineLabel}</div>
              <div
                className="brief-track"
                role="img"
                aria-label={`${baselineLabel}: about ${perHundred(row.baselineAdverseShare)} in 100 simulated members looking for an alternative or resisting`}
              >
                <span
                  className="brief-fill brief-fill-baseline"
                  style={{ width: width(row.baselineAdverseShare) }}
                />
              </div>
            </div>
          ) : null}
          <div className="brief-bar-row">
            <div className="brief-bar-label">{row.label}</div>
            <div
              className="brief-track"
              role="img"
              aria-label={`${row.label}: about ${perHundred(row.adverseShare)} in 100 simulated members looking for an alternative or resisting`}
            >
              <span
                className="brief-fill brief-fill-change"
                style={{ width: width(row.adverseShare) }}
              />
            </div>
          </div>
          <p>
            About {perHundred(row.adverseShare)} in 100 simulated members, every group counting
            equally, ended up looking for an alternative or resisting
            {signal === 'clear' && row.baselineAdverseShare !== null ? (
              <> against about {perHundred(row.baselineAdverseShare)} in 100 under the baseline</>
            ) : null}
            .{' '}
            {signal !== 'clear'
              ? 'The comparison with the baseline is not read as an effect of the change.'
              : row.shareDelta !== null
                ? `On the same seeds, the change ${row.shareDelta >= 0 ? 'raised' : 'lowered'} that share by ${perHundred(Math.abs(row.shareDelta))} in 100${row.shareDeltaError === null ? '' : ` (paired standard error ${perHundred(row.shareDeltaError)})`}, with the share higher under the change in ${row.worseInRuns} of ${row.pairedRuns} paired runs.${counted(row)}`
                : 'The runs could not be paired with the baseline.'}{' '}
            {row.findingId && row.classification
              ? `Finding ${row.findingId} holds in ${row.holdsIn} of ${row.of} seeded runs (${STABILITY_LABELS[row.classification]}).`
              : 'No finding states how often this direction holds.'}
          </p>
        </div>
      ))}
      <TableAlternative
        caption="Each alternative against the baseline"
        headers={[
          'Variant',
          'Looking for an alternative or resisting, in 100',
          'Baseline, in 100',
          'Paired difference, in 100',
          'Paired runs',
          'Share higher in',
          'Mean stance change',
          'Finding',
          'Mean adverse simulated members (a count that depends on the sampling)',
          'Baseline mean adverse simulated members',
        ]}
        rows={rows.map((row) => [
          row.label,
          perHundred(row.adverseShare),
          row.baselineAdverseShare === null ? 'no baseline' : perHundred(row.baselineAdverseShare),
          row.shareDelta === null ? 'not paired' : signedNumber(row.shareDelta * 100, 1),
          String(row.pairedRuns),
          `${row.worseInRuns} of ${row.pairedRuns} runs`,
          row.stanceDelta === null ? 'not paired' : signedNumber(row.stanceDelta),
          row.findingId && row.classification
            ? `${row.findingId}: ${STABILITY_LABELS[row.classification]}`
            : 'none recorded',
          row.adverseMean === null ? 'not stored' : approx(row.adverseMean),
          row.baselineAdverseMean === null ? 'not stored' : approx(row.baselineAdverseMean),
        ])}
      />
    </figure>
  );
}

function SensitivityBars({ visuals }: { visuals: BriefVisuals }) {
  const rows = visuals.sensitivity;
  if (rows.length === 0) {
    return (
      <p className="field-help">
        No assumption was moved in this analysis, so there is no sensitivity chart.
      </p>
    );
  }
  const largest = Math.max(...rows.map((row) => Math.abs(row.shift)), Number.EPSILON);
  return (
    <figure className="brief-figure">
      <figcaption>What moving one assumption did to the simulated outcome</figcaption>
      <p className="field-help">
        Each bar is the change in the outcome measure when one assumption was moved and nothing
        else, on the same seeds. A bar to the left lowers the measure and to the right raises it.
      </p>
      <ul className="brief-sensitivity">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="brief-bar-label">{row.label}</div>
            <div
              className="brief-diverge"
              role="img"
              aria-label={`${row.label}: shift ${signedNumber(row.shift, places(row.shift))} in ${row.metric}`}
            >
              <span className="brief-diverge-mid" />
              <span
                className={`brief-diverge-bar ${row.shift < 0 ? 'brief-diverge-neg' : 'brief-diverge-pos'}`}
                style={{ width: `${(Math.abs(row.shift) / largest) * 50}%` }}
              />
            </div>
            <div className="brief-sensitivity-meta">
              <span>
                {signedNumber(row.shift, places(row.shift))} (standard error{' '}
                {row.standardError.toFixed(places(row.standardError))})
              </span>
              <span className={`brief-class brief-class-${row.classification}`}>
                {CLASSIFICATION_LABELS[row.classification]}
              </span>
              <OriginBadge origin={row.origin} />
              <span>
                {row.evidenced ? 'A cited passage backs it' : 'No cited passage backs it'}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <TableAlternative
        caption="Sensitivity of the simulated outcome to each assumption moved"
        headers={[
          'Assumption moved',
          'Measure',
          'Shift',
          'Standard error',
          'Result',
          'Origin',
          'Evidence',
        ]}
        rows={rows.map((row) => [
          row.label,
          row.metric,
          signedNumber(row.shift, places(row.shift)),
          row.standardError.toFixed(places(row.standardError)),
          CLASSIFICATION_LABELS[row.classification],
          STATEMENT_ORIGIN_LABELS[row.origin],
          row.evidenced ? 'cited' : 'none cited',
        ])}
      />
    </figure>
  );
}

function AssumptionRegister({ visuals }: { visuals: BriefVisuals }) {
  return (
    <div className="brief-scroll" role="region" aria-label="Assumption register" tabIndex={0}>
      <table className="brief-table">
        <caption>Assumption register: what the simulated result rests on</caption>
        <thead>
          <tr>
            <th scope="col">Assumption</th>
            <th scope="col">Origin</th>
            <th scope="col">Sensitive</th>
            <th scope="col">Evidenced</th>
            <th scope="col">Effect of moving it</th>
          </tr>
        </thead>
        <tbody>
          {visuals.assumptionRegister.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.text}</th>
              <td>
                <OriginBadge origin={row.origin} />
              </td>
              <td>{row.sensitive ? 'Yes' : 'No'}</td>
              <td>{row.evidenced ? 'Yes' : 'No'}</td>
              <td>{row.effect ?? 'Not moved'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceMap({ visuals }: { visuals: BriefVisuals }) {
  return (
    <div className="brief-scroll" role="region" aria-label="Evidence map" tabIndex={0}>
      <table className="brief-table">
        <caption>Evidence map: cited passages for each stakeholder</caption>
        <thead>
          <tr>
            <th scope="col">Stakeholder</th>
            <th scope="col">Supporting passages</th>
            <th scope="col">Contradicting passages</th>
            <th scope="col">Documents</th>
            <th scope="col">Gap</th>
          </tr>
        </thead>
        <tbody>
          {visuals.evidenceMap.map((row) => (
            <tr key={row.stakeholderId}>
              <th scope="row">{row.name}</th>
              <td>{row.supporting}</td>
              <td>{row.contradicting}</td>
              <td>{row.documents.join('; ') || 'none'}</td>
              <td>{row.gap ? 'No cited support' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The charts a section names, drawn from the analysis data, each with a table for the reader who needs one. */
export function SectionVisuals({
  kinds,
  visuals,
  signal = 'clear',
}: {
  kinds: readonly VisualKind[];
  visuals: BriefVisuals | null;
  /** Whether the comparison could tell the change from no change; the chart that sets them side by side says so. */
  signal?: BriefSignal;
}) {
  if (kinds.length === 0) return null;
  if (!visuals) {
    return (
      <p className="field-help">
        The charts for this section are not shown, because the analysis they are drawn from is no
        longer stored.
      </p>
    );
  }
  return (
    <>
      {kinds.map((kind) => {
        switch (kind) {
          case 'stakeholder-map':
            return <StakeholderMap key={kind} visuals={visuals} />;
          case 'outcome-distribution':
            return <OutcomeDistribution key={kind} visuals={visuals} />;
          case 'scenario-comparison':
            return <ScenarioComparison key={kind} visuals={visuals} signal={signal} />;
          case 'sensitivity':
            return <SensitivityBars key={kind} visuals={visuals} />;
          case 'assumption-register':
            return <AssumptionRegister key={kind} visuals={visuals} />;
          case 'evidence-map':
            return <EvidenceMap key={kind} visuals={visuals} />;
          default:
            return null;
        }
      })}
    </>
  );
}
