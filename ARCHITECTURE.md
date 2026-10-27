# Swarm Lab architecture

## Reference analysis

The reference is [MiroFish](https://github.com/666ghj/MiroFish), inspected at
commit `7657031ac01184afe2cb220f5ee3545573b5e843` on 2026-10-26. This is an
independent implementation, not a fork or a port. See [NOTICE.md](./NOTICE.md).

### What MiroFish actually implements

Its primary user journey is:

1. Upload PDF, Markdown, or text seed documents and a simulation requirement.
2. Use an OpenAI-compatible LLM to generate an entity/relationship ontology.
3. Chunk documents and ingest them into a Zep Cloud standalone knowledge graph.
4. Read graph entities, generate OASIS agent profiles and simulation settings.
5. Run Twitter-like and/or Reddit-like OASIS environments using CAMEL agents.
6. Persist actions and write simulated episodes back into graph memory.
7. Use a ReAct-style ReportAgent to plan and write a report, using graph-search
   tools and interviews with simulated agents.
8. View/download the report and converse with the report agent or personas.

These are synthetic scenarios, not empirically calibrated forecasts. The
reference's claims of predictive fidelity are not a guarantee.

### Reference components and evidence

| Concern            | Reference implementation                                                                          | Inspected paths                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| UI                 | Vue 3, JavaScript, Vite, Vue Router, Axios, D3, vue-i18n                                          | `frontend/package.json`, router, Home, interaction component |
| HTTP API           | Flask + flask-cors; graph, simulation, report blueprints                                          | `backend/app/__init__.py`, `backend/app/api/`                |
| Python environment | Python >=3.11,<3.13; uv/hatch; Pydantic                                                           | `backend/pyproject.toml`                                     |
| Document intake    | PDF via PyMuPDF; text/Markdown; encoding detection                                                | `backend/app/utils/file_parser.py`, graph API                |
| Knowledge          | LLM ontology, Zep Cloud graph ingestion and search                                                | ontology generator, graph builder, Zep tools                 |
| Model access       | OpenAI Python SDK / Chat Completions compatibility layer                                          | `backend/app/utils/llm_client.py`                            |
| Agent generation   | Graph-grounded synthetic profiles and activity/platform/time configuration                        | profile and simulation configuration generators              |
| Simulation         | `camel-oasis==0.2.5`, `camel-ai==0.2.78`; subprocesses, action logging, filesystem IPC interviews | parallel simulation script, runner, IPC service              |
| Memory             | Batched simulation activity written to hosted Zep graph                                           | Zep graph memory updater                                     |
| Reports            | Bounded tool calls, section planning, reflection, graph search, interviews                        | `report_agent.py`, `zep_tools.py`                            |
| Storage            | Project/config/report JSON, uploaded/extracted text, action JSONL, OASIS SQLite, hosted graphs    | project model, runner, report service                        |
| Progress           | Background threads/processes, polling endpoints, report log streams                               | task model and API routes                                    |
| Authentication     | No user-authentication layer in inspected application initialization/routes                       | app factory and APIs                                         |
| Deployment         | One development-mode image containing Python + Node; volume for uploads; GHCR build workflow      | Dockerfile, Compose, image workflow                          |

The API is grouped under `/api/graph`, `/api/simulation`, and `/api/report`.
It includes project management, ontology/build tasks, graph reads, simulation
preparation/start/stop/status/actions/posts/interviews, report generation/progress,
downloads and report chat. The frontend routes follow these workflow stages.

### Reference services and configuration

Required: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME`, and `ZEP_API_KEY`.
The documented model is Alibaba Qwen through an OpenAI-compatible endpoint;
other compatible providers are supported. Optional acceleration uses
`LLM_BOOST_API_KEY`, `LLM_BOOST_BASE_URL`, `LLM_BOOST_MODEL_NAME`.

Other inspected configuration includes `SECRET_KEY`, `FLASK_DEBUG`,
`FLASK_HOST`, `FLASK_PORT`, `OASIS_DEFAULT_MAX_ROUNDS`,
`REPORT_AGENT_MAX_TOOL_CALLS`, `REPORT_AGENT_MAX_REFLECTION_ROUNDS`,
`REPORT_AGENT_TEMPERATURE`, and `VITE_API_BASE_URL`.
`ZEP_API_URL` is explicitly rejected by the inspected reference: it targets
Zep Cloud, not a configurable local Zep server.

No independently configured embedding model, local vector database, Neo4j or
Graphiti deployment is present in the inspected application. Zep manages hosted
knowledge/search internals. Live Twitter/Reddit credentials are unnecessary;
these are simulated social environments, not live social-network clients.

Zep's proprietary service internals, private model weights, training data, and
production hosting environment cannot be reconstructed from this source.
Free service quotas are not the same as an offline implementation.

## Our scope and deliberate differences

Essential: bounded document intake, a source-linked knowledge representation,
synthetic personas, a stateful agent simulation, progress/cancellation, reporting,
evidence inspection, optional real model interactions, and persistent history.

Not implemented: OCR, arbitrary webpage fetching, live social
network access, OASIS compatibility, thousands of agents,
semantic neural embeddings, multi-user authentication, or calibrated
real-world probabilities. The UI must not imply otherwise.

Version 0.2 adds text-PDF extraction, real guided-stage boundaries, independent
dual-platform contexts, synthetic memory, report-tool traces/chapters and
asynchronous surveys. It does not turn the local lexical engine into generative AI.

### Live-console interaction reference

The live `/mirofish-demo/console` was followed through all five screens:
source/question entry; ontology/graph build; persona/configuration preparation;
two-platform execution with memory feedback; report/operation inspection; and
report/persona interaction with multi-target survey selection. Its own entry
page says it is a static demo without connected agent-chat inference.

Our UI adopts the guided interaction model, light technical layout and
Graph/Split/Workbench views with an original Swarm Lab design. Its counters,
graphs, statuses, event streams, reports and traces come from actual persisted
execution. No demonstration case, asset, graph dataset or prerecorded output was copied.

The default local engine uses real, reproducible opinion-dynamics calculations.
Topic extraction is term-frequency/co-occurrence based, not semantic AI extraction.
Reports are computed from recorded states, not fabricated AI prose. Local follow-up
is labeled evidence lookup, not an AI interview.

Model-assisted mode makes actual configured-provider requests for knowledge,
personas, per-round decisions, reports and interviews. It must fail visibly rather
than fall back to local output after a provider or schema error.

## Local components

```text
React + TypeScript
  └─ same-origin /api requests (Vite proxy during development)
       └─ Fastify / TypeScript
            ├─ validation, origin/host checks, rate and size limits
            ├─ SQLite repository: projects, chunks, events, conversation
            ├─ bounded single-worker orchestration queue
            │    ├─ ontology + source graph (then pause)
            │    ├─ fictional persona + editable environment (then pause)
            │    ├─ independent platform rounds + synthetic memory (then pause)
            │    └─ bounded report tools + progressive chapters (then interaction)
            ├─ isolated PDF text-extraction worker
            ├─ bounded chat / asynchronous survey ownership
            └─ model adapter (optional)
                 ├─ Ollama local HTTP API
                 ├─ OpenAI-compatible Chat Completions
                 └─ Azure OpenAI / Foundry OpenAI v1
```

Node 24 supplies SQLite without a native npm addon. The installed Python 3.15 is
outside the reference's supported Python range, while Node 24 is already available.
A single TypeScript runtime also keeps shared request/result types straightforward.

### Data and model boundaries

Source names never become filesystem paths. Documents are plain text data in
SQLite; chunks have stable citation IDs and offsets. Local retrieval uses sparse
TF-IDF vectors and cosine similarity, explicitly not neural embeddings.

All model input is serialized data bounded by context budgets. Retrieved content,
persona memories and model outputs are untrusted, not higher-priority instructions.
Agents have no shell, arbitrary URL fetcher, filesystem browser or code-execution
tool. Model JSON is schema-validated and IDs/citations are checked against the
current project. Browser rendering is plain text/React escaping.

One process owns one bounded queue and one SQLite database. Queued/running work
interrupted by restart is explicitly failed, not silently resumed or reported as
complete. This is a local, single-user architecture, not a distributed job system.

### Implemented module boundaries

| Module                             | Responsibility                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `shared/types.ts`                  | Shared input validation, limits and request/result types                                                       |
| `backend/src/app.ts`, `routes/`    | HTTP boundaries, safe errors, CSP, host/origin and request/rate limits                                         |
| `backend/src/storage/`             | SQLite persistence, storage decoding, events, conversations and restart recovery                               |
| `backend/src/knowledge/`           | Stable source chunks, sparse TF-IDF retrieval, lexical graph and citation validation                           |
| `backend/src/agents/`              | Persona setup, simultaneous state updates, model tasks, review and reporting                                   |
| `backend/src/models/`              | Bounded provider transport, schemas, timeouts/retries and usage reporting                                      |
| `backend/src/orchestration/`       | Shared quick/guided queue ownership, cancellation, follow-up locking and survey lifecycle                      |
| `backend/src/guided/`              | Gated ontology/preparation/worlds, source/memory/timeline/interview tools and chapter generation               |
| `backend/src/ingest/`              | Isolated local PDF parsing with byte/page/text/time/heap limits and no credential inheritance                  |
| `shared/guided.ts`                 | Persisted stage, environment, memory, trace, survey and editing contracts                                      |
| `frontend/src/hooks/`              | Race/abort-safe project lifecycle, history and active-run polling                                              |
| `frontend/src/components/console/` | Light guided entry, graph/split/workbench, inspectors, preparation, streams, report/tool trace and interaction |

The stateful agents are fictional proxies with an inclination in `[-1, 1]`,
topic interests, influence, openness and four recent memory entries. All round
actions remain persisted in the project snapshot. Local updates read the prior
round population before applying any changes; per-agent iteration order does
not create sequential-update bias.

Community exposure uses up to five compatible peers, topic affinity and an
inclination confidence bound of `0.95`. Broadcast exposure uses up to four
highest-influence peers. Openness weights convergence, seeded noise is bounded,
and a scheduled intervention applies only in its nominated round. These rules
are explicit assumptions, not fitted human-behavior parameters.

Model-assisted tasks use distinct constrained prompts and schemas for graph,
personas, configuration, each platform round and report. Review/limitations are also
computed server-side. A bounded report plan can request local source/memory searches
and up to two fictional interviews; only fixed, validated tools can run.
There is no open-ended ReAct loop or arbitrary model-selected execution.
User follow-ups receive retrieved passages, recorded report/persona state and a
bounded conversation excerpt. There is no external web-research agent.

Info Plaza and Topic Community start from separate copies of the prepared
population, use broadcast/community exposure respectively, and keep independent
state and memory. Matching simulated round clocks do not merge their histories.
The aggregate snapshot averages the same proxy across selected platforms; shares
are based on this original population, not a doubled independent sample.

Initial posts are explicit scenario inputs. In local mode their strength/stance
applies an assumed directional adjustment at round one. Model-assisted rounds
receive the inputs as untrusted assumptions. Scenario minutes advance when actual
round results persist, not through a presentation timer.

Report model calls produce a real outline, optional interviews, summary and each
chapter sequentially. Draft chapters remain visibly incomplete until the stage
succeeds. Source IDs, synthetic-memory IDs and interview IDs are checked separately.
No hidden reasoning or provider headers are placed in operation traces.

Support/opposition thresholds are `>= +0.2` / `<= -0.2`; all remaining proxies are
undecided. Polarization is population standard deviation, not a calibrated
political/social measure. Local interactions count actual selected peer exposures;
model interactions count validated peer IDs reported in decisions.

### Persistence and failure semantics

SQLite schema version 1 has `projects`, `chunks`, `events` and `messages`.
JSON payloads are decoded with runtime schemas. SQL values are parameterized and
source filenames never become paths. Foreign-key deletion removes associated
chunks/events/conversation. WAL is for a local filesystem, not a shared cloud volume.
Startup detects OneDrive, Dropbox, Google Drive and iCloud Drive folders in the
resolved database path and warns through the server log and the console's readiness
card (without exposing the local path), because synchronization can conflict with
WAL files and would upload source material to a cloud provider.

Guided project state is `draft -> queued -> running -> ready` for each of
knowledge, environment and simulation. Report completion changes it to `completed`.
Every stage has its own pending/queued/running/ready/failed/cancelled state.
Quick-run compatibility retains `draft -> queued -> running -> completed`, or explicit
`failed`/`cancelled`. An active cancellation remains running until in-flight work
has stopped; restart is rejected while the previous worker still owns the job.
Successful completion follows report persistence. Completed projects require
duplication rather than destructive reruns. No provider failure becomes a
success-shaped local fallback.

Payload decoding defaults older rows to `workflow: quick` and `console: null`;
no existing project is rewritten as if a second world, ontology or operation trace
had been recorded. The existing SQLite table schema stays at version 1; guided
payloads and exports carry their explicit new shape (guided export version 2).
Restart recovery fails active stages, platform states, traces and surveys while
retaining completed upstream output and partial survey responses.

Survey batches share the global follow-up lock with chat, not the simulation
queue. They expose persisted per-target progress, cancellation, a five-minute
deadline and partial failure. Local state mode returns numeric recorded positions
with null generated answers. Model-interview mode requires the scenario's real
configured provider; it cannot silently fall back to those state snapshots.

See [README.md](./README.md) for tested operations, resource limits, API shapes,
security assumptions and the currently unresolved transitive dependency advisory
status. Deployment must not infer production readiness from local test success.

## Azure migration direction

The local MVP is the prerequisite. Do not deploy paid resources merely to run it.
See [docs/AZURE.md](./docs/AZURE.md) for the phased migration plan and acceptance
criteria, and [README.md](./README.md) for local operations.

1. Keep the same React/API container. Prefer **Azure Container Apps** for an existing
   container workflow, or **App Service** when built-in Entra authentication and
   conventional web hosting are the stronger fit. Choose one, not both.
2. Replace API-key model authentication with managed identity for **Azure OpenAI /
   Foundry**. Use a deployed model supporting JSON Chat Completions.
3. Before durable public hosting, replace local SQLite with a managed database
   adapter and externalize durable job ownership. A small managed PostgreSQL
   database is a natural relational choice. Do not put SQLite WAL on Azure Files,
   depend on an ephemeral container filesystem, or scale this queue across replicas.
4. Add **Blob Storage** only when document size/retention requires separating files
   from database records. Add **Azure AI Search** only when measured retrieval needs
   semantic/vector search at a corpus size beyond the bounded local index.
5. Use **Key Vault** for unavoidable secrets; managed identity is preferable to
   storing Azure model keys. Add **Application Insights / OpenTelemetry** for
   production operational telemetry with content and credential redaction.
6. **Functions** do not simplify the stateful simulation loop. **Cosmos DB** is not
   necessary for this relational local schema and would require a distinct adapter.

Production prerequisites: authentication/authorization and tenant isolation,
durable storage and jobs, backup/restore verification, HTTPS, quotas/cost controls,
secret management, telemetry, source availability, and a deployment security review.
None of these are implied by a successful local demonstration.
