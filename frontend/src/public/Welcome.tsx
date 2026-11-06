import { Button } from '../design/ui';

/** For an account with nothing in it yet: a sample that needs no model, and so costs nothing, with the way to open it. */
export function Welcome({
  busy,
  onTry,
  onDismiss,
}: {
  busy: boolean;
  onTry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="sw-welcome sw-glass sw-glass--overlay"
      role="region"
      aria-label="Welcome"
      data-testid="welcome"
    >
      <div className="sw-welcome__text">
        <strong>New here?</strong>
        <p>
          Open a sample to see how it works. It runs on Swarm&apos;s own rules and uses no model, so
          it costs nothing.
        </p>
      </div>
      <div className="sw-welcome__actions">
        <Button
          variant="accent"
          size="sm"
          data-testid="try-sample"
          busy={busy}
          busyLabel="Opening the sample"
          onClick={onTry}
        >
          Try a sample
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
