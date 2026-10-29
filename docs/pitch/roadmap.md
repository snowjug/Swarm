# Roadmap

What comes next, in the order that unblocks a pilot. The P0 to P3 classification of every item is in
the [product roadmap](../microsoft-product-roadmap.md); this page orders the work for the pilot
described in the [pilot plan](./pilot-plan.md). Nothing here is scheduled or staffed, and no estimate
is a commitment.

**Option A of the pilot (local) needs none of Phase 1.** Phase 1 is what a hosted pilot (Option B)
needs.

## Phase 1: make a hosted pilot possible

| Order | Work                                                                                                                                                      | Class | Needs                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------- |
| 1     | An asynchronous repository interface, with no behaviour change, and the full suite as the safety net                                                      | P2    | Engineering time                      |
| 2     | A PostgreSQL implementation behind it, with row-level security and the same tests run against both ([ADR 0006](../adr/0006-postgres-adapter-proposed.md)) | P2    | Order 1; an approved database         |
| 3     | Browser sign-in (MSAL) and a real Entra app registration with the four app roles                                                                          | P2    | A tenant administrator                |
| 4     | OpenTelemetry traces and metrics to Application Insights; a per-run cost signal                                                                           | P2    | Order 7 for a destination             |
| 5     | Per-tenant token budgets with alerts                                                                                                                      | P2    | Order 4                               |
| 6     | Automatic resume of a run interrupted by a restart                                                                                                        | P2    | Order 1                               |
| 7     | Bicep for hosting (Container Apps, Container Registry, PostgreSQL, monitoring, managed identities), validated and deployed to a test subscription         | P2    | **Approval for chargeable resources** |

## Phase 2: evidence quality

| Work                                                                                      | Class | Needs                          |
| ----------------------------------------------------------------------------------------- | ----- | ------------------------------ |
| A labelled evaluation set from **real** documents, under a data agreement                 | P1    | The pilot's approved documents |
| A model-assisted pass for conflicts of meaning (the semantic and anaphoric misses)        | P1    | The set above, to measure it   |
| A scheduled, cost-capped model-in-the-loop regression suite                               | P1    | A budget                       |
| Analyst-entered assumptions with dependency tracking through branches                     | P1    | Design                         |
| A report studio: compose a report from reviewed statements and publish it with its ledger | P1    | Design with analysts           |
| Anchor the audit chain head outside the database; settle retention                        | P2    | A retention decision           |

## Phase 3: experience

Fluent UI components and design tokens; dark and high-contrast themes; Storybook; assistive-technology
testing and a formal accessibility review (P1 for the demonstration, P2 for production).

## Phase 4: research and product opportunities (P3)

Semantic retrieval or Azure AI Search, **only if** a real corpus shows lexical retrieval is the
limit; larger populations; document connectors; multi-language interface; quantitative analysis of
simulation output (sensitivity, intervals), with care that it does not suggest precision the
simulation does not have.
