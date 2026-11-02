import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Platform } from '../../../../../shared/guided';
import { cx } from '../../../design/cx';
import { Segmented } from '../../../design/ui';
import { firmnessText } from '../../../lib/transparency';
import { stanceColor, stanceWord } from '../../../viz/palette';
import { STATED_REASON_NOTE } from './copy';
import { vars } from './css';
import { stanceText, type PlatformView } from './model';
import './parts.css';

/**
 * Where an inclination sits between against and in favour: a bar that grows from the middle and a point at
 * its end. The number always stands beside it, because the bar alone cannot say how far.
 */
export function Dial({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const v = Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
  return (
    <span
      className="sw-deep-dial"
      data-size={size}
      aria-hidden="true"
      style={vars({
        '--v': v,
        '--neg': Math.max(0, -v),
        '--pos': Math.max(0, v),
        '--c': stanceColor(v, 0.6),
      })}
    >
      <span className="sw-deep-dial__half sw-deep-dial__half--neg">
        <span className="sw-deep-dial__bar" />
      </span>
      <span className="sw-deep-dial__half sw-deep-dial__half--pos">
        <span className="sw-deep-dial__bar" />
      </span>
      <span className="sw-deep-dial__dot" />
    </span>
  );
}

/** An inclination as the dial and its number and word: the colour is never the only way it is said. */
export function Position({ value, word = true }: { value: number; word?: boolean }) {
  return (
    <span className="sw-deep-position">
      <Dial value={value} />
      <span className="sw-deep-position__text">
        <span className="sw-deep-position__value num">{stanceText(value)}</span>
        {word && <span className="sw-deep-position__word">{stanceWord(value, 0.5)}</span>}
      </span>
    </span>
  );
}

export function SectionHead({
  title,
  lead,
  aside,
  id,
  level = 2,
}: {
  title: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
  id?: string;
  level?: 2 | 3;
}) {
  const Heading = `h${level}` as const;
  return (
    <header className="sw-deep-head">
      <div className="sw-deep-head__text">
        <Heading className="sw-deep-head__title" id={id}>
          {title}
        </Heading>
        {lead && <p className="sw-deep-head__lead">{lead}</p>}
      </div>
      {aside && <div className="sw-deep-head__aside">{aside}</div>}
    </header>
  );
}

/** One figure of a round: a small label, a number set large, and what changed since the round before. */
export function Figure({
  label,
  value,
  change,
  hint,
}: {
  label: string;
  value: string;
  change?: string | null;
  hint?: string;
}) {
  return (
    <div className="sw-deep-figure" title={hint}>
      <dt className="sw-deep-figure__label">{label}</dt>
      <dd className="sw-deep-figure__value">
        <span className="sw-numeral num">{value}</span>
        {change && <span className="sw-deep-figure__change num">{change}</span>}
      </dd>
    </div>
  );
}

/** Text that is long is shown in a few lines, and all of it on request. It keeps the line breaks it came with. */
export function Clamp({
  text,
  lines = 3,
  limit = 200,
  className,
}: {
  text: string;
  lines?: number;
  limit?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  return (
    <div className={cx('sw-deep-clamp', className)}>
      <p
        className="sw-deep-clamp__text"
        data-open={open || !long}
        style={vars({ '--lines': lines })}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          className="sw-deep-link"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Show less' : 'Read all'}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="sw-deep-link__chev"
            data-open={open}
          />
        </button>
      )}
    </div>
  );
}

/**
 * The short reason a proxy gave for an action, and how firm it said it was. Both are text the model chose
 * to write, so the page says so and does not present either as hidden reasoning.
 */
export function StatedReason({
  rationale,
  confidence,
}: {
  rationale?: string | null;
  confidence?: number | null;
}) {
  const reason = rationale?.trim();
  const firmness = firmnessText(confidence);
  if (!reason && !firmness) return null;
  return (
    <div className="sw-deep-reason">
      {reason && (
        <p className="sw-deep-reason__text">
          <span className="sw-deep-reason__label">Stated reason</span> “{reason}”
        </p>
      )}
      <p className="sw-deep-reason__note">
        {reason ? `${STATED_REASON_NOTE} ` : ''}
        {firmness ?? ''}
      </p>
    </div>
  );
}

const SHORT: Record<Platform, string> = { plaza: 'Plaza', community: 'Community' };

/** One platform at a time, never both: the two are not one audience and are not averaged. */
export function PlatformSwitch({
  platforms,
  value,
  onChange,
  size = 'md',
}: {
  platforms: readonly PlatformView[];
  value: Platform;
  onChange: (platform: Platform) => void;
  size?: 'sm' | 'md';
}) {
  const options = platforms
    .filter((view) => view.run !== null || view.planned)
    .map((view) => ({
      value: view.id,
      label: (
        <>
          <span className="sw-deep-hide-sm">{view.name}</span>
          <span className="sw-deep-show-sm">{SHORT[view.id]}</span>
        </>
      ),
      disabled: view.run === null,
      hint: view.run === null ? 'not run' : undefined,
    }));
  if (options.length < 2) return null;
  return (
    <Segmented<Platform>
      size={size}
      label="Platform"
      value={value}
      onChange={onChange}
      options={options}
    />
  );
}

/** The three shares of a round as one bar, from against through undecided to in favour. The words stand beside it. */
export function ShareBar({
  against,
  undecided,
  favour,
  label,
}: {
  against: number;
  undecided: number;
  favour: number;
  label: string;
}) {
  return (
    <span
      className="sw-deep-shares"
      role="img"
      aria-label={label}
      style={vars({ '--a': against, '--u': undecided, '--f': favour })}
    >
      <span className="sw-deep-shares__seg sw-deep-shares__seg--against" />
      <span className="sw-deep-shares__seg sw-deep-shares__seg--undecided" />
      <span className="sw-deep-shares__seg sw-deep-shares__seg--favour" />
    </span>
  );
}

/** A line of small print that is part of the page, not hidden: the wording that keeps a number honest. */
export function Fine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('sw-deep-fine', className)}>{children}</p>;
}
