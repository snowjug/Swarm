import {
  PROJECT_ROLES,
  PROJECT_ROLE_VIEW,
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_VIEW,
  mayManageWorkspaceMember,
  workspaceRolesGrantableBy,
  type ProjectRole,
  type RoleView,
  type WorkspaceRole,
} from '../lib/members';

/** What a list of people is made of: the roles, what each means, which may be given, and whose row may be changed. */
export interface Scheme<Role extends string> {
  subject: 'project' | 'workspace';
  /** In the order they are offered. */
  roles: readonly Role[];
  view: Readonly<Record<Role, RoleView>>;
  assignable: readonly Role[];
  mayManageRow: (role: Role) => boolean;
  /** The role a person added starts with: the least that is useful. */
  initial: Role;
}

export const projectScheme: Scheme<ProjectRole> = {
  subject: 'project',
  roles: PROJECT_ROLES,
  view: PROJECT_ROLE_VIEW,
  assignable: PROJECT_ROLES,
  mayManageRow: () => true,
  initial: 'viewer',
};

export function workspaceScheme(actor: WorkspaceRole | null): Scheme<WorkspaceRole> {
  return {
    subject: 'workspace',
    roles: WORKSPACE_ROLES,
    view: WORKSPACE_ROLE_VIEW,
    assignable: workspaceRolesGrantableBy(actor),
    mayManageRow: (role) => mayManageWorkspaceMember(actor, role),
    initial: 'member',
  };
}

export interface AccessCopy {
  title: string;
  description: string;
  emptyText: string;
  readOnly: string | null;
  /** Said when someone is about to be taken out. */
  removeNote: string;
}

export const COPY: Record<Scheme<string>['subject'], AccessCopy> = {
  project: {
    title: 'Who has access',
    description:
      'Anyone who is not listed cannot see this project. Workspace owners and admins can use every project and are not listed.',
    emptyText: 'Nobody has been added to this project by name.',
    readOnly: 'Only a project lead, or a workspace owner or administrator, changes who has access.',
    removeNote: 'They will no longer see this project.',
  },
  workspace: {
    title: 'People in this workspace',
    description:
      'A member creates projects and sees only the ones they were added to. Owners and admins see every project. A workspace always keeps an owner.',
    emptyText: 'Nobody has been added to this workspace by name.',
    readOnly: null,
    removeNote: 'They are also taken out of every project in this workspace.',
  },
};

/** The roles a row's menu offers: all of them, those that cannot be given shown but not chosen. */
export function roleChoices<Role extends string>(
  scheme: Scheme<Role>,
): { role: Role; allowed: boolean }[] {
  return scheme.roles.map((role) => ({ role, allowed: scheme.assignable.includes(role) }));
}

/** Why a person's row cannot be changed by this caller, or null where it can. */
export function lockedReason<Role extends string>(
  scheme: Scheme<Role>,
  role: Role,
  mayManage: boolean,
): string | null {
  if (!mayManage) return null;
  if (scheme.mayManageRow(role)) return null;
  return scheme.subject === 'workspace' ? 'Only an owner changes an owner.' : null;
}
