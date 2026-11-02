import type { CSSProperties } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  CRITIC_ROLES,
  CRITIC_ROLE_LABELS,
  CRITIC_ROLE_QUESTIONS,
  CRITIQUE_SEVERITIES,
  CRITIQUE_STATUSES,
  type CriticRole,
} from '../../../../../shared/critique';
import { Button, Notice, Skeleton } from '../../../design/ui';
import type { CritiquesState } from '../../../hooks/useCritiques';
import {
  LEAD_HEADING,
  SEVERITY_VIEW,
  STATUS_VIEW,
  day,
  impactHeading,
  leadCritique,
  modeText,
  withoutLead,
} from '../../../lib/critics';
import { bySeriousness, subjectOf, tally } from '../model/critique-model';
import { plural } from '../model/format';
import { useDoc } from '../ui/context';
import { ROLE_SHORT } from '../ui/meta';
import { SeverityChip, StatusChip } from './chips';
import { ReviewFreshness, RunControls } from './ReviewSheet';
import './review.css';

/** The seven critics, each with what it raised: a critic that raised nothing says so, and says that this proves nothing. */
function Critics({
  counts,
  running,
  arrival,
  onRole,
}: {
  counts: Record<CriticRole, number> | null;
  running: boolean;
  arrival: number;
  onRole: (role: CriticRole) => void;
}) {
  return (
    <ul className="sw-decide-critics" role="list" key={arrival} aria-label="The critics">
      {CRITIC_ROLES.map((role, index) => {
        const count = counts?.[role] ?? null;
        const label = CRITIC_ROLE_LABELS[role];
        const name = <span className="sw-decide-critic__name">{ROLE_SHORT[role]}</span>;
        return (
          <li key={role} style={{ '--i': index } as CSSProperties}>
            {count !== null && count > 0 ? (
              <button
                type="button"
                className="sw-decide-critic"
                data-reading={running || undefined}
                onClick={() => onRole(role)}
                title={`${label}: ${CRITIC_ROLE_QUESTIONS[role]}`}
              >
                {name}
                <span className="sw-decide-critic__count num">{count}</span>
                <span className="sr-only">
                  {' '}
                  {count === 1 ? 'criticism' : 'criticisms'} from the {label.toLowerCase()}
                </span>
              </button>
            ) : (
              <span
                className="sw-decide-critic"
                data-reading={running || undefined}
                data-empty={count === 0 || undefined}
                title={
                  count === 0
                    ? `${label}: raised nothing. That does not show the analysis is right. ${CRITIC_ROLE_QUESTIONS[role]}`
                    : `${label}: ${CRITIC_ROLE_QUESTIONS[role]}`
                }
              >
                {name}
                <span className="sw-decide-critic__count num">{count === 0 ? 'none' : ''}</span>
                <span className="sr-only">
                  {count === 0
                    ? ` raised nothing, which does not show the analysis is right`
                    : `. ${label}: ${CRITIC_ROLE_QUESTIONS[role]}`}
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The independent review, in the document: how many criticisms, how serious, who raised them and what has been
 * done with them, with the most serious in view and the rest one press away. Everything is in the page for
 * print; the response itself is made in the sheet.
 */
export function ReviewChapter({
  state,
  arrival,
  onOpen,
  onRerun,
}: {
  state: CritiquesState;
  arrival: number;
  onOpen: (target?: { id?: string; role?: CriticRole }) => void;
  onRerun: () => void;
}) {
  const { brief, visuals, mode } = useDoc();
  const { view, loading, error, running } = state;

  if (!view) {
    return error ? (
      <Notice
        tone="error"
        title="The independent review could not be read"
        action={
          <Button size="sm" variant="glass" onClick={state.reload}>
            Retry
          </Button>
        }
      >
        {error}
      </Notice>
    ) : (
      <div className="sw-decide-review-wait" aria-busy={loading || undefined} role="status">
        <Skeleton height="1.2rem" width="min(24rem, 70%)" />
        <Skeleton height="1rem" width="min(36rem, 90%)" />
        <span className="sr-only">Reading the independent review</span>
      </div>
    );
  }

  const set = view.critiques;
  const critiques = set?.critiques ?? [];
  const counts = tally(critiques);
  const lead = set ? leadCritique(critiques) : null;
  const foremost = bySeriousness(withoutLead(critiques)).slice(0, 3);
  const roles = CRITIC_ROLES.filter((role) => counts.byRole[role] > 0).length;

  if (!view.analysis) {
    return <p className="sw-decide-note-line">There is no finished comparison to review yet.</p>;
  }

  return (
    <div className="sw-decide-rv">
      {state.error && (
        <Notice
          tone="caution"
          title="The review could not be refreshed"
          action={
            <Button size="sm" variant="glass" onClick={state.reload}>
              Retry
            </Button>
          }
        >
          {state.error} What is shown is the last version that could be read.
        </Notice>
      )}
      <ReviewFreshness view={view} onRerun={onRerun} />
      {lead && (
        <div className="sw-decide-rv__lead">
          <p className="sw-eyebrow">Read this first</p>
          <p className="sw-decide-rv__leadtitle">{LEAD_HEADING}</p>
          <Button
            size="sm"
            variant="glass"
            iconEnd={<ArrowRight size={14} aria-hidden="true" />}
            onClick={() => onOpen({ id: lead.id })}
          >
            Open it in the review
          </Button>
        </div>
      )}

      {set === null ? (
        <div className="sw-decide-rv__invite">
          <p className="sw-decide-rv__line">
            Seven critics can challenge this analysis from different angles: the evidence, the
            assumptions, the method, who is missing, bias, the recommendations, and what would have
            to be true for the conclusion to be wrong.
          </p>
          <Critics counts={null} running={running} arrival={arrival} onRole={() => undefined} />
          <RunControls view={view} state={state} />
        </div>
      ) : (
        <>
          <div className="sw-decide-rv__head">
            <p className="sw-decide-rv__total sw-numeral num">{counts.total}</p>
            <div className="sw-decide-rv__what">
              <p className="sw-decide-rv__label">
                {counts.total === 0
                  ? 'criticisms raised'
                  : `${counts.total === 1 ? 'criticism' : 'criticisms'} raised by ${plural(roles, 'critic')}`}
              </p>
              <p className="sw-decide-rv__fine">
                {counts.total === 0
                  ? 'The checks raised no criticism. That does not show the analysis is right: they look only for the faults each critic is built to find.'
                  : 'A criticism is a challenge, not a verdict, and none of them has changed a finding.'}
              </p>
            </div>
          </div>

          {counts.total > 0 && (
            <div className="sw-decide-rv__dist">
              <div
                className="sw-decide-rv__bar"
                role="img"
                aria-label={`Criticisms by severity: ${CRITIQUE_SEVERITIES.map((severity) => `${counts.bySeverity[severity]} ${SEVERITY_VIEW[severity].label.toLowerCase()}`).join(', ')}`}
              >
                {[...CRITIQUE_SEVERITIES].map((severity) =>
                  counts.bySeverity[severity] > 0 ? (
                    <span
                      key={severity}
                      data-severity={severity}
                      style={{ flexGrow: counts.bySeverity[severity], flexBasis: 0 }}
                      title={`${SEVERITY_VIEW[severity].label}: ${counts.bySeverity[severity]}`}
                    />
                  ) : null,
                )}
              </div>
              <ul className="sw-decide-rv__legend" role="list">
                {CRITIQUE_SEVERITIES.filter((severity) => counts.bySeverity[severity] > 0).map(
                  (severity) => (
                    <li key={severity}>
                      <span
                        className="sw-decide-rv__swatch"
                        data-severity={severity}
                        aria-hidden="true"
                      />
                      {SEVERITY_VIEW[severity].label}{' '}
                      <b className="num">{counts.bySeverity[severity]}</b>
                    </li>
                  ),
                )}
                <li className="sw-decide-rv__status">
                  {CRITIQUE_STATUSES.filter((status) => counts.byStatus[status] > 0)
                    .map(
                      (status) =>
                        `${counts.byStatus[status]} ${STATUS_VIEW[status].label.toLowerCase()}`,
                    )
                    .join(' · ')}
                </li>
              </ul>
            </div>
          )}

          <Critics
            counts={counts.byRole}
            running={running}
            arrival={arrival}
            onRole={(role) => onOpen({ role })}
          />

          {foremost.length > 0 && (
            <div className="sw-decide-rv__top">
              <p className="sw-eyebrow">Most serious</p>
              <ul role="list">
                {foremost.map((critique) => (
                  <li key={critique.id}>
                    <button
                      type="button"
                      className="sw-decide-rv__row"
                      onClick={() => onOpen({ id: critique.id })}
                    >
                      <span className="sw-decide-rv__rowchips">
                        <SeverityChip severity={critique.severity} />
                        <StatusChip status={critique.status} />
                      </span>
                      <span className="sw-decide-rv__subject">
                        {subjectOf(critique.target, brief, visuals)}
                      </span>
                      <span className="sw-decide-rv__objection">{critique.objection}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="sw-decide-rv__actions">
            <RunControls view={view} state={state}>
              <Button
                variant="primary"
                iconEnd={<ArrowRight size={15} aria-hidden="true" />}
                onClick={() => onOpen()}
              >
                Open the review
              </Button>
            </RunControls>
          </div>
          <p className="sw-decide-rv__fine">
            {modeText(set.mode)} · made {day(set.generatedAt)}
            {set.notes && set.notes.length > 0 ? ` · ${set.notes.join(' ')}` : ''}
          </p>

          {/* The whole review, for the printed page. */}
          <div className="sw-decide-print-only">
            <h3>All criticisms</h3>
            <ul role="list">
              {critiques.map((critique) => (
                <li key={critique.id}>
                  <p>
                    <strong>
                      {SEVERITY_VIEW[critique.severity].label} ·{' '}
                      {STATUS_VIEW[critique.status].label} · {CRITIC_ROLE_LABELS[critique.role]}
                    </strong>
                  </p>
                  <p>{subjectOf(critique.target, brief, visuals)}</p>
                  <p>{critique.objection}</p>
                  {critique.basis.map((line) => (
                    <p key={line}>Basis: {line}</p>
                  ))}
                  <p>
                    {impactHeading(critique.status)}:{' '}
                    {critique.impactOnConclusion || 'No effect on the conclusion was stated.'}
                  </p>
                  {critique.response ? <p>Response: {critique.response.text}</p> : null}
                  {critique.remainingDisagreement ? (
                    <p>Still disputed: {critique.remainingDisagreement}</p>
                  ) : null}
                  {mode === 'advanced' ? <p className="sw-mono">{critique.id}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
