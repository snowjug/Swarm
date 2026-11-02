import type { CSSProperties } from 'react';
import {
  ArrowRight,
  Compass,
  FileText,
  ListChecks,
  OctagonAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import { BRIEF_SECTION_IDS, BRIEF_SECTION_TITLES } from '../../../../shared/brief';
import { Button, EmptyState, Notice, Orbit, Skeleton } from '../../design/ui';
import { POSITIONING_STATEMENT } from '../../lib/product';
import { dayLabel } from './model/format';
import './states.css';

/** What stands where the brief will be while it is read: the shape of the first screen, with light passing over it. */
export function BriefLoading() {
  return (
    <section className="sw-decide-state" aria-busy="true" aria-label="Loading the decision brief">
      <p className="sr-only" role="status">
        Loading the decision brief
      </p>
      <div className="sw-decide-skel" aria-hidden="true">
        <Skeleton height="1.1rem" width="9rem" radius="var(--r-pill)" />
        <Skeleton height="1.4rem" width="min(34rem, 80%)" />
        <div className="sw-decide-skel__verdict">
          <Skeleton
            height="clamp(2.4rem, 5vw, 4rem)"
            width="min(46rem, 100%)"
            radius="var(--r-md)"
          />
          <Skeleton
            height="clamp(2.4rem, 5vw, 4rem)"
            width="min(32rem, 78%)"
            radius="var(--r-md)"
          />
        </div>
        <div className="sw-decide-skel__numerals">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <Skeleton height="0.9rem" width="70%" />
              <Skeleton height="clamp(3rem, 6vw, 5.5rem)" width="80%" radius="var(--r-md)" />
              <Skeleton height="0.8rem" width="55%" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function BriefFailed({
  message,
  onRetry,
  busy,
}: {
  message: string;
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <section className="sw-decide-state sw-decide-state--center" role="alert">
      <EmptyState
        level={1}
        icon={<OctagonAlert size={26} aria-hidden="true" />}
        title="The decision brief could not be loaded"
        action={
          <Button variant="glass" busy={busy} onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {message} Nothing has been lost: the brief is stored on the server.
      </EmptyState>
    </section>
  );
}

/** There is no finished comparison, so there is nothing to decide from yet. */
export function NoAnalysis({
  onSimulate,
  onReport,
}: {
  onSimulate: () => void;
  onReport: (() => void) | null;
}) {
  return (
    <section className="sw-decide-state sw-decide-state--center">
      <EmptyState
        level={1}
        icon={<Compass size={26} aria-hidden="true" />}
        title="Nothing to decide from yet"
        action={
          <div className="sw-decide-state__actions">
            <Button
              variant="primary"
              iconEnd={<ArrowRight size={16} aria-hidden="true" />}
              onClick={onSimulate}
            >
              Open Simulate
            </Button>
            {onReport && (
              <Button variant="glass" onClick={onReport}>
                Detailed report
              </Button>
            )}
          </div>
        }
      >
        A decision brief is written from a finished comparison: the scenario run many times with
        different seeds and set against a baseline. There is none in this exploration yet.
      </EmptyState>
    </section>
  );
}

const WILL_HOLD = [
  { icon: Sparkles, label: 'The answer', text: 'What happened, in the simulation’s own numbers.' },
  { icon: Users, label: 'Who moved', text: 'Which groups, and how steadily.' },
  { icon: ListChecks, label: 'What to do', text: 'Recommendations, ranked.' },
  {
    icon: FileText,
    label: 'How to check it',
    text: 'The real-world checks that would settle what is left.',
  },
] as const;

/** A finished comparison and no brief: the one thing to do is to write it. */
export function WriteBrief({
  completedAt,
  may,
  busy,
  error,
  onWrite,
  onRetry,
}: {
  completedAt: string | null;
  may: boolean;
  busy: boolean;
  error: string | null;
  onWrite: () => void;
  onRetry: () => void;
}) {
  return (
    <section className="sw-decide-state sw-decide-write" aria-labelledby="write-title">
      <p className="sw-eyebrow sw-rise">Decision brief</p>
      <h1
        id="write-title"
        className="sw-display sw-decide-write__title sw-rise"
        style={{ '--i': 1 } as CSSProperties}
      >
        Turn the comparison into a <em>decision</em>.
      </h1>
      <p className="sw-lead sw-decide-write__lead sw-rise" style={{ '--i': 2 } as CSSProperties}>
        The brief gives the answer first, then why, what to do and how to check it. It is assembled
        by rules from this exploration’s own data, and every statement says where it comes from.
      </p>
      {error && (
        <Notice
          tone="error"
          title="The brief could not be made"
          action={
            may ? (
              <Button size="sm" variant="glass" busy={busy} onClick={onRetry}>
                Try again
              </Button>
            ) : null
          }
        >
          {error}
        </Notice>
      )}
      <div className="sw-decide-write__act sw-rise" style={{ '--i': 3 } as CSSProperties}>
        {may ? (
          <Button
            variant="accent"
            size="lg"
            icon={<Sparkles size={18} aria-hidden="true" />}
            busy={busy}
            busyLabel="Writing the brief"
            onClick={onWrite}
          >
            Write the brief
          </Button>
        ) : (
          <p className="sw-decide-write__note">
            Your role can read this exploration but not write the brief. Ask someone who can edit
            it.
          </p>
        )}
        <p className="sw-decide-write__note">
          {completedAt
            ? `The comparison finished ${dayLabel(completedAt)}. `
            : 'There is a finished comparison. '}
          {POSITIONING_STATEMENT}
        </p>
      </div>
      <ul className="sw-decide-write__list" role="list" aria-label="What the brief holds">
        {WILL_HOLD.map(({ icon: Icon, label, text }, index) => (
          <li key={label} className="sw-rise" style={{ '--i': index + 4 } as CSSProperties}>
            <span className="sw-decide-write__icon" aria-hidden="true">
              <Icon size={17} />
            </span>
            <strong>{label}</strong>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The brief is being written: the page it will become, and the chapters it will hold, with light passing over them. */
export function Writing() {
  return (
    <section
      className="sw-decide-state sw-decide-gen"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="sw-decide-gen__head">
        <Orbit size={40} label="Writing the brief" />
        <div>
          <p className="sw-eyebrow">Decision brief</p>
          <h1 className="sw-display sw-decide-gen__title">Writing the brief</h1>
          <p className="sw-lead">
            Reading the comparison, the stakeholders and the evidence, and setting down the answer.
          </p>
        </div>
      </div>
      <div className="sw-decide-skel" aria-hidden="true">
        <div className="sw-decide-skel__verdict">
          <Skeleton
            height="clamp(2.2rem, 4.4vw, 3.4rem)"
            width="min(44rem, 100%)"
            radius="var(--r-md)"
          />
          <Skeleton
            height="clamp(2.2rem, 4.4vw, 3.4rem)"
            width="min(30rem, 74%)"
            radius="var(--r-md)"
          />
        </div>
        <div className="sw-decide-skel__numerals">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <Skeleton height="0.9rem" width="70%" />
              <Skeleton height="clamp(2.6rem, 5vw, 4.4rem)" width="76%" radius="var(--r-md)" />
            </div>
          ))}
        </div>
      </div>
      <ol className="sw-decide-gen__chapters" aria-hidden="true">
        {BRIEF_SECTION_IDS.filter((id) => id !== 'executive-answer').map((id, index) => (
          <li key={id} style={{ '--i': index } as CSSProperties}>
            {BRIEF_SECTION_TITLES[id]}
          </li>
        ))}
      </ol>
    </section>
  );
}
