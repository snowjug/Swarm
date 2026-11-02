import { MessageCircleQuestion } from 'lucide-react';
import {
  CLAIM_KIND_LABELS,
  SUPPORT_VERDICT_LABELS,
  type GroundedClaim,
} from '../../../../shared/grounding';
import { Button, Chip, Disclosure } from '../../design/ui';
import { needsAttention, quoteLabel } from '../../lib/grounding';
import { VERDICT_ICONS, VERDICT_TONES } from '../studio/glyphs';
import { Citations } from './Citations';
import { askAbout, describeChecks } from './model';
import './Review.css';

/**
 * One checked statement: what it says, how well the cited passage backs it, the words it quotes, and, one
 * press away, why. Every part is plain text; the server's reason is never read as markup. A statement the
 * sources contradict opens with its reason showing, because that is the one to read.
 */
export function Statement({
  claim,
  onAsk,
}: {
  claim: GroundedClaim;
  onAsk: (message: string) => void;
}) {
  const Icon = VERDICT_ICONS[claim.verdict] ?? VERDICT_ICONS.unchecked;
  const attention = needsAttention(claim.verdict);
  const cited = claim.sourceIds.length + claim.memoryIds.length > 0;
  const checks = describeChecks(claim.checks);
  return (
    <div className="sw-st" data-verdict={claim.verdict}>
      <p className="sw-st__text">{claim.text}</p>
      <div className="sw-st__meta">
        <Chip
          size="sm"
          tone={VERDICT_TONES[claim.verdict] ?? 'neutral'}
          icon={<Icon aria-hidden="true" />}
        >
          {SUPPORT_VERDICT_LABELS[claim.verdict] ?? claim.verdict}
        </Chip>
        <Chip size="sm">{CLAIM_KIND_LABELS[claim.kind] ?? claim.kind}</Chip>
        <span className="sw-st__id sw-mono">{claim.id}</span>
      </div>
      {claim.quote && (
        <figure className="sw-st__quote">
          <blockquote>{claim.quote}</blockquote>
          <figcaption>{quoteLabel(claim)}</figcaption>
        </figure>
      )}
      {cited ? (
        <Citations sourceIds={claim.sourceIds} memoryIds={claim.memoryIds} />
      ) : (
        <p className="sw-st__none">No source or simulated record is cited for this statement.</p>
      )}
      <Disclosure
        summary="Why this verdict"
        defaultOpen={claim.verdict === 'contradicted'}
        className="sw-st__why"
      >
        <div className="sw-st__reason">
          {claim.reason && <p>{claim.reason}</p>}
          {claim.checks.entailmentQuote && claim.verdict === 'contradicted' && (
            <figure className="sw-st__quote sw-st__quote--against">
              <blockquote>{claim.checks.entailmentQuote}</blockquote>
              <figcaption>What the cited passage says</figcaption>
            </figure>
          )}
          <dl className="sw-st__checks">
            {checks.map((check) => (
              <div key={check.key} data-tone={check.tone}>
                <dt>{check.label}</dt>
                <dd>{check.text}</dd>
              </div>
            ))}
          </dl>
          {attention && (
            <Button
              variant="ghost"
              size="sm"
              icon={<MessageCircleQuestion size={16} aria-hidden="true" />}
              onClick={() => onAsk(askAbout(claim))}
            >
              Ask the analyst about this
            </Button>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
