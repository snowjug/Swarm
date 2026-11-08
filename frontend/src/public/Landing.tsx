import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, Notice } from '../design/ui';
import type { PublicProviderInfo, PublicSession } from '../../../shared/public';
import { POSITIONING_STATEMENT } from '../lib/product';
import { Faq } from './Faq';
import { guestModeOf, noteWords } from './guest';
import { GuestStart } from './GuestStart';
import type { NoteKind } from './problems';
import { PublicFrame } from './PublicFrame';
import { SignInCard } from './SignInCard';

const STEPS = [
  { title: 'Ask', text: 'Write your what-if question in a few lines.' },
  { title: 'Add evidence', text: 'Paste notes or add documents. Each claim keeps its source.' },
  {
    title: 'Read the scenarios',
    text: 'See how different futures could unfold, and compare them.',
  },
] as const;

const names = (providers: PublicProviderInfo[]): string =>
  new Intl.ListFormat('en', { style: 'long', type: 'disjunction' }).format(
    providers.map((provider) => provider.label),
  );

/**
 * The first screen of a visitor who is not signed in: what this is, the way in, and where to read more. The way in is
 * "Try it free" (which opens the sign-in) or, when the server lets visitors in as guests, "Try it now" with sign-in as a
 * quiet second line. `onStarted` is how a guest session that was just started is read by the page: see `GuestStart`.
 */
export function Landing({
  session,
  note,
  onStarted,
}: {
  session: PublicSession;
  note: NoteKind | null;
  onStarted?: () => Promise<boolean>;
}) {
  const [signingIn, setSigningIn] = useState(false);
  const guestMode = guestModeOf(session);
  // A site that is guest-only has no sign-in to offer, and says nothing of one.
  const signInOffered = !guestMode || session.providers.length > 0;
  return (
    <PublicFrame
      session={session}
      action={
        guestMode ? undefined : (
          <Button variant="ghost" size="sm" onClick={() => setSigningIn(true)}>
            Sign in
          </Button>
        )
      }
    >
      <div className="sw-pub-landing" data-testid="landing">
        {note && (
          <div className="sw-pub-landing__note" data-testid="landing-note" data-kind={note}>
            <Notice tone={note === 'disabled' ? 'caution' : 'info'}>
              {noteWords(note, session)}
            </Notice>
          </div>
        )}
        <section className="sw-pub-hero" aria-labelledby="sw-pub-hero-title">
          <p className="sw-eyebrow">Free to try</p>
          <h1 id="sw-pub-hero-title" className="sw-pub-hero__title">
            Explore what could happen next.
          </h1>
          <p className="sw-pub-hero__lead">
            A what-if question asks what might follow a change: a new price, a new policy, a launch.
            You bring the evidence. Swarm turns it into scenarios you can read, compare and
            question.
          </p>
          <p className="sw-pub-hero__lead">{POSITIONING_STATEMENT}</p>
          {guestMode ? (
            <>
              <GuestStart session={session} onStarted={onStarted} />
              {session.providers.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="signin-secondary"
                  onClick={() => setSigningIn(true)}
                >
                  Or sign in with {names(session.providers)}
                </Button>
              )}
              <p className="sw-caption">
                Free with a small daily limit. Want more? Use your own Google Gemini key. Once you
                are in, you can open a ready-made sample that uses no model.
              </p>
            </>
          ) : (
            <>
              <div className="sw-pub-hero__actions">
                <Button
                  variant="accent"
                  size="lg"
                  data-testid="try-it-free"
                  iconEnd={<ArrowRight size={18} aria-hidden="true" />}
                  onClick={() => setSigningIn(true)}
                >
                  Try it free
                </Button>
              </div>
              <p className="sw-caption">
                Free with a small daily limit. Want more? Use your own Google Gemini key. After you
                sign in, you can open a ready-made sample that uses no model.
              </p>
            </>
          )}
        </section>
        <section className="sw-pub-how" aria-labelledby="sw-pub-how-title">
          <h2 id="sw-pub-how-title" className="sw-title">
            Evidence in, scenarios out
          </h2>
          <ol className="sw-pub-how__steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="sw-pub-how__step">
                <span className="sw-pub-how__num num" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="sw-heading">{step.title}</h3>
                <p className="sw-caption">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <Faq session={session} />
      </div>
      {signInOffered && (
        <Dialog open={signingIn} onOpenChange={setSigningIn}>
          <DialogContent
            title="Sign in to Swarm"
            description="Choose an account to continue."
            className="sw-pub-dialog"
            footer={
              <DialogClose asChild>
                <Button variant="ghost">Not now</Button>
              </DialogClose>
            }
          >
            <SignInCard session={session} />
          </DialogContent>
        </Dialog>
      )}
    </PublicFrame>
  );
}
