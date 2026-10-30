import { FlaskConical } from 'lucide-react';
import type { SignInProblemKind } from '../lib/signIn';

const WORDS: Record<SignInProblemKind, { title: string; body: string }> = {
  failed: {
    title: 'Sign-in did not complete',
    body: 'Microsoft sign-in was cancelled, expired or could not be confirmed, so nothing was signed in. Nothing about the attempt was kept. Try again.',
  },
  norole: {
    title: 'You are signed in, but have no Swarm role',
    body: 'Microsoft recognised you, but nobody has given you a Swarm role. Ask a Swarm administrator to assign one, then sign in again.',
  },
};

/**
 * Shown instead of the console when the server sent the browser back after a sign-in that did not
 * produce a session. It says what happened and offers one way forward: the sign-in address of the
 * server, with no return address, so that a failing sign-in cannot loop.
 */
export function SignInProblem({ kind }: { kind: SignInProblemKind }) {
  const words = WORDS[kind];
  return (
    <div className="app-shell">
      <main id="main-content" className="main-content entry-content sign-in-problem">
        <div className="sign-in-card" role="alert">
          <span className="brand-mark">
            <FlaskConical size={18} aria-hidden="true" />
          </span>
          <h1>{words.title}</h1>
          <p>{words.body}</p>
          <a className="button button-black" href="/auth/login">
            Sign in with Microsoft
          </a>
        </div>
      </main>
    </div>
  );
}
