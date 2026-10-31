/**
 * Who may use a project, and what the roles mean, as the page says it. The roles themselves are the
 * server's (`backend/src/auth/roles.ts`, which decides every request); this is only how they are
 * named and described, and a test holds the two lists together.
 */
export const PROJECT_ROLES = ['lead', 'analyst', 'reviewer', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface Member<Role extends string> {
  principalId: string;
  role: Role;
  addedBy: string;
  addedAt: string;
}

export interface RoleView {
  label: string;
  /** What the role lets a person do. */
  can: string;
  /** What it does not, where that is the point of the role. */
  cannot: string | null;
}

export const PROJECT_ROLE_VIEW: Readonly<Record<ProjectRole, RoleView>> = {
  lead: {
    label: 'Project lead',
    can: 'Runs, edits, reviews, deletes and shares the project.',
    cannot:
      'Does not set the project’s model budget: only a workspace owner or administrator does.',
  },
  analyst: {
    label: 'Analyst',
    can: 'Runs and branches, edits the report, and asks questions.',
    cannot: 'Does not review, delete or share the project.',
  },
  reviewer: {
    label: 'Reviewer',
    can: 'Reads, exports and reviews: approves a report or sends it back.',
    cannot: 'Never runs or edits what they review.',
  },
  viewer: {
    label: 'Viewer',
    can: 'Reads and exports.',
    cannot: 'Changes nothing.',
  },
};

export const WORKSPACE_ROLE_VIEW: Readonly<Record<WorkspaceRole, RoleView>> = {
  owner: {
    label: 'Workspace owner',
    can: 'Everything in the workspace, every project and every person, including who the owners are.',
    cannot: null,
  },
  admin: {
    label: 'Workspace admin',
    can: 'Everything in the workspace, every project and every person, except the owners.',
    cannot: 'Cannot make, change or remove an owner.',
  },
  member: {
    label: 'Member',
    can: 'Creates projects, and sees the projects they were added to.',
    cannot: 'Sees no project they were not added to.',
  },
};

/** An Entra object ID, as the server reads it: a UUID. People are named by it, not by name or email. */
const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type ParsedObjectId = { ok: true; value: string } | { ok: false; message: string };

export function parseObjectId(text: string): ParsedObjectId {
  const value = text.trim();
  if (value === '') return { ok: false, message: 'Enter the person’s Microsoft Entra object ID.' };
  if (!OBJECT_ID.test(value)) {
    return {
      ok: false,
      message:
        'An object ID looks like 0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d. It is on the person’s page in the Microsoft Entra admin centre.',
    };
  }
  return { ok: true, value: value.toLowerCase() };
}

/** The workspace roles that someone in `actor` may give to another person, or take away. */
export function workspaceRolesGrantableBy(actor: WorkspaceRole | null): readonly WorkspaceRole[] {
  if (actor === 'owner') return WORKSPACE_ROLES;
  if (actor === 'admin') return WORKSPACE_ROLES.filter((role) => role !== 'owner');
  return [];
}

/** Whether `actor` may change or remove a person who holds `target`. Owners are managed by owners only. */
export function mayManageWorkspaceMember(
  actor: WorkspaceRole | null,
  target: WorkspaceRole,
): boolean {
  return workspaceRolesGrantableBy(actor).includes(target);
}

/** Whether this person may change who has access to the workspace at all. */
export const administersWorkspace = (role: WorkspaceRole | null): boolean =>
  role === 'owner' || role === 'admin';

/** A long identifier is shortened to its first eight characters. */
export const shortId = (id: string): string => (OBJECT_ID.test(id) ? `${id.slice(0, 8)}…` : id);

/** Members in the order of their roles, then of when they were added, without changing the list given. */
export function inOrder<Role extends string>(
  members: readonly Member<Role>[],
  roles: readonly Role[],
): Member<Role>[] {
  return [...members].sort(
    (a, b) =>
      roles.indexOf(a.role) - roles.indexOf(b.role) ||
      a.addedAt.localeCompare(b.addedAt) ||
      a.principalId.localeCompare(b.principalId),
  );
}

/** What changing a role says to the person who did it, for a live region. */
export function changedText(kind: 'added' | 'changed' | 'removed', roleLabel?: string): string {
  switch (kind) {
    case 'added':
      return `Person added as ${roleLabel ?? 'a member'}.`;
    case 'changed':
      return `Role changed to ${roleLabel ?? 'the new role'}.`;
    case 'removed':
      return 'Person removed. They no longer have access.';
  }
}
