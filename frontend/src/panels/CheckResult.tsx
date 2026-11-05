import { CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import {
  CHECK_STAGES,
  CHECK_STAGE_LABELS,
  VERDICT_TITLES,
  checkVerdict,
  firstProblem,
  problemText,
} from '../../../shared/provider-check';
import type { CheckState, ProviderCheck } from '../../../shared/types';
import { Notice } from '../design/ui';
import { count } from '../lib/format';
import { formatCheckTime } from '../lib/provider';

/** Words carry the state; the icon only reinforces them. */
const STATE_WORDS: Record<CheckState, string> = {
  ok: 'confirmed',
  failed: 'failed',
  unknown: 'not confirmed',
};

function StateIcon({ state }: { state: CheckState }) {
  const props = { size: 15, 'aria-hidden': true } as const;
  if (state === 'ok') return <CircleCheck {...props} />;
  if (state === 'failed') return <CircleX {...props} />;
  return <CircleHelp {...props} />;
}

/**
 * What one connection check found, with the four things apart: reached, signed in to, deployment found,
 * and structured output. The headline says what the check found as a whole, in words that never call a
 * connection that works a failed one, and the list under it says what each thing came to, so that the chip
 * ("connected") and this cannot disagree: they are read from the same result.
 */
export function CheckResult({
  check,
  latencyMs,
}: {
  check: ProviderCheck;
  latencyMs: number | null;
}) {
  const verdict = checkVerdict(check);
  const problem = firstProblem(check.deployments);
  const when = <time dateTime={check.checkedAt}>{formatCheckTime(check.checkedAt)}</time>;
  return (
    <div className="sw-provider-check" data-verdict={verdict}>
      {verdict === 'verified' ? (
        <p className="sw-provider-pop__ok">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            {VERDICT_TITLES.verified}: the provider was reached, took the credentials, has the
            deployment and returned the structured JSON it was asked for
            {latencyMs !== null && ` in ${count(latencyMs)} ms`}, at {when}.
          </span>
        </p>
      ) : (
        <Notice
          tone={
            verdict === 'not-connected'
              ? 'error'
              : verdict === 'structured-failed'
                ? 'caution'
                : 'info'
          }
          title={VERDICT_TITLES[verdict]}
        >
          {problem && problemText(problem)} <span className="sw-caption">Checked at {when}.</span>
        </Notice>
      )}
      {check.deployments.map((deployment) => (
        <section
          key={deployment.deployment ?? 'provider'}
          className="sw-provider-check__deployment"
          aria-label={
            deployment.deployment ? `Check of deployment ${deployment.deployment}` : 'Check'
          }
        >
          {check.deployments.length > 1 && deployment.deployment && (
            <h3 className="sw-provider-check__name sw-mono">{deployment.deployment}</h3>
          )}
          <ul className="sw-provider-check__list">
            {CHECK_STAGES.map((name) => {
              const stage = deployment[name];
              return (
                <li key={name} className="sw-provider-check__stage" data-state={stage.state}>
                  <span className="sw-provider-check__icon">
                    <StateIcon state={stage.state} />
                  </span>
                  {/* The spaces are text, so that the label, the state and the detail are read as words. */}
                  <span className="sw-provider-check__label">{CHECK_STAGE_LABELS[name]}</span>{' '}
                  <span className="sw-provider-check__state">{STATE_WORDS[stage.state]}</span>
                  {stage.detail && (
                    <>
                      {' '}
                      <span className="sw-caption sw-provider-check__detail">{stage.detail}</span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
