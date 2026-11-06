import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import type { PublicSession } from '../../../shared/public';
import { AdminPage } from './AdminPage';
import { FaqPage } from './Faq';
import {
  MaintenanceScreen,
  SignInProblemPage,
  UnreachableScreen,
  WaitingScreen,
} from './GateScreens';
import { Landing } from './Landing';
import { LegalPage } from './LegalPage';
import { pageOfPath, usePublicAddress } from './pages';
import { publicSignInProblem } from './problems';
import { PublicChrome } from './PublicChrome';
import { setPublicEdition } from './runtime';
import { StatusPage } from './StatusPage';
import { useGateSession } from './useGateSession';

/** A person who is signed in: the application, with what the public edition adds around it. */
function SignedIn({ session, children }: { session: PublicSession; children: ReactNode }) {
  // A sign-in that did succeed must not leave its problem on the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('signin')) return;
    url.searchParams.delete('signin');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  return <PublicChrome session={session}>{children}</PublicChrome>;
}

/**
 * What a visitor of the public edition sees. It asks the server once who the visitor is: a person who is signed in gets
 * the application (`children`) with the public additions, anyone else gets the landing page, and a service that is down
 * or out of reach gets a screen that says so. The pages that need no session (status, FAQ, terms, privacy) are shown
 * whatever the answer is.
 */
export default function PublicGate({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    setPublicEdition(true);
    return () => setPublicEdition(false);
  }, []);
  const address = usePublicAddress();
  const { gate, retry } = useGateSession();
  const at = address.indexOf('?');
  const page = pageOfPath(at < 0 ? address : address.slice(0, at));
  const search = at < 0 ? '' : address.slice(at);
  const session = gate.phase === 'ready' ? gate.session : null;

  if (page === 'status') return <StatusPage session={session} />;
  if (page === 'faq') return <FaqPage session={session} />;
  if (page === 'terms' || page === 'privacy') return <LegalPage doc={page} session={session} />;
  if (gate.phase === 'loading') return <WaitingScreen />;
  if (gate.phase === 'maintenance') return <MaintenanceScreen onRetry={retry} />;
  if (gate.phase === 'unreachable') return <UnreachableScreen onRetry={retry} />;
  if (page === 'admin') return <AdminPage session={gate.session} />;
  if (!gate.session.signedIn) {
    const problem = publicSignInProblem(search);
    return problem ? (
      <SignInProblemPage kind={problem} session={gate.session} />
    ) : (
      <Landing session={gate.session} note={gate.note} />
    );
  }
  return <SignedIn session={gate.session}>{children}</SignedIn>;
}
