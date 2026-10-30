import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../../shared/types';
import { actionLabel, detailText, newestFirst, shortValue } from './audit';

const entry = (seq: number, overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  seq,
  at: '2026-10-29T10:00:00.000Z',
  actor: 'local-user',
  action: 'step.started',
  targetType: 'project',
  targetId: 'de300001-0000-4000-8000-000000000001',
  projectId: 'de300001-0000-4000-8000-000000000001',
  detail: {},
  prevHash: '0'.repeat(64),
  hash: '1'.repeat(64),
  ...overrides,
});

describe('audit presentation', () => {
  it('names every action the server records in plain language, and shows an unknown one as it is', () => {
    expect(actionLabel('project.created')).toBe('Project created');
    expect(actionLabel('export.downloaded')).toBe('Export downloaded');
    expect(actionLabel('access.refused')).toBe('Access refused');
    expect(actionLabel('something.new')).toBe('something.new');
  });

  it('shortens an identifier and nothing else', () => {
    expect(shortValue('de300001-0000-4000-8000-000000000001')).toBe('de300001…');
    expect(shortValue('knowledge')).toBe('knowledge');
    expect(shortValue(6)).toBe('6');
    expect(shortValue(null)).toBe('none');
  });

  it('writes the detail in the order the log recorded it, with yes and no for booleans', () => {
    expect(
      detailText({
        step: 'simulation',
        resume: true,
        round: 4,
        parentId: null,
        experiment: 'a'.repeat(8),
      }),
    ).toBe('step: simulation · resume: yes · round: 4 · parentId: none · experiment: aaaaaaaa');
    expect(detailText({})).toBe('no further detail');
  });

  it('puts the newest entry first without changing the list it was given', () => {
    const entries = [entry(1), entry(3), entry(2)];
    expect(newestFirst(entries).map((e) => e.seq)).toEqual([3, 2, 1]);
    expect(entries.map((e) => e.seq)).toEqual([1, 3, 2]);
  });
});
