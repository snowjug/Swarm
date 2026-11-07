import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { errorMessage, isAbort } from '../api';
import { Button, Dialog, DialogContent, Field, Input, Meter, Notice, Skeleton } from '../design/ui';
import { FocusDialog } from '../panels/shared/FocusDialog';
import { usePanelLifecycle } from '../panels/shared/usePanelLifecycle';
import { DELETE_CONFIRMATION, type AccountView, type PublicSession } from '../../../shared/public';
import { count } from '../lib/format';
import { deleteAccountForGood, signOutOfPublic } from './accountActions';
import { formatBytes, formatDay } from './format';
import { guestHours, guestReminderWords } from './guest';
import { PAGE_PATHS } from './pages';
import { publicApi } from './publicApi';

type Load =
  | { phase: 'loading' }
  | { phase: 'ready'; view: AccountView }
  | { phase: 'failed'; message: string };

function providerLabel(session: PublicSession, id: string): string {
  return session.providers.find((provider) => provider.id === id)?.label ?? id;
}

const share = (used: number, limit: number) => (limit > 0 ? used / limit : 0);

/** Everything the page says it does with an account that is deleted, and what it keeps, in the words the design uses. */
function DeleteExplanation({ days }: { days: number }) {
  return (
    <div className="sw-pub-account__explain">
      <p>This cannot be undone. Deleting your account removes, for good:</p>
      <ul>
        <li>every exploration of yours, with its sources, scenarios, runs, reports and chat;</li>
        <li>your private workspace and your account;</li>
        <li>your sign-in sessions, on every device.</li>
      </ul>
      <p>{days > 0 ? 'Two things are kept:' : 'One thing is kept:'}</p>
      <ul>
        <li>
          The audit log. It can only be added to, never edited. It holds opaque ids, action words
          and counts, and no e-mail address and no text of yours.
        </li>
        {days > 0 && (
          <li>
            A keyed counter, for {days} {days === 1 ? 'day' : 'days'}. It is a code made from your
            sign-in account, with the number of free tokens it used, so that deleting and signing up
            again cannot reset the free allowance. It holds no e-mail address and cannot be turned
            back into one without a secret that only the server has.
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * What deleting a guest's data asks: nothing to type, as there is nothing to confuse it with. The question and what it
 * removes are the dialog's title and description; this is what else the person should know.
 */
function GuestDeleteNote({ privacy }: { privacy: string }) {
  return (
    <div className="sw-pub-account__explain">
      <p>
        You will go back to the start page, and any Google key you added is forgotten. The{' '}
        <a href={privacy} target="_blank" rel="noreferrer">
          Privacy notice <ExternalLink size={12} aria-hidden="true" />
        </a>{' '}
        says what is kept after a deletion.
      </p>
    </div>
  );
}

/**
 * The person's account: who they are signed in as, how much room they have used, a way to sign out, and a way to delete
 * the account and everything in it that asks for a phrase to be typed first. A guest has no address and nothing to sign
 * out of: they see "Guest", a reminder that their data is temporary, and a way to delete their data that needs no phrase.
 */
export function AccountPanel({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: PublicSession;
}) {
  const lifecycle = usePanelLifecycle(open, onOpenChange, 'dialog');
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'main' | 'delete'>('main');
  const [phrase, setPhrase] = useState('');
  const [working, setWorking] = useState<'sign-out' | 'delete' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ phase: 'loading' });
    publicApi.account(controller.signal).then(
      (answer) => setLoad({ phase: 'ready', view: answer }),
      (failure: unknown) => {
        if (!isAbort(failure)) setLoad({ phase: 'failed', message: errorMessage(failure) });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  // The button that was pressed is gone with its view: the dialog itself is where the keyboard and the reader start.
  useEffect(() => {
    if (view === 'delete') body.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  }, [view]);

  const leave = async (kind: 'sign-out' | 'delete') => {
    setWorking(kind);
    setProblem(null);
    try {
      await (kind === 'sign-out' ? signOutOfPublic() : deleteAccountForGood());
    } catch (failure) {
      setWorking(null);
      setProblem(errorMessage(failure));
    }
  };

  const account = load.phase === 'ready' ? load.view : null;
  const guest = account?.guest === true || session.user?.guest === true;
  const deleting = view === 'delete';
  const confirmed = guest || phrase === DELETE_CONFIRMATION;
  return (
    <Dialog open={lifecycle.open} onOpenChange={lifecycle.onOpenChange}>
      <DialogContent
        title={deleting ? (guest ? 'Delete my data?' : 'Delete your account?') : 'Your account'}
        description={
          deleting
            ? guest
              ? 'This removes your projects and cannot be undone.'
              : 'Read this first. It is the last step.'
            : guest
              ? 'Your temporary workspace, and what you have used.'
              : 'Who you are signed in as, and what you have used.'
        }
        tone={deleting ? 'danger' : undefined}
        className="sw-pub-dialog"
        footer={
          deleting ? (
            <>
              <Button variant="ghost" disabled={working !== null} onClick={() => setView('main')}>
                {guest ? 'Keep my data' : 'Keep my account'}
              </Button>
              <Button
                variant="danger"
                data-testid="account-delete-confirm"
                busy={working === 'delete'}
                busyLabel="Deleting"
                disabled={!confirmed || working !== null}
                onClick={() => void leave('delete')}
              >
                {guest ? 'Delete my data' : 'Delete my account and all my data'}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => lifecycle.onOpenChange(false)}>
              Close
            </Button>
          )
        }
      >
        <FocusDialog />
        <div className="sw-pub-account" data-testid="account-panel" ref={body}>
          {problem && (
            <Notice tone="error" title="That was not done">
              {problem}
            </Notice>
          )}
          {deleting ? (
            guest ? (
              <GuestDeleteNote privacy={session.legal.privacy} />
            ) : (
              <>
                <DeleteExplanation days={session.retentionDays ?? 30} />
                <Field
                  label={`To confirm, type: ${DELETE_CONFIRMATION}`}
                  hint="Type it exactly, in lower case."
                >
                  <Input
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-testid="account-delete-confirm-input"
                    value={phrase}
                    disabled={working !== null}
                    onChange={(event) => setPhrase(event.target.value)}
                  />
                </Field>
              </>
            )
          ) : (
            <>
              {load.phase === 'loading' && (
                <div className="sw-pub-status__wait" aria-busy="true">
                  <span className="sr-only" role="status">
                    Reading your account
                  </span>
                  <Skeleton height="1.2rem" width="70%" />
                  <Skeleton height="1.2rem" width="50%" />
                  <Skeleton height="1.2rem" width="60%" />
                </div>
              )}
              {load.phase === 'failed' && (
                <Notice
                  tone="error"
                  title="Your account could not be read"
                  action={
                    <Button
                      size="sm"
                      variant="glass"
                      onClick={() => setAttempt((value) => value + 1)}
                    >
                      Try again
                    </Button>
                  }
                >
                  {load.message}
                </Notice>
              )}
              {account && (
                <dl className="sw-pub-account__list">
                  <div>
                    <dt>{guest ? 'Using Swarm as' : 'E-mail'}</dt>
                    <dd data-testid="account-email">{guest ? 'Guest' : account.emailMasked}</dd>
                  </div>
                  {!guest && (
                    <div>
                      <dt>Signed in with</dt>
                      <dd data-testid="account-provider">
                        {providerLabel(session, account.provider)}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{guest ? 'Started' : 'Account created'}</dt>
                    <dd>
                      <time dateTime={account.createdAt}>{formatDay(account.createdAt)}</time>
                    </dd>
                  </div>
                  <div data-testid="account-projects">
                    <dt>Explorations</dt>
                    <dd>
                      {count(account.projects.count)} of {count(account.projects.limit)}
                    </dd>
                    <dd className="sw-pub-account__gauge">
                      <Meter
                        size="sm"
                        label="Explorations used"
                        value={share(account.projects.count, account.projects.limit)}
                        valueText={`${count(account.projects.count)} of ${count(account.projects.limit)}`}
                      />
                    </dd>
                  </div>
                  <div data-testid="account-storage">
                    <dt>Storage</dt>
                    <dd>
                      {formatBytes(account.storage.usedBytes)} of{' '}
                      {formatBytes(account.storage.limitBytes)}
                    </dd>
                    <dd className="sw-pub-account__gauge">
                      <Meter
                        size="sm"
                        label="Storage used"
                        value={share(account.storage.usedBytes, account.storage.limitBytes)}
                        valueText={`${formatBytes(account.storage.usedBytes)} of ${formatBytes(account.storage.limitBytes)}`}
                      />
                    </dd>
                  </div>
                </dl>
              )}
              {guest && (
                <p className="sw-caption" data-testid="guest-reminder">
                  {guestReminderWords(guestHours(session.guestRetentionHours))}
                </p>
              )}
              <nav className="sw-pub-account__links" aria-label="About this site">
                {[
                  ['Terms', session.legal.terms],
                  ['Privacy', session.legal.privacy],
                  ['FAQ', PAGE_PATHS.faq],
                  ['Status', PAGE_PATHS.status],
                  ...(session.user?.isAdmin || account?.isAdmin
                    ? [['Usage and switches', PAGE_PATHS.admin]]
                    : []),
                ].map(([label, href]) => (
                  <a key={href} href={href} target="_blank" rel="noreferrer">
                    {label} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ))}
              </nav>
              <div className="sw-pub-account__actions">
                {!guest && (
                  <Button
                    variant="glass"
                    data-testid="account-signout"
                    busy={working === 'sign-out'}
                    busyLabel="Signing out"
                    disabled={working !== null}
                    onClick={() => void leave('sign-out')}
                  >
                    Sign out
                  </Button>
                )}
                <Button
                  variant="danger"
                  data-testid="account-delete"
                  disabled={working !== null}
                  onClick={() => {
                    setPhrase('');
                    setProblem(null);
                    setView('delete');
                  }}
                >
                  {guest ? 'Delete my data' : 'Delete my account and all my data'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
