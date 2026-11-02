import { cx } from '../../design/cx';
import { RESPONSE_MEANINGS, type ResponseShares } from '../../../../shared/analysis';
import { mixOf } from './model';
import './parts.css';

export interface BarRow {
  key: string;
  label: string;
  /** From 0 to 1. */
  share: number;
  /** A response category, or `favor`, `against` or `accent` for a reading. */
  tone: string;
  title?: string;
}

/**
 * A short list of shares, each a word, a bar and a figure. The bars are the share of the whole (a full bar is all of
 * it) and change with a spring when the round does, so a shift is seen as it happens; the words are always there, so
 * that the colours are never the only thing said.
 */
export function BarRows({
  rows,
  label,
  className,
}: {
  rows: readonly BarRow[];
  label: string;
  className?: string;
}) {
  return (
    <ul className={cx('sw-rows', className)} aria-label={label}>
      {rows.map((row) => {
        const share = Math.min(1, Math.max(0, row.share));
        return (
          <li key={row.key} data-tone={row.tone} title={row.title}>
            <span className="sw-rows__word">{row.label}</span>
            <span className="sw-rows__track" aria-hidden="true">
              <span className="sw-rows__fill" style={{ transform: `scaleX(${share})` }} />
            </span>
            <span className="sw-rows__pct">{Math.round(share * 100)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The six ways simulated members respond, in the order from going along to resisting, with their full words. */
export function ResponseRows({ shares, label }: { shares: ResponseShares; label: string }) {
  return (
    <BarRows
      label={label}
      rows={mixOf(shares).map((part) => ({
        key: part.id,
        label: part.label,
        share: part.share,
        tone: part.id,
        title: RESPONSE_MEANINGS[part.id],
      }))}
    />
  );
}
