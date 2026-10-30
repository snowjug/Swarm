import type { AuditEntry } from '../../../shared/types';

/** Plain-language names for the actions the audit log records. An unknown code is shown as it is. */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  'project.created': 'Project created',
  'project.deleted': 'Project deleted',
  'project.imported': 'Project restored from a snapshot',
  'branch.created': 'Branch created',
  'step.started': 'Stage started',
  'run.started': 'Run started',
  'run.paused': 'Run paused',
  'run.cancelled': 'Run cancelled',
  'intervention.set': 'Intervention scheduled',
  'environment.edited': 'Environment edited',
  'survey.started': 'Survey started',
  'survey.cancelled': 'Survey cancelled',
  'chat.asked': 'Question asked',
  'export.downloaded': 'Export downloaded',
  'ledger.built': 'Evidence ledger built',
  'claim.reviewed': 'Statement reviewed',
  'conflict.reviewed': 'Conflict reviewed',
  'access.refused': 'Access refused',
  'provider.checked': 'Model connection checked',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A long identifier is shortened to its first eight characters; everything else is shown whole. */
export function shortValue(value: string | number | boolean | null): string {
  if (value === null) return 'none';
  if (typeof value === 'string' && IDENTIFIER.test(value)) return `${value.slice(0, 8)}…`;
  return String(value);
}

/** "step: knowledge · resume: no", in the order the log recorded the keys. */
export function detailText(detail: AuditEntry['detail']): string {
  const parts = Object.entries(detail).map(([key, value]) => {
    const shown = typeof value === 'boolean' ? (value ? 'yes' : 'no') : shortValue(value);
    return `${key}: ${shown}`;
  });
  return parts.length > 0 ? parts.join(' · ') : 'no further detail';
}

/** Newest first, which is what a person looking for what just happened wants. */
export function newestFirst(entries: readonly AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => b.seq - a.seq);
}
