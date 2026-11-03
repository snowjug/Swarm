import { Plus } from 'lucide-react';
import { Button, Chip, ChipButton, Disclosure } from '../../../design/ui';
import {
  PARTICIPANT_ROLE_LABELS,
  type ParticipantRole,
  type RoleCoverage,
} from '../../../../../shared/stakeholders';
import { splitCoverage } from './logic';

/**
 * Which roles of a decision somebody holds. Not every role is wanted in every scenario: a role is called missing
 * only when it always matters or the question and the sources point at it, and the rest are offered, not demanded.
 * Nothing is filled in to make the list look whole.
 */
export function Coverage({
  coverage,
  editable,
  onAdd,
}: {
  coverage: readonly RoleCoverage[];
  editable: boolean;
  onAdd: (role: ParticipantRole) => void;
}) {
  const { covered, missing, optional } = splitCoverage(coverage);
  return (
    <section className="sw-prv__coverage" aria-labelledby="rv-roles">
      <h3 id="rv-roles" className="sw-prv__h">
        Roles in this decision
      </h3>
      {covered.length > 0 && (
        <ul className="sw-prv__roles" aria-label="Roles somebody holds">
          {covered.map((item) => (
            <li key={item.role}>
              <Chip size="sm">
                <span>{PARTICIPANT_ROLE_LABELS[item.role]}</span>{' '}
                <span className="sw-prv__count">{item.count}</span>
              </Chip>
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <ul className="sw-prv__gaps" aria-label="Roles nobody holds yet">
          {missing.map((item) => (
            <li key={item.role} className="sw-prv__gap">
              <div className="sw-prv__gap-text">
                <p className="sw-prv__gap-role">
                  {PARTICIPANT_ROLE_LABELS[item.role]}
                  <span className="sw-prv__gap-tag"> · nobody yet</span>
                </p>
                {item.reason && <p className="sw-caption">{item.reason}</p>}
              </div>
              {editable && (
                <Button
                  size="sm"
                  variant="glass"
                  icon={<Plus size={15} aria-hidden="true" />}
                  aria-label={`Add one: ${PARTICIPANT_ROLE_LABELS[item.role].toLowerCase()}`}
                  onClick={() => onAdd(item.role)}
                >
                  Add one
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {optional.length > 0 && (
        <Disclosure summary={`Other roles nobody holds (${optional.length})`}>
          <p className="sw-caption sw-prv__optional-note">
            Nothing in your question or sources points at these, so they are not asked for. Add one
            if you know it matters.
          </p>
          <ul className="sw-prv__roles" aria-label="Roles nobody holds that are not needed here">
            {optional.map((item) => (
              <li key={item.role}>
                {editable ? (
                  <ChipButton
                    size="sm"
                    icon={<Plus size={13} aria-hidden="true" />}
                    onClick={() => onAdd(item.role)}
                    aria-label={`Add one: ${PARTICIPANT_ROLE_LABELS[item.role].toLowerCase()}`}
                  >
                    {PARTICIPANT_ROLE_LABELS[item.role]}
                  </ChipButton>
                ) : (
                  <Chip size="sm">{PARTICIPANT_ROLE_LABELS[item.role]}</Chip>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
