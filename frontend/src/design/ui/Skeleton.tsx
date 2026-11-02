import { cx } from '../cx';
import './Skeleton.css';

/** What stands where something is still being worked out: the shape it will have, with light passing over it. */
export function Skeleton({
  width,
  height = '1em',
  radius,
  className,
}: {
  width?: string | number;
  height?: string | number;
  radius?: string;
  className?: string;
}) {
  return (
    <span
      className={cx('sw-skeleton', className)}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius }}
    />
  );
}

/** Several lines of text that is not there yet; the last is shorter, as a paragraph's is. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx('sw-skeleton-text', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '62%' : '100%'} height="0.95em" />
      ))}
    </span>
  );
}
