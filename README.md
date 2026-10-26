# Swarm Lab

A local-first scenario workbench inspired by MiroFish's document → knowledge graph
→ agent simulation → report → interaction workflow. Independently implemented in
React and TypeScript. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the reference
analysis, design boundaries, and Azure migration direction.

**Simulation is not prediction.** Synthetic personas do not represent real
people's beliefs. Outputs are conditional on the provided evidence and modeling
assumptions, not calibrated probabilities or decision-making guarantees.

## Engine modes

- **Local / rules-based:** no API keys, cloud services, model download, or network
  calls. Real term/co-occurrence extraction, sparse-vector retrieval, seeded
  opinion dynamics, computed reports and evidence lookup. Not AI-generated.
- **Model-assisted:** explicitly selected per project. Actual model requests for
  knowledge/personas, round decisions, reporting and interviews. Provider errors
  are surfaced; there is no fabricated response or silent fallback.

The first milestone accepts UTF-8 TXT and Markdown, not PDF or scanned documents.
No webpage crawling, live Twitter/Reddit connection, or shell access is provided.

## Prerequisites and setup

- Node.js **24+**, npm, and Git.
- A model provider only if using model-assisted mode.
- Docker is optional; the Docker engine must actually be running.

From the project root on Windows:

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

`npm.cmd` avoids the PowerShell `npm.ps1` execution-policy issue without changing
your machine's execution policy. On other platforms use `npm`.

- Development frontend: <http://127.0.0.1:5173>
- Backend health: <http://127.0.0.1:3001/api/health>

Run separately with `npm.cmd run dev:frontend` and `npm.cmd run dev:backend`.
Once a lockfile is present, use `npm.cmd ci` for reproducible installations.
Both development processes read the root configuration; Vite proxies `/api` to
the configured `PORT`. Only `VITE_`-prefixed variables can enter the client bundle:
**never give a secret a `VITE_` prefix**.

### Run the built application

```powershell
npm.cmd run build
npm.cmd start
```

Open <http://127.0.0.1:3001>. One backend process serves both the built React
application and the API. Run commands from the project root. Stop a foreground
server with Ctrl+C before starting another on the same port.

## Use the workbench

1. Open **New experiment**, or **Load starter scenario** to populate clearly
   fictional, editable input. No example results are preloaded.
2. Name the experiment, frame a question, and paste or upload source material.
3. Choose the local engine or explicitly opt into a configured model provider.
4. Choose population, rounds, seed and community/broadcast interaction structure.
   Optionally schedule an intervention with an assumed stance and strength.
5. **Save draft** or **Create & run**. Active runs expose persisted stages/events
   and can be cancelled. Refreshing the browser preserves the selected project.
6. Explore **Knowledge**, **Agents**, **Rounds**, **Report**, and **Evidence**.
   Citation chips open original source passages with their offsets.
7. In local mode, **Evidence inspector** retrieves source text and recorded state;
   it is not conversational AI. Model-assisted projects support genuine generated
   report follow-ups and fictional-persona interviews.
8. Export Markdown or JSON, duplicate inputs to compare scenarios, or delete a
   completed/draft/failed experiment. JSON export includes evidence and conversation.

Completed results are not silently overwritten: duplicate the experiment to rerun
with different settings. Retrying a failed/cancelled run starts a new attempt and
replaces its partial artifacts; export JSON first if those partial results matter.
Restart-interrupted work is marked failed with a retry explanation, not resumed
or represented as completed.

### Deliberate resource limits

| Item                      | Limit                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| Source documents          | 1–5 UTF-8 TXT/MD/Markdown files, or pasted notes                                  |
| Document size             | 80–40,000 characters each; 100,000 total                                          |
| HTTP request body         | 600 KB                                                                            |
| Local population / rounds | 4–24 agents / 3–24 rounds                                                         |
| Model population / rounds | 4–10 agents / 3–10 rounds                                                         |
| Work queue                | One active simulation, three waiting                                              |
| Execution deadline        | 15 minutes per run                                                                |
| Model context / response  | 48,000 serialized input characters / 256 KB response                              |
| Provider retries          | At most three HTTP attempts; bounded Retry-After on transient errors              |
| Model stages              | Graph + personas + one call per round + report; at most 13 successful stage calls |
| Follow-ups                | One active follow-up globally; 30 exchanges per experiment                        |
| History                   | 100 experiments; export/delete old ones explicitly                                |
| API rate limits           | 120 requests/minute/IP; create 20, run 6, follow-up 10/minute/IP                  |

Recorded model calls count successful provider envelopes, not failed HTTP attempts.
Token counts are stored only when reported by the provider; zero does **not**
establish zero usage or cost. Source excerpts and conversation context are bounded
and may omit material from long inputs.

## Configuration

Copy [.env.example](./.env.example) locally. Never commit the resulting `.env`
or paste keys into chat/source files. Server configuration is never bundled into
the browser. The default is `AI_PROVIDER=none`.

| Variable                                        | Purpose                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `HOST`, `PORT`                                  | API bind address/port; defaults to loopback and 3001                |
| `DATA_DIR`                                      | SQLite storage directory, relative to the process working directory |
| `ALLOWED_ORIGINS`, `ALLOWED_HOSTS`              | Explicit browser-origin and HTTP-host allowlists                    |
| `LOG_LEVEL`                                     | Server log level; request bodies and credentials are not logged     |
| `AI_PROVIDER`                                   | `none`, `ollama`, `openai`, or `azure`                              |
| `AI_MODEL`                                      | Local/remote model name; Azure deployment name for `azure`          |
| `AI_TIMEOUT_MS`                                 | Per-model-request timeout                                           |
| `OLLAMA_BASE_URL`                               | Administrator-configured local Ollama endpoint                      |
| `DOCKER_OLLAMA_BASE_URL`                        | Compose-only address of Ollama running on the host                  |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`             | Trusted compatible v1 endpoint and server-side key                  |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` | Azure resource/v1 endpoint and server-side key                      |
| `SOURCE_URL`                                    | Public corresponding source for the exact remotely deployed version |

If you explicitly configure origin/host allowlists, update them when changing
ports or domains. Defaults use the configured API port and local Vite port.
Provider status means configuration exists, not that the service has been reached
or its output quality verified. Restart the backend after changing environment variables.

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

### Azure OpenAI / Foundry

Deploy an OpenAI-compatible chat model with JSON output support. In your local,
ignored `.env`, set `AI_PROVIDER=azure`, `AI_MODEL` to the deployment name,
`AZURE_OPENAI_ENDPOINT` to your resource root or `/openai/v1/` endpoint, and
`AZURE_OPENAI_API_KEY` to its key. Never put the key in frontend variables.
The v1 API does not require a dated `api-version` query parameter.
Managed-identity authentication is a future production migration, not implemented
by this local API-key adapter.

### Other OpenAI-compatible providers

Set `AI_PROVIDER=openai`, `AI_MODEL`, `OPENAI_BASE_URL` (including the v1-compatible
base path), and `OPENAI_API_KEY`. The endpoint must support JSON Chat Completions.
Only administrator-controlled configuration can select endpoints; input documents
cannot request arbitrary URLs or tools.

## Storage and backup

SQLite is stored in `data\swarm-lab.sqlite` by default, with local WAL/SHM files.
Sources, graph, personas, recorded rounds, reports, events and conversations persist
there. No API keys are stored in the database. Data is plain text at rest, not
application-encrypted, and is excluded from Git.

Use one application process per database. Prefer a normal local disk rather than
a network drive or a OneDrive-synchronized directory. For example, before starting:

```powershell
$env:DATA_DIR = Join-Path $env:LOCALAPPDATA 'SwarmLab'
npm.cmd start
```

An environment variable takes precedence over `.env`. Stop the server before
copying the complete data directory to a private backup location. Do not copy an
actively changing SQLite file alone, use a network filesystem for WAL, or commit
backups containing source material. JSON exports are portable inspection records,
not an implemented automatic database-import format.

## HTTP API

All browser requests are same-origin. During development Vite provides the proxy.
Errors are non-2xx JSON: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
Some not-found/rate-limit responses omit `requestId`; no provider error body is returned.

| Method       | Path                                       | Behavior                                                                  |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------- |
| GET          | `/api/health`                              | Actual process/storage/queue readiness, not model connectivity            |
| GET          | `/api/config`                              | Safe capabilities, limits and provider status; no key or private endpoint |
| GET / POST   | `/api/projects`                            | Paginated history / validated draft creation                              |
| GET / DELETE | `/api/projects/:id`                        | Full persisted detail / delete non-active experiment                      |
| POST         | `/api/projects/:id/run`                    | Queue a draft/failed/cancelled experiment; returns 202                    |
| POST         | `/api/projects/:id/cancel`                 | Cancel waiting work or request active cancellation                        |
| GET          | `/api/projects/:id/evidence?query=...`     | Sparse-vector search; exact `S1`-style citation lookup                    |
| GET          | `/api/projects/:id/evidence`               | Explicit unranked browsing of this project's bounded passages             |
| GET / POST   | `/api/projects/:id/chat`                   | Read target conversation / perform a bounded follow-up                    |
| GET          | `/api/projects/:id/export?format=markdown` | Escaped, source-linked report                                             |
| GET          | `/api/projects/:id/export?format=json`     | Snapshot, chunks and conversation export                                  |

Search with no matching terms returns an empty list, not arbitrary “relevant”
sources. Empty-query browsing is a distinct unranked operation (scores are zero).
Creation and result shapes are defined in [shared/types.ts](./shared/types.ts).
Chat POST takes `{ "target": "report" | "agent-1", "message": "..." }`; GET accepts
`?target=...`. Agent IDs must belong to the selected experiment.

## Testing, linting and formatting

```powershell
npm.cmd run check
npm.cmd run format:check
```

`check` runs strict backend/test/frontend TypeScript checks, ESLint, Vitest, and
production backend/frontend builds. Tests cover input thresholds, exact source
offsets, real retrieval, deterministic state transitions, measurable intervention
effects, persistence/restart recovery, cancellation/queue bounds, HTTP boundaries,
exports, and provider protocol/error handling.

Provider tests use explicitly labeled fixture HTTP responses; they do **not**
establish live model connectivity or reasoning quality. Live AI requires a
separately configured service. The native local workflow has also been exercised
in the browser through input, completed rounds, report, source citation lookup
and persisted evidence follow-up.

Useful focused commands:

```powershell
npm.cmd test -- backend\test\local.test.ts backend\test\knowledge.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format
```

CI performs these checks, dependency auditing at high severity, Compose validation,
and an actual Docker build/health/UI smoke test. Local Docker image execution
requires a running engine and is separate from native validation.

## Docker (optional)

Requires Docker with its engine running and Compose supporting optional `env_file`
entries (2.24+). No `.env` is necessary for the local rules engine:

```powershell
docker compose up --build -d
```

Open <http://127.0.0.1:3001>. The image builds the frontend/backend, runs as a
non-root user, serves one port, and persists SQLite in the `swarm-data` named
volume. Compose publishes only on loopback, drops Linux capabilities and limits
container CPU/memory. `docker compose down` retains the named data volume.
Avoid `down --volumes` unless intentionally deleting that data.

Model credentials, if used, enter through the ignored `.env`/container environment,
never the image. Host Ollama must be reachable from the container; Compose uses
`DOCKER_OLLAMA_BASE_URL=http://host.docker.internal:11434`. No model is downloaded
automatically. Do not expose Ollama publicly merely to connect a container.

## Security and privacy

- **Local, single-user application; no user authentication or tenant isolation.**
  Loopback binding, explicit host/origin allowlists, CSP, request limits and rate
  limits do not replace authentication. Do not expose this server directly online.
- Source names never become filesystem paths. Inputs are text only, type/size
  checked on both sides, and stored with parameterized SQLite statements.
- Source text, webpage-looking text, memories and outputs are untrusted data.
  No arbitrary URL fetch, shell, code execution, plugins or filesystem tools are
  available to agents. Prompt boundaries reduce risk but do not prove immunity
  to prompt injection or hallucination.
- Model output is schema-validated; agent/node/peer/citation IDs are checked.
  Valid citation IDs do not establish factual truth or semantic entailment.
- React renders source/model text as text, not raw HTML. Markdown exports escape
  untrusted HTML/Markdown. Downloaded JSON remains sensitive data if sources are.
- Model endpoints are administrator-configured, not selected by input documents.
  HTTPS is required except for explicitly local Ollama addresses. Redirects are
  rejected. Keys stay server-side and provider bodies/request content are not logged.
- Local mode makes no model requests even if a provider is configured. Model mode
  sends bounded source/persona context to that provider; review its privacy policy.
- `.env`, SQLite data, node_modules, build output and caches are Git-ignored.
  Use OS access controls/disk encryption for sensitive local sources.

### Dependency advisory status

The maintained static plugin replaces an initially vulnerable older major.
AJV 8 is constrained to a patched compatible release without replacing ESLint's
separate AJV 6 API.

The available registry currently reports **moderate transitive `fast-uri`
advisories** (including inherited entries in Fastify's schema dependencies).
Advertised fixed versions `3.1.9` and `4.2.3` were not available from this
environment's trusted registry at verification time. The application does not
accept user-provided JSON Schemas or URI references, but that is not a declaration
that the dependency is universally safe. Do not dismiss the audit, force a
cross-major override, or deploy publicly without resolving/re-evaluating it.
Run `npm audit` against your approved registry before deployment. CI fails on new
high/critical findings; a passing check does not mean zero advisories.

## Troubleshooting

| Symptom                                     | Action                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm.ps1 cannot be loaded`                  | Use `npm.cmd`; do not weaken PowerShell execution policy                                                                            |
| UI cannot reach backend                     | Start both dev processes, check `/api/health`, and verify root `PORT`                                                               |
| `EADDRINUSE`                                | Stop the specific prior app process or choose another port; do not kill unrelated Node processes                                    |
| 403 host/origin                             | Add the exact trusted hostname/origin to its allowlist and restart; do not use a wildcard                                           |
| AI option disabled                          | Inspect provider status; configure model name, endpoint and required server-side key                                                |
| Model 401/404                               | Verify key, Azure deployment name, endpoint path and model/API compatibility                                                        |
| Model 429/timeout                           | Reduce agents/rounds, check provider quota or local inference capacity; errors remain visible                                       |
| Invalid model JSON/citation                 | Use a model reliable at the documented structured schema; no fabricated fallback is returned                                        |
| SQLite busy/sync problems                   | Use one process and a non-synchronized local `DATA_DIR`; restore a known-good backup if needed                                      |
| Work marked failed after restart            | Retry explicitly; interrupted in-memory work is not durable/resumable                                                               |
| Docker named-pipe error                     | Start Docker Desktop/engine first; Compose parsing alone does not validate an image                                                 |
| Export not appearing in an embedded browser | Open the app in a normal browser; embedded hosts may intercept downloads. Export HTTP payloads/attachments are independently tested |
| Zod `@__PURE__` build warnings              | Current upstream comments produce two non-fatal Rollup annotation warnings; builds still validate                                   |

### This environment's npm registry mismatch

The project uses the official registry by default (approved for this workspace).
Here, its direct TLS handshake was unavailable. The existing Microsoft proxy was
reachable but returned tarball URLs under a different registry prefix, which npm
12 correctly rejected as disallowed remote packages. Installation succeeded by
mapping that registry prefix back to the **same trusted proxy**, without changing
TLS verification, remote-package restrictions, or install-script policy:

```powershell
npm.cmd ci --ignore-scripts --registry=https://packagefeedproxy.microsoft.io/npm/ --replace-registry-host=https://ms-feed-25.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry
```

Use this only where that proxy is your approved registry. The lockfile retains
versions/integrity but omits environment-specific registry resolution URLs.
Do not solve connectivity problems with `strict-ssl=false`, token sharing, or
enabling disallowed dependency/script types.

## Azure deployment path

See [docs/AZURE.md](./docs/AZURE.md) for the migration plan, service decisions,
credential boundary, persistence/job prerequisites and acceptance criteria.
No Azure resources have been provisioned, no cloud deployment is claimed, and
the current local single-user image is not a production multi-tenant service.

## Licensing

[AGPL-3.0-only](./LICENSE). See [NOTICE.md](./NOTICE.md) for reference attribution
and source-availability obligations. No MiroFish application code or brand assets
are included.
