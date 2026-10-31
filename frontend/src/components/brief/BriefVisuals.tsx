import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, CircleHelp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { RESPONSE_CATEGORIES, RESPONSE_LABELS } from '../../../../shared/analysis';
import {
  STATEMENT_ORIGIN_LABELS,
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
            <h5>{group.label}</h5>
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

function OutcomeDistribution({ visuals }: { visuals: BriefVisuals }) {
  const rows = visuals.outcomeDistribution;
  return (
    <figure className="brief-figure">
      <figcaption>Where simulated members ended up, variant by variant</figcaption>
      <p className="field-help">
        The mean number of simulated members in each response over the seeded runs. These are counts
        of simulated members, not shares of a real population.
      </p>
      {rows.map((row) => (
        <div className="brief-bar-row" key={row.variantId}>
          <div className="brief-bar-label">
            {row.label}{' '}
            <span className="brief-count">
              ({row.kind}; {row.members} simulated members in each of {row.runs} runs)
            </span>
          </div>
          <div
            className="brief-bar"
            role="img"
            aria-label={`${row.label}: ${row.responses
              .map((entry) => `${RESPONSE_LABELS[entry.category]} ${approx(entry.mean)}`)
              .join(', ')}`}
          >
            {row.responses.map((entry) => (
              <span
                key={entry.category}
                className={`brief-seg brief-seg-${entry.category}`}
                style={{ flexGrow: entry.mean, flexBasis: 0 }}
                title={`${RESPONSE_LABELS[entry.category]}: ${approx(entry.mean)}`}
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
        caption="Mean number of simulated members in each response"
        headers={[
          'Variant',
          'Simulated members',
          ...RESPONSE_CATEGORIES.map((category) => RESPONSE_LABELS[category]),
          'Looking for an alternative or resisting (lowest to highest)',
        ]}
        rows={rows.map((row) => [
          row.label,
          String(row.members),
          ...row.responses.map((entry) => approx(entry.mean)),
          `${approx(row.adverse.mean)} (${approx(row.adverse.min)} to ${approx(row.adverse.max)})`,
        ])}
      />
    </figure>
  );
}

function ScenarioComparison({ visuals }: { visuals: BriefVisuals }) {
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
  const width = (value: number, members: number): string =>
    `${members > 0 ? Math.min(100, (value / members) * 100) : 0}%`;
  return (
    <figure className="brief-figure">
      <figcaption>Each alternative against the baseline, on the same seeds</figcaption>
      {rows.map((row) => (
        <div className="brief-compare" key={row.variantId}>
          <h5>{row.label}</h5>
          {row.baselineAdverseMean !== null ? (
            <div className="brief-bar-row">
              <div className="brief-bar-label">{baselineLabel}</div>
              <div
                className="brief-track"
                role="img"
                aria-label={`${baselineLabel}: about ${approx(row.baselineAdverseMean)} of ${row.members} simulated members looking for an alternative or resisting`}
              >
                <span
                  className="brief-fill brief-fill-baseline"
                  style={{ width: width(row.baselineAdverseMean, row.members) }}
                />
              </div>
            </div>
          ) : null}
          <div className="brief-bar-row">
            <div className="brief-bar-label">{row.label}</div>
            <div
              className="brief-track"
              role="img"
              aria-label={`${row.label}: about ${approx(row.adverseMean)} of ${row.members} simulated members looking for an alternative or resisting`}
            >
              <span
                className="brief-fill brief-fill-change"
                style={{ width: width(row.adverseMean, row.members) }}
              />
            </div>
          </div>
          <p>
            About {approx(row.adverseMean)} of {row.members} simulated members ended up looking for
            an alternative or resisting
            {row.baselineAdverseMean !== null ? (
              <> against about {approx(row.baselineAdverseMean)} under the baseline</>
            ) : null}
            .{' '}
            {row.adverseDelta !== null
              ? `On the same seeds, the change left ${approx(Math.abs(row.adverseDelta))} ${row.adverseDelta >= 0 ? 'more' : 'fewer'} simulated members adverse, with more in ${row.worseInRuns} of ${row.pairedRuns} paired runs.`
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
          'Mean adverse simulated members',
          'Baseline mean',
          'Change',
          'Paired runs',
          'More adverse in',
          'Mean stance change',
          'Finding',
        ]}
        rows={rows.map((row) => [
          row.label,
          approx(row.adverseMean),
          row.baselineAdverseMean === null ? 'no baseline' : approx(row.baselineAdverseMean),
          row.adverseDelta === null ? 'not paired' : signedNumber(row.adverseDelta, 1),
          String(row.pairedRuns),
          `${row.worseInRuns} of ${row.pairedRuns} runs`,
          row.stanceDelta === null ? 'not paired' : signedNumber(row.stanceDelta),
          row.findingId && row.classification
            ? `${row.findingId}: ${STABILITY_LABELS[row.classification]}`
            : 'none recorded',
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
              aria-label={`${row.label}: shift ${signedNumber(row.shift)} in ${row.metric}`}
            >
              <span className="brief-diverge-mid" />
              <span
                className={`brief-diverge-bar ${row.shift < 0 ? 'brief-diverge-neg' : 'brief-diverge-pos'}`}
                style={{ width: `${(Math.abs(row.shift) / largest) * 50}%` }}
              />
            </div>
            <div className="brief-sensitivity-meta">
              <span>
                {signedNumber(row.shift)} (standard error {row.standardError.toFixed(2)})
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
          signedNumber(row.shift),
          row.standardError.toFixed(2),
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
}: {
  kinds: readonly VisualKind[];
  visuals: BriefVisuals | null;
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
            return <ScenarioComparison key={kind} visuals={visuals} />;
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
