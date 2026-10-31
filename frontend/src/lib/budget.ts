import {
  BUDGET_WARNING_AT,
  MAX_BUDGET_LIMIT,
  type BudgetState,
  type BudgetView,
} from '../../../shared/budget';

export type BudgetTone = 'neutral' | 'good' | 'caution' | 'bad';

export const BUDGET_STATE: Readonly<Record<BudgetState, { label: string; tone: BudgetTone }>> = {
  none: { label: 'No limit', tone: 'neutral' },
  ok: { label: 'Within budget', tone: 'good' },
  warning: { label: 'Running low', tone: 'caution' },
  exhausted: { label: 'Used up', tone: 'bad' },
};

const grouped = (value: number): string => value.toLocaleString('en-GB');

export interface BudgetRow {
  id: 'calls' | 'tokens';
  label: string;
  used: number;
  /** 0 is no limit. */
  limit: number;
  /** How much of the limit is used, from 0 to 1. null when there is no limit to measure against. */
  share: number | null;
  state: BudgetState;
  /** "37 of 500", or "37, no limit". */
  text: string;
  /** Where the limit comes from. */
  source: string;
}

function stateOf(used: number, limit: number): BudgetState {
  if (limit <= 0) return 'none';
  const share = used / limit;
  return share >= 1 ? 'exhausted' : share >= BUDGET_WARNING_AT ? 'warning' : 'ok';
}

function sourceOf(own: number | null, limit: number): string {
  if (own === 0) return 'Lifted for this project';
  if (own !== null) return 'Set for this project';
  return limit > 0 ? 'The deployment’s default' : 'No limit is set';
}

/** The two measures a budget is kept in, each with what it has used and what it may. */
export function budgetRows(view: BudgetView): BudgetRow[] {
  const tokens = view.inputTokens + view.outputTokens;
  const row = (
    id: BudgetRow['id'],
    label: string,
    used: number,
    limit: number,
    own: number | null,
  ): BudgetRow => ({
    id,
    label,
    used,
    limit,
    share: limit > 0 ? Math.min(1, used / limit) : null,
    state: stateOf(used, limit),
    text: limit > 0 ? `${grouped(used)} of ${grouped(limit)}` : `${grouped(used)}, no limit`,
    source: sourceOf(own, limit),
  });
  return [
    row('calls', 'Model calls', view.calls, view.callLimit, view.own.callLimit),
    row('tokens', 'Tokens, input and output', tokens, view.tokenLimit, view.own.tokenLimit),
  ];
}

export interface BudgetNoticeView {
  tone: 'warning' | 'error';
  title: string;
  body: string;
}

/** What to tell a person looking at the project, when the budget is running low or is used up. */
export function budgetNotice(view: BudgetView): BudgetNoticeView | null {
  if (view.state !== 'warning' && view.state !== 'exhausted') return null;
  const worst = budgetRows(view)
    .filter((row) => row.limit > 0)
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0];
  const where = worst ? `${worst.label.split(',')[0]!.toLowerCase()}: ${worst.text}` : '';
  const raise = view.may.edit
    ? 'You can raise the limit in the model budget.'
    : 'A workspace owner or administrator can raise the limit.';
  if (view.state === 'exhausted') {
    return {
      tone: 'error',
      title: 'This project has used its model budget',
      body: `${where}. Anything that needs the model now stops with that message: runs, answers from the analyst or an actor, generated interviews and rewriting a chapter. Reading, editing and exporting are not affected. ${raise}`,
    };
  }
  return {
    tone: 'warning',
    title: 'This project is running low on its model budget',
    body: `${where}. When it is used up, anything that needs the model stops. ${raise}`,
  };
}

export type ParsedLimit = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * What a person typed into a limit field. Empty is "the deployment's default" (null); 0 is "no
 * limit". Thousands separators are allowed; anything else that is not a whole number is not.
 */
export function parseLimit(text: string): ParsedLimit {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  const digits = trimmed.replace(/[,\s]/gu, '');
  if (!/^\d+$/u.test(digits)) {
    return { ok: false, message: 'Use a whole number, 0 for no limit, or leave it empty.' };
  }
  const value = Number(digits);
  if (value > MAX_BUDGET_LIMIT) {
    return { ok: false, message: `Use at most ${grouped(MAX_BUDGET_LIMIT)}.` };
  }
  return { ok: true, value };
}

/** A limit as it is shown in its field: empty for "the deployment's default". */
export function limitFieldText(own: number | null): string {
  return own === null ? '' : String(own);
}

/** One line for a place with little room: the worse of the two measures, or that there is no limit. */
export function budgetSummary(view: BudgetView): string {
  if (view.state === 'none') return 'No model budget limit';
  const worst = budgetRows(view)
    .filter((row) => row.limit > 0)
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0]!;
  return `${BUDGET_STATE[view.state].label}: ${worst.label.split(',')[0]!.toLowerCase()} ${worst.text}`;
}

/** The toolbar button: just "Model budget" until there is something to say about it. */
export function budgetButtonLabel(view: BudgetView | null): string {
  return view && view.state !== 'none'
    ? `Model budget · ${BUDGET_STATE[view.state].label.toLowerCase()}`
    : 'Model budget';
}
