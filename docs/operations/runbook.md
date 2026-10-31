# Incident runbook

What to do when an alert in [slo-dashboards-alerts.md](./slo-dashboards-alerts.md) fires, or someone
reports a problem. It is for the hosted pilot described in [../azure/pilot-plan.md](../azure/pilot-plan.md);
for a local run, read the server's own log. **No incident has been handled with this document: it is
written from the design and has not been rehearsed.**

Ground rules: look before you change anything; quote the `x-request-id` of a failed request (it is in the
error body and the response header); never paste a token, a connection string or a document into a ticket;
and write down what you did, in order.

## First five minutes

1. Is it up? `GET /api/health/live` and `/api/health/ready` (no sign-in needed). Live but not ready: the
   database. Neither: the container.
2. What changed? The last revision (`az containerapp revision list`), the last deployment, the last
   configuration change, the last model-deployment change.
3. Is it everyone or one caller? Count by `x-request-id` and by route template in the dashboard.
4. Is a person's data at risk? A suspected disclosure, wrong-tenant data or a leaked credential is an
   incident of its own: stop, preserve the audit log (`GET /api/projects/:id/audit`, and `GET /api/audit/verify` for the chain), and escalate
   to the security contact for the deployment.

## API errors

_Alert: API failing._ Find the error code: `swarm.http.errors` by code and route.

| Code or symptom            | Likely cause                                                                                           | Action                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_UNAVAILABLE`, 503 | The database is down or unreachable                                                                    | [Database](#database-down-or-not-ready)                                                                             |
| `INTERNAL_ERROR`, 500      | A defect                                                                                               | Take the request id, read the matching log line, roll back if it started with a deployment ([Rollback](#roll-back)) |
| `MODEL_*` from a stage     | The provider                                                                                           | [Model provider](#the-model-provider-is-failing)                                                                    |
| `RATE_LIMITED`, 429        | One address sending too much; or `TRUST_PROXY` is 0 behind the ingress, so everyone shares one address | Check `TRUST_PROXY=1`; otherwise it is the limiter doing its job                                                    |
| `HOST_NOT_ALLOWED`         | `ALLOWED_HOSTS` does not list the address people use                                                   | Fix the configuration; the probes are unaffected                                                                    |

## Database down or not ready

_Alert: not ready._ The app serves 503 on what needs the database, answers `live`, and does not restart.

1. Check the server in the portal (state, storage, connections) and the platform's incident page.
2. Check the identity: the database user is the managed identity; an Entra token problem looks like
   authentication failures in the app log, not a down server. The identity must still be the server's
   Entra administrator.
3. If the server is fine and the app still cannot reach it, restart the revision. `live` fails and
   restarts the container by itself only when the connection was lost for good.
4. If the data is damaged or lost: [restore the database](#restore-the-database).

## Jobs are stuck or slow

_Alerts: jobs not starting, lease churn._

1. `swarm.jobs.by_state`: many `queued` and none `running` means no worker. One `running` for a long time
   is a long simulation or a worker that has stalled.
2. Is a worker alive? `swarm.worker.busy` and the replica count. With `SWARM_ROLE=all` the single app is
   the worker; if its replica is stopped (scale to zero), nothing runs.
3. A stalled worker loses its job after the lease (30 s by default) and the job is retried; repeated
   `reaped-retrying` means the work itself is taking workers down (memory, a loop) or the event loop is
   blocked by a slow database (the PostgreSQL bridge waits for every query).
4. A job waits at most two hours and is then expired (`JOB_EXPIRED`) rather than run late. The person can
   start it again.
5. Cancel a run that should not continue with `POST /api/projects/:id/cancel`; it works from any replica.

## A job is set aside as poison

_Alert: poison._ The job failed on its attempts with `JOB_POISONED`: it took its worker down each time.
The project shows a failed run with its saved rounds kept. Do not retry it blindly: read the worker's log
around the lease expiries (memory limit, an unhandled error), reproduce with the same inputs, and only then
let the person resume (`POST /api/projects/:id/steps/simulation` with `{ "resume": true }`).

## The model provider is failing

_Alert: model provider failing._ `swarm.model.calls` by error code:

- `MODEL_AUTH`: the managed identity lost its **Cognitive Services OpenAI User** role on the account, or
  the account changed its authentication. Check the role assignment.
- `MODEL_RATE_LIMIT`: quota. Swarm retries within bounds and the queue retries a simulation that has
  saved rounds; raising the quota needs approval and is not done by this repository.
- `MODEL_NOT_FOUND`: the deployment name (`AI_MODEL`) is wrong or the deployment was removed.
- `MODEL_TIMEOUT`, `MODEL_UNREACHABLE`: the service or the network. Check the provider's status.

`GET /api/provider/status` shows the same without a model call; `POST /api/provider/check` makes one.

## A spike of refused requests

_Alert: denial spike._ By reason: `UNAUTHENTICATED` and `SIGN_IN_REQUIRED` are people without a session
(an expired deployment, a crawler); `FORBIDDEN` and `access.refused` entries are signed-in people
asking for what their role does not allow; `HOST_NOT_ALLOWED` and `ORIGIN_NOT_ALLOWED` are other sites or
scanners. A rise of `access.refused` from one principal across many projects is probing: read the audit
entries (`GET /api/projects/:id/audit` for each project they touched), disable the principal's access in Entra
and remove their memberships (**Remove** in the People screen, or `DELETE /api/workspace/members/:principalId`, which ends their project access and
their sessions on the next request), and escalate.

## Spend is higher than expected

`swarm.model.tokens` by day, and the per-project execution records (`modelCalls`, tokens). A single
project with unusually many calls is a person running large scenarios; a rise in `repaired` and `failed`
calls is the model returning invalid output and Swarm retrying.

Each project is held to a model budget of calls and tokens ([ADR 0013](../adr/0013-per-project-model-budget.md)).
Read it with `GET /api/projects/:id/budget` or the project's **Model budget** button, and look for
`model.budget.exhausted` in the project's audit log: that is a project that hit its limit and was refused.
To stop one project spending, a workspace owner or administrator lowers its limit there. To protect every
project, lower the deployment default (`PROJECT_MODEL_CALL_LIMIT` and `PROJECT_MODEL_TOKEN_LIMIT`; in the pilot
the Bicep parameters `projectModelCallLimit` and `projectModelTokenLimit`) and redeploy. It is per project:
many projects, or many branches, still add up, and there is no per-tenant total, no daily limit and no spend
alert, so keep watching `swarm.model.tokens`.

## Telemetry is missing

The app runs without telemetry if it could not start it; the startup log has one warning (never the
connection string). Check that `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, that the identity has
**Monitoring Metrics Publisher** on the Application Insights component, that `AZURE_CLIENT_ID` is the
identity's client id, and that the component's ingestion is not capped.

## Roll back

**Hosted (Container Apps).** Container Apps keeps revisions. Re-activate the previous revision, or
`azd deploy` the previous image tag, and run the smoke check
(`npx tsx scripts/azure/pilot-smoke.ts https://<address>`). This has not been exercised against a
deployed pilot. A schema migration is not undone by rolling the image back: migrations only add, and
an older image refuses a database that is newer than it knows (`STORAGE_VERSION`, tested). If a
migration is the problem, restore the database taken before it. PostgreSQL takes no copy of its own
before an upgrade, so take one first (`npm run db:copy`, or note the time and use point-in-time
restore).

**A SQLite file (a laptop, the demonstration, one machine).** A release that needs a newer schema
copies the file first, to `<file>.v<N>.bak`, N being the version the file was at. To go back:

1. Stop the application.
2. Delete `<file>-wal` and `<file>-shm`, so that a log written by the newer release is not applied to
   the older file.
3. Copy `<file>.v<N>.bak` over `<file>`.
4. Start the release before.

Whatever was written after the upgrade is not in the copy. The upgrade can be tried again later. If
the file has changed since the copy was taken, the next upgrade takes a new copy as
`<file>.v<N>.bak` and sets the older one aside as `<file>.v<N>.<time it was last written>.bak`; it
never overwrites a copy. If the file has not changed (an upgrade that failed and rolled back, started
again), the copy is kept as it is, so a restart loop does not fill the disk. All of this is tested
(`backend/test/rollback.test.ts`, `backend/test/storage-backup.test.ts`).

## Restore the database

**Rehearse it first.** `npm run db:drill -- --from <database>` backs a database up into a SQLite file,
makes a new database from that file alone, and proves the two are the same: every table by digest, the
audit chain, every project opened as the application opens it, and the next audit entry following the
last. It only reads the database it is pointed at (a SQLite file may be in use; it is read as a
snapshot), writes to a scratch folder that it deletes, and exits non-zero if the restore is not exact.
On the demonstration database (409 rows, 9 projects) a backup took 0.25 s, the restore 0.24 s and the
check 0.32 s. That is the logical path only; it says nothing about a hosted server.

**Hosted PostgreSQL.** Azure Database for PostgreSQL keeps automated backups (seven days in the pilot).
Restore to a new server at a point in time before the damage, copy the data back with `npm run db:copy`
if only some of it is needed, or point the app at the restored server (`DATABASE_URL`) after adding the
identity as its Entra administrator. **No restore of a hosted server has been rehearsed**: do one before
it is needed, and record how long it took and what was lost. Point `npm run db:drill` at the restored
server to check it. Verify afterwards: `GET /api/audit/verify` (a platform administrator) must report an
intact chain.

**A SQLite file.** Stop the application, delete `<file>-wal` and `<file>-shm`, and copy a backup (a
`.bak` from an upgrade, or a file written by `npm run db:copy`) over `<file>`.

## After an incident

Write down the timeline, the cause, what detected it and how long that took, what fixed it, and what would
have prevented it. Update this runbook and the alert that should have fired.
