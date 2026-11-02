import type { ReactNode } from 'react';
import { cx } from '../../design/cx';
import { Chip, type Tone } from '../../design/ui';
import { DIRECTION_LABEL, type Direction } from '../../viz/palette';
import type { TraitOrigin, UncertaintyLevel } from '../../../../shared/stakeholders';
import {
  IMPACT_ORIGIN_LABELS,
  TRAIT_ORIGIN_HELP,
  TRAIT_ORIGIN_LABELS,
} from '../../lib/stakeholders/labels';
import './parts.css';

const DIRECTION_TONE: Record<Direction, Tone> = {
  harmed: 'against',
  benefited: 'favor',
  mixed: 'caution',
  unclear: 'neutral',
};

/** Which way the change lands on a party, in a word, with where that reading came from. */
export function ImpactChip({ direction, origin }: { direction: Direction; origin?: TraitOrigin }) {
  return (
    <Chip
      tone={DIRECTION_TONE[direction]}
      dot
      title={origin ? `Direction ${IMPACT_ORIGIN_LABELS[origin]}` : undefined}
    >
      {DIRECTION_LABEL[direction]}
      {origin && <span className="sw-chip__note">{IMPACT_ORIGIN_LABELS[origin]}</span>}
    </Chip>
  );
}

/** Where a number came from: an assumption, the evidence, a model, or the person. */
export function OriginChip({ origin }: { origin: TraitOrigin }) {
  return (
    <Chip
      size="sm"
      tone={origin === 'user' ? 'accent' : 'neutral'}
      title={TRAIT_ORIGIN_HELP[origin]}
    >
      {TRAIT_ORIGIN_LABELS[origin]}
    </Chip>
  );
}

/**
 * One value on a range, as a thin track with a marker. A signed range has its middle marked, so that the
 * side the marker is on is the first thing seen; an unsigned one fills from the left. `null` says that
 * nothing is known, in the shape of the track and in words.
 */
export function Gauge({
  label,
  value,
  min = -1,
  max = 1,
  word,
  ends,
  tone,
  hint,
}: {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  word: ReactNode;
  ends?: readonly [string, string];
  tone?: 'against' | 'favor' | 'accent';
  hint?: string;
}) {
  const signed = min < 0;
  const share = value === null ? 0.5 : Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  const side = !signed
    ? 'accent'
    : value === null
      ? 'none'
      : value < -0.05
        ? 'against'
        : value > 0.05
          ? 'favor'
          : 'none';
  return (
    <div
      className={cx('sw-gauge', signed && 'is-signed', value === null && 'is-unknown')}
      data-side={tone ?? side}
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value ?? undefined}
      aria-valuetext={typeof word === 'string' ? word : undefined}
      title={hint}
      style={{ '--p': share } as React.CSSProperties}
    >
      <div className="sw-gauge__head">
        <span className="sw-gauge__label">{label}</span>
        <span className="sw-gauge__word">{word}</span>
      </div>
      <div className="sw-gauge__track" aria-hidden="true">
        {signed && <span className="sw-gauge__mid" />}
        <span className="sw-gauge__fill" />
        <span className="sw-gauge__dot" />
      </div>
      {ends && (
        <div className="sw-gauge__ends" aria-hidden="true">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}

/** How sure the reading is: three pips, as many lit as it deserves. */
export function Confidence({ level }: { level: UncertaintyLevel }) {
  const lit = level === 'low' ? 3 : level === 'medium' ? 2 : 1;
  const word = level === 'low' ? 'High' : level === 'medium' ? 'Medium' : 'Low';
  return (
    <div
      className="sw-gauge sw-gauge--pips"
      role="img"
      aria-label={`Confidence: ${word.toLowerCase()}`}
    >
      <div className="sw-gauge__head">
        <span className="sw-gauge__label">Confidence</span>
        <span className="sw-gauge__word">{word}</span>
      </div>
      <div className="sw-pips" aria-hidden="true">
        {[1, 2, 3].map((at) => (
          <span key={at} className={cx('sw-pips__pip', at <= lit && 'is-on')} />
        ))}
      </div>
    </div>
  );
}
