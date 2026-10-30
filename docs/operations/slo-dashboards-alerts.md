# Service levels, dashboards and alerts

Indicators, objectives, a dashboard and alert rules for the hosted pilot. **They are proposals for a
pilot with a handful of users, written against the documented Application Insights schema. None has
been run against a real workspace, because no workspace exists: the queries need checking, and the
thresholds tuning, on the first real traffic.**

Metric and span names are in [observability.md](./observability.md). Responses to each alert are in
the [runbook](./runbook.md).

## Indicators and objectives

| #   | Indicator (SLI)                                                                                              | Source                                             | Objective (SLO), 30 days                         |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------ |
| 1   | **Availability**: API requests answered without a server error ÷ all API requests                            | `requests` (a span with status 5xx is a failure)   | 99.0% (an error budget of about 7 hours)         |
| 2   | **Readiness**: probes answered ready ÷ probes sent                                                           | Container Apps probe results; `swarm.db.up`        | 99.0%                                            |
| 3   | **Latency**: share of non-export `GET` requests answered in under one second                                 | `requests` duration                                | 95% under 1 s                                    |
| 4   | **Job start**: windows of five minutes in which the oldest waiting job waited under two minutes              | `swarm.jobs.oldest_waiting`                        | 99% of windows                                   |
| 5   | **Job success**: `completed` ÷ (`completed` + `failed` + `partial`), excluding cancelled, paused and expired | `swarm.jobs.finished`                              | 90% (provider failures are expected and counted) |
| 6   | **Model calls**: failed calls ÷ all calls                                                                    | `swarm.model.calls`                                | under 5% in any hour                             |
| 7   | **Recoverability**: a database backup exists for each day, and a restore rehearsal takes under an hour       | Azure PostgreSQL backup metrics; the rehearsal log | every day; once a quarter                        |

Objectives 1 to 6 are measured; 7 is a process. A budget is spent by incidents and by planned work
that makes the service unavailable. There are no commercial commitments in this document.

## Dashboard

One workbook, four rows. Each tile names its source.

| Row     | Tiles                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traffic | Requests per minute by status class; error rate; latency (median and 95th percentile) by route template                                                             |
| Jobs    | Jobs by state (`swarm.jobs.by_state`); oldest waiting job; jobs finished by kind and outcome; lease expiries, retries and poison (`swarm.jobs.events`); worker busy |
| Model   | Calls by outcome and error code; latency; tokens by direction (the spend indicator)                                                                                 |
| Safety  | Denials by reason; `access.refused` entries; unsupported share of grounded statements; exports per hour                                                             |

## Queries

Written for the `requests`, `dependencies` and `customMetrics` tables. In `customMetrics`, an attribute
is a key of `customDimensions`, and an aggregated metric carries `valueSum` and `valueCount`.

```kusto
// 1. Availability, by day
requests
| where timestamp > ago(30d) and url startswith "http" and name !startswith "GET /api/health"
| summarize total = count(), failed = countif(success == false) by bin(timestamp, 1d)
| extend availability = 1.0 - todouble(failed) / total

// 3. Latency by route template
requests
| where timestamp > ago(24h) and name startswith "GET " and name !has "export"
| summarize p50 = percentile(duration, 50), p95 = percentile(duration, 95), n = count() by name

// 4. Oldest waiting job
customMetrics
| where timestamp > ago(24h) and name == "swarm.jobs.oldest_waiting"
| summarize oldest_seconds = max(value) by bin(timestamp, 5m)

// 5. Job outcomes by kind
customMetrics
| where timestamp > ago(7d) and name == "swarm.jobs.finished"
| extend kind = tostring(customDimensions["swarm.job.kind"]), outcome = tostring(customDimensions["swarm.job.outcome"])
| summarize jobs = sum(valueSum) by kind, outcome

// 6. Model failure rate by hour
customMetrics
| where timestamp > ago(24h) and name == "swarm.model.calls"
| extend outcome = tostring(customDimensions["swarm.model.outcome"])
| summarize calls = sum(valueSum), failed = sumif(valueSum, outcome == "failed") by bin(timestamp, 1h)
| extend failure_rate = failed / calls

// Denials by reason
customMetrics
| where timestamp > ago(24h) and name == "swarm.auth.denials"
| summarize denials = sum(valueSum) by reason = tostring(customDimensions["swarm.auth.reason"]), bin(timestamp, 15m)

// Tokens per day (spend)
customMetrics
| where timestamp > ago(30d) and name == "swarm.model.tokens"
| summarize tokens = sum(valueSum) by bin(timestamp, 1d), direction = tostring(customDimensions["swarm.model.direction"])

// A request by its correlation id (the x-request-id a caller quotes)
requests
| where customDimensions["swarm.request.id"] == "<id>"
```

## Alert rules

| Alert                  | Condition (window)                                                                     | Severity | First action                                                          |
| ---------------------- | -------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| API failing            | More than 5% of requests are server errors, over 10 minutes, with at least 20 requests | Sev 2    | [Runbook: API errors](./runbook.md#api-errors)                        |
| Not ready              | The readiness probe has failed for 5 minutes, or `swarm.db.up` is 0                    | Sev 1    | [Runbook: database](./runbook.md#database-down-or-not-ready)          |
| Jobs not starting      | `swarm.jobs.oldest_waiting` above 300 seconds, over 10 minutes                         | Sev 2    | [Runbook: stuck jobs](./runbook.md#jobs-are-stuck-or-slow)            |
| Poison job             | Any `swarm.jobs.events` with event `reaped-failed`                                     | Sev 3    | [Runbook: poison](./runbook.md#a-job-is-set-aside-as-poison)          |
| Lease churn            | More than 5 `reaped-retrying` events in an hour                                        | Sev 3    | [Runbook: stuck jobs](./runbook.md#jobs-are-stuck-or-slow)            |
| Model provider failing | Failed model calls above 20% over 15 minutes, with at least 10 calls                   | Sev 2    | [Runbook: model provider](./runbook.md#the-model-provider-is-failing) |
| Denial spike           | More than 50 denials in 5 minutes                                                      | Sev 2    | [Runbook: suspected abuse](./runbook.md#a-spike-of-refused-requests)  |
| Spend                  | Tokens in a day above twice the previous seven days' mean                              | Sev 3    | [Runbook: spend](./runbook.md#spend-is-higher-than-expected)          |
| Telemetry missing      | No `swarm.db.up` sample for 15 minutes while the app is running                        | Sev 3    | [Runbook: no telemetry](./runbook.md#telemetry-is-missing)            |
| Backup missing         | No successful PostgreSQL backup in 26 hours (a platform metric)                        | Sev 2    | [Runbook: restore](./runbook.md#restore-the-database)                 |

Severity is a suggestion: Sev 1 wakes someone, Sev 2 is handled the same working day, Sev 3 is read the
next day. The alert rules, action group and the people on it are not created by this repository.
