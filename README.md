# Swarm Lab

A local-first, graph-first guided console inspired by MiroFish's document →
knowledge graph → environment → simulation → report → interaction workflow.
Independently implemented in
React and TypeScript. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the reference
analysis, design boundaries, and Azure migration direction.

**Simulation is not prediction.** Synthetic personas do not represent real
people's beliefs. Outputs are conditional on the provided evidence and modeling
assumptions, not calibrated probabilities or decision-making guarantees.

## Engine modes

- **Local / rules-based:** no API keys, cloud services, model download, or network
  calls. Real term/co-occurrence extraction, sparse-vector retrieval, seeded
  opinion dynamics, computed reports and evidence lookup. Not AI-generated.
- **Model-assisted:** explicitly selected per project. Real model requests for
  knowledge/personas, **one request per proxy per platform per round** (each proxy
  sees only its own profile, private memory, the passages it holds and the public
  posts the platform's network rules expose to it), a grounded report with an
  independent support check, and interviews. Every reply is validated server-side
  (IDs, citations, verbatim quotes, bounded opinion change) with at most two
  corrective retries. Provider errors are surfaced; there is no fabricated response
  or silent fallback.
- The header always says which one is active: `LOCAL / RULES MODE`, or
  `REAL AZURE AI` / `REAL MODEL · OpenAI` / `REAL MODEL · Ollama (local)` with the
  model, how it authenticates and whether a real call has succeeded.

The console accepts UTF-8 TXT/Markdown and bounded, text-based PDFs. PDF parsing
runs locally in an isolated, resource-limited worker; scanned PDFs need OCR,
which is not implemented. No webpage crawling, live Twitter/Reddit connection,
OASIS compatibility or agent shell access is provided.

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

## Use the guided console

The default UI is a light, technical five-stage console, not a one-click replay.
On wide screens a single **Graph / Split / Workbench** control switches the working
layout (on narrow screens it becomes a two-way **Graph | Workbench** pane switch);
the graph, inspectors and the collapsible, in-flow operation log show actual
persisted data and never overlay stage content. No example results, actors
or counters are preloaded. A fictional starter fills editable input only.

1. **Graph Build:** attach or paste source material, name the scenario and frame
   a question. Choose local rules or explicitly opt into a configured provider,
   then build. Inspect the ontology, graph, counts and source citations.
   Local ontology is explicitly a topic/co-occurrence schema, not AI extraction.
2. **Environment Setup:** prepare fictional proxies and configuration, then
   inspect/edit persona assumptions, inclinations, influence, openness, rounds,
   minutes per round, platform selection and initial scenario inputs. Save before
   starting. IDs, source links and population size remain fixed after preparation.
3. **Simulation:** run **Info Plaza** (broadcast exposure) and/or **Topic Community**
   (community exposure). Each has a separate population state, recorded rounds,
   clock and action stream. Synthetic memory is persisted and shown separately
   from original source facts. Local update events are not fabricated social posts.
4. **Report:** explicitly generate the report after simulation. Local reports
   calculate recorded results. Model-assisted reports plan bounded tool use,
   search sources/memory, inspect timelines, optionally interview fictional
   proxies, and write real chapters progressively. Inspect tool input/output
   beside the report; hidden model reasoning is not exposed.
5. **Interaction:** keep the report beside evidence lookup or model-assisted
   report/persona chat. Survey up to five selected proxies: **state snapshots**
   return recorded numbers with no generated answer; **model interviews** make
   actual provider requests and expose asynchronous progress, cancellation and
   partial failures. Neither is a survey of real people.

Each execution stage stops at **ready** and waits for the next explicit action.
Later stages cannot bypass prerequisites. Cancellation stops owned work before
retry is allowed. A failed stage preserves upstream outputs; retry re-executes that
stage, replacing its unfinished output. Export JSON before retry if partial data
matters. Interrupted stages and surveys are marked failed after restart, never
silently completed. A simulation interrupted after at least one saved round keeps
those rounds and offers **Resume from round N** (an explicit action); everything
else restarts the stage.

### What-if loop: pause, resume, intervene, branch, compare

Simulation rounds are saved atomically: the combined history, both platform
populations and the recorded memories are written in one update, so a saved round
is never half-written. This makes the following possible, all with real, tested
behavior:

- **Pause / Resume.** Pausing discards the in-flight round and keeps every saved
  round; the project is `ready`, not failed. Resume continues from the next round
  without recomputing earlier ones. In the local deterministic engine a resumed run
  is identical to an uninterrupted run (asserted by `backend/test/whatif.test.ts`).
  Resume also recovers from a crash or model error once rounds exist. Model-assisted
  runs are not reproducible, and usage from a discarded in-flight round is still
  counted because it was really spent.
- **Intervention.** While paused you can schedule or remove the single scheduled
  intervention for a _future_ round. "Live injection" is therefore pause → inject →
  resume at the next round boundary; nothing mutates a round in progress.
- **Branch.** From a paused or finished scenario, branch after any saved round (or
  from round 0). The branch is an independent scenario that copies rounds 1…N
  unchanged and applies your declared changes (a different intervention, or
  per-proxy influence/openness/opinion) only to later rounds. The source run is
  never modified, and a branch's report and exports record its lineage.
- **Compare.** Compare two guided scenarios round by round (mean inclination,
  support, opposition, polarization, activity), with the round through which they
  are identical derived from recorded data, and notes that these are simulated
  differences, not forecasts or causal estimates.

**History** preserves existing quick-run projects. Their recorded results remain
readable in the new console, without invented ontology, operation traces or
unrecorded second-platform results. Duplicate a historical project to use the
guided workflow. Completed scenarios are read-only apart from follow-up history;
duplicate inputs to run another scenario.

### Grounding review (model-assisted reports)

A model-written report lists the statements each chapter rests on and labels every
one as a **source fact**, **extracted claim**, **user assumption**, **AI hypothesis**,
**simulated event** or **analytical conclusion**, so “the source says”, “the simulation
did”, “you assumed” and “the model guessed” are never blended. After the chapters are
written, each statement is checked:

- a quoted source fact must appear **verbatim** (ignoring case, spacing and
  quotation style) in a passage it cites; graph nodes carry the same verified quote;
- word overlap with the cited passage or simulation memory, and every figure compared
  with the cited material or the recorded simulation metrics;
- one independent model call judges support, contradiction or silence, and each
  judgement must **quote real text** from the passage or it is rejected.

Verdicts are `supported`, `partial`, `unsupported`, `contradicted` or `unchecked`
(hypotheses and assumptions are shown as such, not verified). A model judgement can
lower or confirm a verdict but cannot create support without word overlap. Figures
in chapter prose that match neither the cited material nor the recorded data are
listed as possible invented statistics. The review states which checks ran, and if
the independent check fails the report still completes with the deterministic
checks and says so.

Limits: a citation proves provenance, not truth; only the statements the writer
lists are checked; the rules-based report has no model-written statements and gets
no review. This is a guard against unsupported claims, not a hallucination detector
or a substitute for reading the sources.

### Deliberate resource limits

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
| Model stages              | One provider call per proxy per platform per round, four at a time (at most 10 × 2 × 10 = 200), plus about 4 setup calls and about 8 report/grounding calls. Each stage has a hard budget: 16 for knowledge/environment, `1.5 × workload + 12` for simulation, 28 for the report. Corrective retries count against it |
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

## Configuration

Copy [.env.example](./.env.example) locally. Never commit the resulting `.env`
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
[docs/AZURE.md](./docs/AZURE.md#provisioning-the-model-account-with-this-repository):
`npm run azure:provision -- --subscription <guid> --preflight-only` is read-only and
tells you exactly which permission is missing if you cannot deploy.

Verify with a real round trip, never an assumption: `POST /api/provider/check` or the
**Verify connection** button in the header. The badge and the entry readiness card read
`connected` only after a real request has succeeded (that check, or any model
operation since the server started) and `failing` after one has failed. To prove the whole journey (per-proxy calls, grounding, branch,
chats, injection probe, no credential leakage) run `npm run azure:verify`; it exits `0`
only if every check passes against the configured provider
([details](./docs/AZURE.md#verifying-the-live-integration)). Legacy key authentication remains available with
`AZURE_OPENAI_AUTH=key` and `AZURE_OPENAI_API_KEY`; never put a key in frontend
variables. The v1 API does not require a dated `api-version` query parameter.

> **Status:** the Entra path, the Bicep and the scripts are implemented and unit
> tested, but they have **not** been exercised against a live Azure resource. See
> the verified/unverified table in [docs/AZURE.md](./docs/AZURE.md).

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

## HTTP API

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
Creation and result shapes are defined in [shared/types.ts](./shared/types.ts).
Chat POST takes `{ "target": "report" | "agent-1", "message": "..." }`; GET accepts
`?target=...`. Agent IDs must belong to the selected experiment.
New UI creation sends `workflow: "guided"`; omitted workflow remains `"quick"` for
API compatibility. Stage state and environment/survey input contracts are in
[shared/guided.ts](./shared/guided.ts). Guided exports use `schemaVersion: 2`;
historical quick exports remain version 1. Markdown requires a completed report;
JSON can preserve a labeled partial snapshot.

PDF extraction takes `{ "name": "source.pdf", "data": "BASE64_BYTES" }`, not a data
URL or remote URL. The response contains extracted `content`, `pageCount` and
`bytes`. Create the scenario with this text, not raw binary.

Surveys take `{ "kind": "state" | "interview", "question": "...", "agentIds": [...] }`.
Poll the project's `console.surveys` until completion. Local state snapshots have
`answer: null`; generated answers are only produced by real model calls.

## Testing, linting and formatting

```powershell
npm.cmd run check
npm.cmd run format:check
```

`check` runs strict backend/test/frontend TypeScript checks, ESLint, Vitest, and
production backend/frontend builds. Tests cover input thresholds, exact source
offsets, real retrieval, deterministic state transitions, measurable intervention
effects, stage prerequisites, editable preparation, separate platform state,
memory, tool/citation validation, PDF extraction/bounds, asynchronous surveys,
persistence/restart recovery, cancellation/queue bounds, HTTP boundaries, exports,
frontend graph/console helpers, provider protocol/error handling, the per-proxy
simulation (context isolation, validation, concurrency and cancellation), the
grounding review (quote matching, verdict table, entailment validation), Entra token
handling with a fake credential, and the Azure provisioning scripts with a fake Azure CLI.

Provider tests use explicitly labeled fixture HTTP responses; they do **not**
establish live model connectivity or reasoning quality. Live AI requires a
separately configured service.

### End-to-end, accessibility, security and load evidence

```powershell
npm.cmd run build          # the E2E servers run the built output in dist/
$env:PW_CHANNEL = 'msedge' # reuse the installed Edge; CI installs Chromium instead
npm.cmd run test:e2e       # npx playwright install chromium first if you do not use Edge
npm.cmd run audit:ui       # screenshots + layout/axe metrics for four viewports (see scripts/ui-audit.mjs)
node scripts/load-test.mjs # latency, queue back-pressure and memory on this machine
```

`test:e2e` drives a real browser against two isolated servers with throwaway data
directories (never your own data):

- **`e2e/local`** — the deterministic local engine: the complete guided journey
  (input → graph → environment → simulation → branch with a declared intervention →
  resume → compare → report → citations → interaction → Markdown export → history/delete),
  error conditions (bad/corrupt/oversized uploads, API outage, rate limit, unknown
  project, double click, hostile requests), responsive checks at 1920×1080, 1440×900,
  1366×768 and 390×844 (no overflow, ≥11 px text, ≥24 px targets, unobstructed graph
  nodes, ≥11 px rendered graph/chart text), and **axe-core on every reachable
  state at two viewports with zero violations of any impact** plus keyboard/focus tests.
- **`e2e/model`** — the model-assisted path against a **protocol-faithful fake Ollama
  provider** (`e2e/support/fake-provider.ts`): real Pause clicked while rounds run,
  resume (saved rounds are never requested again), intervention, one provider call
  per proxy per platform per round, injected mid-run provider failure with checkpoint
  recovery, invented-citation rejection, a grounding-checked report, actor chat and
  token accounting. The fake is a test double; it is **not** evidence about any live model.

The suite sets `RATE_LIMIT_SCALE=100`; the production limiter itself is tested in
`backend/test/security.test.ts` (including that a genuinely rate-limited request
returns HTTP 429 `RATE_LIMITED` with `Retry-After`).

Automated checks do not replace a manual assistive-technology review (screen reader,
200 % zoom, forced colors), which has not been done. `scripts/load-test.mjs`
reports numbers for the machine it runs on; see
[docs/requirements-matrix.md](./docs/requirements-matrix.md) for the measured results and
their limits.

Useful focused commands:

```powershell
npm.cmd test -- backend\test\local.test.ts backend\test\knowledge.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format
```

CI performs these checks, dependency auditing at high severity, a Playwright
end-to-end run in Chromium (both projects above), Compose validation,
and an actual Docker build/health/UI smoke test, including PDF parsing and the full
staged local workflow inside the container. Local Docker image execution
requires a running engine and is separate from native validation.

Run the same real HTTP smoke flow against a local **0.3.0** backend:

```powershell
npm.cmd run smoke:console -- http://127.0.0.1:3001
```

It creates its own fictional PDF/scenario, verifies every gated stage and both
platforms, checks a real report/state survey, and deletes that scenario on success.
It never selects a model or spends provider quota. On failure, a scenario may remain
for diagnosis; the container CI removes its own container in all cases.

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
- Source names never become filesystem paths. Text input is type/size checked on
  both sides and stored with parameterized SQLite statements. PDFs use bounded
  in-memory bytes and a disposable worker; no original upload is written to disk.
- PDF workers do not inherit model credentials, execute embedded PDF scripts,
  render forms/images, or fetch user-supplied URLs. Byte/page/text/time/heap limits
  and one-worker concurrency protect the main API. This is not OCR or a guarantee
  against every parser vulnerability; keep the parser dependency current.
- Source text, webpage-looking text, memories and outputs are untrusted data.
  No arbitrary URL fetch, shell, code execution, plugins or filesystem tools are
  available to agents. Prompt boundaries reduce risk but do not prove immunity
  to prompt injection or hallucination.
- Model output is schema-validated; agent/node/peer/citation IDs are checked.
  Valid citation IDs do not establish factual truth or semantic entailment.
- Source citations (`S...`), synthetic memories (`M...`) and generated fictional
  interviews (`I...`) have distinct provenance and are validated against the
  actual context supplied to the model. Operation traces record bounded task/tool
  input/output, never provider authorization headers or private chain-of-thought.
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

`npm audit` (run through the corporate registry mirror, because the public
advisory endpoint fails TLS from the development machine) reports **0
vulnerabilities** as of the last review. Earlier moderate `fast-uri` advisories
were cleared by updating to `3.1.9` / `4.2.3`. AJV 8 is constrained to a patched
compatible release without replacing ESLint's separate AJV 6 API, and the maintained
static-file plugin replaces an initially vulnerable older major.

This is a point-in-time result, not a guarantee. Run `npm audit` against your
approved registry before every deployment. CI fails on new high/critical findings.
See [docs/security-review.md](./docs/security-review.md) and
[docs/threat-model.md](./docs/threat-model.md) for what was checked and what remains open.

## Troubleshooting

| Symptom                                     | Action                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.ps1 cannot be loaded`                  | Use `npm.cmd`; do not weaken PowerShell execution policy                                                                                                                           |
| UI cannot reach backend                     | Start both dev processes, check `/api/health`, and verify root `PORT`                                                                                                              |
| `EADDRINUSE`                                | Stop the specific prior app process or choose another port; do not kill unrelated Node processes                                                                                   |
| 403 host/origin                             | Add the exact trusted hostname/origin to its allowlist and restart; do not use a wildcard                                                                                          |
| AI option disabled                          | Inspect provider status; configure model name, endpoint and required server-side key                                                                                               |
| Model 401/404                               | Verify key, Azure deployment name, endpoint path and model/API compatibility                                                                                                       |
| Model `MODEL_REFUSED`                       | The provider's content filter blocked a request; the message names the flagged categories. Review the text or the deployment's filter policy. No fallback is used                  |
| Model `MODEL_PARAMETER_UNSUPPORTED`         | The deployment rejected a request parameter (named in the message). Use a Chat Completions model that supports JSON output and `max_completion_tokens`                             |
| Model 429/timeout                           | Reduce agents/rounds, check provider quota or local inference capacity; errors remain visible                                                                                      |
| Invalid model JSON/citation                 | Use a model reliable at the documented structured schema; no fabricated fallback is returned                                                                                       |
| SQLite busy/sync problems                   | Use one process and a non-synchronized local `DATA_DIR` (the readiness card and startup log warn about OneDrive/Dropbox/Drive/iCloud paths); restore a known-good backup if needed |
| Work marked failed after restart            | Retry explicitly; interrupted in-memory work is not durable/resumable                                                                                                              |
| Docker named-pipe error                     | Start Docker Desktop/engine first; Compose parsing alone does not validate an image                                                                                                |
| Export not appearing in an embedded browser | Open the app in a normal browser; embedded hosts may intercept downloads. Export HTTP payloads/attachments are independently tested                                                |
| Zod `@__PURE__` build warnings              | Current upstream comments produce two non-fatal Rollup annotation warnings; builds still validate                                                                                  |

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
