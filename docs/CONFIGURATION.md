# Configuration, providers, storage and limits

Back to the [README](../README.md). The quick-start commands are there; this page is the reference.

## Environment variables

Copy [.env.example](../.env.example) locally. Never commit the resulting `.env`
or paste keys into chat/source files. Server configuration is never bundled into
the browser. The default is `AI_PROVIDER=none`.

| Variable                                | Purpose                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`, `PORT`                          | API bind address/port; defaults to loopback and 3001                                                                                                                                                                                                                                                                                                                 |
| `DATA_DIR`                              | SQLite storage directory, relative to the process working directory                                                                                                                                                                                                                                                                                                  |
| `DATABASE_URL`                          | Optional `postgres://user@host:5432/database`. When set, PostgreSQL replaces the SQLite file (see [PostgreSQL](#postgresql)). The password goes in `PGPASSWORD`, not here                                                                                                                                                                                            |
| `DATABASE_AUTH`                         | `password` (default) or `entra`: authenticate to PostgreSQL with a Microsoft Entra access token instead of a password                                                                                                                                                                                                                                                |
| `ALLOWED_ORIGINS`, `ALLOWED_HOSTS`      | Explicit browser-origin and HTTP-host allowlists. The two probe routes, `/api/health/live` and `/api/health/ready`, answer for any host, because a platform's probe sends the replica's own address                                                                                                                                                                  |
| `LOG_LEVEL`                             | Server log level; request bodies and credentials are not logged                                                                                                                                                                                                                                                                                                      |
| `AI_PROVIDER`                           | `none`, `ollama`, `openai`, or `azure`                                                                                                                                                                                                                                                                                                                               |
| `AI_MODEL`                              | Local/remote model name; Azure deployment name for `azure`                                                                                                                                                                                                                                                                                                           |
| `AI_TIMEOUT_MS`                         | Per-model-request timeout                                                                                                                                                                                                                                                                                                                                            |
| `OLLAMA_BASE_URL`                       | Administrator-configured local Ollama endpoint                                                                                                                                                                                                                                                                                                                       |
| `DOCKER_OLLAMA_BASE_URL`                | Compose-only address of Ollama running on the host                                                                                                                                                                                                                                                                                                                   |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`     | Trusted compatible v1 endpoint and server-side key                                                                                                                                                                                                                                                                                                                   |
| `AZURE_OPENAI_ENDPOINT`                 | Azure resource/v1 endpoint (must be an Azure AI host)                                                                                                                                                                                                                                                                                                                |
| `AZURE_OPENAI_AUTH`                     | `entra` (default; no key) or `key` (legacy API-key authentication)                                                                                                                                                                                                                                                                                                   |
| `AZURE_CLIENT_ID`                       | Client id of a user-assigned managed identity; empty for `az login` or a system-assigned identity                                                                                                                                                                                                                                                                    |
| `AZURE_OPENAI_API_KEY`                  | Read only when `AZURE_OPENAI_AUTH=key`                                                                                                                                                                                                                                                                                                                               |
| `SOURCE_URL`                            | Public corresponding source for the exact remotely deployed version                                                                                                                                                                                                                                                                                                  |
| `AUTH_MODE`                             | `none` (default): one local user, no sign-in. `entra`: every API call needs a Microsoft Entra access token (see [Sign-in](#sign-in-and-tenants))                                                                                                                                                                                                                     |
| `AUTH_ENTRA_TENANT_ID`                  | Tenant whose tokens are accepted; required when `AUTH_MODE=entra`                                                                                                                                                                                                                                                                                                    |
| `AUTH_ENTRA_ALLOWED_TENANTS`            | Optional comma-separated tenant GUIDs to accept as well                                                                                                                                                                                                                                                                                                              |
| `AUTH_ENTRA_AUDIENCE`                   | Application ID URI or client ID that tokens must be issued for; required when `AUTH_MODE=entra`                                                                                                                                                                                                                                                                      |
| `AUTH_ENTRA_JWKS_URI`                   | Optional HTTPS override of Microsoft's signing-key endpoint                                                                                                                                                                                                                                                                                                          |
| `AUTH_ENTRA_CLIENT_ID`                  | Client id of the Entra app registration people sign in with. With `AUTH_ENTRA_REDIRECT_URI`, turns on browser sign-in (see [below](#browser-sign-in))                                                                                                                                                                                                                |
| `AUTH_ENTRA_REDIRECT_URI`               | Where Microsoft sends the browser back: `https://<host>/auth/callback` (plain `http` only on localhost). Its host must be in `ALLOWED_HOSTS`                                                                                                                                                                                                                         |
| `AUTH_ENTRA_CLIENT_SECRET`              | Only for a confidential client. From a secret store or the environment, never from a file in the repository                                                                                                                                                                                                                                                          |
| `AUTH_ENTRA_CLIENT_ASSERTION`           | `managed-identity`: prove the application to Entra with a token from its managed identity (workload identity federation) instead of a secret, so nothing is stored. Needs a federated credential on the app registration. Not together with a secret                                                                                                                 |
| `TRUST_PROXY`                           | How many reverse proxies in front of the server to trust for the caller's address (default 0, max 5). Behind one ingress set 1; never when the port is reachable directly                                                                                                                                                                                            |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Switches on OpenTelemetry export to Application Insights, signed with Microsoft Entra (see [observability](./operations/observability.md)). Unset: nothing is exported. `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG` and `OTEL_METRIC_EXPORT_INTERVAL` tune it                                                                                                     |
| `SWARM_ROLE`                            | `all` (default): serve requests and run jobs. `api`: serve requests and only queue jobs. `worker`: run jobs from the queue and answer health probes (see [Jobs and workers](#jobs-and-workers))                                                                                                                                                                      |
| `JOB_LEASE_SECONDS`                     | How long a worker may go without a heartbeat before its job is handed to another worker (default 30, 10–600)                                                                                                                                                                                                                                                         |
| `PROJECT_MODEL_CALL_LIMIT`              | Most model calls one project may make in all, unless a workspace owner or administrator gives it a limit of its own (default 0: no limit; up to 1,000,000,000). A call is counted when the provider answers. Once a project has used it, the next call is refused with `PROJECT_BUDGET` before anything is sent ([ADR 0013](./adr/0013-per-project-model-budget.md)) |
| `PROJECT_MODEL_TOKEN_LIMIT`             | Most tokens, input and output together, one project may use in all (default 0: no limit). Checked between calls, so a call that starts under it may finish over                                                                                                                                                                                                      |
| `URL_INGESTION`                         | `on` (default) or `off`. Whether a person may add a public web page as evidence by pasting its address. This server fetches it, and only from public addresses ([URL ingestion](./security/url-ingestion.md)). `GET /api/config` reports it as `urlIngestion`                                                                                                        |
| `URL_INGEST_ALLOWED_PORTS`              | Comma-separated ports a page may be read from (default `80,443`)                                                                                                                                                                                                                                                                                                     |
| `URL_INGEST_MAX_BYTES`                  | Most bytes read from one page, before and after decompression (default 1,500,000; 10,000–5,000,000)                                                                                                                                                                                                                                                                  |
| `URL_INGEST_TIMEOUT_MS`                 | Time allowed for a whole fetch: lookups, redirects, `robots.txt` and the page (default 12,000; 1,000–25,000)                                                                                                                                                                                                                                                         |
| `URL_INGEST_ALLOWED_HOSTS`              | Optional comma-separated hosts that may be read: `example.com` exactly, or `*.example.com` for its subdomains. Empty (default): any public host                                                                                                                                                                                                                      |
| `AUTH_SESSION_IDLE_MINUTES`             | A session ends after this many minutes without a request (default 30, 5–480)                                                                                                                                                                                                                                                                                         |
| `AUTH_SESSION_ABSOLUTE_HOURS`           | A session ends this many hours after sign-in however busy the person is (default 8, 1–24)                                                                                                                                                                                                                                                                            |
| `RATE_LIMIT_SCALE`                      | Integer 1–1000 multiplying every per-IP request limit (default 1). Raise it only for automated browser or load tests of your own machine                                                                                                                                                                                                                             |

If you explicitly configure origin/host allowlists, update them when changing
ports or domains. Defaults use the configured API port and local Vite port.
Provider status means configuration exists, not that the service has been reached
or its output quality verified. Restart the backend after changing environment variables.

## Sign-in and tenants

With the default `AUTH_MODE=none` there is one local user and no sign-in, so the server must only
listen on a loopback address (the default). It logs a warning if it is bound to every interface.

With `AUTH_MODE=entra` the server fails to start unless `AUTH_ENTRA_AUDIENCE` and a tenant are
configured, and then requires `Authorization: Bearer <Microsoft Entra v2.0 access token>` on every
`/api` call except `/api/health` (or, with [browser sign-in](#browser-sign-in), a session cookie). A token is accepted only if its signature, issuer (derived from the
token's own tenant, which must be one you listed), audience, expiry and object id check out. Every
failure returns the same 401, so a caller learns nothing about which check failed.

Assign people one of the app roles `Swarm.User`, `Swarm.Reader`, `Swarm.Analyst`, `Swarm.Reviewer`
or `Swarm.Admin`. **They only let a person in**: a token with none of them is refused, and with one
the person can sign in and see nothing until they are added to a workspace or a project. What they
may then do comes from their role there, not from the app role:

| Role                   | Where                          | May                                                                |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Platform Administrator | app role `Swarm.PlatformAdmin` | Run a paid model check and verify the audit chain. Sees no project |
| Workspace Owner        | workspace membership           | Everything in the workspace, and grant or remove owners            |
| Workspace Admin        | workspace membership           | Everything in the workspace except the owners                      |
| Project Lead           | project membership             | Read, export, review, run, chat, delete and share the project      |
| Analyst                | project membership             | Read, export, run, branch, ask the analyst and the actors          |
| Reviewer               | project membership             | Read, export, review statements and conflicts. Never runs          |
| Viewer                 | project membership             | Read and export                                                    |

Any workspace member can create experiments and leads them. A workspace with no owner is claimed by
the first person to call it who holds `Swarm.Admin`; after that the app role confers nothing, and an
owner adds the others from the **People** screen in the header and each project's **Access** screen (or
through `PUT /api/workspace/members/:principalId` and `PUT /api/projects/:id/members/:principalId`; see
the [HTTP API](./API.md)), naming each person by their Entra object ID. Membership is read on
every request, so removing someone takes effect on their next call.
[ADR 0007](./adr/0007-workspace-and-project-membership.md) has the full rules and what they cost.

A tenant is the workspace boundary. People see only the experiments they were added to, an owner or
admin sees all of their workspace's, and an experiment in another tenant, or one they were not added
to, is reported as not found, exactly as one that does not exist. Counts, project limits and audit
entries are kept per tenant. The authorisation table is one file,
[`backend/src/auth/policy.ts`](../backend/src/auth/policy.ts), and a test fails if any API route lacks
an entry (a route with no entry is refused).

## Browser sign-in

Set `AUTH_ENTRA_CLIENT_ID` and `AUTH_ENTRA_REDIRECT_URI` (both, or neither) with `AUTH_MODE=entra`, and
the page sends a person who is not signed in to Microsoft and brings them back signed in. The server
does the whole exchange: it uses the Authorization Code flow with PKCE, keeps the verifier to itself,
reads only the ID token that comes back (checking its signature, issuer, audience, expiry, tenant
allow-list and the nonce it started with), and then discards everything from Microsoft. The browser is
given one opaque, random session identifier in a cookie it cannot read from script (`HttpOnly`,
`SameSite=Lax`, `Secure` and `__Host-` prefixed on https). Only a hash of that identifier is stored.
No access token, refresh token or ID token reaches the browser, the database or a log.

- A session ends after 30 minutes without a request, or 8 hours after sign-in, whichever comes first
  (both configurable). **Signing out** ends it on the server, and removing someone from the workspace
  ends their sessions at once.
- A change made with the cookie must also carry `X-Swarm-CSRF: 1` and come from an allowed origin; the
  page does this itself, and another site cannot make a browser add the header. A bearer token needs
  neither, because a browser does not send one unasked.
- A bearer token, when sent, is the only credential considered: a bad token is not rescued by a cookie.
  With neither, an `/api` call is `401 SIGN_IN_REQUIRED`; there is no fall-back to the local user.
- Anything that goes wrong while signing in sends the browser back to the page with the same message
  (`/?signin=failed`), and a person who signed in but holds no Swarm app role sees `/?signin=norole`.
  The reason is logged as a short code only.
- `scope` is `openid profile`: no API access and no `offline_access`, so no refresh token exists.
- The roles in an Entra token (platform administrator in particular) are read once, at sign-in, so
  removing `Swarm.PlatformAdmin` takes effect when the session ends, within the limits above.
  Workspace and project membership are read from the database on every request.

Setting this up needs an app registration in your Entra tenant with the redirect address above as a
**Web** platform and the Swarm app roles; creating one needs a tenant administrator, so it is not
something this repository can do for you. The code is tested against a local test identity provider
that signs real tokens. **It has not yet been run against a real tenant.**

What this does **not** do yet: no directory lookup (the screens take an Entra object id and cannot say who it belongs to), no groups from a directory sync, no invitations by name or email, one workspace per tenant, and no per-tenant data keys. Who may use the workspace is managed from the browser (**People** in the header, for a workspace owner or administrator) and who may use a project from **Access** on the project (for a project lead, or an owner or administrator), or through the [HTTP API](./API.md); the screens offer only what the server would allow and enforce nothing themselves. Existing
experiments from a local install belong to the tenant `local` and are not visible to any Entra user.
See `docs/program/risk-register.md`.

## Model providers

### Ollama (optional, no paid API)

Install Ollama separately, start its service, and download a model suitable for
your available RAM, for example `ollama pull qwen3:8b`. Model weights are a separate
download and retain their own license. Configure:

```dotenv
AI_PROVIDER=ollama
AI_MODEL=qwen3:8b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Restart the backend. Local engine mode still does not call Ollama. JSON generation
quality, hardware capacity, context limits and inference speed vary by model.

### Azure OpenAI / Microsoft Foundry (Microsoft Entra ID, no key)

The default Azure mode needs no secret at all. In your local, ignored `.env` set
`AI_PROVIDER=azure`, `AI_MODEL` to the **deployment** name and `AZURE_OPENAI_ENDPOINT`
to your resource root or `/openai/v1/` endpoint, then run `az login`. The server
obtains a Microsoft Entra token (`DefaultAzureCredential`; a managed identity in
Azure) and sends it only to an allow-listed Azure AI host. Your identity needs the
**Cognitive Services OpenAI User** role on the resource, and a missing role produces
an error that names it.

To create the resource and deployment from this repository (Bicep with keys disabled,
a pay-as-you-go model chosen from live quota data, a strictly gated deploy) see
[AZURE.md](./AZURE.md#provisioning-the-model-account-with-this-repository):
`npm run azure:provision -- --subscription <guid> --preflight-only` is read-only and
tells you exactly which permission is missing if you cannot deploy.

Verify with a real round trip, never an assumption: `POST /api/provider/check` or the
**Verify connection** button in the header. The badge and the entry readiness card read
`connected` only after a real request has succeeded (that check, or any model
operation since the server started) and `failing` after one has failed. To prove the whole journey (per-proxy calls, grounding, branch,
chats, injection probe, no credential leakage) run `npm run azure:verify`; it exits `0`
only if every check passes against the configured provider
([details](./AZURE.md#verifying-the-live-integration)). Legacy key authentication remains available with
`AZURE_OPENAI_AUTH=key` and `AZURE_OPENAI_API_KEY`; never put a key in frontend
variables. The v1 API does not require a dated `api-version` query parameter.

> **Status:** verified live on 28 Oct 2026 against one development deployment (Entra
> only, no key): `npm run azure:verify` passed 15 of 15 checks in three consecutive
> runs. Not verified: a managed identity, hosted Azure, and anything beyond that one
> small model. See [Live evidence](./AZURE.md#live-evidence) for what was
> measured, what failed on the way and the open risks.

### Other OpenAI-compatible providers

Set `AI_PROVIDER=openai`, `AI_MODEL`, `OPENAI_BASE_URL` (including the v1-compatible
base path), and `OPENAI_API_KEY`. The endpoint must support JSON Chat Completions.
Only administrator-controlled configuration can select endpoints; input documents
cannot request arbitrary URLs or tools.

## Storage and backup

SQLite is stored in `data\swarm-lab.sqlite` by default, with local WAL/SHM files.
Sources, graph, personas, recorded rounds, reports, events and conversations persist
there, including guided stages, separate platform states, synthetic memory, tool
traces and survey progress. Original PDF bytes are not retained: the stored source
is extracted text plus page-count metadata. No API keys are stored in the database.
Data is plain text at rest, not
application-encrypted, and is excluded from Git.

Use one application process per database. Prefer a normal local disk rather than
a network drive or a cloud-synchronized directory (OneDrive, Dropbox, Google Drive,
iCloud Drive). Synchronization clients can lock or conflict with SQLite's write-ahead
files, and would upload your source documents and results to that service, which
contradicts the local-only behavior described in this README. The server detects
these folders in the resolved database path, logs a warning at startup and shows a
warning in the console's readiness card. Windows' Desktop and Documents are often
redirected into OneDrive, so a default `.\data` inside such a project folder is
affected. Keep the data elsewhere, for example:

```powershell
$env:DATA_DIR = Join-Path $env:LOCALAPPDATA 'SwarmLab'
npm.cmd start
```

or set `DATA_DIR` once in your local `.env`. Note that a synchronized project folder
also synchronizes its `.env`: if it will hold API keys, keep the project outside the
synchronized folder or set those variables in your user environment instead.

An environment variable takes precedence over `.env`. Stop the server before
copying the complete data directory to a private backup location. Do not copy an
actively changing SQLite file alone, use a network filesystem for WAL, or commit
backups containing source material. JSON exports are portable inspection records,
not an implemented automatic database-import format.

### PostgreSQL

A hosted deployment, or anything that more than one instance shares, should use PostgreSQL instead
of the SQLite file. Set a connection URL; every other setting is the same, and the stores behave the
same ([ADR 0009](./adr/0009-postgres-through-a-synchronous-bridge.md)):

```powershell
$env:DATABASE_URL = 'postgres://swarm@db.example.internal:5432/swarm'   # TLS is on unless the host is localhost
$env:PGPASSWORD   = '<from a secret store>'                              # or put it in the URL
npm.cmd start
```

With `DATABASE_AUTH=entra` there is no password at all: the server asks Microsoft Entra for an access
token for each connection (`DefaultAzureCredential`: a managed identity when hosted, `az login` on a
laptop) and presents it as the password, and the URL names the database user the identity maps to.
The migrations run at start, take an advisory lock so that instances starting together take turns,
and refuse a database written by a newer release. Transactions are serializable and retried when
they lose a race.

Limits to know about: the process waits for each query (a synchronous bridge, so one query at a
time per process), tenant isolation is application-level with no row-level security, and the code has
been run against PostgreSQL in-process and over the wire protocol but **not against a deployed Azure
server**. Backups of a hosted server are the service's own (Azure Database for PostgreSQL keeps
automated backups with point-in-time restore; configuring and testing that is part of the
deployment, not of this repository).

**Moving an existing installation, or taking a logical backup,** is one command that copies in either
direction and checks what it did:

```powershell
npm.cmd run db:copy -- --from .\data\swarm-lab.sqlite --to postgres://swarm@db.example.internal:5432/swarm
npm.cmd run db:copy -- --from postgres://swarm@db.example.internal:5432/swarm --to .\backup\swarm.sqlite
```

The destination must be empty. The copy is one transaction and is kept only if every table's row count
matches and the audit chain verifies in the destination; sign-in state is not copied. To restore, copy
the other way into an empty database. Targets are never printed, because a URL can hold a password.

**Rehearsing a restore** is one more command, and it changes nothing it is pointed at:

```powershell
npm.cmd run db:drill -- --from .\data\swarm-lab.sqlite
npm.cmd run db:drill -- --from postgres://swarm@db.example.internal:5432/swarm
```

It backs the database up into a scratch SQLite file, makes a new database from that file alone, and
checks that what came back is what went in: every table by digest (so a changed value is noticed, not
only a missing row), the audit chain, every project opened as the application opens it, and the next
audit entry following the last. A SQLite file may be in use while it runs (it is read as a snapshot). It
exits non-zero if the restore is not exact. It rehearses this logical path; restoring a hosted server to
a point in time is the platform's, and has to be rehearsed where it runs.

**Before an upgrade of a SQLite file,** the application copies it to `<file>.v<N>.bak` (N is the schema
version it was at). A copy that is out of date is never reused or overwritten: it is set aside as
`<file>.v<N>.<time>.bak` and a new one is taken. See "Roll back" in the [runbook](./operations/runbook.md).

## Jobs and workers

Every stage of a run (`knowledge`, `environment`, `simulation`, `report`, or a quick run) is a **job**
in the database, not a task in the memory of one process ([ADR 0010](./adr/0010-durable-jobs-leased-from-the-database.md)).
What that means in practice:

- **A refresh or an API restart does not touch a run.** The run is on the server, and a restarted
  process finds the queue as it was. Starting up does not mark a run failed while a job owns it.
- **One worker holds a job at a time**, by a lease it renews every quarter of `JOB_LEASE_SECONDS`. If
  it stops (a crash, a stall, a lost network) the lease runs out and the job goes back to the queue,
  to be tried again after a wait that doubles from 15 seconds to five minutes and is spread at random.
  A job gets three attempts (a quick run, one); after that it is set aside as `failed` with
  `JOB_POISONED`. A worker that was only slow learns on its next write that it lost the job, and stops.
- **A simulation continues from its last saved round** when it is run again; it does not compute the
  rounds again. The other stages run again from the start.
- **A provider failure that may pass** (`MODEL_UNREACHABLE`, `MODEL_TIMEOUT`, `MODEL_RATE_LIMIT`) is
  retried by the queue only for a simulation with saved rounds. Any other failure is shown as it is.
  A simulation that fails with saved rounds is recorded as `partial`, and can be resumed.
- **Stopping the backend hands the job back** to the queue without using an attempt, and the run
  shows as queued until a worker takes it. A job that waited more than two hours is expired instead of
  being started late.
- **Cancel and pause work across processes.** The request is written on the job and the worker reads
  it at its next heartbeat; a run that had not started is stopped at once.
- **Asking twice is one job** when the request carries the same `Idempotency-Key` header (8–128 letters,
  digits and `-_.:`). Without the header every request is its own job.

`SWARM_ROLE` splits the work for a hosted deployment: run some processes as `api` and others as
`worker` against one PostgreSQL database. The SQLite file is for one process, so use `all` with it. A
`worker` still answers the health probes and serves the whole API, so keep user traffic away from it.
`GET /api/projects/:id/jobs` lists the newest jobs of a project (state, attempt, error code) without
the identity of the worker or the key. `/api/health` shows the queue's counts and the age of the oldest
waiting job on a local, unauthenticated server.

## Deliberate resource limits

| Item                      | Limit                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source documents          | 1–10 UTF-8 TXT/MD/Markdown/CSV/JSON files, text PDFs, public web pages, or pasted notes                                                                                                                                                                                                                               |
| Document size             | 80–40,000 characters each; 200,000 total                                                                                                                                                                                                                                                                              |
| PDF extraction            | 2 MB / 40 pages / 40,000 characters; one isolated worker, 10 seconds, 192 MB old-generation heap                                                                                                                                                                                                                      |
| CSV and JSON files        | 2 MB each, read as text on the server: at most 500 rows and 50 columns of a table, 8 levels and 4,000 lines of JSON, then cut to 40,000 characters with a notice in the text                                                                                                                                          |
| Web page                  | Read by the server: 1.5 MB before and after decompression, 12 seconds in all, 5 redirects, ports 80 and 443, 40,000 characters of text; the settings are `URL_INGEST_*`                                                                                                                                               |
| HTTP request body         | 600 KB normally; 2.7 MB encoded extraction request                                                                                                                                                                                                                                                                    |
| Local population / rounds | 4–24 agents / 3–24 rounds                                                                                                                                                                                                                                                                                             |
| Model population / rounds | 4–10 agents / 3–10 rounds                                                                                                                                                                                                                                                                                             |
| Work queue                | One active execution stage per worker, three waiting for any worker; the queue is in the database, so a restart keeps it                                                                                                                                                                                              |
| Execution deadline        | 15 minutes per stage; five minutes per asynchronous survey                                                                                                                                                                                                                                                            |
| Model context / response  | 48,000 serialized input characters / 256 KB response                                                                                                                                                                                                                                                                  |
| Provider retries          | Network errors and 5xx: at most three HTTP attempts. Throttling (429): up to six, each honoring a bounded Retry-After; a truncated reply is retried once or twice with a larger output budget (all counted against the stage's call budget)                                                                           |
| Model stages              | One provider call per proxy per platform per round, four at a time (at most 10 × 2 × 10 = 200), plus about 4 setup calls and about 8 report/grounding calls. Each stage has a hard budget: 16 for knowledge/environment, `1.5 × workload + 12` for simulation, 40 for the report. Corrective retries count against it |
| Follow-ups                | One active chat/survey globally; 30 chat exchanges and five surveys per scenario; at most five survey targets                                                                                                                                                                                                         |
| Model budget per project  | Calls and tokens for the life of a project, each 0 for no limit: `PROJECT_MODEL_CALL_LIMIT` and `PROJECT_MODEL_TOKEN_LIMIT` set the default, and a workspace owner or administrator may give one project its own; the pilot template defaults to 1,500 calls and 4,000,000 tokens                                     |
| History                   | 100 experiments; export/delete old ones explicitly                                                                                                                                                                                                                                                                    |
| API rate limits           | 120 requests/minute/IP; create 20, quick run 6, guided step 8, PDF/chat 10, web page 10, survey 5/minute/IP                                                                                                                                                                                                           |

Recorded model calls count successful provider envelopes, not failed HTTP attempts.
Token counts are stored only when reported by the provider; zero does **not**
establish zero usage or cost. Source excerpts and conversation context are bounded
and may omit material from long inputs.
Retries, repeated stage attempts and follow-ups are additional consumption.
The same prepared fictional proxies are copied into each platform; combined
inclination averages each proxy across platforms, not an enlarged independent
population. The initial-post stance/strength controls are explicit assumptions;
nonzero strength influences the first local round, not an inferred sentiment score.
