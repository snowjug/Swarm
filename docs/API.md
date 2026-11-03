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
| GET          | `/api/config`                                                                   | Safe capabilities, limits and provider status, and whether reading a public web page is on (`urlIngestion`); no key or private endpoint                                                                                                                                                                                                                           |
| GET          | `/api/provider/status`                                                          | Mode, provider, model, auth type, connectivity, call and token counters, last error code; never a host, key or token                                                                                                                                                                                                                                              |
| POST         | `/api/provider/check`                                                           | One explicit real model round trip (rate limited); 503 when no provider is configured, never a local fallback                                                                                                                                                                                                                                                     |
| GET / POST   | `/api/projects`                                                                 | Paginated history / validated draft creation. The body takes `name`, `question`, `documents` (each may carry a `provenance`), `workflow` (`quick` or `guided`), `settings` and an optional `scenario` frame from intake, which is stored with the project as its scenario                                                                                         |
| GET / DELETE | `/api/projects/:id`                                                             | Full persisted detail, with `lab` (how far the scenario lab has come: `scenario`, `stakeholders`, `actors`, `analysis`, `critiques`, `brief`) / delete non-active experiment                                                                                                                                                                                      |
| POST         | `/api/projects/:id/run`                                                         | Queue a draft/failed/cancelled experiment; returns 202                                                                                                                                                                                                                                                                                                            |
| POST         | `/api/projects/:id/steps/:step`                                                 | Queue `knowledge`, `environment`, `simulation` or `report`, with real prerequisites; returns 202                                                                                                                                                                                                                                                                  |
| PATCH        | `/api/projects/:id/environment`                                                 | Edit a prepared environment before simulation begins                                                                                                                                                                                                                                                                                                              |
| POST         | `/api/projects/:id/steps/simulation`                                            | With body `{ "resume": true }`: continue from the last saved round (paused, failed or cancelled with saved rounds)                                                                                                                                                                                                                                                |
| POST         | `/api/projects/:id/pause`                                                       | Pause a queued/running simulation at the last saved round (non-error `paused` state); returns 202                                                                                                                                                                                                                                                                 |
| PUT          | `/api/projects/:id/intervention`                                                | Schedule (`Intervention` JSON) or remove (`null`) the one future intervention while paused                                                                                                                                                                                                                                                                        |
| POST         | `/api/projects/:id/branches`                                                    | Create an independent scenario from a checkpoint with declared assumption changes; its documents keep where each came from (a page the server fetched stays a retrieved page); returns 201                                                                                                                                                                        |
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
| GET / POST   | `/api/projects/:id/analysis`                                                    | The saved scenario comparisons and what the next would use / start one (202; 409 without actors, or from stakeholders that are no longer approved); see Comparing scenarios                                                                                                                                                                                       |
| GET          | `/api/projects/:id/analysis/:aid`                                               | One comparison in full, with its progress while it runs                                                                                                                                                                                                                                                                                                           |
| POST         | `/api/projects/:id/analysis/:aid/cancel`                                        | Ask a running comparison to stop at its next run                                                                                                                                                                                                                                                                                                                  |
| GET / PUT    | `/api/projects/:id/constraints`                                                 | What limits the decision: the set, its revision, the gate worked out now and the questions to put now / replace the whole set (`expectedRevision`); see Constraints                                                                                                                                                                                               |
| POST         | `/api/projects/:id/constraints/propose`                                         | Read the sources for constraints (`{ "mode": "rules" \| "model" }`, 201; 10 a minute)                                                                                                                                                                                                                                                                             |
| POST         | `/api/projects/:id/constraints/review`                                          | One thing a person does with the constraints or the questions, with `expectedRevision`                                                                                                                                                                                                                                                                            |
| GET          | `/api/projects/:id/constraints/gate`                                            | The coverage gate, with the constraint whose removal moves the simulated result most                                                                                                                                                                                                                                                                              |
| GET / POST   | `/api/projects/:id/constraints/counterfactuals`                                 | The stored views of the proposed change and whether they are current / run them (201; 6 a minute)                                                                                                                                                                                                                                                                 |
| POST         | `/api/scenario/parse`                                                           | Read a "What could happen if…?" question into an editable scenario frame, `{ frame, notes, mode, model }`; the rules on the server read it, and a model only when the request says `useModel: true` and the server has a provider; stores nothing. See Scenario intake                                                                                            |
| GET / PUT    | `/api/projects/:id/scenario`                                                    | The project's scenario frame and its revision (`scenario` is `null` until there is one) / replace it (`{ scenario, expectedRevision? }`)                                                                                                                                                                                                                          |
| GET          | `/api/projects/:id/stakeholders`                                                | The stakeholder set, its revision, whether a model may be used, and what the caller may do (`{ stakeholders, revision, model, may }`). `stakeholders` is `null` until someone looks for them                                                                                                                                                                      |
| POST         | `/api/projects/:id/stakeholders/discover`                                       | Find stakeholders by reading the text (`{ "mode": "rules" }`, the default) or with the project's model (`"model"`); returns 201 with the set. A reviewed list is replaced only with `{ "confirm": true }`                                                                                                                                                         |
| PUT          | `/api/projects/:id/stakeholders`                                                | Save a review: the whole set as the person now wants it, `{ stakeholders, relations?, expectedRevision }`. A stakeholder is never deleted, only marked removed; a change to an approved set takes the approval away                                                                                                                                               |
| POST         | `/api/projects/:id/stakeholders/approve`                                        | Approve the set (`{ expectedRevision }`). At least two stakeholders must remain, and no blocking participant check may stand open (`409 PARTICIPANTS_INVALID`). Proposed ones become accepted                                                                                                                                                                     |
| POST         | `/api/projects/:id/stakeholders/propose`                                        | Propose the decision's participants, with roles, checked as they are made (`{ mode?, confirm? }` as for discover); 201 with the set and its `review`. Needs `run`                                                                                                                                                                                                 |
| GET          | `/api/projects/:id/stakeholders/validation`                                     | The checks of the participants as they stand now, `{ revision, review }`; `review.valid` is false while a blocking issue remains                                                                                                                                                                                                                                  |
| POST         | `/api/projects/:id/stakeholders/accept`                                         | Accept the participants named, or every one still proposed (`{ expectedRevision, ids? }`)                                                                                                                                                                                                                                                                         |
| PATCH        | `/api/projects/:id/stakeholders/:participantId`                                 | Change one participant (`{ expectedRevision, changes }`); only the fields a person may change are accepted                                                                                                                                                                                                                                                        |
| DELETE       | `/api/projects/:id/stakeholders/:participantId`                                 | Mark one participant removed (`?expectedRevision=`); nothing is deleted                                                                                                                                                                                                                                                                                           |
| POST         | `/api/projects/:id/stakeholders/:participantId/regenerate`                      | Propose one participant again from the rest (`{ expectedRevision, mode?, confirm? }`); `confirm` replaces one the person changed. Needs `run`                                                                                                                                                                                                                     |
| GET          | `/api/projects/:id/stakeholders/:participantId/why`                             | Why a participant is on the list, from what it already holds and the passages it cites                                                                                                                                                                                                                                                                            |
| POST         | `/api/projects/:id/stakeholders/merge-duplicates`                               | Merge participants that are certainly one, or the groups named (`{ expectedRevision, groups?: [{ keep, merge }] }`)                                                                                                                                                                                                                                               |
| POST         | `/api/projects/:id/stakeholders/add-missing`                                    | Add a participant for a role nobody holds (`{ expectedRevision, role, name, whyTheyMatter?, objective? }`), as the person's own and with no evidence                                                                                                                                                                                                              |
| GET          | `/api/projects/:id/actors`                                                      | The synthetic actors made from the approved set, with `stale` (the stakeholders changed after they were made), `model` and `may`                                                                                                                                                                                                                                  |
| POST         | `/api/projects/:id/actors/generate`                                             | Make the actors from the approved set (`{ model?, confirm? }`); returns 201. Actors the person has edited are replaced only with `confirm`                                                                                                                                                                                                                        |
| PUT          | `/api/projects/:id/actors`                                                      | Save edited actors (`{ actors, expectedRevision }`): sizes, traits, objectives and so on. The cast cannot gain or lose an actor here                                                                                                                                                                                                                              |
| GET          | `/api/projects/:id/critiques`                                                   | The independent review of the newest finished comparison (`{ critiques, revision, changedSince, analysis, may, model }`; `critiques` is `null` until one has been run)                                                                                                                                                                                            |
| POST         | `/api/projects/:id/critiques/run`                                               | Run the review (`{ analysisId?, useModel? }`): fixed rules always, a model's extra critiques only when asked for. Answers with the review as it now is                                                                                                                                                                                                            |
| PUT          | `/api/projects/:id/critiques/:cid/response`                                     | Respond to one critique (`{ text, status: "responded" \| "accepted" \| "disputed", remainingDisagreement?, expectedRevision }`; 409 when the review has changed since)                                                                                                                                                                                            |
| GET / POST   | `/api/projects/:id/brief`                                                       | The decision brief with the data its charts were made with, and whether it is out of date (`{ brief, visuals, visualsFrom, latestAnalysis, changedSince, may }`) / write it from a finished comparison (`{ analysisId? }`, 201)                                                                                                                                   |
| GET          | `/api/projects/:id/brief/export?format=md`, `json` or `html`                    | The brief as Markdown or JSON (attachments) or as a printable page served with a policy that lets it load and run nothing; 20 a minute                                                                                                                                                                                                                            |

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

### Comparing scenarios

A comparison runs a baseline and its alternatives many times on the same seeds, in the server process,
and is kept as the project's `analysis` artifacts. Its method, limits and what its numbers do and do
not mean are in [analysis/methodology.md](./analysis/methodology.md).

- **Routes.** `GET /api/projects/:id/analysis` lists the saved comparisons (newest first) with what the
  next one would use (`readiness`: the actors, the suggested scenarios, `warnings`, whether the caller
  may run), and answers 200 with an empty list for a project that never ran one. `readiness.warnings`
  is a list of plain sentences, empty by default: when no stakeholder has an expected direction of impact it
  holds one notice, that the change cannot move anyone (when the simulator gives the same outcome with
  and without it) or, where members of a group can still be moved by an assumed spread, that nobody is set
  as helped or harmed and that what a comparison shows comes from that assumption. It never stops a run. `GET .../analysis/:aid` reads one in
  full. `POST .../analysis` starts one and answers 202 with it as `running`; its body is
  `{ runsPerVariant?, baseSeed?, variants?, sensitivity?, rounds? }` (3 to 200 runs for each scenario,
  `variants` `"auto"` or up to 8 scenarios, 3 to 36 rounds). The caller polls `GET .../analysis/:aid`
  for its `progress`. `POST .../analysis/:aid/cancel` asks it to stop at its next run.
- **Who may do what.** Reading needs `read`; starting and stopping need `run` (analysts and project
  leads).
- **Refusals the caller should expect.** `409 ACTORS_REQUIRED` (no actors have been created yet),
  `409 STAKEHOLDERS_NOT_APPROVED` (the stakeholders were found again or changed after the actors were made,
  so they are no longer approved) and `409 ACTORS_OUT_OF_DATE` (the actors were made from an earlier revision
  of the stakeholders): each says in a sentence what to do, which is to approve the stakeholders and make
  the actors again, and nothing is saved. `409 ANALYSIS_RUNNING` (one is already running for the project),
  `429 ANALYSIS_BUSY` (the server is running its limit), `400 INVALID_INPUT` (a setting outside its limit:
  the message states the limit in a sentence and does not quote what was sent), `400 ANALYSIS_INPUT_INVALID`
  (a request that is allowed but cannot be run, with the reason: more than 2,400 simulated runs, a change
  that starts after the last round, and so on), `404 ANALYSIS_NOT_FOUND`, `409 ANALYSIS_NOT_RUNNING`,
  `503 ANALYSIS_NOT_STARTED` (it was saved but could not be launched, and is ended as `failed`), and
  `429 RATE_LIMITED` (6 starts a minute). For a project that has constraints: `409 CONSTRAINTS_BLOCKED` (a hard
  legal, regulatory or safety constraint is not settled, or a hard constraint rules out every alternative) and
  `409 CONSTRAINTS_UNREVIEWED` (a person has not yet been through them); each says in a sentence what to do.
  A project with no constraints is not gated.
- **What a comparison was made from.** It records `inputRevisions`: the revision of the scenario, the
  stakeholders and the actors it ran on (0 when there was none), and the constraints where there are some, kept when it finishes. The review and the
  brief are judged against it. A comparison saved before this was recorded has none, and whether the
  documents it used are the current ones cannot be told: `changedSince` then carries
  `what the comparison was made from was not recorded` for the review and the brief that rest on it, however
  often they are made again, until the comparison is run again.
- **Starting is atomic.** The comparison is saved as `running` in the same transaction as the
  `analysis.started` audit record, and the run is launched only after both are committed: a start that
  cannot be recorded leaves no comparison behind.
- **What is kept.** A project keeps its newest twelve comparisons, and never removes the one that the
  decision brief or the independent review was made from.
- **After a restart.** A comparison still `running` when the server starts is marked `interrupted`; it
  is reproducible from its seeds and is run again, not resumed.
- **Audit.** `analysis.started` and `analysis.cancelled`, with identifiers and counts only. Both are recorded
  before the thing they describe takes effect, so a start or a stop that cannot be recorded is refused with
  `503 STORAGE_UNAVAILABLE` and leaves the comparison as it was.

### Constraints

What limits the decision, as a document a person reviews before a simulation uses it. Its schema, how each
constraint is labelled, the gate, what the simulation applies and what it only reads are in
[analysis/constraints.md](./analysis/constraints.md). Reading needs `read`; changing and reviewing need
`edit`; reading the sources and running the views need `run`.

- **Reading.** `GET /api/projects/:id/constraints` answers `{ constraints, revision, gate, open, stale,
alternatives, actors, assumptions, model, may }`. `constraints` is `null` for a project that has none.
  `gate` is the coverage gate worked out now (`status` `clear`, `provisional` or `blocked`, with what is known,
  assumed, conflicting, missing, ruled out and affected); `open` is the questions to put now, at most three;
  `stale` says whether the scenario or the actors changed after the constraints were read against them.
- **Proposing.** `POST .../constraints/propose` takes `{ "mode"?: "rules" | "model" }` (10 a minute). A model is
  used only when the person asks for one, and `409 MODEL_NOT_AVAILABLE` says why when the project has none. A
  second reading adds only what is new and never undoes a decision. Nothing proposed is validated, reviewed or
  applied.
- **Reviewing.** `POST .../constraints/review` takes one action (`accept`, `confirm`, `edit`, `add`, `remove`,
  `restore`, `answer`, `exclude`, `mark-unknown`, `use-assumption`, `confirm-set`) and `expectedRevision`.
  `PUT .../constraints` takes every constraint as the person now wants it; one left out is refused
  (`400 CONSTRAINTS_OMITTED`). A request that names an actor, a scenario or an assumption the project does not
  have is `400`, and one that says where a constraint came from, that it is enforced, or its evidence is not
  understood. A change to a version that is no longer the latest is `409 ARTIFACT_CONFLICT` and changes nothing.
- **The gate and the views.** `GET .../constraints/gate` also measures which applied constraint, taken away,
  moves the simulated headline share the most. `POST .../constraints/counterfactuals` runs seven views of the
  proposed change on the same seeds (`409 COUNTERFACTUALS_NOT_READY` without actors and constraints).
- **Audit.** `constraints.proposed`, `constraints.reviewed`, `constraints.edited` and
  `constraints.counterfactuals.run`, written in the same transaction as the change, with counts and a status and
  never a statement or a quote.

### Scenario intake and the stored scenario

- **Reading a question.** `POST /api/scenario/parse` takes `{ "question", "documents"?, "useModel"? }` and
  nothing else: the question is 3 to 2,000 characters, up to 10 documents each give `{ "name", "characters",
"excerpt"? }`, and `useModel` is a boolean that is `false` when left out. An `excerpt` is at most the first
  5,000 characters of a document. It is inspected in memory for text that addresses an AI model, and is never
  stored, logged or sent to a model. The body may be 300,000 bytes, a caller may read 10 questions a minute, and
  it needs the right to create a project in the workspace, because no project exists yet. The answer is
  `{ "frame", "notes", "mode": "rules" | "model", "model": "<name>" | null }`. **The rules on the server read
  the question, and it goes nowhere else, unless `useModel` is `true`** (the page sends it for a project made
  in **Model assisted** mode) **and the server has a provider configured**: then a model reads it, is told the
  question and each document's name and size, never its text, and is given three calls at most and 170
  seconds. If the model fails, its reply does not pass the checks or the time runs out, the rules read the
  question and a note says why. `useModel` with no provider configured is read by rules too, with a note that
  no model is configured. Nothing is stored. The audit entry `scenario.parsed` holds counts.
- **The frame.** `ScenarioFrame` is in [shared/scenario.ts](../shared/scenario.ts) and is the same for
  any question: `decision`, `system`, `geography`, `horizon`, `changes[]` (`name`, `from`, `to`, `note`),
  `baseline`, `alternatives[]` (`id`, `label`, `description`, `changes[]`; at most 6), `requestedDecision`,
  `desiredOutput`, `evidenceAvailable[]`, `evidenceMissing[]`, `assumptions[]` (`id`, `text`, `origin`
  `"user"` or `"system"`; at most 15), `likelyStakeholders[]`, `ambiguities[]` (`field`, `message`,
  `question`; the reading asks at most three) and `origin` (`"rules"`, `"model"` or `"user"`). Every field
  can be edited, and `origin` says how the first version was made, never that it is right. See
  [scenario-intake.md](./scenario-intake.md).
- **Keeping it.** Send the frame with `POST /api/projects` (as `scenario`), or save it later with
  `PUT /api/projects/:id/scenario` and `{ "scenario", "expectedRevision"? }`. `PUT` answers
  `{ "scenario", "revision" }`, and `GET` answers `{ "scenario": null, "revision": 0 }` for a project that has
  none. The frame must name a decision, and its alternatives and assumptions need ids of their own. Reading
  needs `read`, saving needs `edit` and is limited to 60 a minute, and a stale `expectedRevision` is
  `409 ARTIFACT_CONFLICT`. The audit entry `scenario.edited` holds counts.
- **Provenance of a document.** A document may carry `provenance`:
  `{ "kind": "upload" | "paste" | "url" | "sample" | "historical", "url"?, "finalUrl"?, "retrievedAt"?,
"contentType"?, "sha256"?, "title"?, "license"?, "asOf"?, "fetchedByServer"? }`. `fetchedByServer` is the
  server's to set: a document that claims it keeps the claim only for text this server fetched for this
  caller in the last hour, and is otherwise recorded as pasted text. Everything else in a brief that says
  where evidence came from is read from this.

### Automatic research

Research is the first phase of grounding a project: it reads the page or site a person names, and what they
link to, keeps the best pages as sources, and checks them against each other. It reads **https only**, from
public addresses, by the rules of [URL ingestion](./security/url-ingestion.md). How it works, and what it does
not do: [backend/src/research/README.md](../backend/src/research/README.md).

- **A question on its own.** `POST /api/projects` accepts `documents: []` when `research.auto` is `true`
  and `workflow` is `"guided"` (the Ask scene sends both): research is the first phase of a guided project's
  grounding. Without `auto`, the "at least one source" error stands, and with `"quick"` the workflow is refused
  (`400`, on `workflow`). Such a project is `draft`, with no source and no passage.
- **State.** `GET /api/projects/:id/research` (needs `read`) answers `{ run, revision, discovery, may }`.
  `run` is the newest run or `null` (`ResearchRun` in [shared/research.ts](../shared/research.ts): its status
  and the stage it has really reached, its plan, its budget, what it has used, every address it tried with
  what became of it, where each passage sat in its page, an assessment for each claim to check, the number of
  conflicts, why it stopped and a log). `discovery` says whether sources can be found from a question alone
  (`available`, `provider`, `message`): **no search provider exists in this build**, so it is
  `available: false`, with the setting it would need named. `may` is `{ start, pause, cancel }`.
- **Starting.** `POST /api/projects/:id/research` takes `{ "intake"?, "budget"? }` and answers `202` with the
  same view. `intake` is `{ auto?, url?, domain?, guidance?, horizon?, geography? }`: `url` is a page,
  `domain` a site, and neither is discovery from a question alone, which ends `blocked` with
  `stoppedBecause: "discovery-unconfigured"` and puts the stage back to waiting; `auto: false` is
  `400 RESEARCH_OFF`. `budget` may hold any limit of a run (`maxPages`, `maxDomains`, `maxDepth`,
  `maxBytesPerPage`, `maxTotalBytes`, `maxElapsedMs`, `maxEstimatedCostUsd`, `maxDuplicateRatio`,
  `maxFailedRequests`, `maxRedirects`, `perDomainDelayMs`): **the server holds each to its ceiling**
  (`RESEARCH_*` in [Configuration](./CONFIGURATION.md#automatic-research)), and a person can lengthen the wait
  between requests to a site and never shorten it. The run's `budget` shows what it was given. Starting needs
  `run`, is limited to 6 a minute, takes a body of 16,000 bytes and an `Idempotency-Key`, and is recorded as
  `research.started` (the mode and the limits). Refusals: `409 RESEARCH_ACTIVE` (a run is live),
  `409 STEP_ALREADY_STARTED` (grounding is under way or done), `409 DOCUMENT_LIMIT` (the project holds ten
  sources), `403 RESEARCH_DISABLED`.
- **Adding a page or a site.** `POST /api/projects/:id/research/sources` takes `{ "url", "budget"? }` and
  starts a run of its own, under the same rules, with `202`. A bare host name such as `example.org` is a site,
  which is read and stayed on. 10 a minute, a body of 8,192 bytes, an `Idempotency-Key`, recorded as
  `research.source.added`.
- **Controlling a run.** `POST /api/projects/:id/research/pause`, `/resume`, `/finish` and `/cancel` answer
  `200` with the view, need `run`, are limited to 20 a minute and are recorded as `research.paused`,
  `research.resumed`, `research.finished` and `research.cancelled`. Pause and finish are for a run that the
  server answering is carrying out, while it is planning, finding or reading. A pause ends by itself after
  `RESEARCH_MAX_PAUSE_SECONDS`. **Finish** stops reading and goes on with what was read; **cancel** ends the
  run and its job. Refusals: `409 RESEARCH_NOT_PAUSABLE`, `RESEARCH_NOT_PAUSED`, `RESEARCH_NOT_FINISHABLE` and
  `RESEARCH_NOT_ACTIVE`.
- **The audit log** holds counts and words only, never an address, a title, a passage or the question:
  `research.documents.added` holds how many sources and passages were added, and `research.ended` (written by
  the worker) the status, the mode, why it stopped and counts. `GET /api/config` reports
  `research: { enabled, discovery, budget }`.

### Stakeholders and actors

Reading needs `read`. Finding stakeholders and making actors need `run`, because they may ask a model. Saving
a review, approving and editing actors need `edit`. The method is in
[stakeholders.md](./stakeholders.md). Every change is written with its audit entry in one transaction, and the
entry holds counts, never a name or a quote.

- **Looking.** `GET .../stakeholders` answers `{ "stakeholders": StakeholderSet | null, "revision": n | null,
"model": { "available", "reason" }, "may": { "edit", "run" } }`. `GET .../actors` answers
  `{ "actors": ActorSet | null, "revision", "stale", "model", "may" }`. A set holds `stakeholders[]` (`id`,
  `name`, `category`, `priority`, `populationSize`, `expectedImpact`, `evidence[]`, `assumptions[]`,
  `uncertainty`, `origin`, `status`, `mergedFrom[]`), `relations[]`, `discovery` (`mode`, `model`, `generatedAt`,
  `note`), `gaps[]` and `approvedAt`. An actor holds `kind` (`key` or `cohort`), `size`, `sampleSize`, its
  objectives, constraints and so on, and `traits`, each trait with its `value`, `spread`, `origin` (`evidence`,
  `user`, `system-assumption` or `model`) and `rationale`. The `impact` trait may also carry a `direction`
  (`origin` and `passageIds`): what its sign rests on when that is not what its number rests on. A cited
  passage gives a direction and never a size, so an impact read from the wording of cited sentences has the
  number's `origin` `system-assumption` and `direction.origin` `evidence`. The shapes are in
  [shared/stakeholders.ts](../shared/stakeholders.ts).
- **Finding.** `POST .../stakeholders/discover` takes `{ "mode"?: "rules" | "model", "confirm"?: boolean }`
  (rules by default; 10 a minute) and answers 201 with the set. `"model"` needs a project made in
  model-assisted mode and a configured provider (`409 MODEL_NOT_AVAILABLE` says why not), is allowed 170
  seconds, and falls back to reading the text if the model fails, saying so in `discovery.note`. One
  discovery or generation runs at a time for a project (`409 STAKEHOLDERS_BUSY`). A list the person has
  reviewed is replaced only with `confirm` (`409 STAKEHOLDERS_REVIEWED`).
- **Reviewing.** `PUT .../stakeholders` takes `{ "stakeholders", "relations"?, "expectedRevision" }` (120 a
  minute): the whole set as the person now wants it, and `0` as the revision when building a set by hand. The
  server allows accepting, editing, merging, removing, adding and prioritising, and nothing else: a stakeholder
  is never deleted (`400 STAKEHOLDER_MISSING`), who found it is the sources' and not the person's
  (`STAKEHOLDER_ORIGIN_LOCKED`), nor is its evidence: a quotation can be taken away but not added
  (`EVIDENCE_NOT_VERIFIED`) and no field of it can be rewritten, whole reference by whole reference
  (`EVIDENCE_ALTERED`), a merge names a removed stakeholder and the one it went into
  (`MERGE_INVALID`), and any change to an approved set takes the approval away. Other refusals:
  `STAKEHOLDER_ID_DUPLICATE`, `STATUS_INVALID`, `RELATION_INVALID`, and `409 STAKEHOLDERS_NOT_FOUND` for a
  review of a set that does not exist.
- **Approving.** `POST .../stakeholders/approve` takes `{ "expectedRevision" }` (30 a minute). It needs two
  stakeholders left (`409 STAKEHOLDERS_TOO_FEW`), no blocking check of the participants open
  (`409 PARTICIPANTS_INVALID`, which says what to fix) and turns the ones still proposed into accepted.
- **Participants.** `POST .../stakeholders/propose` proposes the decision's participants, each with a role,
  what it is assumed to want and could do, what is never asserted about it and what its place rests on, and
  answers with the set and its `review` (`valid`, `summary`, `counts`, `coverage[]`, `issues[]`, each issue
  `blocking` or `advisory`). `GET .../stakeholders/validation`, `POST .../stakeholders/accept`,
  `PATCH` and `DELETE .../stakeholders/:participantId`, `POST .../stakeholders/:participantId/regenerate`,
  `GET .../stakeholders/:participantId/why`, `POST .../stakeholders/merge-duplicates` and
  `POST .../stakeholders/add-missing` are the person's way to review them; each change takes the
  `expectedRevision` the person saw and answers with the set. The method, the roles and the checks are in
  [stakeholders.md](./stakeholders.md#participants-who-decides-who-is-reached-who-is-missing).
- **Making actors.** `POST .../actors/generate` takes `{ "model"?: boolean, "confirm"?: boolean }` (10 a minute)
  and answers 201. It needs an approved set (`409 STAKEHOLDERS_NOT_APPROVED`), replaces actors the person has
  edited only with `confirm` (`409 ACTORS_EDITED`), and with `"model": true` lets a model read the key actors
  against the evidence, so the traits it sets are labelled as the model's; if it fails the category priors stand.
- **Editing actors.** `PUT .../actors` takes `{ "actors", "expectedRevision" }` (120 a minute). A trait the
  person moves becomes theirs, whatever the request says. The cast cannot gain or lose an actor, change a
  kind or a category, make a key actor larger than one, or simulate more members than a cohort stands for
  (`400 ACTORS_CHANGED`, `ACTOR_INVALID`; `409 ACTORS_NOT_FOUND` when there are none).
- **Stale writes.** A write made on an old revision is `409 ARTIFACT_CONFLICT`, and nothing is overwritten.
- **Audit.** `stakeholders.discovered`, `stakeholders.edited`, `stakeholders.approved`, `actors.generated` and
  `actors.edited`.

### Independent review

Anyone who can read the project reads the review. Running it needs `run` and responding needs `edit`. The
critics and what each checks are in [analysis/critics.md](./analysis/critics.md); a critic never edits the
analysis, the stakeholders, the actors or the brief.

- **Reading.** `GET .../critiques` answers `{ "critiques": CritiqueSet | null, "revision": number | null,
"changedSince": [...], "analysis": { "id", "completedAt" } | null, "may": { "run", "respond" }, "model": {
"available", "reason"? } }`. `revision` is the revision of the stored review, to send back with a response.
  `changedSince` names what changed since the comparison the review is of was run (`scenario`, `stakeholders`
  or `actors`, checked against what that comparison recorded) and says `a newer analysis exists` when one has
  finished; it is empty when the review still describes the project. `model.available`
  is true only when the server has a provider **and** the project was made in **Model assisted** mode; on a
  project that runs without a model `reason` says so in words ("This project runs without a model, so nothing
  is sent to one. Only the deterministic checks run.") and is `null` otherwise. `analysis` is the newest
  finished comparison, so a review of an older one can be called out of date. A set holds `analysisId`,
  `generatedAt`, `mode` (`rules`, `model` or `both`), `notes[]`, `inputRevisions` (what the review was made
  from) and `critiques[]`: each has an `id`, a `role`
  (`evidence`, `assumption`, `methodology`, `stakeholder-coverage`, `bias`, `recommendation` or
  `adversarial`), a `target`, a `severity` (`note`, `minor`, `major` or `blocking`), an `objection`, its `basis`,
  `evidence`, `origin` (`rules` or `model`), `status` (`open`, `responded`, `accepted` or `disputed`), any
  `response`, what disagreement `remains`, `impactOnConclusion` and perhaps a `requestedAction`.
- **Running.** `POST .../critiques/run` takes `{ "analysisId"?, "useModel"?: boolean }` (6 a minute) and answers
  with the review as it now is. It reviews the newest finished comparison unless an id is given, and refuses
  without one (`409 ANALYSIS_NOT_READY`). The rules run every time. With `useModel`, a digest of the analysis
  goes to the model for extra critiques, which are validated and dropped if they name something the model was
  not given; a failure (or no provider) is said in `notes`, and the rules' critiques are kept. `useModel` on a
  project that was made to run without a model is refused with `409 MODEL_NOT_AVAILABLE`, and nothing is
  sent. A review is allowed 170 seconds, and one runs at a time for a project (`409 CRITIQUES_RUNNING`).
  Running again keeps a person's earlier responses to critiques with the same id.
- **Responding.** `PUT .../critiques/:cid/response` takes `{ "text", "status": "responded" | "accepted" |
"disputed", "remainingDisagreement"?, "expectedRevision" }` (60 a minute) and answers with the review.
  `expectedRevision` is the `revision` the person was looking at: when someone else has responded, or the
  review has been run again, since, the answer is refused with `409 CRITIQUES_CHANGED` and a sentence that
  says to reload the review and answer again, so that two pages cannot silently replace each other's answer.
  `accepted` means the objection stands and its impact applies. An unknown critique is
  `404 CRITIQUE_NOT_FOUND`.
- **Audit.** `critiques.run` (counts, and whether a model was asked for and failed) and `critique.responded`
  (the critique's id, its role and the status).

### Decision brief

The brief is assembled by rules from the project's scenario, stakeholders, actors, comparison, critiques and
sources, and stored as one document; no model words any of it. Its sections, the ten origins and the rules
are in [analysis/brief.md](./analysis/brief.md). Reading needs `read`, generating needs `edit` and exporting
needs `export`.

- **Reading.** `GET .../brief` answers `{ "brief": DecisionBrief | null, "visuals": BriefVisuals | null,
"visualsFrom": "snapshot" | "current" | null, "latestAnalysis": { "id", "completedAt" } | null,
"changedSince": [...], "may": { "generate", "export" } }`.
  `brief` holds `generatedAt`, `analysisId`, `question`, `headline`, the 17 `sections[]` (each `statements[]`
  with an `id`, `text`, one `origin`, the `refs` it rests on and a `reliance`), `recommendations[]`,
  `validationPlan[]`, `limitations[]`, `fidelity`, `methodology`, `openCritiques` (how many critiques of this
  comparison are not yet closed: open, responded or disputed, anything but accepted; the page and the exports
  call them "critiques not yet closed"), `generatedBy`, `signal`
  (`clear`, `no-direction` or `no-difference`, which says whether the comparison can be read as a result about
  the change) and `inputRevisions`. `visuals` is the data of the charts as it was when the brief was made,
  kept with it, so it agrees with the brief's own words (`visualsFrom: "snapshot"`); a brief stored before
  that was kept has it worked out from the project's documents as they are (`"current"`). `changedSince`
  names what changed after the brief was made or after the comparison it rests on was run, and is empty when
  it is current: `scenario`, `stakeholders` and `actors` are checked against the revisions the comparison
  recorded (`analysis.inputRevisions`), so writing the brief again from an old comparison does not clear
  them; `critiques`, `analysis`, `analysis (no longer stored)` and `a newer analysis exists` are checked
  against the brief itself. A comparison saved before it recorded what it was made from adds
  `what the comparison was made from was not recorded`, which does not clear.
- **Writing.** `POST .../brief` takes `{ "analysisId"?: string }` (20 a minute), uses the newest finished
  comparison unless one is named, replaces any earlier brief and answers 201 with the view. A comparison that
  was run before the scenario, the stakeholders or the actors changed is still written from, and the brief
  says so in its methodology notes. Refusals:
  `409 NO_ANALYSIS`, `409 ANALYSIS_NOT_COMPLETED`, `409 ANALYSIS_EMPTY`, `404 ANALYSIS_NOT_FOUND`.
- **Exporting.** `GET .../brief/export?format=md|json|html` (20 a minute; `md` is the default) answers a
  Markdown or JSON attachment, or a printable page (`inline`, with a `Content-Security-Policy` of
  `default-src 'none'`, so it can load and run nothing). All three say that the brief explores scenarios and
  does not predict, and all three carry the freshness: when `changedSince` is not empty each leads with a
  warning that names it and the revisions the brief was made from beside the ones the project holds now, and
  the JSON has `changedSince`, `warning`, `provenance.currentRevisions` and `provenance.dataFrom`. The tables
  and `data` are the snapshot kept with the brief, not the project as it is at the export (a brief stored
  before the snapshot was kept says so). Another format is `400`, and exporting before one is written is
  `409 BRIEF_NOT_GENERATED`.
- **Audit.** `brief.generated` and `brief.exported`.

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

Reading a public web page: `POST /api/evidence/url` with `{ "url": "https://…" }` (the body may be 8 KB;
10 a minute; needs the right to create a project in the workspace) returns
`{ "document": { "name", "content", "provenance" }, "notes": [...] }`, a document that can be sent
as one of a project's `documents`. `provenance` is `{ "kind": "url", "url", "finalUrl", "retrievedAt",
"contentType", "sha256", "title", "fetchedByServer": true }`, with secret-looking query values removed from
both addresses. A failure is a 4xx with a code that starts `URL_` and a message that ends
with "You can paste the text instead.": `400 URL_INVALID` for something that is not a web address Swarm can
read, `403 URL_INGESTION_DISABLED` when `URL_INGESTION=off`, `503 URL_BUSY` with a `Retry-After` when this server
is already reading as many pages as it allows (`URL_INGEST_CONCURRENCY`), and `422` for the rest (`URL_BLOCKED`,
`URL_PORT_NOT_ALLOWED`, `URL_UNSUPPORTED_TYPE`, `URL_TOO_LARGE`, `URL_TIMEOUT`, `URL_TOO_MANY_REDIRECTS`,
`URL_ROBOTS_DISALLOWED`, `URL_NO_TEXT`, `URL_FETCH_FAILED`). A name that leads inside a network is answered
exactly as a name that does not exist (`URL_FETCH_FAILED`, "could not find … on the public web"), so that the
answer cannot be used to learn which names are in use there. The page's own text is what is kept: a web page's
menus, side panels and footers are left out as a guess from how it is built, and `notes` says so. The audit entry
`evidence.url.fetched` holds the host and nothing else, and an address that is refused (`URL_BLOCKED`,
`URL_PORT_NOT_ALLOWED`, `URL_INVALID`) is recorded as `evidence.url.refused` with the host asked for and the code.
What is fetched, how, and what is not promised is in [URL ingestion](./security/url-ingestion.md).

Surveys take `{ "kind": "state" | "interview", "question": "...", "agentIds": [...] }`.
Poll the project's `console.surveys` until completion. Local state snapshots have
`answer: null`; generated answers are only produced by real model calls.
