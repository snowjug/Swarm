import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, errorMessage, onAcceptedChange } from '../api';
import { useToast } from '../design/ui';
import type { PublicSession } from '../../../shared/public';
import { signOutOfPublic } from './accountActions';
import { AccountPanel } from './AccountPanel';
import { browser } from './browser';
import { ByokPanel } from './ByokPanel';
import { LimitReached } from './LimitReached';
import { problemOf, type Problem } from './problems';
import { publicApi } from './publicApi';
import { PublicMenu } from './PublicMenu';
import { onPublicSignal } from './runtime';
import { createSample } from './sample';
import { PublicSlotsContext } from './slots';
import { dismissWelcome, welcomeDismissed } from './tabState';
import { UsageMeter } from './UsageMeter';
import { useUsage } from './useUsage';
import { Welcome } from './Welcome';
import './public.css';

/**
 * Everything the public edition adds around the application for a person who is signed in: the meter in the top bar,
 * the account part of the settings menu, the panels for the account and for their own key, the card that tells them why a
 * request was refused, and the sample for an account with nothing in it. The application itself is `children`, unchanged.
 */
export function PublicChrome({
  session,
  children,
}: {
  session: PublicSession;
  children: ReactNode;
}) {
  const toast = useToast();
  const { usage, refresh } = useUsage();
  const [panel, setPanel] = useState<'account' | 'byok' | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [sampling, setSampling] = useState(false);

  // The API client says a request was refused for a reason the person can do something about. A request that is asked
  // again and again (a poll) is not allowed to read the meter again and again.
  const lastRefusal = useRef<{ code: string; at: number } | null>(null);
  useEffect(
    () =>
      onPublicSignal((signal) => {
        if (signal.kind !== 'refused') return;
        const found = problemOf(signal.code);
        if (!found) return;
        setProblem(found);
        const before = lastRefusal.current;
        const now = Date.now();
        lastRefusal.current = { code: signal.code, at: now };
        if (!before || before.code !== signal.code || now - before.at > 10_000) refresh();
      }),
    [refresh],
  );

  // Back from the new project with the Back button finds the page as it was left: the sample is not still being opened.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setSampling(false);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  // The first screen of an account with nothing in it offers the sample, once.
  useEffect(() => {
    if (welcomeDismissed() || new URLSearchParams(window.location.search).has('project')) return;
    const controller = new AbortController();
    publicApi.account(controller.signal).then(
      (account) => setWelcome(account.projects.count === 0),
      () => undefined,
    );
    const stop = onAcceptedChange((path) => {
      if (path === '/api/projects') setWelcome(false);
    });
    return () => {
      controller.abort();
      stop();
    };
  }, []);

  const trySample = useCallback(async () => {
    if (sampling) return;
    setSampling(true);
    try {
      const id = await createSample();
      dismissWelcome();
      // The page is reloaded on the new project, so that the whole application reads it afresh.
      browser.assign(`/?project=${encodeURIComponent(id)}`);
    } catch (failure) {
      setSampling(false);
      // A refusal the person is already told about, in a card of its own, is not told again.
      if (failure instanceof ApiError && problemOf(failure.code)) return;
      toast({
        title: 'The sample could not be opened',
        description: errorMessage(failure),
        tone: 'error',
      });
    }
  }, [sampling, toast]);

  const signOut = useCallback(async () => {
    try {
      await signOutOfPublic();
    } catch (failure) {
      toast({
        title: 'Could not sign out',
        description: `${errorMessage(failure)} You are still signed in.`,
        tone: 'error',
      });
    }
  }, [toast]);

  const slots = useMemo(
    () => ({
      meter: (
        <UsageMeter
          usage={usage}
          byokEnabled={session.byokEnabled}
          limitTestId={problem === null}
          onManageKey={() => setPanel('byok')}
          onRecheck={refresh}
        />
      ),
      menu: (
        <PublicMenu
          emailMasked={session.user?.emailMasked ?? null}
          byokEnabled={session.byokEnabled}
          sampleBusy={sampling}
          onAccount={() => setPanel('account')}
          onKey={() => setPanel('byok')}
          onSample={() => void trySample()}
          onSignOut={() => void signOut()}
        />
      ),
    }),
    [usage, session, problem, sampling, refresh, trySample, signOut],
  );

  const act = (found: Problem) => {
    if (found.action.kind === 'byok') setPanel('byok');
    else if (found.action.kind === 'recheck') {
      refresh();
      setProblem(null);
    } else setProblem(null);
  };

  return (
    <PublicSlotsContext.Provider value={slots}>
      {children}
      {welcome && !problem && (
        <Welcome
          busy={sampling}
          onTry={() => void trySample()}
          onDismiss={() => {
            dismissWelcome();
            setWelcome(false);
          }}
        />
      )}
      {problem && (
        <LimitReached
          problem={problem}
          onAct={() => act(problem)}
          onDismiss={() => setProblem(null)}
        />
      )}
      {panel === 'byok' && (
        <ByokPanel
          open
          onOpenChange={(open) => !open && setPanel(null)}
          byokEnabled={session.byokEnabled}
          onChanged={() => setProblem(null)}
        />
      )}
      {panel === 'account' && (
        <AccountPanel open onOpenChange={(open) => !open && setPanel(null)} session={session} />
      )}
    </PublicSlotsContext.Provider>
  );
}
