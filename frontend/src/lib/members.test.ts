/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_ROLES,
  PROJECT_ROLE_VIEW,
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_VIEW,
  administersWorkspace,
  changedText,
  inOrder,
  mayManageWorkspaceMember,
  parseObjectId,
  shortId,
  workspaceRolesGrantableBy,
  type Member,
} from './members';

/** A list of roles as the server declares it, read from the code that decides every request. */
function serverList(name: string): string[] {
  const text = readFileSync(new URL('../../../backend/src/auth/roles.ts', import.meta.url), 'utf8');
  const match = new RegExp(`export const ${name} = \\[([^\\]]+)\\] as const;`, 'u').exec(text);
  expect(match, `${name} in backend/src/auth/roles.ts`).not.toBeNull();
  return [...match![1]!.matchAll(/'([a-z-]+)'/gu)].map((entry) => entry[1]!);
}

const OID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('the roles as the page names them', () => {
  it('are the roles the server has, in the same order, each with words of its own', () => {
    expect([...PROJECT_ROLES]).toEqual(serverList('PROJECT_ROLES'));
    expect([...WORKSPACE_ROLES]).toEqual(serverList('WORKSPACE_ROLES'));
    for (const role of PROJECT_ROLES) {
      expect(PROJECT_ROLE_VIEW[role].label, role).not.toBe('');
      expect(PROJECT_ROLE_VIEW[role].can, role).not.toBe('');
    }
    for (const role of WORKSPACE_ROLES) {
      expect(WORKSPACE_ROLE_VIEW[role].label, role).not.toBe('');
      expect(WORKSPACE_ROLE_VIEW[role].can, role).not.toBe('');
    }
  });

  it('say that a lead does not set the budget, and that a reviewer never runs or edits', () => {
    expect(PROJECT_ROLE_VIEW.lead.cannot).toContain('model budget');
    expect(PROJECT_ROLE_VIEW.reviewer.cannot).toContain('Never runs or edits');
    expect(WORKSPACE_ROLE_VIEW.admin.cannot).toContain('owner');
  });
});

describe('who may manage whom in a workspace', () => {
  it('lets an owner manage everyone and an admin everyone but the owners, and nobody else anyone', () => {
    expect([...workspaceRolesGrantableBy('owner')]).toEqual(['owner', 'admin', 'member']);
    expect([...workspaceRolesGrantableBy('admin')]).toEqual(['admin', 'member']);
    expect(workspaceRolesGrantableBy('member')).toEqual([]);
    expect(workspaceRolesGrantableBy(null)).toEqual([]);
    expect(mayManageWorkspaceMember('owner', 'owner')).toBe(true);
    expect(mayManageWorkspaceMember('admin', 'owner')).toBe(false);
    expect(mayManageWorkspaceMember('admin', 'admin')).toBe(true);
    expect(mayManageWorkspaceMember('admin', 'member')).toBe(true);
    expect(mayManageWorkspaceMember('member', 'member')).toBe(false);
    expect(mayManageWorkspaceMember(null, 'member')).toBe(false);
  });

  it('says who administers the workspace at all', () => {
    expect(administersWorkspace('owner')).toBe(true);
    expect(administersWorkspace('admin')).toBe(true);
    expect(administersWorkspace('member')).toBe(false);
    expect(administersWorkspace(null)).toBe(false);
  });

  it('agrees with the server’s rule on every pair of roles', () => {
    const text = readFileSync(
      new URL('../../../backend/src/auth/roles.ts', import.meta.url),
      'utf8',
    );
    // The rule is two lines: an owner may manage any role, an admin any role but owner.
    expect(text).toMatch(/if \(actor === 'owner'\) return true;/u);
    expect(text).toMatch(/return actor === 'admin' && target !== 'owner';/u);
  });
});

describe('an object ID as it is typed', () => {
  it('is a UUID, with the spaces around it ignored and the case made lower', () => {
    expect(parseObjectId(OID)).toEqual({ ok: true, value: OID });
    expect(parseObjectId(`  ${OID.toUpperCase()}  `)).toEqual({ ok: true, value: OID });
  });

  it('is refused, with a reason that says what one looks like, when it is empty or not a UUID', () => {
    const empty = parseObjectId('   ');
    expect(empty.ok).toBe(false);
    for (const bad of ['alex@example.com', 'Alex Example', '12345', `${OID}x`, OID.slice(1)]) {
      const result = parseObjectId(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.message).toContain('object ID looks like');
    }
  });
});

describe('listing people', () => {
  const member = (principalId: string, role: Member<string>['role'], addedAt: string) => ({
    principalId,
    role,
    addedBy: 'x',
    addedAt,
  });

  it('puts them in the order of their roles, then of when they were added, without changing the list', () => {
    const given = [
      member('c', 'viewer', '2026-01-03'),
      member('b', 'lead', '2026-01-02'),
      member('a', 'viewer', '2026-01-01'),
      member('d', 'analyst', '2026-01-04'),
    ];
    const before = [...given];
    expect(inOrder(given, PROJECT_ROLES).map((entry) => entry.principalId)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
    expect(given).toEqual(before);
  });

  it('shortens an object ID and nothing else', () => {
    expect(shortId(OID)).toBe('0a1b2c3d…');
    expect(shortId('local-user')).toBe('local-user');
  });

  it('says what a change did, for a screen reader', () => {
    expect(changedText('added', 'Analyst')).toBe('Person added as Analyst.');
    expect(changedText('changed', 'Viewer')).toBe('Role changed to Viewer.');
    expect(changedText('removed')).toBe('Person removed. They no longer have access.');
  });
});
