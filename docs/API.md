# HTTP API

Back to the [README](../README.md).

All browser requests are same-origin. During development Vite provides the proxy.
Errors are non-2xx JSON: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
Some not-found/rate-limit responses omit `requestId`; no provider error body is returned.

| Method       | Path                                                                            | Behavior                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET          | `/api/health`                                                                   | Actual process/storage/queue readiness, not model connectivity                                                                                                                                                                                                                                                                                                    |
| GET          | `/api/health/live`                                                              | Liveness: `{ "status": "live" }`, or 503 `broken` when the database connection is lost for good (a restart cures it)                                                                                                                                                                                                                                              |
| GET          | `/api/health/ready`                                                             | Readiness: 200 `ready`, or 503 `not-ready` with the check that failed (`database`); nothing else, no sign-in, and for any `Host` (a platform probe sends its own address)                                                                                                                                                                                         |
| GET          | `/api/config`                                                                   | Safe capabilities, limits and provider status; no key or private endpoint                                                                                                                                                                                                                                                                                         |
| GET          | `/api/provider/status`                                                          | Mode, provider, model, auth type, connectivity, call and token counters, last error code; never a host, key or token                                                                                                                                                                                                                                              |
| POST         | `/api/provider/check`                                                           | One explicit real model round trip (rate limited); 503 when no provider is configured, never a local fallback                                                                                                                                                                                                                                                     |
| GET / POST   | `/api/projects`                                                                 | Paginated history / validated draft creation                                                                                                                                                                                                                                                                                                                      |
| GET / DELETE | `/api/projects/:id`                                                             | Full persisted detail / delete non-active experiment                                                                                                                                                                                                                                                                                                              |
| POST         | `/api/projects/:id/run`                                                         | Queue a draft/failed/cancelled experiment; returns 202                                                                                                                                                                                                                                                                                                            |
| POST         | `/api/projects/:id/steps/:step`                                                 | Queue `knowledge`, `environment`, `simulation` or `report`, with real prerequisites; returns 202                                                                                                                                                                                                                                                                  |
| PATCH        | `/api/projects/:id/environment`                                                 | Edit a prepared environment before simulation begins                                                                                                                                                                                                                                                                                                              |
| POST         | `/api/projects/:id/steps/simulation`                                            | With body `{ "resume": true }`: continue from the last saved round (paused, failed or cancelled with saved rounds)                                                                                                                                                                                                                                                |
| POST         | `/api/projects/:id/pause`                                                       | Pause a queued/running simulation at the last saved round (non-error `paused` state); returns 202                                                                                                                                                                                                                                                                 |
| PUT          | `/api/projects/:id/intervention`                                                | Schedule (`Intervention` JSON) or remove (`null`) the one future intervention while paused                                                                                                                                                                                                                                                                        |
| POST         | `/api/projects/:id/branches`                                                    | Create an independent scenario from a checkpoint with declared assumption changes; returns 201                                                                                                                                                                                                                                                                    |
| GET          | `/api/projects/:id/compare?with=<id>`                                           | Per-round metrics, deltas, lineage and honesty notes for two guided scenarios                                                                                                                                                                                                                                                                                     |
| POST         | `/api/projects/:id/cancel`                                                      | Cancel waiting work or request active cancellation                                                                                                                                                                                                                                                                                                                |
| GET          | `/api/projects/:id/jobs`                                                        | The newest stage jobs of a project: state, attempt, error code, times. Never the worker's identity or the idempotency key                                                                                                                                                                                                                                         |
| POST         | `/api/documents/extract`                                                        | Validate/base64-decode and isolate bounded local PDF extraction; a `.csv` or `.json` name is read as text on the server instead                                                                                                                                                                                                                                   |
| POST         | `/api/evidence/url`                                                             | Read one public web page (or a text, Markdown, CSV or JSON file at an address) as a document with provenance; workspace members who may create a project; 10 a minute; see [URL ingestion](./security/url-ingestion.md)                                                                                                                                           |
| GET          | `/api/projects/:id/evidence?query=...`                                          | Sparse-vector search; exact `S1`-style citation lookup                                                                                                                                                                                                                                                                                                            |
| GET          | `/api/projects/:id/evidence`                                                    | Explicit unranked browsing of this project's bounded passages                                                                                                                                                                                                                                                                                                     |
| GET / POST   | `/api/projects/:id/chat`                                                        | Read target conversation / perform a bounded follow-up                                                                                                                                                                                                                                                                                                            |
| GET          | `/api/projects/:id/memories?query=&platform=all`                                | Search/browse this scenario's explicitly synthetic memories; exact memory IDs supported                                                                                                                                                                                                                                                                           |
| POST         | `/api/projects/:id/surveys`                                                     | Queue a bounded state snapshot or model-interview survey; returns 202                                                                                                                                                                                                                                                                                             |
| POST         | `/api/projects/:id/surveys/:surveyId/cancel`                                    | Request cancellation of an active survey                                                                                                                                                                                                                                                                                                                          |
| GET          | `/api/projects/:id/export?format=markdown`                                      | Escaped, source-linked report                                                                                                                                                                                                                                                                                                                                     |
| GET          | `/api/projects/:id/export?format=json`                                          | Snapshot, chunks, evidence ledger and conversation export                                                                                                                                                                                                                                                                                                         |
| GET          | `/api/projects/:id/ledger`                                                      | The evidence ledger: every statement with support class, how it may be shown, its passages, and conflicts between sources                                                                                                                                                                                                                                         |
| GET          | `/api/projects/:id/claims/:claimId`                                             | One statement with whole cited passages, simulated events and assumptions                                                                                                                                                                                                                                                                                         |
| POST         | `/api/projects/:id/claims/:claimId/review`                                      | Accept, reject or flag a statement (`{ result, note?, expectedVersion? }`); a reviewer can never upgrade support                                                                                                                                                                                                                                                  |
| POST         | `/api/projects/:id/conflicts/:conflictId/review`                                | Confirm, dismiss or resolve a detected conflict between sources; recalculates the statements it touches                                                                                                                                                                                                                                                           |
| GET          | `/api/projects/:id/studio`                                                      | Report Studio: the document made from the generated report (sections, versions, notes, locks, proposals, decisions, approval), whether it is stale, the passages and conflicts its statements cite, what the caller may do, and whether writing a chapter again is available. `document` is `null` until someone opens the report                                 |
| POST         | `/api/projects/:id/studio`                                                      | Open the generated report as a document (`{ confirm? }`). When the generated report has been replaced since, start again from the new one: the old text moves to the archive, and `confirm: true` is required if it holds anyone's work                                                                                                                           |
| PUT          | `/api/projects/:id/studio/sections/:sectionId`                                  | Save text as a new version (`{ body, expectedVersion, reason? }`). A section whose current version is not `expectedVersion` is refused with `409 SECTION_CONFLICT`, never overwritten                                                                                                                                                                             |
| PUT          | `/api/projects/:id/studio/sections/:sectionId/lock`                             | Lock or unlock a section (`{ locked }`); a locked section cannot be edited, restored or written again                                                                                                                                                                                                                                                             |
| POST         | `/api/projects/:id/studio/sections/:sectionId/notes`                            | A reviewer's note (`{ text }`). Allowed in any state: it changes no text and does not disturb an approval                                                                                                                                                                                                                                                         |
| POST         | `/api/projects/:id/studio/sections/:sectionId/restore`                          | Bring an earlier version's text back as a new version (`{ version, expectedVersion, reason? }`)                                                                                                                                                                                                                                                                   |
| POST         | `/api/projects/:id/studio/sections/:sectionId/regenerate`                       | Ask the model to write one chapter again (`{ expectedVersion, instruction? }`). The result is a proposal and changes nothing until it is accepted. `503 REGENERATION_UNAVAILABLE` when it cannot be done; `409 PROJECT_BUSY` while another model task runs on the project                                                                                         |
| POST         | `/api/projects/:id/studio/sections/:sectionId/proposal`                         | Accept or reject the proposal (`{ decision, proposalId, expectedVersion }`)                                                                                                                                                                                                                                                                                       |
| POST         | `/api/projects/:id/studio/submit`, `…/approve`, `…/request-changes`, `…/reopen` | The review steps, each on the revision the caller was looking at (`{ expectedRevision, note? }`). Requesting changes and reopening need a note of at least three characters                                                                                                                                                                                       |
| GET          | `/api/projects/:id/studio/export?format=markdown`, `json` or `memo`             | The document with its status and record. `memo` is a printable HTML page, served with a policy that lets it load and run nothing                                                                                                                                                                                                                                  |
| GET          | `/api/projects/:id/audit`                                                       | Tamper-evident audit entries for the project (ids and counts, never content)                                                                                                                                                                                                                                                                                      |
| GET          | `/api/audit/verify`                                                             | Recompute the audit hash chain (platform administrators)                                                                                                                                                                                                                                                                                                          |
| GET          | `/api/workspace`                                                                | The caller's role in their workspace (`owner`, `admin`, `member` or `null`) and whether they administer the platform                                                                                                                                                                                                                                              |
| GET          | `/api/session`                                                                  | Whether the caller is signed in, how (`session`, `token` or `local`), and for a session when it idles out and ends                                                                                                                                                                                                                                                |
| GET          | `/api/workspace/members`                                                        | Everyone in the caller's workspace, with their role (workspace owners and admins)                                                                                                                                                                                                                                                                                 |
| PUT / DELETE | `/api/workspace/members/:principalId`                                           | Add or change (`{ "role": "owner" \| "admin" \| "member" }`) / remove a member; removal also ends their project access                                                                                                                                                                                                                                            |
| GET          | `/api/projects/:id/members`                                                     | Who may use the experiment, with their role, and `may.manage`: whether the caller may change that (what the page offers; the server decides each change)                                                                                                                                                                                                          |
| PUT / DELETE | `/api/projects/:id/members/:principalId`                                        | Add or change (`{ "role": "lead" \| "analyst" \| "reviewer" \| "viewer" }`) / remove a project member (project leads)                                                                                                                                                                                                                                             |
| GET          | `/api/projects/:id/budget`                                                      | What the project has used of its model budget (`calls`, `inputTokens`, `outputTokens`), the limits that apply (`callLimit`, `tokenLimit`; 0 is none), what the project itself sets (`own`; `null` is the deployment's default), the deployment's `defaults`, the `state` (`none`, `ok`, `warning`, `exhausted`) and whether the caller may change it (`may.edit`) |
| PUT          | `/api/projects/:id/budget`                                                      | Set the project's own limits: `{ "callLimit": n \| null, "tokenLimit": n \| null }`, whole numbers up to 1,000,000,000; `null` is the deployment's default and `0` is no limit. Workspace owners and administrators only, not a project lead                                                                                                                      |

Search with no matching terms returns an empty list, not arbitrary “relevant”
sources. Empty-query browsing is a distinct unranked operation (scores are zero).
Creation and result shapes are defined in [shared/types.ts](../shared/types.ts).
Chat POST takes `{ "target": "report" | "agent-1", "message": "..." }`; GET accepts
`?target=...`. Agent IDs must belong to the selected experiment. An analyst reply carries
`grounding` (`cited`, `caveated`, `abstained` or `uncited`, with notes, which name an open conflict between sources that the answer touches) and may cite passages,
simulated memories and report statements (`claimIds`). When the project holds nothing that answers a
question the reply is exactly `The available project evidence does not support a confident answer.`

### Report Studio

The studio works on a copy of the generated report; the generated report itself is never changed.
Opening it makes a document of sections (`summary`, `S1`…`Sn`, `limitations`), and every change to a
section is a new version.

- **Who may do what.** Reading and exporting need `read` and `export`. Changing a section, locking,
  writing a chapter again, submitting and reopening need the `edit` capability (analysts and
  project leads). Approving, requesting changes and leaving notes need `review` (reviewers and
  project leads). A reviewer cannot edit and an analyst cannot approve; a lead can do both, and an
  approval records when the approver also wrote part of the text. See
  [ADR 0011](./adr/0011-report-studio.md).
- **States.** `draft` → `in-review` → `approved`, or `changes-requested` back to editing. Only
  `draft` and `changes-requested` can be edited (`409 STUDIO_NOT_EDITABLE` otherwise). An approval
  stores a SHA-256 of every section's identifier and text; the printable memo prints it.
- **Refusals the caller should expect.** `SECTION_CONFLICT` (the section changed since it was read),
  `STUDIO_CHANGED` (the document changed since the caller read its revision), `STUDIO_STALE` (the
  generated report was replaced; start again with `POST /studio`), `SECTION_LOCKED`,
  `PROPOSAL_PENDING` (decide on the regenerated text first), `NOTE_REQUIRED`, `CONFIRM_REQUIRED`,
  `NO_CHANGE`, `SECTION_EMPTY`, and `413 STUDIO_TOO_LARGE`.
- **Audit.** Every change is recorded in the audit log inside the same transaction as the change:
  `studio.started`, `studio.restarted`, `studio.section.edited`, `studio.section.locked`,
  `studio.section.unlocked`, `studio.section.restored`, `studio.note.added`,
  `studio.regeneration.proposed`, `studio.proposal.accepted`, `studio.proposal.rejected`,
  `studio.submitted`, `studio.approved`, `studio.changes.requested`, `studio.reopened` and
  `studio.exported`. An entry holds identifiers and counts; never the text of a section, a note or
  a reason.

### Model budget

Each project has a budget for the model: the calls that completed, and the tokens they used, since
the project was made (`project_usage`; it does not start again when a run does). A limit of 0 is no
limit. The deployment sets a default for every project (`PROJECT_MODEL_CALL_LIMIT`,
`PROJECT_MODEL_TOKEN_LIMIT`); a workspace owner or administrator may give one project its own. See
[ADR 0013](./adr/0013-per-project-model-budget.md).

- **What is held.** Every model call of the project: a quick run, a stage, an answer from the analyst
  or an actor, a generated interview and a chapter written again in the studio. Once a project has used
  what it may, the next call is refused with `429 PROJECT_BUDGET` before anything is sent to the
  provider, and the operation fails with that message like any failure that does not pass: it is not
  repaired or retried, and a simulation that stopped keeps its saved rounds. Reading, editing and
  exporting never use the model.
- **Soft edges.** A call is counted when the provider answers, so the call that crosses a limit is the
  last, calls already in flight may finish over it, and a token limit is checked between calls.
- **Who may change it.** Anyone who can read the project sees it; only a workspace owner or
  administrator changes it (the `budget` capability, which no project role holds, a lead included).
- **Audit.** `project.budget.changed` (the two limits) and `model.budget.exhausted` (counts only, once
  for each client that was refused, with the system as the actor).

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

**Idempotency.** `POST /api/projects/:id/run` and `POST /api/projects/:id/steps/:step` accept an `Idempotency-Key` header (8-128 letters, digits and `-_.:`). A project that has already seen the key returns 202 with the project and queues nothing, so a client that retries after a lost reply does not start a second run; a malformed key is a 400. Without the header every request is its own job, and asking while work is active is a 409 `RUN_ACTIVE`.

New UI creation sends `workflow: "guided"`; omitted workflow remains `"quick"` for
API compatibility. Stage state and environment/survey input contracts are in
[shared/guided.ts](../shared/guided.ts). Guided exports use `schemaVersion: 2`;
historical quick exports remain version 1. Markdown requires a completed report;
JSON can preserve a labeled partial snapshot.

PDF extraction takes `{ "name": "source.pdf", "data": "BASE64_BYTES" }`, not a data
URL or remote URL. The response contains extracted `content`, `pageCount` and
`bytes`. Create the scenario with this text, not raw binary. The same route reads a
`.csv` or `.json` file (up to 2 MB, UTF-8) as readable text on the server and returns
`{ name, content, bytes, notes }`.

Reading a public web page: `POST /api/evidence/url` with `{ "url": "https://…" }` returns
`{ "document": { "name", "content", "provenance" }, "notes": [...] }`, a document that can be sent
as one of a project's `documents`. A failure is a 4xx with a code that starts `URL_` and a message that ends
with "You can paste the text instead." What is fetched, how, and what is not promised is in
[URL ingestion](./security/url-ingestion.md).

Surveys take `{ "kind": "state" | "interview", "question": "...", "agentIds": [...] }`.
Poll the project's `console.surveys` until completion. Local state snapshots have
`answer: null`; generated answers are only produced by real model calls.
