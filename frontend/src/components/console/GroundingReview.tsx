import { TriangleAlert } from 'lucide-react';
import type { SimulationReport } from '../../../../shared/types';
import { dateTime } from '../../lib/format';
import type { Inspection } from '../../lib/graph';
import {
  chaptersWithoutStatements,
  contradictedClaims,
  groupBySection,
  methodLine,
  noReviewMessage,
  orderedTallies,
  statementsText,
  totalStatements,
} from '../../lib/grounding';
import { GroundedStatement } from './GroundedStatement';
import { GroundingLegend } from './GroundingLegend';
import { VerdictTallies } from './Verdict';

const TITLE_ID = 'grounding-review-title';

/**
 * What the server checked in a model-written report, and what it could not. Verdicts say whether a
 * cited passage backs a statement; they never claim that the passage is true.
 */
export function GroundingReview({
  report,
  complete = true,
  onInspect,
}: {
  report: SimulationReport;
  complete?: boolean;
  onInspect: (selection: Inspection) => void;
}) {
  const review = report.grounding;
  if (!review) {
    return (
      <section className="grounding-review view-stack" aria-labelledby={TITLE_ID}>
        <div>
          <span className="eyebrow">
            STATEMENT CHECKS / {report.generatedBy === 'local' ? 'NOT APPLICABLE' : 'NOT RECORDED'}
          </span>
          <h2 id={TITLE_ID}>Grounding review</h2>
        </div>
        <p className="grounding-empty">{noReviewMessage(report.generatedBy, complete)}</p>
      </section>
    );
  }
  const chapters = report.sections.map((section) => section.title);
  const groups = groupBySection(review.claims, chapters);
  const contradicted = contradictedClaims(review.claims);
  const contradictedCount = Math.max(review.counts.contradicted ?? 0, contradicted.length);
  const unchecked = chaptersWithoutStatements(chapters, review.claims);
  return (
    <section className="grounding-review view-stack" aria-labelledby={TITLE_ID}>
      <div>
        <span className="eyebrow">STATEMENT CHECKS / AUTOMATED</span>
        <h2 id={TITLE_ID}>Grounding review</h2>
      </div>
      <p className="grounding-summary">
        {`${statementsText(totalStatements(review.counts))} checked`}
        <VerdictTallies tallies={orderedTallies(review.counts)} />
      </p>
      <dl className="grounding-facts">
        <div>
          <dt>Checks run</dt>
          <dd className={review.method === 'deterministic' ? 'method-limited' : undefined}>
            {methodLine(review.method)}
          </dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd>
            <time dateTime={review.checkedAt}>{dateTime(review.checkedAt)}</time>
          </dd>
        </div>
      </dl>
      <p className="field-help">
        Verdicts describe how well the cited passage backs a statement. They do not show that the
        passage itself is true.
      </p>
      {contradictedCount > 0 && (
        <section
          className="grounding-contradicted"
          role="region"
          aria-labelledby="grounding-contradicted-title"
        >
          <h3 id="grounding-contradicted-title">
            <TriangleAlert size={17} aria-hidden="true" />
            {`Contradicted by the sources (${contradictedCount})`}
          </h3>
          <p>
            The cited passage appears to say something that conflicts with each of these statements.
            Read the passage before relying on them.
          </p>
          {contradicted.length > 0 ? (
            <ul className="claim-list" role="list">
              {contradicted.map((claim, index) => (
                <GroundedStatement
                  key={`${index}-${claim.id}`}
                  claim={claim}
                  onInspect={onInspect}
                />
              ))}
            </ul>
          ) : (
            <p>The review counts these statements, but their details were not recorded.</p>
          )}
        </section>
      )}
      <GroundingLegend />
      {groups.length > 0 && (
        <div className="grounding-groups">
          {groups.map((group, index) => {
            const headingId = `grounding-group-${index}`;
            return (
              <div className="grounding-group" key={group.section}>
                <div className="group-head">
                  <h3 id={headingId}>{group.section}</h3>
                  <p>
                    {statementsText(group.claims.length)}
                    <VerdictTallies
                      tallies={orderedTallies(group.counts).filter((tally) => tally.count > 0)}
                    />
                  </p>
                </div>
                <ul className="claim-list" role="list" aria-labelledby={headingId}>
                  {group.claims.map((claim, position) => (
                    <GroundedStatement
                      key={`${position}-${claim.id}`}
                      claim={claim}
                      onInspect={onInspect}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {review.claims.length === 0 ? (
        <p className="field-help">
          No statements were listed for checking, so no chapter text was checked statement by
          statement.
        </p>
      ) : (
        unchecked.length > 0 && (
          <p className="field-help">
            {`No statements were listed for ${unchecked.map((title) => `“${title}”`).join(', ')}, so nothing in ${unchecked.length === 1 ? 'that chapter was' : 'those chapters was'} checked statement by statement.`}
          </p>
        )
      )}
      {review.unverifiedFigures.length > 0 && (
        <div className="grounding-figures">
          <h3 id="grounding-figures-title">Figures with nothing behind them</h3>
          <p>
            These figures appear in chapter text but in neither the cited passages nor the recorded
            simulation, so they may be invented.
          </p>
          <ul aria-labelledby="grounding-figures-title">
            {review.unverifiedFigures.map((entry, index) => (
              <li key={`${index}-${entry.section}`}>
                <strong>{entry.section}</strong>: <span>{entry.figures.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.notes.length > 0 && (
        <div className="grounding-notes">
          <h3 id="grounding-notes-title">What was and was not checked</h3>
          <ul aria-labelledby="grounding-notes-title">
            {review.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
