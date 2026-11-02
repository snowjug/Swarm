// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../../../shared/types';
import { renderWithApp, screen, waitFor, within } from '../../../test/dom';
import { deepFixture } from './fixture';
import DeepDive from './index';

// The sheet that branches a run lists the proxies whose values the branch changes, each in a row of its own. A row is the
// same row for as long as it is there: taking one away does not hand its boxes to the row that follows it.

async function openBranch() {
  const view = renderWithApp(<DeepDive />, {
    workspace: {
      project: deepFixture(),
      config: { capabilities: { whatIf: true } } as unknown as AppConfig,
      scene: 'simulate',
      view: 'deep',
    },
  });
  await view.user.click(screen.getByRole('tab', { name: /^Run\b/u }));
  await view.user.click(await screen.findByRole('button', { name: /^Branch from a round/u }));
  const sheet = await screen.findByRole('dialog', { name: 'Branch from a checkpoint' });
  return { ...view, sheet };
}

describe('the changes to proxies in a branch', () => {
  it('keeps the boxes of a row when the row before it is taken away, and moves the focus to the way to add one', async () => {
    const { user, sheet } = await openBranch();
    const add = () => within(sheet).getByRole('button', { name: /^Change (a|another) proxy$/u });
    await user.click(add());
    await user.click(add());
    const inclinations = () => within(sheet).getAllByRole('spinbutton', { name: 'Inclination' });
    expect(inclinations()).toHaveLength(2);

    // Something typed in the second row: that is the row that has to stay as it is.
    const second = inclinations()[1]!;
    await user.type(second, '0.4');
    expect((second as HTMLInputElement).value).toBe('0.4');
    const who = within(sheet).getAllByRole('combobox', { name: 'Proxy' });
    const secondProxy = (who[1] as HTMLSelectElement).value;

    await user.click(within(sheet).getAllByRole('button', { name: /^Remove the change to/u })[0]!);

    await waitFor(() => expect(inclinations()).toHaveLength(1));
    expect(inclinations()[0]).toBe(second);
    expect((inclinations()[0] as HTMLInputElement).value).toBe('0.4');
    expect(
      (within(sheet).getByRole('combobox', { name: 'Proxy' }) as HTMLSelectElement).value,
    ).toBe(secondProxy);
    await waitFor(() => expect(document.activeElement).toBe(add()));
  });

  it('keeps the focus on the choice of proxy while another proxy is chosen for the row', async () => {
    const { user, sheet } = await openBranch();
    await user.click(within(sheet).getByRole('button', { name: 'Change a proxy' }));
    const who = within(sheet).getByRole('combobox', { name: 'Proxy' }) as HTMLSelectElement;
    who.focus();
    const other = [...who.options].find(
      (option) => option.value !== who.value && !option.disabled,
    )!;
    await user.selectOptions(who, other.value);
    expect(who.value).toBe(other.value);
    expect(within(sheet).getByRole('combobox', { name: 'Proxy' })).toBe(who);
    expect(document.activeElement).toBe(who);
  });
});
