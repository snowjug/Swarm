import {
  BadgeCheck,
  Bot,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Contrast,
  Eye,
  FlaskConical,
  Link2,
  Lock,
  MessageSquare,
  PenLine,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PublicationStatus, SupportClass } from '../../../../shared/evidence';
import type { SupportVerdict } from '../../../../shared/grounding';
import type { SectionOrigin, StudioState } from '../../../../shared/studio';
import type { Tone } from '../../design/ui';
import { PUBLICATION_TONE, SUPPORT_TONE, type Tone as LedgerTone } from '../../lib/ledger';
import type { MarkKind } from './model';

/** The ledger's tones in the design system's: `good` is in favour, `bad` is critical, `info` is accent. */
const TONES: Record<LedgerTone, Tone> = {
  good: 'favor',
  caution: 'caution',
  bad: 'critical',
  neutral: 'neutral',
  info: 'accent',
};

export const supportTone = (support: SupportClass): Tone => TONES[SUPPORT_TONE[support]];
export const publicationTone = (status: PublicationStatus): Tone => TONES[PUBLICATION_TONE[status]];

/** A different silhouette per support class, so that the label never depends on colour. */
export const SUPPORT_ICONS: Record<SupportClass, LucideIcon> = {
  'directly-supported': CircleCheck,
  'partially-supported': Contrast,
  contradicted: TriangleAlert,
  unsupported: CircleX,
  'not-applicable': CircleDashed,
  'not-checkable': CircleHelp,
  'simulation-derived': FlaskConical,
  'assumption-dependent': Link2,
};

/** What a check of a statement found. Each has its own silhouette and its own word beside it. */
export const VERDICT_ICONS: Record<SupportVerdict, LucideIcon> = {
  supported: CircleCheck,
  partial: Contrast,
  unsupported: CircleX,
  contradicted: TriangleAlert,
  unchecked: CircleHelp,
};

export const VERDICT_TONES: Record<SupportVerdict, Tone> = {
  supported: 'favor',
  partial: 'caution',
  unsupported: 'against',
  contradicted: 'critical',
  unchecked: 'neutral',
};

export const MARK_ICONS: Record<MarkKind, LucideIcon> = {
  unsaved: PenLine,
  rewrite: Sparkles,
  locked: Lock,
  earlier: TriangleAlert,
  notes: MessageSquare,
  person: UserRound,
};

export const ORIGIN_ICONS: Record<SectionOrigin, LucideIcon> = {
  generated: Bot,
  human: UserRound,
  regenerated: Sparkles,
};

export const STATE_ICONS: Record<StudioState, LucideIcon> = {
  draft: PenLine,
  'in-review': Eye,
  'changes-requested': RotateCcw,
  approved: BadgeCheck,
};
