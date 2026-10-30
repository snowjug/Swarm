import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/guard.js';
import { PROJECT_ROLES, WORKSPACE_ROLES } from '../auth/roles.js';
import type { Repository } from '../storage/repository.js';

const workspaceMemberParams = z.object({ principalId: z.uuid() });
const projectMemberParams = z.object({ id: z.uuid(), principalId: z.uuid() });
const projectParams = z.object({ id: z.uuid() });
const workspaceRoleBody = z.object({ role: z.enum(WORKSPACE_ROLES) }).strict();
const projectRoleBody = z.object({ role: z.enum(PROJECT_ROLES) }).strict();

/**
 * Who may see and do what. Who may call these is in `auth/policy.ts`; the rules that keep a workspace
 * owned and a project led are in the store, and are applied in the transaction of the change.
 * Principal identifiers are Entra object ids, normalised to lower case as the token verifier does.
 */
export function memberRoutes(app: FastifyInstance, repository: Repository, rateScale = 1): void {
  const limit = { config: { rateLimit: { max: 30 * rateScale, timeWindow: '1 minute' } } };

  app.get('/api/workspace', async (request) => ({
    role: request.membership.workspace,
    platformAdmin: principalOf(request).platformAdmin,
  }));

  app.get('/api/workspace/members', async (request) => ({
    members: repository.members.workspaceMembers(principalOf(request).tenantId),
  }));

  app.put('/api/workspace/members/:principalId', limit, async (request) => {
    const { principalId } = workspaceMemberParams.parse(request.params);
    const { role } = workspaceRoleBody.parse(request.body);
    const principal = principalOf(request);
    const { previous } = repository.members.setWorkspaceMember({
      tenantId: principal.tenantId,
      principalId: principalId.toLowerCase(),
      role,
      actor: { id: principal.id, workspaceRole: request.membership.workspace },
    });
    return { member: { principalId: principalId.toLowerCase(), role }, previous };
  });

  app.delete('/api/workspace/members/:principalId', limit, async (request) => {
    const { principalId } = workspaceMemberParams.parse(request.params);
    const principal = principalOf(request);
    const removed = repository.members.removeWorkspaceMember({
      tenantId: principal.tenantId,
      principalId: principalId.toLowerCase(),
      actor: { id: principal.id, workspaceRole: request.membership.workspace },
    });
    return { removed };
  });

  app.get('/api/projects/:id/members', async (request) => ({
    members: repository.members.projectMembers(projectParams.parse(request.params).id),
  }));

  app.put('/api/projects/:id/members/:principalId', limit, async (request) => {
    const { id, principalId } = projectMemberParams.parse(request.params);
    const { role } = projectRoleBody.parse(request.body);
    const principal = principalOf(request);
    const { previous } = repository.members.setProjectMember({
      projectId: id,
      tenantId: principal.tenantId,
      principalId: principalId.toLowerCase(),
      role,
      actor: { id: principal.id },
    });
    return { member: { principalId: principalId.toLowerCase(), role }, previous };
  });

  app.delete('/api/projects/:id/members/:principalId', limit, async (request) => {
    const { id, principalId } = projectMemberParams.parse(request.params);
    const removed = repository.members.removeProjectMember({
      projectId: id,
      principalId: principalId.toLowerCase(),
      actor: { id: principalOf(request).id },
    });
    return { removed };
  });
}
