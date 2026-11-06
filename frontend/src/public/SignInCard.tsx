import { useEffect, useState } from 'react';
import { Github, LogIn } from 'lucide-react';
import { Button, Notice } from '../design/ui';
import type { PublicProviderInfo, PublicSession } from '../../../shared/public';
import { browser } from './browser';
import { PageLink } from './PageLink';
import { navigationTarget, returnPathOf } from './pages';
import { signInFailure } from './problems';
import { startSignIn } from './publicApi';
import { useTurnstile } from './useTurnstile';

function ProviderGlyph({ id }: { id: string }) {
  if (id === 'github') return <Github size={18} aria-hidden="true" />;
  // The letter is drawn by the stylesheet, so that it is not part of the button's text.
  if (id === 'google') return <span className="sw-pub-glyph" data-glyph="G" aria-hidden="true" />;
  return <LogIn size={18} aria-hidden="true" />;
}

/**
 * The way in: one button for each sign-in the server offers (the page never decides which exist), the bot check when the
 * server asks for it, and what the person should know before they go on.
 */
export function SignInCard({
  session,
}: {
  session: Pick<PublicSession, 'providers' | 'signupsOpen' | 'bot' | 'legal'>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useTurnstile(session.bot?.siteKey ?? null);
  const waiting = session.bot !== null && check.phase !== 'ready';

  // A person who comes back with the Back button from the provider finds this page as it was left, with a button still busy.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(null);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  const start = async (provider: PublicProviderInfo) => {
    setError(null);
    setBusy(provider.id);
    const returnTo = returnPathOf(window.location);
    const reply = await startSignIn(provider.id, {
      ...(returnTo ? { returnTo } : {}),
      ...(check.token ? { turnstileToken: check.token } : {}),
    });
    const target = reply.ok ? navigationTarget(reply.data.url) : null;
    if (target) {
      // The browser is leaving: the button stays busy until it has.
      browser.assign(target);
      return;
    }
    setBusy(null);
    setError(
      reply.ok ? signInFailure({ status: 0, code: null, network: false }) : signInFailure(reply),
    );
    check.reset();
  };

  return (
    <div className="sw-pub-signin" data-testid="signin-card">
      {session.providers.length === 0 ? (
        <Notice tone="caution">Sign-in is not set up on this site yet.</Notice>
      ) : (
        <div className="sw-pub-signin__buttons">
          {session.providers.map((provider) => (
            <Button
              key={provider.id}
              variant="glass"
              size="lg"
              block
              data-testid={`signin-${provider.id}`}
              icon={<ProviderGlyph id={provider.id} />}
              busy={busy === provider.id}
              busyLabel="Opening sign-in"
              disabled={busy !== null || waiting}
              onClick={() => void start(provider)}
            >
              Continue with {provider.label}
            </Button>
          ))}
        </div>
      )}
      {session.bot && (
        <div className="sw-pub-signin__check">
          <div ref={check.container} />
          {check.phase === 'loading' && (
            <p className="sw-caption" role="status">
              Checking that you are a person…
            </p>
          )}
          {check.phase === 'failed' && (
            <Notice
              tone="error"
              action={
                <Button size="sm" variant="glass" onClick={check.retry}>
                  Try again
                </Button>
              }
            >
              The check that you are a person did not load.
            </Notice>
          )}
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!session.signupsOpen && (
        <Notice tone="info">
          New accounts are closed for now. People who already have an account can still sign in.
        </Notice>
      )}
      <p className="sw-caption">
        By continuing you accept the <PageLink to={session.legal.terms}>Terms</PageLink> and the{' '}
        <PageLink to={session.legal.privacy}>Privacy notice</PageLink>.
      </p>
      <p className="sw-caption">
        The same e-mail address through Google and through GitHub makes two separate accounts.
      </p>
    </div>
  );
}
