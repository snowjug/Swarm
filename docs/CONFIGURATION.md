# Configuration, providers, storage and limits

Back to the [README](../README.md). The quick-start commands are there; this page is the reference.

## Environment variables

Copy [.env.example](../.env.example) locally if you want to change a setting; none is needed to run in
rules mode (`npm start` reads `.env` only if it exists). Never commit the resulting `.env`
or paste keys into chat/source files. Server configuration is never bundled into
the browser. The default is `AI_PROVIDER=none`.

| Variable                                | Purpose                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`, `PORT`                          | API bind address/port; defaults to loopback and 3001                                                                                                                                                                                                                                                                                                                 |
| `DATA_DIR`                              | SQLite storage directory, relative to the process working directory                                                                                                                                                                                                                                                                                                  |
| `DATABASE_URL`                          | Optional `postgres://user@host:5432/database`. When set, PostgreSQL replaces the SQLite file (see [PostgreSQL](#postgresql)). The password is better in `PGPASSWORD` from a secret store than in the URL; with `DATABASE_AUTH=password` either is accepted                                                                                                           |
| `DATABASE_AUTH`                         | `password` (default) or `entra`: authenticate to PostgreSQL with a Microsoft Entra access token instead of a password                                                                                                                                                                                                                                                |
| `ALLOWED_ORIGINS`, `ALLOWED_HOSTS`      | Explicit browser-origin and HTTP-host allowlists. The two probe routes, `/api/health/live` and `/api/health/ready`, answer for any host, because a platform's probe sends the replica's own address                                                                                                                                                                  |
| `LOG_LEVEL`                             | Server log level; request bodies and credentials are not logged                                                                                                                                                                                                                                                                                                      |
| `AI_PROVIDER`                           | `none` (default), `ollama`, `openai`, `azure` or `foundry` (Microsoft Foundry through the OpenAI-compatible v1 API, [below](#microsoft-foundry-and-model-use))                                                                                                                                                                                                       |
| `AI_MODEL`                              | Local/remote model name; the Azure or Foundry **deployment** name for `azure` and `foundry`                                                                                                                                                                                                                                                                          |
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
| `DEFAULT_ENGINE`                        | `rules` (default) or `model`: what a new question starts on, on the Ask screen. A preselection, not a requirement: every question shows "Rules only \| Model-assisted" and can be changed, and a model that is not configured is never preselected. Reported as `capabilities.defaultEngine` by `GET /api/config`                                                    |
| `URL_INGESTION`                         | `on` (default) or `off`. Whether a person may add a public web page as evidence by pasting its address. This server fetches it, and only from public addresses ([URL ingestion](./security/url-ingestion.md)). `GET /api/config` reports it as `urlIngestion`                                                                                                        |
| `URL_INGEST_ALLOWED_PORTS`              | Comma-separated ports a page may be read from (default `80,443`)                                                                                                                                                                                                                                                                                                     |
| `URL_INGEST_MAX_BYTES`                  | Most bytes read from one page, before and after decompression (default 1,500,000; 10,000–5,000,000)                                                                                                                                                                                                                                                                  |
| `URL_INGEST_TIMEOUT_MS`                 | Time allowed for a whole fetch: lookups, redirects, `robots.txt` and the page (default 12,000; 1,000–25,000)                                                                                                                                                                                                                                                         |
| `URL_INGEST_ALLOWED_HOSTS`              | Optional comma-separated hosts that may be read: `example.com` exactly, or `*.example.com` for its subdomains. Empty (default): any public host                                                                                                                                                                                                                      |
| `URL_INGEST_CONCURRENCY`                | Most pages this process reads at the same moment, for every caller together (default 8; 1–64). The per-address limit of 10 a minute still applies to each caller                                                                                                                                                                                                     |
| `URL_INGEST_QUEUE`                      | How many requests may wait for one of those places (default 8; 0–64). A request beyond that is refused at once with `503 URL_BUSY` and a `Retry-After`                                                                                                                                                                                                               |
| `URL_INGEST_QUEUE_WAIT_MS`              | How long a request may wait for a place before it is refused the same way (default 5,000; 100–15,000)                                                                                                                                                                                                                                                                |
| `AUTH_SESSION_IDLE_MINUTES`             | A session ends after this many minutes without a request (default 30, 5–480)                                                                                                                                                                                                                                                                                         |
| `AUTH_SESSION_ABSOLUTE_HOURS`           | A session ends this many hours after sign-in however busy the person is (default 8, 1–24)                                                                                                                                                                                                                                                                            |
| `RATE_LIMIT_SCALE`                      | Integer 1–1000 multiplying every per-IP request limit (default 1). Raise it only for automated browser or load tests of your own machine                                                                                                                                                                                                                             |

If you explicitly configure origin/host allowlists, update them when changing
ports or domains. Defaults use the configured API port and local Vite port.
Provider status means configuration exists, not that the service has been reached
or its output quality verified. Restart the backend after changing environment variables.

### Automatic research

Research is the first phase of grounding a project: it reads the page or site a person names, and what they
link to, as evidence ([how it works](../backend/src/research/README.md), [the routes](./API.md#automatic-research)).
It reads **https only**, from public addresses, by the rules of [URL ingestion](./security/url-ingestion.md):
there is no setting that reads plain http or a private address. These settings can only **lower** what one
run may use; a person may ask for less, never for more. Empty means the ceiling.

| Variable                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RESEARCH_ENABLED`            | `on` (default) or `off`. It also needs `URL_INGESTION=on`. `GET /api/config` reports it as `research.enabled`; with it off every start is refused with `403 RESEARCH_DISABLED`                                                                                                                                                                                                                                                                                                                                                             |
| `RESEARCH_SEARCH_PROVIDER`    | `none` (default), `wikipedia` or `brave`. Finding sources from a question alone needs a search provider, and none is on by default ([LIMITATIONS](./production/LIMITATIONS.md), A6): such a run ends `blocked`. `wikipedia` needs no key and finds background pages (English only); `brave` is the Brave Search API and needs a key. Each is sent the names and topics of the question, never the question as typed, and answers with addresses that the crawler vets like any other. `GET /api/config` reports it as `research.discovery` |
| `RESEARCH_SEARCH_API_KEY`     | The key of a provider that needs one (8–512 characters). A secret: it is in no answer, log line, error or audit row. A hosted deployment holds it as a Key Vault secret reference, never as a value. Required by `brave`, and refused where the provider does not use it (a pilot or production start says so)                                                                                                                                                                                                                             |
| `RESEARCH_SEARCH_ENDPOINT`    | Where the provider is reached when it is not at its own address, for a test double on this machine (https, or http to `127.0.0.1`/`localhost`). A pilot or production start refuses it, so that a key is never sent anywhere else                                                                                                                                                                                                                                                                                                          |
| `RESEARCH_SEARCH_TIMEOUT_MS`  | Most milliseconds one search may take (1,000–30,000; default 8,000)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `RESEARCH_MAX_PAGES`          | Most pages one run reads (1–30; a run that asks for nothing gets 12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `RESEARCH_MAX_DOMAINS`        | Most sites one run reads (1–8; a run that asks for nothing gets 4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `RESEARCH_MAX_DEPTH`          | Links followed from a starting page (0–2; a run that asks for nothing gets 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RESEARCH_MAX_BYTES_PER_PAGE` | Most bytes of one page (10,000–2,000,000)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `RESEARCH_MAX_TOTAL_BYTES`    | Most bytes one run reads (10,000–20,000,000)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RESEARCH_MAX_SECONDS`        | Most seconds one run reads for (5–300; a run that asks for nothing gets 120)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RESEARCH_MAX_COST_USD`       | Most estimated model cost of one run in US dollars (0–2; a run that asks for nothing gets 0.25). It is an estimate from `MODEL_PRICES`; 0 asks no model, and rules plan                                                                                                                                                                                                                                                                                                                                                                    |
| `RESEARCH_DOMAIN_DELAY_MS`    | Least wait between two requests to one site (250–10,000; default 1,000). A person may ask for longer, never for shorter                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RESEARCH_MAX_PAUSE_SECONDS`  | How long a run may stay paused before it ends by itself with what it has read (30–420; default 300)                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Deployment mode

A deployment says what it is, and a hosted one is refused unless it is set up to be hosted. These four
settings are read before anything else; `GET /api/config` reports `deployment` (`mode` and `label`) and `build`
(`version` and `sha`) to a signed-in caller, and the monitoring carries them as `swarm.deployment.info`.

| Variable              | Purpose                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT_MODE`     | `local` (default), `pilot` or `production`, in any case. A value that is not one of the three (an empty one included) stops the start: it is never read as `local`                                                                                                                                                                        |
| `DEPLOYMENT_LABEL`    | What the product says it is, as plain text of up to 80 characters. Unset: `LOCAL` for a local run and `PRODUCTION-CANDIDATE CONTROLLED PILOT` for a pilot. A pilot's label must say pilot and must not call itself production, generally available or public; a production deployment must give a label, and must not call itself a pilot |
| `BUILD_SHA`           | The commit the build was made from: 7 to 40 hexadecimal characters, or unset. Anything else stops a pilot or production start                                                                                                                                                                                                             |
| `ALLOW_MODEL_API_KEY` | Only the word `true` counts. It records the decision to reach a model with an API key in a **pilot**, which refuses one without it. **Production** refuses a model key whatever this says                                                                                                                                                 |

`local` adds no requirement and refuses nothing. `pilot` and `production` start only when the configuration is safe to
host, and a refusal is one error that lists every setting to fix and repeats no value: Microsoft Entra sign-in with
browser sign-in set up, an https redirect address, session limits, TLS to the database (`sslmode`), exact host and origin
lists, a trusted proxy, an Application Insights connection string, pages read over https only, no raised rate limits,
no test or demonstration switch, and a search that is safe to key (`brave` has its key, no other provider is given one,
and no search endpoint is overridden), among others. `production` is stricter where a pilot may choose: PostgreSQL, a managed
identity for the database (`DATABASE_AUTH=entra`), no model API key and no debug logging. A local run that looks hosted
still starts, and logs one warning that none of these checks ran. Every rule, with the reason for it, is in
[the guard matrix](./production/identity.md#1-deployment-modes) and in `backend/src/deployment.ts`. Nothing here has been
run in a deployed environment.

### Microsoft Foundry and model use

`AI_PROVIDER=foundry` reaches a Foundry (Azure OpenAI) resource through its OpenAI-compatible v1 API, with Microsoft
Entra ID and no key by default. It, and everything in this table, have been proved against an in-process fake of the
endpoint and **never against a live resource**; [Foundry models](./models/foundry.md) says what each setting does and what
is not verified. The variables whose names start `MODEL_` and `TELEMETRY_` apply to any provider that is not `none`; the
`FOUNDRY_` ones are read only when `AI_PROVIDER=foundry`. A name that is not valid, or a malformed JSON value, stops the
start and names the variable, never its value.

| Variable                                                                                             | Purpose                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FOUNDRY_ENDPOINT`                                                                                   | The resource root or its `/openai/v1` path, https only, on a host ending `.openai.azure.com`, `.services.ai.azure.com` or `.cognitiveservices.azure.com`. A wrong value leaves the server in rules mode and says why without repeating it |
| `FOUNDRY_AUTH`                                                                                       | `entra` (default; `AZURE_CLIENT_ID` names a user-assigned managed identity) or `key`. A key is refused by `DEPLOYMENT_MODE=production`, and by a pilot unless `ALLOW_MODEL_API_KEY=true`                                                  |
| `FOUNDRY_API_KEY`                                                                                    | Read only when `FOUNDRY_AUTH=key`; never logged, returned or exported                                                                                                                                                                     |
| `FOUNDRY_DEPLOYMENT_RESEARCH_PLANNER`, `_EXTRACTION`, `_ACTOR`, `_SCENARIO`, `_CRITIC`, `_SYNTHESIS` | The deployment for one role of a task. Each defaults to `AI_MODEL`                                                                                                                                                                        |
| `FOUNDRY_DEPLOYMENT_REASONING`, `FOUNDRY_DEPLOYMENT_FALLBACK`                                        | A deployment preferred for a task that needs reasoning, and one tried once when a task's own deployment is missing, throttled, slow or failing                                                                                            |
| `FOUNDRY_DATA_ZONE`                                                                                  | When set, every task is served only from a deployment whose profile declares this zone; an undeclared deployment is never assumed to be in it                                                                                             |
| `FOUNDRY_DEPLOYMENT_PROFILES`                                                                        | JSON, by deployment name: `reasoning`, `dataZone`, `maxContextChars`, `latency` (`fast`, `standard`, `slow`) and `structuredOutputs`. What the operator says; nothing is read from the network                                            |
| `MODEL_PRICES`                                                                                       | JSON array of `{deployment, inputPerMillionUsd, outputPerMillionUsd}` (a name, or a pattern with `*`). Swarm ships no price: a cost is an estimate from these, and a deployment with no price has an unknown cost, never zero             |
| `MODEL_OPERATION_TOKEN_LIMIT`, `MODEL_OPERATION_COST_LIMIT_USD`                                      | What one operation that goes through the task runner may use, in tokens (input and output) and in estimated dollars. `0`, the default, is no limit. A dollar limit needs `MODEL_PRICES`, or the server does not start                     |
| `MODEL_CACHE`, `MODEL_CACHE_MAX_ENTRIES`, `MODEL_CACHE_TTL_SECONDS`                                  | `off` (default) or `tenant`: validated answers kept in this process's memory, per tenant, never shared. Up to 10,000 entries (default 256) for up to 86,400 seconds (default 900)                                                         |
| `TELEMETRY_TRACE_CONTENT`                                                                            | `off` (default) or `redacted`: a trace may then carry the size of a prompt and of a reply and a short hash of the prompt. The text of neither is ever exported                                                                            |

**Where this applies today.** Choosing a deployment by role, failing over, pinning a data zone, holding an operation to an
allowance and the cache are done by the task runner (`backend/src/models/runner.ts`), and the only caller of the runner is
the planning of a research run. The other steps that use a model (participants, constraints, the question reading, the
review and the rest) send to the default deployment, `AI_MODEL`, through the same client, which does ask for strict
structured output from a Foundry deployment. `POST /api/provider/check` asks every deployment a task could be routed to,
and says apart whether it was reachable, signed in to, found and gave structured output.

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

| Role                   | Where                          | May                                                                                      |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| Platform Administrator | app role `Swarm.PlatformAdmin` | Verify the audit chain, and check the model connection. Sees no project                  |
| Workspace Owner        | workspace membership           | Everything in the workspace (the model connection check too), and grant or remove owners |
| Workspace Admin        | workspace membership           | Everything in the workspace except the owners (the model connection check too)           |
| Project Lead           | project membership             | Read, export, review, run, chat, delete and share the project                            |
| Analyst                | project membership             | Read, export, run, branch, ask the analyst and the actors                                |
| Reviewer               | project membership             | Read, export, review statements and conflicts. Never runs                                |
| Viewer                 | project membership             | Read and export                                                                          |

Any workspace member can create experiments and leads them. A workspace with no owner is claimed by
the first person to call it who holds `Swarm.Admin`; after that the app role confers nothing, and an
owner adds the others from **People** under Settings and tools and each project's **Who has access** (or
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

What this does **not** do yet: no directory lookup (the dialogs take an Entra object id and cannot say who it belongs to), no groups from a directory sync, no invitations by name or email, one workspace per tenant, and no per-tenant data keys. Who may use the workspace is managed from the browser (**People** under Settings and tools, for a workspace owner or administrator) and who may use a project from **Who has access** under Settings and tools (for a project lead, or an owner or administrator), or through the [HTTP API](./API.md); the dialogs offer only what the server would allow and enforce nothing themselves. Existing
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
**Verify connection** in the popover of the engine chip in the top bar. The chip reads
`connected` only after a real request has succeeded (a check, or any model
operation since the server started) and `failing` after one has failed; after a check it reads exactly what that
check found about the connection (reachable, signed in to, deployment found), and the check says apart whether
structured output works. To prove the whole journey (per-proxy calls, grounding, branch,
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

### Microsoft Foundry (`AI_PROVIDER=foundry`)

The same OpenAI-compatible v1 API as the Azure mode above, with a deployment for each kind of task, strict structured
output, a router, allowances, an optional per-tenant cache and safety signals added on top
([Foundry models](./models/foundry.md) has all of it). Three settings give a working server with one deployment serving
every role: `AI_PROVIDER=foundry`, `FOUNDRY_ENDPOINT` and `AI_MODEL` (a deployment name). Sign in with `az login`, or give
the hosted workload a managed identity (`AZURE_CLIENT_ID` for a user-assigned one); the identity needs the **Cognitive
Services OpenAI User** role. `POST /api/provider/check` then asks every deployment a task could be routed to, once each,
and reports apart whether it was reachable, signed in to, found and gave structured output.

> **Status:** proved against an in-process fake of the endpoint (`backend/test/support/fake-foundry.ts`) and **never run
> against a live resource**. The live evidence in [AZURE.md](./AZURE.md#live-evidence) was gathered with `AI_PROVIDER=azure`
> and says nothing about this provider. [Foundry models](./models/foundry.md#verified-and-not-verified) lists what the
> first live run has to settle.

### Other OpenAI-compatible providers

Set `AI_PROVIDER=openai`, `AI_MODEL`, `OPENAI_BASE_URL` (including the v1-compatible
base path), and `OPENAI_API_KEY`. The endpoint must support JSON Chat Completions.
Only administrator-controlled configuration can select endpoints; input documents
cannot request arbitrary URLs or tools.

### What a model does in the scenario lab

Every step of the lab has a rules path and runs with `AI_PROVIDER=none`. A provider adds to it in the places
below and never decides the outcome of a comparison:

| Step                     | What a provider adds                                                                                                                                                                                                  | When it is used                                                                                                                                                                                                | If it fails                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Explore**              | A reading of the question, sent with each document's name and size and never its text; at most three calls (a reading and two repairs)                                                                                | Only when the project is made in **Model assisted** mode (the page sends `useModel`) and the server has a provider. Otherwise rules on this server read the question and it goes nowhere else                  | The rules read the question, and a note names the failure; a model that has not answered in 170 seconds is given up on in the same way    |
| **Research**             | A plan of what to look for: the things to find, the kinds of source and the sites worth a look. It never names an address to fetch, and a suggested site is only shown, until a person adds it                        | Only for a project made in **Model assisted** mode on a server with a provider, and only when the run's cost limit is above zero. Otherwise rules plan, and no model is asked                                  | Rules plan instead, with a sanitised reason and none of the model's words. A refusal is not answered from rules, and the run ends with it |
| **Find who is affected** | The participants of the decision, with their roles, objectives and the passages they rest on, proposed from a selection of the passages; every quote is checked against its passage and the list is held to 23 checks | Only for a project made in **Model assisted** mode and only when the person chooses **Find who is affected** (it asks the model when one is available; **Read the text instead** does not)                     | One correction round, then the rules propose instead, and the set says so (170 seconds at most)                                           |
| **Constraints**          | A reading of the sources for the limits on the decision. A limit a model calls hard is a suggestion that the server raises only where the quoted words bear it out                                                    | Only when the person asks for the model's reading of a project that has one (`409 MODEL_NOT_AVAILABLE` otherwise)                                                                                              | One correction round, then the rules' reading stands, and the set says so (170 seconds at most)                                           |
| **Create actors**        | A reading of each key actor against the evidence, with traits labelled as the model's                                                                                                                                 | Only in a project made in **Model assisted** mode, and only when the person switches on **Let the model read the key actors** as they approve                                                                  | The category priors stand                                                                                                                 |
| **Independent review**   | Extra critiques from a compact digest of the analysis, validated and never able to edit anything                                                                                                                      | Only in a project made in **Model assisted** mode, and only when the person switches on **Also ask a model**; a project that runs without a model is refused (`409 MODEL_NOT_AVAILABLE`) and the page says why | The rules' critiques are shown, with a note (170 seconds at most)                                                                         |

The repeated runs of a comparison (`simulation/`, `analysis/`), the decision brief and the Decision Canvas never call
a model: the engine is a seeded rules engine and both documents are assembled from the stored ones, so the same inputs
and the same seed give the same findings. Calls made for a project (research planning, participants, constraints,
actors, the review) count against its model budget. Reading a question happens before there is a project to charge, so it is
bounded by its rate limit, its three calls and its 170 seconds instead. A project made in **Local rules**
mode sends nothing to a model from any lab step, whatever provider the server has set up. A model that
fails is shown as a failure, never replaced
by canned output, except where the table says that rules stand in and a note says so. In the deep dive, the engine's own **Model assisted** mode drives each actor's decisions (see
[Deliberate resource limits](#deliberate-resource-limits)). What leaves the machine is the provider's to
handle: read its privacy terms first.

## Storage and backup

SQLite is stored in `data\swarm-lab.sqlite` by default, with local WAL/SHM files.
Sources, graph, personas, recorded rounds, reports, events and conversations persist
there, including guided stages, separate platform states, synthetic memory, tool
traces and survey progress, and the scenario lab's results: each project's scenario, stakeholders,
actors, comparisons, critiques and brief are validated JSON documents in the `project_artifacts` table
(they go with their project, and the database copy and backup tools carry them; the JSON snapshot export
does not, so export a brief on its own). A page that a person fetched is kept as a document with its
address (secret-looking query values removed), time and hash. Original PDF bytes are not retained: the stored source
is extracted text plus page-count metadata. No API keys are stored in the database.
Data is plain text at rest, not
application-encrypted, and is excluded from Git.

Use one application process per database. Prefer a normal local disk rather than
a network drive or a cloud-synchronized directory (OneDrive, Dropbox, Google Drive,
iCloud Drive). Synchronization clients can lock or conflict with SQLite's write-ahead
files, and would upload your source documents and results to that service, which
contradicts the local-only behavior described in this README. The server detects
these folders in the resolved database path, logs a warning at startup and returns the same warning as `storage.warning` in `GET /api/config`
(the interface does not show it). Windows' Desktop and Documents are often
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

The destination must be empty. The source is read as one snapshot (a single read transaction), so it
may be in use while it is copied: the copy is the database as it was when the copy began, with no half of
a change in it, and what is written afterwards is not in it (what that guarantees and what it does not:
the [runbook](./operations/runbook.md#restore-the-database)). The copy is one transaction and is kept
only if every table's row count matches and the audit chain verifies in the destination; sign-in state is
not copied. To restore, copy the other way into an empty database. Targets are never printed, because a
URL can hold a password.

**Rehearsing a restore** is one more command, and it changes nothing it is pointed at:

```powershell
npm.cmd run db:drill -- --from .\data\swarm-lab.sqlite
npm.cmd run db:drill -- --from postgres://swarm@db.example.internal:5432/swarm
```

It backs the database up into a scratch SQLite file, makes a new database from that file alone, and
checks that what came back is what went in: every table by digest (so a changed value is noticed, not
only a missing row), the audit chain, every project opened as the application opens it, and the next
audit entry following the last. A SQLite file or a PostgreSQL server may be in use while it runs (each is
read as one snapshot, for the digests and for the backup alike). It exits non-zero if the restore is not
exact. It rehearses this logical path; restoring a hosted server to a point in time is the platform's,
and has to be rehearsed where it runs.

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

| Item                       | Limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source documents           | 1–10 UTF-8 TXT/MD/Markdown/CSV/JSON files, text PDFs, public web pages, or pasted notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Document size              | 80–40,000 characters each; 200,000 total                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| PDF extraction             | 2 MB / 40 pages / 40,000 characters; one isolated worker, 10 seconds, 192 MB old-generation heap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CSV and JSON files         | 2 MB each, read as text on the server: at most 500 rows and 50 columns of a table, 8 levels and 4,000 lines of JSON, then cut to 40,000 characters with a notice in the text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Web page                   | Read by the server: 1.5 MB before and after decompression, 12 seconds in all, 5 redirects, ports 80 and 443, 40,000 characters of text; 10 requests a minute for each caller and 8 pages at once for the whole process, with 8 more waiting up to 5 seconds; the settings are `URL_INGEST_*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| HTTP request body          | 600 KB normally; 2.7 MB encoded extraction request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Local population / rounds  | 4–24 agents / 3–24 rounds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Model population / rounds  | 4–10 agents / 3–10 rounds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Work queue                 | One active execution stage per worker, three waiting for any worker; the queue is in the database, so a restart keeps it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Execution deadline         | 15 minutes per stage; five minutes per asynchronous survey                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Model context / response   | 48,000 serialized input characters / 256 KB response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Provider retries           | Network errors and 5xx: at most three HTTP attempts. Throttling (429): up to six, each honoring a bounded Retry-After; a reply cut off at its limit is never read; it is retried once with twice the budget, counted in the stage's calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Model stages               | One provider call per proxy per platform per round, four at a time (at most 10 × 2 × 10 = 200), plus about 4 setup calls and about 8 report/grounding calls. Each stage has a hard budget: 16 for knowledge/environment, `1.5 × workload + 12` for simulation, 40 for the report. Corrective retries count against it                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Follow-ups                 | One active chat/survey globally; 30 chat exchanges and five surveys per scenario; at most five survey targets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Model budget per project   | Calls and tokens for the life of a project, each 0 for no limit: `PROJECT_MODEL_CALL_LIMIT` and `PROJECT_MODEL_TOKEN_LIMIT` set the default, and a workspace owner or administrator may give one project its own; the pilot template defaults to 1,500 calls and 4,000,000 tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Scenario lab: reading      | A question of 3 to 2,000 characters and at most 10 documents listed; a frame holds at most 6 alternatives, 15 assumptions and 10 changes; reading is 10 a minute and a model gets at most 3 calls for it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Scenario lab: stakeholders | At most 40 stakeholders in a set (25 proposed by the rules, at most 8 of them key), 160 relations and 60 actors; a cohort simulates at most 200 members (20 for a standard group, 10 for a background one, by default)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Scenario lab: comparison   | 3 to 200 runs for each of at most 8 scenarios over 3 to 36 rounds, and at most 2,400 simulated runs in all, sensitivity included; the setup on Simulate defaults to 30 runs and 12 rounds. Two run at a time in a process, and a project keeps its newest 12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Scenario lab: documents    | Each stored result (scenario, stakeholders, actors, comparison, critiques, brief) is one JSON document of at most 2,000,000 bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Source conflict scan       | At most 20 candidate conflicts kept; a sentence that a document repeats word for word is kept once for that document; a word that more than 512 sentences hold is not used to find partners, and a sentence is compared with at most 128 of them, so that a project at the 200,000-character limit cannot stall the server (a pair not reached within those limits is skipped, and the decision brief says how many lists were not read and how many sentences were compared with only their closest partners; evidence of a few hundred sentences reaches neither); a ledger built earlier keeps its conflicts and what was decided about them, and a rebuild or a brief adds a candidate that a fresh search finds and it does not hold (to the ledger, recorded as `ledger.conflicts.found`) |
| History                    | 100 experiments; export/delete old ones explicitly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| API rate limits            | 120 requests/minute/IP; create 20, quick run 6, guided step 8, PDF/chat 10, web page 10, survey 5/minute/IP; scenario lab: question reading 10, finding stakeholders 10, making actors 10, approving 30, saving a review or actors 120, starting a comparison 6, stopping one 30, running the review 6, responding 60, writing or exporting the brief 20 (each per minute per IP, times `RATE_LIMIT_SCALE`)                                                                                                                                                                                                                                                                                                                                                                                     |

Recorded model calls count successful provider envelopes, not failed HTTP attempts.
Token counts are stored only when reported by the provider; zero does **not**
establish zero usage or cost. Source excerpts and conversation context are bounded
and may omit material from long inputs.
Retries, repeated stage attempts and follow-ups are additional consumption.
The same prepared fictional proxies are copied into each platform; combined
inclination averages each proxy across platforms, not an enlarged independent
population. The initial-post stance/strength controls are explicit assumptions;
nonzero strength influences the first local round, not an inferred sentiment score.
