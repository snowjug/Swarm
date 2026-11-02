import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../../design/cx';
import type { Tone } from '../../design/ui';
import './TallyBar.css';

export interface Tally {
  key: string;
  label: string;
  count: number;
  tone: Tone;
  icon: LucideIcon;
}

/**
 * How a set of statements divides, as one bar cut in proportion and, under it, the same figures in
 * words with a glyph each: the bar is a glance and the list is the data, so colour is never the only cue.
 */
export function TallyBar({
  tallies,
  label,
  legend = true,
  className,
  children,
}: {
  tallies: readonly Tally[];
  /** What the bar shows, for a screen reader: it is read as a sentence made of the counts. */
  label: string;
  legend?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const shown = tallies.filter((tally) => tally.count > 0);
  const total = shown.reduce((sum, tally) => sum + tally.count, 0);
  return (
    <div className={cx('sw-tally', className)}>
      <div
        className="sw-tally__bar"
        role="img"
        aria-label={`${label}: ${shown.map((tally) => `${tally.count} ${tally.label.toLowerCase()}`).join(', ') || 'none'}`}
      >
        {total === 0 ? (
          <span className="sw-tally__seg sw-tally__seg--empty" style={{ flexGrow: 1 }} />
        ) : (
          shown.map((tally) => (
            <span
              key={tally.key}
              className="sw-tally__seg"
              data-tone={tally.tone}
              style={{ flexGrow: tally.count }}
            />
          ))
        )}
      </div>
      {legend && (
        <ul className="sw-tally__legend" role="list">
          {tallies.map((tally) => {
            const Icon = tally.icon;
            return (
              <li
                key={tally.key}
                className="sw-tally__item"
                data-tone={tally.tone}
                data-zero={tally.count === 0 || undefined}
              >
                <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
                <span className="sw-tally__count num">{tally.count}</span>
                <span className="sw-tally__label">{tally.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {children}
    </div>
  );
}
