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

| Concern | Reference implementation | Inspected paths |
| --- | --- | --- |
| UI | Vue 3, JavaScript, Vite, Vue Router, Axios, D3, vue-i18n | `frontend/package.json`, router, Home, interaction component |
| HTTP API | Flask + flask-cors; graph, simulation, report blueprints | `backend/app/__init__.py`, `backend/app/api/` |
| Python environment | Python >=3.11,<3.13; uv/hatch; Pydantic | `backend/pyproject.toml` |
| Document intake | PDF via PyMuPDF; text/Markdown; encoding detection | `backend/app/utils/file_parser.py`, graph API |
| Knowledge | LLM ontology, Zep Cloud graph ingestion and search | ontology generator, graph builder, Zep tools |
| Model access | OpenAI Python SDK / Chat Completions compatibility layer | `backend/app/utils/llm_client.py` |
| Agent generation | Graph-grounded synthetic profiles and activity/platform/time configuration | profile and simulation configuration generators |
| Simulation | `camel-oasis==0.2.5`, `camel-ai==0.2.78`; subprocesses, action logging, filesystem IPC interviews | parallel simulation script, runner, IPC service |
| Memory | Batched simulation activity written to hosted Zep graph | Zep graph memory updater |
| Reports | Bounded tool calls, section planning, reflection, graph search, interviews | `report_agent.py`, `zep_tools.py` |
| Storage | Project/config/report JSON, uploaded/extracted text, action JSONL, OASIS SQLite, hosted graphs | project model, runner, report service |
| Progress | Background threads/processes, polling endpoints, report log streams | task model and API routes |
| Authentication | No user-authentication layer in inspected application initialization/routes | app factory and APIs |
| Deployment | One development-mode image containing Python + Node; volume for uploads; GHCR build workflow | Dockerfile, Compose, image workflow |

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

Not implemented in this milestone: PDF/OCR, arbitrary webpage fetching, live social
network access, OASIS compatibility, thousands of agents, simultaneous dual-platform
simulation, semantic neural embeddings, multi-user authentication, or calibrated
real-world probabilities. The UI must not imply otherwise.

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
            │    ├─ knowledge extraction
            │    ├─ fictional persona setup
            │    ├─ seeded simulation / model decisions
            │    ├─ limitations/review
            │    └─ source-linked report
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

## Azure migration direction

The local MVP is the prerequisite. Do not deploy paid resources merely to run it.
See the final deployment section in [README.md](./README.md) for operations.

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
