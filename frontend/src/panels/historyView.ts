import type { ProjectStatus, ProjectSummary } from '../../../shared/types';
import { realModelLabel } from '../lib/provider';
import { historyStatus } from '../lib/whatIf';

export type HistoryFilter = 'all' | 'working' | 'done' | 'stopped' | 'branches';

export const FILTER_LABELS: Record<HistoryFilter, string> = {
  all: 'All',
  working: 'Working',
  done: 'Done',
  stopped: 'Stopped',
  branches: 'Branches',
};

export const FILTER_ORDER: readonly HistoryFilter[] = [
  'all',
  'working',
  'done',
  'stopped',
  'branches',
];

export type RowKind =
  'working' | 'paused' | 'complete' | 'failed' | 'cancelled' | 'ready' | 'draft';

export interface RowState {
  kind: RowKind;
  /** The few words that say it. */
  label: string;
  /** A share of the work that is real: the run's progress while it is under way, the checkpoint when it is paused. */
  progress: number | null;
}

/** What a saved exploration is doing, in the words a list can afford, from what the server lists of it. */
export function rowState(project: ProjectSummary): RowState {
  const status = historyStatus(project);
  switch (status) {
    case 'queued':
      return { kind: 'working', label: 'Queued', progress: null };
    case 'running':
      return {
        kind: 'working',
        label: `Running ${Math.round(project.progress)}%`,
        progress: clamp(project.progress / 100),
      };
    case 'paused':
      return {
        kind: 'paused',
        label: `Paused · round ${project.currentRound} of ${project.roundCount}`,
        progress: clamp(project.currentRound / Math.max(project.roundCount, 1)),
      };
    case 'completed':
      return { kind: 'complete', label: 'Complete', progress: 1 };
    case 'failed':
      return { kind: 'failed', label: 'Stopped', progress: clamp(project.progress / 100) };
    case 'cancelled':
      return { kind: 'cancelled', label: 'Cancelled', progress: clamp(project.progress / 100) };
    case 'draft':
      return { kind: 'draft', label: 'Draft', progress: null };
    default:
      return { kind: 'ready', label: 'Ready', progress: null };
  }
}

const clamp = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const isWorking = (status: ProjectStatus): boolean => status === 'queued' || status === 'running';

export function matchesFilter(project: ProjectSummary, filter: HistoryFilter): boolean {
  switch (filter) {
    case 'working':
      return isWorking(project.status);
    case 'done':
      return project.status === 'completed';
    case 'stopped':
      return project.status === 'failed' || project.status === 'cancelled';
    case 'branches':
      return project.parentId !== null;
    default:
      return true;
  }
}

/** Every word the person typed must be somewhere in the name, the question or the identifier. */
export function matchesQuery(project: ProjectSummary, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${project.name} ${project.question} ${project.id}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** How many each filter would show, so that a filter with nothing behind it is not offered. */
export function filterCounts(projects: readonly ProjectSummary[]): Record<HistoryFilter, number> {
  return Object.fromEntries(
    FILTER_ORDER.map((filter) => [
      filter,
      projects.filter((project) => matchesFilter(project, filter)).length,
    ]),
  ) as Record<HistoryFilter, number>;
}

/** The filters worth showing: those that hold something, and only when there is more than one way to cut the list. */
export function offeredFilters(counts: Record<HistoryFilter, number>): HistoryFilter[] {
  const others = FILTER_ORDER.filter((filter) => filter !== 'all' && counts[filter] > 0);
  return others.length === 0 ? [] : ['all', ...others];
}

/** Most recently touched first, which is where a person looking for what they were just doing begins. */
export function newestFirst(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

/** What made the exploration: rules on this server, or a real model, which the list can only name as such. */
export function engineOf(project: ProjectSummary): { label: string; real: boolean } {
  return project.mode === 'llm'
    ? { label: realModelLabel('none'), real: true }
    : { label: 'Local rules', real: false };
}

/** Where a branch came from, as the person reads it; null for an exploration that is not a branch. */
export function branchNote(project: ProjectSummary, all: readonly ProjectSummary[]): string | null {
  if (!project.parentId) return null;
  const parent = all.find((item) => item.id === project.parentId);
  return `Branch of ${parent?.name ?? `unavailable parent (${project.parentId})`}`;
}

export const canCompare = (project: ProjectSummary, whatIf: boolean): boolean =>
  whatIf && project.workflow === 'guided' && project.currentRound >= 1;

export const canDelete = (project: ProjectSummary, busy: boolean): boolean =>
  !busy && !isWorking(project.status);

/** "5 explorations", or what is shown of the whole when the server holds more than it lists. */
export function countLine(
  total: number,
  listed: number,
  matching: number,
  filtered: boolean,
): string {
  const noun = (count: number) => (count === 1 ? 'exploration' : 'explorations');
  if (filtered) return `${matching} of ${listed} ${noun(listed)}`;
  if (total > listed) return `Showing ${listed} of ${total} explorations`;
  return `${listed} ${noun(listed)}`;
}
