import type { CSSProperties } from 'react';
import { signed } from '../../lib/format';
import { along, positionLabel, positionOf } from './chatView';

/**
 * Where an actor stands on the scale from against to in favour: a track with the middle marked, a hollow
 * point where it started and a filled one where it is. The words and the number are always given beside it.
 */
export function StanceTrack({
  now,
  start,
  label,
}: {
  now: number;
  start?: number;
  label?: string;
}) {
  const side = now >= 0 ? 'favor' : 'against';
  const style = {
    '--at': along(now),
    '--from': start === undefined ? 0.5 : along(start),
    '--mag': Math.min(1, Math.abs(now)),
  } as CSSProperties;
  const summary =
    label ??
    `${positionLabel(positionOf(now))}, ${signed(now)} on a scale from −1 against to +1 in favour${
      start === undefined ? '' : `; it started at ${signed(start)}`
    }`;
  return (
    <span className="sw-chat__track" data-side={side} style={style} role="img" aria-label={summary}>
      <span className="sw-chat__track-mid" />
      {start !== undefined && <span className="sw-chat__track-from" />}
      <span className="sw-chat__track-now" />
    </span>
  );
}
