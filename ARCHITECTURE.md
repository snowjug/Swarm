# Swarm Lab architecture

Swarm explores "What could happen if X changes?" for any question. One Node.js 24 process serves a
React interface and a Fastify API over one validated store: a SQLite file by default, or PostgreSQL.
Two engines share the project and its evidence:

- **The scenario lab** (this build, [ADR 0014](./docs/adr/0014-scenario-lab.md)): a path from a
  question to a decision. It reads the question into a scenario, researches the public context or reads the
  sources a person attaches, proposes the participants of the decision and what constrains it, makes
  synthetic actors, runs a pure seeded population simulator many times for a baseline and its alternatives,
  reports what held across the runs, lets critics challenge the analysis and writes a Decision Canvas and a
  brief with recommendations and a validation plan. People review and approve the setup before anything is
  simulated.
- **The deep dive**: the original five-stage agent workflow (graph, environment, simulation, report,
  interaction) with fictional proxies, optional model-driven decisions, pause, intervention, branching,
  the evidence ledger, a grounded report, chat and Report Studio.

Every step has a rules path that needs no model, key or network, and a model is optional and never
silent. Nothing in the engine, the stakeholder step or the brief is written for a market, product or
industry; the example scenarios are only a question and some synthetic documents.

| To learn about                  | Read                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The lab, end to end             | [The scenario lab flow](#the-scenario-lab-flow) below, then the per-feature pages in [docs/analysis/](./docs/analysis/engine.md), [intake](./docs/scenario-intake.md), [stakeholders](./docs/stakeholders.md) |
| Automatic research              | [Automatic research](#automatic-research) below and [backend/src/research/README.md](./backend/src/research/README.md)                                                                                        |
| Constraints and the decision    | [Constraints and the engine](#constraints-and-the-engine), [The Decision Canvas](#the-decision-canvas), [constraints](./docs/analysis/constraints.md), [the canvas](./docs/analysis/decision-canvas.md)       |
| Model calls                     | [Model tasks](#model-tasks-one-output-policy-a-router-and-the-foundry-provider) and [docs/models/foundry.md](./docs/models/foundry.md)                                                                        |
| Hosting, telemetry, the guard   | [Hosting and operations](#hosting-and-operations-authored-not-deployed) and [docs/production/](./docs/production/README.md)                                                                                   |
| The system as a whole           | [System diagram](#system-diagram) and [Implemented module boundaries](#implemented-module-boundaries)                                                                                                         |
| The deep dive                   | [The five stages](#the-five-stages-of-the-deep-dive), [Local components](#local-components) and [Checkpoints, pause/resume, branching and comparison](#checkpoints-pauseresume-branching-and-comparison)      |
| The interface                   | [How the interface carries it](#how-the-interface-carries-it), [docs/UX.md](./docs/UX.md) and [ADR 0015](./docs/adr/0015-premium-interface.md)                                                                |
| Storage, both dialects          | [Persistence and failure semantics](#persistence-and-failure-semantics)                                                                                                                                       |
| What is not built or not proven | [Known limitations](#known-limitations)                                                                                                                                                                       |
| The routes and their shapes     | [docs/API.md](./docs/API.md)                                                                                                                                                                                  |

## The scenario lab flow

```mermaid
flowchart LR
    Q["Question and sources<br/>files, pasted text, a public page"] --> S["Scenario frame<br/>scenario/"]
    S --> G["Grounding<br/>passages and conflicts;<br/>research/ finds sources when asked"]
    G --> K["Participants<br/>stakeholders/"]
    K --> A["Actors<br/>key actors and cohorts"]
    A --> CN["Constraints<br/>constraints/"]
    CN --> R["Repeated seeded runs<br/>simulation/ and analysis/"]
    R --> C["Independent critics<br/>critics/"]
    R --> D["Decision Canvas<br/>decision/ (derived)"]
    R --> B["Decision brief<br/>brief/"]
    C --> B
    C --> D
    B --> V["Recommendations and<br/>validation plan"]
    D --> V
```

Each box that keeps a result keeps it as one validated JSON document of the project (an _artifact_,
below); the Decision Canvas keeps nothing, because it is worked out at every read. Research is the first
phase of grounding a project, and a person can add sources of their own beside it or instead of it. Every route is in
[docs/API.md](./docs/API.md); `backend/src/auth/policy.ts` says who may call
each one, and `auth/audit-policy.ts` what it records (counts and identifiers, never a question, a
quote or a name).

| Step                 | Code (`backend/src/`)                                                                                          | Contract (`shared/`)                           | Kept as artifact                            | Rules path                                                                                                                                                                                                                                     | Model path (optional)                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question to scenario | `scenario/` (`parse`, `rules`, `model`), `routes/scenario.ts`                                                  | `scenario.ts`                                  | `scenario`                                  | Patterns: an if or when clause, verbs of change, amounts, places, spans of time, named groups                                                                                                                                                  | Only when the person chose a model (`useModel`: a Model assisted project) and the server has one: one validated reading, at most two repairs, 170 seconds; if it fails or runs out of time the rules read it and a note says why |
| Evidence             | `ingest/url/` (`extract`, `boilerplate`), `ingest/pdf.ts`, `knowledge/`, `routes/evidence.ts`                  | `scenario.ts` (provenance), `types.ts`         | none (the project)                          | Files, pasted text, text PDFs, one public page fetched by the server (its own text, without its menus and footers) and the pages a research run chose (below); numbered passages                                                               | None of its own. Fetched text is untrusted data wherever a model sees it                                                                                                                                                         |
| Research (optional)  | `research/` (`crawler/`, `extract/`, `plan`, `select`, `run`, `service`), `routes/research.ts`                 | `research.ts`                                  | `research` (one for each run)               | A rules plan; a budgeted, best-first, deterministic crawl of the pages and sites a person names and what they link to; the choice of up to ten sources; the project's conflict check                                                           | Only for a Model assisted project and a run whose cost limit is above zero: the plan of what to look for, through the task runner. Which pages are fetched is never the model's                                                  |
| Stakeholders         | `stakeholders/` (`discover`, `rules`, `mentions`, `tone`, `review`, `participants/`), `routes/stakeholders.ts` | `stakeholders.ts`                              | `stakeholders`                              | Participants: the groups the sources spell out, a marked scaffold of what a decision structurally has, held to a catalogue of checks (some blocking) before the set may be used; the older discovery (role lexicon, cited quotes, tone) stands | Only for a Model assisted project: a strict `ProposedParticipants` reply under the output policy, every quote checked against its passage; on failure the rules propose, and the set says so                                     |
| Actors               | `stakeholders/actors.ts`, `priors.ts`                                                                          | `stakeholders.ts`                              | `actors`                                    | A key actor for each key stakeholder, a cohort for the rest, every trait from a documented category prior                                                                                                                                      | Only for a Model assisted project: optional reading of each key actor against the evidence; failures leave the priors                                                                                                            |
| Constraints          | `constraints/`, `simulation/constraints.ts`, `routes/constraints.ts`                                           | `constraints.ts`, `constraint-effects.ts`      | `constraints`, `constraint-counterfactuals` | Limits read from the question, the scenario, the sources and the cast; hardness read from what a clause asserts; a coverage gate; eight kinds of effect applied to the runs, the rest read and labelled; seven counterfactual views            | Only when asked, for a project that has a model: a strict reply under the output policy; a model's "hard" is a suggestion that the server raises only where the quoted words bear it out                                         |
| One simulated run    | `simulation/` (`simulate`, `dynamics`, `responders`, `signals`, `response`)                                    | `analysis.ts`                                  | none (pure)                                 | The only engine here: a seeded, deterministic update of every member's stance each round, with generic responders reacting to aggregate signals                                                                                                | None. A model never decides an actor's behaviour in the repeated runs                                                                                                                                                            |
| Comparison           | `analysis/` (`service`, `runset`, `variants`, `findings`, `sensitivity`, `stats`), `routes/analysis.ts`        | `analysis.ts`, `analysis-plan.ts`, `signal.ts` | `analysis` (one for each run set)           | Baseline, proposed change and each alternative, on the same seeds; findings with Wilson intervals; one-at-a-time sensitivity                                                                                                                   | None                                                                                                                                                                                                                             |
| Independent review   | `critics/` (seven critics), `routes/critiques.ts`                                                              | `critique.ts`                                  | `critiques`                                 | Fixed rules over the scenario, stakeholders, actors, analysis and brief                                                                                                                                                                        | Only for a Model assisted project (`409 MODEL_NOT_AVAILABLE` otherwise): an optional digest sent to a model for extra objections, validated, 170 seconds; it can add and never edit                                              |
| Decision brief       | `brief/` (`build`, `sections-*`, `recommend`, `export`), `routes/brief.ts`                                     | `brief.ts`                                     | `brief`                                     | Assembled from the other artifacts: 17 sections, every statement with one of ten origins and its references                                                                                                                                    | None. `generatedBy` is `rules`                                                                                                                                                                                                   |
| Decision Canvas      | `decision/`, `routes/decision.ts`                                                                              | `decision.ts`                                  | none (derived at every read)                | One of six statuses, four named lenses and eight epistemic labels, worked out from the stored comparison, constraints, review and evidence; no objective function                                                                              | None. No model writes any of it                                                                                                                                                                                                  |
| Progress             | `lab/progress.ts`                                                                                              | `lab.ts`                                       | read, not kept                              | A summary of which artifacts exist, added to `GET /api/projects/:id` as `lab`                                                                                                                                                                  | None                                                                                                                                                                                                                             |

### The artifact store

Everything a project carries beyond its own record is a row of `project_artifacts` (project, kind, key,
revision, payload, created and updated times), made by migration 9 on both dialects. A kind is a zod
schema in `shared/artifacts.ts`; the code that owns the kind writes it and every read and write is
checked against the schema, so a new kind needs a schema and no new table: research, constraints and their
counterfactuals were added as kinds, with no table of their own. `scenario`, `stakeholders`, `actors`,
`constraints`, `constraint-counterfactuals`, `critiques` and `brief` have one document, under the key
`default`; `research` has one for each run, keyed by the run's id, so a project may hold several;
`analysis` has one for each run set, keyed by its id, and a project keeps the newest twelve (never the one
that the brief or the review was made from). The Decision Canvas is not an artifact: it is worked out from
these at every read ([The Decision Canvas](#the-decision-canvas)). A write may carry the revision it was
made from, and a stale writer is refused with `409 ARTIFACT_CONFLICT` instead of overwriting. A
document may not exceed 2,000,000 bytes. Artifacts go when their project does (a foreign key with
cascade), a branch copies the `scenario`, and `project_artifacts` is one of the tables that
`npm run db:copy` carries between SQLite and PostgreSQL. The contract also reserves four `backtest-*`
kinds; no engine or route uses them (see [Known limitations](#known-limitations)).

### Reading a public page

`POST /api/evidence/url` hands the address to `ingest/url/`: `policy.ts` judges it as written,
`fetcher.ts` resolves the name, judges every answer and connects only to addresses that passed,
`robots.ts` reads and obeys robots.txt through the same fetcher, redirects are followed by hand and
judged again, `extract.ts` and `normalize.ts` turn the body into text without running anything, and
`ingest.ts` and `provenance.ts` make a document with its provenance. A process-wide limit (`limiter.ts`,
`FetchLimiter`, set by `URL_INGEST_CONCURRENCY`, `URL_INGEST_QUEUE` and `URL_INGEST_QUEUE_WAIT_MS`) wraps
the fetch in the route for every caller together, so that many callers cannot hold many connections and
buffers at once: a request beyond the line is answered `503 URL_BUSY`, naming nothing of the address. An
address the server refuses to read (including a name that led inside a network, which the person is told
is "not found") is recorded as `evidence.url.refused` with the host asked for and the code, never the path
or query. The server remembers each page it
fetched for one person for an hour (`FetchRegistry`), and a project created later keeps the claim
`fetchedByServer` only for exactly that text and person. Every rule, and the test for it, is in
[docs/security/url-ingestion.md](./docs/security/url-ingestion.md). This is the only code that fetches a
web page: automatic research ([below](#automatic-research)) reads through the same fetcher, so the same
refusals apply to it.

### Automatic research

A person may start the lab from a question, with or without a page or a site to start from, and let the
server find the sources. [backend/src/research/README.md](./backend/src/research/README.md) is the
specification; this is its shape. One rule sits under all of it: **a model may analyse a source, and a
source may never instruct the system.** Which addresses are fetched, how often and when to stop are decided
by code, from the budget and from what pages link to. A model never supplies an address, and nothing a page
says changes any of that. A plan, made by rules or by a model, gives the crawler only topics, names and
kinds of source that it ranks the links it has found by.

- **Where it runs.** Research is the first phase of the job that grounds a project, not a job of its own.
  `POST /api/projects/:id/research` writes a `queued` run and queues the existing `knowledge` step, and
  `ResearchService.beforeKnowledge` carries the run out before the graph is built. No job kind was added
  (`jobs.kind` is a database constraint), so the lease, the heartbeat, cancellation and recovery of a run
  are the queue's ([ADR 0010](./docs/adr/0010-durable-jobs-leased-from-the-database.md)). The record of a
  run is a `research` artifact, one for each run, written whole with the revision it was read at, so it is
  stored, exported and deleted with its project on either dialect. A project made from a question alone has
  no document and `research: { auto: true }`. Research is available only while both `RESEARCH_ENABLED`
  and `URL_INGESTION` are on, and both are on by default.
- **The stages** are planning, finding sources, reading, extracting evidence, checking conflicts and ready.
  A run is `queued`, `running`, `paused`, `completed`, `cancelled`, `failed` or `blocked`. A run that ends
  with nothing to use because a rule and not an error stopped it is `blocked`, and its stage waits instead of
  failing, so that a person can name a page or a site or add sources of their own.
- **Planning** is by rules, or by a model when the person chose one for the project, the provider is
  configured and the run's estimated cost limit is above zero. A plan names things to find and never an
  address; a suggestion of a site is a bare host name that is shown and never fetched. A model's plan must
  pass the schema, the server's checks and the project's wording guard, or the rules' plan stands in, with
  the reason. It is the one step that uses the task runner today ([Model tasks](#model-tasks-one-output-policy-a-router-and-the-foundry-provider)).
- **Finding and reading** are the crawler (`research/crawler/`), a library with no routes, storage or model
  calls. It starts from the pages and sites a person named and follows links best-first, ranked by numbers
  fixed once in `score.ts`. It stops at its budget: by default 12 pages, 4 sites, one link deep, 120 seconds
  and an estimated model cost of 0.25 US dollars, with ceilings of 30, 8, 2, 300 and 2 that the `RESEARCH_*`
  settings can only lower. It fetches through the public page reader under its own name, so robots.txt, the
  address policy, the pinned connection and the size and time limits are those of the one-page route, and a
  name that leads inside a network is answered exactly as a name that does not exist. A page that is a
  login, a paywall or an error, or is built by script, is set aside with a reason. A page with text that
  reads like an instruction to an AI keeps that text, labelled, and its links are not followed.
- **Choosing.** `select.ts` keeps up to ten sources within 200,000 characters, ranked by the estimated
  authority of the kind of site, how much of the plan a page covers, how recent it is where the plan says
  time matters, and whether a person named it, spread over sites and kinds, and keeping both sides of a
  disagreement. Secrets, email addresses and phone, card and account numbers are masked before a page is
  kept. One transaction appends the documents and writes the run's record, and the project's contradiction
  detector then reads the new passages.
- **What it does not do.** No search provider is built: a question with no page or site ends `blocked`, and
  `RESEARCH_SEARCH_PROVIDER` accepts only `none`. Nothing is executed, so a page whose text is made by
  scripts is not read, and a page behind a login is not read. Sitemaps are not read. Which pages are better
  is a lexical and rule-based estimate of the kind of site and the wording of a page, not a judgement that
  it is right. The pages of a run are untrusted data wherever a model sees them.

### One comparison

`AnalysisService.start` validates the request, refuses it without actors (`409 ACTORS_REQUIRED`), while
one is running for the project (`409 ANALYSIS_RUNNING`) or when two are running in the process
(`429 ANALYSIS_BUSY`), and refuses a cast that no longer matches the stakeholders (`409
STAKEHOLDERS_NOT_APPROVED`, `409 ACTORS_OUT_OF_DATE`) and, when the project has constraints, a set that is
blocked or that nobody has reviewed (`409 CONSTRAINTS_BLOCKED`, `409 CONSTRAINTS_UNREVIEWED`: see
[Constraints and the engine](#constraints-and-the-engine)). It works out the size (at most 2,400 simulated
runs, see `shared/analysis-plan.ts`), stores the analysis as `running` with the revisions of the scenario,
the stakeholders, the actors and, where there is one, the constraints it runs on (`inputRevisions`,
`lab/lineage.ts`) and answers `202`. The
work then runs in this process, one run
after another with the event loop given a turn between runs: the variants come from `autoVariants` (a
baseline, the proposed change and one for each alternative), each is simulated on the same seeds,
the findings and their Wilson intervals are counted, sensitivity moves one assumption at a time on up to
30 of the same seeds, the run nearest the median is kept in full for reading a chain of events back, and
the result is compared with any deep-dive run of the project. Progress is saved every few runs.
A person may cancel; a server that stops marks what it left `interrupted`, and the analysis is
reproducible from its seeds, so it is run again and not resumed. The brief and the review are judged
against the revisions that comparison recorded, not against when they were written, so that one made from
a comparison that predates a change says so. The method, the limits and what the
numbers do not mean are in [docs/analysis/methodology.md](./docs/analysis/methodology.md).

### Constraints and the engine

What limits a decision is a document of its own, the `constraints` artifact, so that a person reviews it
before anything is simulated and the answer can say which limits it rests on
([docs/analysis/constraints.md](./docs/analysis/constraints.md) is the specification). A constraint is never
a fact because Swarm or a model proposed it: where it came from (`source`), whether anyone has checked it
(`validation`) and whether the simulation applies it (`enforcement`) are three separate things. Rules set
the first and the third, and neither a model nor a client can; only a person confirms or rejects a
constraint, and a proposal starts unvalidated.

- **Reading.** Rules read the person's words, the sources and the cast for a clause that names something
  and limits it. A model may read the sources as well, when the person asks and the project has one, through
  `runStructuredTask` ([Model tasks](#model-tasks-one-output-policy-a-router-and-the-foundry-provider)):
  its schema has no field for source, validation or effects, and a quote it cites is kept only if the server
  finds it in the passage it names. Hardness is a proposal with a stated basis. A cue word makes a limit hard
  only where its clause asserts it, and a model's "hard" raises a limit only where the quoted words bear it
  out. A passage that is addressed to an AI is neither read by the rules nor shown to a model.
- **The gate.** `constraints/gate.ts` is rules and no model. It answers `clear`, `provisional` or `blocked`
  and lists what is known, assumed, conflicting and missing. A project with no constraints runs as it always
  did. With a set, `POST /api/projects/:id/analysis` is refused with `409 CONSTRAINTS_BLOCKED` while the gate
  is blocked, and with `409 CONSTRAINTS_UNREVIEWED` until a person has been through the list. A provisional
  gate lets the comparison run, and its label travels into the comparison, the review, the brief and the
  Decision Canvas.
- **The runs.** `simulation/constraints.ts` applies eight kinds of effect (block, limit-actions, delay,
  reduce-influence, add-cost, require-approval, add-risk and force-sequencing), each deterministic for a
  seed, to the constraints that a person has looked at and not set aside. Every other constraint is read,
  listed with its reason, and changes nothing in a run. With no constraints a run takes the arithmetic path it
  always took, and `constraints-golden.test.ts` holds digests of whole runs to that.
- **What it measures.** A comparison also takes each applied constraint away in turn on eight shared seeds,
  and `POST /api/projects/:id/constraints/counterfactuals` runs seven views of the proposed change on twelve.
  Both are results of the simulation, not findings about the world.

### The Decision Canvas

`GET /api/projects/:id/decision` is the first thing Decide shows: what the simulation shows, which option
(if any) it supports, under which constraints and assumptions, what weakens that and what to check before
anyone acts ([docs/analysis/decision-canvas.md](./docs/analysis/decision-canvas.md)). It is derived and not
stored. `DecisionService.view` reads the newest finished comparison, the scenario, the participants, the
constraints (the gate is worked out again at every read), the counterfactual views, the review and the
evidence, and calls a pure builder in `backend/src/decision/`, so a canvas is never older than what it
describes. No model writes any of it.

- **A status**, one of six, by rules that are written as data (`STATUS_RULES` in `shared/decision.ts`) and
  held to the code by a test: `robust-option`, `conditional-option`, `multiple-plausible-options`,
  `needs-human-decision`, `blocked-by-hard-constraint` and `insufficient-evidence`.
- **Lenses, and no objective.** Swarm has no objective of its own. Four named lenses (overall resistance,
  key-actor support, decision-maker resistance and the downside for the worst-affected group) each read what
  the analysis measured. They can disagree, and then the canvas shows it and does not average it away. An
  option is the clear leader on a lens only when it is told apart from every other option: by a paired
  difference on the same seeds of at least 0.05 of the lens's own scale and more than two standard errors,
  over at least ten paired runs.
- **Labels.** Every statement carries one of eight epistemic labels (fact, source claim, assumption, model
  inference, simulation event, scenario possibility, recommendation, validation requirement). One table in
  `shared/decision.ts` maps what the product already says onto them, and `decision-labels.test.ts` holds that
  table complete and the document to it.
- **With no finished comparison** it answers `canvas: null` and a `readiness` that says what is missing and
  which step supplies it. The route is limited to 120 requests a minute.

### How the interface carries it

The interface is six scenes on a design system ([ADR 0015](./docs/adr/0015-premium-interface.md),
[UX.md](./docs/UX.md)). It changes none of the contracts, routes or security rules in this document.
`frontend/src/` holds `app/` (the shell), `scenes/` (one folder for each scene), `design/` (tokens, themes,
primitives and motion), `viz/` (the ecosystem map), `panels/` (History, Ask, the audit log, the model budget,
access and the provider chip), `hooks/`, `lib/` (pure logic) and `api/` (typed clients).

The shell is `app/Root.tsx` (the providers, and the one screen that is not the application: a sign-in that
did not produce a session) and `app/Application.tsx`, which owns the project, the server's configuration and
the address (`app/route.ts`: `?project=`, `scene=` and `view=`). **Ask** is mounted by the shell with props,
because it is the one scene that exists before a project does. **Ground**, **Map**, **Simulate**, **Compare**
and **Decide** are modules with a default export and no props, each a chunk of its own that is fetched when it
is opened or about to be (`app/loaders.ts`); they read the project through `useWorkspace()`
(`app/context.tsx`). The panels are lazy as well (`app/PanelHost.tsx`). A scene asks nothing of the shell
beyond what that context holds; [UX.md](./docs/UX.md#adding-to-the-interface-without-breaking-what-is-there)
says how one is added.

What the scenes carry for the steps above ([UX.md](./docs/UX.md) is the guide to each). **Ask** takes the
question, an optional website or domain, a time horizon, the intake's advanced fields and the choice to
research automatically, and starts a project from a question alone or from a sample case. **Map** has four
views of the cast: Map, List, Review (the checks the participants are held to; the blocking ones must pass
before the set may be used) and Constraints. **Decide** opens on the Decision Canvas, and the brief, the
review and Report Studio follow it.

`lab` on the project (from `lab/progress.ts`) and the engine's own `console.steps` decide what can be opened
and where a project opens. `app/scenes.ts` holds the rules: `sceneAvailable` (Map once the evidence has been
read, Simulate once there are actors, Compare and Decide once a comparison has finished), the lock reasons,
`sceneInfos` for the journey and the dock, and `frontierScene`. `frontend/src/lib/console.ts` still holds
the engine's own rules (which step can run). The workspace reads the project again by itself:
`hooks/useConsole.ts` while an engine step or a survey runs (every 1.8 s), `hooks/useAnalysis.ts` while a
comparison runs (every second) and `hooks/useLabRefresh.ts` while one runs or while the record waits for one
(2 s and 5 s), so a scene opens when the record allows it, without a reload.

Colour comes only from the tokens in `design/tokens.css`, which writes the light, dark and high-contrast
themes out one by one; styles live in `@layer tokens, base, components, scenes, utilities`; nothing renders
raw HTML; and the content-security policy is unchanged. `frontend/src/test/ui-guards.test.ts`,
`frontend/src/test/design-contrast.test.ts` and `scripts/ui/colours.mjs` hold these rules
([UX.md](./docs/UX.md#guards)). Each scene is a chunk of its own, and `npm run build` writes a Brotli and a gzip
copy of each text asset (`scripts/precompress.mjs`) that the server sends as they are to a browser that
accepts them (`preCompressed` in `app.ts`, with `Vary: Accept-Encoding`).

### Two engines, one cast

The deep dive's agent engine and the lab's simulator can disagree, because they are different
engines. The analysis records whether a deep-dive run falls inside the range of the repeated runs
(`crossCheck`) and says that it compares different engines. Population sizes are weights and
modelling assumptions: cost and diversity come from the number of simulated members, never from the
number a cohort stands for.

## System diagram

```mermaid
flowchart TB
    subgraph UX["User experience"]
        Browser["User browser<br/>No credentials or tokens in the page;<br/>an HttpOnly cookie holds a sign-in"]
        Frontend["React and TypeScript console<br/>(six scenes) served by the API process"]
    end

    subgraph APP["Swarm application (runs locally)"]
        API["Fastify and TypeScript API<br/>validation, rate limits,<br/>host and origin checks"]
        Identity["Identity boundary<br/>local single user, or Entra:<br/>bearer token, or browser sign-in<br/>with a server-side session"]
        Authz["Authorization and tenant<br/>isolation: default-deny<br/>route table"]
        Lab["Scenario lab<br/>intake, participants, actors,<br/>repeated runs, critics, brief"]
        Research["Automatic research<br/>(budgeted crawl, planned by<br/>rules or a model; fetches only<br/>through the page reader)"]
        Constraints["Constraints<br/>(read, reviewed by a person,<br/>then applied in the runs)"]
        Canvas["Decision Canvas<br/>(worked out at every read;<br/>no model writes it)"]
        Pages["Public page reader<br/>(address policy, pinned fetch,<br/>robots.txt)"]
        Guard["Deployment guard<br/>(refuses an unsafe pilot or<br/>production configuration)"]
        Orchestrator["Simulation orchestrator<br/>(stage runner, local worker)"]
        Actors["Actor runtime<br/>(fictional proxies)"]
        Interv["Scheduled<br/>interventions"]
        Checkpoints["Round<br/>checkpoints"]
        Branches["Branches from<br/>a checkpoint"]
        Compare["Run<br/>comparison"]
        Report["Report generation and<br/>grounding review"]
        Analyst["Analyst chat<br/>(abstains without evidence)"]
        ActorChat["Actor chat"]
        Studio["Report Studio<br/>versions, locks, review and approval<br/>of exact text, printable memo"]
        Export["Markdown and<br/>JSON export"]
        Jobs["Durable stage jobs<br/>(lease, heartbeat, bounded retry)"]
        Telemetry["OpenTelemetry signals<br/>(redacted; export built,<br/>never connected)"]
        Provider["Model-provider<br/>abstraction"]
        Budget["Model budget per project<br/>(calls and tokens, asked<br/>before every model call)"]
    end

    subgraph DATA["Data and evidence"]
        Sources["Uploaded sources and<br/>numbered passages"]
        Graph["Scenario graph"]
        Ledger["Evidence ledger:<br/>statements and conflicts"]
        Assumptions["Assumption<br/>register"]
        Artifacts["Project artifacts<br/>(validated JSON documents)"]
        DB[("Local SQLite<br/>persistence")]
        Pg[("PostgreSQL adapter (optional)<br/>tested with an in-process server<br/>and over the wire; none deployed")]
        Audit["Hash-chained,<br/>append-only audit log"]
    end

    subgraph MODELS["Model providers"]
        Rules["Local rules provider<br/>(no network)"]
        Other["OpenAI-compatible or<br/>Ollama (optional)"]
        FoundryProv["Azure AI Foundry<br/>provider"]
    end

    subgraph AZ["Azure (the only deployed component)"]
        Entra["Microsoft Entra ID<br/>model authentication"]
        Deployment["Azure AI Foundry<br/>model deployment"]
    end

    subgraph QA["Test and observability boundaries"]
        Tests["Vitest, Playwright and axe suites,<br/>fake model provider and fake Foundry,<br/>an evaluation harness, Bicep checks"]
        Logs["Structured logs without content,<br/>token and call counts"]
    end

    Web["Public web pages"]

    Browser --> Frontend
    Frontend <-->|"HTTP API only"| API
    API --> Identity
    Identity --> Authz
    Authz --> Orchestrator
    Authz --> Lab
    Authz --> Pages
    Authz --> Analyst
    Authz --> ActorChat
    Authz --> Compare
    Authz --> Export
    Authz --> Studio
    API -.-> Audit
    API -.-> Telemetry
    Jobs -->|"leased by a worker"| Orchestrator

    Pages -.->|"HTTP GET, public pages only"| Web
    Lab --> Research
    Research -->|"every fetch"| Pages
    Lab --> Constraints
    Lab --> Canvas
    Artifacts -.->|"read, not stored"| Canvas
    Guard -.->|"checked when the<br/>configuration is read"| API
    Sources --> Graph
    Sources --> Lab
    Lab --> Artifacts
    Artifacts --> DB
    Graph --> Orchestrator
    Assumptions --> Orchestrator
    Interv --> Orchestrator
    Orchestrator --> Actors
    Orchestrator --> Checkpoints
    Checkpoints --> Branches
    Branches --> Compare
    Orchestrator --> Report
    Report --> Ledger
    Sources --> Ledger
    Ledger --> Analyst
    Ledger --> Export
    Report --> Export
    Report -->|"opened as a copy"| Studio
    Ledger -->|"statements of<br/>generated text"| Studio
    Studio --> Export
    Studio -->|"write a chapter again"| Provider
    Studio --> DB
    Jobs --> DB
    Checkpoints --> DB
    Ledger --> DB
    Audit --> DB
    DB -.->|"or, by setting<br/>DATABASE_URL"| Pg

    Lab --> Provider
    Actors --> Provider
    Report --> Provider
    Analyst --> Provider
    ActorChat --> Provider
    Provider -->|"asks before each call"| Budget
    Budget --> DB
    Provider -->|"rules mode"| Rules
    Provider -.-> Other
    Provider -->|"Azure mode"| FoundryProv
    FoundryProv -->|"Azure mode: token<br/>requested on the server"| Entra
    FoundryProv -->|"Azure mode: requests<br/>with the token"| Deployment

    Tests -.->|"drive the API<br/>and the browser"| API
    API -.-> Logs
```

Current validated architecture. The application and database run locally; Azure hosts the AI model deployment. Planned cloud hosting and managed identity are not shown as implemented components.

| Where it runs              | Components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **On your machine**        | The browser interface, the API and everything behind it (one Node.js 24 process), the local rules provider, and one SQLite file, or a PostgreSQL database you provide through `DATABASE_URL` (tested against PostgreSQL running in-process and over the wire protocol; never against a deployed server). This is all of the application                                                                                                                                                                                                                                                                                                                                                    |
| **Deployed in Azure**      | Only a model deployment you own, and Microsoft Entra ID issuing the token that calls it. Nothing else is deployed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Authored, not deployed** | A hosted container (the UI, the API and the job runner in one process) on Azure Container Apps (multiple revisions: blue/green releases), a PostgreSQL server in Azure, managed identity for the application, an Application Insights resource that the telemetry is sent to, alert rules and a budget. They are Bicep in [`infra/pilot`](./infra/pilot/main.bicep) that compiles, lints and evaluates offline (`npm run iac:validate`), designed in [docs/AZURE.md](./docs/AZURE.md), [docs/azure/](./docs/azure/) and [docs/production/](./docs/production/LIMITATIONS.md); **none is deployed, and nothing has been seen working in Azure** (no rollback or restore drill has been run) |
| **Proposed, not built**    | A separate worker container app (the pilot runs the API and the job runner in one process), Blob Storage, a search service, a web application firewall, a configured search provider for automatic research. See [docs/AZURE.md](./docs/AZURE.md)                                                                                                                                                                                                                                                                                                                                                                                                                                          |

- **Frontend:** React and TypeScript, as six scenes on a design system ([how the interface carries
  it](#how-the-interface-carries-it)). In the built application the same process serves it and the
  API. It holds no credentials.
- **Backend:** Fastify on Node.js 24 with the built-in SQLite module, or an optional PostgreSQL
  adapter behind the same stores. Validation, rate limits and host and origin checks sit in front of
  every route.
- **Identity boundary:** local single-user mode by default. With `AUTH_MODE=entra` a person signs in
  with Microsoft in the browser (the server runs the Authorization Code flow with PKCE and keeps an
  opaque, HttpOnly session; no token reaches the page), or an API client sends an Entra bearer token.
  Every request is then authorized from workspace and project membership (seven roles: platform
  administrator, workspace owner and admin, project lead, analyst, reviewer and viewer), with a
  default-deny route table and tenant isolation. A project a person was not added to is reported as
  missing. A workspace owner or administrator manages the workspace's people, and a project lead
  the project's, from the browser (**People** and **Who has access**, under Settings and tools), naming each person by their Entra
  object ID. It has only been tested against a test identity provider, never a real tenant.
- **Provider abstraction:** one gateway for every model call. It picks the rules engine or a real
  provider (Ollama, an OpenAI-compatible server, Azure OpenAI or Microsoft Foundry) from configuration,
  bounds retries, counts calls and tokens, and never falls back silently. The steps that go through the
  task policy answer from their rules when a reply cannot be used, and say so
  ([Model tasks](#model-tasks-one-output-policy-a-router-and-the-foundry-provider)).
- **Evidence and grounding:** passages, retrieval, verbatim quote matching and the report's
  grounding review live on the server, so no browser state can change a verdict.
- **Web pages:** read only by the server, through one public page reader, whether a person names one page
  or automatic research follows what they name. The browser never reaches the web, and a model never
  supplies an address ([Automatic research](#automatic-research)).
- **Deployment guard:** `DEPLOYMENT_MODE=pilot` or `production` makes the server refuse to start with an
  unsafe configuration ([Hosting and operations](#hosting-and-operations-authored-not-deployed)).

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

Not implemented: OCR, a search provider, fetching arbitrary addresses (pages are fetched only from what a
person names and what those pages link to, under an address policy and within a budget), live social network
access, OASIS compatibility, thousands of model-driven agents, semantic neural embeddings, a hosted
deployment, or calibrated real-world probabilities. Sign-in, roles and tenant isolation are implemented, and
have only met a test identity provider. The UI must not imply otherwise.

Version 0.2 adds text-PDF extraction, real guided-stage boundaries, independent
dual-platform contexts, synthetic memory, report-tool traces/chapters and
asynchronous surveys. It does not turn the local lexical engine into generative AI.

Version 0.3 adds the checkpointed what-if loop (pause, resume, one scheduled intervention, branching from a
saved round with declared changes, and run comparison; see "Checkpoints, pause/resume, branching and
comparison" below), a JSON snapshot export, an accessibility and responsive-layout rework of the console of
that time, a
validated `RATE_LIMIT_SCALE` setting, and the browser/load verification described in "Verification
architecture". The scenario lab (see [The scenario lab flow](#the-scenario-lab-flow)) is built on
0.3.0 without a version change.

### Live-console interaction reference

The live `/mirofish-demo/console` was followed through all five screens:
source/question entry; ontology/graph build; persona/configuration preparation;
two-platform execution with memory feedback; report/operation inspection; and
report/persona interaction with multi-target survey selection. Its own entry
page says it is a static demo without connected agent-chat inference.

Our UI first adopted the guided interaction model, a light technical layout and
Graph/Split/Workbench views with an original Swarm Lab design. That console has since been rebuilt as six
scenes on a design system ([ADR 0015](./docs/adr/0015-premium-interface.md), [UX.md](./docs/UX.md)); what
carried over is the rule that its counters, graphs, statuses, event streams, reports and traces come from
actual persisted execution. No demonstration case, asset, graph dataset or prerecorded output was copied.

The default local engine uses real, reproducible opinion-dynamics calculations.
Topic extraction is term-frequency/co-occurrence based, not semantic AI extraction.
Reports are computed from recorded states, not fabricated AI prose. Local follow-up
is labeled evidence lookup, not an AI interview.

In the deep dive, model-assisted mode makes actual configured-provider requests for knowledge,
personas, a decision for every proxy on every platform in every round, reports,
a grounding check and interviews. It must fail visibly rather than fall back to
local output after a provider or schema error. The steps that go through the task policy are different by
design: a reply that cannot be used is answered from the step's rules, with the reason recorded and none of
the model's words in it ([Model tasks](#model-tasks-one-output-policy-a-router-and-the-foundry-provider)).

## Local components

```text
React + TypeScript
  └─ same-origin /api requests (Vite proxy during development)
       └─ Fastify / TypeScript
            ├─ validation, origin/host checks, rate and size limits, optional sign-in and authorization
            ├─ the store: SQLite (node:sqlite) or PostgreSQL behind one synchronous interface
            │    projects, passages, events, conversation, ledger, audit log, jobs, sessions,
            │    Report Studio documents, model usage and the lab's artifacts
            ├─ the scenario lab (in the request process, no model needed)
            │    ├─ question to scenario, participants, actors, constraints
            │    ├─ comparisons: repeated seeded runs of the population simulator
            │    └─ critics, the Decision Canvas (worked out at every read) and the decision brief
            ├─ public page reader (the only fetcher of web pages, under an address policy;
            │    the one-page route and automatic research both go through it)
            ├─ durable job queue in the store (one stage per worker at a time, three may wait)
            │    ├─ research, when asked (the first phase of the next stage) and the
            │    │  ontology + source graph (then pause)
            │    ├─ fictional persona + editable environment (then pause)
            │    ├─ independent platform rounds + synthetic memory (then pause)
            │    └─ bounded report tools + progressive chapters (then interaction)
            ├─ isolated PDF text-extraction worker (research reads text PDFs through it too)
            ├─ bounded chat / asynchronous survey ownership
            ├─ the deployment guard (refuses an unsafe pilot or production configuration at start)
            └─ model adapter (optional; see "Model tasks" below)
                 ├─ Ollama local HTTP API
                 ├─ OpenAI-compatible Chat Completions
                 ├─ Azure OpenAI v1 (AI_PROVIDER=azure)
                 └─ Microsoft Foundry v1 (AI_PROVIDER=foundry)
                      └─ Microsoft Entra ID token (DefaultAzureCredential) or API key
```

Node 24 supplies SQLite without a native npm addon. The installed Python 3.15 is
outside the reference's supported Python range, while Node 24 is already available.
A single TypeScript runtime also keeps shared request/result types straightforward.

### The five stages of the deep dive

The engine has five stages. Each runs separately and stops at **ready** until you start the next. The
interface no longer shows them as a screen of their own: it has six scenes ([How the interface carries
it](#how-the-interface-carries-it)), and each stage has a place in them. The names in the first column are
the engine's own (`console.steps` in the API: `knowledge`, `environment`, `simulation`, `report` and
`interaction`).

| Stage          | Rules mode                              | Real-model mode                                                                          | In the interface                                                                         |
| -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Graph Build | Term and co-occurrence extraction       | The model proposes entities and relations; the server checks every quote and citation    | **Ground**: **Ground it** creates the project and starts it                              |
| 2. Env Setup   | Generated personas and seed posts       | The model proposes personas and seed posts, which you can edit                           | The deep dive: **Prepare the environment**, made from the actors on the **Map**          |
| 3. Simulation  | Seeded opinion dynamics                 | One request per proxy per platform per round, validated and bounded                      | The deep dive: **Start the simulation**                                                  |
| 4. Report      | A report computed from recorded metrics | A planned, tool-assisted report with a grounding review and an independent support check | The deep dive: **Write the detailed report**, then the detailed report and Report Studio |
| 5. Interaction | Evidence lookup and state snapshots     | Report chat, proxy chat and interviews                                                   | **Ask about this**, once the report exists: the analyst, the actors and surveys          |

Every model reply is validated on the server before it is used: identifiers, citations, verbatim
quotes and bounded changes. A bad reply is sent back for a limited number of corrections. When a
slip can be repaired only by removing, shortening or weakening what the model claimed, the server
repairs it and **says so** in the report; otherwise the stage fails and you see why. See the
[user guide](./docs/USER_GUIDE.md#the-deep-dive-optional-pause-resume-intervene-branch-compare) for the deep
dive and the
[grounding review](./docs/USER_GUIDE.md#grounding-review-model-assisted-reports).

### Data and model boundaries

Source names never become filesystem paths. Documents are plain text data in
SQLite; chunks have stable citation IDs and offsets. Local retrieval uses sparse
TF-IDF vectors and cosine similarity, explicitly not neural embeddings.

All model input is serialized data bounded by context budgets. Retrieved content,
persona memories and model outputs are untrusted, not higher-priority instructions.
Agents have no shell, arbitrary URL fetcher, filesystem browser or code-execution
tool. Model JSON is schema-validated and IDs/citations are checked against the
current project. Browser rendering is plain text/React escaping.

By default one process owns one SQLite file, and every stage of a run is a row in the `jobs` table
that a worker takes under a lease ([ADR 0010](./docs/adr/0010-durable-jobs-leased-from-the-database.md)):
a refresh or an API restart does not lose a run, a worker that stops is replaced when its lease runs
out, and a simulation continues from its last saved round. The lab's comparisons are not jobs: they run
in the request process (at most two at a time) and are marked `interrupted` if it stops. Local,
single-user mode is the default; PostgreSQL and the `api` and `worker` roles are built and tested in
process, and have not run across containers or against a deployed server.

### Implemented module boundaries

| Module                                   | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/types.ts`                        | Shared input validation, limits and request/result types                                                                                                                                                                                                                                                                                                                                                              |
| `backend/src/app.ts`, `routes/`          | HTTP boundaries, safe errors, CSP, host/origin and request/rate limits                                                                                                                                                                                                                                                                                                                                                |
| `backend/src/storage/`                   | SQLite or PostgreSQL behind one interface, numbered migrations with a backup, the artifact store, the job queue, the ledger store, the hash-chained audit log, model usage and start-up recovery                                                                                                                                                                                                                      |
| `backend/src/knowledge/`                 | Stable source chunks, sparse TF-IDF retrieval, lexical graph and citation validation                                                                                                                                                                                                                                                                                                                                  |
| `backend/src/agents/`                    | Persona setup, local state updates, per-proxy model decisions (`actor.ts`), peer selection (`peers.ts`), review and reporting                                                                                                                                                                                                                                                                                         |
| `backend/src/grounding/`                 | Verbatim quote matching, claim verdicts, entailment check, chapter-claim validation, the review, and the evidence ledger: classification, publication policy, cross-source conflicts and the ledger service                                                                                                                                                                                                           |
| `backend/src/auth/`                      | Optional Entra token verification, roles, the default-deny route table and the request guard                                                                                                                                                                                                                                                                                                                          |
| `backend/src/studio/`                    | Report Studio: the rules of a document (versions, locks, review states, the hash an approval is of), the service, chapter regeneration, and the memo, Markdown and JSON exports                                                                                                                                                                                                                                       |
| `backend/src/models/`                    | Bounded provider transport (Ollama, OpenAI-compatible, Azure OpenAI, Foundry), Entra tokens, bounded repair loop, schemas, timeouts/retries, usage and provider telemetry; the output policy (`task.ts`), the router, the runner with its allowances and cache (`router.ts`, `runner.ts`, `cache.ts`, `cost.ts`), strict structured output (`strict-schema.ts`) and content-safety signals (`safety.ts`)              |
| `backend/src/orchestration/`             | The job runner (leases, heartbeats, retries, cancel and pause across processes), follow-up locking and survey lifecycle, and the analyst's evidence gate and citation checks                                                                                                                                                                                                                                          |
| `backend/src/guided/`                    | Gated ontology/preparation/worlds, source/memory/timeline/interview tools and chapter generation                                                                                                                                                                                                                                                                                                                      |
| `backend/src/ingest/`                    | Isolated local PDF parsing with byte/page/text/time/heap limits and no credential inheritance                                                                                                                                                                                                                                                                                                                         |
| `backend/src/ingest/url/`                | Reads a public web page a person names: address policy, pinned fetch, robots.txt, and text extraction that never runs the page. Automatic research fetches through the same fetcher ([URL ingestion](docs/security/url-ingestion.md))                                                                                                                                                                                 |
| `backend/src/research/`                  | Automatic research: the crawler (`crawler/`) and page extractor (`extract/`) as a library with no routes, storage or model calls; the run for a project (plan, assessment, selection, masking, record, pause, the service the `knowledge` job calls) ([README](backend/src/research/README.md))                                                                                                                       |
| `backend/src/scenario/`                  | The lab's intake: a question read into a scenario frame by rules or by a validated model reply, with the injection checks on the question and the documents                                                                                                                                                                                                                                                           |
| `backend/src/stakeholders/`              | The lab's stakeholder discovery (role lexicon, tone, optional model), the review rules, approval, and the actors made from an approved set with their category priors; `participants/` proposes the participants of a decision (rules with a marked scaffold, or a model's reply under the output policy), holds them to a catalogue of 23 checks (15 blocking, 8 advisory in the strict profile) and regenerates one |
| `backend/src/constraints/`               | What limits a decision: reading (rules, optionally a model), hardness with its basis, the review, the Constraint Coverage Gate, the effects the runs apply, and seven counterfactual views ([constraints](docs/analysis/constraints.md))                                                                                                                                                                              |
| `backend/src/simulation/`                | The pure, seeded population simulator: members, stance dynamics, generic signals and external responders, response categories (no domain words, by test), and the eight constraint effects (`constraints.ts`)                                                                                                                                                                                                         |
| `backend/src/decision/`                  | The Decision Canvas, built on read: the status rules, the four lenses, the labels, the validation plan and the export ([the canvas](docs/analysis/decision-canvas.md))                                                                                                                                                                                                                                                |
| `backend/src/analysis/`                  | Comparisons: variants on shared seeds, findings with Wilson intervals, one-at-a-time sensitivity, the service that runs them in the process and recovers them                                                                                                                                                                                                                                                         |
| `backend/src/critics/`                   | The seven critics: fixed rules (one of them reads what a comparison recorded of its constraints), an optional validated model critic, and the carrying of a person's responses over to a new review. A critic never edits the analysis                                                                                                                                                                                |
| `backend/src/brief/`                     | The answer-first decision brief: facts, sections, recommendations, the validation plan, the origin of every statement, and the Markdown, JSON and printable exports                                                                                                                                                                                                                                                   |
| `backend/src/lab/`                       | `progress.ts`: how far a project has come, read from which artifacts it holds; `lineage.ts`: the revisions a comparison was made from, and what has changed since                                                                                                                                                                                                                                                     |
| `backend/src/telemetry/`                 | OpenTelemetry signals without content: spans and metrics for requests, models and the product (`product-signals.ts`: research, participants, constraints, durations), and the Azure Monitor exporter, which does nothing unless a connection string is set                                                                                                                                                            |
| `backend/src/deployment.ts`              | The deployment guard: `DEPLOYMENT_MODE`, the label and build, and the rules that refuse an unsafe pilot or production configuration while it is read                                                                                                                                                                                                                                                                  |
| `shared/` (lab contracts)                | `scenario`, `research`, `stakeholders`, `constraints` and `constraint-effects`, `analysis` and `analysis-plan`, `decision`, `signal`, `critique`, `brief`, `lab`, `artifacts`, `example-scenarios` with `examples/`, and `lab-fixtures` (sample objects made through the schemas)                                                                                                                                     |
| `shared/guided.ts`                       | Persisted stage, environment, memory, trace, survey and editing contracts                                                                                                                                                                                                                                                                                                                                             |
| `frontend/src/hooks/`                    | Race/abort-safe project lifecycle (`useConsole`), history, comparison and brief reading, and polling (`useAnalysis`, `useLabRefresh`)                                                                                                                                                                                                                                                                                 |
| `frontend/src/app/`                      | The shell: `Root` and `Application` (the project, the configuration and the address), the top bar, the journey rail and the dock, the settings menu, the scene and panel hosts, and `scenes.ts` (what opens each scene)                                                                                                                                                                                               |
| `frontend/src/scenes/`                   | One folder for each scene (`ask`, `ground`, `map` with its `review/` and `constraints/` views, `simulate` with its `deep/` dive, `compare`, `decide` with its `canvas/`) and the `studio` and `report` that Decide opens. A scene takes no props and reads the project from `useWorkspace()`                                                                                                                          |
| `frontend/src/design/`                   | Tokens and themes, the cascade layers, surfaces, motion and the primitives (`ui/`); `frontend/gallery.html` shows them in development                                                                                                                                                                                                                                                                                 |
| `frontend/src/viz/`                      | The ecosystem map: an SVG with a seeded layout, and its palette                                                                                                                                                                                                                                                                                                                                                       |
| `frontend/src/panels/`                   | History, Ask (the analyst, the actors and surveys), the audit log, the model budget, access and the provider chip                                                                                                                                                                                                                                                                                                     |
| `frontend/src/lib/`, `frontend/src/api/` | Pure logic (the engine's step rules in `console.ts`, intake, stakeholder review, the brief, themes) and the typed clients for the lab's routes (`frontend/src/api.ts` has the engine's)                                                                                                                                                                                                                               |
| `evaluation/`                            | Labelled datasets pinned to their sources, the offline harness, thresholds and results; `ai-*` is the evaluation of the AI-assisted setup (`npm run eval:ai`), with `known-breaches.json` listing the two thresholds it does not meet                                                                                                                                                                                 |
| `infra/`                                 | Bicep for a controlled pilot in Azure (`pilot/`), authored and validated offline; nothing is deployed                                                                                                                                                                                                                                                                                                                 |

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
bounded conversation excerpt. None of these model calls can reach the web: nothing a model writes is fetched.
The only code that fetches a page is the public page reader, which automatic research also goes through, and a
model never supplies an address to it ([Automatic research](#automatic-research)).

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

**Statement types and support classes.** Ten statement types are defined, and they are never merged:
the label travels with the statement.

| Label                      | Meaning                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **SOURCE FACT**            | Stated in the provided source text and quoted verbatim                                     |
| **EXTRACTED CLAIM**        | A paraphrase of what a provided source says                                                |
| **USER ASSUMPTION**        | An input you chose: a setting, an intervention or a seed post. Not a claim to verify       |
| **INFERRED RELATIONSHIP**  | A link between things that no single passage states. At best partly supported              |
| **AI HYPOTHESIS**          | The model's speculation, not claimed to be backed by any source. Never shown as a finding  |
| **SIMULATED EVENT**        | Something that happened inside the simulation, not in the real world                       |
| **ANALYTICAL CONCLUSION**  | A figure or reading derived from the recorded simulation metrics                           |
| **RECOMMENDATION**         | A suggestion. Allowed only when the evidence is sufficient, and shown with its assumptions |
| **CONTRADICTING EVIDENCE** | A passage that conflicts with a statement or with another source, shown beside it          |
| **UNRESOLVED UNCERTAINTY** | A question the evidence leaves open. Recorded, never presented as a finding                |

The classification and publication rules cover all ten and are pure, tested functions. The report
writer currently emits six of them (source fact, extracted claim, user assumption, AI hypothesis,
simulated event, analytical conclusion). Contradicting evidence appears as the conflicts between
sources and as the passages attached to a statement. Inferred relationship, recommendation and
unresolved uncertainty are defined and classified by policy, but the report writer does not yet emit
them as statements of their own. (The lab's decision brief has its own ten _origins_, which are not
these ten types: see [docs/analysis/brief.md](./docs/analysis/brief.md#origins).)

How well your sources back a statement is a separate **support class**: directly supported,
partially supported, contradicted, unsupported, not applicable, not checkable, simulation derived or
assumption dependent. Deterministic checks assign it. A model's check can lower a class or confirm
it, never raise it, and a reviewer can withhold a statement but never upgrade one. A support class
says how well _your_ sources back a statement. It is not a claim that the statement is true.
Simulated results are hypothetical. They describe the scenario, not the world.

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
it feeds `GET /api/provider/status`, which drives the engine chip in the top bar.

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

### Model tasks: one output policy, a router and the Foundry provider

Above the client there are two more layers, and different steps use different ones
([docs/models/foundry.md](./docs/models/foundry.md) is the specification and has the table of who uses
which). `AI_PROVIDER` is `none` (the rules engine), `ollama`, `openai`, `azure` or `foundry`; `foundry`
reaches a Microsoft Foundry resource through its OpenAI-compatible v1 API, asks for strict structured
output and uses Microsoft Entra ID by default. The deployment guard refuses a model API key in `production`,
and in `pilot` unless `ALLOW_MODEL_API_KEY=true` ([Hosting and
operations](#hosting-and-operations-authored-not-deployed)).

- **The output policy.** `runStructuredTask` (`models/task.ts`) is the one rule for what a model's reply
  may become: it is checked against a strict schema and the server's own checks; one correction round is
  allowed; and a reply that still cannot be used is replaced by the answer the step's rules give for the
  same input. The reason is recorded as a code and a fixed sentence and never holds a word the model wrote,
  and the result says whether it came from the model or from the rules. A reply that fails is never repaired
  by hand and never read by pattern. A refusal by the provider, a cancelled run and a client that has left
  are the three things that are never answered from rules. The participants (`role: actor`) and the
  constraints (`role: scenario`) are proposed this way, and so is the planning of a research run.
- **The task runner.** `taskRunnerFor` (`models/factory.ts`, `models/runner.ts`) adds a router that chooses
  a deployment and the parameters of a call from configuration alone (no network, no randomness: the role's
  deployment, its data zone, its context size, a cost ceiling and its latency budget), an allowance for one
  operation in tokens and estimated dollars, an optional cache of validated answers kept in this process's
  memory for one tenant only, and one failover to another deployment, and then calls `runStructuredTask`.
  **Only the planning of a research run uses it today.** Participants and constraints go to the default
  deployment (`AI_MODEL`); so do the older steps, which use `jsonValidated` (a schema and bounded repairs,
  each with its own rules path or its own visible failure). The roles `extraction`, `critic` and `synthesis`
  have settings and no caller.
- **What is proved.** The Foundry provider, the router, the allowances, the cache, the failover and the
  strict-schema conversion are proved against an in-process fake of the endpoint
  (`backend/test/support/fake-foundry.ts`) and **have never run against a live Azure resource**. What a real
  deployment accepts (strict `json_schema`, `reasoning_effort`), its error bodies, its content-filter
  annotations and its prices are unverified ([Verified and not
  verified](./docs/models/foundry.md#verified-and-not-verified)). The live evidence of
  [docs/AZURE.md](./docs/AZURE.md#live-evidence) was gathered with `AI_PROVIDER=azure`.

### Persistence and failure semantics

The database is at schema version 9, applied by numbered migrations (`storage/migrations.ts`): version 1
is the original `projects`, `chunks`, `events` and `messages`; version 2 adds `claim_records`,
`source_conflicts`, `ledger_state` and the append-only `audit_events`; version 3 adds `tenant_id` and
`owner_id` to projects; version 4 adds workspace and project membership; version 5 adds browser sign-in
(`login_attempts`, `sessions`); version 6 adds the durable job queue (`jobs`); version 7 adds Report
Studio documents (`studio_documents`); version 8 adds each project's model usage and limits
(`project_usage`); version 9 adds the lab's artifacts (`project_artifacts`). An existing SQLite file is
copied before it is upgraded, a failed step rolls back, and a database newer than the build is refused
untouched.

**Two dialects, one set of stores.** The stores are written once against `SqlDatabase`
(`storage/sql.ts`): SQL in the SQLite dialect with `?` placeholders, synchronous calls and
`transaction(operation)`. `storage/open.ts` opens what a target names: a file path or `:memory:`
(SQLite through `node:sqlite`, in WAL mode with foreign keys on), a `postgres://` URL, or `pglite:`
(PostgreSQL running inside the process, for tests). The PostgreSQL implementation translates the few
differences (`storage/postgres/translate.ts`), keeps the same migrations (`schema.ts`) and reaches the
server through a worker thread that the process waits for (a synchronous bridge: the thread that serves
requests blocks for the length of every query, so a slow database slows every request;
[ADR 0009](./docs/adr/0009-postgres-through-a-synchronous-bridge.md)),
with serializable transactions retried when they lose a race. `npm run test:postgres` runs the unit
suite on it, and `npm run db:copy` and `npm run db:drill` move and rehearse a database between the two,
reading the source as one snapshot (`SqlDatabase.readSnapshot`), so that a copy is never half of a change.
JSON payloads are decoded with runtime schemas. SQL values are parameterized and
source filenames never become paths. Foreign-key deletion removes associated
chunks/events/conversation. WAL is for a local filesystem, not a shared cloud volume.
Startup detects OneDrive, Dropbox, Google Drive and iCloud Drive folders in the
resolved database path and warns through the server log, and `GET /api/config` returns the same warning
as `storage.warning` (without exposing the local path; the interface does not show it), because synchronization can conflict with
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
Start-up recovery marks as failed only the active stages, platform states, traces and surveys of a
project that no job owns (a database from before the queue); a project with a live job is run by the
queue again, or handed to another worker if its holder stops. Completed upstream output and partial
survey responses are retained. A simulation interrupted after saved rounds names the saved round and
remains resumable (see below).

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

See [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) for resource limits and settings,
[docs/API.md](./docs/API.md) for the routes and their shapes, the [README](./README.md) for how to
run and demonstrate it, and [docs/security-review.md](./docs/security-review.md) and
[docs/threat-model.md](./docs/threat-model.md) for the dependency and threat evidence.
Deployment must not infer production readiness from local test success.

### Hosting and operations (authored, not deployed)

Running Swarm for more than one person, on infrastructure that is not a laptop, is authored and checked
offline, and **none of it has run in Azure** ([docs/production/](./docs/production/README.md) says what was
run, what was not, and what each claim rests on).

- **The deployment guard** (`backend/src/deployment.ts`). `DEPLOYMENT_MODE` is `local` (the default),
  `pilot` or `production`, and an empty or unknown value is refused. The guard runs while the configuration
  is read, so a pilot or production process never starts with an unsafe one: it is refused with every
  violation listed in one error, before anything listens. The rules cover sign-in (Microsoft Entra, an https
  redirect address, bounded sessions), model credentials, the database (TLS, and in `production` PostgreSQL
  with Entra), the hosts and origins served, page reads (https only), telemetry (an Application Insights
  connection string) and the test seams, which must be unset. `local` starts as it always did and logs one
  warning when its settings look hosted. The guard checks configuration. It cannot know where the process
  runs ([the guard matrix](./docs/production/identity.md#1-deployment-modes)).
- **Signals.** The application emits OpenTelemetry metrics and traces of counts, durations and enumerations,
  never of a question, a passage, an address or a person (`backend/src/telemetry/`). Nothing is exported
  unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, and the exporter has been tested only with in-memory
  exporters: it has never sent to a real Application Insights resource. Several signals added for the pilot
  have no caller in the product yet, so an alert on one cannot fire
  ([docs/production/observability.md](./docs/production/observability.md) says which).
- **Infrastructure as code.** The Bicep in `infra/` is the "Authored, not deployed" row of the table under the
  [system diagram](#system-diagram). It compiles, lints and evaluates offline (`npm run iac:validate`).
  Whether any of it deploys, and whether the platform metric names its alert rules read are the platform's
  real ones, are unverified.

## Verification architecture

What each layer of testing can and cannot establish:

| Layer                       | Where                                                      | Establishes                                                                                                                                                                                                                                                                                                      | Does **not** establish                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and integration        | `backend/test`, `frontend/src/**/*.test.ts(x)`             | Business rules, state machine, determinism, contracts, security boundaries, component behaviour, and the interface's own guards (colours only from the tokens, the contrast of every theme, the type, cascade and motion rules)                                                                                  | Browser rendering, real network behaviour                                                                                                                 |
| Browser end-to-end (local)  | `e2e/local`                                                | The whole user journey, errors, responsive layout, axe, keyboard/focus, in real Edge/Chromium, over real HTTP                                                                                                                                                                                                    | Anything about model behaviour                                                                                                                            |
| Browser end-to-end (model)  | `e2e/model`                                                | Orchestration of the model path: real Pause click, resume, injected failure + recovery, token accounting, hostile output handling                                                                                                                                                                                | Quality or safety of a **live** model's output                                                                                                            |
| Browser end-to-end (lab)    | `e2e/lab`                                                  | The lab through its scenes, from the first screen to the brief: the flagship and custom journeys, the participants' review, the constraints page, the Decision Canvas, what opens each scene, what is out of date, the deep dive; public pages are fixtures                                                      | Model behaviour, or any page on the real internet                                                                                                         |
| Browser end-to-end (other)  | `e2e/journey`, `e2e/signin`                                | The recorded presentation and Report Studio; browser sign-in and the access dialogs against a test identity provider                                                                                                                                                                                             | A live model; a real Entra tenant                                                                                                                         |
| Lab pipeline (unit)         | `backend/test/lab-journey.test.ts`, `lab-pipeline.test.ts` | Question to brief through the real routes and the real engine, for each example and for a question no example knows                                                                                                                                                                                              | The browser, or any model                                                                                                                                 |
| Live verification           | `npm run azure:verify`                                     | 15 checks of the whole journey against a real, running deployment (per-actor calls, grounding, branch, chats, injection probe)                                                                                                                                                                                   | Quality beyond the counts it reports; scale                                                                                                               |
| Real-browser audit          | `scripts/ui-audit.mjs`                                     | Screenshots and layout and accessibility metrics at five viewports, in light and dark, for design review; it asserts nothing                                                                                                                                                                                     | Subjective design quality                                                                                                                                 |
| Load measurement            | `scripts/load-test.mjs`                                    | Latency percentiles, queue back-pressure and memory **on the machine it runs on**                                                                                                                                                                                                                                | Capacity planning                                                                                                                                         |
| AI-assisted setup, measured | `npm run eval:ai`, `evaluation/`                           | Participant coverage, hard-constraint recall, source reading, seeded critic flaws and injection handling, on labelled scenarios: by the rules paths, and by the real client and output policy against a scripted fake of the Foundry endpoint ([docs/production/evaluation.md](./docs/production/evaluation.md)) | A live model's behaviour: the live mode is written and **has not been run**. Two thresholds are breached and recorded in `evaluation/known-breaches.json` |
| Infrastructure as code      | `npm run iac:validate`, `infra/`                           | That every Bicep template and parameter file compiles, lints and evaluates offline, and the invariants asserted in `scripts/iac/infra-invariants.test.ts`                                                                                                                                                        | That anything deploys, or that a platform metric is named as an alert reads it                                                                            |

The subsystems added for the controlled pilot are tested in files of their own, in the unit and integration
layer: `backend/test/research-*` (the crawler on a virtual clock and a fake network, the run through the
real application, hostile pages), `participants-*`, `constraints-*` (including the golden digests),
`decision-*`, `model-*` and `foundry-*` (the output policy, the router, the runner and the client against
`support/fake-foundry.ts`), `telemetry-*`, `deployment.test.ts` (the guard) and `readme.test.ts` (which
holds the documents to the code, links and commands included). None of them uses the real network, a real
model or Azure.

**The fake provider** (`e2e/support/fake-provider.ts`) implements the Ollama `/api/chat` protocol so the real
`ModelClient`, orchestrator, persistence and UI run end to end with no credential. It derives each answer from
the request (population size, round, intervention, evidence IDs) and lets tests inject latency, a failure on a
chosen round, or an invented citation. It is a test double. Its existence must never be read as evidence about
any live model; live evidence comes only from `npm run azure:verify` against a real deployment (see
[docs/AZURE.md](./docs/AZURE.md#live-evidence)).

**Isolation.** Playwright starts an application server of its own for each of the `local`, `model`,
`journey`, `signin` and `lab` projects (the sign-in one beside a test identity provider, the model one
beside the fake provider, and a second lab server for the examples beside a fixture web server whose pages
the real public page reader fetches, so that no test reaches the internet), each with throwaway data (a
directory, or memory for the examples server), so the suite can never touch a developer's own scenarios. The
ports and how to move them are in [docs/TESTING.md](./docs/TESTING.md).

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

## Known limitations

What is not built, and what has not been shown. The README keeps a short version of this list.

**Not built, per [ADR 0014](./docs/adr/0014-scenario-lab.md):**

- **Historical backtesting.** `shared/backtest.ts` and four `backtest-*` artifact kinds describe a case, an
  outcome kept apart from the run, a leakage report and a result. No engine, route or page uses them, and
  nothing in Swarm has been compared with what really happened.
- **A model run repeated many times.** The repeated runs use the rules engine. Run-to-run variation of a
  model is unmeasured, and the analysis says so.
- **Word or slide exports.** The brief is exported as Markdown, JSON and a printable page (printed from
  the browser).
- **Hosted execution of long analyses.** A comparison runs in the server process, at most two at a time,
  and is marked interrupted if the process stops.

**The lab, as built:**

- **Rules readings are shallow.** The rules read English patterns and role words. They find the groups
  that a text names with a role word and miss the others, can misread a question, and give a group a
  direction of impact only from its category (a group that bears cost, or benefits) or from the wording of
  the sentences that name it. Where no group has one the comparison warns that nobody has an expected
  direction of impact.
- **Nothing is calibrated.** Every trait is an assumption with an origin, group sizes are weights, and an
  outcome follows from them. It is not evidence about the world.
- **The lab's documents are not in the JSON snapshot export.** `GET .../export?format=json`
  holds the project record, passages, ledger and messages; the scenario, research runs, participants,
  actors, constraints, comparisons, critiques and brief are separate documents. A brief is exported on its
  own (`GET .../brief/export`), and `npm run db:copy` carries all of them between databases. A branch copies
  only the scenario, and its documents with where each came from (a page the server fetched stays a
  retrieved page).
- **Retrieved pages are the page.** No JavaScript runs and no image or sign-in page is read, and the
  one-page route reads no PDF either (automatic research reads text PDFs through the isolated PDF reader,
  with no OCR). Which
  part of a web page is its own text (its menus, side panels and footers are left out) is a guess from how
  the page is built, and a note says so; so does a note when most of a page is built by scripts or shown
  from another page (a frame), which are not read. The record of which pages the server fetched is in the
  memory of one process for an hour, and the limit on pages read at once is for one process: behind several
  replicas each keeps its own.
- **Automatic research is a rules-based reader of a few pages, not a search.** No search provider is built:
  a question with no page or site ends `blocked`, and only the pages and sites a person names, and what
  they link to, are read, within a budget (12 pages and 4 sites by default). Which pages are chosen is a
  lexical and rule-based estimate of the kind of site and of how much of the plan a page covers, not a
  judgement that a page is right. A run starts from one page or one site, and sources can be added to a
  project only before its grounding step is ready or running. A run holds its process's one worker for as
  long as it takes (the job is held to 15 minutes).
  Its tests use a fake web on a virtual clock and loopback servers: no test reads the real internet, and no
  model other than a scripted one has planned a run.
- **Participants and constraints are proposals, and the rules that make them fall short of their targets.**
  A quote shows that a source says something, not that it is so, and a person confirms or rejects what is
  kept. On the labelled set the rules path found 67.1% (108 of 161) of the labelled participant roles
  against a registered threshold of 90%, and 75.5% (37 of 49) of the hard constraints against 80%; both are
  recorded as breaches in `evaluation/known-breaches.json`. The set is small, in one fictional domain and
  labelled by the author. Against a scripted fake of a model, a reply that attached a real quote from
  another passage was not caught (0 of 12 for each of the two steps), and a model's claim that a limit is
  hard, where the words do not make it one, was accepted in 12 of 100 cases. A real model has not been
  measured at all ([docs/production/evaluation.md](./docs/production/evaluation.md)).
- **The Decision Canvas reads simulated results.** It has no objective of its own, its lenses are named
  readings of what the analysis measured, and a `robust-option` status means that the leader held across the
  checks that were run, not that the world will go that way. Eight kinds of constraint effect are applied
  in the runs; the size of an effect is a modelling choice, and a limit stated in words that has no effect is
  read, listed and applied nowhere.
- **The conflict scan is bounded.** So that a project at the evidence limit cannot stall the server, a
  word that more than 512 sentences hold is not used to find partners and a sentence is compared with at
  most 128 of them (the ones that overlap it most); a pair that is not reached within those limits is
  skipped without a message, so on very large or repetitive evidence a conflict can go unfound. Evidence of
  a few hundred sentences reaches neither limit (`grounding/contradictions.ts`).
- **The two engines can disagree**, and the cross-check says that it compares different engines.

**The deep dive and the platform**, as they stood when they were last measured:

- **Model output varies.** Model-assisted runs are not reproducible. Rerunning gives different
  actors, posts and reports. The demonstration is a recording for that reason.
- **Grounding is imperfect.** The deterministic support check accepted 3 of 8 unsupported statements
  in a labelled set, because word overlap cannot read meaning. The conflict detector found 1 of 3
  labelled conflicts, raises false alarms on some material and misses conflicts of meaning; you
  confirm or dismiss every candidate. The evaluation sets are small, in one fictional domain, and
  labelled by the author; see [evaluation/README.md](./evaluation/README.md).
- **Unsupported questions can slip through.** The analyst's first check refuses off-topic questions
  and years the sources never mention, but lets through 3 of 4 plausible questions about something
  absent. Those rest on the model declining, which is seen only in live runs.
- **The analyst can miss a conflict unless you ask.** In the demo it said it found no direct
  contradictions when asked in general terms, although two are planted, and found the difference
  when asked about it by name.
- **Rules mode has no statements in its ledger.** It produces no grounding review, so the ledger
  shows conflicts and assumptions only.
- **Proxies tend to sound like an analyst.** Their answers are useful, but often read as a summary
  rather than as the character speaking.
- **Chat citations show what the model was given, not what supports each sentence.**
- **The grounding review checks the report against the sources, not the sources against the world.**
  Only the statements the writer lists are checked.
- **Limited scale.** Model mode accepts 4 to 10 proxies and 3 to 10 rounds, and a stage's model
  calls are budgeted. Only six proxies and six rounds were exercised live.
- **Not hosted.** Nothing is deployed in Azure except the model. There is one process; the data is
  one SQLite file, or a PostgreSQL database you provide. The PostgreSQL adapter has been tested
  against PostgreSQL running in-process and over the wire protocol, never against a deployed Azure
  server, and it reaches the database through a synchronous bridge that blocks the process for the
  length of each query ([ADR 0009](./docs/adr/0009-postgres-through-a-synchronous-bridge.md)). There
  is no hosted worker and no managed identity for the application. A hosted container, a PostgreSQL
  server, a managed identity, Application Insights, alert rules and a budget are authored as Bicep and
  validated offline, and none is deployed; the deployment guard has been run only in tests.
- **Identity gaps.** Browser sign-in and the seven roles exist and are tested, but only against a
  test identity provider: no real Entra tenant has been used, because creating the app registration
  needs a tenant administrator. A session ends only Swarm's side of the sign-in (there is no single
  sign-out), and a platform-administrator role removed in Entra lasts until the session ends. There
  is no directory lookup: people are added by their Entra object id, so the page cannot say who an
  id belongs to and a wrong id gives access to the wrong person (the audit log records who added
  whom). There are no groups, no invitations by name or email, and one workspace per tenant.
- **Durable jobs have not run across real containers.** Stages are jobs in the database: they survive
  a restart, a worker that stops is replaced after its lease runs out, and a simulation continues from
  its last saved round ([ADR 0010](./docs/adr/0010-durable-jobs-leased-from-the-database.md)). That is
  tested with a second worker modelled as a second queue consumer in one process, on SQLite and on
  PostgreSQL in-process; two real processes racing for one deployed PostgreSQL row have not been tried.
  A worker that lost its lease is stopped at its next write to the project, its events or its usage,
  but not at a ledger write it is already making. A process killed outright waits for its lease (up
  to 30 seconds) before its run is taken over.
- **Monitoring has not reached a real Application Insights resource.** OpenTelemetry traces and metrics
  (requests, jobs, model calls, queue depth, denials, grounding) are built and tested with in-memory
  exporters, and the export to Application Insights is authenticated with Microsoft Entra; the
  dashboards and runbook in [docs/operations/](./docs/operations/observability.md) are
  written, not created or rehearsed, and the alert rules and budget exist only as Bicep
  ([docs/production/observability.md](./docs/production/observability.md)): compiled offline, never deployed, never fired.
  Several signals added for the pilot (those for participants, for constraints and for the duration of a
  simulation) have no caller in the product yet, so an alert that reads one cannot fire.
- **Report Studio has been tried on a recording, not in use.** Writing a chapter again has run only
  against a stand-in for the provider that speaks the real protocol, never against a live model, so
  how good the rewritten chapters are is unknown; the checks catch a quotation that is not in the
  passages, wording no passage supports and a figure that matches nothing, not a wrong statement
  that cites a passage saying something else. An approval is a record in this application (who, when
  and a hash of the exact text), not an external attestation, and it does not make a statement true.
  There is no live co-editing, merge or comment thread: a second person saving the same section is
  refused. Only chapters can be written again, one at a time, with the provider that wrote the
  report; there is no generated PDF, the memo is printed from the browser.
- **Themes are written, not designed.** The light, dark and high-contrast palettes are written out one by
  one in `design/tokens.css`, and tests hold them to WCAG contrast ratios (computed from the tokens, with
  every translucent surface laid over its backdrops) and run axe-core in each theme. No designer has
  reviewed them, nobody has used them with a screen reader, a real touch device or a Windows high-contrast
  session, and the browser tests only emulate forced colours. [UX.md](./docs/UX.md#not-done) lists what else
  is not done.
- **Incomplete human reviews.** Security, privacy, responsible-AI, licence, accessibility
  (screen-reader and forced-colours) and legal reviews have not been done; the
  [review checklist](./docs/pitch/human-review-checklist.md) says what to put before each reviewer.
- **Usage cost.** A recorded real-model scenario (three runs, 199 model calls, about 534,000 tokens
  in and 62,000 out) cost roughly US$0.30 at assumed list prices. Longer sources and more proxies
  cost more. Each project has a model budget (calls and tokens: a deployment default, and a limit that
  only a workspace owner or administrator may change) and each run a call budget, but the application has
  no per-tenant total, no daily limit and no spend alert (the pilot template's Azure budget only notifies,
  and is not deployed). A research run has an estimated cost limit of its own, and `MODEL_OPERATION_*`
  holds one operation that goes through the task runner to tokens and estimated dollars. A cost is an
  estimate from prices an operator enters: Swarm ships none.
- **Text only.** Scanned PDFs need OCR, which is not implemented. Web pages are read as text: no script
  runs and no page behind a sign-in is read. Automatic research follows only what a person names and
  what it links to, and there is no search provider and no live social-media connection.

See also the [requirements matrix](./docs/requirements-matrix.md), the
[production-readiness gates](./docs/production-readiness.md) and the
[risk register](./docs/program/risk-register.md).

## Azure migration direction

The local MVP is the prerequisite. Do not deploy paid resources merely to run it.
See [docs/AZURE.md](./docs/AZURE.md) for the phased migration plan and acceptance
criteria, and the [README](./README.md) for local operations.

1. Keep the same React/API container. **Azure Container Apps** is the chosen host for the pilot
   (App Service remains the alternative when built-in Entra authentication and
   conventional web hosting are the stronger fit); choose one, not both. The pilot template runs it in
   multiple-revision mode so that a release is blue/green and a rollback is a traffic change
   ([docs/production/release-process.md](./docs/production/release-process.md); the rollback drill has **not** been run).
2. Entra authentication to **Azure OpenAI / Foundry** is implemented in the adapter
   (`DefaultAzureCredential`; `AZURE_CLIENT_ID` names a user-assigned managed identity) and `infra/` creates
   an Entra-only account with keys disabled. The `azure` provider ran live once, on 28 October 2026, against
   one development deployment with Entra and no key ([docs/AZURE.md](./docs/AZURE.md#live-evidence)). A
   managed identity has **not** been exercised live, and the `foundry` provider (strict structured output,
   a router, allowances and a cache) has been proved only against an in-process fake. Use a deployed model
   supporting JSON Chat Completions; whether it accepts strict `json_schema` is among what a first live
   run has to settle ([Foundry models](./docs/models/foundry.md#verified-and-not-verified)).
3. Before durable public hosting, use a managed PostgreSQL database. The PostgreSQL adapter
   ([ADR 0009](./docs/adr/0009-postgres-through-a-synchronous-bridge.md)) and durable job ownership
   ([ADR 0010](./docs/adr/0010-durable-jobs-leased-from-the-database.md)) are built and tested
   in-process and over the wire protocol, and have not met a deployed server, so that, and a rehearsed
   point-in-time restore, remain to be shown. The lab's comparisons are not jobs: they run in the request
   process, so give each replica its own limit. Do not put SQLite WAL on Azure Files, or depend on an
   ephemeral container filesystem.
4. Add **Blob Storage** only when document size/retention requires separating files
   from database records. Add **Azure AI Search** only when measured retrieval needs
   semantic/vector search at a corpus size beyond the bounded local index.
5. Use **Key Vault** for unavoidable secrets (the pilot template has an opt-in vault, never deployed); managed identity is preferable to
   storing Azure model keys. **Application Insights / OpenTelemetry** is the production telemetry: the
   exporter, with content and credential redaction, is built and has never sent to a real resource, and the
   deployment guard refuses a pilot or production start without its connection string.
6. **Functions** do not simplify the stateful simulation loop. **Cosmos DB** is not
   necessary for this relational local schema and would require a distinct adapter.
7. Set `DEPLOYMENT_MODE` to `pilot` or `production` for any hosted process, so that an unsafe configuration
   is refused when it starts ([Hosting and operations](#hosting-and-operations-authored-not-deployed)). The
   guard has run only in tests.

Production prerequisites: authentication/authorization and tenant isolation,
durable storage and jobs, backup/restore verification, HTTPS, quotas/cost controls,
secret management, telemetry, source availability, and a deployment security review.
None of these are implied by a successful local demonstration.
