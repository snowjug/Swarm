import { Fragment } from 'react';
import {
  CLAIM_KINDS,
  CLAIM_KIND_LABELS,
  CLAIM_KIND_MEANINGS,
  SUPPORT_VERDICTS,
} from '../../../../shared/grounding';
import { VERDICT_MEANINGS } from '../../lib/grounding';
import { VerdictBadge } from './Verdict';

/** Always in the page, collapsed by default: native details, so the keyboard and screen readers just work. */
export function GroundingLegend() {
  return (
    <details className="record-details grounding-legend">
      <summary>What the kinds and verdicts mean</summary>
      <div className="legend-body">
        <h3>Statement kinds</h3>
        <dl className="legend-list">
          {CLAIM_KINDS.map((kind) => (
            <Fragment key={kind}>
              <dt>
                <span className="claim-kind">{CLAIM_KIND_LABELS[kind]}</span>
              </dt>
              <dd>{CLAIM_KIND_MEANINGS[kind]}</dd>
            </Fragment>
          ))}
        </dl>
        <h3>Support verdicts</h3>
        <dl className="legend-list">
          {SUPPORT_VERDICTS.map((verdict) => (
            <Fragment key={verdict}>
              <dt>
                <VerdictBadge verdict={verdict} />
              </dt>
              <dd>{VERDICT_MEANINGS[verdict]}</dd>
            </Fragment>
          ))}
        </dl>
        <p className="field-help">
          A verdict describes what the cited passage says about a statement. It does not show that
          the passage itself is true.
        </p>
      </div>
    </details>
  );
}
