# 0007. Workspace and project membership, and seven roles

Status: Accepted (backend). Browser sign-in is in [0008](./0008-browser-sign-in.md); there is still no
membership screen, and no real tenant has been used. Supersedes the role model of [0005](./0005-identity-roles-and-tenancy.md)
(decision 3, and the owner rule in decision 6). The rest of 0005 stands: bearer-token verification,
the default-deny route table, authentication before the body is read, and tenant scoping.

## Context

[0005](./0005-identity-roles-and-tenancy.md) gave every signed-in person one tenant-wide role from an
Entra app role, and every project one owner. That left a gap a hosted pilot cannot have: anyone with
the reader role could read **every** project in their tenant, a project could not be shared with one
colleague and not another, and the only way to let a second person run something was to make them an
administrator of everything. Access also followed the token, so taking it away meant waiting for the
token to expire or changing Entra.

## Decision

1. **Seven roles**, in three scopes. Every capability below is written out in
   `backend/src/auth/roles.ts` and again, independently, in `backend/test/membership.test.ts`.

   | Role                   | Scope     | Granted by                           | May                                                                              |
   | ---------------------- | --------- | ------------------------------------ | -------------------------------------------------------------------------------- |
   | Platform Administrator | platform  | Entra app role `Swarm.PlatformAdmin` | Run a paid model check, verify the audit chain. Sees **no** workspace's projects |
   | Workspace Owner        | workspace | membership                           | Everything in the workspace, including granting and removing owners              |
   | Workspace Admin        | workspace | membership                           | Everything in the workspace except the owners                                    |
   | Project Lead           | project   | membership                           | Read, export, review, run, chat, delete and share the project                    |
   | Analyst                | project   | membership                           | Read, export, run, branch, ask the analyst and the actors                        |
   | Reviewer               | project   | membership                           | Read, export, review statements and conflicts. Never runs                        |
   | Viewer                 | project   | membership                           | Read and export                                                                  |

   A workspace member who holds no project role can create projects and sees none but their own.
   Reviewing and running are kept apart: no role below Project Lead can do both.

2. **A workspace is a tenant** in this release. Membership is two tables, `workspace_members`
   (tenant, person, role) and `project_members` (project, person, role), created by migration 4.
   Project membership cascades with the project. Adding someone to a project also makes them a
   workspace member, so that they can create projects of their own and branch.
3. **Entra app roles only let a person in.** `Swarm.User`, and the four values of the first release
   (`Swarm.Reader`, `Swarm.Analyst`, `Swarm.Reviewer`, `Swarm.Admin`), mean "may use Swarm"; none of
   them grants access to anything. A token with none is refused as before. `Swarm.PlatformAdmin`
   grants platform administration and nothing else.
4. **Membership is read from the database on every request**, in the guard, before the body is read.
   Removing someone therefore takes effect on their next call, whatever their token still says.
5. **Not found, or forbidden.** A person with no role on a project, including a colleague in the same
   workspace who was not added, gets the same 404 as for a project that does not exist, so its
   existence is not disclosed. A person with a role that lacks the capability gets 403. The project
   in a `?with=` query is held to the same rule (`requireReadable`), not just the one in the path.
6. **Bootstrap.** A workspace with no owner has none to appoint one. The first person to call with the
   `Swarm.Admin` app role becomes its owner, in one transaction with the check, and is audited. Once an
   owner exists the app role confers nothing, so an owner removed in Swarm stays removed.
7. **Invariants**, checked in the transaction of the change: a workspace keeps at least one owner, a
   project at least one lead, only an owner grants, changes or removes an owner, and sharing is
   bounded (500 members per workspace, 100 per project). Leaving a workspace removes a person from
   every project in it.
8. **Audit.** Every membership change is recorded in the hash-chained log with who, whom, the role and
   the previous role. A refused request from a signed-in caller is recorded as before.
9. **Without sign-in** the one local user is the owner of the `local` workspace and its platform
   administrator, as before.

## Consequences

- **Upgrading narrows access, deliberately.** The migration makes each project's owner its lead and a
  workspace member, and makes nobody an owner or admin. A tenant that used the first release has to
  assign `Swarm.Admin` to someone, who becomes the owner on their next call and then adds the others.
  Readers and analysts who could read everything can read nothing until they are added.
- **Not built:** a membership screen, groups (membership is per person),
  invitations by name or email (people are identified by their Entra object id), more than one
  workspace per tenant, and deleting a workspace. (Browser sign-in is [0008](./0008-browser-sign-in.md).)
- **Not validated:** a real Entra tenant. App-role assignment, group overage and multiple audiences
  have only met a local test provider.
- Tenant and membership filtering is in application code. With PostgreSQL
  ([0006](./0006-postgres-adapter-proposed.md)) row-level security would add a second layer.
- Report edits do not exist yet. When the Report Studio does, its routes join the `review` or `run`
  capability and this table, and the matrix test must cover them before they ship.

## Evidence

`backend/test/membership.test.ts` drives every project route as every kind of person (viewer,
reviewer, analyst, lead, workspace admin and owner, a workspace member added to nothing, a signed-in
stranger, a platform administrator, another workspace's owner, and no token) and requires the outcome
written in the table: allowed, forbidden, hidden or unauthenticated. It also covers a person on one
project reaching another, another workspace in both directions, the comparison query, the member
routes themselves (a lead cannot reach another project's members, an admin cannot make or remove an
owner, the last owner and last lead stay), revocation on the next request, bootstrap, the audit
entries, the sharing bound, and the unchanged local mode. `auth.test.ts` keeps the token, tenant and
comparison tests, and proves that migration 4 gives an upgraded database its leads and members.
