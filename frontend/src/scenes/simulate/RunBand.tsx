import { signedNumber } from '../../lib/analysis';
import { stanceColor } from '../../viz/palette';
import { bandAt, roundOf, stanceSentence, type Replay } from './model';
import './parts.css';

/**
 * The overall stance in the round shown, with where the other seeded runs of the same scenario were in that round: a
 * dot for the run on show on a strip, and a soft bar for the range most runs fell in (the 10th to the 90th). It shows
 * how much this one run says, without a sentence about it.
 */
export function RunBand({ replay, round, runs }: { replay: Replay; round: number; runs: number }) {
  const stance = roundOf(replay, round).stanceMean;
  const band = bandAt(replay, round);
  const place = (value: number): number =>
    50 + Math.max(-1, Math.min(1, value / replay.bandReach)) * 50;
  const spread = band
    ? `most of the ${runs} seeded runs between ${signedNumber(band.p10)} and ${signedNumber(band.p90)}`
    : null;
  return (
    <div className="sw-band">
      <p className="sw-band__line">
        <span className="sw-band__label">Overall stance</span>
        <span className="sw-mono sw-band__value">{signedNumber(stance)}</span>
        <span className="sw-band__word">{stanceSentence(stance, replay.scale)}</span>
      </p>
      <div
        className="sw-band__track"
        role="img"
        aria-label={`Overall stance ${signedNumber(stance)} in this run${spread ? `, ${spread}` : ''}`}
      >
        <span className="sw-band__zero" />
        {band && (
          <span
            className="sw-band__range"
            style={{
              left: `${place(band.p10)}%`,
              width: `${Math.max(place(band.p90) - place(band.p10), 1)}%`,
            }}
          />
        )}
        <span
          className="sw-band__dot"
          style={{ left: `${place(stance)}%`, background: stanceColor(stance, replay.scale) }}
        />
      </div>
      {spread && (
        <p className="sw-band__note">
          Most of the {runs} runs: <span className="sw-mono">{signedNumber(band!.p10)}</span> to{' '}
          <span className="sw-mono">{signedNumber(band!.p90)}</span>
        </p>
      )}
    </div>
  );
}
