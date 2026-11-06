import type { FreeTierReason, UsageView } from '../../../shared/public';
import { FREE_TIER_WORDS } from './problems';

export type UsageState = { view: UsageView | null; failed: boolean };

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Whether an answer has the parts the meter reads: what funds a request, and how much of the free tier is left. */
export function isUsageView(value: unknown): value is UsageView {
  if (!isRecord(value) || (value.funding !== 'free' && value.funding !== 'byok')) return false;
  // On the person's own key the meter reads nothing of the free tier.
  if (value.funding === 'byok') return true;
  const { free } = value;
  if (!isRecord(free) || typeof free.available !== 'boolean') return false;
  const today = free.today;
  const lifetime = free.lifetime;
  return (
    isRecord(today) &&
    isNumber(today.tokens) &&
    isNumber(today.tokenLimit) &&
    isNumber(today.runsLeft) &&
    isRecord(lifetime) &&
    isNumber(lifetime.tokens) &&
    isNumber(lifetime.limit)
  );
}

export interface UsageReading {
  state: 'free' | 'byok' | 'limit' | 'unknown';
  reason: FreeTierReason | null;
  /** The whole line: it is the chip's text, and what a screen reader says. */
  words: string;
  /** What a narrow bar shows beside the icon: the runs left, or nothing. */
  figure: string;
  tone: 'neutral' | 'accent' | 'caution';
}

/** What the person is told about their free runs, from what the server last said. Null while nothing is known yet. */
export function readUsage(usage: UsageState): UsageReading | null {
  const { view } = usage;
  if (!view) {
    return usage.failed
      ? {
          state: 'unknown',
          reason: null,
          words: 'Free runs: not available',
          figure: '',
          tone: 'caution',
        }
      : null;
  }
  if (view.funding === 'byok') {
    return { state: 'byok', reason: null, words: 'Using your own key', figure: '', tone: 'accent' };
  }
  const { free } = view;
  if (!free.available) {
    const reason = free.reason;
    return {
      state: 'limit',
      reason,
      words: reason ? FREE_TIER_WORDS[reason].short : 'Free tier not available right now',
      figure: '',
      tone: 'caution',
    };
  }
  const left = Math.max(0, Math.floor(free.today.runsLeft));
  return {
    state: 'free',
    reason: null,
    words:
      left === 0
        ? 'Less than one free run left today'
        : `${left} free ${left === 1 ? 'run' : 'runs'} left today`,
    figure: String(left),
    tone: left <= 1 ? 'caution' : 'neutral',
  };
}
