import type { BudgetState, BudgetView } from '../../../shared/budget';
import type { Tone } from '../design/ui';
import {
  BUDGET_STATE,
  budgetNotice,
  budgetRows,
  parseLimit,
  type BudgetRow,
  type BudgetTone,
} from '../lib/budget';

const TONES: Record<BudgetTone, Tone> = {
  neutral: 'neutral',
  good: 'favor',
  caution: 'caution',
  bad: 'critical',
};

/** The chip's tone for a budget state: colour with the state's own words beside it. */
export const stateTone = (state: BudgetState): Tone => TONES[BUDGET_STATE[state].tone];

/** The colour of the meter that fills as the budget is used. */
export function meterTone(state: BudgetState): 'favor' | 'caution' | 'critical' | 'neutral' {
  switch (state) {
    case 'warning':
      return 'caution';
    case 'exhausted':
      return 'critical';
    case 'ok':
      return 'favor';
    default:
      return 'neutral';
  }
}

/** What a measure's meter reads as, in the numbers a meter has: a limit it fills toward, or just what was used. */
export function meterReading(row: BudgetRow): { now: number; max: number } {
  return row.limit > 0
    ? { now: Math.min(row.used, row.limit), max: row.limit }
    : { now: row.used, max: Math.max(row.used, 1) };
}

export const grouped = (value: number): string => value.toLocaleString('en-GB');

/** The measure that is closest to its limit, which is the one the page speaks of. */
export function worstRow(view: BudgetView): BudgetRow | null {
  const limited = budgetRows(view).filter((row) => row.limit > 0);
  if (limited.length === 0) return null;
  return limited.reduce((worst, row) => ((row.share ?? 0) > (worst.share ?? 0) ? row : worst));
}

export interface GuardLine {
  tone: 'warning' | 'error';
  title: string;
  /** "model calls: 1 of 1": which measure, and how far. */
  where: string;
  /** What follows from it and what can be done, without the figures the line already shows. */
  body: string;
}

/** Inside the budget itself, "you can raise the limit in the model budget" is where the person already is. */
export function inBudget(body: string): string {
  return body.replace(/\s*You can raise the limit in the model budget\.$/u, '');
}

/** The line shown above a model-assisted project that is running low or out, or null when it is neither. */
export function guardLine(view: BudgetView): GuardLine | null {
  const notice = budgetNotice(view);
  if (!notice) return null;
  const worst = worstRow(view);
  const where = worst ? `${worst.label.split(',')[0]!.toLowerCase()}: ${worst.text}` : '';
  const prefix = `${where}. `;
  return {
    tone: notice.tone,
    title: notice.title,
    where,
    body: where && notice.body.startsWith(prefix) ? notice.body.slice(prefix.length) : notice.body,
  };
}

/** How a limit is set: left to the deployment, set to a number, or lifted. */
export type LimitMode = 'default' | 'custom' | 'none';

export interface LimitDraft {
  mode: LimitMode;
  /** The number typed, used only in `custom`. */
  text: string;
}

/** The editor's starting point for what the project already has: null is the default, 0 is none. */
export function draftOf(own: number | null): LimitDraft {
  if (own === null) return { mode: 'default', text: '' };
  if (own === 0) return { mode: 'none', text: '' };
  return { mode: 'custom', text: String(own) };
}

export type DraftValue = { ok: true; value: number | null } | { ok: false; message: string };

/** What a draft would save, or why it cannot be saved. A custom limit is a whole number from 1: lifting it is its own choice. */
export function draftValue(draft: LimitDraft): DraftValue {
  if (draft.mode === 'default') return { ok: true, value: null };
  if (draft.mode === 'none') return { ok: true, value: 0 };
  const parsed = parseLimit(draft.text);
  if (!parsed.ok) {
    return {
      ok: false,
      message: parsed.message.startsWith('Use at most') ? parsed.message : 'Use a whole number.',
    };
  }
  if (parsed.value === null) return { ok: false, message: 'Enter a whole number.' };
  if (parsed.value === 0) return { ok: false, message: 'Choose No limit to lift the limit.' };
  return { ok: true, value: parsed.value };
}

/** Whether the draft differs from what the project has, so that Save is offered when it would change something. */
export function isDirty(draft: LimitDraft, own: number | null): boolean {
  const value = draftValue(draft);
  return !value.ok || value.value !== own;
}

/** What the deployment sets for a project that sets nothing itself, in words. */
export function defaultText(limit: number): string {
  return limit > 0
    ? `The deployment’s default is ${grouped(limit)}.`
    : 'The deployment’s default is no limit.';
}
