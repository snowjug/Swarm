import { ArrowRight, Check, Gauge } from 'lucide-react';
import {
  CONSTRAINT_CATEGORY_LABELS,
  type Constraint,
  type ConstraintCoverage,
  type ConstraintImpact,
} from '../../../../../shared/constraints';
import { Button, Chip, Disclosure, Notice } from '../../../design/ui';
import { CLASS_WORDS, gateTone, gateWord, pointsWords, tallyOf, waitingOf } from './model';

export interface GateProps {
  gate: ConstraintCoverage;
  constraints: readonly Constraint[];
  /** The scenario or the actors changed after the constraints were read against them. */
  stale: { scenario: boolean; actors: boolean };
  canEdit: boolean;
  canRun: boolean;
  working: boolean;
  /** What measuring the gate found, when it was measured. */
  sensitivity: { impact: ConstraintImpact | null } | null;
  onAcceptAll: () => void;
  onConfirmSet: () => void;
  onMeasure: () => void;
  onSimulate: () => void;
}

/** The kinds of limit that touch an actor, once each, so that the list says what and not how many. */
function kindsOf(ids: readonly string[], byId: ReadonlyMap<string, Constraint>): string {
  const kinds = [
    ...new Set(
      ids.flatMap((id) => {
        const found = byId.get(id);
        return found ? [CONSTRAINT_CATEGORY_LABELS[found.category]] : [];
      }),
    ),
  ];
  return kinds.length > 0 ? kinds.join(', ') : 'a constraint that is no longer listed';
}

const STALE_WORDS = (stale: GateProps['stale']): string =>
  stale.scenario && stale.actors
    ? 'the scenario and the actors'
    : stale.scenario
      ? 'the scenario'
      : 'the actors';

/**
 * The Constraint Coverage Gate, in one place: whether a simulation may start and with what label, what is
 * known, assumed, conflicting and missing, which alternatives a hard limit rules out, and what is left for
 * a person to confirm. It decides nothing about the world; it says what the page has and has not been told.
 */
export function Gate({
  gate,
  constraints,
  stale,
  canEdit,
  canRun,
  working,
  sensitivity,
  onAcceptAll,
  onConfirmSet,
  onMeasure,
  onSimulate,
}: GateProps) {
  const waiting = waitingOf({ constraints: [...constraints] });
  const byId = new Map(constraints.map((constraint) => [constraint.id, constraint]));
  const outOfDate = stale.scenario || stale.actors;
  const impact = sensitivity?.impact ?? null;
  const impactOf = impact ? byId.get(impact.constraintId) : undefined;
  return (
    <section className="sw-gate" aria-labelledby="gate-title" data-status={gate.status}>
      <div className="sw-gate__top">
        <h2 id="gate-title" className="sw-eyebrow">
          Constraint coverage
        </h2>
        <Chip tone={gateTone(gate.status)} dot>
          {gateWord(gate.status)}
        </Chip>
        {gate.reviewed && (
          <Chip size="sm" icon={<Check size={12} aria-hidden="true" />}>
            Reviewed
          </Chip>
        )}
      </div>
      <p className="sw-gate__summary sw-title">{gate.summary}</p>

      {gate.status === 'blocked' && gate.blockedBy.length > 0 && (
        <Notice tone="error" title="This stops the simulation">
          <ul className="sw-gate__list">
            {gate.blockedBy.map((item) => (
              <li key={`${item.reason}-${item.constraintId ?? 'all'}`}>{item.text}</li>
            ))}
          </ul>
        </Notice>
      )}
      {gate.label && (
        <Notice tone="caution" title="Provisional">
          {gate.label}
        </Notice>
      )}
      {outOfDate && (
        <Notice tone="caution" title="Read against an earlier version">
          {`The constraints were read against an earlier version of ${STALE_WORDS(stale)}. Check that they still describe this project, then confirm the review again.`}
        </Notice>
      )}

      <dl className="sw-gate__tally" aria-label="What the constraints cover">
        {tallyOf(gate).map((item) => (
          <div key={item.id} className="sw-gate__stat" data-count={item.count}>
            <dt>{item.label}</dt>
            <dd>
              <span className="sw-numeral">{item.count}</span>
              <span className="sw-gate__hint">{item.hint}</span>
            </dd>
          </div>
        ))}
      </dl>

      {gate.violations.length > 0 && (
        <div className="sw-gate__block">
          <h3 className="sw-eyebrow">Ruled out by a hard limit</h3>
          <ul className="sw-gate__list">
            {gate.violations.map((violation) => (
              <li key={violation.alternativeId}>
                <strong>{violation.label}</strong>
                {': '}
                {violation.constraintIds
                  .map((id) => byId.get(id)?.statement ?? 'a constraint that is no longer listed')
                  .join(' · ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {gate.conflicting.length > 0 && (
        <div className="sw-gate__block">
          <h3 className="sw-eyebrow">Cannot both hold</h3>
          <ul className="sw-gate__list">
            {gate.conflicting.map((pair) => (
              <li key={pair.ids.join('|')}>
                {pair.basis} (
                {pair.ids.map((id) => `“${byId.get(id)?.statement ?? id}”`).join(' and ')})
              </li>
            ))}
          </ul>
        </div>
      )}

      {gate.affectedActors.length > 0 && (
        <Disclosure summary={`Who is affected (${gate.affectedActors.length})`}>
          <ul className="sw-gate__list">
            {gate.affectedActors.map((actor) => (
              <li key={actor.actorId}>
                <strong>{actor.name}</strong>
                {`: ${kindsOf(actor.constraintIds, byId)}`}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {gate.reasons.length > 0 && (
        <Disclosure summary="Why it says that">
          <ul className="sw-gate__list">
            {gate.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      <div className="sw-gate__sens" aria-live="polite">
        {sensitivity ? (
          impact && impactOf ? (
            <p>
              <Gauge size={15} aria-hidden="true" /> Taking away “{impactOf.statement}” moves the
              simulated share of members ending in switch or resist by{' '}
              <strong>{pointsWords(impact.withoutShift)}</strong> (
              {CLASS_WORDS[impact.classification].toLowerCase()}), on {impact.seeds} paired seeds.
              It is a result of the simulation, not of the world.
            </p>
          ) : (
            <p>
              No applied constraint could be taken away to measure. Constraints the simulation
              cannot apply are read, and change nothing in a run.
            </p>
          )
        ) : (
          canRun && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Gauge size={14} aria-hidden="true" />}
              busy={working}
              busyLabel="Measuring"
              onClick={onMeasure}
            >
              Find the constraint that matters most
            </Button>
          )
        )}
      </div>

      <div className="sw-gate__actions">
        {canEdit && waiting > 0 && (
          <Button variant="glass" disabled={working} onClick={onAcceptAll}>
            {`Accept the ${waiting} that ${waiting === 1 ? 'waits' : 'wait'}`}
          </Button>
        )}
        {canEdit && (
          <Button
            variant="primary"
            disabled={working || waiting > 0 || (gate.reviewed && !outOfDate)}
            onClick={onConfirmSet}
          >
            {outOfDate
              ? 'Confirm the review again'
              : gate.reviewed
                ? 'Review confirmed'
                : 'Confirm the review'}
          </Button>
        )}
        {gate.status !== 'blocked' && gate.reviewed && (
          <Button
            variant="ghost"
            iconEnd={<ArrowRight size={15} aria-hidden="true" />}
            onClick={onSimulate}
          >
            Go to the simulation
          </Button>
        )}
      </div>
      {canEdit && waiting > 0 && (
        <p className="sw-caption">
          Confirming the review says you have been through the list. {waiting}{' '}
          {waiting === 1 ? 'constraint is' : 'constraints are'} still waiting for your decision.
        </p>
      )}
    </section>
  );
}
