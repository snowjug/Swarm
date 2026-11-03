import type { ReactNode } from 'react';
import type { ResearchPlan, ResearchRun } from '../../../../../shared/research';
import { Chip, Disclosure } from '../../../design/ui';
import { ASSESSMENT_LABEL } from './words';

const TIME_WORDS: Record<ResearchPlan['timeSensitivity']['level'], string> = {
  none: 'The question was not marked as one that moves.',
  recent: 'Recent pages matter.',
  'fast-moving': 'The question moves quickly, so the most recent pages matter most.',
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sw-research-plan__group">
      <h4 className="sw-research-plan__title">{title}</h4>
      {children}
    </section>
  );
}

const List = ({ items }: { items: readonly string[] }) => (
  <ul className="sw-research-plan__list" role="list">
    {items.map((item, index) => (
      <li key={`${index}:${item}`}>{item}</li>
    ))}
  </ul>
);

/**
 * What the research set out to find, as it planned it before it read a page: the claims it tried to check and what it
 * found bearing on each, the topics and names, how much time matters, what would be a conflict, what is missing, and
 * when it stops. The counts are the run's own matching of passages to claims, and are not a verdict on any of them.
 */
export function Plan({ run }: { run: ResearchRun }) {
  const plan = run.plan;
  if (!plan) return null;
  const assessed = new Map(run.assessments.map((entry) => [entry.claimId, entry]));
  return (
    <Disclosure
      summary="What the research looks for"
      heading={3}
      className="sw-research-disclosure"
    >
      <div className="sw-research-plan">
        <p className="sw-caption">
          {plan.origin === 'model' ? 'Planned with a model you chose.' : 'Planned by rules.'} The
          plan names what to find. It never names an address to read.
        </p>
        {plan.claimsToVerify.length > 0 && (
          <Group title="Claims it tried to check">
            <ul className="sw-research-plan__claims" role="list">
              {plan.claimsToVerify.map((claim) => {
                const found = assessed.get(claim.id);
                return (
                  <li key={claim.id}>
                    <p>{claim.statement}</p>
                    {claim.why && <p className="sw-caption">{claim.why}</p>}
                    {found && (
                      <p className="sw-research-plan__found">
                        <Chip
                          size="sm"
                          tone={found.status === 'unassessed' ? 'neutral' : 'accent'}
                          wrap
                        >
                          {ASSESSMENT_LABEL[found.status]}
                        </Chip>
                        {(found.supporting > 0 || found.opposing > 0) && (
                          <span className="sw-caption num">
                            {found.supporting} support, {found.opposing} oppose
                          </span>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="sw-caption">
              These counts come from the research’s own matching of passages to claims. They are not
              a verdict.
            </p>
          </Group>
        )}
        {plan.topics.length > 0 && (
          <Group title="Topics">
            <p>{plan.topics.join(' · ')}</p>
          </Group>
        )}
        {plan.entities.length > 0 && (
          <Group title="Names it looked for">
            <p>{plan.entities.map((entity) => entity.name).join(' · ')}</p>
          </Group>
        )}
        <Group title="Time">
          <p>
            {TIME_WORDS[plan.timeSensitivity.level]}
            {plan.timeSensitivity.note ? ` ${plan.timeSensitivity.note}` : ''}
          </p>
        </Group>
        {plan.conflictsToLookFor.length > 0 && (
          <Group title="Conflicts it looked for">
            <List items={plan.conflictsToLookFor} />
          </Group>
        )}
        {plan.missingEvidence.length > 0 && (
          <Group title="What may be missing">
            <List items={plan.missingEvidence} />
          </Group>
        )}
        {plan.stoppingConditions.length > 0 && (
          <Group title="When it stops">
            <List items={plan.stoppingConditions} />
          </Group>
        )}
      </div>
    </Disclosure>
  );
}
