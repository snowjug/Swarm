import { Button, Notice } from '../design/ui';
import type { useTurnstile } from './useTurnstile';

/** The bot check where the server asks for it: its widget, what it is doing, and a way to load it again. */
export function BotCheck({ check }: { check: ReturnType<typeof useTurnstile> }) {
  return (
    <div className="sw-pub-signin__check">
      <div ref={check.container} />
      {check.phase === 'loading' && (
        <p className="sw-caption" role="status">
          Checking that you are a person…
        </p>
      )}
      {check.phase === 'failed' && (
        <Notice
          tone="error"
          action={
            <Button size="sm" variant="glass" onClick={check.retry}>
              Try again
            </Button>
          }
        >
          The check that you are a person did not load.
        </Notice>
      )}
    </div>
  );
}
