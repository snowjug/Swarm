# Privacy and product telemetry

What Swarm tells its operators about how its work goes, what it is built never to say, and the tests
that hold it to that. It extends [the observability guide](../operations/observability.md), which
describes the request, job, database and model signals that already existed; this page adds the
product signals and the rules for logs, answers and the audit log.

**Status: built and tested with in-memory exporters and a scripted session of real requests
(`backend/test/telemetry-product.test.ts`, `privacy.test.ts`, `logging.test.ts`). Nothing here has
been exported to a real Application Insights resource, and no dashboard or alert has been run
against these signals.** The signals are recorders that other parts of the product call; at the time
of writing the recorders exist and are tested, and the research, actor, constraint and report code
that will call them is being written by other changes. A metric that nobody calls yet stays empty.

## Principles

1. **Counts, durations and enumerations. Nothing about what the work was about.** A signal never
   carries a question, a passage, an address, a host name of a page a person named, a title, a name
   or an identifier of a person.
2. **An enumeration that is not one of the known values is recorded as `other`.** A caller that passes
   free text by mistake produces a count under `other`, not a leak.
3. **Names are an allow-list.** `backend/src/telemetry/attributes.ts` keeps only the attribute names on
   its list, scalars only, strings redacted for what looks like a credential and cut to 120
   characters. A test fails if a name that suggests content is added.
4. **Telemetry off means no cost.** With no meter provider registered (no connection string) every
   recorder does nothing.
5. **Estimated model cost is not here.** It belongs to `swarm.model.*`.

## The product signals

Recorders are in `backend/src/telemetry/product-signals.ts`; the header of that file documents each
one. Attribute values are listed here by the enumeration they come from.

| Metric                             | Kind           | Attributes                                                                    | What it counts                                                                                       |
| ---------------------------------- | -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `swarm.research.runs`              | counter        | `swarm.research.outcome`, `swarm.research.mode`, `swarm.research.stop_reason` | Research runs: started, completed, cancelled, failed, blocked; the reason a finished run stopped     |
| `swarm.research.pages`             | counter        | `swarm.research.mode`                                                         | Pages fetched                                                                                        |
| `swarm.research.crawl.duration`    | histogram (ms) | `swarm.research.mode`, `swarm.research.stop_reason`                           | How long a crawl took                                                                                |
| `swarm.research.fetch.failures`    | counter        | `swarm.fetch.error_class`                                                     | Failed fetches, by `FETCH_ERROR_CLASSES`                                                             |
| `swarm.research.safety.blocks`     | counter        | `swarm.safety.reason`                                                         | Requests a deterministic rule refused, by `SAFETY_BLOCK_REASONS`                                     |
| `swarm.research.quarantines`       | counter        | `swarm.quarantine.reason`                                                     | Pages set aside, by `QUARANTINE_REASONS`                                                             |
| `swarm.research.sources.used`      | counter        | `swarm.source.category`                                                       | Sources that became evidence, by `SOURCE_CATEGORIES`                                                 |
| `swarm.research.evidence.passages` | counter        | `swarm.research.mode`                                                         | Passages indexed as evidence                                                                         |
| `swarm.actors.proposals`           | counter        | `swarm.proposal.origin`                                                       | Actor proposals: by the model, by rules, or by rules after the model failed (`fallback`)             |
| `swarm.actors.proposed`            | counter        | `swarm.proposal.origin`                                                       | Actors proposed                                                                                      |
| `swarm.actors.valid`               | counter        | `swarm.proposal.origin`                                                       | Proposed actors that passed validation                                                               |
| `swarm.actors.issues`              | counter        | `swarm.issue.code`                                                            | Validation issues, by code                                                                           |
| `swarm.constraints.proposals`      | counter        | `swarm.proposal.origin`                                                       | Constraint proposals                                                                                 |
| `swarm.constraints.proposed`       | counter        | `swarm.proposal.origin`                                                       | Constraints proposed                                                                                 |
| `swarm.constraints.gate`           | counter        | `swarm.gate.status`                                                           | Where the approval gate stood, by `GATE_STATUSES`                                                    |
| `swarm.sim.duration`               | histogram (ms) | `swarm.sim.outcome`                                                           | How long a simulation took: completed, failed, cancelled                                             |
| `swarm.report.duration`            | histogram (ms) | `swarm.report.outcome`                                                        | How long generating a report took                                                                    |
| `swarm.cancellations`              | counter        | `swarm.cancel.scope`                                                          | Work a person stopped: research, simulation, analysis, report, critique, actors, constraints         |
| `swarm.deployment.info`            | gauge          | `swarm.deployment.mode`, `swarm.build.version`, `swarm.build.sha`             | 1 for the deployment this process is: its mode, version and the first twelve characters of the build |

`swarm.cancellations` is the one name outside the families `swarm.research.*`, `swarm.actors.*`,
`swarm.constraints.*`, `swarm.sim.*` and `swarm.report.*`: a cancellation belongs to all of them, and one
counter by scope is one query for a dashboard.

Two enumerations are closed lists in `product-signals.ts` that the code that owns the thing must
keep true: `GATE_STATUSES` (a status that is not on it is recorded as `other`, so extend the list
when the approval gate gains one) and `SAFETY_BLOCK_REASONS` (`safetyReasonOfAddress` maps the address
classifier's verdicts to it). Issue codes are constants of the validating code, in capitals with
underscores (`ACTOR_ROLE_UNKNOWN`); anything else is recorded as `other`, and a proposal reports at
most twenty distinct codes.

### The attributes

| Attribute                                   | Values                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `swarm.research.outcome`                    | `started`, `completed`, `cancelled`, `failed`, `blocked`                            |
| `swarm.research.mode`                       | `url`, `domain`, `discovery`, `manual`                                              |
| `swarm.research.stop_reason`                | the stop reasons of `shared/research.ts`                                            |
| `swarm.fetch.error_class`                   | the fetch error classes of `shared/research.ts`                                     |
| `swarm.safety.reason`                       | `SAFETY_BLOCK_REASONS`                                                              |
| `swarm.quarantine.reason`                   | the quarantine reasons of `shared/research.ts`                                      |
| `swarm.source.category`                     | the source categories of `shared/research.ts`                                       |
| `swarm.proposal.origin`                     | `model`, `rules`, `fallback`                                                        |
| `swarm.issue.code`                          | a code in capitals, or `other`                                                      |
| `swarm.gate.status`                         | `GATE_STATUSES`, or `other`                                                         |
| `swarm.sim.outcome`, `swarm.report.outcome` | `completed`, `failed`, `cancelled`                                                  |
| `swarm.cancel.scope`                        | `research`, `simulation`, `analysis`, `report`, `critique`, `actors`, `constraints` |
| `swarm.deployment.mode`                     | `local`, `pilot`, `production`                                                      |
| `swarm.build.version`, `swarm.build.sha`    | the release's version; a commit's first twelve characters, or `unknown`             |

### Adding a signal

Add a recorder to `product-signals.ts` that takes enumerations and numbers, map anything that is not
a known value to `other`, add the attribute name to the allow-list in `attributes.ts`, add a row to
the table above, and add the recorder to the table of `backend/test/telemetry-product.test.ts` (which
also checks that every metric is written down on this page). A name that contains `url`, `host`,
`path`, `address`, `title`, `name`, `text`, `content`, `person` or `email` is refused by that test.

## Logs

The server's logs are structured, one JSON line each. What is in them, and what a test pins:

- **A request** is logged as method, path and host name, and an id. **The query string is never
  logged**, nor a header, a cookie, a body or a client address: `backend/test/logging.test.ts` sends
  tokens in the query of every kind of route (public, API, sign-in, unknown, unreadable address, parameter
  too long) at the info and the debug level and reads every line. The `Host` header is logged as it was
  received, because the host allow-list refuses on it; a request for an unlisted host is therefore
  logged with that name. A path is logged as sent: for a real route it holds identifiers, for an unknown
  one whatever the caller typed.
- **A failure on the server** is logged as a code, an error type and the request id. The message of the
  error, its cause, the provider's answer and anything a person wrote are not logged
  (`privacy.test.ts` makes a handler throw a connection string and a question).
- **Sign-in** logs a short reason code, never a code, a state, a token or a cookie.
- **The deployment** is logged once at start-up for a pilot or production process: mode, label, version
  and build, and the recommendations that did not stop the start. A local run logs nothing of it, except
  one warning when its configuration looks hosted (see [the guards](./identity.md#1-deployment-modes)).

## What an answer says

Every error answer has the shape `{ error: { code, message, requestId } }` and the same id in
`x-request-id`. A failure that is the server's (5xx) says that something failed and which id to quote:
the message of an exception, of its cause, and the body of a provider's answer are never in it.
`backend/test/logging.test.ts` raises seven kinds of exception that carry a connection string and checks
that the answer is the same sentence for each.

Requests that Fastify refuses before any route is found (an address that cannot be read, a path
parameter that is too long) are answered by `frameworkFailure` in `backend/src/telemetry/http.ts`.
Fastify's own answer to those repeats the whole address, query string included, in the body; this one
does not. It was found by the privacy tests, and it is the one change they made to behaviour.

## The audit log

The audit log holds who did what to which experiment, with identifiers, counts and short labels
(`backend/src/auth/audit-policy.ts` decides for each route what is recorded; a test proves none lacks a
rule). A refused address is recorded with its host and a reason code, not its path, query or any password
in it. `privacy.test.ts` reads every row after a scripted session that sent credentials, questions,
sources and addresses through every route it could, and finds none of them.

## The tests that hold this

| Test file                                | What it proves                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/test/telemetry-product.test.ts` | Each recorder's metric, name, attributes and amount; enumerations only (hostile values become `other`); no name for an address, host or text; counts bounded; no-ops when telemetry is off; the deployment gauge; this page lists every metric                                                                                                      |
| `backend/test/privacy.test.ts`           | A scripted session of about two dozen requests with canary credentials, tokens, cookies, keys, a connection string, questions, sources and addresses planted in the query, headers, bodies and configuration. The log, every error answer, the audit log and every span and metric hold none of them; no span has an event; 5xx answers are generic |
| `backend/test/logging.test.ts`           | No query string in any log line at either level; the three fields of a logged request and no header, cookie or body key; the correlation id; framework errors do not echo the address; seven kinds of exception give one answer                                                                                                                     |
| `backend/test/telemetry.test.ts`         | Unchanged: the allow-list, redaction, request metrics, jobs, gauges, model and grounding counters                                                                                                                                                                                                                                                   |

A test that plants a canary is only worth anything if the canary is shown to be in the system and the
failure to be reachable. `privacy.test.ts` checks both first (the export of the project holds what was
written; every kind of status was returned), and each of its rules was shown to fail when broken (logging
the full URL, logging an exception's message, echoing an address in an answer).

## Not covered, and why

- **Trace content stays off.** Whether the model client may attach a prompt or an answer to a span is
  decided by the models workstream (`TELEMETRY_TRACE_CONTENT`), not here. What this page and its tests
  cover is the application's own spans: the request span and the job span carry a route template, a status
  and an error code, never an exception, an event, a query or a body.
- **A real Application Insights resource.** No export has been made to one, so what the portal shows, the
  retention and the access to it are unverified.
- **Cumulative metrics.** An in-memory reader keeps the last value of a gauge, and so may a real
  exporter; the deployment gauge is therefore best read as "the latest report from each instance".
- **A tenant or a person is not an attribute,** by design (see the observability guide). Nothing here can
  answer "which customer".
- **Third-party and platform logs.** The container platform's own request logs, the ingress and the
  database's logs are outside this application and need their own review.
