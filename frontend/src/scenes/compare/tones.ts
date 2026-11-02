import type { Tone as LedgerTone } from '../../lib/ledger';
import type { Tone } from '../../design/ui';

/** How the engine's tones map to the design's: the same meaning, the system's own names. */
export const CHIP_TONE: Record<LedgerTone, Tone> = {
  good: 'favor',
  info: 'accent',
  caution: 'caution',
  bad: 'critical',
  neutral: 'neutral',
};
