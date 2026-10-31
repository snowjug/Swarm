import type {
  BriefStatement,
  BriefVisuals,
  Recommendation,
  ValidationExperiment,
} from '../../../../shared/brief';
import { OriginBadge, RefsDetails, RelianceBadge } from './BriefStatements';

const sentence = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** The recommendations, best first, each with what it follows from and how to check it before acting. */
export function RecommendationsTable({
  recommendations,
  statements,
  visuals,
}: {
  recommendations: readonly Recommendation[];
  statements: readonly BriefStatement[];
  visuals: BriefVisuals | null;
}) {
  if (recommendations.length === 0) return null;
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  return (
    <div className="brief-scroll" role="region" aria-label="Recommendations" tabIndex={0}>
      <table className="brief-table brief-recommendations">
        <caption>Recommendations, best first</caption>
        <thead>
          <tr>
            <th scope="col">Priority</th>
            <th scope="col">Recommendation</th>
            <th scope="col">Impact</th>
            <th scope="col">Effort</th>
            <th scope="col">Reversibility</th>
            <th scope="col">Owner</th>
            <th scope="col">Leading indicators</th>
            <th scope="col">How to check it first</th>
          </tr>
        </thead>
        <tbody>
          {recommendations.map((recommendation) => {
            const statement = byId.get(recommendation.id);
            return (
              <tr key={recommendation.id}>
                <th scope="row">{recommendation.priority}</th>
                <td>
                  <p>{recommendation.text}</p>
                  <p className="brief-badges">
                    {statement ? <OriginBadge origin={statement.origin} /> : null}
                    {statement?.reliance ? <RelianceBadge reliance={statement.reliance} /> : null}
                  </p>
                  <p className="brief-count">Horizon: {recommendation.horizon}</p>
                  {statement ? <RefsDetails refs={statement.refs} visuals={visuals} /> : null}
                </td>
                <td>{sentence(recommendation.impact)}</td>
                <td>{sentence(recommendation.effort)}</td>
                <td>{sentence(recommendation.reversibility)}</td>
                <td>{sentence(recommendation.ownerFunction)}</td>
                <td>
                  <ul className="brief-plain-list">
                    {recommendation.leadingIndicators.map((indicator) => (
                      <li key={indicator}>{indicator}</li>
                    ))}
                  </ul>
                </td>
                <td>{recommendation.validation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Real-world checks for the assumptions and results the simulated answer depends on most. None has been run. */
export function ValidationTable({ plan }: { plan: readonly ValidationExperiment[] }) {
  if (plan.length === 0) return null;
  return (
    <div className="brief-scroll" role="region" aria-label="Validation plan" tabIndex={0}>
      <table className="brief-table brief-validation">
        <caption>Validation plan: real-world checks, none of which has been run</caption>
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Tests</th>
            <th scope="col">Question</th>
            <th scope="col">Method</th>
            <th scope="col">Success signal</th>
            <th scope="col">Effort</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((experiment) => (
            <tr key={experiment.id}>
              <th scope="row">{experiment.id}</th>
              <td>
                <ul className="brief-plain-list">
                  {experiment.targets.map((target) => (
                    <li key={target}>{target}</li>
                  ))}
                </ul>
              </td>
              <td>{experiment.question}</td>
              <td>{experiment.method}</td>
              <td>{experiment.successSignal}</td>
              <td>{sentence(experiment.effort)}</td>
              <td>{experiment.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
