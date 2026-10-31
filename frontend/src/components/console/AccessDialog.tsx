import { Trash2, UserPlus, Users } from 'lucide-react';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { MembersState } from '../../hooks/useMembers';
import { useProjectMembers, useWorkspaceMembers } from '../../hooks/useMembers';
import { dateTime } from '../../lib/format';
import {
  PROJECT_ROLES,
  PROJECT_ROLE_VIEW,
  WORKSPACE_ROLES,
  WORKSPACE_ROLE_VIEW,
  mayManageWorkspaceMember,
  parseObjectId,
  shortId,
  workspaceRolesGrantableBy,
  type RoleView,
  type WorkspaceRole,
} from '../../lib/members';
import { EmptyPanel, Modal, Notice, Spinner } from '../ui';

interface Roles<Role extends string> {
  /** In the order they are offered. */
  roles: readonly Role[];
  view: Readonly<Record<Role, RoleView>>;
}

/** What each role lets a person do, so that nobody has to guess what they are granting. */
function RoleHelp<Role extends string>({ roles, view }: Roles<Role>) {
  return (
    <dl className="access-roles">
      {roles.map((role) => (
        <div key={role}>
          <dt>{view[role].label}</dt>
          <dd>
            {view[role].can}
            {view[role].cannot && <span className="access-cannot"> {view[role].cannot}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AddPerson<Role extends string>({
  state,
  roles,
  view,
  assignable,
  initial,
  subject,
}: Roles<Role> & {
  state: MembersState<Role>;
  assignable: readonly Role[];
  initial: Role;
  subject: string;
}) {
  const id = useId();
  const [person, setPerson] = useState('');
  const [role, setRole] = useState<Role>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const adding = state.working !== null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseObjectId(person);
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    if (await state.add(parsed.value, role)) setPerson('');
  };

  return (
    <form
      className="view-stack access-add"
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-describedby={`${id}-error`}
      onChangeCapture={() => setProblem(null)}
    >
      <h3>Add a person to the {subject}</h3>
      <p className="field-help">
        People are named by their Microsoft Entra object ID. Swarm has no invitation by name or
        email: ask the person for it, or find it on their page in the Microsoft Entra admin centre.
      </p>
      <div className="field">
        <label htmlFor={`${id}-person`}>Object ID</label>
        <input
          id={`${id}-person`}
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          value={person}
          disabled={adding}
          onChange={(event) => setPerson(event.target.value)}
          placeholder="0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
          aria-invalid={problem ? true : undefined}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-role`}>Role</label>
        <select
          id={`${id}-role`}
          value={role}
          disabled={adding}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          {roles
            .filter((candidate) => assignable.includes(candidate))
            .map((candidate) => (
              <option key={candidate} value={candidate}>
                {view[candidate].label}
              </option>
            ))}
        </select>
      </div>
      <div id={`${id}-error`}>
        {problem && (
          <Notice tone="error" title="That is not an object ID">
            {problem}
          </Notice>
        )}
      </div>
      <div className="stage-actions">
        <button className="button button-primary" type="submit" disabled={adding}>
          {adding ? (
            <Spinner label="Adding the person" />
          ) : (
            <UserPlus size={14} aria-hidden="true" />
          )}{' '}
          Add person
        </button>
      </div>
    </form>
  );
}

function People<Role extends string>({
  state,
  roles,
  view,
  assignable,
  mayManageRow,
  subject,
}: Roles<Role> & {
  state: MembersState<Role>;
  assignable: readonly Role[];
  mayManageRow: (role: Role) => boolean;
  subject: string;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const members = state.members ?? [];
  if (members.length === 0) {
    return (
      <EmptyPanel title="Nobody is listed" icon={<Users size={25} aria-hidden="true" />}>
        Nobody has been added to this {subject} by name.
      </EmptyPanel>
    );
  }
  return (
    <div
      className="access-scroll"
      role="region"
      aria-label={`People in this ${subject}`}
      tabIndex={0}
    >
      <table className="access-table">
        <caption className="sr-only">People with access to this {subject}</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Role</th>
            <th scope="col">Added</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const manageable = state.mayManage && mayManageRow(member.role);
            const busy = state.working === member.principalId;
            const name = shortId(member.principalId);
            return (
              <tr key={member.principalId}>
                <td className="mono" title={member.principalId}>
                  {name}
                </td>
                <td>
                  {manageable ? (
                    <select
                      aria-label={`Role of ${name}`}
                      value={member.role}
                      disabled={busy || state.working !== null}
                      onChange={(event) =>
                        void state.change(member.principalId, event.target.value as Role)
                      }
                    >
                      {roles
                        .filter((role) => assignable.includes(role) || role === member.role)
                        .map((role) => (
                          <option key={role} value={role} disabled={!assignable.includes(role)}>
                            {view[role].label}
                          </option>
                        ))}
                    </select>
                  ) : (
                    view[member.role].label
                  )}
                </td>
                <td>{dateTime(member.addedAt)}</td>
                <td>
                  {manageable &&
                    (confirming === member.principalId ? (
                      <span className="access-confirm" role="group" aria-label={`Remove ${name}?`}>
                        <button
                          className="button button-danger button-small"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(null);
                            void state.remove(member.principalId);
                          }}
                        >
                          Remove {name}
                        </button>
                        <button
                          className="button button-secondary button-small"
                          type="button"
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        className="button button-secondary button-small"
                        type="button"
                        disabled={state.working !== null}
                        aria-label={`Remove ${name}`}
                        onClick={() => setConfirming(member.principalId)}
                      >
                        <Trash2 size={13} aria-hidden="true" /> Remove
                      </button>
                    ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Outcome({ result }: { result: MembersState<string>['result'] }) {
  return (
    <div aria-live="polite">
      {result &&
        (result.ok ? (
          <Notice tone="success" title="Done">
            {result.text}
          </Notice>
        ) : (
          <Notice tone="error" title="That was not changed">
            {result.text}
          </Notice>
        ))}
    </div>
  );
}

function Status<Role extends string>({ state }: { state: MembersState<Role> }) {
  if (state.error && !state.members) {
    return (
      <Notice
        tone="error"
        title="The list could not be read"
        action={
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={state.reload}
          >
            Retry
          </button>
        }
      >
        {state.error}
      </Notice>
    );
  }
  if (!state.members) {
    return (
      <div className="inline-pending" role="status">
        <Spinner label="Loading the list" /> Reading who has access…
      </div>
    );
  }
  return null;
}

/** The people who may use one project, and for someone who may, the means to change that. */
export function ProjectAccess({ state }: { state: MembersState<(typeof PROJECT_ROLES)[number]> }) {
  const loaded = state.members !== null;
  return (
    <div className="access-panel view-stack">
      <p className="audit-intro">
        Who may use this project, and in what role. A person who is not listed here cannot see it at
        all. Workspace owners and administrators can use every project in the workspace and are not
        listed.
      </p>
      <Status state={state} />
      {loaded && (
        <>
          <People
            state={state}
            roles={PROJECT_ROLES}
            view={PROJECT_ROLE_VIEW}
            assignable={PROJECT_ROLES}
            mayManageRow={() => true}
            subject="project"
          />
          <Outcome result={state.result} />
          {state.mayManage ? (
            <AddPerson
              state={state}
              roles={PROJECT_ROLES}
              view={PROJECT_ROLE_VIEW}
              assignable={PROJECT_ROLES}
              initial="viewer"
              subject="project"
            />
          ) : (
            <p className="field-help">
              Only a project lead, or a workspace owner or administrator, changes who has access.
            </p>
          )}
          <h3>What the roles mean</h3>
          <RoleHelp roles={PROJECT_ROLES} view={PROJECT_ROLE_VIEW} />
        </>
      )}
    </div>
  );
}

export function ProjectAccessDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const state = useProjectMembers(projectId, true);
  return (
    <Modal title="Who has access to this project" onClose={onClose}>
      <ProjectAccess state={state} />
    </Modal>
  );
}

/** Everyone in the workspace, for an owner or an administrator. */
export function WorkspaceAccess({
  state,
  actor,
}: {
  state: MembersState<WorkspaceRole>;
  actor: WorkspaceRole | null;
}) {
  const assignable = workspaceRolesGrantableBy(actor);
  const loaded = state.members !== null;
  return (
    <div className="access-panel view-stack">
      <p className="audit-intro">
        Everyone in this workspace. A member can create projects and sees only the projects they
        were added to; owners and administrators see every project. Taking someone out of the
        workspace also takes them out of every project in it. A workspace always keeps an owner.
      </p>
      <Status state={state} />
      {loaded && (
        <>
          <People
            state={state}
            roles={WORKSPACE_ROLES}
            view={WORKSPACE_ROLE_VIEW}
            assignable={assignable}
            mayManageRow={(role) => mayManageWorkspaceMember(actor, role)}
            subject="workspace"
          />
          <Outcome result={state.result} />
          <AddPerson
            state={state}
            roles={WORKSPACE_ROLES}
            view={WORKSPACE_ROLE_VIEW}
            assignable={assignable}
            initial="member"
            subject="workspace"
          />
          <h3>What the roles mean</h3>
          <RoleHelp roles={WORKSPACE_ROLES} view={WORKSPACE_ROLE_VIEW} />
        </>
      )}
    </div>
  );
}

export function WorkspaceAccessDialog({
  actor,
  onClose,
}: {
  actor: WorkspaceRole | null;
  onClose: () => void;
}) {
  const state = useWorkspaceMembers(true);
  return (
    <Modal title="People in this workspace" onClose={onClose}>
      <WorkspaceAccess state={state} actor={actor} />
    </Modal>
  );
}
