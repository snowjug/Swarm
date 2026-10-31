import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import {
  STAKEHOLDER_CATEGORIES,
  STAKEHOLDER_CATEGORY_LABELS,
} from '../../../../shared/stakeholders';
import { Spinner } from '../ui';
import { DIRECTNESS_LABELS, IMPACT_LABELS, PRIORITY_LABELS } from './labels';
import { draftProblems, type StakeholderDraft } from './review';

/**
 * The fields of a stakeholder the person may change, as a form. It checks them as they are sent, says
 * what is wrong beside the field, and makes no request itself: `onSubmit` is handed the valid draft.
 */
export function StakeholderForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  heading,
}: {
  initial: StakeholderDraft;
  submitLabel: string;
  busy: boolean;
  onSubmit: (draft: StakeholderDraft) => void;
  onCancel: () => void;
  heading: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState(false);
  const problems = draftProblems(draft);
  const set = <K extends keyof StakeholderDraft>(key: K, value: StakeholderDraft[K]): void =>
    setDraft((old) => ({ ...old, [key]: value }));

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setShown(true);
    if (Object.keys(problems).length === 0) onSubmit(draft);
  };
  const problem = (key: keyof StakeholderDraft): string | undefined =>
    shown ? problems[key] : undefined;
  const describedBy = (key: keyof StakeholderDraft): string | undefined =>
    problem(key) ? `${id}-${key}-problem` : undefined;

  return (
    <form className="stk-form view-stack" noValidate onSubmit={submit} aria-label={heading}>
      <h4>{heading}</h4>
      <div className="field">
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          value={draft.name}
          maxLength={160}
          autoComplete="off"
          aria-invalid={problem('name') ? true : undefined}
          aria-describedby={describedBy('name')}
          onChange={(event) => set('name', event.target.value)}
        />
        {problem('name') && (
          <small id={`${id}-name-problem`} className="stk-problem" role="alert">
            {problem('name')}
          </small>
        )}
      </div>
      <div className="fields-grid three">
        <div className="field">
          <label htmlFor={`${id}-category`}>Category</label>
          <select
            id={`${id}-category`}
            value={draft.category}
            onChange={(event) =>
              set('category', event.target.value as StakeholderDraft['category'])
            }
          >
            {STAKEHOLDER_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {STAKEHOLDER_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-directness`}>How directly</label>
          <select
            id={`${id}-directness`}
            value={draft.directness}
            onChange={(event) =>
              set('directness', event.target.value as StakeholderDraft['directness'])
            }
          >
            {(['direct', 'indirect'] as const).map((value) => (
              <option key={value} value={value}>
                {DIRECTNESS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-priority`}>Priority</label>
          <select
            id={`${id}-priority`}
            value={draft.priority}
            onChange={(event) =>
              set('priority', event.target.value as StakeholderDraft['priority'])
            }
          >
            {(['key', 'standard', 'background'] as const).map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-size`}>How many it stands for (an assumption)</label>
        <input
          id={`${id}-size`}
          inputMode="numeric"
          value={draft.populationSize}
          autoComplete="off"
          aria-invalid={problem('populationSize') ? true : undefined}
          aria-describedby={`${id}-size-help${problem('populationSize') ? ` ${id}-populationSize-problem` : ''}`}
          onChange={(event) => set('populationSize', event.target.value)}
        />
        <small id={`${id}-size-help`} className="field-help">
          A weight for modelling a cohort, never a count of real people. A key actor is always one.
        </small>
        {problem('populationSize') && (
          <small id={`${id}-populationSize-problem`} className="stk-problem" role="alert">
            {problem('populationSize')}
          </small>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${id}-description`}>Who they are</label>
        <textarea
          id={`${id}-description`}
          rows={2}
          value={draft.description}
          aria-invalid={problem('description') ? true : undefined}
          aria-describedby={describedBy('description')}
          onChange={(event) => set('description', event.target.value)}
        />
        {problem('description') && (
          <small id={`${id}-description-problem`} className="stk-problem" role="alert">
            {problem('description')}
          </small>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${id}-relevance`}>Why they matter here</label>
        <textarea
          id={`${id}-relevance`}
          rows={2}
          value={draft.relevance}
          aria-invalid={problem('relevance') ? true : undefined}
          aria-describedby={describedBy('relevance')}
          onChange={(event) => set('relevance', event.target.value)}
        />
        {problem('relevance') && (
          <small id={`${id}-relevance-problem`} className="stk-problem" role="alert">
            {problem('relevance')}
          </small>
        )}
      </div>
      <div className="fields-grid">
        <div className="field">
          <label htmlFor={`${id}-impact`}>How the change lands on them</label>
          <select
            id={`${id}-impact`}
            value={draft.impactDirection}
            onChange={(event) =>
              set('impactDirection', event.target.value as StakeholderDraft['impactDirection'])
            }
          >
            {(['harmed', 'benefited', 'mixed', 'unclear'] as const).map((value) => (
              <option key={value} value={value}>
                {IMPACT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-impact-why`}>Why you think so</label>
          <input
            id={`${id}-impact-why`}
            value={draft.impactRationale}
            autoComplete="off"
            aria-invalid={problem('impactRationale') ? true : undefined}
            aria-describedby={describedBy('impactRationale')}
            onChange={(event) => set('impactRationale', event.target.value)}
          />
          {problem('impactRationale') && (
            <small id={`${id}-impactRationale-problem`} className="stk-problem" role="alert">
              {problem('impactRationale')}
            </small>
          )}
        </div>
      </div>
      <div className="fields-grid">
        <div className="field">
          <label htmlFor={`${id}-uncertainty`}>How sure you are</label>
          <select
            id={`${id}-uncertainty`}
            value={draft.uncertaintyLevel}
            onChange={(event) =>
              set('uncertaintyLevel', event.target.value as StakeholderDraft['uncertaintyLevel'])
            }
          >
            <option value="low">Quite sure (low uncertainty)</option>
            <option value="medium">Somewhat sure (medium uncertainty)</option>
            <option value="high">Not sure (high uncertainty)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-uncertainty-why`}>Why</label>
          <input
            id={`${id}-uncertainty-why`}
            value={draft.uncertaintyReason}
            autoComplete="off"
            aria-invalid={problem('uncertaintyReason') ? true : undefined}
            aria-describedby={describedBy('uncertaintyReason')}
            onChange={(event) => set('uncertaintyReason', event.target.value)}
          />
          {problem('uncertaintyReason') && (
            <small id={`${id}-uncertaintyReason-problem`} className="stk-problem" role="alert">
              {problem('uncertaintyReason')}
            </small>
          )}
        </div>
      </div>
      <div className="stk-form-actions">
        <button className="button button-primary button-small" type="submit" disabled={busy}>
          {busy && <Spinner label="Saving" />} {submitLabel}
        </button>
        <button
          className="button button-secondary button-small"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
