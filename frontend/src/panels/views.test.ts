import { describe, expect, it } from 'vitest';
import type { AuditEntry, ProjectSummary } from '../../../shared/types';
import type { BudgetView } from '../../../shared/budget';
import { localStatusFixture, realStatusFixture } from '../test/provider';
import { COPY, lockedReason, projectScheme, roleChoices, workspaceScheme } from './accessView';
import {
  actionTitle,
  auditCategory,
  categoryCounts,
  detailPairs,
  entryIntegrity,
  entryView,
  humaniseKey,
  matchesAuditQuery,
  offeredCategories,
} from './auditView';
import {
  defaultText,
  draftOf,
  draftValue,
  guardLine,
  inBudget,
  isDirty,
  meterReading,
  meterTone,
} from './budgetView';
import {
  branchNote,
  canCompare,
  canDelete,
  countLine,
  filterCounts,
  matchesFilter,
  matchesQuery,
  newestFirst,
  offeredFilters,
  rowState,
} from './historyView';
import { chipModel, chipName, detailRows, headline, verifyReason } from './providerView';
import { hashString, orbParts, shortIdentifier } from './shared/identity';
import { dayLabel, groupByDay, timeAgo } from './shared/time';

const NOW = new Date(2026, 10, 15, 14, 30);
const at = (days: number, hour = 9): string => new Date(2026, 10, 15 - days, hour, 0).toISOString();

describe('time, said plainly', () => {
  it('names today, yesterday and a weekday, then dates', () => {
    expect(dayLabel(at(0), NOW)).toBe('Today');
    expect(dayLabel(at(1), NOW)).toBe('Yesterday');
    expect(dayLabel(at(3), NOW)).toMatch(/^[A-Z][a-z]+$/u);
    expect(dayLabel(at(30), NOW)).not.toMatch(/Today|Yesterday/u);
    expect(dayLabel('not a date', NOW)).toBe('Unknown date');
  });

  it('says how long ago in short words and falls back to the day', () => {
    expect(timeAgo(new Date(NOW.getTime() - 10_000).toISOString(), NOW)).toBe('just now');
    expect(timeAgo(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe('5 min ago');
    expect(timeAgo(at(1), NOW)).toBe('yesterday');
    expect(timeAgo(at(3), NOW)).toBe('3 d ago');
    expect(timeAgo(at(20), NOW)).toBe(dayLabel(at(20), NOW));
  });

  it('splits a list wherever the local day changes, keeping its order', () => {
    const groups = groupByDay([at(0, 12), at(0, 8), at(1, 20), at(0, 6)], (item) => item, NOW);
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['Today', 1],
    ]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length);
  });
});

describe('an identifier keeps its look', () => {
  it('hashes the same way every time and derives two different colours', () => {
    expect(hashString('agent-1')).toBe(hashString('agent-1'));
    for (const seed of ['agent-1', 'agent-2', 'x', '', 'a very long identifier with spaces']) {
      const parts = orbParts(seed);
      expect(parts).toEqual(orbParts(seed));
      expect(parts.a).toBeGreaterThanOrEqual(1);
      expect(parts.b).toBeLessThanOrEqual(8);
      expect(parts.a).not.toBe(parts.b);
    }
  });

  it('shortens only identifiers that are long and opaque', () => {
    expect(shortIdentifier('1c7ffa13-0b1d-4ec6-b1c1-8cf7f1b8b78e')).toBe('1c7ffa13…');
    expect(shortIdentifier('alice@example.com')).toBe('alice@example.com');
  });
});

const project = (patch: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p-1',
  name: 'Copilot in Teams',
  workflow: 'guided',
  question: 'What could happen if the assistant is on by default?',
  status: 'completed',
  stage: 'report',
  progress: 100,
  mode: 'local',
  agentCount: 4,
  roundCount: 8,
  currentRound: 8,
  createdAt: '2026-11-01T09:00:00Z',
  updatedAt: '2026-11-01T09:30:00Z',
  error: null,
  parentId: null,
  ...patch,
});

describe('the history list', () => {
  it('says what each exploration is doing, with progress only where it is real', () => {
    expect(rowState(project({ status: 'running', progress: 42.4 }))).toMatchObject({
      kind: 'working',
      label: 'Running 42%',
      progress: 0.424,
    });
    expect(rowState(project({ status: 'queued' }))).toMatchObject({
      kind: 'working',
      progress: null,
    });
    expect(
      rowState(project({ status: 'ready', stage: 'simulation', currentRound: 3, roundCount: 8 })),
    ).toMatchObject({
      kind: 'paused',
      label: 'Paused · round 3 of 8',
    });
    expect(rowState(project({ status: 'ready', stage: 'intake', currentRound: 0 })).kind).toBe(
      'ready',
    );
    expect(rowState(project({ status: 'failed', progress: 250 })).progress).toBe(1);
    expect(rowState(project({ status: 'draft' })).progress).toBeNull();
  });

  it('filters, searches by every word, and offers only filters that hold something', () => {
    const list = [
      project({ id: 'a', status: 'running' }),
      project({ id: 'b', status: 'completed', parentId: 'a', name: 'Branch of Teams' }),
      project({ id: 'c', status: 'failed' }),
      project({ id: 'd', status: 'cancelled' }),
    ];
    expect(filterCounts(list)).toEqual({ all: 4, working: 1, done: 1, stopped: 2, branches: 1 });
    expect(offeredFilters(filterCounts(list))).toEqual([
      'all',
      'working',
      'done',
      'stopped',
      'branches',
    ]);
    expect(offeredFilters(filterCounts([project()]))).toEqual(['all', 'done']);
    expect(offeredFilters(filterCounts([]))).toEqual([]);
    expect(matchesFilter(list[2]!, 'stopped')).toBe(true);
    expect(matchesQuery(list[1]!, 'branch teams')).toBe(true);
    expect(matchesQuery(list[1]!, 'branch nothing')).toBe(false);
    expect(matchesQuery(list[1]!, '   ')).toBe(true);
  });

  it('puts the latest first, names the parent of a branch, and counts honestly', () => {
    const older = project({ id: 'o', updatedAt: '2026-10-01T00:00:00Z' });
    const newer = project({ id: 'n', updatedAt: '2026-11-02T00:00:00Z', parentId: 'o' });
    expect(newestFirst([older, newer]).map((item) => item.id)).toEqual(['n', 'o']);
    expect(branchNote(newer, [older, newer])).toBe('Branch of Copilot in Teams');
    expect(branchNote(newer, [newer])).toContain('unavailable parent (o)');
    expect(branchNote(older, [])).toBeNull();
    expect(countLine(1, 1, 1, false)).toBe('1 exploration');
    expect(countLine(150, 100, 100, false)).toBe('Showing 100 of 150 explorations');
    expect(countLine(5, 5, 2, true)).toBe('2 of 5 explorations');
  });

  it('never offers to delete or compare what cannot be', () => {
    expect(canDelete(project({ status: 'running' }), false)).toBe(false);
    expect(canDelete(project({ status: 'completed' }), true)).toBe(false);
    expect(canDelete(project({ status: 'completed' }), false)).toBe(true);
    expect(canCompare(project(), false)).toBe(false);
    expect(canCompare(project({ currentRound: 0 }), true)).toBe(false);
    expect(canCompare(project({ workflow: 'quick' }), true)).toBe(false);
    expect(canCompare(project(), true)).toBe(true);
  });
});

const entry = (patch: Partial<AuditEntry> = {}): AuditEntry => ({
  seq: 5,
  at: '2026-11-01T09:00:00Z',
  actor: '1c7ffa13-0b1d-4ec6-b1c1-8cf7f1b8b78e',
  action: 'project.budget.updated',
  targetType: 'project',
  targetId: 'p-1',
  projectId: 'p-1',
  detail: { callLimit: 40, ledgerEnabled: true, note: null },
  prevHash: 'a',
  hash: 'b',
  ...patch,
});

describe('the audit log', () => {
  it('sorts each action into a kind, and anything unnamed is work', () => {
    expect(auditCategory('project.budget.updated')).toBe('model');
    expect(auditCategory('project.member.added')).toBe('access');
    expect(auditCategory('session.signed-in')).toBe('access');
    expect(auditCategory('export.requested')).toBe('exports');
    expect(auditCategory('claim.reviewed')).toBe('evidence');
    expect(auditCategory('project.created')).toBe('work');
  });

  it('speaks plainly about keys, values and unknown actions', () => {
    expect(humaniseKey('callLimit')).toBe('call limit');
    expect(humaniseKey('input_tokens')).toBe('input tokens');
    expect(
      detailPairs({ ledgerEnabled: true, off: false, none: null }).map((pair) => pair.value),
    ).toEqual(['yes', 'no', expect.any(String)]);
    expect(actionTitle('brand.new-thing')).toBe('Brand new thing');
  });

  it('finds an entry by any word of what it says, and offers kinds only when there are several', () => {
    const view = entryView(entry());
    expect(view.actor).toBe('1c7ffa13…');
    expect(view.category).toBe('model');
    expect(matchesAuditQuery(view, 'call limit 40')).toBe(true);
    expect(matchesAuditQuery(view, '#5')).toBe(true);
    expect(matchesAuditQuery(view, 'zzz')).toBe(false);
    const counts = categoryCounts([view, entryView(entry({ action: 'project.created' }))]);
    expect(offeredCategories(counts)).toEqual(['work', 'model']);
    expect(offeredCategories(categoryCounts([view]))).toEqual([]);
  });

  it('marks the chain: what matched, the break, and what cannot be vouched for', () => {
    const done = (ok: boolean, brokenAt: number | null) =>
      ({ state: 'done', result: { ok, brokenAt, checked: 10 } }) as unknown as Parameters<
        typeof entryIntegrity
      >[1];
    expect(entryIntegrity(3, { state: 'idle' })).toBe('unchecked');
    expect(entryIntegrity(3, done(true, null))).toBe('verified');
    expect(entryIntegrity(3, done(false, 5))).toBe('verified');
    expect(entryIntegrity(5, done(false, 5))).toBe('broken');
    expect(entryIntegrity(6, done(false, 5))).toBe('after-break');
    expect(entryIntegrity(6, done(false, null))).toBe('unchecked');
  });
});

const budget = (patch: Partial<BudgetView> = {}): BudgetView => ({
  calls: 4,
  inputTokens: 1_000,
  outputTokens: 200,
  callLimit: 5,
  tokenLimit: 0,
  own: { callLimit: null, tokenLimit: null },
  defaults: { callLimit: 5, tokenLimit: 0 },
  state: 'warning',
  may: { edit: true },
  ...patch,
});

describe('the model budget editor', () => {
  it('starts from what the project has: default, custom or none', () => {
    expect(draftOf(null)).toEqual({ mode: 'default', text: '' });
    expect(draftOf(0)).toEqual({ mode: 'none', text: '' });
    expect(draftOf(40)).toEqual({ mode: 'custom', text: '40' });
  });

  it('saves only what means something, and says why not otherwise', () => {
    expect(draftValue({ mode: 'default', text: '' })).toEqual({ ok: true, value: null });
    expect(draftValue({ mode: 'none', text: '' })).toEqual({ ok: true, value: 0 });
    expect(draftValue({ mode: 'custom', text: '1,200' })).toEqual({ ok: true, value: 1200 });
    expect(draftValue({ mode: 'custom', text: '' })).toMatchObject({ ok: false });
    expect(draftValue({ mode: 'custom', text: '0' })).toMatchObject({
      ok: false,
      message: 'Choose No limit to lift the limit.',
    });
    expect(draftValue({ mode: 'custom', text: '2.5' })).toMatchObject({ ok: false });
    expect(draftValue({ mode: 'custom', text: '99999999999' })).toMatchObject({ ok: false });
  });

  it('offers Save only when it would change something', () => {
    expect(isDirty(draftOf(40), 40)).toBe(false);
    expect(isDirty({ mode: 'custom', text: '41' }, 40)).toBe(true);
    expect(isDirty({ mode: 'default', text: '' }, 40)).toBe(true);
    expect(isDirty({ mode: 'custom', text: 'x' }, 40)).toBe(true);
    expect(defaultText(0)).toContain('no limit');
    expect(defaultText(1500)).toContain('1,500');
  });

  it('reads meters in the numbers a meter has, and colours by state', () => {
    expect(meterReading({ label: 'Model calls', used: 9, limit: 5 } as never)).toEqual({
      now: 5,
      max: 5,
    });
    expect(meterReading({ label: 'Tokens', used: 700, limit: 0 } as never)).toEqual({
      now: 700,
      max: 700,
    });
    expect(meterTone('warning')).toBe('caution');
    expect(meterTone('exhausted')).toBe('critical');
    expect(meterTone('none')).toBe('neutral');
  });

  it('puts the line above the project only when the budget is low or out, and drops what it repeats', () => {
    expect(guardLine(budget({ state: 'ok', calls: 1 }))).toBeNull();
    const low = guardLine(budget())!;
    expect(low.tone).toBe('warning');
    expect(low.where).toMatch(/model calls/u);
    expect(low.body.startsWith(low.where)).toBe(false);
    expect(guardLine(budget({ state: 'exhausted', calls: 5 }))!.tone).toBe('error');
    expect(inBudget('It stops. You can raise the limit in the model budget.')).toBe('It stops.');
    expect(inBudget('Nothing to drop.')).toBe('Nothing to drop.');
  });
});

describe('who has access', () => {
  it('offers every role, shows those that cannot be given, and locks owners to owners', () => {
    expect(roleChoices(projectScheme).every((choice) => choice.allowed)).toBe(true);
    const admin = workspaceScheme('admin');
    const owner = workspaceScheme('owner');
    expect(roleChoices(admin).some((choice) => !choice.allowed)).toBe(true);
    expect(roleChoices(owner).every((choice) => choice.allowed)).toBe(true);
    expect(lockedReason(admin, 'owner', true)).toBe('Only an owner changes an owner.');
    expect(lockedReason(owner, 'owner', true)).toBeNull();
    expect(lockedReason(admin, 'owner', false)).toBeNull();
    expect(lockedReason(projectScheme, 'lead', true)).toBeNull();
  });

  it('says in its own words what removing a person does', () => {
    expect(COPY.project.removeNote).toMatch(/no longer see/u);
    expect(COPY.workspace.removeNote).toMatch(/every project/u);
    expect(COPY.workspace.readOnly).toBeNull();
    expect(projectScheme.initial).toBe('viewer');
    expect(workspaceScheme(null).initial).toBe('member');
  });
});

describe('the provider chip', () => {
  it('shows rules as rules, never as a connection', () => {
    const model = chipModel(localStatusFixture(), false);
    expect(model).toMatchObject({ kind: 'local', label: 'Local rules', detail: null });
    expect(headline(localStatusFixture(), false).title).toBe('No model in use');
    expect(verifyReason(localStatusFixture())).toMatch(/Nothing to verify/u);
    const rows = detailRows(localStatusFixture(), false).map((row) => row.label);
    expect(rows).toContain('Verification');
  });

  it('names a real model with the deployment, and says when the status could not be read', () => {
    const status = realStatusFixture();
    const model = chipModel(status, false);
    expect(model.kind).toBe('real');
    expect(chipName(model, status)).toContain(status.model!);
    expect(verifyReason(status)).toBeNull();
    expect(headline(status, true).title).toBe('Status unavailable');
    expect(chipModel(null, true)).toMatchObject({ kind: 'unavailable', label: 'Provider' });
    expect(headline(null, false).title).toBe('Checking…');
    expect(verifyReason(null)).toMatch(/not available yet/u);
  });
});
