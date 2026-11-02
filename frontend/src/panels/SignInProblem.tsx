import { useEffect } from 'react';
import { ArrowRight, ShieldAlert, UserRoundX } from 'lucide-react';
import { Aurora } from '../design/ambient/Aurora';
import { Mark } from '../design/ui/Mark';
import type { SignInProblemKind } from '../lib/signIn';
import './standalone.css';

const WORDS = {
  failed: {
    title: 'Sign-in did not complete',
    body: 'Microsoft sign-in was cancelled, expired or could not be confirmed, so nothing was signed in. Nothing about the attempt was kept. Try again.',
    Icon: ShieldAlert,
    tone: 'caution',
  },
  norole: {
    title: 'You are signed in, but have no Swarm role',
    body: 'Microsoft recognised you, but nobody has given you a Swarm role. Ask a Swarm administrator to assign one, then sign in again.',
    Icon: UserRoundX,
    tone: 'accent',
  },
} as const;

/**
 * Shown instead of the console when the server sent the browser back after a sign-in that did not
 * produce a session. It says what happened and offers one way forward: the sign-in address of the
 * server, with no return address, so that a failing sign-in cannot loop.
 */
export function SignInProblem({ kind }: { kind: SignInProblemKind }) {
  const words = WORDS[kind];
  const Icon = words.Icon;

  useEffect(() => {
    const before = document.title;
    document.title = `${words.title} · Swarm`;
    return () => {
      document.title = before;
    };
  }, [words.title]);

  return (
    <>
      <Aurora />
      <div className="sw-stand">
        <header className="sw-stand__brand">
          <Mark size={26} />
          <span className="sw-stand__word">Swarm</span>
        </header>
        <main id="main-content" className="sw-stand__main">
          <div
            className="sw-stand__card sw-glass sw-glass--overlay sw-rise"
            role="alert"
            data-tone={words.tone}
          >
            <span className="sw-stand__badge" aria-hidden="true">
              <Icon size={22} />
            </span>
            <h1 className="sw-stand__title">{words.title}</h1>
            <p className="sw-stand__text">{words.body}</p>
            <div className="sw-stand__actions">
              <a className="sw-btn sw-btn--primary sw-btn--lg" href="/auth/login">
                <span className="sw-btn__label">Sign in with Microsoft</span>
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
