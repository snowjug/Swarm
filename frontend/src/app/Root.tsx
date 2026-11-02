import { MotionRoot } from '../design/motion';
import { ToastProvider, TooltipProvider } from '../design/ui';
import { SignInProblem } from '../panels/SignInProblem';
import { signInProblem } from '../lib/signIn';
import { Application } from './Application';
import { UnsavedWorkProvider } from './UnsavedWorkProvider';

/**
 * The providers every screen needs (motion, tooltips, toasts, the question asked before work that is not saved is
 * left) and the one screen that is not the application: a sign-in that did not produce a session is explained on its
 * own, not behind the shell.
 */
export default function Root() {
  const problem = signInProblem(window.location.search);
  return (
    <MotionRoot>
      <TooltipProvider>
        <ToastProvider>
          <UnsavedWorkProvider>
            {problem ? <SignInProblem kind={problem} /> : <Application />}
          </UnsavedWorkProvider>
        </ToastProvider>
      </TooltipProvider>
    </MotionRoot>
  );
}
