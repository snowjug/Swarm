import type { ReactNode } from 'react';
import { m } from 'motion/react';
import { Check, X } from 'lucide-react';
import { SPRING } from '../../design/motion';
import { Button, Input } from '../../design/ui';
import './ActionBar.css';

/**
 * A bar that floats at the foot of the screen while there is a decision in front of the person: a text
 * they are writing, a rewrite waiting for yes or no. It arrives on a spring and leaves quickly.
 */
export function ActionBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sw-actionbar__dock">
      <m.div
        className="sw-actionbar sw-glass sw-glass--overlay"
        role="region"
        aria-label={label}
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98, transition: { duration: 0.14 } }}
        transition={SPRING.smooth}
      >
        {children}
      </m.div>
    </div>
  );
}

/** Saving what is written, as a new version; dropping it; and, if the person likes, saying why. */
export function EditBar({
  nextVersion,
  state,
  reason,
  problem,
  saving,
  blocked,
  onReason,
  onSave,
  onDiscard,
}: {
  nextVersion: number;
  state: 'clean' | 'dirty' | 'behind';
  reason: string;
  /** Why it cannot be saved yet, when it is something the person can mend. */
  problem: string | null;
  saving: boolean;
  /** The document cannot be changed now. */
  blocked: boolean;
  onReason: (reason: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const dirty = state !== 'clean';
  return (
    <ActionBar label="Save your changes">
      <p className="sw-actionbar__status" data-state={state}>
        <span className="sw-actionbar__dot" aria-hidden="true" />
        {state === 'behind'
          ? 'A newer version exists'
          : dirty
            ? 'Unsaved changes'
            : 'No changes yet'}
        {problem && dirty && <span className="sw-actionbar__problem"> · {problem}</span>}
      </p>
      <label className="sw-actionbar__why">
        <span className="sr-only">Why you changed it (optional)</span>
        <Input
          value={reason}
          maxLength={300}
          placeholder="Why? (optional)"
          disabled={saving || blocked}
          onChange={(event) => onReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSave();
            }
          }}
        />
      </label>
      <div className="sw-actionbar__buttons">
        <Button
          variant="ghost"
          size="sm"
          icon={<X size={15} aria-hidden="true" />}
          disabled={saving}
          onClick={onDiscard}
        >
          {dirty ? 'Discard' : 'Cancel'}
        </Button>
        <Button
          variant="accent"
          size="sm"
          icon={<Check size={15} strokeWidth={2.4} aria-hidden="true" />}
          busy={saving}
          busyLabel="Saving"
          disabled={!dirty || problem !== null || blocked}
          onClick={onSave}
        >
          {state === 'behind'
            ? `Save over version ${nextVersion - 1}`
            : `Save as version ${nextVersion}`}
        </Button>
      </div>
    </ActionBar>
  );
}

/** A rewrite waiting for yes or no: the text it would put in the place of this one. */
export function ProposalBar({
  summary,
  deciding,
  onReject,
  onAccept,
}: {
  summary: ReactNode;
  deciding: 'accept' | 'reject' | null;
  onReject: () => void;
  onAccept: () => void;
}) {
  return (
    <ActionBar label="Decide on the rewrite">
      <p className="sw-actionbar__status" data-state="proposal">
        <span className="sw-actionbar__dot" aria-hidden="true" />
        {summary}
      </p>
      <div className="sw-actionbar__buttons">
        <Button
          variant="ghost"
          size="sm"
          icon={<X size={15} aria-hidden="true" />}
          busy={deciding === 'reject'}
          busyLabel="Rejecting"
          disabled={deciding !== null}
          onClick={onReject}
        >
          Reject
        </Button>
        <Button
          variant="accent"
          size="sm"
          icon={<Check size={15} strokeWidth={2.4} aria-hidden="true" />}
          busy={deciding === 'accept'}
          busyLabel="Accepting"
          disabled={deciding !== null}
          onClick={onAccept}
        >
          Accept the rewrite
        </Button>
      </div>
    </ActionBar>
  );
}
