import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MembersState } from '../../hooks/useMembers';
import type { Member, ProjectRole, WorkspaceRole } from '../../lib/members';
import { visibleText } from '../../test/provider';
import { ProjectAccess, WorkspaceAccess } from './AccessDialog';

const LEAD = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ANALYST = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const VIEWER = '2c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f';

const person = <Role extends string>(
  principalId: string,
  role: Role,
  addedAt = '2026-02-01T10:00:00.000Z',
): Member<Role> => ({ principalId, role, addedBy: LEAD, addedAt });

function state<Role extends string>(
  members: Member<Role>[] | null,
  patch: Partial<MembersState<Role>> = {},
): MembersState<Role> {
  return {
    members,
    mayManage: true,
    loading: false,
    error: null,
    result: null,
    working: null,
    reload: () => undefined,
    add: async () => true,
    change: async () => true,
    remove: async () => true,
    ...patch,
  };
}

const project = (
  members: Member<ProjectRole>[] | null,
  patch: Partial<MembersState<ProjectRole>> = {},
) => renderToStaticMarkup(<ProjectAccess state={state(members, patch)} />);
const workspace = (
  members: Member<WorkspaceRole>[] | null,
  actor: WorkspaceRole | null,
  patch: Partial<MembersState<WorkspaceRole>> = {},
) => renderToStaticMarkup(<WorkspaceAccess state={state(members, patch)} actor={actor} />);

const team = [person(LEAD, 'lead'), person(ANALYST, 'analyst'), person(VIEWER, 'viewer')];
const selectCount = (html: string) => (html.match(/<select aria-label="Role of /gu) ?? []).length;

describe('who has access to a project', () => {
  it('lists each person by a shortened object ID, with the whole one on hover', () => {
    const html = project(team);
    const text = visibleText(html);
    expect(text).toContain('0a1b2c3d…');
    expect(text).toContain('1b2c3d4e…');
    expect(text).toContain('2c3d4e5f…');
    expect(html).toContain(`title="${LEAD}"`);
    expect(html).not.toContain(`>${LEAD}<`);
    expect(html).toContain('People with access to this project');
  });
  it('lets someone who may manage it change each role and remove each person, with the person named on every control', () => {
    const html = project(team);
    expect(selectCount(html)).toBe(3);
    for (const name of ['0a1b2c3d…', '1b2c3d4e…', '2c3d4e5f…']) {
      expect(html).toContain(`aria-label="Role of ${name}"`);
      expect(html).toContain(`aria-label="Remove ${name}"`);
    }
    expect(html).toMatch(/<option value="analyst" selected="">Analyst<\/option>/u);
  });

  it('shows a list and nothing to change to someone who may not manage it, and says who can', () => {
    const html = project(team, { mayManage: false });
    const text = visibleText(html);
    expect(selectCount(html)).toBe(0);
    expect(html).not.toContain('Remove 0a1b2c3d');
    expect(html).not.toContain('<form');
    expect(text).toContain('Project lead');
    expect(text).toContain('Viewer');
    expect(text).toContain(
      'Only a project lead, or a workspace owner or administrator, changes who has access.',
    );
  });

  it('offers to add a person by object ID, as a viewer to begin with, and says why it is not a name or an email', () => {
    const html = project(team);
    const text = visibleText(html);
    expect(html).toContain('<form');
    expect(text).toContain('Add a person to the project');
    expect(text).toContain('Microsoft Entra object ID');
    expect(text).toContain('no invitation by name or email');
    expect(html).toMatch(/<label for="[^"]+-person">Object ID<\/label>/u);
    expect(html).toMatch(/<label for="[^"]+-role">Role<\/label>/u);
    expect(html).toMatch(/<option value="viewer" selected="">Viewer<\/option>/u);
    expect(html).toContain('placeholder="0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"');
    expect(text).toContain('Add person');
  });

  it('says what every role lets a person do, so that nobody grants what they do not mean to', () => {
    const text = visibleText(project(team));
    expect(text).toContain('What the roles mean');
    expect(text).toContain('Runs, edits, reviews, deletes and shares the project.');
    expect(text).toContain('Does not set the project’s model budget');
    expect(text).toContain('Never runs or edits what they review.');
    expect(text).toContain('Reads and exports.');
    expect(text).toContain('Workspace owners and administrators can use every project');
  });

  it('waits while a change is made: nothing can be changed twice, and the form is disabled', () => {
    const html = project(team, { working: ANALYST });
    expect(html.match(/<select[^>]*disabled=""/gu)).toHaveLength(4);
    expect(html.match(/<input[^>]*disabled=""/gu)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remove 1b2c3d4e…"/u);
    expect(visibleText(html)).toContain('Adding the person');
  });

  it('says what a change did, and why one was refused', () => {
    const done = project(team, { result: { ok: true, text: 'Role changed to Analyst.' } });
    expect(visibleText(done)).toContain('Role changed to Analyst.');
    expect(done).toContain('notice-success');
    const refused = project(team, {
      result: { ok: false, text: 'A project must keep a lead.' },
    });
    expect(visibleText(refused)).toContain('That was not changed');
    expect(visibleText(refused)).toContain('A project must keep a lead.');
    expect(refused).toContain('role="alert"');
  });

  it('says that it is reading, that it could not, and how to try again', () => {
    expect(visibleText(project(null, { loading: true }))).toContain('Reading who has access');
    const failed = project(null, { error: 'You do not have access to this project.' });
    expect(visibleText(failed)).toContain('The list could not be read');
    expect(visibleText(failed)).toContain('You do not have access to this project.');
    expect(failed).toContain('Retry');
    expect(failed).not.toContain('<form');
  });

  it('says so when nobody is listed, and still lets a lead add someone', () => {
    const html = project([]);
    expect(visibleText(html)).toContain('Nobody is listed');
    expect(html).toContain('<form');
  });
});

describe('who is in a workspace', () => {
  const people = [person(LEAD, 'owner'), person(ANALYST, 'admin'), person(VIEWER, 'member')];

  it('lets an owner change and remove everyone, an owner included', () => {
    const html = workspace(people, 'owner');
    expect(selectCount(html)).toBe(3);
    expect(html).toContain('aria-label="Remove 0a1b2c3d…"');
    expect(html).toMatch(/<option value="owner"[^>]*>Workspace owner<\/option>/u);
  });

  it('lets an admin manage admins and members, and leaves the owners alone', () => {
    const html = workspace(people, 'admin');
    // The owner is a name in a cell, with no control; the other two have both.
    expect(selectCount(html)).toBe(2);
    expect(html).not.toContain('aria-label="Role of 0a1b2c3d…"');
    expect(html).not.toContain('aria-label="Remove 0a1b2c3d…"');
    expect(html).toContain('aria-label="Role of 1b2c3d4e…"');
    expect(html).toContain('aria-label="Remove 2c3d4e5f…"');
    expect(visibleText(html)).toContain('Workspace owner');
  });

  it('does not offer an admin the owner role, in a row or in the form that adds a person', () => {
    const html = workspace(people, 'admin');
    // Rows: the owner option is not one an admin can pick.
    for (const [, row] of html.matchAll(
      /<select aria-label="Role of [^"]+"[^>]*>([\s\S]*?)<\/select>/gu,
    )) {
      expect(row).not.toMatch(/<option value="owner"(?![^>]*disabled)/u);
    }
    // The form: owner is not among the roles to give.
    const form = /<form[\s\S]*?<\/form>/u.exec(html)![0];
    expect(form).not.toContain('value="owner"');
    expect(form).toContain('value="admin"');
    expect(form).toMatch(/<option value="member" selected="">Member<\/option>/u);
  });

  it('adds people to the workspace as members to begin with', () => {
    const html = workspace(people, 'owner');
    expect(visibleText(html)).toContain('Add a person to the workspace');
    expect(html).toMatch(/<option value="member" selected="">Member<\/option>/u);
  });

  it('says what it means to leave the workspace, and that it always keeps an owner', () => {
    const text = visibleText(workspace(people, 'owner'));
    expect(text).toContain('takes them out of every project in it');
    expect(text).toContain('A workspace always keeps an owner');
    expect(text).toContain('Cannot make, change or remove an owner.');
  });
});
