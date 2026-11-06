// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FreeTierReason, UsageView } from '../../../shared/public';
import { renderWithApp, screen, within } from '../test/dom';
import { count } from '../lib/format';
import { formatLocal } from './format';
import { FREE_TIER_WORDS } from './problems';
import { usageView } from './test/fixtures';
import { UsageMeter } from './UsageMeter';
import { isUsageView, type UsageState } from './usageView';

const REASONS: FreeTierReason[] = [
  'user-cap',
  'global-cap',
  'lifetime-cap',
  'disabled',
  'concurrent',
];

// The meter in the top bar, in every state it has: the text it shows, what it opens to, and the one thing it offers.

function meter(usage: UsageState, options: { byokEnabled?: boolean; limitTestId?: boolean } = {}) {
  const onManageKey = vi.fn();
  const onRecheck = vi.fn();
  const rendered = renderWithApp(
    <UsageMeter
      usage={usage}
      byokEnabled={options.byokEnabled ?? true}
      limitTestId={options.limitTestId ?? true}
      onManageKey={onManageKey}
      onRecheck={onRecheck}
    />,
  );
  const chip = () => screen.getByTestId('usage-meter');
  const open = async () => {
    await rendered.user.click(chip());
    return screen.findByRole('dialog', { name: 'Free runs' });
  };
  return { ...rendered, onManageKey, onRecheck, chip, open };
}

const ready = (view = usageView()): UsageState => ({ view, failed: false });

describe('free runs left', () => {
  it('says how many are left today, in the bar', () => {
    const { chip } = meter(ready());
    expect(chip().textContent).toBe('3 free runs left today');
    expect(chip().getAttribute('data-usage')).toBe('free');
    expect(chip().getAttribute('data-tone')).toBe('neutral');
    expect(chip().getAttribute('data-reason')).toBeNull();
  });

  it('counts one in the singular, and says less than one rather than none while the free tier still answers', () => {
    const one = meter(
      ready(usageView({ free: { today: { ...usageView().free.today, runsLeft: 1 } } })),
    );
    expect(one.chip().textContent).toBe('1 free run left today');
    expect(one.chip().getAttribute('data-tone')).toBe('caution');
    one.unmount();
    const none = meter(
      ready(usageView({ free: { today: { ...usageView().free.today, runsLeft: 0 } } })),
    );
    expect(none.chip().textContent).toBe('Less than one free run left today');
  });

  it('opens to the tokens used of the limit, when they come back in the person’s time, and the lifetime allowance', async () => {
    const { open } = meter(ready());
    const popover = await open();
    expect(within(popover).getByRole('heading', { name: '3 free runs left today' })).toBeTruthy();
    expect(
      within(popover).getByText(`${count(12_000)} of ${count(60_000)} tokens`, { selector: 'dd' }),
    ).toBeTruthy();
    const gauge = within(popover).getByRole('meter', { name: 'Tokens used today' });
    expect(gauge.getAttribute('aria-valuenow')).toBe('12000');
    expect(gauge.getAttribute('aria-valuemax')).toBe('60000');
    expect(within(popover).getByText(`${count(5)} of ${count(40)}`)).toBeTruthy();
    const resets = popover.querySelector('time')!;
    expect(resets.getAttribute('datetime')).toBe('2026-11-07T00:00:00.000Z');
    expect(resets.textContent).toBe(formatLocal('2026-11-07T00:00:00.000Z'));
    expect(within(popover).getByText('in your local time')).toBeTruthy();
    expect(
      within(popover).getByText(`${count(45_000)} of ${count(300_000)} tokens used`),
    ).toBeTruthy();
    expect(within(popover).getByText(/a run is taken to be about 15,?000 tokens/u)).toBeTruthy();
  });

  it('shows the time in the zone of the person, whatever the zone of the server', () => {
    expect(formatLocal('2026-11-07T00:00:00.000Z', 'America/New_York')).toMatch(/6.*(7:00|19:00)/u);
    expect(formatLocal('2026-11-07T00:00:00.000Z', 'Asia/Kolkata')).toMatch(/7.*(5:30|05:30)/u);
    expect(formatLocal('not a time')).toBe('an unknown time');
  });

  it('offers, quietly, to use their own key to go past the free limit, and opens the panel for it', async () => {
    const { open, onManageKey, user } = meter(ready());
    const popover = await open();
    const link = within(popover).getByTestId('usage-upgrade');
    expect(link.textContent).toBe('Use your own Google key to go past the free limit');
    await user.click(link);
    expect(onManageKey).toHaveBeenCalledTimes(1);
  });

  it('does not offer it where bringing a key is switched off', async () => {
    const { open } = meter(ready(), { byokEnabled: false });
    const popover = await open();
    expect(within(popover).queryByTestId('usage-upgrade')).toBeNull();
  });
});

describe('the person’s own key', () => {
  const byok = usageView({
    funding: 'byok',
    byok: { enabled: true, today: { calls: 4, tokens: 8_200 } },
  });

  it('says so, instead of a count of runs', () => {
    const { chip } = meter(ready(byok));
    expect(chip().textContent).toBe('Using your own key');
    expect(chip().getAttribute('data-usage')).toBe('byok');
  });

  it('opens to what was used on the key today, and the way to manage it', async () => {
    const { open, onManageKey, user } = meter(ready(byok));
    const popover = await open();
    expect(
      within(popover).getByText(/Runs use your own Google Gemini quota, not the free tier/u),
    ).toBeTruthy();
    expect(popover.textContent).toContain(
      `Today on your key: ${count(4)} calls, ${count(8_200)} tokens.`,
    );
    await user.click(within(popover).getByRole('button', { name: 'Manage key' }));
    expect(onManageKey).toHaveBeenCalledTimes(1);
  });
});

describe('when the free tier cannot be used', () => {
  it.each(REASONS)(
    'says why (%s), in the bar and in the words of the design, with one next step',
    async (reason) => {
      const view = usageView({ free: { available: false, reason } });
      const { chip, open, onManageKey, onRecheck, user } = meter(ready(view));
      const words = FREE_TIER_WORDS[reason];
      expect(chip().textContent).toBe(words.short);
      expect(chip().getAttribute('data-usage')).toBe('limit');
      expect(chip().getAttribute('data-reason')).toBe(reason);

      const popover = await open();
      const block = within(popover).getByTestId('limit-reached');
      expect(block.getAttribute('data-reason')).toBe(reason);
      expect(within(block).getByText(words.message)).toBeTruthy();
      const actions = within(block).getAllByRole('button');
      expect(actions).toHaveLength(1);
      expect(within(popover).getByText('Resets')).toBeTruthy();
      await user.click(actions[0]!);
      if (reason === 'concurrent') {
        expect(actions[0]!.textContent).toBe('Check again');
        expect(onRecheck).toHaveBeenCalledTimes(1);
        expect(onManageKey).not.toHaveBeenCalled();
      } else {
        expect(actions[0]!.textContent).toBe('Use your own key');
        expect(onManageKey).toHaveBeenCalledTimes(1);
        expect(onRecheck).not.toHaveBeenCalled();
      }
    },
  );

  it('does not carry the test id of the limit state when a card with it is already on the screen', async () => {
    const view = usageView({ free: { available: false, reason: 'user-cap' } });
    const { open } = meter(ready(view), { limitTestId: false });
    const popover = await open();
    expect(within(popover).queryByTestId('limit-reached')).toBeNull();
    expect(within(popover).getByText(FREE_TIER_WORDS['user-cap'].message)).toBeTruthy();
  });

  it('offers no way on that is switched off, and says to try again later', async () => {
    const view = usageView({ free: { available: false, reason: 'global-cap' } });
    const { open } = meter(ready(view), { byokEnabled: false });
    const popover = await open();
    expect(within(popover).queryByRole('button')).toBeNull();
    expect(
      within(popover).getByText('Using your own key is switched off too. Try again later.'),
    ).toBeTruthy();
  });
});

describe('when nothing is known', () => {
  it('shows nothing while the first answer is on its way', () => {
    meter({ view: null, failed: false });
    expect(screen.queryByTestId('usage-meter')).toBeNull();
  });

  it('says it could not read the free runs, and offers to try again', async () => {
    const { chip, open, onRecheck, user } = meter({ view: null, failed: true });
    expect(chip().textContent).toBe('Free runs: not available');
    expect(chip().getAttribute('data-usage')).toBe('unknown');
    const popover = await open();
    expect(
      within(popover).getByRole('heading', { name: 'We could not read your free runs' }),
    ).toBeTruthy();
    await user.click(within(popover).getByRole('button', { name: 'Try again' }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the last answer when a later reading fails', () => {
    const { chip } = meter({ view: usageView(), failed: true });
    expect(chip().textContent).toBe('3 free runs left today');
  });
});

describe('what counts as an answer', () => {
  it('needs the free tier’s figures only when the free tier is what funds the request', () => {
    expect(isUsageView(usageView())).toBe(true);
    expect(isUsageView({ funding: 'byok' })).toBe(true);
    expect(isUsageView({ funding: 'free' })).toBe(false);
    expect(isUsageView({ funding: 'other', free: usageView().free })).toBe(false);
    expect(isUsageView(null)).toBe(false);
    const broken = { ...usageView(), free: { ...usageView().free, today: { tokens: 'many' } } };
    expect(isUsageView(broken)).toBe(false);
  });

  it('shows the person’s own key even when the answer has none of the free tier’s figures', () => {
    const bare = { funding: 'byok', byok: { enabled: true, today: { calls: 0, tokens: 0 } } };
    expect(isUsageView(bare)).toBe(true);
    const { chip } = meter({ view: bare as UsageView, failed: false });
    expect(chip().textContent).toBe('Using your own key');
  });
});
