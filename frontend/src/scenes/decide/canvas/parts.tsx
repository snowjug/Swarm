import type { CSSProperties, ReactNode } from 'react';
import { CircleHelp, GitFork, OctagonAlert, Scale, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  EPISTEMIC_LABEL_INFO,
  RESPONSE_GROUPS,
  RESPONSE_GROUP_WORDS,
  type DecisionCanvas,
  type DecisionStatus,
  type EpistemicLabel,
  type GroupShares,
} from '../../../../../shared/decision';
import { Tooltip } from '../../../design/ui';
import { perHundred } from '../model/format';

/** The small pieces the canvas is made of: the label of a statement, the icon of a status, the bar of a future. */

/**
 * What kind of statement something is, in a compact label. The meaning is in a tooltip for the pointer and in the
 * legend for everyone else, since a tooltip holds the only copy of nothing; to a screen reader the label is
 * read as text with what it is a label of.
 */
export function LabelChip({ label }: { label: EpistemicLabel }) {
  const info = EPISTEMIC_LABEL_INFO[label];
  return (
    <Tooltip label={info.meaning} side="top">
      <span className="sw-canvas-label" data-label={label}>
        <span className="sr-only">Kind of statement: </span>
        {info.name}
      </span>
    </Tooltip>
  );
}

/** One label for a list of statements that share it, said once. */
export function LabelsOf({ labels }: { labels: readonly EpistemicLabel[] }) {
  return (
    <>
      {labels.map((label) => (
        <LabelChip key={label} label={label} />
      ))}
    </>
  );
}

const STATUS_ICONS = {
  'robust-option': ShieldCheck,
  'conditional-option': ShieldAlert,
  'multiple-plausible-options': GitFork,
  'insufficient-evidence': CircleHelp,
  'blocked-by-hard-constraint': OctagonAlert,
  'needs-human-decision': Scale,
} as const satisfies Record<DecisionStatus, unknown>;

export function StatusIcon({ status, size = 22 }: { status: DecisionStatus; size?: number }) {
  const Icon = STATUS_ICONS[status];
  return <Icon size={size} aria-hidden="true" className="sw-canvas-status__icon" />;
}

const BAR_GROUPS = [...RESPONSE_GROUPS] as const;

/**
 * How the simulated members of an option ended up, in four groups, as one bar. The figures are shares of
 * simulated members averaged over the seeded runs; the same numbers are in the text beside it, so the bar
 * is never the only way to read them.
 */
export function ShareBar({ shares }: { shares: GroupShares }) {
  const text = BAR_GROUPS.map(
    (group) => `${RESPONSE_GROUP_WORDS[group]} ${perHundred(shares[group])}`,
  ).join(', ');
  return (
    <span
      className="sw-canvas-bar"
      role="img"
      aria-label={`Simulated members in 100, by where they ended up: ${text}`}
    >
      {BAR_GROUPS.map((group) => (
        <span
          key={group}
          className="sw-canvas-bar__part"
          data-group={group}
          style={{ '--w': `${Math.max(0, shares[group]) * 100}%` } as CSSProperties}
        />
      ))}
    </span>
  );
}

/** A figure with the words it needs beside it, kept on one line. */
export function Fig({ children }: { children: ReactNode }) {
  return <span className="sw-canvas-fig num">{children}</span>;
}

/**
 * How the participants behind the roles were made. A list the rules made after the model was asked and could
 * not be used says so, in its own words, and is never read as one the model proposed. Nothing is said where no
 * list was recorded.
 */
export function ParticipantOrigin({ origin }: { origin: DecisionCanvas['actors']['origin'] }) {
  if (origin.source === 'unknown') return null;
  return (
    <p className="sw-canvas-origin" data-origin={origin.source}>
      <strong>{origin.label}.</strong> {origin.detail}
    </p>
  );
}
