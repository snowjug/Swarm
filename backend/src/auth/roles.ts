/**
 * The seven roles, and what each may do. Written as data in one place so that who can do what can
 * be read, reviewed and tested as a table, and so that no route decides it for itself.
 *
 *   Platform Administrator  an Entra app role; runs the platform, sees no project content
 *   Workspace Owner         workspace membership; everything in the workspace, and the owners
 *   Workspace Admin         workspace membership; everything in the workspace except the owners
 *   Project Lead            project membership; runs, reviews, deletes and shares the project
 *   Analyst                 project membership; runs, branches and asks questions
 *   Reviewer                project membership; reads, exports and reviews, never runs
 *   Viewer                  project membership; reads and exports
 *
 * A workspace is a tenant in this release. A workspace member can create projects and sees only the
 * projects they were added to; owners and admins see every project in the workspace.
 */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PROJECT_ROLES = ['lead', 'analyst', 'reviewer', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** What can be done to one project. */
export const PROJECT_CAPABILITIES = [
  'read',
  'export',
  'review',
  'run',
  'chat',
  'delete',
  'members',
] as const;
export type ProjectCapability = (typeof PROJECT_CAPABILITIES)[number];

/** What can be done to a workspace. */
export const WORKSPACE_CAPABILITIES = ['member', 'create-project', 'manage-members'] as const;
export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number];

const PROJECT_ROLE_CAPABILITIES: Readonly<Record<ProjectRole, ReadonlySet<ProjectCapability>>> = {
  viewer: new Set<ProjectCapability>(['read', 'export']),
  // Reviewing is a separate duty from running: a reviewer never changes what they review.
  reviewer: new Set<ProjectCapability>(['read', 'export', 'review']),
  // An analyst runs and asks. They do not review their own work, delete, or share.
  analyst: new Set<ProjectCapability>(['read', 'export', 'run', 'chat']),
  lead: new Set<ProjectCapability>(PROJECT_CAPABILITIES),
};

const WORKSPACE_ROLE_CAPABILITIES: Readonly<
  Record<WorkspaceRole, ReadonlySet<WorkspaceCapability>>
> = {
  member: new Set<WorkspaceCapability>(['member', 'create-project']),
  admin: new Set<WorkspaceCapability>(WORKSPACE_CAPABILITIES),
  owner: new Set<WorkspaceCapability>(WORKSPACE_CAPABILITIES),
};

/** Workspace owners and admins hold every project capability on every project in the workspace. */
export function projectAllows(
  capability: ProjectCapability,
  roles: { project: ProjectRole | null; workspace: WorkspaceRole | null },
): boolean {
  if (roles.workspace === 'owner' || roles.workspace === 'admin') return true;
  return roles.project !== null && PROJECT_ROLE_CAPABILITIES[roles.project].has(capability);
}

export function workspaceAllows(
  capability: WorkspaceCapability,
  workspace: WorkspaceRole | null,
): boolean {
  return workspace !== null && WORKSPACE_ROLE_CAPABILITIES[workspace].has(capability);
}

/** The capabilities a project role confers, for display and for tests. */
export function capabilitiesOf(role: ProjectRole): readonly ProjectCapability[] {
  return PROJECT_CAPABILITIES.filter((capability) =>
    PROJECT_ROLE_CAPABILITIES[role].has(capability),
  );
}

/**
 * May this caller grant `role` to someone, or take it away? Owners are managed by owners only, so an
 * admin cannot promote themselves or anyone else to owner, and cannot remove an owner.
 */
export function mayManageWorkspaceRole(
  actor: WorkspaceRole | null,
  target: WorkspaceRole,
): boolean {
  if (actor === 'owner') return true;
  return actor === 'admin' && target !== 'owner';
}

/** Microsoft Entra app-role values that let a person use Swarm at all. Membership decides the rest. */
export const APP_ROLE_PLATFORM_ADMIN = 'swarm.platformadmin';
/** The first person an Entra administrator assigns this to becomes the workspace's first owner. */
export const APP_ROLE_BOOTSTRAP_ADMIN = 'swarm.admin';
const APP_ROLE_USERS: ReadonlySet<string> = new Set([
  'swarm.user',
  'swarm.reader',
  'swarm.analyst',
  'swarm.reviewer',
  APP_ROLE_BOOTSTRAP_ADMIN,
  APP_ROLE_PLATFORM_ADMIN,
]);

export interface AppRoles {
  /** Holds a Swarm app role, so may sign in. What they may see is decided by membership. */
  user: boolean;
  platformAdmin: boolean;
  /** May become the first owner of an empty workspace. */
  bootstrapAdmin: boolean;
}

export function parseAppRoles(values: readonly unknown[]): AppRoles {
  const names = new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((v) => v.toLowerCase()),
  );
  return {
    user: [...names].some((name) => APP_ROLE_USERS.has(name)),
    platformAdmin: names.has(APP_ROLE_PLATFORM_ADMIN),
    bootstrapAdmin: names.has(APP_ROLE_BOOTSTRAP_ADMIN),
  };
}
