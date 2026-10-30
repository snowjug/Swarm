import type { Repository } from '../storage/repository.js';
import type { Principal } from './principal.js';
import {
  projectAllows,
  type ProjectCapability,
  type ProjectRole,
  type WorkspaceRole,
} from './roles.js';

/** Without sign-in there is one local user, who owns everything on the machine. */
export function isLocalPrincipal(principal: Principal): boolean {
  return principal.tenantId === 'local' && principal.id === 'local-user';
}

/**
 * The caller's role in their workspace. An Entra administrator who holds the bootstrap app role
 * becomes the first owner of a workspace that has none; after that, only membership counts, so an
 * owner removed in Swarm stays removed whatever their token says.
 */
export function workspaceRoleOf(
  repository: Repository,
  principal: Principal,
): WorkspaceRole | null {
  if (isLocalPrincipal(principal)) return 'owner';
  const role = repository.members.workspaceRole(principal.tenantId, principal.id);
  if (
    role === null &&
    principal.bootstrapAdmin &&
    repository.members.bootstrapWorkspace(principal.tenantId, principal.id)
  ) {
    return 'owner';
  }
  return role;
}

export interface ProjectAccess {
  workspace: WorkspaceRole | null;
  project: ProjectRole | null;
}

export function projectAccessOf(
  repository: Repository,
  principal: Principal,
  projectId: string,
  workspace: WorkspaceRole | null = workspaceRoleOf(repository, principal),
): ProjectAccess {
  return {
    workspace,
    project: isLocalPrincipal(principal)
      ? 'lead'
      : repository.members.projectRole(projectId, principal.id),
  };
}

export function mayOnProject(
  repository: Repository,
  principal: Principal,
  projectId: string,
  capability: ProjectCapability,
): boolean {
  return projectAllows(capability, projectAccessOf(repository, principal, projectId));
}
