# Swarm production-v1: implementation plan

Branch `feat/swarm-production-v1`, created from the verified premium baseline `feat/swarm-premium-product` at
`81a5fa80cac803db1f35d3002a3fada20d7fc91e` (rollback baseline; never rewritten, never force-pushed). Nothing in this wave pushes to `main`.

Baseline measured before any change: typecheck clean (42 s); unit suite 230 files / 5,065 tests passing (157 s on the 4-vCPU dev VM);
secret scan 0 findings over 3,894 blobs; `npm audit --audit-level=high` clean (3 pre-existing moderate advisories in `@fastify/static`'s `glob`/`minimatch`).

## Product statement

Swarm is a strategic scenario laboratory, not a prediction engine. The wave adds the _setup intelligence_ and the _production shape_ around the verified core:

```
UNDERSTAND → RESEARCH → GROUND → IDENTIFY DECISION PARTICIPANTS → BUILD ACTORS → IDENTIFY CONSTRAINTS
          → (human review) → SIMULATE → COMPARE FUTURES → CRITIQUE → RECOMMEND → WHAT TO VALIDATE NEXT
```

Everything AI proposes is reviewable; everything consequential is human-approved; every machine-consumed model output passes a strict schema and the
server's own checks, with one correction round and then a deterministic rules answer (`backend/src/models/task.ts`).

## Environment constraints that shape the plan

| Constraint                                                                                                                                                                             | Consequence                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No Azure authorization on the dev VM** (no `az`, no credentials, no managed identity on `swarm-dev`; the credential chain `EnvironmentCredential → ManagedIdentityCredential` fails) | Stop condition 1 of the mission applies: nothing is provisioned or deployed. IaC is authored and compiled offline; live Foundry, deployment, production-URL journey, telemetry-in-App-Insights and the rollback drill are **not run** and are reported as such. |
| 4 vCPU / 16 GB shared VM                                                                                                                                                               | Heavy gates (full unit, Playwright, mutation, PostgreSQL, container build) run serially at integration time; builders run focused checks only.                                                                                                                  |
| Visual Studio Enterprise credit subscription                                                                                                                                           | Treated as dev/test/pilot only; label **PRODUCTION-CANDIDATE CONTROLLED PILOT**; everything parameterised for a paid production subscription.                                                                                                                   |
| No search provider is switched on                                                                                                                                                      | Discovery mode (question only) ends blocked unless an owner opts in to `wikipedia` or `brave`; it preserves URL/domain research and manual sources.                                                                                                             |

## Workstreams, ownership and order

| #   | Workstream               | Owns                                                                                                               | Depends on |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | `crawler`                | `backend/src/research/{crawler,extract}/**`                                                                        | contracts  |
| 2   | `models`                 | `backend/src/models/**` (Foundry provider, router, structured outputs, cache, cost, safety, metrics, fake Foundry) | contracts  |
| 3   | `landing`                | `frontend/src/scenes/ask/**`                                                                                       | contracts  |
| 4   | `actors`                 | `shared/stakeholders.ts`, `backend/src/stakeholders/**`, Map review UI                                             | contracts  |
| 5   | `constraints`            | `shared/constraints.ts`, `backend/src/constraints/**`, simulation hooks, constraints UI                            | contracts  |
| 6   | `infra`                  | `infra/**`, `scripts/azure/**`, `scripts/iac/**`, CI, `docs/production/**`                                         | none       |
| 7   | `research orchestration` | `backend/src/research/{plan,service,store}`, routes, project creation without documents, Ground research UI        | 1, 2       |
| 8   | `hardening`              | deployment-mode config guards, product telemetry, cost caps, redaction                                             | 1–6 merged |
| 9   | `decision canvas`        | `shared/decision.ts`, answer-first Decide first viewport, decision status, validation plan, export                 | 4, 5       |
| 10  | `evaluation`             | `evaluation/**` datasets, metrics, thresholds, fake-Foundry mode                                                   | 7, 9       |
| 11  | `journey`                | local critical-journey and failure-case E2E                                                                        | 7–9        |
| 12  | independent review       | code + security review of the integrated diff                                                                      | all        |

Parallel builders work in separate git worktrees on `wt/*` branches. Integration merges one branch at a time, with typecheck and focused tests after each,
and a push after each stable milestone (checkpoint policy: diff inspected, focused tests, static checks, secret scan, no env/db/cache/screenshot files staged,
commit, push, verify local HEAD equals remote HEAD).

## Design decisions

- **Artifacts, not tables.** Research runs and constraints (with their counterfactual views) are artifacts of their project (`shared/artifacts.ts`), so they are stored, revisioned
  (`expectedRevision`), tenant-isolated and deleted with the project, on both storage engines, with no schema migration. The artifact store's 2 MB bound is respected by bounded
  schemas (≤80 sources, ≤80 events, ≤600 passage locations). The plan also listed the decision canvas here; **as built it is not stored**: it is derived at every read
  ([ADR 0023](../adr/0023-the-decision-canvas-is-derived.md)).
- **Research feeds the existing evidence path.** Accepted pages become project documents (≤10, ≤40,000 chars each — existing limits) with `SourceProvenance`; the existing chunker produces
  the passages Ground already consumes; the run artifact adds what a chunk does not keep (heading path, kind, source record, robots decision, quarantine, warnings). Pages that were read
  but not selected are listed with the reason; nothing is hidden.
- **Deterministic fetching, advisory AI.** A plan names _things to find_, never an address to fetch. A model may rank and suggest; every fetch is gated by deterministic code (SSRF, DNS pinning,
  robots, budgets). A suggested site is shown to the person, who adds it.
- **Web content is untrusted data.** Pages are delimited and labelled; injection-heavy pages are quarantined; a flagged page is never obeyed; the model has no tools and no secrets.
- **Constraints are encoded or labelled interpretive.** With no constraints the engine's output is bit-identical to the verified baseline (golden test).
- **Rules mode stays complete.** Every AI step has a deterministic path satisfying the same schema.
- **Cost is bounded by construction.** Per-run research budget, per-operation and per-project model budgets, per-tenant cache (off by default), no autonomous loops.

## AI evaluation: acceptance thresholds (fixed before any result exists)

Measured on the labelled scenario set in `evaluation/` (flagship, custom domain-neutral, missing-information, contradictory sources, poor-quality sites, prompt-injected sites,
irrelevant sources, unreachable URLs, duplicates, no-source, rules-only, and — when authorised — real Foundry). A threshold that is not measured in a mode is reported as _not measured_, never as passed.

| Metric                                                                                | Threshold                         |
| ------------------------------------------------------------------------------------- | --------------------------------- |
| Schema-valid reply rate (live model, after one correction)                            | ≥ 99 %                            |
| Rules fallback schema-valid rate                                                      | 100 %                             |
| Grounded claim rate (evidence reference resolves and the quote exists in the passage) | ≥ 95 %                            |
| Unsupported claim rate                                                                | ≤ 2 %                             |
| Citation correctness (ids resolve)                                                    | 100 %                             |
| Actor coverage of the labelled participant roles                                      | ≥ 90 %                            |
| Actor redundancy after deduplication                                                  | ≤ 10 %                            |
| Generic actor names accepted                                                          | 0                                 |
| Hard-constraint detection recall                                                      | ≥ 80 %                            |
| `extracted` constraints whose quote is not in the source                              | 0                                 |
| Missing-constraint detection (seeded gaps)                                            | ≥ 70 %                            |
| Source diversity (distinct registrable domains when discovery is available)           | ≥ 3; no domain > 60 % of passages |
| Critic catch rate on seeded flaws                                                     | ≥ 80 %                            |
| Seeded prompt injections obeyed or echoed                                             | 0                                 |
| Seeded unsafe requests passed                                                         | 0; benign requests refused ≤ 2 %  |
| Estimated cost per full flagship run                                                  | ≤ configured per-project cap      |

## Gates before the verdict

typecheck · lint (`--max-warnings 0`) · prettier · build · unit suite (SQLite) · PostgreSQL suite · Playwright (all projects) · mutation suite · UI audit · accessibility · responsive ·
forced colors · reduced motion · print/export · secret scan · dependency scan · container build and health smoke · IaC validation · crawler safety suite · AI evaluation (rules, fake Foundry).
Not runnable here, reported as not run: live Foundry evaluation, deployed-URL journey, rollback drill, live telemetry/alerts.

## Owner actions that unblock the remaining work

1. Provide Azure authorization for the pilot: an authenticated `az` session on a machine that runs the pre-flight, or a service principal / managed identity with
   `Reader` on the subscription plus `Contributor` and `User Access Administrator` (or `Owner`) on the pilot resource group, and `Cognitive Services OpenAI User`/`Contributor` as needed.
2. Review `docs/production/azure-preflight.md` (cost plan) and approve the pilot budget strategy.
3. Provide an Entra app registration (or authorise creating one) for sign-in; redirect URIs come from the generated endpoint.
4. Decide whether a search provider will be switched on for discovery mode (`researchSearchProvider`: `none`, `wikipedia` or `brave`).
