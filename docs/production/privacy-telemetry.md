# Privacy and product telemetry

What Swarm tells its operators about how its work goes, what it is built never to say, and the tests
that hold it to that. It extends [the observability guide](../operations/observability.md), which
describes the request, job, database and model signals that already existed; this page adds the
product signals and the rules for logs, answers and the audit log.

**Status: built and tested with in-memory exporters and a scripted session of real requests
(`backend/test/telemetry-product.test.ts`, `telemetry-wiring.test.ts`, `privacy.test.ts`, `logging.test.ts`). Nothing here has
been exported to a real Application Insights resource, and no dashboard or alert has been run
against these signals.** The signals are recorders that the code that does the work calls, once for
each thing done; the table says what counts. Product code calls the research recorders
(`research/run.ts`, `research/service.ts`), the participants proposal (`routes/stakeholders.ts`), the
constraint proposal and gate (`constraints/service.ts`, `constraints/plan.ts`), the duration of a
comparison (`analysis/service.ts`), `swarm.report.duration` (the Decision Canvas, `decision/service.ts`)
and `swarm.deployment.info` (`deployment.ts`). A cancellation is recorded for research and for a comparison
of scenarios, so that metric does not yet say how often a person stops a report or a survey.

## Principles

1. **Counts, durations and enumerations. Nothing about what the work was about.** A signal never
   carries a question, a passage, an address, a host name of a page a person named, a title, a name
   or an identifier of a person.
2. **An enumeration that is not one of the known values is recorded as `other`.** A caller that passes
   free text by mistake produces a count under `other`, not a leak.
3. **Names are an allow-list.** `backend/src/telemetry/attributes.ts` keeps only the attribute names on
   its list, scalars only, strings redacted for what looks like a credential and cut to 120
   characters. A test fails if a name that suggests content is added.
4. **Telemetry off means no cost, and a failing meter means nothing recorded.** With no meter provider
   registered (no connection string) every recorder does nothing; with one that fails (an instrument that
   cannot be made, an exporter that throws) a recorder records nothing and never throws into the request
   (`quietly` in `product-signals.ts`; `telemetry-wiring.test.ts` serves requests with a meter that cannot
   make the product instruments).
5. **Estimated model cost is not here.** It belongs to `swarm.model.*`.

## The product signals

Recorders are in `backend/src/telemetry/product-signals.ts`; the header of that file documents each
one. Attribute values are listed here by the enumeration they come from.

| Metric                             | Kind           | Attributes                                                                    | What it counts                                                                                                                            |
| ---------------------------------- | -------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `swarm.research.runs`              | counter        | `swarm.research.outcome`, `swarm.research.mode`, `swarm.research.stop_reason` | Research runs: started, completed, cancelled, failed, blocked; the reason a finished run stopped                                          |
| `swarm.research.pages`             | counter        | `swarm.research.mode`                                                         | Pages fetched                                                                                                                             |
| `swarm.research.crawl.duration`    | histogram (ms) | `swarm.research.mode`, `swarm.research.stop_reason`                           | How long a crawl took                                                                                                                     |
| `swarm.research.fetch.failures`    | counter        | `swarm.fetch.error_class`                                                     | Failed fetches, by `FETCH_ERROR_CLASSES`                                                                                                  |
| `swarm.research.safety.blocks`     | counter        | `swarm.safety.reason`                                                         | Requests a deterministic rule refused, by `SAFETY_BLOCK_REASONS`                                                                          |
| `swarm.research.quarantines`       | counter        | `swarm.quarantine.reason`                                                     | Pages set aside, by `QUARANTINE_REASONS`                                                                                                  |
| `swarm.research.sources.used`      | counter        | `swarm.source.category`                                                       | Sources that became evidence, by `SOURCE_CATEGORIES`                                                                                      |
| `swarm.research.evidence.passages` | counter        | `swarm.research.mode`                                                         | Passages indexed as evidence                                                                                                              |
| `swarm.actors.proposals`           | counter        | `swarm.proposal.origin`                                                       | Participant proposals that were kept: by the model, by rules as asked, or by rules after the model could not be used (`fallback`)         |
| `swarm.actors.proposed`            | counter        | `swarm.proposal.origin`                                                       | Participants those proposals made, as the person is shown the list (folded or left out are not counted)                                   |
| `swarm.actors.valid`               | counter        | `swarm.proposal.origin`                                                       | Of those, the participants with no blocking issue in the review that followed                                                             |
| `swarm.actors.issues`              | counter        | `swarm.issue.code`                                                            | The review's issues by rule code, blocking and advisory (`PARTICIPANT_ISSUE_CODES`)                                                       |
| `swarm.constraints.proposals`      | counter        | `swarm.proposal.origin`                                                       | Constraint proposals that were kept, by origin: the model, rules as asked, or `fallback`                                                  |
| `swarm.constraints.proposed`       | counter        | `swarm.proposal.origin`                                                       | Constraints those proposals added to the set                                                                                              |
| `swarm.constraints.gate`           | counter        | `swarm.gate.status`                                                           | Evaluations of the coverage gate for a page that asked (the gate, the next comparison's readiness), by `GATE_STATUSES`                    |
| `swarm.sim.duration`               | histogram (ms) | `swarm.sim.outcome`                                                           | How long a comparison of scenarios took, to where it ended: completed, failed or cancelled (one the server stopped is not recorded)       |
| `swarm.report.duration`            | histogram (ms) | `swarm.report.outcome`                                                        | How long the Decision Canvas took to build (its only caller; the guided report does not record one)                                       |
| `swarm.cancellations`              | counter        | `swarm.cancel.scope`                                                          | Work a person stopped: the scopes are research, simulation, analysis, report, critique, actors and constraints; only research records one |
| `swarm.deployment.info`            | gauge          | `swarm.deployment.mode`, `swarm.build.version`, `swarm.build.sha`             | 1 for the deployment this process is: its mode, version and the first twelve characters of the build                                      |

`swarm.cancellations` is the one name outside the families `swarm.research.*`, `swarm.actors.*`,
`swarm.constraints.*`, `swarm.sim.*` and `swarm.report.*`: a cancellation belongs to all of them, and one
counter by scope is one query for a dashboard.

Three enumerations are closed lists in `product-signals.ts` that the code that owns the thing must
keep true: `GATE_STATUSES` (the constraint gate's own, clear, provisional and blocked), `PARTICIPANT_ISSUE_CODES`
(the rule codes of the participants' review) and `SAFETY_BLOCK_REASONS` (`safetyReasonOfAddress` maps the
address classifier's verdicts to it). A value that is not on a list is recorded as `other`, so extend the
list when the owner gains one; `telemetry-product.test.ts` fails if the first two differ from
`shared/constraints.ts` and `stakeholders/participants/validate.ts`. An issue code is a code on its list
and never a sentence or a name.

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
| `swarm.issue.code`                          | `PARTICIPANT_ISSUE_CODES` (the review's rule codes, such as `too-few`), or `other`  |
| `swarm.gate.status`                         | `clear`, `provisional`, `blocked` (`GATE_STATUSES`), or `other`                     |
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

Call it from the code that does the work, **once for each thing done and after it was kept** (a
proposal that was saved, a comparison that ended), never from a read that works the same thing out
again: the gate is recorded for the two pages that ask for it and not for a read of the constraints,
which works it out as well. Pass it what the person was already shown (the review, the status), not a
second computation, and never a name, an id or a sentence. Give the call a test in
`backend/test/telemetry-wiring.test.ts` that drives the route or the service, counts the calls, and
reads what the exporters hold.

### Where each is called, and what it does not count

| Recorder             | Called in                                                    | Not counted                                                                                        |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `actorProposal`      | `POST /stakeholders/propose`, once the proposal is saved     | A proposal that was refused or not saved; the regeneration of one participant; the older discovery |
| `constraintProposal` | `ConstraintService.propose`, once the set is saved           | A proposal that was refused (a model asked for and not there) or not saved                         |
| `constraintGate`     | `GET /constraints/gate` and the readiness in `GET /analysis` | A read of the constraints, which works the gate out too; the gate as a comparison starts           |
| `simulationDuration` | `AnalysisService`, where a comparison ends                   | A comparison that the server stopped (it is marked interrupted); the time before it starts         |

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

- **Trace content stays off unless it is asked for.** With `TELEMETRY_TRACE_CONTENT=redacted` the
  `swarm.model.task` span of a structured task (every one has it: `models/task-telemetry.ts`)
  also carries the size of the prompt and of the reply and a short hash of the prompt: derived from content,
  never the text ([Foundry models](../models/foundry.md#telemetry); tested in `telemetry-model.test.ts` and
  `foundry-config.test.ts`). The scripted session of `privacy.test.ts` does not turn it on. What this page and
  its tests cover is the application's own spans: the request span and the job span carry a route template, a status
  and an error code, never an exception, an event, a query or a body.
- **A real Application Insights resource.** No export has been made to one, so what the portal shows, the
  retention and the access to it are unverified.
- **Cumulative metrics.** An in-memory reader keeps the last value of a gauge, and so may a real
  exporter; the deployment gauge is therefore best read as "the latest report from each instance".
- **A tenant or a person is not an attribute,** by design (see the observability guide). Nothing here can
  answer "which customer".
- **Third-party and platform logs.** The container platform's own request logs, the ingress and the
  database's logs are outside this application and need their own review.
