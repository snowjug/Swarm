import { firmnessText } from '../../lib/transparency';

/**
 * The short reason a model-run proxy gave for an action, and how firm it said its stance was.
 * Both are text the model chose to write, not a window into hidden reasoning.
 */
export function StatedReason({
  rationale,
  confidence,
}: {
  rationale?: string | null;
  confidence?: number | null;
}) {
  const reason = rationale?.trim();
  const firmness = firmnessText(confidence);
  if (!reason && !firmness) return null;
  return (
    <div className="stated-reason">
      {reason && (
        <>
          <p className="stated-reason-text">
            <span className="stated-reason-label">Stated reason</span>{' '}
            <span className="preserve-text">{reason}</span>
          </p>
          <p className="stated-reason-note">
            A short explanation the model chose to give, not hidden reasoning
          </p>
        </>
      )}
      {firmness && <p className="stated-reason-note stated-reason-firmness">{firmness}</p>}
    </div>
  );
}
