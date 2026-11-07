import { useId, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Notice } from '../design/ui';
import type { PublicSession } from '../../../shared/public';
import { browser } from './browser';
import { BotCheck } from './BotCheck';
import { guestFailure, guestHours, guestNoteWords } from './guest';
import { startGuest } from './publicApi';
import { useTurnstile } from './useTurnstile';

const COOKIE_WORDS =
  'We could not start your session. Check that your browser allows cookies for this site, then try again.';

/** The new workspace has none of the explorations that an old address points at, so the page starts from its first screen. */
function leaveOldAddress(): void {
  const url = new URL(window.location.href);
  if (!url.search) return;
  url.search = '';
  window.history.replaceState(window.history.state, '', url);
}

/**
 * The one way in for a visitor who does not sign in: the button that asks the server for a temporary private
 * workspace (with the bot check when the server asks for it), the calm words for a refusal, and the note that says what
 * "temporary" means. `onStarted` reads the session again and says whether the visitor is in now; without it the page is
 * loaded again, which reads the session afresh.
 */
export function GuestStart({
  session,
  onStarted,
}: {
  session: Pick<PublicSession, 'bot' | 'guestRetentionHours'>;
  onStarted?: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const check = useTurnstile(session.bot?.siteKey ?? null);
  const waiting = Boolean(session.bot) && check.phase !== 'ready';

  const start = async () => {
    setError(null);
    setBusy(true);
    const reply = await startGuest(check.token ? { turnstileToken: check.token } : {});
    if (reply.ok) {
      leaveOldAddress();
      if (!onStarted) {
        browser.reload();
        return;
      }
      // The gate takes the page from here: the button stays busy until it has.
      if (await onStarted()) return;
      setError(COOKIE_WORDS);
    } else {
      setError(guestFailure(reply));
    }
    setBusy(false);
    check.reset();
  };

  return (
    <>
      <div className="sw-pub-hero__actions">
        <Button
          variant="accent"
          size="lg"
          data-testid="try-it-now"
          aria-describedby={noteId}
          iconEnd={<ArrowRight size={18} aria-hidden="true" />}
          busy={busy}
          busyLabel="Starting"
          disabled={waiting}
          onClick={() => void start()}
        >
          Try it now
        </Button>
      </div>
      {session.bot && <BotCheck check={check} />}
      {error && (
        <div className="sw-pub-hero__error" data-testid="guest-error">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <p className="sw-caption" id={noteId} data-testid="guest-note">
        {guestNoteWords(guestHours(session.guestRetentionHours))}
      </p>
    </>
  );
}
