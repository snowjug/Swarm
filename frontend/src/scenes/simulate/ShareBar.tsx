import { cx } from '../../design/cx';
import type { ResponseShares } from '../../../../shared/analysis';
import { RESPONSE_MEANINGS } from '../../../../shared/analysis';
import { mixOf } from './model';
import './parts.css';

/**
 * How the simulated members respond, as one bar: six parts in a fixed order, from going along to resisting, each its
 * own word. The parts change width with a spring when the round changes, so a shift in the mix is seen as it happens.
 * Words are always shown beside the colours; the bar has the same figures as text for a screen reader.
 */
export function ShareBar({
  shares,
  label,
  legend = true,
  size = 'md',
  className,
}: {
  shares: ResponseShares;
  label: string;
  legend?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const mix = mixOf(shares);
  const text = mix.map((part) => `${part.label} ${Math.round(part.share * 100)}%`).join(', ');
  return (
    <div className={cx('sw-sim-mix', `sw-sim-mix--${size}`, className)}>
      <div className="sw-sim-mix__bar" role="img" aria-label={`${label}: ${text}`}>
        {mix.map((part) => (
          <span
            key={part.id}
            className="sw-sim-mix__part"
            data-cat={part.id}
            style={{ flexGrow: Math.max(part.share, 0.0001) }}
            title={`${part.label}: ${RESPONSE_MEANINGS[part.id]}`}
          />
        ))}
      </div>
      {legend && (
        <ul className="sw-sim-mix__legend" aria-hidden="true">
          {mix
            .filter((part) => part.share >= 0.005)
            .map((part) => (
              <li key={part.id} data-cat={part.id}>
                <span className="sw-sim-mix__dot" />
                <span className="sw-sim-mix__word">{part.label}</span>
                <span className="sw-sim-mix__pct">{Math.round(part.share * 100)}%</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
