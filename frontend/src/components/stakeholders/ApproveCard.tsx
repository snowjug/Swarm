import { CircleCheck, Users } from 'lucide-react';
import { useId, useState } from 'react';
import type { ModelAvailability, StakeholderSet } from '../../../../shared/stakeholders';
import { Spinner } from '../ui';
import { formatDate } from './labels';
import { liveStakeholders } from './review';

/**
 * Approving is what turns a reviewed list into actors. Until then nothing downstream uses it; after,
 * any change to the list takes the approval away, so that the actors never come from a list nobody approved.
 */
export function ApproveCard({
  set,
  model,
  canEdit,
  canRun,
  working,
  hasActors,
  editedActors,
  onApprove,
  onMakeActors,
}: {
  set: StakeholderSet;
  model: ModelAvailability;
  canEdit: boolean;
  canRun: boolean;
  working: boolean;
  hasActors: boolean;
  /** How many of the made actors the person has changed; approving never replaces those. */
  editedActors: number;
  onApprove: (options: { model: boolean }) => void;
  onMakeActors: (options: { model: boolean }) => void;
}) {
  const id = useId();
  const [useModel, setUseModel] = useState(false);
  const live = liveStakeholders(set.stakeholders);
  const proposed = live.filter((stakeholder) => stakeholder.status === 'proposed').length;
  const enough = live.length >= 2;
  const allowed = canEdit && canRun;
  const keeps = editedActors > 0;

  const modelChoice = model.available && (
    <label className="stk-check" htmlFor={`${id}-model`}>
      <input
        id={`${id}-model`}
        type="checkbox"
        checked={useModel}
        disabled={working}
        onChange={(event) => setUseModel(event.target.checked)}
      />
      <span>
        Let the model read the key actors against the evidence. It sends your source text to the
        model; whatever it sets is labelled as the model’s, and if it fails the category priors
        stand.
      </span>
    </label>
  );

  if (set.approvedAt) {
    return (
      <section className="stk-approve stk-approved" aria-label="Approval">
        <p>
          <CircleCheck size={16} aria-hidden="true" />{' '}
          <strong>Approved {formatDate(set.approvedAt)}.</strong> Changing the list takes the
          approval away until you approve it again.
          {!hasActors && ' No actors have been made from it yet.'}
        </p>
        {!hasActors && allowed && (
          <>
            {modelChoice}
            <button
              className="button button-primary"
              type="button"
              disabled={working}
              onClick={() => onMakeActors({ model: useModel })}
            >
              {working ? <Spinner label="Making actors" /> : <Users size={16} aria-hidden="true" />}{' '}
              Make the actors
            </button>
          </>
        )}
      </section>
    );
  }
  return (
    <section className="stk-approve" aria-label="Approval">
      <h4>{keeps ? 'Approve the stakeholders' : 'Approve and create actors'}</h4>
      <p>
        {keeps
          ? `When the list is right, approve it. You changed ${editedActors} of the actors, and approving keeps those changes instead of making the actors again; “Reset all actors…” below starts them over from the approved list.`
          : 'When the list is right, approve it. Swarm makes a key actor of each key stakeholder and a cohort of simulated members of every other, starting every trait from a documented category prior that you can change.'}
        {proposed > 0 &&
          ` ${proposed} stakeholder${proposed === 1 ? '' : 's'} still only proposed will be accepted.`}
      </p>
      {allowed ? (
        <>
          {!keeps && modelChoice}
          <button
            className="button button-primary"
            type="button"
            disabled={!enough || working}
            onClick={() => onApprove({ model: useModel && !keeps })}
          >
            {working ? <Spinner label="Approving" /> : <Users size={16} aria-hidden="true" />}{' '}
            {keeps ? 'Approve stakeholders' : 'Approve stakeholders and create actors'}
          </button>
          {!enough && (
            <p className="field-help">
              Keep or add at least two stakeholders: a simulation needs more than one party.
            </p>
          )}
        </>
      ) : (
        <p className="field-help">Approving needs the right to edit and to run the project.</p>
      )}
    </section>
  );
}
