// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, screen, waitFor, within } from '../test/dom';
import { count } from '../lib/format';
import { AdminPage } from './AdminPage';
import { Faq, FaqPage } from './Faq';
import { formatBytes, formatLocal, formatUsd } from './format';
import { LegalPage } from './LegalPage';
import { legalBlocks } from './legalText';
import { navigationTarget, pageOfPath, returnPathOf, sitePath } from './pages';
import { setPublicEdition } from './runtime';
import { StatusPage } from './StatusPage';
import { adminView, signedInSession, signedOutSession, statusView } from './test/fixtures';
import { failure, fakeServer, json } from './test/server';

// The pages that need no session or little: status, the legal texts, the FAQ, and the administrator's usage page.

beforeEach(() => setPublicEdition(true));

afterEach(() => {
  setPublicEdition(false);
  vi.unstubAllGlobals();
});

describe('the status page', () => {
  it('says that everything works, and what is available, with the time the free runs come back', async () => {
    const server = fakeServer({ 'GET /api/public/status': statusView() });
    renderWithApp(<StatusPage session={null} />);
    const page = screen.getByTestId('status-page');
    expect(page.getAttribute('data-status')).toBe('loading');
    await waitFor(() => expect(page.getAttribute('data-status')).toBe('ok'));
    expect(within(page).getByText('Everything is working.')).toBeTruthy();
    expect(within(screen.getByTestId('status-free-tier')).getByText('Available')).toBeTruthy();
    const resets = within(screen.getByTestId('status-resets')).getByText(
      formatLocal('2026-11-07T00:00:00.000Z'),
    );
    expect(resets.getAttribute('datetime')).toBe('2026-11-07T00:00:00.000Z');
    expect(within(screen.getByTestId('status-byok')).getByText('Available')).toBeTruthy();
    expect(within(screen.getByTestId('status-signups')).getByText('Open')).toBeTruthy();
    expect(within(page).queryByText('A note from the site owner')).toBeNull();
    expect(server.fetch.mock.calls[0]![0]).toBe('/api/public/status');
    expect(server.fetch.mock.calls[0]![1]!.headers).toEqual({ Accept: 'application/json' });
  });

  it('says what is limited when the service is degraded: why the free tier is off, no keys, no new accounts, and the owner’s note', async () => {
    fakeServer({
      'GET /api/public/status': statusView({
        status: 'degraded',
        freeTier: { available: false, reason: 'global-cap', resetsAt: '2026-11-07T00:00:00.000Z' },
        byokEnabled: false,
        signupsOpen: false,
        message: 'We are looking into it.',
      }),
    });
    renderWithApp(<StatusPage session={signedInSession()} />);
    const page = screen.getByTestId('status-page');
    await waitFor(() => expect(page.getAttribute('data-status')).toBe('degraded'));
    expect(within(page).getByText('Some things are limited right now.')).toBeTruthy();
    expect(
      within(screen.getByTestId('status-free-tier')).getByText(
        'The free tier is used up for today',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('status-byok')).getByText('Switched off right now'),
    ).toBeTruthy();
    expect(within(screen.getByTestId('status-signups')).getByText('Closed for now')).toBeTruthy();
    expect(within(page).getByText('A note from the site owner')).toBeTruthy();
    expect(within(page).getByText('We are looking into it.')).toBeTruthy();
  });

  it('says that the service is down for maintenance', async () => {
    fakeServer({ 'GET /api/public/status': statusView({ status: 'maintenance' }) });
    renderWithApp(<StatusPage session={null} />);
    const page = screen.getByTestId('status-page');
    await waitFor(() => expect(page.getAttribute('data-status')).toBe('maintenance'));
    expect(within(page).getByText('Swarm is down for maintenance.')).toBeTruthy();
  });

  it('shows the owner’s note as text, whatever it holds', async () => {
    fakeServer({
      'GET /api/public/status': statusView({
        message: '<img src=x onerror="alert(1)"><b>bold</b>',
      }),
    });
    renderWithApp(<StatusPage session={null} />);
    expect(await screen.findByText('<img src=x onerror="alert(1)"><b>bold</b>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('says plainly that it cannot reach the service, and asks again on request', async () => {
    const server = fakeServer({ 'GET /api/public/status': failure(502, 'BAD_GATEWAY') });
    const { user } = renderWithApp(<StatusPage session={null} />);
    const page = screen.getByTestId('status-page');
    await waitFor(() => expect(page.getAttribute('data-status')).toBe('unreachable'));
    expect(within(page).getByRole('alert').textContent).toBe(
      "We can't reach the service right now.",
    );
    server.set('GET /api/public/status', statusView());
    await user.click(within(page).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(page.getAttribute('data-status')).toBe('ok'));
  });

  it('treats a network failure and an answer that is not a status the same way, and an unknown state as limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const first = renderWithApp(<StatusPage session={null} />);
    await waitFor(() =>
      expect(screen.getByTestId('status-page').getAttribute('data-status')).toBe('unreachable'),
    );
    first.unmount();

    fakeServer({ 'GET /api/public/status': json({ hello: 'world' }) });
    const second = renderWithApp(<StatusPage session={null} />);
    await waitFor(() =>
      expect(screen.getByTestId('status-page').getAttribute('data-status')).toBe('unreachable'),
    );
    second.unmount();

    fakeServer({ 'GET /api/public/status': { ...statusView(), status: 'on-fire' } });
    renderWithApp(<StatusPage session={null} />);
    expect(await screen.findByText('Some things are limited right now.')).toBeTruthy();
  });
});

describe('the legal texts', () => {
  it.each([
    ['terms', 'Terms of use'],
    ['privacy', 'Privacy notice'],
  ] as const)(
    'fetches the %s from the server and shows its title and its text',
    async (doc, title) => {
      const server = fakeServer({
        [`GET /api/public/legal/${doc}`]: {
          title,
          text: `# ${title}\n\nFirst paragraph.\nSame paragraph, next line.\n\n## What we keep\n\n- one thing\n- another thing`,
          reviewed: true,
        },
      });
      renderWithApp(<LegalPage doc={doc} session={null} />);
      const page = await screen.findByTestId('legal-page');
      await waitFor(() =>
        expect(within(page).getByText('First paragraph.', { exact: false })).toBeTruthy(),
      );
      expect(page.getAttribute('data-doc')).toBe(doc);
      expect(within(page).getByRole('heading', { level: 1 }).textContent).toBe(title);
      // The first heading only repeats the title, so it is not shown twice.
      expect(within(page).queryAllByRole('heading', { name: title })).toHaveLength(1);
      expect(within(page).getByRole('heading', { name: 'What we keep' })).toBeTruthy();
      expect(
        within(page)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['one thing', 'another thing']);
      expect(server.fetch.mock.calls[0]![0]).toBe(`/api/public/legal/${doc}`);
      expect(screen.queryByTestId('legal-unreviewed')).toBeNull();
      expect(document.title).toBe(`${title} | Swarm`);
    },
  );

  it('shows what it holds as text, never as markup: a script, an image and a handler stay words on the page', async () => {
    const hostile = [
      'Welcome <img src=x onerror="document.body.dataset.pwned=1"> and <script>document.body.dataset.pwned=2</script>.',
      '<a href="javascript:alert(1)" onclick="alert(2)">click</a> &amp; <svg onload="alert(3)"></svg>',
    ].join('\n\n');
    fakeServer({
      'GET /api/public/legal/terms': { title: '<b>Terms</b>', text: hostile, reviewed: true },
    });
    renderWithApp(<LegalPage doc="terms" session={null} />);
    const page = await screen.findByTestId('legal-page');
    await waitFor(() => expect(page.textContent).toContain('<img src=x'));
    expect(page.textContent).toContain('<script>document.body.dataset.pwned=2</script>');
    expect(page.textContent).toContain('&amp;');
    expect(within(page).getByRole('heading', { level: 1 }).textContent).toBe('<b>Terms</b>');
    for (const tag of ['img', 'script', 'svg', 'b']) {
      expect(page.querySelector(tag), tag).toBeNull();
    }
    expect(page.querySelector('a[href^="javascript"]')).toBeNull();
    expect(document.querySelectorAll('[onerror], [onclick], [onload]')).toHaveLength(0);
    expect(document.body.dataset.pwned).toBeUndefined();
  });

  it('says in a banner that cannot be missed that the owner has not reviewed it', async () => {
    fakeServer({
      'GET /api/public/legal/privacy': {
        title: 'Privacy notice',
        text: 'NOT YET REVIEWED: replace this before opening to the public.',
        reviewed: false,
      },
    });
    renderWithApp(<LegalPage doc="privacy" session={null} />);
    const banner = await screen.findByTestId('legal-unreviewed');
    expect(within(banner).getByText('NOT YET REVIEWED by the site owner')).toBeTruthy();
    expect(within(banner).getByText('This text is a placeholder. Do not rely on it.')).toBeTruthy();
  });

  it('says so, and reads it again on request, when the text cannot be read', async () => {
    const server = fakeServer({ 'GET /api/public/legal/terms': failure(500, 'INTERNAL') });
    const { user } = renderWithApp(<LegalPage doc="terms" session={null} />);
    expect(await screen.findByText("We can't reach the service right now.")).toBeTruthy();
    server.set('GET /api/public/legal/terms', {
      title: 'Terms of use',
      text: 'Fine.',
      reviewed: true,
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Fine.')).toBeTruthy();
  });

  it('reads plain text into headings, lists and paragraphs, and nothing else', () => {
    expect(
      legalBlocks('# One\r\n\r\nLine a\r\nLine b\r\n\r\n### Three\r\n* x\r\n- y\r\n\r\nEnd'),
    ).toEqual([
      { kind: 'heading', level: 2, text: 'One' },
      { kind: 'paragraph', text: 'Line a\nLine b' },
      { kind: 'heading', level: 3, text: 'Three' },
      { kind: 'list', items: ['x', 'y'] },
      { kind: 'paragraph', text: 'End' },
    ]);
    expect(legalBlocks('')).toEqual([]);
    expect(legalBlocks('<b>not markup</b> #no heading')).toEqual([
      { kind: 'paragraph', text: '<b>not markup</b> #no heading' },
    ]);
  });
});

describe('the FAQ', () => {
  it('answers what it costs, whether a key is safe, whether data is private, what the end of the free tier means, who may sign in, and what happens to the text', () => {
    renderWithApp(<Faq session={signedOutSession()} />);
    const faq = screen.getByTestId('faq');
    const questions = within(faq)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(questions).toEqual([
      'What does it cost?',
      'Is my key safe?',
      'Is my data private?',
      'What happens when the free tier runs out?',
      'Which providers can I sign in with?',
      'What does Swarm do with my text?',
      'Does Swarm predict what will happen?',
    ]);
    const text = faq.textContent ?? '';
    expect(text).toContain('Nothing is charged by this site');
    expect(text).toContain('bring your own Google Gemini key');
    expect(text).toContain("this browser tab's session storage");
    expect(text).toContain('over HTTPS');
    expect(text).toContain('never writes it to disk or to a log');
    expect(text).toContain('Use a key with a spend limit');
    expect(text).toContain('Forget key removes it');
    expect(text).toContain('Each account has its own private workspace');
    expect(text).toContain('the site owner does not browse projects');
    expect(text).toContain('delete everything at any time');
    expect(text).toContain('audit log');
    expect(text).toContain('For 30 days, a keyed counter');
    expect(text).toContain('You see a short message, not an error');
    expect(text).toContain('You can sign in with Google and GitHub.');
    expect(text).toContain('two separate accounts');
    expect(text).toContain('only when you run a model-assisted step');
    expect(text).toContain(
      'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
    );
  });

  it('names the providers the server lists, and none it does not', () => {
    renderWithApp(
      <Faq session={signedOutSession({ providers: [{ id: 'github', label: 'GitHub' }] })} />,
    );
    expect(screen.getByTestId('faq').textContent).toContain('You can sign in with GitHub.');
    expect(screen.getByTestId('faq').textContent).not.toContain('Google and GitHub');
  });

  it('says the days the site keeps the counter for, whatever it is set to, and nothing of one it does not keep', () => {
    const { unmount } = renderWithApp(<Faq session={signedOutSession({ retentionDays: 7 })} />);
    expect(screen.getByTestId('faq').textContent).toContain('For 7 days, a keyed counter');
    unmount();
    renderWithApp(<Faq session={signedOutSession({ retentionDays: 0 })} />);
    const text = screen.getByTestId('faq').textContent ?? '';
    expect(text).toContain('one thing stays:');
    expect(text).not.toContain('keyed counter');
  });

  it('opens an answer on its question', async () => {
    const { user } = renderWithApp(<Faq session={null} />);
    const question = screen.getByRole('button', { name: 'Is my key safe?' });
    expect(question.getAttribute('aria-expanded')).toBe('false');
    await user.click(question);
    expect(question.getAttribute('aria-expanded')).toBe('true');
  });

  it('is the heading of its own page, with the questions under it as sections', () => {
    renderWithApp(<FaqPage session={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Questions people ask');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(7);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(document.title).toBe('FAQ | Swarm');
  });
});

describe('the addresses of the pages', () => {
  it('knows each page by its path, with or without a closing slash, in any case, and no other path', () => {
    expect(pageOfPath('/status')).toBe('status');
    expect(pageOfPath('/faq/')).toBe('faq');
    expect(pageOfPath('/Legal/Terms')).toBe('terms');
    expect(pageOfPath('/legal/privacy')).toBe('privacy');
    expect(pageOfPath('/admin')).toBe('admin');
    for (const other of ['/', '', '/legal', '/legal/other', '/statuses', '/api/public/status']) {
      expect(pageOfPath(other), other).toBeNull();
    }
  });

  it('lets a link carry a path on this site and nothing that leaves it', () => {
    expect(sitePath('/legal/terms', '/x')).toBe('/legal/terms');
    for (const bad of [
      '//evil.example',
      'https://evil.example',
      '/a b',
      '/\\evil.example',
      'javascript:1',
      '',
      5,
      null,
    ]) {
      expect(sitePath(bad, '/fallback'), String(bad)).toBe('/fallback');
    }
  });

  it('brings a sign-in back to the page that was open, without the problem it came back with', () => {
    expect(returnPathOf({ pathname: '/', search: '' })).toBeUndefined();
    expect(returnPathOf({ pathname: '/', search: '?signin=failed' })).toBeUndefined();
    expect(returnPathOf({ pathname: '/', search: '?project=p1&scene=map&signin=closed' })).toBe(
      '/?project=p1&scene=map',
    );
    expect(returnPathOf({ pathname: '/faq', search: '' })).toBeUndefined();
    expect(returnPathOf({ pathname: '/', search: `?q=${'x'.repeat(700)}` })).toBeUndefined();
  });

  it('follows an address that is a web address, and no other', () => {
    expect(navigationTarget('https://accounts.example/authorize?x=1')).toBe(
      'https://accounts.example/authorize?x=1',
    );
    expect(navigationTarget('http://127.0.0.1:4000/fake')).toBe('http://127.0.0.1:4000/fake');
    expect(navigationTarget('/auth/somewhere')).toBe('/auth/somewhere');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      5,
      null,
      undefined,
    ]) {
      expect(navigationTarget(bad), String(bad)).toBeNull();
    }
  });

  it('writes sizes, money and counts a person can read', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
    expect(formatBytes(20_971_520)).toBe('20 MB');
    expect(formatUsd(0.5)).toBe('$0.50');
    expect(formatUsd(0.0123)).toBe('$0.0123');
    expect(formatUsd(0)).toBe('$0.00');
    expect(count(60_000)).toBe((60_000).toLocaleString());
  });
});

describe('the usage page, for an administrator', () => {
  const admin = () => signedInSession({}, { isAdmin: true });

  it('is for administrators: anyone else is told so, and nothing is asked of the server', () => {
    const server = fakeServer({});
    const out = renderWithApp(<AdminPage session={signedOutSession()} />);
    expect(screen.getByTestId('admin-denied').textContent).toContain(
      'Sign in with an administrator account to see it.',
    );
    out.unmount();
    renderWithApp(<AdminPage session={signedInSession()} />);
    expect(screen.getByTestId('admin-denied').textContent).toContain(
      'Your account is not one of them.',
    );
    expect(server.calls).toEqual([]);
  });

  it('shows the spend by day, the top accounts, the blocked requests and today against its limits, in plain tables', async () => {
    const server = fakeServer({ 'GET /api/admin/usage': adminView() });
    renderWithApp(<AdminPage session={admin()} />);
    const page = await screen.findByTestId('admin-page');
    expect(server.fetch.mock.calls[0]![0]).toBe('/api/admin/usage?days=14');

    const today = within(screen.getByTestId('admin-today'));
    expect(today.getByText(`${count(90_000)} of ${count(2_000_000)}`)).toBeTruthy();
    expect(today.getByText('$0.0123 of $5.00')).toBeTruthy();

    const days = within(screen.getByTestId('admin-days'));
    expect(days.getAllByRole('row')).toHaveLength(3);
    expect(days.getByRole('row', { name: /2026-11-05/u }).textContent).toContain('$0.50');
    expect(days.getByRole('row', { name: /2026-11-06/u }).textContent).toContain('$0.0123');

    const users = within(screen.getByTestId('admin-users'));
    expect(users.getByRole('row', { name: /u_aaa111/u }).textContent).toContain('a***@example.com');
    expect(users.getAllByRole('row')).toHaveLength(3);

    const blocked = within(screen.getByTestId('admin-blocked'));
    expect(blocked.getByRole('row', { name: /user-cap/u }).textContent).toContain('4');
    expect(within(page).getByText('Free tier is on')).toBeTruthy();
    expect(within(page).getByText('New accounts are open')).toBeTruthy();
  });

  it('turns the free tier off and on, and closes and opens new accounts, with the change header and a plain body', async () => {
    const server = fakeServer({
      'GET /api/admin/usage': adminView(),
      'POST /api/admin/free-tier': { freeTierEnv: true, freeTierRuntime: false, signups: true },
      'POST /api/admin/signups': { freeTierEnv: true, freeTierRuntime: false, signups: false },
    });
    const { user } = renderWithApp(<AdminPage session={admin()} />);
    await screen.findByTestId('admin-page');

    await user.click(screen.getByTestId('admin-free-tier'));
    await screen.findByText('Free tier is off');
    expect(screen.getByTestId('admin-free-tier').textContent).toBe('Turn the free tier on');
    const free = server.to('POST /api/admin/free-tier')[0]!;
    expect(free.body).toEqual({ enabled: false });
    expect(free.headers['x-swarm-csrf']).toBe('1');

    await user.click(screen.getByTestId('admin-signups'));
    await screen.findByText('New accounts are closed');
    expect(screen.getByTestId('admin-signups').textContent).toBe('Open new accounts');
    expect(server.to('POST /api/admin/signups')[0]!.body).toEqual({ enabled: false });

    server.set('POST /api/admin/free-tier', {
      freeTierEnv: true,
      freeTierRuntime: true,
      signups: false,
    });
    await user.click(screen.getByTestId('admin-free-tier'));
    await screen.findByText('Free tier is on');
    expect(server.to('POST /api/admin/free-tier')[1]!.body).toEqual({ enabled: true });
  });

  it('cannot turn on a free tier that the server settings keep off, and says why', async () => {
    fakeServer({
      'GET /api/admin/usage': adminView({
        switches: { freeTierEnv: false, freeTierRuntime: true, signups: true },
      }),
    });
    renderWithApp(<AdminPage session={admin()} />);
    await screen.findByTestId('admin-page');
    expect(screen.getByText('Free tier is off')).toBeTruthy();
    expect((screen.getByTestId('admin-free-tier') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/switched off in the server settings/u)).toBeTruthy();
  });

  it('disables an account only after a second press, and can enable it again', async () => {
    const server = fakeServer({
      'GET /api/admin/usage': adminView(),
      'POST /api/admin/users/u_aaa111/disable': (call) => ({
        accounts: [{ id: 'u_aaa111', disabled: (call.body as { disabled: boolean }).disabled }],
      }),
    });
    const { user } = renderWithApp(<AdminPage session={admin()} />);
    await screen.findByTestId('admin-page');

    await user.click(screen.getByTestId('admin-disable-u_aaa111'));
    expect(server.to('POST /api/admin/users/u_aaa111/disable')).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(server.to('POST /api/admin/users/u_aaa111/disable')).toEqual([]);

    await user.click(screen.getByTestId('admin-disable-u_aaa111'));
    await user.click(screen.getByTestId('admin-disable-confirm-u_aaa111'));
    expect(await screen.findByText('Disabled')).toBeTruthy();
    const disable = server.to('POST /api/admin/users/u_aaa111/disable')[0]!;
    expect(disable.body).toEqual({ disabled: true });
    expect(disable.headers['x-swarm-csrf']).toBe('1');

    await user.click(screen.getByTestId('admin-enable-u_aaa111'));
    await waitFor(() => expect(screen.getByTestId('admin-disable-u_aaa111')).toBeTruthy());
    expect(server.to('POST /api/admin/users/u_aaa111/disable')[1]!.body).toEqual({
      disabled: false,
    });
  });

  it('shows an account that was switched off earlier as switched off, and can enable it', async () => {
    const server = fakeServer({
      'GET /api/admin/usage': adminView({
        topUsers: [
          { id: 'u_aaa111', emailMasked: 'a***@example.com', tokens: 5, calls: 1, disabled: true },
          { id: 'u_bbb222', emailMasked: 'b***@example.org', tokens: 4, calls: 1, disabled: false },
        ],
      }),
      'POST /api/admin/users/u_aaa111/disable': { accounts: [{ id: 'u_aaa111', disabled: false }] },
    });
    const { user } = renderWithApp(<AdminPage session={admin()} />);
    await screen.findByTestId('admin-page');
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByTestId('admin-disable-u_bbb222')).toBeTruthy();
    await user.click(screen.getByTestId('admin-enable-u_aaa111'));
    await waitFor(() => expect(screen.getByTestId('admin-disable-u_aaa111')).toBeTruthy());
    expect(server.to('POST /api/admin/users/u_aaa111/disable')[0]!.body).toEqual({
      disabled: false,
    });
  });

  it('says what was not done, in the server’s words, when a change is refused', async () => {
    fakeServer({
      'GET /api/admin/usage': adminView(),
      'POST /api/admin/signups': failure(403, 'FORBIDDEN', 'Only an administrator may do that.'),
    });
    const { user } = renderWithApp(<AdminPage session={admin()} />);
    await screen.findByTestId('admin-page');
    await user.click(screen.getByTestId('admin-signups'));
    expect(await screen.findByText('That was not done')).toBeTruthy();
    expect(screen.getByText(/Only an administrator may do that\./u)).toBeTruthy();
    expect(screen.getByText('New accounts are open')).toBeTruthy();
  });

  it('says when the usage cannot be read, and reads it again on request', async () => {
    const server = fakeServer({ 'GET /api/admin/usage': failure(500, 'INTERNAL', 'Broken.') });
    const { user } = renderWithApp(<AdminPage session={admin()} />);
    expect(await screen.findByText('The usage could not be read')).toBeTruthy();
    server.set('GET /api/admin/usage', adminView());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('admin-page')).toBeTruthy();
  });
});
