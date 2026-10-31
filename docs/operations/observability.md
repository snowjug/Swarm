# Observability

What Swarm tells its operators, how to switch it on, and what it is built never to say. Everything
here is OpenTelemetry-compatible: the application uses the OpenTelemetry API, so any exporter works,
and the one that ships sends to Azure Application Insights.

**Status: built and tested with in-memory exporters (`backend/test/telemetry.test.ts`,
`telemetry-start.test.ts`). It has not exported to a real Application Insights resource, and the
queries and alerts in [slo-dashboards-alerts.md](./slo-dashboards-alerts.md) have not been run
against a real workspace.**

## Switching it on

Nothing is exported unless `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. Without it the
instrumentation does nothing and costs nothing.

| Variable                                | Meaning                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | The Application Insights connection string. Not a secret: the component accepts only Entra-signed telemetry                                    |
| `AZURE_CLIENT_ID`                       | Client id of the user-assigned managed identity that signs the telemetry. Empty: whatever identity the environment offers (`az login` locally) |
| `OTEL_SERVICE_NAME`                     | The service name on every item (default `swarm`)                                                                                               |
| `OTEL_TRACES_SAMPLER_ARG`               | Share of traces kept, 0 to 1 (default 1)                                                                                                       |
| `OTEL_METRIC_EXPORT_INTERVAL`           | Milliseconds between metric exports, at least 1000 (default 60000)                                                                             |
| `SWARM_ROLE`                            | Recorded on every item, so that the API and a worker can be told apart                                                                         |

Telemetry is authenticated with a Microsoft Entra token (the managed identity needs the
**Monitoring Metrics Publisher** role on the Application Insights component, which the pilot template
assigns), not with the instrumentation key, and the component has local authentication disabled. A
connection string that is malformed, or exporters that cannot be started, produce one warning in the
log and the application runs without telemetry: monitoring never stops the application. The warning
never repeats the connection string.

Only what the application itself emits is exported. **There is no automatic instrumentation of HTTP
clients or of the database driver**, because those record URLs and SQL statements.

## What is emitted

**Correlation.** Every answer, a refusal included, carries `x-request-id`. It is the id that is in
the error body (`error.requestId`), in the log line of a failed request, and on the request's span
(`swarm.request.id`), so a caller can quote it and an operator can find the request in any of them.

**Spans.**

| Span                | Attributes                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `METHOD /route/:id` | method, route template, status, request id, error code                                                           |
| `swarm.job`         | job id, kind, attempt, maximum attempts, project id, role, outcome, error code; failed jobs are marked as errors |

**Metrics.**

| Metric                       | Kind           | Attributes                                                        | Use                                                                                                                                                                                         |
| ---------------------------- | -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swarm.http.server.duration` | histogram (ms) | route template, method, status class                              | Request rate, errors and latency                                                                                                                                                            |
| `swarm.http.errors`          | counter        | route, status class, error code                                   | Which errors, from which routes                                                                                                                                                             |
| `swarm.auth.denials`         | counter        | reason (error code), route                                        | Refused callers: no token, no session, forbidden, bad host or origin                                                                                                                        |
| `swarm.audit.events`         | counter        | action                                                            | Exports, runs, branches, reviews, membership changes, `access.refused` (signed-in callers refused), `project.budget.changed`, `model.budget.exhausted` (a project was refused a model call) |
| `swarm.jobs.finished`        | counter        | kind, outcome, error code, branch                                 | Job results, branch completions                                                                                                                                                             |
| `swarm.jobs.duration`        | histogram (ms) | kind, outcome                                                     | How long jobs run                                                                                                                                                                           |
| `swarm.jobs.events`          | counter        | event, kind                                                       | Retries, lease expiries (`reaped-*`), expiry, hand-backs, lost leases                                                                                                                       |
| `swarm.jobs.by_state`        | gauge          | state, role                                                       | Queue depth (`queued` plus `retrying`), running jobs                                                                                                                                        |
| `swarm.jobs.oldest_waiting`  | gauge (s)      | role                                                              | Job age: how long the oldest waiting job has waited                                                                                                                                         |
| `swarm.worker.busy`          | gauge          | role                                                              | 1 while this process runs a job                                                                                                                                                             |
| `swarm.db.up`                | gauge          | role                                                              | 1 when the database answers a trivial query                                                                                                                                                 |
| `swarm.model.calls`          | counter        | provider, model, outcome (`ok`, `repaired`, `failed`), error code | Provider failures and repairs                                                                                                                                                               |
| `swarm.model.latency`        | histogram (ms) | provider, outcome                                                 | Model latency                                                                                                                                                                               |
| `swarm.model.tokens`         | counter        | provider, model, direction                                        | Token usage                                                                                                                                                                                 |
| `swarm.grounding.statements` | counter        | support class                                                     | The mix of support classes; the unsupported share is its ratio                                                                                                                              |

**Not instrumented, and why.** A per-run model-call budget gauge (the budget is enforced in the model
client and reported in the project's own execution record, not as a metric); a metric for exports
beyond the audit entry that every export writes; per-tenant breakdowns (a tenant id identifies a
customer and is deliberately not an attribute).

Counters of audit entries and of statements are incremented when the entry is written. On PostgreSQL a
transaction that loses a race is run again, so a counter can count an entry twice in that rare case.

## What is never emitted

Telemetry passes through one gate, `backend/src/telemetry/attributes.ts`:

- **Names.** Only the attribute names on a list are kept. A prompt, a document, a header, a cookie, a
  query string, a name or an e-mail address has no name on the list, so it cannot be attached to a
  span or a metric by accident. The list is tested to hold no name that suggests content.
- **Values.** Scalars only; an object or an array is dropped. Strings are redacted for what looks like a
  JWT, a bearer or basic credential, a URL with a password, a connection string, a `password=`,
  `token=` or `key=` pair, an API key, an e-mail address or a long run of key-like characters, and cut
  to 120 characters. Identifiers (UUIDs) and error codes pass.
- **Spans never record an exception**, because its message can hold content: only the error code is set.
- The route is the **template** (`/api/projects/:id`), never the URL.

`backend/test/telemetry.test.ts` sends a request carrying a canary bearer token, session cookie, query
token, project name, question and document text, runs a job, and asserts that none of them appears in
any exported span or metric, and that every attribute name is on the list.

Logs are separate: the server's structured logs redact `authorization`, `cookie` and `set-cookie`,
record the route without its query string, and never log request or model content.

## Health endpoints

| Endpoint                | Meaning                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/health/live`  | Liveness: 200 unless the database connection was lost for good, which a restart cures                             |
| `GET /api/health/ready` | Readiness: 200 when the database answers, 503 with the failed check otherwise                                     |
| `GET /api/health`       | A summary; with no sign-in configured (a local run) it also reports the queue's counts and the oldest waiting job |

The probes answer for any `Host` header and need no sign-in; they say a status word and nothing else.

## Tests

`npm test` covers the gate, the correlation id, the counts by route and status class, the denial
counts, the job span and metrics, the gauges (and that they stop when an application closes), the model
and grounding counters, the audit counter, the redaction of credentials and content, and starting and
stopping the Azure Monitor export with stand-in exporters. Mutations of the gate are in
`npm run mutation:security -- --area=telemetry`.
