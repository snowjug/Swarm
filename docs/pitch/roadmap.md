# Roadmap

What comes next, in the order that unblocks a pilot. The P0 to P3 classification of every item is in
the [product roadmap](../microsoft-product-roadmap.md); this page orders the work for the pilot
described in the [pilot plan](./pilot-plan.md). Nothing here is scheduled or staffed, and no estimate
is a commitment.

**Option A of the pilot (local) needs none of Phase 1.** Phase 1 is what a hosted pilot (Option B)
needs.

## Phase 1: make a hosted pilot possible

Most of this is built and has never met the real thing. The state column says which.

| Order | Work                                                                                                                          | State                                                                                                                           | Needs                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1     | A database that more than one instance can use: PostgreSQL behind the unchanged stores                                        | Built and tested in-process ([ADR 0009](../adr/0009-postgres-through-a-synchronous-bridge.md)); never against a deployed server | An approved database                  |
| 2     | Browser sign-in, and a real Entra app registration with the app roles                                                         | Sign-in built and tested against a test identity provider ([ADR 0008](../adr/0008-browser-sign-in.md)); no real tenant          | A tenant administrator                |
| 3     | A run that survives a restart: durable jobs, leases, bounded retries, resume from the last saved round                        | Built ([ADR 0010](../adr/0010-durable-jobs-leased-from-the-database.md)); not run across separate containers                    | A deployed environment                |
| 4     | OpenTelemetry traces and metrics to Application Insights; a per-run cost signal                                               | Instrumentation and an Entra-signed export built and tested with in-memory exporters; no Application Insights resource          | Order 6 for a destination             |
| 5     | Per-tenant token budgets with alerts                                                                                          | Not built                                                                                                                       | Order 4                               |
| 6     | Bicep for hosting (Container Apps, PostgreSQL, monitoring, managed identities), validated and deployed to a test subscription | Compiles and lints; no what-if run; nothing deployed ([pilot plan](../azure/pilot-plan.md))                                     | **Approval for chargeable resources** |
| 7     | Row-level security in PostgreSQL                                                                                              | Not built; isolation is enforced in application code only                                                                       | Order 1                               |
| 8     | A screen for sharing a project and managing members                                                                           | Built: People (workspace) and Access (project) screens, by Entra object ID, tested in a browser; no directory lookup            | A real tenant to try it in            |

## Phase 2: evidence quality

| Work                                                                                                                                           | Class | Needs                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------- |
| A labelled evaluation set from **real** documents, under a data agreement                                                                      | P1    | The pilot's approved documents   |
| A model-assisted pass for conflicts of meaning (the semantic and anaphoric misses)                                                             | P1    | The set above, to measure it     |
| A scheduled, cost-capped model-in-the-loop regression suite                                                                                    | P1    | A budget                         |
| Analyst-entered assumptions with dependency tracking through branches                                                                          | P1    | Design                           |
| Report Studio beyond the first version: try writing a chapter again on a live model and measure it, comments, a generated PDF, live co-editing | P2    | Analysts using the first version |
| Anchor the audit chain head outside the database; settle retention                                                                             | P2    | A retention decision             |

## Phase 3: experience

Fluent UI components; Storybook; assistive-technology
testing and a formal accessibility review (P1 for the demonstration, P2 for production).

## Phase 4: research and product opportunities (P3)

Semantic retrieval or Azure AI Search, **only if** a real corpus shows lexical retrieval is the
limit; larger populations; document connectors; multi-language interface; quantitative analysis of
simulation output (sensitivity, intervals), with care that it does not suggest precision the
simulation does not have.
