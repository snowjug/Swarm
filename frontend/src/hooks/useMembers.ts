import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import {
  changedText,
  inOrder,
  PROJECT_ROLES,
  PROJECT_ROLE_VIEW,
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_VIEW,
  type Member,
  type ProjectRole,
  type WorkspaceRole,
} from '../lib/members';

export interface MembersState<Role extends string> {
  members: Member<Role>[] | null;
  /** Whether the caller may change who has access. */
  mayManage: boolean;
  loading: boolean;
  error: string | null;
  /** What the last change was, in words, for a live region. */
  result: { ok: boolean; text: string } | null;
  /** The person a change is being made to, so that its controls wait. */
  working: string | null;
  reload: () => void;
  add: (principalId: string, role: Role) => Promise<boolean>;
  change: (principalId: string, role: Role) => Promise<boolean>;
  remove: (principalId: string) => Promise<boolean>;
}

interface Source<Role extends string> {
  roles: readonly Role[];
  roleLabel: (role: Role) => string;
  read: (signal: AbortSignal) => Promise<{ members: Member<Role>[]; mayManage: boolean }>;
  set: (principalId: string, role: Role) => Promise<unknown>;
  drop: (principalId: string) => Promise<unknown>;
}

/**
 * `scope` names what is being read (a project, or the workspace), so that the list is read again when
 * it changes. The source is kept in a ref, because it is made afresh on every render and what it reads
 * is decided by the scope.
 */
function useMembers<Role extends string>(
  source: Source<Role>,
  enabled: boolean,
  scope: string,
): MembersState<Role> {
  const current = useRef(source);
  useEffect(() => {
    current.current = source;
  });
  const [members, setMembers] = useState<Member<Role>[] | null>(null);
  const [mayManage, setMayManage] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MembersState<Role>['result']>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    void current.current.read(controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setMembers(inOrder(loaded.members, current.current.roles));
        setMayManage(loaded.mayManage);
        setError(null);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [enabled, scope, revision]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);

  const act = useCallback(
    async (principalId: string, action: () => Promise<unknown>, done: string): Promise<boolean> => {
      setWorking(principalId);
      setResult(null);
      try {
        await action();
        setResult({ ok: true, text: done });
        setRevision((old) => old + 1);
        return true;
      } catch (failure) {
        setResult({ ok: false, text: errorMessage(failure) });
        return false;
      } finally {
        setWorking(null);
      }
    },
    [],
  );

  return {
    members,
    mayManage,
    loading,
    error,
    result,
    working,
    reload,
    add: (principalId, role) =>
      act(
        principalId,
        () => current.current.set(principalId, role),
        changedText('added', current.current.roleLabel(role)),
      ),
    change: (principalId, role) =>
      act(
        principalId,
        () => current.current.set(principalId, role),
        changedText('changed', current.current.roleLabel(role)),
      ),
    remove: (principalId) =>
      act(principalId, () => current.current.drop(principalId), changedText('removed')),
  };
}

/** Who may use one project, and the means to change it for someone who may. */
export function useProjectMembers(projectId: string, enabled: boolean): MembersState<ProjectRole> {
  return useMembers<ProjectRole>(
    {
      roles: PROJECT_ROLES,
      roleLabel: (role) => PROJECT_ROLE_VIEW[role].label,
      read: async (signal) => {
        const loaded = await api.projectMembers(projectId, signal);
        return { members: loaded.members, mayManage: loaded.may.manage };
      },
      set: (principalId, role) => api.setProjectMember(projectId, principalId, role),
      drop: (principalId) => api.removeProjectMember(projectId, principalId),
    },
    enabled,
    projectId,
  );
}

/** Who belongs to the workspace. Only a workspace owner or administrator may read or change it. */
export function useWorkspaceMembers(enabled: boolean): MembersState<WorkspaceRole> {
  return useMembers<WorkspaceRole>(
    {
      roles: WORKSPACE_ROLES,
      roleLabel: (role) => WORKSPACE_ROLE_VIEW[role].label,
      read: async (signal) => {
        const loaded = await api.workspaceMembers(signal);
        return { members: loaded.members, mayManage: true };
      },
      set: (principalId, role) => api.setWorkspaceMember(principalId, role),
      drop: (principalId) => api.removeWorkspaceMember(principalId),
    },
    enabled,
    'workspace',
  );
}

/** The caller's role in their workspace, read once when a person is signed in. */
export function useWorkspaceRole(enabled: boolean): WorkspaceRole | null {
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void api.workspace(controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) setRole(loaded.role);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [enabled]);
  return role;
}
