import { describe, expect, it } from 'vitest';
import { BUDGET_WARNING_AT, MAX_BUDGET_LIMIT, type BudgetView } from '../../../shared/budget';
import {
  BUDGET_STATE,
  budgetNotice,
  budgetButtonLabel,
  budgetRows,
  budgetSummary,
  limitFieldText,
  parseLimit,
} from './budget';

const view = (patch: Partial<BudgetView> = {}): BudgetView => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  callLimit: 0,
  tokenLimit: 0,
  own: { callLimit: null, tokenLimit: null },
  defaults: { callLimit: 0, tokenLimit: 0 },
  state: 'none',
  may: { edit: false },
  ...patch,
});

describe('the rows of a budget', () => {
  it('say what has been used against each limit, and that there is none where there is none', () => {
    const [calls, tokens] = budgetRows(
      view({ calls: 37, callLimit: 500, inputTokens: 90_000, outputTokens: 30_431, state: 'ok' }),
    );
    expect(calls).toMatchObject({
      id: 'calls',
      label: 'Model calls',
      used: 37,
      limit: 500,
      text: '37 of 500',
      state: 'ok',
    });
    expect(calls!.share).toBeCloseTo(0.074);
    expect(tokens).toMatchObject({ id: 'tokens', used: 120_431, limit: 0, share: null });
    expect(tokens!.text).toBe('120,431, no limit');
    expect(tokens!.state).toBe('none');
  });

  it('turn to a warning at four fifths of a limit and to used up at the limit, as the server does', () => {
    const at = (used: number) => budgetRows(view({ calls: used, callLimit: 100 }))[0]!.state;
    expect(BUDGET_WARNING_AT).toBe(0.8);
    expect(at(79)).toBe('ok');
    expect(at(80)).toBe('warning');
    expect(at(99)).toBe('warning');
    expect(at(100)).toBe('exhausted');
    expect(at(140)).toBe('exhausted');
    // A meter never shows more than full.
    expect(budgetRows(view({ calls: 140, callLimit: 100 }))[0]!.share).toBe(1);
  });

  it('say where each limit comes from', () => {
    const source = (own: number | null, limit: number) =>
      budgetRows(view({ callLimit: limit, own: { callLimit: own, tokenLimit: null } }))[0]!.source;
    expect(source(200, 200)).toBe('Set for this project');
    expect(source(0, 0)).toBe('Lifted for this project');
    expect(source(null, 500)).toBe('The deployment’s default');
    expect(source(null, 0)).toBe('No limit is set');
  });
});

describe('what a person is told about a budget', () => {
  it('is nothing when there is no limit or plenty left', () => {
    expect(budgetNotice(view({ state: 'none' }))).toBeNull();
    expect(budgetNotice(view({ state: 'ok', calls: 5, callLimit: 100 }))).toBeNull();
  });

  it('is a warning when it is running low, naming the measure that is nearest its limit', () => {
    const notice = budgetNotice(
      view({
        state: 'warning',
        calls: 10,
        callLimit: 100,
        inputTokens: 900,
        tokenLimit: 1_000,
      }),
    )!;
    expect(notice.tone).toBe('warning');
    expect(notice.title).toBe('This project is running low on its model budget');
    expect(notice.body).toContain('tokens: 900 of 1,000');
    expect(notice.body).not.toContain('model calls: 10 of 100');
  });

  it('is an error when it is used up, saying what stops and what does not', () => {
    const notice = budgetNotice(view({ state: 'exhausted', calls: 100, callLimit: 100 }))!;
    expect(notice.tone).toBe('error');
    expect(notice.title).toBe('This project has used its model budget');
    expect(notice.body).toContain('model calls: 100 of 100');
    for (const stopped of [
      'runs',
      'answers from the analyst',
      'interviews',
      'rewriting a chapter',
    ]) {
      expect(notice.body).toContain(stopped);
    }
    expect(notice.body).toContain('Reading, editing and exporting are not affected');
  });

  it('tells a person who may raise the limit that they can, and anyone else who can', () => {
    const used = { state: 'exhausted' as const, calls: 5, callLimit: 5 };
    expect(budgetNotice(view({ ...used, may: { edit: true } }))!.body).toContain(
      'You can raise the limit in the model budget.',
    );
    expect(budgetNotice(view({ ...used, may: { edit: false } }))!.body).toContain(
      'A workspace owner or administrator can raise the limit.',
    );
  });

  it('is summed up in a line for a place with little room', () => {
    expect(budgetSummary(view())).toBe('No model budget limit');
    expect(budgetSummary(view({ state: 'warning', calls: 85, callLimit: 100 }))).toBe(
      'Running low: model calls 85 of 100',
    );
    expect(BUDGET_STATE.exhausted).toEqual({ label: 'Used up', tone: 'bad' });
  });

  it('puts the state on the toolbar button only when there is a state to put', () => {
    expect(budgetButtonLabel(null)).toBe('Model budget');
    expect(budgetButtonLabel(view())).toBe('Model budget');
    expect(budgetButtonLabel(view({ state: 'ok', calls: 1, callLimit: 100 }))).toBe(
      'Model budget · within budget',
    );
    expect(budgetButtonLabel(view({ state: 'exhausted' }))).toBe('Model budget · used up');
  });
});

describe('a limit as it is typed', () => {
  it('is empty for the deployment’s default, 0 for no limit, and otherwise a whole number', () => {
    expect(parseLimit('')).toEqual({ ok: true, value: null });
    expect(parseLimit('   ')).toEqual({ ok: true, value: null });
    expect(parseLimit('0')).toEqual({ ok: true, value: 0 });
    expect(parseLimit('500')).toEqual({ ok: true, value: 500 });
    expect(parseLimit(' 2,000,000 ')).toEqual({ ok: true, value: 2_000_000 });
    expect(parseLimit('2 000')).toEqual({ ok: true, value: 2_000 });
    expect(parseLimit(String(MAX_BUDGET_LIMIT))).toEqual({ ok: true, value: MAX_BUDGET_LIMIT });
  });

  it('is refused, with a reason, when it is not a whole number or is too large', () => {
    for (const bad of ['-1', '1.5', '1e3', 'lots', '12 apples', '0x10', '+5']) {
      const result = parseLimit(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.message).toContain('whole number');
    }
    const tooLarge = parseLimit(String(MAX_BUDGET_LIMIT + 1));
    expect(tooLarge).toEqual({ ok: false, message: 'Use at most 1,000,000,000.' });
  });

  it('is shown in its field as it is stored: empty for the default', () => {
    expect(limitFieldText(null)).toBe('');
    expect(limitFieldText(0)).toBe('0');
    expect(limitFieldText(750)).toBe('750');
  });
});
