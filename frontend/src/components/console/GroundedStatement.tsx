import { CLAIM_KIND_LABELS, type GroundedClaim } from '../../../../shared/grounding';
import type { Inspection } from '../../lib/graph';
import { quoteLabel } from '../../lib/grounding';
import { Citations } from './Citations';
import { QuoteBlock } from './QuoteBlock';
import { VerdictBadge } from './Verdict';

/** One checked statement. Every part is plain text; the server's reason is never interpreted as markup. */
export function GroundedStatement({
  claim,
  onInspect,
}: {
  claim: GroundedClaim;
  onInspect: (selection: Inspection) => void;
}) {
  const cited = claim.sourceIds.length + claim.memoryIds.length > 0;
  return (
    <li className={`claim claim-${claim.verdict}`}>
      <div className="claim-meta">
        <span className="claim-kind">{CLAIM_KIND_LABELS[claim.kind] ?? claim.kind}</span>
        <VerdictBadge verdict={claim.verdict} />
        <span className="mono muted claim-id">{claim.id}</span>
      </div>
      <p className="claim-text">{claim.text}</p>
      {claim.reason && (
        <p className="claim-reason">
          <strong>Why this verdict</strong> {claim.reason}
        </p>
      )}
      {claim.quote && <QuoteBlock label={quoteLabel(claim)}>{claim.quote}</QuoteBlock>}
      {cited ? (
        <Citations sourceIds={claim.sourceIds} memoryIds={claim.memoryIds} onInspect={onInspect} />
      ) : (
        <p className="claim-reason">No source or simulated memory is cited for this statement</p>
      )}
    </li>
  );
}
