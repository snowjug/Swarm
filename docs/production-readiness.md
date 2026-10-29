# Production-readiness gates

Swarm is a **pitch-ready prototype**. It is **not production ready**. This page lists the gates a
service of this kind would be held to, and says honestly which are met.

How to read it:

- **PASS** needs executable evidence that anyone can re-run, named in the row.
- **PARTIAL** means part of the gate is met; the row says which part.
- **NOT MET** and **NOT STARTED** mean exactly that.
- **REVIEW REQUIRED** marks a gate that only a person with the standing to sign it off can pass. It
  is never marked PASS here, because that sign-off is not the author's to give. The
  [review checklist](./pitch/human-review-checklist.md) says what to put in front of each reviewer.

## Engineering

| Gate                                                                    | Status  | Evidence, or what is missing                                                                                                                                            |
| ----------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types, lint, format, unit tests and build are clean                     | PASS    | `npm run check` and `npm run format:check`. Counts are in the [requirement matrix](./program/requirement-matrix.md)                                                     |
| End-to-end journey, error states, responsive layout and axe checks pass | PASS    | `npm run test:e2e` (Microsoft Edge locally, Chromium in CI)                                                                                                             |
| Builds and tests pass from a clean clone, in CI                         | PASS    | The CI workflow runs `npm ci`, the checks, the end-to-end suite and a container build on every push and pull request; its result for this branch is on the pull request |
| A real model run with keyless Entra authentication passes               | PASS    | `npm run azure:verify` (15 checks). One run per milestone, against one deployment; it is not a distribution                                                             |
| Evaluation floors hold                                                  | PASS    | `npm run eval`, `evaluation/test/evaluation.test.ts`. Small, in-domain, author-labelled sets; no model is measured                                                      |
| A model-in-the-loop regression suite                                    | NOT MET | No test calls a model. Behaviour with a model is observed in live runs only                                                                                             |
| Grounding quality measured on real documents                            | NOT MET | Needs documents the pilot users supply, under a data-handling agreement                                                                                                 |

## Security and privacy

| Gate                                                              | Status          | Evidence, or what is missing                                                                                                      |
| ----------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| No secrets in the working tree or in any reachable commit         | PASS            | `npm run scan:secrets`; also run in CI                                                                                            |
| No known-vulnerable dependency at the last run                    | PASS            | `npm audit`; also run in CI. A point-in-time result                                                                               |
| Sign-in verified against a **real** Entra tenant                  | NOT MET         | Needs an app registration and app roles. Only a tenant administrator can create them. Tested so far against a local test provider |
| Browser sign-in                                                   | NOT MET         | The API verifies tokens; the single-page app cannot obtain one                                                                    |
| Authorisation and tenant isolation                                | PARTIAL         | Tested and mutation-checked in the API. Application-level only: no row-level security, one owner per project, no sharing          |
| Software bill of materials and signed provenance                  | NOT MET         |                                                                                                                                   |
| Independent security review and penetration test                  | REVIEW REQUIRED | The existing [security review](./security-review.md) was written by the author. It is not independent                             |
| Privacy review: retention, audit-log principal ids, uploaded text | REVIEW REQUIRED | No retention rule exists for audit entries that outlive a project                                                                 |
| Licence review (AGPL-3.0, network-use clause)                     | REVIEW REQUIRED |                                                                                                                                   |
| Responsible-AI review                                             | REVIEW REQUIRED | Personas are fictional proxies; no bias or fairness testing was done                                                              |

## Data and operations

| Gate                                                               | Status      | Evidence, or what is missing                                                                                                                             |
| ------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A database that more than one instance can use                     | NOT MET     | SQLite. [ADR 0006](./adr/0006-postgres-adapter-proposed.md) proposes PostgreSQL; it is not built                                                         |
| Backup and restore tested                                          | NOT MET     | Only a copy taken before a schema upgrade, which is tested                                                                                               |
| A run that survives a restart                                      | NOT MET     | An interrupted run is marked failed and can be retried; pause and resume from saved rounds work. Nothing resumes automatically                           |
| Traces, metrics and alerts (OpenTelemetry, Application Insights)   | NOT MET     | Structured logs without content, and per-project token and call counts                                                                                   |
| Cost controls                                                      | PARTIAL     | A call budget per operation, a 15-minute budget per run, a rate limiter and a project limit per tenant. No per-tenant token budget and no alert          |
| Load and soak on target hardware                                   | PARTIAL     | `node scripts/load-test.mjs` measures the local rules engine on one machine. It predates the ledger and sign-in endpoints and says nothing about a model |
| Infrastructure as code for hosting, deployed to a test environment | NOT STARTED | Bicep exists for the model resources only. Nothing here provisions a host, a database, a key vault or monitoring                                         |

## Experience

| Gate                                                 | Status          | Evidence, or what is missing                                                                                                  |
| ---------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Automated accessibility checks at four viewports     | PASS            | `e2e/local/a11y.spec.ts`, `e2e/local/responsive.spec.ts`, `e2e/model/ledger-ui.spec.ts` (axe, keyboard, 1920×1080 to 390×844) |
| Assistive-technology and manual accessibility review | REVIEW REQUIRED | Not done                                                                                                                      |
| Dark, light and high-contrast themes                 | NOT MET         | Light only                                                                                                                    |
| A component library and design system                | NOT MET         | Custom CSS. No Fluent UI package, no Storybook                                                                                |

## Reading the table

Of the 28 gates above, 8 are met in the narrow sense stated, 3 are partly met, 5 need a human review
before they can pass, and 12 are not met or not started. The unmet gates that block a hosted pilot,
as opposed to a demonstration, are: a multi-user database, a real-tenant sign-in with a browser
flow, observability, and a decision on audit-log retention. They are the first items in the
[roadmap](./pitch/roadmap.md).
