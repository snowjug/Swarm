import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, ChevronDown, Minus } from 'lucide-react';
import { STABILITY_CLASSES } from '../../../../../shared/analysis';
import { STATEMENT_ORIGIN_LABELS, type BriefVisuals } from '../../../../../shared/brief';
import { Chip, Popover, PopoverTrigger } from '../../../design/ui';
import { CLASSIFICATION_LABELS, STABILITY_LABELS } from '../../../lib/brief';
import { aboutTarget } from '../model/critique-model';
import { decimals, plural, signedDecimals, signedPerHundred } from '../model/format';
import { stabilityBands, tornadoReach, tornadoRows } from '../model/visual-model';
import { useDoc } from '../ui/context';
import { DetailPopover } from '../ui/DetailPopover';
import { ORIGIN_ICONS, SEVERITY_ICONS } from '../ui/meta';
import { FigureHead, TableAlt } from './parts';
import './uncertainty.css';

const SHOWN = 6;

/**
 * What moving one assumption did to the simulated outcome, the largest first: a bar from the middle, to the
 * left where it lowered the share of members looking for an alternative or resisting and to the right where
 * it raised it, with its standard error as a thin line.
 */
export function SensitivityVisual({ visuals }: { visuals: BriefVisuals }) {
  const { critiques } = useDoc();
  const [all, setAll] = useState(false);
  const rows = tornadoRows(visuals.sensitivity);
  if (rows.length === 0) {
    return (
      <p className="sw-decide-note-line">
        No assumption was moved in this analysis, so there is no sensitivity chart.
      </p>
    );
  }
  const reach = tornadoReach(rows);
  const shown = all ? rows : rows.slice(0, SHOWN);
  const at = (value: number) => `${50 + (value / reach) * 50}%`;
  return (
    <figure className="sw-decide-fig">
      <FigureHead
        title="What moving one assumption did"
        note="Each bar is the change, in every 100 simulated members, in the share looking for an alternative or resisting when one assumption was moved and nothing else, on the same seeds. Left lowers it, right raises it; the thin line is the standard error."
      />
      <ol className="sw-decide-tn" role="list">
        {shown.map((row, index) => {
          const flagged = aboutTarget(critiques, 'assumption', row.id);
          const Origin = ORIGIN_ICONS[row.origin];
          const FlagIcon = flagged[0] ? SEVERITY_ICONS[flagged[0].severity] : null;
          return (
            <li
              key={row.id}
              className="sw-decide-tn__row"
              style={{ '--i': Math.min(index, 8) } as CSSProperties}
            >
              <p className="sw-decide-tn__label">
                {row.label}
                {FlagIcon ? (
                  <span className="sw-decide-tn__flag" title={plural(flagged.length, 'criticism')}>
                    <FlagIcon size={13} aria-hidden="true" />
                    <span className="sr-only">
                      {plural(flagged.length, 'criticism')} in the review
                    </span>
                  </span>
                ) : null}
              </p>
              <div
                className="sw-decide-tn__plot"
                role="img"
                aria-label={`${row.label}: shift ${signedDecimals(row.shift)}, standard error ${decimals(row.standardError)}. ${CLASSIFICATION_LABELS[row.classification]}.`}
              >
                <span className="sw-decide-tn__mid" />
                <span
                  className="sw-decide-tn__bar"
                  data-up={row.shift >= 0}
                  style={{
                    left: row.shift >= 0 ? '50%' : at(row.shift),
                    width: `${(Math.abs(row.shift) / reach) * 50}%`,
                  }}
                />
                <span
                  className="sw-decide-tn__whisker"
                  style={{
                    left: at(row.shift - row.standardError),
                    width: `${((row.standardError * 2) / reach) * 50}%`,
                  }}
                />
              </div>
              <p className="sw-decide-tn__meta">
                <b className="num">{signedPerHundred(row.shift)}</b> in 100
                <span className="sw-decide-tn__sep" aria-hidden="true">
                  ·
                </span>
                <Chip
                  size="sm"
                  tone={row.classification === 'assumption-sensitive' ? 'caution' : 'neutral'}
                >
                  {CLASSIFICATION_LABELS[row.classification]}
                </Chip>
                <span className="sw-decide-tn__ev">
                  {row.evidenced ? (
                    <Check size={13} aria-hidden="true" />
                  ) : (
                    <Minus size={13} aria-hidden="true" />
                  )}
                  {row.evidenced ? 'A cited passage backs it' : 'No cited passage backs it'}
                </span>
                <span className="sw-decide-tn__origin" title={STATEMENT_ORIGIN_LABELS[row.origin]}>
                  <Origin size={13} aria-hidden="true" />
                  <span>{STATEMENT_ORIGIN_LABELS[row.origin]}</span>
                </span>
              </p>
            </li>
          );
        })}
      </ol>
      {rows.length > SHOWN && (
        <button
          type="button"
          className="sw-decide-more"
          aria-expanded={all}
          onClick={() => setAll((old) => !old)}
        >
          <span>{all ? 'Show the largest few' : `Show all ${rows.length} moves`}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      )}
      <TableAlt
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
          signedDecimals(row.shift),
          decimals(row.standardError),
          CLASSIFICATION_LABELS[row.classification],
          STATEMENT_ORIGIN_LABELS[row.origin],
          row.evidenced ? 'cited' : 'none cited',
        ])}
      />
    </figure>
  );
}

const BAND_MEANING: Record<(typeof STABILITY_CLASSES)[number], string> = {
  repeatable: 'Held in nearly every seeded run.',
  'mostly-repeatable': 'Held in most seeded runs.',
  unstable: 'Held in some runs and failed in others: do not rely on it.',
  rare: 'Seldom happened in the runs; the runs agree on that.',
};

/**
 * How steadily each finding held across the seeded runs. Each is the interval for the share of runs it held
 * in, with the share marked on it; the findings sit in bands by how steady they were, the steadiest first.
 */
export function StabilityVisual({ visuals }: { visuals: BriefVisuals }) {
  const bands = stabilityBands(visuals.lookups.findings);
  const [all, setAll] = useState(false);
  const { mode } = useDoc();
  if (bands.length === 0) return null;
  const total = bands.reduce((sum, band) => sum + band.findings.length, 0);
  const limit = all ? Number.POSITIVE_INFINITY : 4;
  return (
    <figure className="sw-decide-fig">
      <FigureHead
        title="How steadily each finding held"
        note={`${plural(total, 'finding')}, each the share of seeded runs in which a statement held, with a 95% interval for that share. There is no confidence score, and none of this is a probability.`}
      />
      <div className="sw-decide-sb">
        {bands.map((band) => (
          <section
            key={band.classification}
            className="sw-decide-sb__band"
            aria-label={STABILITY_LABELS[band.classification]}
          >
            <header className="sw-decide-sb__head" data-class={band.classification}>
              <span className="sw-decide-sb__name">{STABILITY_LABELS[band.classification]}</span>
              <span className="sw-decide-sb__count num">{band.findings.length}</span>
              <span className="sw-decide-sb__meaning">{BAND_MEANING[band.classification]}</span>
            </header>
            <ul role="list" className="sw-decide-sb__list">
              {band.findings.slice(0, limit).map((finding) => (
                <li key={finding.id}>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="sw-decide-sb__row">
                        <span className="sw-decide-sb__text">{finding.statement}</span>
                        <span
                          className="sw-decide-sb__track"
                          aria-hidden="true"
                          data-class={band.classification}
                        >
                          <span
                            className="sw-decide-sb__span"
                            style={{
                              left: `${finding.interval.lo * 100}%`,
                              width: `${Math.max((finding.interval.hi - finding.interval.lo) * 100, 1)}%`,
                            }}
                          />
                          <span
                            className="sw-decide-sb__dot"
                            style={{ left: `${(finding.holdsIn / finding.of) * 100}%` }}
                          />
                        </span>
                        <span className="sw-decide-sb__value num">
                          <b>{finding.holdsIn}</b>/{finding.of}
                        </span>
                        <span className="sr-only"> seeded runs</span>
                      </button>
                    </PopoverTrigger>
                    <DetailPopover
                      label="How steadily this finding held"
                      width="24rem"
                      className="sw-decide-gdpop"
                    >
                      <div className="sw-decide-gd">
                        <p className="sw-decide-gd__text">{finding.statement}</p>
                        <p className="sw-decide-gd__text">
                          Held in <b className="num">{finding.holdsIn}</b> of{' '}
                          <b className="num">{finding.of}</b> seeded runs ·{' '}
                          {STABILITY_LABELS[finding.classification]} · interval{' '}
                          <span className="num">
                            {decimals(finding.interval.lo)} to {decimals(finding.interval.hi)}
                          </span>
                        </p>
                        <p className="sw-decide-gd__fine">
                          The interval describes these runs. For a statement chosen after the runs
                          were seen, it does not claim to hold beyond them.
                        </p>
                        {mode === 'advanced' ? (
                          <p className="sw-decide-gd__id sw-mono">{finding.id}</p>
                        ) : null}
                      </div>
                    </DetailPopover>
                  </Popover>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="sw-decide-sb__axis" aria-hidden="true">
        <span>0</span>
        <span>half the runs</span>
        <span>every run</span>
      </div>
      {total > 4 * bands.length && (
        <button
          type="button"
          className="sw-decide-more"
          aria-expanded={all}
          onClick={() => setAll((old) => !old)}
        >
          <span>{all ? 'Show fewer' : `Show all ${total} findings`}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      )}
      <TableAlt
        caption="Findings, by how steadily they held across the seeded runs"
        headers={['Finding', 'Held in', 'Of', 'Interval', 'Class']}
        rows={visuals.lookups.findings.map((finding) => [
          finding.statement,
          String(finding.holdsIn),
          String(finding.of),
          `${decimals(finding.interval.lo)} to ${decimals(finding.interval.hi)}`,
          STABILITY_LABELS[finding.classification],
        ])}
      />
    </figure>
  );
}
