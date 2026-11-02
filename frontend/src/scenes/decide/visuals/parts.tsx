import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, CircleHelp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { RESPONSE_LABELS, type ResponseCategory } from '../../../../../shared/analysis';
import { Disclosure } from '../../../design/ui';
import { DIRECTION_LABELS } from '../../../lib/brief';
import { perHundred } from '../model/format';
import { RESPONSE_ORDER } from '../model/visual-model';
import './visuals.css';

const DIRECTION_ICONS: Record<keyof typeof DIRECTION_LABELS, LucideIcon> = {
  harmed: ArrowDownRight,
  benefited: ArrowUpRight,
  mixed: ArrowLeftRight,
  unclear: CircleHelp,
};

/** Whether a group is expected to be harmed or to benefit: a glyph and a word, and a colour that only helps the eye. */
export function DirectionGlyph({ direction }: { direction: keyof typeof DIRECTION_LABELS }) {
  const Icon = DIRECTION_ICONS[direction];
  return (
    <span className="sw-decide-dir" data-direction={direction} title={DIRECTION_LABELS[direction]}>
      <Icon size={15} aria-hidden="true" />
      <span className="sr-only">{DIRECTION_LABELS[direction]}</span>
    </span>
  );
}

/** The six responses as one bar, the most favourable at the left: where a group's simulated members ended up. */
export function ResponseBar({
  shares,
  height = 'md',
  label,
  labelled = false,
  active = null,
}: {
  shares: Record<ResponseCategory, number>;
  height?: 'sm' | 'md' | 'lg';
  label: string;
  /** Names a response inside its segment where there is room for it. */
  labelled?: boolean;
  /** A response the reader is looking at: the others step back. */
  active?: ResponseCategory | null;
}) {
  const total = RESPONSE_ORDER.reduce((sum, category) => sum + shares[category], 0) || 1;
  return (
    <div
      className="sw-decide-resp"
      data-size={height}
      role="img"
      aria-label={`${label}: ${RESPONSE_ORDER.map((category) => `${RESPONSE_LABELS[category]} ${perHundred(shares[category])}`).join(', ')} in every 100 simulated members`}
    >
      {RESPONSE_ORDER.map((category) => {
        const share = shares[category] / total;
        return (
          <span
            key={category}
            className="sw-decide-resp__seg"
            data-cat={category}
            data-on={active === category || undefined}
            style={{ flexGrow: Math.max(share, 0.0005), flexBasis: 0 }}
            title={`${RESPONSE_LABELS[category]}: ${perHundred(shares[category])} in 100`}
          >
            {labelled && share >= 0.1 ? (
              <span className="sw-decide-resp__label num">{perHundred(shares[category])}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/** Which colour is which response, with the figure for each where there is one. */
export function ResponseLegend({
  values,
  active,
  onActive,
}: {
  values?: Record<ResponseCategory, string>;
  active?: ResponseCategory | null;
  onActive?: (category: ResponseCategory | null) => void;
}) {
  return (
    <ul className="sw-decide-legend" role="list">
      {RESPONSE_ORDER.map((category) => (
        <li
          key={category}
          data-active={active === category || undefined}
          onMouseEnter={() => onActive?.(category)}
          onMouseLeave={() => onActive?.(null)}
        >
          <button
            type="button"
            className="sw-decide-legend__item"
            aria-pressed={active === category}
            onClick={() => onActive?.(active === category ? null : category)}
            onFocus={() => onActive?.(category)}
            onBlur={() => onActive?.(null)}
            disabled={!onActive}
          >
            <span
              className="sw-decide-legend__swatch sw-decide-resp__seg"
              data-cat={category}
              aria-hidden="true"
            />
            <span>{RESPONSE_LABELS[category]}</span>
            {values ? (
              <span className="sw-decide-legend__value num">{values[category]}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The same data as a table, for the reader who wants the numbers, who cannot see the chart or who prints it. */
export function TableAlt({
  caption,
  headers,
  rows,
  printed = false,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  /** Printed with the page, where the chart shows no numbers of its own. */
  printed?: boolean;
}) {
  return (
    <Disclosure
      className={printed ? 'sw-decide-tablealt sw-decide-tablealt--printed' : 'sw-decide-tablealt'}
      summary="Show this as a table"
    >
      <div className="sw-decide-tablewrap" role="region" aria-label={caption} tabIndex={0}>
        <table className="sw-decide-table">
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
                {row.map((cell, column) =>
                  column === 0 ? (
                    <th scope="row" key={column}>
                      {cell}
                    </th>
                  ) : (
                    <td key={column} className="num">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

/** A heading for one figure, in the voice of a caption: what it shows, in a line. */
export function FigureHead({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <figcaption className="sw-decide-fighead">
      <span className="sw-decide-fighead__title">{title}</span>
      {note ? <span className="sw-decide-fighead__note">{note}</span> : null}
    </figcaption>
  );
}
