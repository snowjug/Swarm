import { Fragment } from 'react';
import { CircleCheck, CircleHelp, CircleX, Contrast, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SUPPORT_VERDICT_LABELS, type SupportVerdict } from '../../../../shared/grounding';
import type { VerdictTally } from '../../lib/grounding';

// A different silhouette or glyph per verdict, so the label never depends on colour.
const VERDICT_ICONS: Record<SupportVerdict, LucideIcon> = {
  supported: CircleCheck,
  partial: Contrast,
  unsupported: CircleX,
  contradicted: TriangleAlert,
  unchecked: CircleHelp,
};

export function VerdictIcon({ verdict, size = 14 }: { verdict: SupportVerdict; size?: number }) {
  // A verdict this build does not know must still render, as "not checkable", rather than fail.
  const Icon = VERDICT_ICONS[verdict] ?? CircleHelp;
  return <Icon size={size} aria-hidden="true" />;
}

export function VerdictBadge({ verdict }: { verdict: SupportVerdict }) {
  return (
    <span className={`verdict-badge verdict-${verdict}`}>
      <VerdictIcon verdict={verdict} />
      {SUPPORT_VERDICT_LABELS[verdict] ?? verdict}
    </span>
  );
}

/** Inline `· 7 Supported · 2 Partly supported` pieces, each with its icon; place after a lead-in. */
export function VerdictTallies({ tallies }: { tallies: VerdictTally[] }) {
  return tallies.map((tally) => (
    <Fragment key={tally.verdict}>
      {' · '}
      <span className={`tally tally-${tally.verdict}${tally.count === 0 ? ' tally-zero' : ''}`}>
        <VerdictIcon verdict={tally.verdict} size={13} />
        {`${tally.count} ${tally.label}`}
      </span>
    </Fragment>
  ));
}
