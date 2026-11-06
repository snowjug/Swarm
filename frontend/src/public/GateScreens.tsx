import { Ban, DoorClosed, MailWarning, ShieldAlert, UserX, Wrench, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Aurora } from '../design/ambient/Aurora';
import { Button, Orbit } from '../design/ui';
import type { PublicSession, PublicSignInProblem } from '../../../shared/public';
import { PageLink } from './PageLink';
import { PAGE_PATHS } from './pages';
import { SERVICE_UNREACHABLE, SIGN_IN_WORDS } from './problems';
import { SignInCard } from './SignInCard';
import { StandaloneCard } from './StandaloneCard';

const ICONS: Record<PublicSignInProblem, LucideIcon> = {
  failed: ShieldAlert,
  closed: DoorClosed,
  unverified: MailWarning,
  disabled: UserX,
  blocked: Ban,
};

const TONES: Record<PublicSignInProblem, 'accent' | 'caution' | 'critical'> = {
  failed: 'caution',
  closed: 'accent',
  unverified: 'caution',
  disabled: 'critical',
  blocked: 'critical',
};

/**
 * Shown when the server sent the browser back after a sign-in that did not produce a session. It says what happened in
 * plain words and, where trying again can work, puts the way in on the same screen.
 */
export function SignInProblemPage({
  kind,
  session,
}: {
  kind: PublicSignInProblem;
  session: PublicSession;
}) {
  const words = SIGN_IN_WORDS[kind];
  return (
    <StandaloneCard
      icon={ICONS[kind]}
      tone={TONES[kind]}
      title={words.title}
      testId="signin-problem"
      role="alert"
      data={{ problem: kind }}
    >
      <p className="sw-stand__text">{words.body}</p>
      {words.retry && <SignInCard session={session} />}
      <div className="sw-stand__actions">
        <PageLink to="/" className="sw-btn sw-btn--ghost">
          <span className="sw-btn__label">Back to the start</span>
        </PageLink>
      </div>
    </StandaloneCard>
  );
}

/** The session answer was 503: the service is switched to maintenance. */
export function MaintenanceScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <StandaloneCard
      icon={Wrench}
      tone="caution"
      title="Swarm is down for maintenance"
      testId="maintenance"
    >
      <p className="sw-stand__text">
        We are making changes and will be back soon. The status page has the latest.
      </p>
      <div className="sw-stand__actions">
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
        <PageLink to={PAGE_PATHS.status} className="sw-btn sw-btn--ghost">
          <span className="sw-btn__label">See the status</span>
        </PageLink>
      </div>
    </StandaloneCard>
  );
}

/** The session could not be read at all: no answer, or an answer that is not ours. */
export function UnreachableScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <StandaloneCard
      icon={WifiOff}
      tone="caution"
      title={SERVICE_UNREACHABLE}
      testId="unreachable"
      role="alert"
    >
      <p className="sw-stand__text">
        Check your connection, then try again. If it keeps happening, the status page may say why.
      </p>
      <div className="sw-stand__actions">
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
        <PageLink to={PAGE_PATHS.status} className="sw-btn sw-btn--ghost">
          <span className="sw-btn__label">See the status</span>
        </PageLink>
      </div>
    </StandaloneCard>
  );
}

/** While the first answer is on its way. */
export function WaitingScreen() {
  return (
    <>
      <Aurora />
      <div className="sw-pub-wait" aria-busy="true" data-testid="gate-loading">
        <Orbit size={32} label="Loading Swarm" />
      </div>
    </>
  );
}
