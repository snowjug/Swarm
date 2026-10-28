# HTTP API

Back to the [README](../README.md).

All browser requests are same-origin. During development Vite provides the proxy.
Errors are non-2xx JSON: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
Some not-found/rate-limit responses omit `requestId`; no provider error body is returned.

| Method       | Path                                             | Behavior                                                                                                             |
| ------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| GET          | `/api/health`                                    | Actual process/storage/queue readiness, not model connectivity                                                       |
| GET          | `/api/config`                                    | Safe capabilities, limits and provider status; no key or private endpoint                                            |
| GET          | `/api/provider/status`                           | Mode, provider, model, auth type, connectivity, call and token counters, last error code; never a host, key or token |
| POST         | `/api/provider/check`                            | One explicit real model round trip (rate limited); 503 when no provider is configured, never a local fallback        |
| GET / POST   | `/api/projects`                                  | Paginated history / validated draft creation                                                                         |
| GET / DELETE | `/api/projects/:id`                              | Full persisted detail / delete non-active experiment                                                                 |
| POST         | `/api/projects/:id/run`                          | Queue a draft/failed/cancelled experiment; returns 202                                                               |
| POST         | `/api/projects/:id/steps/:step`                  | Queue `knowledge`, `environment`, `simulation` or `report`, with real prerequisites; returns 202                     |
| PATCH        | `/api/projects/:id/environment`                  | Edit a prepared environment before simulation begins                                                                 |
| POST         | `/api/projects/:id/steps/simulation`             | With body `{ "resume": true }`: continue from the last saved round (paused, failed or cancelled with saved rounds)   |
| POST         | `/api/projects/:id/pause`                        | Pause a queued/running simulation at the last saved round (non-error `paused` state); returns 202                    |
| PUT          | `/api/projects/:id/intervention`                 | Schedule (`Intervention` JSON) or remove (`null`) the one future intervention while paused                           |
| POST         | `/api/projects/:id/branches`                     | Create an independent scenario from a checkpoint with declared assumption changes; returns 201                       |
| GET          | `/api/projects/:id/compare?with=<id>`            | Per-round metrics, deltas, lineage and honesty notes for two guided scenarios                                        |
| POST         | `/api/projects/:id/cancel`                       | Cancel waiting work or request active cancellation                                                                   |
| POST         | `/api/documents/extract`                         | Validate/base64-decode and isolate bounded local PDF extraction                                                      |
| GET          | `/api/projects/:id/evidence?query=...`           | Sparse-vector search; exact `S1`-style citation lookup                                                               |
| GET          | `/api/projects/:id/evidence`                     | Explicit unranked browsing of this project's bounded passages                                                        |
| GET / POST   | `/api/projects/:id/chat`                         | Read target conversation / perform a bounded follow-up                                                               |
| GET          | `/api/projects/:id/memories?query=&platform=all` | Search/browse this scenario's explicitly synthetic memories; exact memory IDs supported                              |
| POST         | `/api/projects/:id/surveys`                      | Queue a bounded state snapshot or model-interview survey; returns 202                                                |
| POST         | `/api/projects/:id/surveys/:surveyId/cancel`     | Request cancellation of an active survey                                                                             |
| GET          | `/api/projects/:id/export?format=markdown`       | Escaped, source-linked report                                                                                        |
| GET          | `/api/projects/:id/export?format=json`           | Snapshot, chunks and conversation export                                                                             |

Search with no matching terms returns an empty list, not arbitrary “relevant”
sources. Empty-query browsing is a distinct unranked operation (scores are zero).
Creation and result shapes are defined in [shared/types.ts](../shared/types.ts).
Chat POST takes `{ "target": "report" | "agent-1", "message": "..." }`; GET accepts
`?target=...`. Agent IDs must belong to the selected experiment.
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
