# The production-candidate pilot: index, verdict and what was not run

Back to the [README](../../README.md#production-status). This folder holds everything that was written to take Swarm
from a local application to a first hosted run, and, as importantly, what is **not** true of it yet.

## The verdict, in words that may be used

Swarm is **a production-candidate controlled pilot, authored and validated offline, not deployed.**

- It is a pilot for a few invited people on a dev/test credit subscription, not a broad production service.
- "Authored and validated offline" means the Bicep compiles, lints and evaluates with a pinned Bicep CLI, the release,
  rollback and pre-flight tools pass their tests against a fake `az`, the deployment guard and the privacy rules pass
  theirs, and the AI-assisted setup was measured in rules and fake-Foundry modes. It does not mean that Azure accepts
  any of it.
- **No Azure authorization exists on the machine this was written on** (no `az` login, no credential, no managed
  identity), so nothing was provisioned, deployed or tested in Azure, and the remaining credit and the spend so far
  could not be read.

Not to be said, because nothing here shows it: production-ready, enterprise-grade, secure, highly available, tested in
Azure, "researches the open web" (no search provider is configured), or that rollback works.
[What would have to be true](./LIMITATIONS.md#what-would-have-to-be-true-to-call-it-production) lists, in order, what
has to happen before any other words are used.

## What was not run

Each of these is a gap, not a pass. None is hidden elsewhere: every page below marks what depends on it as
**UNVERIFIED**.

| Not run                                       | Why                                                                                                       | Where it is said                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **The live Foundry evaluation**               | The live mode refuses to run without `--live`, a Foundry configuration and credentials                    | [evaluation.md](./evaluation.md#the-three-modes); every live row of `evaluation/results/ai-latest.md` reads `NOT MEASURED`                  |
| **A journey against a deployed address**      | Nothing is deployed; `npm run azure:pilot-smoke` has only run against fakes                               | [LIMITATIONS.md](./LIMITATIONS.md#nothing-has-been-deployed-or-proven) (N1, N5)                                                             |
| **The rollback drill**                        | It needs a deployed app; the tooling has only met a fake `az`                                             | [release-process.md](./release-process.md#the-rollback-drill)                                                                               |
| **The PostgreSQL restore**                    | There is no hosted server to restore; the logical drill (`npm run db:drill`) exists and is tested locally | [runbook.md](./runbook.md#restore-the-database-to-a-new-server), [database.md](./database.md#9-backups-point-in-time-restore-and-retention) |
| **A live alert**                              | No Application Insights resource exists, so no rule has read a metric or fired                            | [observability.md](./observability.md#queries-to-run-once-after-the-first-deploy)                                                           |
| **PostgreSQL over TLS with Entra from Azure** | The measurements and race tests used a PostgreSQL 16 container on the same machine                        | [database.md](./database.md#5-measurements-noisy-shared-vm)                                                                                 |

Also not run: sign-in against a real Entra tenant, more than one replica against one database, the Key Vault secret
path, private networking, an independent security review, and the scope check on questions that its author did not
write (a single reading of 7 requests of the evaluation's safety set is not a recorded result;
[A14](./LIMITATIONS.md)).

## The documents in this folder

| Document                                                                                   | What it is                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PLAN.md](./PLAN.md)                                                                       | The plan of this wave, the environment limits that shaped it, the design decisions, and the AI-evaluation thresholds that were fixed before any result existed                                                                                    |
| [LIMITATIONS.md](./LIMITATIONS.md)                                                         | Everything that is not true, not done, not measured or not checked, with a cure for each, and the nine things that would have to be true to call it production                                                                                    |
| [azure-preflight.md](./azure-preflight.md)                                                 | The read-only pre-flight, list prices read from the public Retail Prices API on 3 November 2026, the monthly estimate, "stop if" thresholds and what the owner must do                                                                            |
| [release-process.md](./release-process.md)                                                 | How a version reaches the hosted app and is taken back: blue/green revisions, the release record, the rollback and the rollback drill, which has **not** been run                                                                                 |
| [runbook.md](./runbook.md)                                                                 | Who decides, the first fifteen minutes, rolling back, the emergency stop, restoring the database to a new server and the database roles                                                                                                           |
| [observability.md](./observability.md)                                                     | The 18 alert rules and the budget in `infra/pilot`, the signal each one reads, whether that signal exists, and the queries to run after the first deploy                                                                                          |
| [privacy-telemetry.md](./privacy-telemetry.md)                                             | The product signals, what telemetry and logs are built never to say, and the tests that hold them to it                                                                                                                                           |
| [identity.md](./identity.md)                                                               | Sign-in, roles and sessions, the Entra application, and the deployment guard: `DEPLOYMENT_MODE`, `DEPLOYMENT_LABEL` and every rule that refuses an unsafe hosted start                                                                            |
| [database.md](./database.md)                                                               | How a request reaches SQLite and PostgreSQL, where a query stops the process, what a request costs, measurements (noisy, shared VM), the load ceiling and the race tests                                                                          |
| [threat-model.md](./threat-model.md)                                                       | STRIDE-style tables for what is new: research and the crawler, models, cost, tenants and telemetry, identity, data, the platform and the supply chain                                                                                             |
| [evaluation.md](./evaluation.md)                                                           | How the AI-assisted setup, the research planner, whole research runs and the Decision Canvas are measured, the three modes, the current results, the thresholds still breached, what the evaluation found in the product, and what it cannot show |
| [prices/azure-retail-prices-2026-11-03.json](./prices/azure-retail-prices-2026-11-03.json) | The snapshot of list prices that the cost plan and its unit test read                                                                                                                                                                             |

Elsewhere, and part of the same picture: [Foundry models](../models/foundry.md) (routing, structured outputs, budgets,
cache, safety signals), [automatic research](../../backend/src/research/README.md) (the crawler, the orchestration and
its limits), [constraints](../analysis/constraints.md), [the Decision Canvas](../analysis/decision-canvas.md), the
[pilot plan](../azure/pilot-plan.md) and [pilot cost](../azure/pilot-cost.md), the
[operations](../operations/observability.md) pages and [reading web pages](../security/url-ingestion.md).

## What the owner has to do

These are the actions that only the owner can take; nothing in this repository takes them.

1. **Provide Azure authorization** for the pilot: an authenticated `az` session on a machine that runs the pre-flight,
   or a service principal or managed identity with the roles in
   [What the owner must do](./azure-preflight.md#what-the-owner-must-do). Until then nothing can be provisioned.
2. **Read the credit and the spending limit** in the portal, and review the [cost plan](./azure-preflight.md) and the
   budget strategy. Check that the terms of the dev/test credit allow a pilot with real users, or redeploy into a paid
   subscription with the production-shaped profile.
3. **Provide an Entra app registration**, or authorise creating one; the redirect address comes from the deployed host.
4. **Decide whether a search provider will be configured.** None is, and the setting accepts only `none`, so a question
   alone ends **blocked** and waits for a source.
5. **Deploy it, run the smoke test, then run the rollback drill and the database restore drill** and keep the records.
   Expect to fix something Azure objects to.
6. **Decide on outbound control for the crawler, private networking and the public endpoints**, and verify the choice in
   Azure.
7. **Arrange an independent security review and a legal review** of crawling and data handling before any real data.

## Where the evidence stands

| Claim                                              | Evidence, and its limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The templates are well-formed                      | `npm run iac:validate`: Bicep 0.48.1 compiles, lints and evaluates them offline; 34 resources predicted for the pilot profile and 40 for the production-shaped one. Azure has never seen them                                                                                                                                                                                                                                                                                                                                                                                                      |
| The hosted start refuses an unsafe configuration   | `backend/test/deployment.test.ts`, a canary in every setting. Never run in a deployed environment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Telemetry carries no content                       | `backend/test/telemetry-product.test.ts`, `privacy.test.ts`, `logging.test.ts`, with in-memory exporters. Nothing was exported to Application Insights                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The AI-assisted setup keeps to its output policy   | `npm run eval:ai` in rules and fake-Foundry modes. The replies are scripted: it shows what the product does with a reply, never a model's quality. Live: `NOT MEASURED`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Every registered AI threshold is met               | **It is not.** Five are breached and listed in `evaluation/known-breaches.json` with the measured value and the reason. In rules mode: participant coverage (67.1%, threshold 90%), hard-constraint recall (75.5%, threshold 80%) and an instruction in a question that reaches the research plan (5 of 5, threshold 0). In fake-Foundry mode: a corrupted model plan accepted as the plan (4 of 74) and the same instruction reaching the plan (7 of 17) ([evaluation.md](./evaluation.md))                                                                                                       |
| Swarm does not decide about one person's situation | A scope check on the Decision view (`backend/src/decision/scope.ts`; `decision-scope.test.ts`, a table of 135 questions; `e2e/lab/decide-canvas.spec.ts`): a notice for a matter of employment, credit, legal, medical or safety, and a human decision with no option named for one person's. It reads words by rules and is not complete (other phrasings and languages are missed), its cue lists were written against its author's own tables, nothing at the first screen reads it, it refuses nothing, and the full report under the view is unchanged ([LIMITATIONS](./LIMITATIONS.md), A14) |
| The database ceiling                               | Measured on a shared four-CPU VM against a PostgreSQL 16 container on the same machine: about 10 project opens a second at 2 ms, about 2 at 20 ms ([database.md](./database.md#6-the-documented-load-ceiling)). Not Azure                                                                                                                                                                                                                                                                                                                                                                          |
