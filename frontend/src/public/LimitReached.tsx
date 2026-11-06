import { X } from 'lucide-react';
import { Button, IconButton } from '../design/ui';
import type { Problem } from './problems';

/**
 * What a refused request is told to the person as: a calm card with the reason in words and one next step, under the top
 * bar. It stays until it is dealt with, because a toast is gone before a person has decided what to do.
 */
export function LimitReached({
  problem,
  onAct,
  onDismiss,
}: {
  problem: Problem;
  onAct: () => void;
  onDismiss: () => void;
}) {
  const quiet = problem.action.kind === 'dismiss';
  return (
    <div
      className="sw-limit sw-glass sw-glass--overlay"
      role="status"
      data-testid="limit-reached"
      data-reason={problem.reason}
      data-code={problem.code}
    >
      <div className="sw-limit__text">
        <strong className="sw-limit__title">{problem.title}</strong>
        <p>{problem.message}</p>
      </div>
      <div className="sw-limit__actions">
        <Button
          size="sm"
          variant={quiet ? 'glass' : 'primary'}
          data-testid="limit-action"
          onClick={onAct}
        >
          {problem.action.label}
        </Button>
        {!quiet && (
          <IconButton label="Dismiss" size="sm" onClick={onDismiss}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
