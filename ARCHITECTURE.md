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

Version 0.3 adds the checkpointed what-if loop (pause, resume, one scheduled intervention, branching from a
saved round with declared changes, and run comparison; see "Checkpoints, pause/resume, branching and
comparison" below), a JSON snapshot export, an accessibility and responsive-layout rework of the console, a
validated `RATE_LIMIT_SCALE` setting, and the browser/load verification described in "Verification
architecture".

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
personas, a decision for every proxy on every platform in every round, reports,
a grounding check and interviews. It must fail visibly rather than fall back to
local output after a provider or schema error.

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
                      └─ Microsoft Entra ID token (DefaultAzureCredential) or API key
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

| Module                             | Responsibility                                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/types.ts`                  | Shared input validation, limits and request/result types                                                                                                                                                    |
| `backend/src/app.ts`, `routes/`    | HTTP boundaries, safe errors, CSP, host/origin and request/rate limits                                                                                                                                      |
| `backend/src/storage/`             | SQLite persistence, numbered migrations with a backup, the ledger store, the hash-chained audit log, events and restart recovery                                                                            |
| `backend/src/knowledge/`           | Stable source chunks, sparse TF-IDF retrieval, lexical graph and citation validation                                                                                                                        |
| `backend/src/agents/`              | Persona setup, local state updates, per-proxy model decisions (`actor.ts`), peer selection (`peers.ts`), review and reporting                                                                               |
| `backend/src/grounding/`           | Verbatim quote matching, claim verdicts, entailment check, chapter-claim validation, the review, and the evidence ledger: classification, publication policy, cross-source conflicts and the ledger service |
| `backend/src/auth/`                | Optional Entra token verification, roles, the default-deny route table and the request guard                                                                                                                |
| `backend/src/studio/`              | Report Studio: the rules of a document (versions, locks, review states, the hash an approval is of), the service, chapter regeneration, and the memo, Markdown and JSON exports                             |
| `backend/src/models/`              | Bounded provider transport, Entra tokens, bounded repair loop, schemas, timeouts/retries, usage and provider telemetry                                                                                      |
| `backend/src/orchestration/`       | Shared quick/guided queue ownership, cancellation, follow-up locking and survey lifecycle, and the analyst's evidence gate and citation checks                                                              |
| `backend/src/guided/`              | Gated ontology/preparation/worlds, source/memory/timeline/interview tools and chapter generation                                                                                                            |
| `backend/src/ingest/`              | Isolated local PDF parsing with byte/page/text/time/heap limits and no credential inheritance                                                                                                               |
| `shared/guided.ts`                 | Persisted stage, environment, memory, trace, survey and editing contracts                                                                                                                                   |
| `frontend/src/hooks/`              | Race/abort-safe project lifecycle, history and active-run polling                                                                                                                                           |
| `frontend/src/components/console/` | Light guided entry, graph/split/workbench, inspectors, preparation, streams, report/tool trace, interaction and the evidence ledger                                                                         |
| `evaluation/`                      | Labelled datasets pinned to their sources, the offline harness, thresholds and results                                                                                                                      |

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
personas, configuration, each proxy's decision and report. Review/limitations are
also computed server-side. A bounded report plan can request local source/memory
searches and up to two fictional interviews; only fixed, validated tools can run.
There is no open-ended ReAct loop or arbitrary model-selected execution.
User follow-ups receive retrieved passages, recorded report/persona state and a
bounded conversation excerpt. There is no external web-research agent.

**Per-proxy decisions.** In model mode each proxy decides separately: one provider
call per proxy per platform per round, four at a time under one limiter shared by
both platforms. A call carries only that proxy's own profile, goals and constraints,
its last four private memory entries, up to three passages it holds (its own cited
passages first, then relevant ones), the **public** posts of the peers its platform's
network rules expose to it (broadcast: top influence; community: shared topics and
similar views within the confidence bound; silence is invisible; round one sees only
the platform's seed posts), and the scheduled event as an assumption. It never sees
another proxy's memory, persona, rationale or confidence, or the other platform. The
reply is `{opinion, type, content, peerIds, sourceIds, rationale, confidence}` and is
validated server-side: peers must come from what the proxy observed, sources from what
it held, a reply must name a peer, and opinion may move at most 0.5 per round. A
violation is sent back for a bounded number of corrective retries (two by default;
three for report chapters and report plans) and otherwise fails the stage. The first failure aborts both platforms' in-flight and queued calls
synchronously. Rounds still persist atomically as one combined write, so pause,
resume and branching are unchanged, and a hard per-stage call budget bounds spend.
The stored `rationale` is the short reason the model chose to state, not hidden
reasoning, and `confidence` is the proxy's self-reported firmness.

**Grounding.** Report chapters list the statements they rest on, each labeled with
one of six kinds. `backend/src/grounding/` then verifies them: verbatim quote matching
over normalized text (an ellipsis allows omissions; fragments must appear in order in
one passage), word overlap against the cited passage or simulation memory, and figure
checks against the cited material or the recorded simulation metrics. One independent
call judges support/contradiction, and each judgement must quote real text from the
passage (an over-long quote is cut to the limit and one whose start is verbatim is
accepted; one with no verbatim start is rejected and repaired). The verdict is a pure,
tested function of the checks; a model judgement can lower or confirm but cannot create
support without lexical overlap, which limits what a hostile passage can do. A failed
model check degrades to deterministic verdicts and says so; a cancellation is never
swallowed. Graph nodes carry the same verified verbatim quote. Only listed statements are
verified; figures in unlisted prose are compared with the recorded data and cited passages.

**Repairs that only remove, shorten or weaken.** A live model fails on format far more
often than on substance, and a report that failed whole because the model repeated one slip
through every correction was the largest reliability problem found live. Before a chapter is
validated and again on the reply that is kept, `grounding/normalize.ts` and
`grounding/quotes.ts` apply pure, idempotent repairs: statements past six are left out;
identifiers that were not supplied are removed (a statement that needs a citation and has
none left is still rejected); a quote that runs past the cited text is cut to its verbatim
start; a quote with none is dropped; and a statement labelled a source fact without a
verbatim quote is shown as an extracted claim. A repair never adds a citation, a quote or a
statement, and a verdict never depends on a label the model chose. Every repair is counted
and listed in the grounding review's notes. The same idea applies to graph nodes
(`grounding/graph.ts`). Whatever cannot be repaired this way (an invented figure, a
statement its own passage does not back, a simulated event with no recorded memory) is
reported or rejected, not smoothed over.

**The evidence ledger.** `grounding/ledger.ts` turns the grounding review into records, one per
material statement, with a statement type (ten), a support class (eight, from the verdicts and the
conflicts) and a **publication status** that decides how the product may show it. The policy is a pure
function of type and class: a source statement that another source contradicts becomes partly
supported, an unsupported statement is only ever a labelled hypothesis, and accepting a statement in
review records that a person looked without changing its class. Each record points at its evidence
(passage, offsets, a SHA-256 of the passage, a verbatim quote only if one was found), at the
assumptions it depends on and at the simulated events behind it. `grounding/contradictions.ts` finds
candidate conflicts between sources (shared quantity over the same explicit period, or shared topic
words with differing figures); they stay candidates until a person confirms or dismisses them, and
dismissing one recalculates the statements it touched. `grounding/service.ts` builds the ledger lazily
from the report's review, keeps human decisions across a rebuild, derives the assumption register from
the scenario and writes the audit log. See [ADR 0001](./docs/adr/0001-evidence-integrity-model.md) and
[ADR 0003](./docs/adr/0003-schema-migrations-and-audit-log.md).

**The analyst's gate.** `orchestration/evidence-gate.ts` reads the question against the project's
passages and its own report, graph and recorded activity before any model is called. If the key terms,
the years it names and the best passage score cannot support an answer, the reply is a fixed sentence
and no model call is made. When the gate lets a question through, the model is shown the passages, the
recorded memories and the ledger's statements (least supported first, at most 40) and must cite one or
decline; ids are checked against what it was shown, and the reply records a grounding status (cited,
caveated, abstained or uncited). Personas are never shown the ledger and the gate does not apply to
them. It is a lexical gate and says so: it cannot see meaning ([ADR 0002](./docs/adr/0002-abstention-and-citation-rule.md)).

**Report Studio.** The generated report is never changed. `studio/` makes a document from it, held as one
JSON row per project in `studio_documents`, with sections (the summary, each chapter, the limitations), each
a list of versions, and locks, reviewer notes, regenerated text waiting for a decision, the review decisions,
the approval and an archive. `studio/model.ts` holds the rules as pure functions of a document: only
`draft` and `changes-requested` can be edited, a save names the section version it was made on, a decision
names the document revision, and an approval stores a SHA-256 over every section's id and text. `service.ts`
saves with `WHERE revision = ?` and writes the audit entry in the same transaction. The statements of a
chapter are the ledger's, tied to the hash of the text they were checked against; once a person changes the
text they are shown as describing an earlier text and are not listed as findings. `regenerate.ts` asks the
model to write one chapter again with the report writer's own prompt and the same grounding review, and the
result is a proposal that changes nothing until accepted. `export.ts` draws the memo (HTML with no script,
served under `default-src 'none'`), Markdown and JSON from one memo structure, so they cannot disagree. Two
capabilities, `edit` and `review`, keep editing and approving apart. See
[ADR 0011](./docs/adr/0011-report-studio.md).
**Identity.** `auth/` runs as an `onRequest` hook, so it authenticates before a body is parsed. With
`AUTH_MODE=none` the caller is a local administrator in a `local` tenant and nothing changes. With
`AUTH_MODE=entra`, `tokens.ts` verifies the signature (RS256 only), audience, lifetime, tenant
allow-list and an issuer derived from the token's own tenant, and answers every failure alike.
`policy.ts` is a default-deny table keyed by route, and a test fails if a registered route is missing
from it. Projects carry `tenant_id` and `owner_id`; a project in another tenant answers exactly as a
missing one. See [ADR 0005](./docs/adr/0005-identity-roles-and-tenancy.md).

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
chapter sequentially, then a grounding review. Draft chapters remain visibly
incomplete until the stage succeeds. Source IDs, synthetic-memory IDs and interview
IDs are checked separately. No hidden reasoning or provider headers are placed in
operation traces.

Support/opposition thresholds are `>= +0.2` / `<= -0.2`; all remaining proxies are
undecided. Polarization is population standard deviation, not a calibrated
political/social measure. Local interactions count actual selected peer exposures;
model interactions count validated peer IDs reported in decisions.

### Provider layer

`ModelClient` is the only gateway to a model. For Azure it acquires a Microsoft Entra
token for `https://cognitiveservices.azure.com/.default` (or sends `api-key` only when
`AZURE_OPENAI_AUTH=key`), sends it only to an allow-listed Azure AI host, never follows
redirects, bounds request and response size, and maps failures to actionable codes
(`MODEL_AUTH` naming the missing role, `MODEL_NOT_FOUND`, `MODEL_RATE_LIMIT`, ...)
without echoing provider bodies. Every call site supplies a server-side validator that
is used twice: as the bounded repair hook and again on the final value, so no gateway
can skip a check. `ProviderTelemetry` counts calls, repairs, failures and tokens and
tracks connectivity (`unverified` until a real call succeeds) without storing content;
it feeds `GET /api/provider/status`, which drives the always-visible header badge.

Untrusted text reaches a model only inside a JSON `untrustedScenarioData` object. Three layers
stand between that text and an obeyed instruction, because a live run showed that prompt wording
alone is not enough (a small model repeated a planted token in 24 of 24 statements):

1. The system boundary says that an instruction inside the data is content to describe, never a
   command, and that its text must not be repeated; a trusted `serverReminder` placed **after**
   the data says the same as the last thing the model reads.
2. `models/injection.ts` finds AI-directed instruction text in the data (phrasing such as "note to
   the AI" or "ignore previous instructions", and the codes or quoted phrases such a line asks
   for), and `ModelClient` rejects any reply that repeats one, asking again without repeating the
   payload. It is a deterministic heuristic with stated limits: it does not stop steering that
   repeats nothing, and a document that quotes an injection phrase makes replies repeating it fail
   explicitly (`MODEL_OUTPUT_INVALID`).
3. The user is told which source passages contain such text (a note on the graph).

Server-side validators (citation IDs, quotes, ranges) then bound what any reply can carry.

### Persistence and failure semantics

SQLite is at schema version 7, applied by numbered migrations (`storage/migrations.ts`): version 1
is the original `projects`, `chunks`, `events` and `messages`; version 2 adds `claim_records`,
`source_conflicts`, `ledger_state` and the append-only `audit_events`; version 3 adds `tenant_id` and
`owner_id` to projects; version 4 adds workspace and project membership; version 5 adds browser sign-in
(`login_attempts`, `sessions`); version 6 adds the durable job queue (`jobs`); version 7 adds Report
Studio documents (`studio_documents`). An existing database file is copied before it is upgraded, a failed
step rolls back, and a database newer than the build is refused untouched. The same migrations exist for
the optional PostgreSQL adapter.
JSON payloads are decoded with runtime schemas. SQL values are parameterized and
source filenames never become paths. Foreign-key deletion removes associated
chunks/events/conversation. WAL is for a local filesystem, not a shared cloud volume.
Startup detects OneDrive, Dropbox, Google Drive and iCloud Drive folders in the
resolved database path and warns through the server log and the console's readiness
card (without exposing the local path), because synchronization can conflict with
WAL files and would upload source material to a cloud provider.

Guided project state is `draft -> queued -> running -> ready` for each of
knowledge, environment and simulation. Report completion changes it to `completed`.
Every stage has its own pending/queued/running/ready/failed/cancelled state, and the
simulation stage adds a non-error `paused` state (the project itself is `ready`).
Quick-run compatibility retains `draft -> queued -> running -> completed`, or explicit
`failed`/`cancelled`. An active cancellation remains running until in-flight work
has stopped; restart is rejected while the previous worker still owns the job.
Successful completion follows report persistence. Completed projects require
duplication rather than destructive reruns. No provider failure becomes a
success-shaped local fallback.

Payload decoding defaults older rows to `workflow: quick` and `console: null`;
no existing project is rewritten as if a second world, ontology or operation trace
had been recorded. Guided payloads and exports carry their explicit shape (guided export version 2).
Restart recovery fails active stages, platform states, traces and surveys while
retaining completed upstream output and partial survey responses. A simulation
interrupted after saved rounds is marked `failed` with a message naming the saved
round, and remains resumable (see below).

### Checkpoints, pause/resume, branching and comparison

A simulation round is the unit of durability. `runPlatforms` writes the combined
history, both platform populations, the aggregated proxies and the new memories in
**one** `repository.update`, so persisted state can never describe half a round.
`guided/checkpoint.ts` then defines a _checkpoint_ as the last round on which the
combined history, every platform's `currentRound`/`rounds` and the population size
all agree; resume, intervention and branching only trust a state that passes it.

- **Pause** (`Orchestrator.pause`) aborts the running simulation with `RUN_PAUSED`.
  The round in flight is discarded (never partially saved). With at least one saved
  round the step becomes `paused` and the project `ready` with no error; with none,
  it becomes `cancelled`. Cancel remains available and also keeps saved rounds.
- **Resume** is `POST /steps/simulation {resume:true}`. It requires a valid
  checkpoint, restores each platform's population from the persisted state and
  continues at `checkpoint + 1`. The local engine is a pure function of
  `(population state, settings, seed + round * 9973)`, which is why a resumed run
  matches an uninterrupted one exactly. A resume of a model run is refused if the
  configured provider/model differs from the one that produced the saved rounds.
- **Intervention** (`guided/whatif.ts#setIntervention`) edits the single scheduled
  intervention for a round after the checkpoint. It is refused for a finished run,
  and if the run already applied its intervention in a saved round.
- **Branch** (`createBranch`) creates a new guided project that copies the source
  documents (identical chunk IDs), graph, ontology and environment, truncates the
  history to `fromRound`, rebuilds each platform's population from the saved
  per-round opinions and recorded memories, applies the declared changes only to the
  rounds that follow, and records `console.branch` (`parentId`, `rootId`,
  `fromRound`, `changes`). The source is never modified. Replacing an intervention
  already applied in the copied rounds is refused (the settings hold one).
- **Compare** (`guided/compare.ts`) reads two histories and reports per-round
  metrics, deltas, a lineage classification, and `identicalThroughRound`, which is
  computed from the recorded opinions rather than trusted from lineage metadata.

Evidence: `backend/test/whatif.test.ts` (determinism, tampering, recovery,
conflicts), `backend/test/whatif-model.test.ts` (model-mode resume, token accounting
and provider-change refusal, against a scripted double).

Survey batches share the global follow-up lock with chat, not the simulation
queue. They expose persisted per-target progress, cancellation, a five-minute
deadline and partial failure. Local state mode returns numeric recorded positions
with null generated answers. Model-interview mode requires the scenario's real
configured provider; it cannot silently fall back to those state snapshots.

See [README.md](./README.md) for tested operations, resource limits, API shapes and
security assumptions, and [docs/security-review.md](./docs/security-review.md) and
[docs/threat-model.md](./docs/threat-model.md) for the dependency and threat evidence.
Deployment must not infer production readiness from local test success.

## Verification architecture

What each layer of testing can and cannot establish:

| Layer                      | Where                                          | Establishes                                                                                                                       | Does **not** establish                         |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Unit and integration       | `backend/test`, `frontend/src/**/*.test.ts(x)` | Business rules, state machine, determinism, contracts, security boundaries, component behaviour                                   | Browser rendering, real network behaviour      |
| Browser end-to-end (local) | `e2e/local`                                    | The whole user journey, errors, responsive layout, axe, keyboard/focus, in real Edge/Chromium, over real HTTP                     | Anything about model behaviour                 |
| Browser end-to-end (model) | `e2e/model`                                    | Orchestration of the model path: real Pause click, resume, injected failure + recovery, token accounting, hostile output handling | Quality or safety of a **live** model's output |
| Live verification          | `npm run azure:verify`                         | 15 checks of the whole journey against a real, running deployment (per-actor calls, grounding, branch, chats, injection probe)    | Quality beyond the counts it reports; scale    |
| Real-browser audit         | `scripts/ui-audit.mjs`                         | Screenshots and layout/axe metrics at four viewports for design review                                                            | Subjective design quality                      |
| Load measurement           | `scripts/load-test.mjs`                        | Latency percentiles, queue back-pressure and memory **on the machine it runs on**                                                 | Capacity planning                              |

**The fake provider** (`e2e/support/fake-provider.ts`) implements the Ollama `/api/chat` protocol so the real
`ModelClient`, orchestrator, persistence and UI run end to end with no credential. It derives each answer from
the request (population size, round, intervention, evidence IDs) and lets tests inject latency, a failure on a
chosen round, or an invented citation. It is a test double. Its existence must never be read as evidence about
any live model; live evidence comes only from `npm run azure:verify` against a real deployment (see
[docs/AZURE.md](./docs/AZURE.md#live-evidence)).

**Isolation.** Playwright starts two application servers (local engine; model-assisted) and the fake provider,
each with a throwaway data directory, so the suite can never touch a developer's own scenarios.

**`RATE_LIMIT_SCALE`.** Production limits are per IP and deliberately tight (for example 8 guided-stage requests
per minute). The browser suite and the load test multiply them through this validated setting (integer 1–1000,
default 1). The production limiter is tested separately, including that a real over-limit request answers
HTTP 429 `RATE_LIMITED` with `Retry-After`: this review found that it previously answered HTTP 500.

### Measured limits of the current design

`scripts/load-test.mjs` (Windows laptop, Node 24, local engine, 12 proxies × 8 rounds): 3,000 reads at
concurrency 64 had p95 72 ms (health) and 113 ms (project list); 12 concurrent workflows all completed with no
server errors, and the single worker's back-pressure produced 120 clean `QUEUE_FULL` rejections that clients
retried; peak server memory was about 341 MB. **While simulations run, read latency rises** to p95 ≈ 570 ms and
max ≈ 1.8 s, because rounds, JSON encoding and SQLite writes share one event loop. Two consequences are recorded
in the roadmap rather than hidden: simulation should move to a worker thread or separate process, and the
project-list endpoint decodes every stored payload instead of reading summary columns.

## Azure migration direction

The local MVP is the prerequisite. Do not deploy paid resources merely to run it.
See [docs/AZURE.md](./docs/AZURE.md) for the phased migration plan and acceptance
criteria, and [README.md](./README.md) for local operations.

1. Keep the same React/API container. Prefer **Azure Container Apps** for an existing
   container workflow, or **App Service** when built-in Entra authentication and
   conventional web hosting are the stronger fit. Choose one, not both.
2. Managed-identity authentication to **Azure OpenAI / Foundry** is implemented in the
   adapter (`DefaultAzureCredential`) and `infra/` creates an Entra-only account with
   keys disabled; both are unit tested but **not yet exercised live**. Use a deployed
   model supporting JSON Chat Completions.
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
