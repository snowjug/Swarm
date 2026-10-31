import { Gauge } from 'lucide-react';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { BudgetView } from '../../../../shared/budget';
import { useBudget } from '../../hooks/useBudget';
import type { BudgetState } from '../../hooks/useBudget';
import {
  BUDGET_STATE,
  budgetNotice,
  budgetRows,
  limitFieldText,
  parseLimit,
  type BudgetRow,
} from '../../lib/budget';
import { EmptyPanel, Modal, Notice, Spinner } from '../ui';
import { ToneChip } from './LedgerParts';

/** One measure of the budget: what has been used against what is allowed, as words and as a meter. */
function BudgetRowView({ row }: { row: BudgetRow }) {
  const tone = BUDGET_STATE[row.state].tone;
  const percent = row.share === null ? 0 : Math.round(row.share * 100);
  return (
    <li className={`budget-row tone-${tone}`}>
      <div className="budget-row-head">
        <strong>{row.label}</strong>
        <ToneChip tone={tone} label={BUDGET_STATE[row.state].label} />
      </div>
      <div
        className={`budget-meter${row.share === null ? ' budget-meter-none' : ''}`}
        role="meter"
        aria-label={row.label}
        aria-valuemin={0}
        aria-valuemax={row.limit > 0 ? row.limit : Math.max(row.used, 1)}
        aria-valuenow={row.limit > 0 ? Math.min(row.used, row.limit) : row.used}
        aria-valuetext={row.text}
      >
        <div className="budget-meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="budget-row-foot">
        <span>{row.text}</span>
        <span className="budget-source">{row.source}</span>
      </div>
    </li>
  );
}

const defaultText = (value: number): string =>
  value > 0
    ? `The deployment default, ${value.toLocaleString('en-GB')}`
    : 'The deployment default, no limit';

function BudgetForm({ view, state }: { view: BudgetView; state: BudgetState }) {
  const id = useId();
  const [calls, setCalls] = useState(limitFieldText(view.own.callLimit));
  const [tokens, setTokens] = useState(limitFieldText(view.own.tokenLimit));
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const callLimit = parseLimit(calls);
    if (!callLimit.ok) {
      setProblem(`Model call limit: ${callLimit.message}`);
      return;
    }
    const tokenLimit = parseLimit(tokens);
    if (!tokenLimit.ok) {
      setProblem(`Token limit: ${tokenLimit.message}`);
      return;
    }
    setProblem(null);
    await state.save({ callLimit: callLimit.value, tokenLimit: tokenLimit.value });
  };

  const failure = problem ?? state.saveError;
  return (
    <form
      className="view-stack budget-form"
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-describedby={`${id}-help ${id}-result`}
      onChangeCapture={() => setProblem(null)}
    >
      <h3>Change the limits</h3>
      <p id={`${id}-help`} className="field-help">
        Leave a field empty to use the deployment’s default, shown in it. Enter 0 for no limit.
      </p>
      <div className="field">
        <label htmlFor={`${id}-calls`}>Model call limit</label>
        <input
          id={`${id}-calls`}
          inputMode="numeric"
          autoComplete="off"
          value={calls}
          disabled={state.saving}
          onChange={(event) => setCalls(event.target.value)}
          placeholder={defaultText(view.defaults.callLimit)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-tokens`}>Token limit (input and output together)</label>
        <input
          id={`${id}-tokens`}
          inputMode="numeric"
          autoComplete="off"
          value={tokens}
          disabled={state.saving}
          onChange={(event) => setTokens(event.target.value)}
          placeholder={defaultText(view.defaults.tokenLimit)}
        />
      </div>
      <div id={`${id}-result`} aria-live="polite">
        {failure && (
          <Notice tone="error" title="The limits were not saved">
            {failure}
          </Notice>
        )}
        {!failure && state.saved && (
          <Notice tone="success" title="The limits were saved">
            They apply to the next model call of this project.
          </Notice>
        )}
      </div>
      <div className="stage-actions">
        <button className="button button-primary" type="submit" disabled={state.saving}>
          {state.saving && <Spinner label="Saving the limits" />} Save the limits
        </button>
      </div>
    </form>
  );
}

/** What the project has used, against what it may, and the means to change that for those who may. */
export function BudgetPanel({ state }: { state: BudgetState }) {
  const { budget, loading, error, reload } = state;
  if (error && !budget) {
    return (
      <Notice
        tone="error"
        title="The model budget could not be read"
        action={
          <button className="button button-secondary button-small" type="button" onClick={reload}>
            Retry
          </button>
        }
      >
        {error}
      </Notice>
    );
  }
  if (!budget) {
    return loading ? (
      <div className="inline-pending" role="status">
        <Spinner label="Loading the model budget" /> Reading the model budget…
      </div>
    ) : (
      <EmptyPanel title="No model budget to show" icon={<Gauge size={25} aria-hidden="true" />}>
        This project has not been asked for its model budget.
      </EmptyPanel>
    );
  }
  const notice = budgetNotice(budget);
  return (
    <div className="budget-panel view-stack">
      <p className="audit-intro">
        What this project may spend on the model, in all. A call is counted when it completes, so
        the call that reaches a limit is the last: the next is refused, and the refusal is recorded
        in the audit log. Calls already in flight may finish over a limit. Reading, editing and
        exporting never use the model.
      </p>
      {notice && (
        <Notice tone={notice.tone} title={notice.title}>
          {notice.body}
        </Notice>
      )}
      <ul className="budget-rows" aria-label="Model budget">
        {budgetRows(budget).map((row) => (
          <BudgetRowView key={row.id} row={row} />
        ))}
      </ul>
      {budget.may.edit ? (
        <BudgetForm
          key={`${budget.own.callLimit}/${budget.own.tokenLimit}`}
          view={budget}
          state={state}
        />
      ) : (
        <p className="field-help">
          A workspace owner or administrator sets these limits. They are in place for this project
          whoever starts the work.
        </p>
      )}
    </div>
  );
}

export function BudgetDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const state = useBudget(projectId, true, 0);
  return (
    <Modal title="Model budget" onClose={onClose}>
      <BudgetPanel state={state} />
    </Modal>
  );
}

/** A warning above the project when its budget is running low or used up, with a way to the details. */
export function BudgetNotice({
  budget,
  onOpen,
}: {
  budget: BudgetView | null;
  onOpen: () => void;
}) {
  const notice = budget ? budgetNotice(budget) : null;
  if (!notice) return null;
  return (
    <Notice
      tone={notice.tone}
      title={notice.title}
      action={
        <button className="button button-secondary button-small" type="button" onClick={onOpen}>
          Model budget
        </button>
      }
    >
      {notice.body}
    </Notice>
  );
}
