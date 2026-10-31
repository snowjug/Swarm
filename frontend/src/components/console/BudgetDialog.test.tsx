import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BudgetView } from '../../../../shared/budget';
import type { BudgetState } from '../../hooks/useBudget';
import { visibleText } from '../../test/provider';
import { BudgetNotice, BudgetPanel } from './BudgetDialog';

const view = (patch: Partial<BudgetView> = {}): BudgetView => ({
  calls: 37,
  inputTokens: 90_000,
  outputTokens: 30_431,
  callLimit: 500,
  tokenLimit: 0,
  own: { callLimit: null, tokenLimit: null },
  defaults: { callLimit: 500, tokenLimit: 0 },
  state: 'ok',
  may: { edit: false },
  ...patch,
});

const state = (patch: Partial<BudgetState> = {}): BudgetState => ({
  budget: view(),
  loading: false,
  error: null,
  saving: false,
  saveError: null,
  saved: false,
  reload: () => undefined,
  save: async () => true,
  ...patch,
});

const panel = (patch: Partial<BudgetState> = {}) =>
  renderToStaticMarkup(<BudgetPanel state={state(patch)} />);

describe('the model budget panel', () => {
  it('says what has been used against each limit, as numbers, as words and as a labelled meter', () => {
    const html = panel();
    const text = visibleText(html);
    expect(text).toContain('Model calls');
    expect(text).toContain('37 of 500');
    expect(text).toContain('Within budget');
    expect(text).toContain('Tokens, input and output');
    expect(text).toContain('120,431, no limit');
    expect(text).toContain('No limit');
    expect(text).toContain('The deployment’s default');
    // A meter that a screen reader can read: a name, a range, a value and its words.
    expect(html).toMatch(/role="meter"[^>]*aria-label="Model calls"/u);
    expect(html).toContain('aria-valuemax="500"');
    expect(html).toContain('aria-valuenow="37"');
    expect(html).toContain('aria-valuetext="37 of 500"');
    expect(html).toContain('aria-valuetext="120,431, no limit"');
  });

  it('shows no more than a full meter however far the limit is passed', () => {
    const html = panel({ budget: view({ calls: 700, state: 'exhausted' }) });
    expect(html).toContain('width:100%');
    expect(html).toContain('aria-valuenow="500"');
    expect(visibleText(html)).toContain('700 of 500');
    expect(visibleText(html)).toContain('Used up');
  });

  it('warns that the project is running low, and that it has used up its budget, in words', () => {
    const low = visibleText(panel({ budget: view({ calls: 420, state: 'warning' }) }));
    expect(low).toContain('This project is running low on its model budget');
    expect(low).toContain('Running low');
    const out = visibleText(panel({ budget: view({ calls: 500, state: 'exhausted' }) }));
    expect(out).toContain('This project has used its model budget');
    expect(out).toContain('Reading, editing and exporting are not affected');
  });

  it('says nothing alarming while there is plenty left', () => {
    expect(visibleText(panel())).not.toContain('running low');
    expect(visibleText(panel())).not.toContain('has used its model budget');
  });

  it('offers the form only to someone who may change the limits, with the defaults in its fields', () => {
    const viewer = panel({ budget: view({ may: { edit: false } }) });
    expect(viewer).not.toContain('<form');
    expect(visibleText(viewer)).toContain('A workspace owner or administrator sets these limits');

    const owner = panel({ budget: view({ may: { edit: true } }) });
    expect(owner).toContain('<form');
    const text = visibleText(owner);
    expect(text).toContain('Model call limit');
    expect(text).toContain('Token limit (input and output together)');
    expect(text).toContain('Save the limits');
    expect(owner).toContain('placeholder="The deployment default, 500"');
    expect(owner).toContain('placeholder="The deployment default, no limit"');
    // Each field has a label of its own.
    expect(owner).toMatch(/<label for="([^"]+)-calls">/u);
    expect(owner).toMatch(/<label for="([^"]+)-tokens">/u);
  });

  it('shows the project’s own limits in the fields, and lifted ones as 0', () => {
    const html = panel({
      budget: view({
        callLimit: 200,
        tokenLimit: 0,
        own: { callLimit: 200, tokenLimit: 0 },
        may: { edit: true },
      }),
    });
    expect(html).toMatch(/id="[^"]+-calls"[^>]*value="200"/u);
    expect(html).toMatch(/id="[^"]+-tokens"[^>]*value="0"/u);
    expect(visibleText(html)).toContain('Set for this project');
    expect(visibleText(html)).toContain('Lifted for this project');
  });

  it('says that a change was saved, and why one was not', () => {
    const edit = view({ may: { edit: true } });
    expect(visibleText(panel({ budget: edit, saved: true }))).toContain('The limits were saved');
    const failed = panel({ budget: edit, saveError: 'You may not change this.' });
    expect(visibleText(failed)).toContain('The limits were not saved');
    expect(visibleText(failed)).toContain('You may not change this.');
    expect(visibleText(failed)).not.toContain('The limits were saved');
  });

  it('disables the form while a change is being saved, so that it is not sent twice', () => {
    const html = panel({ budget: view({ may: { edit: true } }), saving: true });
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/u,
    );
    expect(html.match(/<input[^>]*disabled=""/gu)).toHaveLength(2);
    expect(visibleText(html)).toContain('Saving the limits');
  });

  it('says that it is reading, that it could not, and how to try again', () => {
    expect(visibleText(panel({ budget: null, loading: true }))).toContain(
      'Reading the model budget',
    );
    const failed = panel({ budget: null, error: 'The server returned an unreadable response.' });
    expect(visibleText(failed)).toContain('The model budget could not be read');
    expect(visibleText(failed)).toContain('The server returned an unreadable response.');
    expect(failed).toContain('Retry');
    // A budget already shown is kept when a later reading fails, rather than replaced by an error.
    expect(visibleText(panel({ error: 'The server returned an unreadable response.' }))).toContain(
      '37 of 500',
    );
  });
});

describe('the notice above a project', () => {
  const render = (budget: BudgetView | null) =>
    renderToStaticMarkup(<BudgetNotice budget={budget} onOpen={() => undefined} />);

  it('is nothing until the budget is running low', () => {
    expect(render(null)).toBe('');
    expect(render(view({ state: 'none' }))).toBe('');
    expect(render(view({ state: 'ok' }))).toBe('');
  });

  it('is a warning, then an error, each with the way to the details', () => {
    const low = render(view({ calls: 420, state: 'warning' }));
    expect(low).toContain('notice-warning');
    expect(visibleText(low)).toContain('Model budget');
    const out = render(view({ calls: 500, state: 'exhausted' }));
    expect(out).toContain('notice-error');
    expect(out).toContain('role="alert"');
    expect(visibleText(out)).toContain('This project has used its model budget');
  });
});
