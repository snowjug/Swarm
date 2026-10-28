# Configuration, providers, storage and limits

Back to the [README](../README.md). The quick-start commands are there; this page is the reference.

## Environment variables

Copy [.env.example](../.env.example) locally. Never commit the resulting `.env`
or paste keys into chat/source files. Server configuration is never bundled into
the browser. The default is `AI_PROVIDER=none`.

| Variable                            | Purpose                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`, `PORT`                      | API bind address/port; defaults to loopback and 3001                                                                                     |
| `DATA_DIR`                          | SQLite storage directory, relative to the process working directory                                                                      |
| `ALLOWED_ORIGINS`, `ALLOWED_HOSTS`  | Explicit browser-origin and HTTP-host allowlists                                                                                         |
| `LOG_LEVEL`                         | Server log level; request bodies and credentials are not logged                                                                          |
| `AI_PROVIDER`                       | `none`, `ollama`, `openai`, or `azure`                                                                                                   |
| `AI_MODEL`                          | Local/remote model name; Azure deployment name for `azure`                                                                               |
| `AI_TIMEOUT_MS`                     | Per-model-request timeout                                                                                                                |
| `OLLAMA_BASE_URL`                   | Administrator-configured local Ollama endpoint                                                                                           |
| `DOCKER_OLLAMA_BASE_URL`            | Compose-only address of Ollama running on the host                                                                                       |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Trusted compatible v1 endpoint and server-side key                                                                                       |
| `AZURE_OPENAI_ENDPOINT`             | Azure resource/v1 endpoint (must be an Azure AI host)                                                                                    |
| `AZURE_OPENAI_AUTH`                 | `entra` (default; no key) or `key` (legacy API-key authentication)                                                                       |
| `AZURE_CLIENT_ID`                   | Client id of a user-assigned managed identity; empty for `az login` or a system-assigned identity                                        |
| `AZURE_OPENAI_API_KEY`              | Read only when `AZURE_OPENAI_AUTH=key`                                                                                                   |
| `SOURCE_URL`                        | Public corresponding source for the exact remotely deployed version                                                                      |
| `RATE_LIMIT_SCALE`                  | Integer 1–1000 multiplying every per-IP request limit (default 1). Raise it only for automated browser or load tests of your own machine |

If you explicitly configure origin/host allowlists, update them when changing
ports or domains. Defaults use the configured API port and local Vite port.
Provider status means configuration exists, not that the service has been reached
or its output quality verified. Restart the backend after changing environment variables.

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

## Deliberate resource limits

| Item                      | Limit                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source documents          | 1–5 UTF-8 TXT/MD/Markdown files, text PDFs, or pasted notes                                                                                                                                                                                                                                                           |
| Document size             | 80–40,000 characters each; 100,000 total                                                                                                                                                                                                                                                                              |
| PDF extraction            | 2 MB / 40 pages / 40,000 characters; one isolated worker, 10 seconds, 192 MB old-generation heap                                                                                                                                                                                                                      |
| HTTP request body         | 600 KB normally; 2.7 MB encoded extraction request                                                                                                                                                                                                                                                                    |
| Local population / rounds | 4–24 agents / 3–24 rounds                                                                                                                                                                                                                                                                                             |
| Model population / rounds | 4–10 agents / 3–10 rounds                                                                                                                                                                                                                                                                                             |
| Work queue                | One active execution stage, three waiting                                                                                                                                                                                                                                                                             |
| Execution deadline        | 15 minutes per stage; five minutes per asynchronous survey                                                                                                                                                                                                                                                            |
| Model context / response  | 48,000 serialized input characters / 256 KB response                                                                                                                                                                                                                                                                  |
| Provider retries          | Network errors and 5xx: at most three HTTP attempts. Throttling (429): up to six, each honoring a bounded Retry-After; a truncated reply is retried once or twice with a larger output budget (all counted against the stage's call budget)                                                                           |
| Model stages              | One provider call per proxy per platform per round, four at a time (at most 10 × 2 × 10 = 200), plus about 4 setup calls and about 8 report/grounding calls. Each stage has a hard budget: 16 for knowledge/environment, `1.5 × workload + 12` for simulation, 40 for the report. Corrective retries count against it |
| Follow-ups                | One active chat/survey globally; 30 chat exchanges and five surveys per scenario; at most five survey targets                                                                                                                                                                                                         |
| History                   | 100 experiments; export/delete old ones explicitly                                                                                                                                                                                                                                                                    |
| API rate limits           | 120 requests/minute/IP; create 20, quick run 6, guided step 8, PDF/chat 10, survey 5/minute/IP                                                                                                                                                                                                                        |

Recorded model calls count successful provider envelopes, not failed HTTP attempts.
Token counts are stored only when reported by the provider; zero does **not**
establish zero usage or cost. Source excerpts and conversation context are bounded
and may omit material from long inputs.
Retries, repeated stage attempts and follow-ups are additional consumption.
The same prepared fictional proxies are copied into each platform; combined
inclination averages each proxy across platforms, not an enlarged independent
population. The initial-post stance/strength controls are explicit assumptions;
nonzero strength influences the first local round, not an inferred sentiment score.
