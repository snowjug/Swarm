import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Gauge } from 'lucide-react';
import type { BudgetView } from '../../../shared/budget';
import { useTween } from '../design/motion';
import {
  Button,
  Chip,
  Dialog,
  DialogContent,
  Disclosure,
  EmptyState,
  Field,
  Input,
  Meter,
  Notice,
  Segmented,
  Skeleton,
} from '../design/ui';
import { useBudget, type BudgetState as BudgetHook } from '../hooks/useBudget';
import { BUDGET_STATE, budgetRows, type BudgetRow } from '../lib/budget';
import {
  defaultText,
  draftOf,
  draftValue,
  grouped,
  guardLine,
  inBudget,
  isDirty,
  meterReading,
  meterTone,
  stateTone,
  type LimitDraft,
  type LimitMode,
} from './budgetView';
import { FocusDialog } from './shared/FocusDialog';
import { usePanelLifecycle } from './shared/usePanelLifecycle';
import './budget.css';

export interface BudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onChanged: () => void;
}

/** Where a measure stands against its limit: a bar that fills toward it, with the point at which the page starts to say so. */
function LimitMeter({ row }: { row: BudgetRow }) {
  const reading = meterReading(row);
  if (row.limit > 0) {
    return (
      <div className="sw-budget__meter">
        <Meter
          value={reading.now}
          max={reading.max}
          label={row.label}
          valueText={row.text}
          tone={meterTone(row.state)}
        />
        <span className="sw-budget__mark" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div
      className="sw-budget__open"
      role="meter"
      aria-label={row.label}
      aria-valuemin={0}
      aria-valuemax={reading.max}
      aria-valuenow={reading.now}
      aria-valuetext={row.text}
    />
  );
}

/** What has been used, said large; it eases to the figure the server reports. */
function Used({ value }: { value: number }) {
  const shown = useTween(value);
  return <>{grouped(Math.round(shown))}</>;
}

const MODE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'custom', label: 'Custom' },
  { value: 'none', label: 'No limit' },
] as const;

/** One limit, set in one gesture: left to the deployment, a number of its own, or lifted. */
function LimitEditor({
  label,
  draft,
  onChange,
  defaultLimit,
  error,
  disabled,
}: {
  label: string;
  draft: LimitDraft;
  onChange: (draft: LimitDraft) => void;
  defaultLimit: number;
  error: string | undefined;
  disabled: boolean;
}) {
  const custom = draft.mode === 'custom';
  return (
    <div className="sw-budget__editor">
      <div className="sw-budget__choose">
        <Segmented
          label={`${label}: how it is set`}
          size="sm"
          value={draft.mode}
          options={MODE_OPTIONS}
          onChange={(mode: LimitMode) => onChange({ ...draft, mode })}
        />
        <div className="sw-budget__custom" data-open={custom}>
          <div className="sw-budget__custom-inner" inert={!custom || undefined}>
            <Field label={label} labelHidden error={error}>
              <Input
                inputMode="numeric"
                autoComplete="off"
                value={draft.text}
                disabled={disabled}
                placeholder="A whole number"
                onChange={(event) => onChange({ ...draft, text: event.target.value })}
              />
            </Field>
          </div>
        </div>
      </div>
      {draft.mode === 'default' && <p className="sw-caption">{defaultText(defaultLimit)}</p>}
      {draft.mode === 'none' && (
        <p className="sw-caption">Lifted: this project may use the model without a limit.</p>
      )}
    </div>
  );
}

/** One measure of the budget: what has been used against what is allowed, as a number, a bar and a word. */
function Measure({ row, children }: { row: BudgetRow; children?: ReactNode }) {
  const id = useId();
  return (
    <section className="sw-budget__measure" data-state={row.state} aria-labelledby={id}>
      <header className="sw-budget__mhead">
        <h3 id={id} className="sw-eyebrow">
          {row.label}
        </h3>
        <Chip tone={stateTone(row.state)} size="sm" dot>
          {BUDGET_STATE[row.state].label}
        </Chip>
      </header>
      <p className="sw-budget__figure">
        <span className="sw-numeral sw-budget__used">
          <Used value={row.used} />
        </span>
        <span className="sw-budget__of">
          {row.limit > 0 ? `of ${grouped(row.limit)}` : 'used, no limit'}
        </span>
      </p>
      <LimitMeter row={row} />
      {children ?? <p className="sw-caption sw-budget__source">{row.source}</p>}
    </section>
  );
}

function BudgetForm({
  view,
  state,
  onClose,
  onSaved,
}: {
  view: BudgetView;
  state: BudgetHook;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [calls, setCalls] = useState(() => draftOf(view.own.callLimit));
  const [tokens, setTokens] = useState(() => draftOf(view.own.tokenLimit));
  const [problem, setProblem] = useState<{ calls?: string; tokens?: string } | null>(null);
  const [first, second] = budgetRows(view);
  const dirty = isDirty(calls, view.own.callLimit) || isDirty(tokens, view.own.tokenLimit);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const callLimit = draftValue(calls);
    const tokenLimit = draftValue(tokens);
    if (!callLimit.ok || !tokenLimit.ok) {
      setProblem({
        calls: callLimit.ok ? undefined : callLimit.message,
        tokens: tokenLimit.ok ? undefined : tokenLimit.message,
      });
      return;
    }
    setProblem(null);
    if (await state.save({ callLimit: callLimit.value, tokenLimit: tokenLimit.value })) onSaved();
  };

  const summary =
    problem && (problem.calls || problem.tokens)
      ? [
          problem.calls && `Model call limit: ${problem.calls}`,
          problem.tokens && `Token limit: ${problem.tokens}`,
        ]
          .filter(Boolean)
          .join(' ')
      : null;
  const failure = summary ?? state.saveError;

  return (
    <form className="sw-budget__form" noValidate onSubmit={(event) => void submit(event)}>
      <Measure row={first!}>
        <LimitEditor
          label="Model call limit"
          draft={calls}
          onChange={(next) => {
            setProblem(null);
            setCalls(next);
          }}
          defaultLimit={view.defaults.callLimit}
          error={problem?.calls}
          disabled={state.saving}
        />
      </Measure>
      <Measure row={second!}>
        <LimitEditor
          label="Token limit"
          draft={tokens}
          onChange={(next) => {
            setProblem(null);
            setTokens(next);
          }}
          defaultLimit={view.defaults.tokenLimit}
          error={problem?.tokens}
          disabled={state.saving}
        />
      </Measure>
      <div className="sw-budget__result">
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
      <div className="sw-budget__foot">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          type="submit"
          variant="primary"
          busy={state.saving}
          busyLabel="Saving"
          disabled={!dirty}
        >
          Save the limits
        </Button>
      </div>
    </form>
  );
}

/** What the project has used of its model budget, against what it may, and the means to change that for those who may. */
export function BudgetPanel({
  state,
  onClose,
  onSaved,
}: {
  state: BudgetHook;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { budget, loading, error, reload } = state;
  if (error && !budget) {
    return (
      <Notice
        tone="error"
        title="The model budget could not be read"
        action={
          <Button size="sm" variant="glass" onClick={reload}>
            Retry
          </Button>
        }
      >
        {error}
      </Notice>
    );
  }
  if (!budget) {
    return loading ? (
      <div className="sw-budget__loading" aria-busy="true">
        <span className="sr-only" role="status">
          Reading the model budget
        </span>
        <Skeleton height="1.2rem" width="40%" />
        <Skeleton height="2.6rem" width="55%" />
        <Skeleton height="0.4rem" />
        <Skeleton height="1.2rem" width="40%" />
        <Skeleton height="2.6rem" width="55%" />
        <Skeleton height="0.4rem" />
      </div>
    ) : (
      <EmptyState icon={<Gauge size={22} aria-hidden="true" />} title="No model budget to show">
        This project has not been asked for its model budget.
      </EmptyState>
    );
  }
  const notice = guardLine(budget);
  const rows = budgetRows(budget);
  return (
    <div className="sw-budget">
      {notice && (
        <Notice tone={notice.tone === 'error' ? 'error' : 'caution'} title={notice.title}>
          {inBudget(notice.body)}
        </Notice>
      )}
      {budget.may.edit ? (
        <BudgetForm
          key={`${budget.own.callLimit}/${budget.own.tokenLimit}`}
          view={budget}
          state={state}
          onClose={onClose}
          onSaved={() => onSaved?.()}
        />
      ) : (
        <>
          <div className="sw-budget__form">
            {rows.map((row) => (
              <Measure key={row.id} row={row} />
            ))}
          </div>
          <p className="sw-caption">
            A workspace owner or administrator sets these limits. They are in place for this project
            whoever starts the work.
          </p>
          <div className="sw-budget__foot">
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
      <Disclosure summary="How the limits work" className="sw-budget__how">
        <p className="sw-caption sw-budget__how-text">
          A call is counted when it completes, so the call that reaches a limit is the last: the
          next is refused, and the refusal is recorded in the audit log. Calls already in flight may
          finish over a limit. Reading, editing and exporting never use the model. “Default” follows
          the deployment; “No limit” lifts it for this project.
        </p>
      </Disclosure>
    </div>
  );
}

/** What this project may spend on the model, what it has, and a way to change the limits for those who may. */
export function BudgetDialog({ open, onOpenChange, projectId, onChanged }: BudgetDialogProps) {
  const lifecycle = usePanelLifecycle(open, onOpenChange, 'dialog');
  const state = useBudget(projectId, true, 0);
  return (
    <Dialog open={lifecycle.open} onOpenChange={lifecycle.onOpenChange}>
      <DialogContent
        title="Model budget"
        description="What this exploration may spend on the model, in all."
        className="sw-budget-dialog"
      >
        <FocusDialog />
        <BudgetPanel
          state={state}
          onClose={() => lifecycle.onOpenChange(false)}
          onSaved={onChanged}
        />
      </DialogContent>
    </Dialog>
  );
}
