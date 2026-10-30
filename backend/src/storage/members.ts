import type { SqlDatabase } from './sql.js';
import { z } from 'zod';
import { mayManageWorkspaceRole, type ProjectRole, type WorkspaceRole } from '../auth/roles.js';
import { AppError } from '../errors.js';
import type { AuditLog } from './audit.js';

/** Bounds, so that sharing cannot be used to grow a table without limit. */
export const MAX_WORKSPACE_MEMBERS = 500;
export const MAX_PROJECT_MEMBERS = 100;

export interface Member<Role extends string> {
  principalId: string;
  role: Role;
  addedBy: string;
  addedAt: string;
}

/** Who is acting, for the checks that depend on it and for the audit entry. */
export interface MembershipActor {
  id: string;
  /** Their role in the workspace, as resolved for this request. */
  workspaceRole: WorkspaceRole | null;
}

const roleRow = z.object({ role: z.string() });
const memberRow = z.object({
  principal_id: z.string(),
  role: z.string(),
  added_by: z.string(),
  added_at: z.string(),
});
const countRow = z.object({ count: z.number() });

const workspaceRole = z.enum(['owner', 'admin', 'member']);
const projectRole = z.enum(['lead', 'analyst', 'reviewer', 'viewer']);

/**
 * Workspace and project membership: the facts that decide who may see and do what. Every change is
 * written in one transaction with its audit entry, and the checks that keep a workspace from being
 * left without an owner, or a project without a lead, are made in the same transaction.
 *
 * The `insert…` methods are for code that already holds a transaction (creating a project); the
 * others open their own.
 */
export class MemberStore {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transaction: <T>(operation: () => T) => T,
    private readonly audit: AuditLog,
  ) {}

  workspaceRole(tenantId: string, principalId: string): WorkspaceRole | null {
    const row = this.database
      .prepare('SELECT role FROM workspace_members WHERE tenant_id = ? AND principal_id = ?')
      .get(tenantId, principalId);
    return row ? workspaceRole.parse(roleRow.parse(row).role) : null;
  }

  projectRole(projectId: string, principalId: string): ProjectRole | null {
    const row = this.database
      .prepare('SELECT role FROM project_members WHERE project_id = ? AND principal_id = ?')
      .get(projectId, principalId);
    return row ? projectRole.parse(roleRow.parse(row).role) : null;
  }

  workspaceMembers(tenantId: string): Member<WorkspaceRole>[] {
    return this.database
      .prepare(
        'SELECT principal_id, role, added_by, added_at FROM workspace_members WHERE tenant_id = ? ORDER BY added_at, principal_id',
      )
      .all(tenantId)
      .map((raw) => {
        const row = memberRow.parse(raw);
        return {
          principalId: row.principal_id,
          role: workspaceRole.parse(row.role),
          addedBy: row.added_by,
          addedAt: row.added_at,
        };
      });
  }

  projectMembers(projectId: string): Member<ProjectRole>[] {
    return this.database
      .prepare(
        'SELECT principal_id, role, added_by, added_at FROM project_members WHERE project_id = ? ORDER BY added_at, principal_id',
      )
      .all(projectId)
      .map((raw) => {
        const row = memberRow.parse(raw);
        return {
          principalId: row.principal_id,
          role: projectRole.parse(row.role),
          addedBy: row.added_by,
          addedAt: row.added_at,
        };
      });
  }

  private count(sql: string, ...values: string[]): number {
    return countRow.parse(this.database.prepare(sql).get(...values)).count;
  }

  /** For a creating transaction: the creator leads the project and belongs to the workspace. */
  insertLead(
    project: { id: string; tenantId: string },
    principalId: string,
    addedBy: string,
    at: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO project_members (project_id, principal_id, role, added_by, added_at)
         VALUES (?, ?, 'lead', ?, ?)
         ON CONFLICT (project_id, principal_id) DO UPDATE SET role = 'lead'`,
      )
      .run(project.id, principalId, addedBy, at);
    this.insertWorkspaceMemberIfMissing(project.tenantId, principalId, addedBy, at);
  }

  private insertWorkspaceMemberIfMissing(
    tenantId: string,
    principalId: string,
    addedBy: string,
    at: string,
  ): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO workspace_members (tenant_id, principal_id, role, added_by, added_at)
         VALUES (?, ?, 'member', ?, ?)`,
      )
      .run(tenantId, principalId, addedBy, at);
  }

  /**
   * Makes the first owner of a workspace that has none. Returns whether it did. The check and the
   * write are one transaction, so two administrators arriving together cannot both become owner.
   */
  bootstrapWorkspace(tenantId: string, principalId: string): boolean {
    return this.transaction(() => {
      const owners = this.count(
        "SELECT COUNT(*) AS count FROM workspace_members WHERE tenant_id = ? AND role = 'owner'",
        tenantId,
      );
      if (owners > 0) return false;
      const at = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO workspace_members (tenant_id, principal_id, role, added_by, added_at)
           VALUES (?, ?, 'owner', ?, ?)
           ON CONFLICT (tenant_id, principal_id) DO UPDATE SET role = 'owner'`,
        )
        .run(tenantId, principalId, 'bootstrap', at);
      this.audit.record({
        actor: principalId,
        action: 'workspace.bootstrapped',
        targetType: 'workspace',
        targetId: principalId,
        detail: { role: 'owner' },
      });
      return true;
    });
  }

  setWorkspaceMember(input: {
    tenantId: string;
    principalId: string;
    role: WorkspaceRole;
    actor: MembershipActor;
  }): { previous: WorkspaceRole | null } {
    const { tenantId, principalId, role, actor } = input;
    return this.transaction(() => {
      const previous = this.workspaceRole(tenantId, principalId);
      if (
        !mayManageWorkspaceRole(actor.workspaceRole, role) ||
        (previous !== null && !mayManageWorkspaceRole(actor.workspaceRole, previous))
      ) {
        throw new AppError(
          403,
          'FORBIDDEN',
          'Only a workspace owner can grant or change the owner role.',
        );
      }
      if (previous === role) return { previous };
      if (previous === 'owner' && role !== 'owner') this.requireAnotherOwner(tenantId);
      if (
        previous === null &&
        this.count(
          'SELECT COUNT(*) AS count FROM workspace_members WHERE tenant_id = ?',
          tenantId,
        ) >= MAX_WORKSPACE_MEMBERS
      ) {
        throw new AppError(
          409,
          'MEMBER_LIMIT',
          `A workspace can have at most ${MAX_WORKSPACE_MEMBERS} members.`,
        );
      }
      const at = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO workspace_members (tenant_id, principal_id, role, added_by, added_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, principal_id) DO UPDATE SET role = excluded.role`,
        )
        .run(tenantId, principalId, role, actor.id, at);
      this.audit.record({
        actor: actor.id,
        action: previous === null ? 'workspace.member.added' : 'workspace.member.changed',
        targetType: 'workspace',
        targetId: principalId,
        detail: { role, previous },
      });
      return { previous };
    });
  }

  /** Removing someone from the workspace also takes away every project they were added to in it. */
  removeWorkspaceMember(input: {
    tenantId: string;
    principalId: string;
    actor: MembershipActor;
  }): boolean {
    const { tenantId, principalId, actor } = input;
    return this.transaction(() => {
      const previous = this.workspaceRole(tenantId, principalId);
      if (previous === null) return false;
      if (!mayManageWorkspaceRole(actor.workspaceRole, previous)) {
        throw new AppError(403, 'FORBIDDEN', 'Only a workspace owner can remove an owner.');
      }
      if (previous === 'owner') this.requireAnotherOwner(tenantId);
      const projects = this.database
        .prepare(
          `DELETE FROM project_members WHERE principal_id = ?
           AND project_id IN (SELECT id FROM projects WHERE tenant_id = ?)`,
        )
        .run(principalId, tenantId);
      this.database
        .prepare('DELETE FROM workspace_members WHERE tenant_id = ? AND principal_id = ?')
        .run(tenantId, principalId);
      // Their sign-ins end too, so that the next request has to start again and meets the new state.
      const sessions = this.database
        .prepare('DELETE FROM sessions WHERE tenant_id = ? AND principal_id = ?')
        .run(tenantId, principalId);
      this.audit.record({
        actor: actor.id,
        action: 'workspace.member.removed',
        targetType: 'workspace',
        targetId: principalId,
        detail: {
          previous,
          projects: Number(projects.changes),
          sessions: Number(sessions.changes),
        },
      });
      return true;
    });
  }

  private requireAnotherOwner(tenantId: string): void {
    const owners = this.count(
      "SELECT COUNT(*) AS count FROM workspace_members WHERE tenant_id = ? AND role = 'owner'",
      tenantId,
    );
    if (owners <= 1) {
      throw new AppError(
        409,
        'LAST_OWNER',
        'A workspace must keep at least one owner. Make someone else an owner first.',
      );
    }
  }

  setProjectMember(input: {
    projectId: string;
    tenantId: string;
    principalId: string;
    role: ProjectRole;
    actor: { id: string };
  }): { previous: ProjectRole | null } {
    const { projectId, tenantId, principalId, role, actor } = input;
    return this.transaction(() => {
      const previous = this.projectRole(projectId, principalId);
      if (previous === role) return { previous };
      if (previous === 'lead' && role !== 'lead') this.requireAnotherLead(projectId);
      if (
        previous === null &&
        this.count(
          'SELECT COUNT(*) AS count FROM project_members WHERE project_id = ?',
          projectId,
        ) >= MAX_PROJECT_MEMBERS
      ) {
        throw new AppError(
          409,
          'MEMBER_LIMIT',
          `A project can have at most ${MAX_PROJECT_MEMBERS} members.`,
        );
      }
      const at = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO project_members (project_id, principal_id, role, added_by, added_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (project_id, principal_id) DO UPDATE SET role = excluded.role`,
        )
        .run(projectId, principalId, role, actor.id, at);
      // A project member can create projects of their own, so they belong to the workspace.
      this.insertWorkspaceMemberIfMissing(tenantId, principalId, actor.id, at);
      this.audit.record({
        actor: actor.id,
        action: previous === null ? 'project.member.added' : 'project.member.changed',
        targetType: 'project',
        targetId: principalId,
        projectId,
        detail: { role, previous },
      });
      return { previous };
    });
  }

  removeProjectMember(input: {
    projectId: string;
    principalId: string;
    actor: { id: string };
  }): boolean {
    const { projectId, principalId, actor } = input;
    return this.transaction(() => {
      const previous = this.projectRole(projectId, principalId);
      if (previous === null) return false;
      if (previous === 'lead') this.requireAnotherLead(projectId);
      this.database
        .prepare('DELETE FROM project_members WHERE project_id = ? AND principal_id = ?')
        .run(projectId, principalId);
      this.audit.record({
        actor: actor.id,
        action: 'project.member.removed',
        targetType: 'project',
        targetId: principalId,
        projectId,
        detail: { previous },
      });
      return true;
    });
  }

  private requireAnotherLead(projectId: string): void {
    const leads = this.count(
      "SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'lead'",
      projectId,
    );
    if (leads <= 1) {
      throw new AppError(
        409,
        'LAST_LEAD',
        'A project must keep at least one lead. Make someone else a lead first.',
      );
    }
  }
}
