// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderWithApp, screen, waitFor, within } from '../test/dom';
import type { PublicSession } from '../../../shared/public';
import { browser } from './browser';
import { Landing } from './Landing';
import { NETWORK_WORDS } from './problems';
import { setPublicEdition } from './runtime';
import { guestSession, signedOutSession } from './test/fixtures';
import { failure, fakeServer, json } from './test/server';
import { setTurnstileLoader, type TurnstileApi, type TurnstileOptions } from './turnstile';

// The landing page and the way in: what a visitor is told, which sign-ins they are offered, and what a press on one of
// them sends. Nothing leaves the process: the server and the bot check are fakes, and the browser's address is watched.

const at = (address: string) => window.history.replaceState({}, '', address);

beforeEach(() => {
  setPublicEdition(true);
  at('/');
});

afterEach(() => {
  setPublicEdition(false);
  setTurnstileLoader(null);
  at('/');
  vi.unstubAllGlobals();
});

async function openSignIn(
  session = signedOutSession(),
  note = null as Parameters<typeof Landing>[0]['note'],
) {
  const rendered = renderWithApp(<Landing session={session} note={note} />);
  await rendered.user.click(screen.getByTestId('try-it-free'));
  const dialog = await screen.findByRole('dialog', { name: 'Sign in to Swarm' });
  return { ...rendered, dialog };
}

function fakeTurnstile() {
  const widgets: TurnstileOptions[] = [];
  const api: TurnstileApi = {
    render: vi.fn((_container: HTMLElement, options: TurnstileOptions) => {
      widgets.push(options);
      return `widget-${widgets.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  const loader = vi.fn(async () => api);
  setTurnstileLoader(loader);
  return {
    api,
    loader,
    widgets,
    solve: (token: string) => act(() => widgets.at(-1)!.callback(token)),
  };
}

describe('the landing page', () => {
  it('says in a few sentences what the product is, that it explores and does not predict, and where to read more', () => {
    renderWithApp(<Landing session={signedOutSession()} note={null} />);
    const page = screen.getByTestId('landing');
    expect(within(page).getByRole('heading', { level: 1 }).textContent).toBe(
      'Explore what could happen next.',
    );
    expect(
      within(page).getByText(/A what-if question asks what might follow a change/u),
    ).toBeTruthy();
    expect(
      within(page).getByText(
        'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
      ),
    ).toBeTruthy();
    expect(within(page).getByRole('heading', { name: 'Evidence in, scenarios out' })).toBeTruthy();
    expect(within(page).getByText(/Free with a small daily limit/u).textContent).toContain(
      'Use your own Google Gemini key',
    );
    // The FAQ is on the page, and the footer has the four links.
    expect(within(page).getByTestId('faq')).toBeTruthy();
    const footer = screen.getByRole('navigation', { name: 'About this site' });
    expect(
      within(footer)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Terms', '/legal/terms'],
      ['Privacy', '/legal/privacy'],
      ['FAQ', '/faq'],
      ['Status', '/status'],
    ]);
  });

  it('offers one way in, “Try it free”, and no sample to open before signing in, which needs the server', () => {
    renderWithApp(<Landing session={signedOutSession()} note={null} />);
    expect(screen.getByTestId('try-it-free').textContent).toBe('Try it free');
    expect(screen.queryByTestId('try-sample')).toBeNull();
    expect(
      screen.getByText(/After you sign in, you can open a ready-made sample that uses no model/u),
    ).toBeTruthy();
  });

  it('shows a line about why the visitor is here again, when there is one', () => {
    renderWithApp(<Landing session={signedOutSession()} note="deleted" />);
    const note = screen.getByTestId('landing-note');
    expect(note.getAttribute('data-kind')).toBe('deleted');
    expect(note.textContent).toBe('Your account and all your data were deleted.');
  });

  it('takes its footer links to the texts the server names, when they are paths on this site', () => {
    renderWithApp(
      <Landing
        session={signedOutSession({
          legal: { terms: '/legal/terms', privacy: '/our/privacy.html' },
        })}
        note={null}
      />,
    );
    const footer = screen.getByRole('navigation', { name: 'About this site' });
    expect(within(footer).getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
      '/our/privacy.html',
    );
  });
});

describe('the sign-in card', () => {
  it('has a button for each sign-in the server lists, and for no other', async () => {
    const { dialog, unmount } = await openSignIn(
      signedOutSession({ providers: [{ id: 'google', label: 'Google' }] }),
    );
    expect(within(dialog).getByTestId('signin-google').textContent).toBe('Continue with Google');
    expect(within(dialog).queryByTestId('signin-github')).toBeNull();
    unmount();

    const both = await openSignIn();
    expect(within(both.dialog).getByTestId('signin-google')).toBeTruthy();
    expect(within(both.dialog).getByTestId('signin-github').textContent).toBe(
      'Continue with GitHub',
    );
  });

  it('never decides for itself which exist: another provider is a button too, and none is a plain sentence', async () => {
    const other = await openSignIn(
      signedOutSession({
        providers: [{ id: 'microsoft' as never, label: 'Microsoft' }],
      }),
    );
    expect(within(other.dialog).getByTestId('signin-microsoft').textContent).toBe(
      'Continue with Microsoft',
    );
    other.unmount();

    const none = await openSignIn(signedOutSession({ providers: [] }));
    expect(within(none.dialog).getByText('Sign-in is not set up on this site yet.')).toBeTruthy();
    expect(within(none.dialog).queryByRole('button', { name: /Continue with/u })).toBeNull();
  });

  it('says what signing in means, and that two providers make two accounts, in the words the design gives', async () => {
    const { dialog } = await openSignIn();
    const accept = within(dialog).getByText(/By continuing you accept the/u);
    expect(accept.textContent).toBe('By continuing you accept the Terms and the Privacy notice.');
    expect(within(accept).getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe(
      '/legal/terms',
    );
    expect(within(accept).getByRole('link', { name: 'Privacy notice' }).getAttribute('href')).toBe(
      '/legal/privacy',
    );
    expect(
      within(dialog).getByText(
        'The same e-mail address through Google and through GitHub makes two separate accounts.',
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/New accounts are closed for now/u)).toBeNull();
  });

  it('says that new accounts are closed, and still lets people who have one sign in', async () => {
    const { dialog } = await openSignIn(signedOutSession({ signupsOpen: false }));
    expect(
      within(dialog).getByText(
        'New accounts are closed for now. People who already have an account can still sign in.',
      ),
    ).toBeTruthy();
    expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(false);
  });

  it('starts the sign-in with the header only this page sends, and goes to the address it is given', async () => {
    const server = fakeServer({
      'POST /auth/start/google': { url: 'https://accounts.example/authorize?state=abc' },
    });
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const { dialog, user } = await openSignIn();
    await user.click(within(dialog).getByTestId('signin-google'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://accounts.example/authorize?state=abc'),
    );
    expect(server.calls).toHaveLength(1);
    const [call] = server.calls;
    expect(call).toMatchObject({ method: 'POST', path: '/auth/start/google', body: {} });
    expect(call!.headers['x-swarm-csrf']).toBe('1');
    expect(call!.headers['content-type']).toBe('application/json');
    expect(call!.headers['x-swarm-provider-key']).toBeUndefined();
    // The browser is on its way: the button stays busy and nothing else can be pressed.
    expect((within(dialog).getByTestId('signin-github') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks to be brought back to the page the visitor was on, and not to a problem screen', async () => {
    const server = fakeServer({
      'POST /auth/start/github': { url: 'https://github.example/login' },
    });
    vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    at('/?project=p1&scene=map&signin=failed');
    const { dialog, user } = await openSignIn();
    await user.click(within(dialog).getByTestId('signin-github'));
    await waitFor(() => expect(server.calls).toHaveLength(1));
    expect(server.calls[0]!.body).toEqual({ returnTo: '/?project=p1&scene=map' });
  });

  it('is ready again when the browser brings the page back from the provider with the button still busy', async () => {
    fakeServer({ 'POST /auth/start/google': { url: 'https://accounts.example/a' } });
    vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const { dialog, user } = await openSignIn();
    await user.click(within(dialog).getByTestId('signin-google'));
    await waitFor(() =>
      expect((within(dialog).getByTestId('signin-github') as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await waitFor(() =>
      expect((within(dialog).getByTestId('signin-github') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not follow an answer that is not a web address, and lets the visitor try again', async () => {
    fakeServer({ 'POST /auth/start/google': { url: 'javascript:alert(1)' } });
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const { dialog, user } = await openSignIn();
    await user.click(within(dialog).getByTestId('signin-google'));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Sign-in could not start. Try again.',
    );
    expect(assign).not.toHaveBeenCalled();
    expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    [429, 'RATE_LIMITED', 'Too many sign-in attempts from here. Wait a minute, then try again.'],
    [403, 'BOT_CHECK_FAILED', 'We could not check that you are a person. Please try again.'],
    [404, 'NOT_FOUND', 'That way of signing in is not available.'],
    [500, 'INTERNAL', 'Sign-in could not start. Try again.'],
  ])('says what a %i answer (%s) means, in words', async (status, code, words) => {
    fakeServer({ 'POST /auth/start/google': failure(status, code, 'RAW SERVER MESSAGE') });
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const { dialog, user } = await openSignIn();
    await user.click(within(dialog).getByTestId('signin-google'));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain(words);
    expect(alert.textContent).not.toContain('RAW SERVER MESSAGE');
    expect(assign).not.toHaveBeenCalled();
  });

  it('says it cannot reach the service when there is no answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const { dialog, user } = await openSignIn();
    await user.click(within(dialog).getByTestId('signin-google'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(NETWORK_WORDS);
  });
});

describe('the bot check', () => {
  it('is not loaded, and no script is added to the page, unless the server asks for it', async () => {
    const turnstile = fakeTurnstile();
    const { dialog } = await openSignIn(signedOutSession({ bot: null }));
    expect(turnstile.loader).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
    expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(false);
  });

  it('is loaded once the sign-in card is open when the server asks for it, and sign-in waits for it', async () => {
    const turnstile = fakeTurnstile();
    const server = fakeServer({ 'POST /auth/start/google': { url: 'https://accounts.example/a' } });
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const session = signedOutSession({ bot: { kind: 'turnstile', siteKey: 'site-key-123' } });
    const rendered = renderWithApp(<Landing session={session} note={null} />);
    // Nothing is loaded for a visitor who only reads the page.
    expect(turnstile.loader).not.toHaveBeenCalled();

    await rendered.user.click(screen.getByTestId('try-it-free'));
    const dialog = await screen.findByRole('dialog', { name: 'Sign in to Swarm' });
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
    expect(turnstile.loader).toHaveBeenCalledTimes(1);
    expect(turnstile.widgets[0]).toMatchObject({ sitekey: 'site-key-123' });
    expect(within(dialog).getByText('Checking that you are a person…')).toBeTruthy();
    expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(true);

    await turnstile.solve('token-one');
    await waitFor(() =>
      expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await rendered.user.click(within(dialog).getByTestId('signin-google'));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(server.calls[0]!.body).toEqual({ turnstileToken: 'token-one' });
  });

  it('waits again when the token expires, and asks for a new one after a try that did not work', async () => {
    const turnstile = fakeTurnstile();
    fakeServer({ 'POST /auth/start/google': failure(403, 'BOT_CHECK_FAILED') });
    vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const { dialog, user } = await openSignIn(
      signedOutSession({ bot: { kind: 'turnstile', siteKey: 'site-key-123' } }),
    );
    await waitFor(() => expect(turnstile.widgets).toHaveLength(1));
    await turnstile.solve('token-one');
    await waitFor(() =>
      expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );

    act(() => turnstile.widgets[0]!['expired-callback']?.());
    await waitFor(() =>
      expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    await turnstile.solve('token-two');
    await waitFor(() =>
      expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );

    await user.click(within(dialog).getByTestId('signin-google'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'We could not check that you are a person.',
    );
    expect(turnstile.api.reset).toHaveBeenCalledWith('widget-1');
  });

  it('says so when the check cannot be loaded, and loads it again on request', async () => {
    const loader = vi
      .fn<() => Promise<TurnstileApi>>()
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValue({ render: vi.fn(() => 'w'), reset: vi.fn(), remove: vi.fn() });
    setTurnstileLoader(loader);
    const { dialog, user } = await openSignIn(
      signedOutSession({ bot: { kind: 'turnstile', siteKey: 'site-key-123' } }),
    );
    expect(
      await within(dialog).findByText('The check that you are a person did not load.'),
    ).toBeTruthy();
    expect((within(dialog).getByTestId('signin-google') as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });
});

describe('the landing page when visitors can start as guests', () => {
  const heroOf = () => screen.getByRole('region', { name: 'Explore what could happen next.' });
  const button = () => screen.getByTestId('try-it-now') as HTMLButtonElement;

  it('offers one prominent action, “Try it now”, and the note on temporary data, with nothing of signing in when no provider is set up', () => {
    renderWithApp(<Landing session={guestSession()} note={null} />);
    expect(
      within(heroOf())
        .getAllByRole('button')
        .map((found) => found.textContent),
    ).toEqual(['Try it now']);
    expect(screen.queryByTestId('try-it-free')).toBeNull();
    expect(screen.getByTestId('guest-note').textContent).toBe(
      'Guest data is temporary: it is deleted after 24 hours without use, and you can delete it yourself at any time.',
    );
    // No sign-in wall: no button, no provider, no card, and no word of it anywhere on the page (the FAQ included).
    expect(screen.queryByTestId('signin-secondary')).toBeNull();
    expect(screen.queryByRole('button', { name: /sign in/iu })).toBeNull();
    for (const part of [screen.getByRole('banner'), screen.getByTestId('landing')]) {
      expect(part.textContent).not.toMatch(/\bsign[ -]in\b/iu);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    // What the page is, the FAQ and the footer links are all still there.
    expect(screen.getByTestId('faq')).toBeTruthy();
    expect(
      within(screen.getByRole('navigation', { name: 'About this site' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Terms', 'Privacy', 'FAQ', 'Status']);
  });

  it('says the hours the server gives, in the singular for one, and 24 when it gives none', () => {
    const { unmount } = renderWithApp(
      <Landing session={guestSession({ guestRetentionHours: 6 })} note={null} />,
    );
    expect(screen.getByTestId('guest-note').textContent).toContain('after 6 hours without use');
    unmount();

    const one = renderWithApp(
      <Landing session={guestSession({ guestRetentionHours: 1 })} note={null} />,
    );
    expect(screen.getByTestId('guest-note').textContent).toContain('after 1 hour without use');
    one.unmount();

    const bare = guestSession() as Partial<PublicSession>;
    delete bare.guestRetentionHours;
    renderWithApp(<Landing session={bare as PublicSession} note={null} />);
    expect(screen.getByTestId('guest-note').textContent).toContain('after 24 hours without use');
  });

  it('keeps the providers the server lists as one quiet line under it, which opens the sign-in card', async () => {
    const one = renderWithApp(
      <Landing
        session={guestSession({ providers: [{ id: 'google', label: 'Google' }] })}
        note={null}
      />,
    );
    expect(button().textContent).toBe('Try it now');
    expect(screen.getByTestId('signin-secondary').textContent).toBe('Or sign in with Google');
    expect(screen.queryByTestId('signin-github')).toBeNull();
    one.unmount();

    const { user } = renderWithApp(
      <Landing
        session={guestSession({
          providers: [
            { id: 'google', label: 'Google' },
            { id: 'github', label: 'GitHub' },
          ],
        })}
        note={null}
      />,
    );
    expect(screen.getByTestId('signin-secondary').textContent).toBe(
      'Or sign in with Google or GitHub',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByTestId('signin-secondary'));
    const dialog = await screen.findByRole('dialog', { name: 'Sign in to Swarm' });
    expect(within(dialog).getByTestId('signin-google')).toBeTruthy();
    expect(within(dialog).getByTestId('signin-github')).toBeTruthy();
  });

  it('is the landing page as it was when guest mode is off, and when the server does not say', () => {
    const absent = signedOutSession() as Partial<PublicSession>;
    delete absent.guestMode;
    delete absent.guestRetentionHours;
    for (const session of [signedOutSession({ guestMode: false }), absent as PublicSession]) {
      const { unmount } = renderWithApp(<Landing session={session} note={null} />);
      expect(screen.getByTestId('try-it-free').textContent).toBe('Try it free');
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
      expect(screen.queryByTestId('try-it-now')).toBeNull();
      expect(screen.queryByTestId('guest-note')).toBeNull();
      expect(screen.queryByTestId('signin-secondary')).toBeNull();
      unmount();
    }
  });

  it('asks the server for a guest session with the header only this page sends, stays busy while it waits, and has the session read again', async () => {
    let answer!: (response: Response) => void;
    const server = fakeServer({
      'POST /auth/guest': () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const onStarted = vi.fn().mockResolvedValue(true);
    const { user } = renderWithApp(
      <Landing session={guestSession()} note={null} onStarted={onStarted} />,
    );
    await user.click(button());
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(onStarted).not.toHaveBeenCalled();

    answer(json({ started: true }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(server.calls).toHaveLength(1);
    const [call] = server.calls;
    expect(call).toMatchObject({ method: 'POST', path: '/auth/guest', body: {} });
    expect(call!.headers['x-swarm-csrf']).toBe('1');
    expect(call!.headers['content-type']).toBe('application/json');
    expect(call!.headers['x-swarm-provider-key']).toBeUndefined();
    // The gate takes the page from here: the button stays busy until it has.
    expect(button().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts from the first screen, because a new workspace has none of the explorations an old address points at', async () => {
    fakeServer({ 'POST /auth/guest': { started: true } });
    const onStarted = vi.fn().mockResolvedValue(true);
    at('/?project=p1&scene=map');
    const { user } = renderWithApp(
      <Landing session={guestSession()} note={null} onStarted={onStarted} />,
    );
    await user.click(button());
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(window.location.pathname + window.location.search).toBe('/');
  });

  it('loads the page again when nothing else is there to read the session', async () => {
    fakeServer({ 'POST /auth/guest': { started: true } });
    const reload = vi.spyOn(browser, 'reload').mockImplementation(() => undefined);
    const { user } = renderWithApp(<Landing session={guestSession()} note={null} />);
    await user.click(button());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it.each([
    [
      429,
      'RATE_LIMITED',
      'Too many people have started from your network lately. Wait a few minutes, then try again.',
    ],
    [403, 'NOT_AVAILABLE', 'Guest access is not available right now. Please try again later.'],
    [403, 'BOT_CHECK_FAILED', 'We could not check that you are a person. Please try again.'],
    [500, 'INTERNAL', 'We could not start your session. Please try again.'],
  ])(
    'says what a %i answer (%s) means, in a calm sentence, and lets the visitor try again',
    async (status, code, words) => {
      const server = fakeServer({
        'POST /auth/guest': failure(status, code, 'RAW SERVER MESSAGE'),
      });
      const onStarted = vi.fn();
      const { user } = renderWithApp(
        <Landing session={guestSession()} note={null} onStarted={onStarted} />,
      );
      await user.click(button());
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(words);
      expect(alert.textContent).not.toContain('RAW SERVER MESSAGE');
      expect(screen.getByTestId('guest-error')).toBeTruthy();
      expect(onStarted).not.toHaveBeenCalled();
      expect(button().disabled).toBe(false);
      expect(server.calls).toHaveLength(1);
    },
  );

  it('says it cannot reach the service when there is no answer, and when the browser keeps no session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const first = renderWithApp(<Landing session={guestSession()} note={null} />);
    await first.user.click(button());
    expect((await screen.findByRole('alert')).textContent).toContain(NETWORK_WORDS);
    first.unmount();

    fakeServer({ 'POST /auth/guest': { started: true } });
    const notKept = vi.fn().mockResolvedValue(false);
    const second = renderWithApp(
      <Landing session={guestSession()} note={null} onStarted={notKept} />,
    );
    await second.user.click(button());
    expect((await screen.findByRole('alert')).textContent).toMatch(/allows cookies for this site/u);
    expect(button().disabled).toBe(false);
  });

  it('waits for the bot check where the server asks for it, and sends the token it gives', async () => {
    const turnstile = fakeTurnstile();
    const server = fakeServer({ 'POST /auth/guest': { started: true } });
    const onStarted = vi.fn().mockResolvedValue(true);
    const { user } = renderWithApp(
      <Landing
        session={guestSession({ bot: { kind: 'turnstile', siteKey: 'site-key-123' } })}
        note={null}
        onStarted={onStarted}
      />,
    );
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
    expect(turnstile.widgets[0]).toMatchObject({ sitekey: 'site-key-123' });
    expect(button().disabled).toBe(true);
    expect(screen.getByText('Checking that you are a person…')).toBeTruthy();

    await turnstile.solve('token-one');
    await waitFor(() => expect(button().disabled).toBe(false));
    await user.click(button());
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(server.calls[0]!.body).toEqual({ turnstileToken: 'token-one' });
  });

  it('says that the session ended in words that never ask a guest to sign in', () => {
    const only = renderWithApp(<Landing session={guestSession()} note="expired" />);
    const note = screen.getByTestId('landing-note');
    expect(note.getAttribute('data-kind')).toBe('expired');
    expect(note.textContent).toBe('Your session ended. Press Try it now to start again.');
    only.unmount();

    renderWithApp(
      <Landing
        session={guestSession({ providers: [{ id: 'google', label: 'Google' }] })}
        note="expired"
      />,
    );
    expect(screen.getByTestId('landing-note').textContent).toBe(
      'Your session ended. Press Try it now to start again, or sign in again if you have an account.',
    );
  });
});
