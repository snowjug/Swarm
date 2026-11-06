// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, screen, waitFor, within } from '../test/dom';
import { AccountPanel } from './AccountPanel';
import { browser } from './browser';
import { clearByok, holdsByokKey, setByokKey } from './byokStore';
import { formatDay } from './format';
import { setPublicEdition } from './runtime';
import { takeNote } from './tabState';
import { accountView, signedInSession, TEST_KEY } from './test/fixtures';
import { failure, fakeServer, noContent } from './test/server';

// The account panel: who is signed in and what they have used, signing out, and deleting the account for good.

beforeEach(() => setPublicEdition(true));

afterEach(() => {
  setPublicEdition(false);
  clearByok();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function openPanel(
  options: {
    session?: ReturnType<typeof signedInSession>;
    view?: ReturnType<typeof accountView>;
  } = {},
) {
  const server = fakeServer({ 'GET /api/account': options.view ?? accountView() });
  const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
  const rendered = renderWithApp(
    <AccountPanel
      open
      onOpenChange={() => undefined}
      session={options.session ?? signedInSession()}
    />,
  );
  await screen.findByRole('dialog', { name: 'Your account' });
  return { ...rendered, server, assign };
}

describe('what the account panel shows', () => {
  it('shows the e-mail address masked, how they signed in, when the account was made, and how much room is used', async () => {
    await openPanel();
    const panel = screen.getByTestId('account-panel');
    expect(await within(panel).findByTestId('account-email')).toBeTruthy();
    expect(screen.getByTestId('account-email').textContent).toBe('a***@example.com');
    expect(screen.getByTestId('account-provider').textContent).toBe('Google');
    expect(within(panel).getByText(formatDay('2026-11-01T09:00:00.000Z'))).toBeTruthy();
    expect(within(screen.getByTestId('account-projects')).getByText(/2 of 10/u)).toBeTruthy();
    expect(
      within(screen.getByTestId('account-projects'))
        .getByRole('meter')
        .getAttribute('aria-valuenow'),
    ).toBe('0.2');
    expect(within(screen.getByTestId('account-storage')).getByText('1.4 MB of 20 MB')).toBeTruthy();
  });

  it('links to the texts, the FAQ and the status in a new tab, so that nothing open is left', async () => {
    await openPanel();
    const links = within(screen.getByRole('navigation', { name: 'About this site' })).getAllByRole(
      'link',
    );
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Terms', '/legal/terms'],
      ['Privacy', '/legal/privacy'],
      ['FAQ', '/faq'],
      ['Status', '/status'],
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('links to the usage page for an administrator, and for no one else', async () => {
    const plain = await openPanel();
    expect(screen.queryByRole('link', { name: /Usage and switches/u })).toBeNull();
    plain.unmount();

    await openPanel({
      session: signedInSession({}, { isAdmin: true }),
      view: accountView({ isAdmin: true }),
    });
    expect(
      (await screen.findByRole('link', { name: /Usage and switches/u })).getAttribute('href'),
    ).toBe('/admin');
  });

  it('says when the account could not be read, and reads it again on request', async () => {
    const server = fakeServer({ 'GET /api/account': failure(500, 'INTERNAL', 'Something broke.') });
    const { user } = renderWithApp(
      <AccountPanel open onOpenChange={() => undefined} session={signedInSession()} />,
    );
    expect(await screen.findByText('Your account could not be read')).toBeTruthy();
    expect(screen.getByText(/Something broke\./u)).toBeTruthy();
    server.set('GET /api/account', accountView());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('account-email')).toBeTruthy();
    expect(server.to('GET /api/account')).toHaveLength(2);
  });
});

describe('signing out', () => {
  it('ends the session, forgets everything the tab held with the key first, and goes back to the landing page', async () => {
    const { server, assign, user } = await openPanel();
    let keyHeldWhenSent: boolean | null = null;
    server.set('POST /auth/logout', () => {
      keyHeldWhenSent = holdsByokKey();
      return noContent();
    });
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    window.sessionStorage.setItem('swarm.something', 'cached');
    await user.click(screen.getByTestId('account-signout'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));

    const [call] = server.to('POST /auth/logout');
    expect(call!.headers['x-swarm-csrf']).toBe('1');
    expect(call!.headers['x-swarm-provider-key']).toBeUndefined();
    expect(keyHeldWhenSent).toBe(false);
    expect(holdsByokKey()).toBe(false);
    // Everything of the tab is gone, but for the one line that the landing page reads once.
    expect(window.sessionStorage.getItem('swarm.something')).toBeNull();
    expect(window.sessionStorage.getItem('swarm.byok.key')).toBeNull();
    expect(takeNote()).toBe('signed-out');
  });

  it('says so, and stays where it is, when the server does not confirm it', async () => {
    const { server, assign, user } = await openPanel();
    server.set('POST /auth/logout', failure(500, 'INTERNAL', 'Could not.'));
    await user.click(screen.getByTestId('account-signout'));
    expect(await screen.findByText('That was not done')).toBeTruthy();
    expect(screen.getByText(/Could not\./u)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect((screen.getByTestId('account-signout') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('deleting the account', () => {
  async function toTheQuestion() {
    const opened = await openPanel();
    await opened.user.click(screen.getByTestId('account-delete'));
    await screen.findByRole('dialog', { name: 'Delete your account?' });
    return opened;
  }

  it('says what is deleted and what is kept, exactly, before it asks for anything', async () => {
    await toTheQuestion();
    const panel = screen.getByTestId('account-panel');
    expect(within(panel).getByText(/Deleting your account removes, for good/u)).toBeTruthy();
    expect(within(panel).getByText(/every exploration of yours/u)).toBeTruthy();
    expect(within(panel).getByText(/your private workspace and your account/u)).toBeTruthy();
    expect(within(panel).getByText(/your sign-in sessions, on every device/u)).toBeTruthy();
    expect(within(panel).getByText('Two things are kept:')).toBeTruthy();
    expect(
      within(panel).getByText(/The audit log\. It can only be added to, never edited\./u),
    ).toBeTruthy();
    expect(within(panel).getByText(/opaque ids, action words and counts/u)).toBeTruthy();
    expect(within(panel).getByText(/A keyed counter, for 30 days\./u)).toBeTruthy();
    expect(
      within(panel).getByText(
        /so that deleting and signing up again cannot reset the free allowance/u,
      ),
    ).toBeTruthy();
  });

  it('says the number of days the site keeps the counter for, and nothing of a counter when it keeps none', async () => {
    const { user } = await openPanel({ session: signedInSession({ retentionDays: 7 }) });
    await user.click(screen.getByTestId('account-delete'));
    await screen.findByRole('dialog', { name: 'Delete your account?' });
    expect(
      within(screen.getByTestId('account-panel')).getByText(/A keyed counter, for 7 days\./u),
    ).toBeTruthy();
  });

  it('keeps nothing but the audit log when the site is set to keep no counter, and says so', async () => {
    const { user } = await openPanel({ session: signedInSession({ retentionDays: 0 }) });
    await user.click(screen.getByTestId('account-delete'));
    await screen.findByRole('dialog', { name: 'Delete your account?' });
    const panel = screen.getByTestId('account-panel');
    expect(within(panel).getByText('One thing is kept:')).toBeTruthy();
    expect(within(panel).queryByText(/keyed counter/u)).toBeNull();
    expect(within(panel).getByText(/The audit log\./u)).toBeTruthy();
  });

  it('does not delete until the exact phrase is typed: not a capital, not a space, not a word more', async () => {
    const { user, server } = await toTheQuestion();
    const confirm = () => screen.getByTestId('account-delete-confirm') as HTMLButtonElement;
    const field = screen.getByTestId('account-delete-confirm-input');
    expect(confirm().textContent).toBe('Delete my account and all my data');
    expect(confirm().disabled).toBe(true);
    for (const wrong of [
      'delete my',
      'Delete my account',
      'delete my account ',
      'delete my accounts',
      ' delete my account',
    ]) {
      await user.clear(field);
      await user.click(field);
      await user.paste(wrong);
      expect(confirm().disabled, JSON.stringify(wrong)).toBe(true);
    }
    await user.clear(field);
    await user.click(field);
    await user.paste('delete my account');
    expect(confirm().disabled).toBe(false);
    expect(server.to('DELETE /api/account')).toEqual([]);
  });

  it('deletes with the phrase and the change header, clears the key and everything cached, and returns with a line about it', async () => {
    const { user, server, assign } = await toTheQuestion();
    server.set('DELETE /api/account', noContent());
    setByokKey(TEST_KEY, 'gemini-2.5-flash');
    window.sessionStorage.setItem('swarm.something', 'cached');
    await user.click(screen.getByTestId('account-delete-confirm-input'));
    await user.paste('delete my account');
    await user.click(screen.getByTestId('account-delete-confirm'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));

    const [call] = server.to('DELETE /api/account');
    expect(call).toMatchObject({ method: 'DELETE', body: { confirm: 'delete my account' } });
    expect(call!.headers['x-swarm-csrf']).toBe('1');
    expect(holdsByokKey()).toBe(false);
    expect(window.sessionStorage.getItem('swarm.something')).toBeNull();
    expect(takeNote()).toBe('deleted');
  });

  it('goes back to the account when the person changes their mind, and asks again from the start', async () => {
    const { user } = await toTheQuestion();
    await user.click(screen.getByTestId('account-delete-confirm-input'));
    await user.paste('delete my account');
    await user.click(screen.getByRole('button', { name: 'Keep my account' }));
    expect(await screen.findByRole('dialog', { name: 'Your account' })).toBeTruthy();
    await user.click(screen.getByTestId('account-delete'));
    expect((screen.getByTestId('account-delete-confirm-input') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('account-delete-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so, and keeps everything, when the server does not delete', async () => {
    const { user, server, assign } = await toTheQuestion();
    server.set('DELETE /api/account', failure(500, 'INTERNAL', 'Not now.'));
    setByokKey(TEST_KEY, null);
    await user.click(screen.getByTestId('account-delete-confirm-input'));
    await user.paste('delete my account');
    await user.click(screen.getByTestId('account-delete-confirm'));
    expect(await screen.findByText('That was not done')).toBeTruthy();
    expect(screen.getByText(/Not now\./u)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(holdsByokKey()).toBe(true);
    expect(takeNote()).toBeNull();
  });
});
