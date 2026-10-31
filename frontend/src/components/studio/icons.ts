import { BadgeCheck, Bot, Eye, Lock, PenLine, RotateCcw, Sparkles, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SectionOrigin, StudioState } from '../../../../shared/studio';

// A different glyph per state and per origin, beside the words: colour is never the only cue, and a
// state is not shown with the question mark that means "not checked".
export const STATE_ICON: Record<StudioState, LucideIcon> = {
  draft: PenLine,
  'in-review': Eye,
  'changes-requested': RotateCcw,
  approved: BadgeCheck,
};

export const ORIGIN_ICON: Record<SectionOrigin, LucideIcon> = {
  generated: Bot,
  human: UserRound,
  regenerated: Sparkles,
};

export const LOCK_ICON: LucideIcon = Lock;
