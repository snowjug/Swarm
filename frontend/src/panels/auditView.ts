import type { AuditEntry } from '../../../shared/types';
import type { Verification } from '../hooks/useAudit';
import { actionLabel, shortValue } from '../lib/audit';

export type AuditCategory = 'work' | 'evidence' | 'access' | 'exports' | 'model';

export const CATEGORY_ORDER: readonly AuditCategory[] = [
  'work',
  'evidence',
  'access',
  'exports',
  'model',
];

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  work: 'Work',
  evidence: 'Evidence & review',
  access: 'Access',
  exports: 'Exports',
  model: 'Model',
};

const RULES: readonly [RegExp, AuditCategory][] = [
  [/^(provider|model)\.|^project\.budget\./u, 'model'],
  [/^(access|session|workspace)\.|^project\.member\./u, 'access'],
  [/^export\.|\.exported$/u, 'exports'],
  [/^(ledger|claim|conflict|evidence|studio|critique|critiques)\./u, 'evidence'],
];

/** Which kind of thing an action was, so that a long log can be read by kind. Anything not named is work. */
export function auditCategory(action: string): AuditCategory {
  for (const [pattern, category] of RULES) if (pattern.test(action)) return category;
  return 'work';
}

export interface DetailPair {
  key: string;
  value: string;
}

/** "callLimit" is read as "call limit": the log's keys are the engine's, and the page speaks plainly. */
export function humaniseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[._-]+/gu, ' ')
    .toLowerCase();
}

/** What an entry recorded, in the order the log kept it. */
export function detailPairs(detail: AuditEntry['detail']): DetailPair[] {
  return Object.entries(detail).map(([key, value]) => ({
    key: humaniseKey(key),
    value: typeof value === 'boolean' ? (value ? 'yes' : 'no') : shortValue(value),
  }));
}

export interface EntryView {
  seq: number;
  at: string;
  title: string;
  /** The log's own code for the action: shown as a tooltip, since the page speaks in plainer words. */
  code: string;
  actor: string;
  actorFull: string;
  category: AuditCategory;
  pairs: DetailPair[];
}

/** The page's name for an action; a code it has no name for is at least spelt out as words. */
export function actionTitle(action: string): string {
  const label = actionLabel(action);
  if (label !== action) return label;
  const words = action.replace(/[._-]+/gu, ' ').trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : action;
}

export function entryView(entry: AuditEntry): EntryView {
  return {
    seq: entry.seq,
    at: entry.at,
    title: actionTitle(entry.action),
    code: entry.action,
    actor: shortValue(entry.actor),
    actorFull: entry.actor,
    category: auditCategory(entry.action),
    pairs: detailPairs(entry.detail),
  };
}

/** Newest first, which is what a person looking for what just happened wants. */
export function newestFirst<T extends { seq: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => b.seq - a.seq);
}

export function matchesAuditQuery(view: EntryView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    view.title,
    view.code,
    view.actor,
    view.actorFull,
    `#${view.seq}`,
    ...view.pairs.map((pair) => `${pair.key} ${pair.value}`),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function categoryCounts(views: readonly EntryView[]): Record<AuditCategory, number> {
  const counts: Record<AuditCategory, number> = {
    work: 0,
    evidence: 0,
    access: 0,
    exports: 0,
    model: 0,
  };
  for (const view of views) counts[view.category] += 1;
  return counts;
}

/** The categories worth offering: only when the log holds more than one kind of thing. */
export function offeredCategories(counts: Record<AuditCategory, number>): AuditCategory[] {
  const present = CATEGORY_ORDER.filter((category) => counts[category] > 0);
  return present.length > 1 ? present : [];
}

/**
 * Where an entry stands once the chain has been checked. The check runs over the whole log, oldest to
 * newest, and stops at the first entry that does not match the one before it: everything older matched, and
 * nothing after the break can be vouched for.
 */
export type Integrity = 'unchecked' | 'verified' | 'broken' | 'after-break';

export function entryIntegrity(seq: number, verification: Verification): Integrity {
  if (verification.state !== 'done') return 'unchecked';
  const { ok, brokenAt } = verification.result;
  if (ok) return 'verified';
  if (brokenAt === null) return 'unchecked';
  if (seq < brokenAt) return 'verified';
  return seq === brokenAt ? 'broken' : 'after-break';
}

export const PAGE = 120;
