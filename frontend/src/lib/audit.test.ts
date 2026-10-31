/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../../shared/types';
import { actionLabel, detailText, newestFirst, shortValue } from './audit';

/**
 * Every action the server writes to the audit log, read from the code that writes it: the dotted names
 * in the value of an `action` property (either side of a condition too), in any backend file.
 */
function recordedActions(): string[] {
  const root = new URL('../../../backend/src/', import.meta.url);
  const found = new Set<string>();
  for (const name of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const file = ts.createSourceFile(
      name,
      readFileSync(new URL(name, root), 'utf8'),
      ts.ScriptTarget.Latest,
    );
    const collect = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && /^[a-z]+(?:\.[a-z]+)+$/u.test(node.text)) {
        found.add(node.text);
      }
      ts.forEachChild(node, collect);
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'action'
      ) {
        collect(node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return [...found].sort();
}

/** The `studio.*` actions the server can record, read from the code that records them. */
function recordedStudioActions(): string[] {
  const sources = ['backend/src/studio/service.ts', 'backend/src/auth/audit-policy.ts'];
  const found = new Set<string>();
  for (const source of sources) {
    const text = readFileSync(new URL(`../../../${source}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/'(studio\.[a-z]+(?:\.[a-z]+)?)'/gu)) found.add(match[1]!);
  }
  return [...found].sort();
}

/** The model-budget actions the server can record, read from the code that records them. */
function recordedBudgetActions(): string[] {
  const sources = ['backend/src/storage/repository.ts', 'backend/src/auth/audit-policy.ts'];
  const found = new Set<string>();
  for (const source of sources) {
    const text = readFileSync(new URL(`../../../${source}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/'((?:project|model)\.budget\.[a-z]+)'/gu)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
}

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

  it('shows an unknown action as it is', () => {
    expect(actionLabel('studio.something.new')).toBe('studio.something.new');
  });

  it('names every action the server records, so that none reaches the audit log as a bare code', () => {
    const actions = recordedActions();
    // A floor, so that a change that stops the code being read cannot pass by finding nothing.
    expect(actions.length).toBeGreaterThanOrEqual(50);
    expect(actions).toEqual(
      expect.arrayContaining(['actors.generated', 'brief.generated', 'workspace.member.changed']),
    );
    for (const action of actions) {
      expect(actionLabel(action), action).not.toBe(action);
    }
  });

  it('names every action the report studio records, so that none reaches the audit log as a bare code', () => {
    const actions = recordedStudioActions();
    expect(actions.length).toBeGreaterThanOrEqual(15);
    for (const action of actions) {
      expect(actionLabel(action), action).not.toBe(action);
    }
  });

  it('names every action the model budget records, so that none reaches the audit log as a bare code', () => {
    const actions = recordedBudgetActions();
    expect(actions).toEqual(['model.budget.exhausted', 'project.budget.changed']);
    for (const action of actions) {
      expect(actionLabel(action), action).not.toBe(action);
    }
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
