# Executive summary

## What it is

Swarm takes a question and a set of documents, builds a knowledge graph from them, creates fictional
stakeholder proxies, simulates several rounds of how those proxies might react, and writes a
report. It explores possible scenarios. It does not predict the future.

What sets it apart is that the report **audits itself against its sources**. Every material
statement carries a type (source fact, assumption, simulated event, recommendation and so on) and a
support class (directly supported, partly supported, contradicted, unsupported, simulation derived
and so on). A deterministic policy, not a model, decides how each may be shown. The analyst chat
declines, in fixed words and without calling a model, when the project's evidence cannot answer.
Conflicts between sources are surfaced for a person to confirm or dismiss. Every review is written to
a tamper-evident audit log.

## What is real

- It runs locally with no cloud, and also against a real Azure model with keyless Microsoft Entra
  authentication. A fifteen-check live scenario passed against a deployed model at the baseline and
  after the chat changes (see [evaluation results](./evaluation-results.md)).
- The evidence layer, the abstention gate, the conflict detector, the assumption register, the audit
  log, sign-in (a bearer token or the browser) with seven roles and tenant isolation, an optional PostgreSQL
  adapter, durable stage jobs, OpenTelemetry instrumentation, light, dark and high-contrast themes, Report
  Studio (edit, review and approve the report, with a printable memo), and six synthetic demonstration packs
  are built and tested. The [requirement matrix](../program/requirement-matrix.md) gives counts and evidence.
- A starting measurement was taken before any change, so improvements are compared with something:
  [the baseline](../program/baseline.md).

## What is not

- It is not production ready. See [the gates](../production-readiness.md): 8 of 29 are met.
- Sign-in has never been used with a real Entra tenant. People are added by Entra object ID (there is no directory lookup).
- Storage is SQLite unless a PostgreSQL database is configured. The PostgreSQL adapter passes the unit suite
  in-process and has never run against a deployed server; the job queue has not run across separate
  containers.
- Telemetry is built and tested with in-memory exporters; no Application Insights resource exists. Each
  project has a model budget; there is no per-tenant total or spend alert. Nothing is hosted: the Azure pilot is planned, costed and compiled, not deployed.
- Report Studio has run on a recording, and writing a chapter again only against a stand-in for the provider.
- The checks behind the support classes are heuristics. The deterministic check accepted 3 of 8
  unsupported statements in a labelled set. The analyst's abstention catches off-topic questions and
  unknown years but only 1 of 4 plausible-sounding questions about something absent.
- The evaluation sets are small, in one fictional domain, and labelled by the author. Nothing has
  been measured on real documents.

## What is asked

Three decisions, in order, from [the decisions page](./decisions-needed.md): whether to proceed to a
pilot, what data the pilot may use, and who owns the reviews that only people can pass. The
[pilot plan](./pilot-plan.md) proposes a scope that can be run on the current build plus the work in
the first roadmap phase.

The [cost model](./cost-model.md) puts a full live scenario at roughly six to eight US cents of model
usage at list price, as an estimate with its assumptions stated.
