# HTTP API

Back to the [README](../README.md).

All browser requests are same-origin. During development Vite provides the proxy.
Errors are non-2xx JSON: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
Some not-found/rate-limit responses omit `requestId`; no provider error body is returned.

| Method       | Path                                             | Behavior                                                                                                                  |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET          | `/api/health`                                    | Actual process/storage/queue readiness, not model connectivity                                                            |
| GET          | `/api/health/live`                               | Liveness: `{ "status": "live" }`, or 503 `broken` when the database connection is lost for good (a restart cures it)      |
| GET          | `/api/health/ready`                              | Readiness: 200 `ready`, or 503 `not-ready` with the check that failed (`database`); nothing else, and no sign-in needed   |
| GET          | `/api/config`                                    | Safe capabilities, limits and provider status; no key or private endpoint                                                 |
| GET          | `/api/provider/status`                           | Mode, provider, model, auth type, connectivity, call and token counters, last error code; never a host, key or token      |
| POST         | `/api/provider/check`                            | One explicit real model round trip (rate limited); 503 when no provider is configured, never a local fallback             |
| GET / POST   | `/api/projects`                                  | Paginated history / validated draft creation                                                                              |
| GET / DELETE | `/api/projects/:id`                              | Full persisted detail / delete non-active experiment                                                                      |
| POST         | `/api/projects/:id/run`                          | Queue a draft/failed/cancelled experiment; returns 202                                                                    |
| POST         | `/api/projects/:id/steps/:step`                  | Queue `knowledge`, `environment`, `simulation` or `report`, with real prerequisites; returns 202                          |
| PATCH        | `/api/projects/:id/environment`                  | Edit a prepared environment before simulation begins                                                                      |
| POST         | `/api/projects/:id/steps/simulation`             | With body `{ "resume": true }`: continue from the last saved round (paused, failed or cancelled with saved rounds)        |
| POST         | `/api/projects/:id/pause`                        | Pause a queued/running simulation at the last saved round (non-error `paused` state); returns 202                         |
| PUT          | `/api/projects/:id/intervention`                 | Schedule (`Intervention` JSON) or remove (`null`) the one future intervention while paused                                |
| POST         | `/api/projects/:id/branches`                     | Create an independent scenario from a checkpoint with declared assumption changes; returns 201                            |
| GET          | `/api/projects/:id/compare?with=<id>`            | Per-round metrics, deltas, lineage and honesty notes for two guided scenarios                                             |
| POST         | `/api/projects/:id/cancel`                       | Cancel waiting work or request active cancellation                                                                        |
| POST         | `/api/documents/extract`                         | Validate/base64-decode and isolate bounded local PDF extraction                                                           |
| GET          | `/api/projects/:id/evidence?query=...`           | Sparse-vector search; exact `S1`-style citation lookup                                                                    |
| GET          | `/api/projects/:id/evidence`                     | Explicit unranked browsing of this project's bounded passages                                                             |
| GET / POST   | `/api/projects/:id/chat`                         | Read target conversation / perform a bounded follow-up                                                                    |
| GET          | `/api/projects/:id/memories?query=&platform=all` | Search/browse this scenario's explicitly synthetic memories; exact memory IDs supported                                   |
| POST         | `/api/projects/:id/surveys`                      | Queue a bounded state snapshot or model-interview survey; returns 202                                                     |
| POST         | `/api/projects/:id/surveys/:surveyId/cancel`     | Request cancellation of an active survey                                                                                  |
| GET          | `/api/projects/:id/export?format=markdown`       | Escaped, source-linked report                                                                                             |
| GET          | `/api/projects/:id/export?format=json`           | Snapshot, chunks, evidence ledger and conversation export                                                                 |
| GET          | `/api/projects/:id/ledger`                       | The evidence ledger: every statement with support class, how it may be shown, its passages, and conflicts between sources |
| GET          | `/api/projects/:id/claims/:claimId`              | One statement with whole cited passages, simulated events and assumptions                                                 |
| POST         | `/api/projects/:id/claims/:claimId/review`       | Accept, reject or flag a statement (`{ result, note?, expectedVersion? }`); a reviewer can never upgrade support          |
| POST         | `/api/projects/:id/conflicts/:conflictId/review` | Confirm, dismiss or resolve a detected conflict between sources; recalculates the statements it touches                   |
| GET          | `/api/projects/:id/audit`                        | Tamper-evident audit entries for the project (ids and counts, never content)                                              |
| GET          | `/api/audit/verify`                              | Recompute the audit hash chain (platform administrators)                                                                  |
| GET          | `/api/workspace`                                 | The caller's role in their workspace (`owner`, `admin`, `member` or `null`) and whether they administer the platform      |
| GET          | `/api/session`                                   | Whether the caller is signed in, how (`session`, `token` or `local`), and for a session when it idles out and ends        |
| GET          | `/api/workspace/members`                         | Everyone in the caller's workspace, with their role (workspace owners and admins)                                         |
| PUT / DELETE | `/api/workspace/members/:principalId`            | Add or change (`{ "role": "owner" \| "admin" \| "member" }`) / remove a member; removal also ends their project access    |
| GET          | `/api/projects/:id/members`                      | Who may use the experiment, with their role                                                                               |
| PUT / DELETE | `/api/projects/:id/members/:principalId`         | Add or change (`{ "role": "lead" \| "analyst" \| "reviewer" \| "viewer" }`) / remove a project member (project leads)     |

Search with no matching terms returns an empty list, not arbitrary “relevant”
sources. Empty-query browsing is a distinct unranked operation (scores are zero).
Creation and result shapes are defined in [shared/types.ts](../shared/types.ts).
Chat POST takes `{ "target": "report" | "agent-1", "message": "..." }`; GET accepts
`?target=...`. Agent IDs must belong to the selected experiment. An analyst reply carries
`grounding` (`cited`, `caveated`, `abstained` or `uncited`, with notes) and may cite passages,
simulated memories and report statements (`claimIds`). When the project holds nothing that answers a
question the reply is exactly `The available project evidence does not support a confident answer.`

## Authentication

With `AUTH_MODE=none` (the default) there is no sign-in, and the one local user owns everything. With
`AUTH_MODE=entra` every `/api` call except `GET /api/health` needs
`Authorization: Bearer <Microsoft Entra v2.0 access token>`, and the caller's membership decides the
result: `401 UNAUTHENTICATED` (the same answer for every kind of bad token), `403 NO_ROLE` (a valid
token with no Swarm app role), `403 FORBIDDEN` (the caller's role does not allow it), `404
PROJECT_NOT_FOUND` (another tenant's experiment, or one in the caller's workspace that they were not
added to: the two are indistinguishable from an experiment that does not exist), and `409 LAST_OWNER`
or `409 LAST_LEAD` when a membership change would leave a workspace without an owner or a project
without a lead. Who may do what is in [ADR 0007](./adr/0007-workspace-and-project-membership.md); the
app roles that let a person in are in [CONFIGURATION.md](./CONFIGURATION.md#sign-in-and-tenants).

### Browser sign-in routes

Present only when browser sign-in is configured (otherwise they are `404`). They are outside `/api`
and carry no JSON.

| Method | Path             | Behavior                                                                                                                                                        |
| ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/auth/login`    | Starts a sign-in: sets a short-lived binding cookie and redirects to Microsoft (`?returnTo=` takes a path on this site only)                                    |
| GET    | `/auth/callback` | Finishes it: redeems the code, checks the ID token, sets the session cookie and redirects back. Any failure redirects to `/?signin=failed` or `/?signin=norole` |
| POST   | `/auth/logout`   | Ends the session on the server and clears the cookie; needs the `X-Swarm-CSRF: 1` header. Returns 204                                                           |

With a session cookie instead of a token, an `/api` call returns `401 SIGN_IN_REQUIRED` when there is no
valid session, and a change without the `X-Swarm-CSRF: 1` header returns `403 CSRF_REQUIRED`. A token,
when sent, is the only credential considered.

## Request and response notes

New UI creation sends `workflow: "guided"`; omitted workflow remains `"quick"` for
API compatibility. Stage state and environment/survey input contracts are in
[shared/guided.ts](../shared/guided.ts). Guided exports use `schemaVersion: 2`;
historical quick exports remain version 1. Markdown requires a completed report;
JSON can preserve a labeled partial snapshot.

PDF extraction takes `{ "name": "source.pdf", "data": "BASE64_BYTES" }`, not a data
URL or remote URL. The response contains extracted `content`, `pageCount` and
`bytes`. Create the scenario with this text, not raw binary.

Surveys take `{ "kind": "state" | "interview", "question": "...", "agentIds": [...] }`.
Poll the project's `console.surveys` until completion. Local state snapshots have
`answer: null`; generated answers are only produced by real model calls.
