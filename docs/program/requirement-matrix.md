# Requirement matrix: the enterprise-hardening program

Covers the requirements of this program only: the evidence layer, identity, evaluation, demonstrations
and the documents around them. The earlier, much larger matrix for the original build is
[requirements-matrix.md](../requirements-matrix.md); it is not repeated here.

**Statuses.** VERIFIED needs executable evidence named in the row. PARTIAL says what is missing.
NOT BUILT means it does not exist. BLOCKED needs something outside the repository (a credential, a
tenant administrator, an approval). REVIEW means only a person with standing can pass it, and it is
never marked VERIFIED here.

## Gates on the final tree

| Gate                                               | Result                                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type checks (5 projects), lint (0 warnings), build | pass (`npm run check`)                                                                                                                                          |
| Unit tests                                         | 1,182 in 67 files (baseline 935 in 56)                                                                                                                          |
| End-to-end, Microsoft Edge                         | 92 passed, 0 failed, 0 flaky: 63 local, 29 model-assisted against a fake provider (baseline 78)                                                                 |
| Evaluation                                         | floors hold; see [evaluation results](../pitch/evaluation-results.md)                                                                                           |
| Live model scenario (`npm run azure:verify`)       | VERIFIED, 15 of 15 checks, in each of three runs (baseline, after the chat change, final tree); see [evaluation results](../pitch/evaluation-results.md)        |
| Format                                             | clean (`npm run format:check`)                                                                                                                                  |
| Secret scan                                        | 0 findings in 698 history blobs and 383 working-tree files; no `.env` tracked (`npm run scan:secrets`)                                                          |
| Dependency audit                                   | 0 vulnerabilities (`npm audit`, through the corporate package mirror)                                                                                           |
| UI audit (`npm run audit:ui`)                      | 44 states at four viewports: 0 console errors, 0 axe violations, no layout finding; a visible focus indicator on every Tab stop                                 |
| Load test (`node scripts/load-test.mjs`)           | 12 of 12 workflows completed, 0 server errors; rules engine, one machine, no ledger or sign-in routes; see [evaluation results](../pitch/evaluation-results.md) |

## 1. Evidence integrity

| ID   | Requirement                                                              | Status   | Evidence                                                                                                                              | What remains                                                                                                                |
| ---- | ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Ten statement types, carried with every statement                        | VERIFIED | `shared/evidence.ts`; `ledger.test.ts`, `ledger-service.test.ts`                                                                      | Chat answers are not ledger records; they carry a grounding status instead                                                  |
| 1.2  | Eight support classes, assigned by checks and not by a model's own label | VERIFIED | `grounding-verify.test.ts`, `ledger.test.ts`                                                                                          | The checks are heuristics: the deterministic check accepted 3 of 8 unsupported statements in the labelled set               |
| 1.3  | A deterministic publication policy                                       | VERIFIED | `ledger.test.ts`; "cannot upgrade an unsupported one by accepting it" in `ledger-service.test.ts`                                     | The policy itself has had no domain or Responsible-AI review (REVIEW)                                                       |
| 1.4  | Evidence pointers: passage, offsets, hash, verbatim quote                | VERIFIED | `ledger.test.ts`, `grounding-quotes.test.ts`; shown in the inspector (`e2e/model/ledger-ui.spec.ts`)                                  | Nothing re-verifies a hash on read; the API has no way to edit documents                                                    |
| 1.5  | Conflicts between sources, as candidates for a person to decide          | PARTIAL  | `contradictions.test.ts`, `ledger-service.test.ts`, `e2e/local/ledger.spec.ts`; evaluation: 1 of 3 labelled conflicts, precision 100% | Conflicts of meaning and anaphoric ones are missed; two false alarms on surveys of different groups; no model-assisted pass |
| 1.6  | Review of statements and conflicts, versioned, audited, race-safe        | VERIFIED | `ledger-service.test.ts` (versioning, stale writes refused, audit without the note), `auth.test.ts` (who is recorded)                 | No assignment, queue or service-level workflow                                                                              |
| 1.7  | A rule for whether the evidence is sufficient                            | VERIFIED | `ledger-service.test.ts` ("serves the ledger, with conflicts between sources and the sufficiency of the evidence")                    | The thresholds are judgement, not measurement                                                                               |
| 1.8  | An assumption register                                                   | PARTIAL  | `ledger-service.test.ts`; `e2e/model/ledger-ui.spec.ts` (filter statements by assumption); `e2e/local/ledger.spec.ts`                 | Derived and read-only. Analyst-entered assumptions are **NOT BUILT**                                                        |
| 1.9  | The ledger in Markdown and JSON exports                                  | VERIFIED | `ledger-service.test.ts` (export, including escaping)                                                                                 |                                                                                                                             |
| 1.10 | Statements and conflicts visible in the interface                        | VERIFIED | `frontend/src/test/` unit tests; `e2e/local/ledger.spec.ts`, `e2e/model/ledger-ui.spec.ts` (four viewports, axe, keyboard, focus)     | Rules mode produces no grounding review, so its ledger has conflicts and assumptions but no statements                      |

## 2. Analyst and persona chat

| ID  | Requirement                                                    | Status   | Evidence                                                                                                                                  | What remains                                                                                                                         |
| --- | -------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | The exact abstention sentence when the evidence cannot answer  | VERIFIED | `evidence-gate.test.ts` (mutation-checked), `demos.test.ts`, `e2e/model/ledger-ui.spec.ts`                                                |                                                                                                                                      |
| 2.2 | No model call when it abstains                                 | VERIFIED | `evidence-gate.test.ts` ("spends no model call")                                                                                          |                                                                                                                                      |
| 2.3 | A model answer must cite, or decline; citations are validated  | VERIFIED | `evidence-gate.test.ts` (repair, decline, uncited label); one live run in which the analyst cited exactly the four unsupported statements | One run, one deployment                                                                                                              |
| 2.4 | The gate refuses what it should                                | PARTIAL  | `evaluation.test.ts`: false abstain 0%; recall 43% (dev) and 86% (test); 1 of 4 plausible-absent questions                                | Plausible-absent and mixed questions pass the gate. Only the model's own refusal covers them, and that is measured in live runs only |
| 2.5 | Personas never see the ledger; the gate does not apply to them | VERIFIED | `evidence-gate.test.ts` ("does not show a persona the ledger", "does not apply the gate to a persona")                                    |                                                                                                                                      |

## 3. Evaluation

| ID  | Requirement                                                     | Status    | Evidence                                                                                              | What remains                                                              |
| --- | --------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 3.1 | A baseline measured before any change                           | VERIFIED  | [baseline.md](./baseline.md)                                                                          |                                                                           |
| 3.2 | Labelled datasets, pinned to the sources they were written from | VERIFIED  | `evaluation/test/evaluation.test.ts`                                                                  | Small, one fictional domain, author-labelled                              |
| 3.3 | A dev/test split and floors that fail on regression             | VERIFIED  | `evaluation/thresholds.json`, `evaluation.test.ts`                                                    | The test split was seen once, so it is a sanity check, not a blind exam   |
| 3.4 | An honest account of what improved and what did not             | VERIFIED  | [evaluation README](../../evaluation/README.md), [evaluation results](../pitch/evaluation-results.md) | One floor was lowered to correct a measurement (see the end of this page) |
| 3.5 | A model-in-the-loop regression suite                            | NOT BUILT | Live runs only (`npm run azure:verify`)                                                               | A scheduled, cost-capped suite                                            |
| 3.6 | Evaluation on real documents                                    | BLOCKED   |                                                                                                       | Needs approved documents under a data agreement                           |

## 4. Identity, roles and tenancy

| ID  | Requirement                                     | Status    | Evidence                                                                           | What remains                                                         |
| --- | ----------------------------------------------- | --------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 4.1 | Verify Microsoft Entra bearer tokens in the API | VERIFIED* | `auth.test.ts` (49 tests; sixteen kinds of bad token; four mutations caught)       | *Against a local test provider only                                  |
| 4.2 | Against a real Entra tenant                     | BLOCKED   |                                                                                    | An app registration and app roles, created by a tenant administrator |
| 4.3 | Four roles, enforced                            | VERIFIED  | `auth.test.ts` (reader, analyst, reviewer, admin cases)                            | Coarse: one owner per project; no sharing                            |
| 4.4 | Default-deny authorisation                      | VERIFIED  | `auth.test.ts` (a test lists every registered route; an unlisted route is refused) |                                                                      |
| 4.5 | Tenant isolation                                | VERIFIED* | `auth.test.ts` (lists, counts, by-id as 404, audit trail, branches)                | *Application level only; no row-level security                       |
| 4.6 | Browser sign-in                                 | NOT BUILT |                                                                                    | MSAL in the single-page app                                          |
| 4.7 | Keyless model access                            | VERIFIED  | Live runs with an Entra token of the signed-in developer (`npm run azure:verify`)  | A managed identity has not been exercised, because nothing is hosted |
| 4.8 | A secrets store                                 | NOT BUILT | Nothing to hold: no key is stored                                                  | Add one the day a secret appears                                     |

## 5. Persistence, jobs and audit

| ID  | Requirement                                                                | Status    | Evidence                                                                                                 | What remains                                                                           |
| --- | -------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 5.1 | Versioned migrations, a backup before an upgrade, a newer database refused | VERIFIED  | `storage.test.ts`, `auth.test.ts` (upgrading a database that has no owners)                              |                                                                                        |
| 5.2 | An append-only, hash-chained audit log                                     | VERIFIED  | `storage.test.ts` (chain, refused update and delete, a tampered entry located)                           | The head is not anchored outside the database; principal ids outlive a deleted project |
| 5.3 | PostgreSQL                                                                 | NOT BUILT | [ADR 0006](../adr/0006-postgres-adapter-proposed.md) (proposed)                                          | An asynchronous repository first, then the adapter                                     |
| 5.4 | Pause, resume, intervene, branch from a checkpoint, compare                | VERIFIED  | `whatif.test.ts`, `whatif-model.test.ts`, `e2e/local/whatif.spec.ts`, `e2e/model/model.spec.ts`          | Built before this program, unchanged                                                   |
| 5.5 | A run survives a restart on its own                                        | NOT BUILT | A crashed run can be resumed by hand from its last saved round (`whatif.test.ts`)                        | Automatic resume                                                                       |
| 5.6 | Deletion and retention                                                     | PARTIAL   | `storage.test.ts` (a deleted project's content and ledger go; its audit entries stay, as ids and counts) | A retention rule for audit entries: a privacy decision (REVIEW)                        |

## 6. Cost, observability and operations

| ID  | Requirement                            | Status    | Evidence                                                                                                       | What remains                                                              |
| --- | -------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 6.1 | Token and call accounting per project  | VERIFIED  | `e2e/model/model.spec.ts` (honest token accounting); `azure:verify` records calls and tokens                   |                                                                           |
| 6.2 | Budgets and limits                     | PARTIAL   | Call budget per operation, a 15-minute run budget, a rate limiter, a per-tenant project limit (`auth.test.ts`) | No per-tenant token budget, no alert                                      |
| 6.3 | Logs without secrets or content        | VERIFIED  | `security.test.ts`, `auth.test.ts` (no token in logs, even a refused one)                                      |                                                                           |
| 6.4 | OpenTelemetry and Application Insights | NOT BUILT |                                                                                                                | Traces, metrics and a destination                                         |
| 6.5 | Load behaviour                         | PARTIAL   | `node scripts/load-test.mjs`, results in [evaluation results](../pitch/evaluation-results.md)                  | Rules engine only, one machine; it predates the ledger and sign-in routes |

## 7. Azure

| ID  | Requirement                                    | Status      | Evidence                                                                             | What remains                                            |
| --- | ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 7.1 | A live model scenario, keyless                 | VERIFIED    | `npm run azure:verify` (15 checks)                                                   | One run per milestone; not a distribution               |
| 7.2 | Infrastructure as code for the model resources | VERIFIED    | `infra/`; `scripts/azure/lib/*.test.ts`; deployed once to a development subscription | Unchanged by this program                               |
| 7.3 | Infrastructure as code for hosting             | NOT STARTED | [Architecture](../pitch/architecture.md) (proposed)                                  | Depends on 5.3; needs approval for chargeable resources |
| 7.4 | A persistent Azure development machine         | BLOCKED     | Prepared on a local branch, not pushed                                               | Approval for chargeable resources                       |

## 8. Experience

| ID  | Requirement                                | Status    | Evidence                                                                              | What remains                                              |
| --- | ------------------------------------------ | --------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 8.1 | Responsive at four viewports, no overflow  | VERIFIED  | `e2e/local/responsive.spec.ts`, `e2e/model/ledger-ui.spec.ts`                         |                                                           |
| 8.2 | Automated accessibility checks             | VERIFIED  | `e2e/local/a11y.spec.ts`, `e2e/model/ledger-ui.spec.ts` (axe, keyboard, focus return) | Assistive-technology testing and a formal review (REVIEW) |
| 8.3 | No markup injection through server text    | VERIFIED  | `frontend/src/test/markup-sinks.test.ts` (mutation-checked)                           |                                                           |
| 8.4 | Dark, light and high-contrast themes       | NOT BUILT | Light only                                                                            |                                                           |
| 8.5 | A Fluent UI component library; Storybook   | NOT BUILT | Custom CSS                                                                            |                                                           |
| 8.6 | A report studio                            | NOT BUILT |                                                                                       | Compose and publish a report from reviewed statements     |
| 8.7 | Quantitative analysis of simulation output | NOT BUILT |                                                                                       | Sensitivity and intervals, stated with care               |

## 9. Demonstrations and documents

| ID  | Requirement                                                                       | Status   | Evidence                                                                                                     | What remains                                                              |
| --- | --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 9.1 | Six synthetic demonstrations, one with thin evidence and abstention               | VERIFIED | `demos.test.ts` (20 tests), [demonstration packs](../demo/README.md)                                         | Checked in rules mode; only the Larkholm pack has a live model run        |
| 9.2 | Architecture decision records                                                     | VERIFIED | [ADRs](../adr/README.md): five accepted, one proposed                                                        |                                                                           |
| 9.3 | Threat model addendum, risk register, production-readiness gates                  | VERIFIED | [threat model](../threat-model.md), [risk register](./risk-register.md), [gates](../production-readiness.md) | Written by the author; independent review is REVIEW                       |
| 9.4 | Cost model                                                                        | PARTIAL  | [cost model](../pitch/cost-model.md)                                                                         | Estimates from public list prices, not a quote                            |
| 9.5 | A pitch package                                                                   | PARTIAL  | [pitch package](../pitch/README.md): sixteen documents                                                       | The brief named 23 items and the list was unavailable; see its scope note |
| 9.6 | Independent reviews (security, privacy, Responsible AI, licensing, accessibility) | REVIEW   | [checklist](../pitch/human-review-checklist.md): every row NOT SIGNED OFF                                    | A person for each                                                         |

## Changes to a threshold or a test, and why

Nothing was skipped or deleted to make a gate pass. Two changes deserve a reader's attention:

1. **The development-split abstention floor was lowered from 0.55 to 0.40.** The harness had shown the
   gate the sources only; the product also shows it the report, graph and activity of the run. Measured
   as the product runs it, recall on that split is 43%, not 57%. The test that said every off-topic
   question is refused now names the one that is not ("What will the weather be like next Tuesday?")
   and fails if another joins the list or that one leaves it. See
   [ADR 0004](../adr/0004-evaluation-approach.md).
2. **The minimum retrieval score for the gate was lowered from 0.12 to 0.10**, chosen on the
   development split to leave a margin (the lowest answerable score there is 0.13). The reason is in
   a comment beside the constant.
