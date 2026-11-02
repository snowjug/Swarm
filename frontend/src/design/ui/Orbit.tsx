import { cx } from '../cx';
import './Orbit.css';

/**
 * The product's own loader: three points that circle a centre at different speeds, in the three colours
 * the product uses for meaning. It says "work is happening" without saying how long; where progress is
 * known, use `Ring` or `Meter` instead.
 */
export function Orbit({
  size = 20,
  label = 'Loading',
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cx('sw-orbit', className)} role="status" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle className="sw-orbit__track" cx="12" cy="12" r="8" />
        <g className="sw-orbit__arm sw-orbit__arm--1">
          <circle cx="12" cy="4" r="2.1" className="sw-orbit__dot sw-orbit__dot--accent" />
        </g>
        <g className="sw-orbit__arm sw-orbit__arm--2">
          <circle cx="12" cy="4" r="1.7" className="sw-orbit__dot sw-orbit__dot--favor" />
        </g>
        <g className="sw-orbit__arm sw-orbit__arm--3">
          <circle cx="12" cy="4" r="1.4" className="sw-orbit__dot sw-orbit__dot--against" />
        </g>
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
