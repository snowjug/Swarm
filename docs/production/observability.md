# Observability for the controlled pilot: what is wired, what is read, what is missing

> **Status: authored offline; nothing here has run in Azure.** The action group, the 18 alert rules and the budget in
> [`infra/pilot`](../../infra/pilot/modules/alerts.bicep) compile and evaluate offline (`npm run iac:validate`) and **have
> never fired**. The metric names and dimensions of the **platform** (Container Apps, PostgreSQL), the wording of the
> platform log line the readiness rule matches, and the column a counter's total lands in are **UNVERIFIED** until the
> [first-deploy queries](#queries-to-run-once-after-the-first-deploy) have been run. A rule that reads a name nothing
> emits **never alerts and says nothing**: that is the main way this setup can fail silently, which is why the rules that
> depend on it are called out below.

What the application emits, how to switch it on, and what it is built never to say are in
[the operations observability page](../operations/observability.md) and
[the service levels and queries page](../operations/slo-dashboards-alerts.md). This page is the infrastructure side: what
the template wires up, **which signal each alert reads and whether that signal exists today**, and the contract for the
signals that other work has yet to emit.

## What the template wires up

| Piece                                | What it is                                                                                                                                                                                                                                         | Template                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Log Analytics + Application Insights | Created, or reused (`existingWorkspaceResourceId`, `existingAppInsightsResourceId`); workspace-based. 30-day retention by default, 90 in the production-shaped profile                                                                             | `modules/monitoring.bicep`         |
| Telemetry identity                   | The app's managed identity gets **Monitoring Metrics Publisher** on the Application Insights component, so it can export with Entra authentication (`APPLICATIONINSIGHTS_AUTHENTICATION_STRING`); no instrumentation key is used for authorization | `modules/appinsights-access.bicep` |
| Action group                         | `ag-<name>`: e-mail to `alertEmailAddress` (required: a deployment without a person to tell is refused) and `additionalAlertEmailAddresses`                                                                                                        | `modules/alerts.bicep`             |
| Metric alert rules (9)               | On **platform** metrics, so they work even when the application sends nothing                                                                                                                                                                      | `modules/alerts.bicep`             |
| Log alert rules (9)                  | On what the application emits (KQL over Application Insights) and on the Container Apps system log                                                                                                                                                 | `modules/alerts.bicep`             |
| Budget                               | Consumption budget on the resource group: notifications at 50, 80 and 100% of actual and 100% of forecast. **It never stops anything**                                                                                                             | `modules/budget.bicep`             |
| Key Vault audit log                  | When a vault is enabled, `AuditEvent` goes to the workspace                                                                                                                                                                                        | `modules/key-vault.bicep`          |

Not wired: **no dashboard or workbook is created** (the queries in the SLO page are for a person to paste), no paging,
no on-call integration, no synthetic availability test, no log-based alert for jobs that do not start, poison jobs,
lease churn, a refused model budget (`model.budget.exhausted`) or a missing backup. Those are suggested in the SLO page
and are **not** in the template; add them in the portal or to `alerts.bicep` (each log rule costs about US$0.50 a month
at list price, [azure-preflight.md](./azure-preflight.md#unit-prices)).

## Every alert, the signal it reads, and whether that signal exists

"Exists today" means the application emits it in the code on this branch
(`backend/src/telemetry/signals.ts`), tested with in-memory exporters; it does **not** mean it was seen in Application
Insights. Thresholds are template parameters; the defaults are guesses for a pilot and none has been tuned against real
traffic.

### Platform metric rules

| Alert (`<name>-…`)      | Sev | Reads (namespace / metric)                                  | Fires when (window, evaluated)                  | Parameter (default)                                                   | First action                                                           |
| ----------------------- | --- | ----------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app-no-replicas`       | 1   | `Microsoft.App/containerApps` · `Replicas`                  | maximum < 1 (5 min, every 1 min)                | —                                                                     | [first fifteen minutes](./runbook.md#the-first-fifteen-minutes)        |
| `http-5xx`              | 2   | `Requests`, dimension `statusCodeCategory = 5xx`            | total > N (5 min, every 1 min)                  | `http5xxPer5Minutes` (10)                                             | [API errors](../operations/runbook.md#api-errors)                      |
| `request-volume`        | 2   | `Requests`                                                  | total > N (5 min, every 5 min)                  | `requestsPer5Minutes` (3000)                                          | [refused requests](../operations/runbook.md)                           |
| `app-restarts`          | 2   | `RestartCount`                                              | total > N (15 min, every 5 min)                 | `restartsPer15Minutes` (3)                                            | [database](../operations/runbook.md#database-down-or-not-ready)        |
| `db-not-alive`          | 1   | `Microsoft.DBforPostgreSQL/flexibleServers` · `is_db_alive` | minimum < 1 (5 min, every 1 min)                | —                                                                     | [database](../operations/runbook.md#database-down-or-not-ready)        |
| `db-connections`        | 2   | `active_connections`                                        | maximum > limit × percent (15 min, every 5 min) | `databaseMaxConnections` (50) × `databaseConnectionPercent` (80) = 40 | check what else is connected; the app holds one connection per process |
| `db-storage`            | 2   | `storage_percent`                                           | maximum > N % (1 h, every 15 min)               | `databaseStoragePercent` (80)                                         | grow the disk or clean up (auto-grow is on, and costs)                 |
| `db-cpu-credits`        | 3   | `cpu_credits_remaining` (**Burstable SKUs only**)           | minimum < N (1 h, every 15 min)                 | `databaseCpuCreditsRemaining` (30)                                    | the database is about to be throttled: scale up                        |
| `db-failed-connections` | 3   | `connections_failed`                                        | total > N (15 min, every 5 min)                 | `databaseFailedConnectionsPer15Minutes` (10)                          | the identity lost its role or a network rule changed                   |

All platform metric names and the `statusCodeCategory` dimension are **UNVERIFIED** (they follow the documentation as
remembered; compiling cannot check them). `db-cpu-credits` is skipped when the SKU is not Burstable.

### Log rules over what the application emits (evaluated every 15 minutes)

| Alert (`<name>-…`)      | Sev | Reads                                                                                              | Fires when                                                         | Parameter (default)                                                | Signal exists today?                                                                                                                               |
| ----------------------- | --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readiness-failing`     | 1   | `ContainerAppSystemLogs_CL` in the **workspace**, lines with `probe` and `fail`                    | ≥ 5 lines in 15 min                                                | —                                                                  | **Platform log**; the wording is UNVERIFIED and the table exists only after the first line (query validation is skipped)                           |
| `db-reported-down`      | 1   | `customMetrics` `swarm.db.up`                                                                      | minimum < 1 in 15 min                                              | —                                                                  | **Yes**                                                                                                                                            |
| `telemetry-missing`     | 3   | `customMetrics` `swarm.db.up`                                                                      | no sample in 30 min                                                | —                                                                  | **Yes** (and it fires at once if `telemetryRoleName` does not match what the app reports)                                                          |
| `latency-p95`           | 3   | `requests` (the request spans, named `METHOD /route/:id`), `GET`, not health, not export           | p95 duration > N ms with ≥ M requests in 30 min                    | `p95LatencyMs` (1500), `latencyMinimumRequests` (20)               | **Yes, as spans.** The histogram `swarm.http.server.duration` also exists; the rule reads spans because they carry the route and are in `requests` |
| `model-failures`        | 2   | `customMetrics` `swarm.model.calls`, attribute `swarm.model.outcome`                               | failed share > N % with ≥ M calls in 30 min                        | `modelFailurePercent` (20), `modelMinimumCalls` (10)               | **Yes**                                                                                                                                            |
| `model-schema-failures` | 3   | `swarm.model.calls`, `swarm.error.code = MODEL_OUTPUT_INVALID` or `swarm.model.outcome = repaired` | ≥ N invalid answers in 1 h, or repaired share > P % with ≥ M calls | `invalidModelOutputsPerHour` (5), `repairedModelCallsPercent` (30) | **Yes** (a dedicated `swarm.model.schema_failures` is planned: [below](#signals-that-are-to-be-emitted))                                           |
| `token-spend`           | 3   | `customMetrics` `swarm.model.tokens` (both directions)                                             | total > N in 1 h                                                   | `tokensPerHour` (2,000,000)                                        | **Yes**                                                                                                                                            |
| `refused-requests`      | 2   | `swarm.auth.denials`, and `swarm.http.errors` with `swarm.error.code = RATE_LIMITED`               | denials > N or rate-limited > M in 15 min                          | `denialsPer15Minutes` (150), `rateLimitedPer15Minutes` (300)       | **Yes**                                                                                                                                            |
| `crawler-safety-blocks` | 3   | `swarm.research.safety.blocks` by `swarm.safety.reason`                                            | ≥ N safety refusals in 1 h                                         | `crawlerBlocksPerHour` (10)                                        | **No: created DISABLED** until `researchSignalsEmitted` is true                                                                                    |

The first sample of each signal decides whether its rule works. **Which column of `customMetrics` carries a counter's
total** (`value` or `valueSum`) depends on the exporter version: the rules use `valueSum` for counters and `value` for the
gauge, **UNVERIFIED**.

**`telemetryRoleName`** (default `swarm`, the application's `OTEL_SERVICE_NAME`) is what every log rule filters on as
`cloud_RoleName`. If Application Insights reports another role name, every log rule except `telemetry-missing` returns
nothing, silently, and `telemetry-missing` fires at once. That is the cheapest thing to check first.

## Signals that exist today

From `backend/src/telemetry/signals.ts`; attributes pass the allow-list in `telemetry/attributes.ts` (anything else is
dropped, secret-shaped values are replaced). Details and privacy rules: [operations/observability.md](../operations/observability.md#what-is-emitted).

| Metric                                             | Kind                          | Attributes                                                                     | Read by                                                    |
| -------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `swarm.http.server.duration`                       | histogram (ms)                | `swarm.http.route`, `.method`, `.status_class`                                 | (spans are read instead; see `latency-p95`)                |
| `swarm.http.errors`                                | counter                       | route, status class, `swarm.error.code`                                        | `refused-requests`                                         |
| `swarm.auth.denials`                               | counter                       | `swarm.auth.reason`, route                                                     | `refused-requests`                                         |
| `swarm.audit.events`                               | counter                       | `swarm.audit.action`                                                           | — (no rule: `model.budget.exhausted` is a suggestion only) |
| `swarm.jobs.finished` / `.duration` / `.events`    | counter / histogram / counter | kind, outcome, error code, branch / event                                      | — (no rule: jobs not starting, poison, lease churn)        |
| `swarm.jobs.by_state`, `swarm.jobs.oldest_waiting` | gauges                        | state, role                                                                    | —                                                          |
| `swarm.worker.busy`                                | gauge                         | role                                                                           | —                                                          |
| `swarm.db.up`                                      | gauge                         | role                                                                           | `db-reported-down`, `telemetry-missing`                    |
| `swarm.model.calls`                                | counter                       | provider, name, `swarm.model.outcome` (`ok`, `repaired`, `failed`), error code | `model-failures`, `model-schema-failures`                  |
| `swarm.model.latency`                              | histogram (ms)                | provider, outcome                                                              | —                                                          |
| `swarm.model.tokens`                               | counter                       | provider, name, direction                                                      | `token-spend`                                              |
| `swarm.grounding.statements`                       | counter                       | `swarm.grounding.class`                                                        | —                                                          |

## Signals that are to be emitted

**None of these exists in the code this page was written against.** They are what other work is planned to add; this page
records the names those plans use so that the template and the product agree, and says what changes when they land.
Names and attributes are listed as they are emitted by `backend/src/telemetry/product-signals.ts` (catalogue in `docs/production/privacy-telemetry.md`); the model signals are emitted by `backend/src/telemetry/signals.ts`. None has been seen in Application Insights yet.

| Signal (planned)                                                                                                                                                                                             | Owner (planned)             | Why the template cares                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swarm.research.*`: runs by stop reason, pages fetched, crawl duration, **fetch failures by `FETCH_ERROR_CLASSES`**, **safety blocks**, quarantines by `QUARANTINE_REASONS`, sources used, evidence passages | product-signals / hardening | The `crawler-safety-blocks` rule reads `swarm.research.safety.blocks` ([contract](#the-contract-the-crawler-rule-reads))                                                                |
| `swarm.actors.*`, `swarm.constraints.*`, `swarm.sim.*`, `swarm.report.*`                                                                                                                                     | product-signals / hardening | No rule yet: add one when a threshold means something                                                                                                                                   |
| `swarm.deployment.info`                                                                                                                                                                                      | hardening                   | A version gauge: lets a release be seen in Application Insights (and the dashboard show which build runs)                                                                               |
| `swarm.model.task.duration`, `swarm.model.cost.estimated_usd`, `swarm.model.schema_failures`, `swarm.model.fallbacks`, `swarm.model.safety_blocks`, `swarm.model.cache.hits` / `.misses`                     | models                      | `schema_failures` would replace the stand-in that `model-schema-failures` computes from `swarm.model.calls`; `cost.estimated_usd` would give the spend rule a currency, not only tokens |

Attributes on the new signals are to be **enumerations only** (never a URL, the host of a page a person named, text, or a
person's id), and **each new attribute must be added to `ALLOWED_ATTRIBUTES`** in `backend/src/telemetry/attributes.ts`,
or the exporter drops it. For a rule that filters on an attribute this is fatal and silent: the dimension is empty,
the filter matches nothing, the rule never fires.

### The contract the crawler rule reads

| What                        | Value                                                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric                      | `swarm.research.safety.blocks`, a counter incremented once for every request a deterministic rule refused (`backend/src/telemetry/product-signals.ts`)                                                                                                      |
| Attribute                   | `swarm.safety.reason`, one of `SAFETY_BLOCK_REASONS` (a closed list; any other value is recorded as `other`)                                                                                                                                                |
| Counted as a safety refusal | `private-address`, `loopback-address`, `link-local-address`, `metadata-address`, `reserved-address`, `invalid-address`, `internal-name`, `blocked-scheme`, `blocked-port`, `credentials-in-url`, `not-on-allow-list`, `redirect-refused`, `https-downgrade` |
| Not counted                 | `robots-disallowed` (polite, expected) and `prompt-injection` (a content finding, listed under quarantines)                                                                                                                                                 |
| Required of the application | `swarm.safety.reason` in `ALLOWED_ATTRIBUTES` (it is); no URL, host or text on the metric                                                                                                                                                                   |

The application emits this signal today (verified against a spy in `backend/test/research-service-hostile.test.ts`, not against
Application Insights). Whether `customMetrics` carries the counter total in `valueSum` or `value` is **unverified** until the first
deploy. To turn the rule on: deploy, run the [verification query](#queries-to-run-once-after-the-first-deploy) 5, see the reasons you
expect, then set `SWARM_RESEARCH_SIGNALS_EMITTED=true` and deploy again. If the column is `value`, change the query in `alerts.bicep`
(the `crawlerBlocks` rule) first.

## Queries to run once after the first deploy

None of this has been run. Run it in the Log Analytics / Application Insights **Logs** blade after the app has had a few
minutes of traffic (open `/api/health/ready`, sign in once, run a small project), and **write down what differs from
this page**.

1. **Which signals arrive, and under which role name?** (decides every log rule)

   ```kusto
   customMetrics
   | where timestamp > ago(1h)
   | summarize samples = count(), last = max(timestamp) by name, cloud_RoleName
   | order by name asc
   ```

   Expect every name in [Signals that exist today](#signals-that-exist-today) that has been exercised, with
   `cloud_RoleName == "swarm"`.

2. **Dimensions and the total column.**

   ```kusto
   customMetrics
   | where timestamp > ago(1h) and name in ("swarm.model.calls", "swarm.model.tokens", "swarm.http.errors")
   | take 20
   | project name, value, valueSum, valueCount, customDimensions
   ```

   Check that `customDimensions["swarm.model.outcome"]` and `["swarm.error.code"]` exist, and which of `value` / `valueSum`
   holds the count. Fix the rules' column if it is the other one.

3. **Request names, for the latency rule.**

   ```kusto
   requests | where timestamp > ago(1h)
   | summarize n = count(), p95 = percentile(duration, 95) by name, cloud_RoleName | top 20 by n
   ```

4. **The probe-failure wording and the table's columns.** Stop the app's database access or deploy a bad revision once
   on purpose, then:

   ```kusto
   ContainerAppSystemLogs_CL | where TimeGenerated > ago(1d) | where Log_s has "probe" | take 20
   ```

   Confirm `ContainerAppName_s` and `Log_s` exist and that failing probes contain both words the rule matches.

5. **The crawler signal** (after a build that emits it):

   ```kusto
   customMetrics | where name == "swarm.research.safety.blocks" and timestamp > ago(1d)
   | summarize n = sum(valueSum) by reason = tostring(customDimensions["swarm.safety.reason"])
   ```

6. **Platform metrics exist under the names the rules use.**

   ```bash
   az monitor metrics list-definitions --resource <container app resource id> --query "[].name.value" -o tsv
   az monitor metrics list-definitions --resource <postgres server resource id> --query "[].name.value" -o tsv
   ```

   Expect `Replicas`, `RestartCount`, `Requests` (with `statusCodeCategory`) and `is_db_alive`, `active_connections`,
   `storage_percent`, `cpu_credits_remaining`, `connections_failed`. A name that is missing means that rule can never fire.

7. **Prove each rule can reach a person.** In the portal, **Action groups → `ag-<name>` → Test action group**; then
   confirm the e-mail arrived and was not filtered. **Then deliberately trip one rule** (for example, the readiness rule
   with a bad revision) and time how long from the event to the e-mail: alert rules evaluate every 1 to 15 minutes and
   e-mail takes more, so "time to know" is minutes, not seconds.

## Cost of watching

Log Analytics ingestion above the free 5 GB a month is the largest telemetry cost
([azure-preflight.md](./azure-preflight.md#unit-prices)); each log alert rule at 15-minute evaluation costs about US$0.50
a month; metric alert time series beyond the first ten cost US$0.10 each. The pilot's estimate includes all 18 rules at list
price. Telemetry does **not** include prompts, completions, page text or credentials by design (allow-list and
redaction); that is tested in the application, and the privacy tests planned for the production configuration will pin
it more tightly (see [threat-model.md](./threat-model.md)).
