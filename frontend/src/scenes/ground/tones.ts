import { CircleCheck, CircleHelp, CircleX, Contrast, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Tone as ChipTone } from '../../design/ui';
import type { Tone } from '../../lib/ledger';

/** A glyph for each tone, so that what a status means never depends on its colour. */
export const TONE_ICON: Record<Tone, LucideIcon> = {
  good: CircleCheck,
  caution: Contrast,
  bad: CircleX,
  neutral: CircleHelp,
  info: Info,
};

/** The ledger's tones in the design system's. */
export const CHIP_TONE: Record<Tone, ChipTone> = {
  good: 'favor',
  caution: 'caution',
  bad: 'critical',
  neutral: 'neutral',
  info: 'accent',
};
