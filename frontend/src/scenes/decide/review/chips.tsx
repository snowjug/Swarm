import { Cpu, ListChecks } from 'lucide-react';
import type { Critique, CritiqueSeverity, CritiqueStatus } from '../../../../../shared/critique';
import { Chip, type Tone } from '../../../design/ui';
import { ORIGIN_VIEW, SEVERITY_VIEW, STATUS_VIEW } from '../../../lib/critics';
import { SEVERITY_ICONS, STATUS_ICONS } from '../ui/meta';

const SEVERITY_TONE: Record<CritiqueSeverity, Tone> = {
  blocking: 'critical',
  major: 'against',
  minor: 'caution',
  note: 'neutral',
};

const STATUS_TONE: Record<CritiqueStatus, Tone> = {
  open: 'neutral',
  responded: 'accent',
  accepted: 'favor',
  disputed: 'caution',
};

/** How serious, in a word and a glyph of its own, so that the colour never has to say it. */
export function SeverityChip({ severity }: { severity: CritiqueSeverity }) {
  const Icon = SEVERITY_ICONS[severity];
  return (
    <Chip
      size="sm"
      tone={SEVERITY_TONE[severity]}
      icon={<Icon size={13} aria-hidden="true" />}
      title={SEVERITY_VIEW[severity].meaning}
    >
      {SEVERITY_VIEW[severity].label}
    </Chip>
  );
}

/** What has been done with it: open, answered, accepted or disputed. */
export function StatusChip({ status }: { status: CritiqueStatus }) {
  const Icon = STATUS_ICONS[status];
  return (
    <Chip
      size="sm"
      tone={STATUS_TONE[status]}
      icon={<Icon size={13} aria-hidden="true" />}
      title={STATUS_VIEW[status].meaning}
    >
      {STATUS_VIEW[status].label}
    </Chip>
  );
}

/** Whether a rule found it or a model did: a model's reading is not evidence. */
export function OriginChip({ origin }: { origin: Critique['origin'] }) {
  return (
    <Chip
      size="sm"
      icon={
        origin === 'rules' ? (
          <ListChecks size={13} aria-hidden="true" />
        ) : (
          <Cpu size={13} aria-hidden="true" />
        )
      }
      title={ORIGIN_VIEW[origin].meaning}
    >
      {ORIGIN_VIEW[origin].label}
    </Chip>
  );
}
