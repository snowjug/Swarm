import { lazy, Suspense } from 'react';
import { MotionRoot } from '../design/motion';
import { ToastProvider, TooltipProvider } from '../design/ui';
import { SignInProblem } from '../panels/SignInProblem';
import { signInProblem } from '../lib/signIn';
import { isPublicEdition } from '../public/edition';
import { Application } from './Application';
import { UnsavedWorkProvider } from './UnsavedWorkProvider';

// The public edition's pages are fetched only by a page that the server marked as the public edition.
const PublicGate = lazy(() => import('../public/PublicGate'));

/**
 * The providers every screen needs (motion, tooltips, toasts, the question asked before work that is not saved is
 * left) and the one screen that is not the application: a sign-in that did not produce a session is explained on its
 * own, not behind the shell. A page that carries the public edition's tag is run by the public gate instead, which
 * wraps the same application.
 */
export default function Root() {
  const publicEdition = isPublicEdition();
  const problem = publicEdition ? null : signInProblem(window.location.search);
  return (
    <MotionRoot>
      <TooltipProvider>
        <ToastProvider>
          <UnsavedWorkProvider>
            {publicEdition ? (
              <Suspense fallback={null}>
                <PublicGate>
                  <Application />
                </PublicGate>
              </Suspense>
            ) : problem ? (
              <SignInProblem kind={problem} />
            ) : (
              <Application />
            )}
          </UnsavedWorkProvider>
        </ToastProvider>
      </TooltipProvider>
    </MotionRoot>
  );
}
