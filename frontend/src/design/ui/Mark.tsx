import { cx } from '../cx';
import './Mark.css';

/**
 * The Swarm mark: one point that holds, six that gather around it, and the few links between them that
 * make it read as a network. It is also the shape the loader and the first screen's ambient field riff on.
 */
export function Mark({
  size = 28,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={cx('sw-mark', className)}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <g className="sw-mark__links">
        <path d="M16 16 L16 5 M16 16 L25.5 10.5 M16 16 L25.5 21.5 M16 16 L16 27 M16 16 L6.5 21.5 M16 16 L6.5 10.5" />
        <path
          d="M16 5 L25.5 10.5 L25.5 21.5 L16 27 L6.5 21.5 L6.5 10.5 Z"
          className="sw-mark__ring"
        />
      </g>
      <g className="sw-mark__nodes">
        <circle cx="16" cy="16" r="3.6" className="sw-mark__core" />
        <circle cx="16" cy="5" r="2" className="sw-mark__node sw-mark__node--1" />
        <circle cx="25.5" cy="10.5" r="2" className="sw-mark__node sw-mark__node--2" />
        <circle cx="25.5" cy="21.5" r="2" className="sw-mark__node sw-mark__node--3" />
        <circle cx="16" cy="27" r="2" className="sw-mark__node sw-mark__node--4" />
        <circle cx="6.5" cy="21.5" r="2" className="sw-mark__node sw-mark__node--5" />
        <circle cx="6.5" cy="10.5" r="2" className="sw-mark__node sw-mark__node--6" />
      </g>
    </svg>
  );
}
