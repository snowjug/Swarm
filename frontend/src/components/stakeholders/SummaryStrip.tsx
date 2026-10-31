import { Eye, ListChecks, Plus, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from '../ui';
import type { NextAction, NextActionId, Summary } from './review';

const ICONS: Record<NextActionId, LucideIcon> = {
  review: ListChecks,
  add: Plus,
  approve: Users,
  'make-actors': Users,
  'review-actors': Eye,
};

const STATS: { key: keyof Summary; label: string; help: string }[] = [
  { key: 'found', label: 'found', help: 'Stakeholders in the list, not counting those removed.' },
  {
    key: 'needReview',
    label: 'need review',
    help: 'Stakeholders that nobody has accepted, edited or added yet.',
  },
  { key: 'approved', label: 'approved', help: 'Stakeholders in a list that has been approved.' },
  { key: 'actors', label: 'actors', help: 'Actors made from the approved list.' },
];

/** The picture at a glance: four counts, as text, so that a screen reader says "12 found". */
export function SummaryStats({ summary }: { summary: Summary }) {
  return (
    <ul className="stk-stats" aria-label="Summary of the stakeholders">
      {STATS.map(({ key, label, help }) => (
        <li key={key} title={help}>
          <strong>{summary[key]}</strong> {label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The one thing to do next, as a single button whose label says what it will do. It is the same
 * element from one step to the next, so that focus stays on it as its label changes.
 */
export function NextButton({
  action,
  working,
  onAction,
}: {
  action: NextAction;
  working: boolean;
  onAction: (id: NextActionId) => void;
}) {
  const Icon = ICONS[action.id];
  return (
    <button
      className={`button ${action.primary ? 'button-primary' : 'button-secondary'}`}
      type="button"
      disabled={working}
      data-stk-focus="primary"
      onClick={() => onAction(action.id)}
    >
      {working ? <Spinner label="Working" /> : <Icon size={16} aria-hidden="true" />} {action.label}
    </button>
  );
}
