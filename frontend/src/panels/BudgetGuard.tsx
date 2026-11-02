import { useEffect, useId, useState } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import type { ProjectDetail } from '../../../shared/types';
import { onAcceptedChange } from '../api';
import { cx } from '../design/cx';
import { Button } from '../design/ui';
import { useBudget } from '../hooks/useBudget';
import { guardLine } from './budgetView';
import './budget.css';

/**
 * A line at the top of a model-assisted project that says so when its budget is nearly or wholly used.
 * It reads the budget itself, again whenever the project has made another call or the limits change, and
 * is nothing at all while the budget is not a concern. It is on the page of every project, so it lives
 * apart from the dialog it opens, which is only fetched when someone asks for it.
 */
export function BudgetGuard({ project, onOpen }: { project: ProjectDetail; onOpen: () => void }) {
  const { budget, reload } = useBudget(
    project.id,
    project.mode === 'llm',
    project.execution?.modelCalls ?? 0,
  );
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  // The limits can be changed from the dialog: the line follows without anyone telling it.
  useEffect(
    () =>
      onAcceptedChange((path) => {
        if (path.endsWith(`/projects/${encodeURIComponent(project.id)}/budget`)) reload();
      }),
    [project.id, reload],
  );

  const line = budget ? guardLine(budget) : null;
  if (!line) return null;
  return (
    <section
      className="sw-budget-guard sw-rise"
      data-tone={line.tone}
      role="status"
      aria-label="Model budget"
    >
      <div className="sw-budget-guard__row">
        <Gauge className="sw-budget-guard__icon" size={18} aria-hidden="true" />
        <p className="sw-budget-guard__text">
          <strong>{line.title}</strong>
          {line.where && <span className="sw-budget-guard__where">{line.where}</span>}
        </p>
        <button
          type="button"
          className="sw-budget-guard__more"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          Details
          <ChevronDown
            size={15}
            className={cx('sw-budget-guard__chevron', open && 'is-open')}
            aria-hidden="true"
          />
        </button>
        <Button size="sm" variant="glass" onClick={onOpen}>
          Model budget
        </Button>
      </div>
      <div
        id={bodyId}
        className="sw-budget-guard__body"
        data-open={open}
        inert={!open || undefined}
      >
        <div className="sw-budget-guard__inner">
          <p className="sw-budget-guard__copy">{line.body}</p>
        </div>
      </div>
    </section>
  );
}
