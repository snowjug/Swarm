import { useState } from 'react';
import { RESPONSE_LABELS, type ResponseCategory } from '../../../../../shared/analysis';
import type { BriefOutcomeRow, BriefVisuals } from '../../../../../shared/brief';
import { perHundred } from '../model/format';
import { RESPONSE_ORDER } from '../model/visual-model';
import { FigureHead, ResponseBar, ResponseLegend, TableAlt } from './parts';
import './outcomes.css';

const asShares = (row: BriefOutcomeRow): Record<ResponseCategory, number> =>
  Object.fromEntries(
    RESPONSE_ORDER.map((category) => [
      category,
      row.shares.find((entry) => entry.category === category)?.mean ?? 0,
    ]),
  ) as Record<ResponseCategory, number>;

const range = (row: BriefOutcomeRow, category: ResponseCategory): string => {
  const entry = row.shares.find((item) => item.category === category);
  if (!entry) return '';
  return entry.min === null || entry.max === null
    ? perHundred(entry.mean)
    : `${perHundred(entry.mean)} (${perHundred(entry.min)} to ${perHundred(entry.max)})`;
};

/**
 * The possible futures, one bar for each scenario: where simulated members ended up, from in favour at the
 * left to against at the right. Pointing at a response in the key brings it forward in every bar and reads
 * it out, scenario by scenario, with its range over the seeded runs.
 */
export function OutcomeVisual({ visuals }: { visuals: BriefVisuals }) {
  const rows = visuals.outcomeDistribution;
  const [active, setActive] = useState<ResponseCategory | null>(null);
  if (rows.length === 0) return null;
  return (
    <figure className="sw-decide-fig" data-dim={active ? '' : undefined}>
      <FigureHead
        title="Where simulated members ended up"
        note="The mean share of simulated members in each response over the seeded runs, in every 100, every group counting equally. These are shares of simulated members, not rates in a real population."
      />
      <div className="sw-decide-oc">
        {rows.map((row) => (
          <div className="sw-decide-oc__row" key={row.variantId}>
            <p className="sw-decide-oc__label">
              <strong>{row.label}</strong>
              <small>
                {row.kind === 'baseline' ? 'the baseline' : 'a change'} · {row.runs} seeded runs
              </small>
            </p>
            <ResponseBar
              shares={asShares(row)}
              height="lg"
              labelled
              active={active}
              label={row.label}
            />
          </div>
        ))}
      </div>
      <ResponseLegend active={active} onActive={setActive} />
      <div className="sw-decide-oc__read" aria-live="polite">
        {active ? (
          <>
            <strong>{RESPONSE_LABELS[active]}</strong>
            {rows.map((row) => (
              <span key={row.variantId}>
                {row.label} <b className="num">{range(row, active)}</b>
              </span>
            ))}
            <span className="sw-decide-oc__hint">in every 100, mean and range over the runs</span>
          </>
        ) : (
          <span className="sw-decide-oc__hint">
            Point at a response to see it in each scenario.
          </span>
        )}
      </div>
      <TableAlt
        printed
        caption="Mean share of simulated members in each response, in every 100, with the lowest and highest over the runs"
        headers={['Scenario', ...RESPONSE_ORDER.map((category) => RESPONSE_LABELS[category])]}
        rows={rows.map((row) => [
          row.label,
          ...RESPONSE_ORDER.map((category) => range(row, category)),
        ])}
      />
    </figure>
  );
}
