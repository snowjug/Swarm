# Microsoft Foundry models: routing, structured outputs, budgets, cache and safety signals

> **Status.** Everything below is proved against an in-process fake of the Azure OpenAI v1 endpoint
> (`backend/test/support/fake-foundry.ts`). No part of it has been run against a live Foundry resource.
> Where this page describes what the real service does (error shapes, annotation shapes, which keywords
> strict structured output refuses) it is written from the service's public documentation and marked
> _unverified_. Treat the first live run as the test of those lines.

`AI_PROVIDER=foundry` reaches a Microsoft Foundry (Azure OpenAI) resource through its
OpenAI-compatible **v1 Chat Completions** API, using the client Swarm already has. On top of the existing
provider contract it adds Microsoft Entra ID without keys, a deployment per **role**, strict structured
outputs, a deterministic router, per-operation allowances, a tenant-scoped cache, content-safety signals
and metrics. `AI_PROVIDER=azure` is unchanged and does not use any of this routing.

Every task keeps a deterministic rules path (`fallback`), and the product works end to end with no model
configured. The model has no tools, and web content is data, never an instruction.

## Quick start

Three variables give a working server, with one deployment serving every role:

```dotenv
AI_PROVIDER=foundry
FOUNDRY_ENDPOINT=https://<resource>.openai.azure.com
AI_MODEL=<the name of a deployment of that resource>
```

Sign in with Microsoft Entra ID: run `az login` locally, or give the hosted workload a managed identity
(set `AZURE_CLIENT_ID` for a user-assigned one). The identity needs the **Cognitive Services OpenAI User**
role on the resource. No API key exists or is read. Then call `POST /api/provider/check`, which asks every
deployment a task could be routed to, once each, and reports apart whether it was reachable, signed in to, found and
gave structured output ([the connection check](#the-connection-check)).

## Environment variables

| Variable                              | Default    | Meaning                                                                                                                                                                                                                                                             |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                         | `none`     | `foundry` selects this provider.                                                                                                                                                                                                                                    |
| `AI_MODEL`                            | none       | The **default deployment**, used by every role that has none of its own. Required. A deployment name, never a model name.                                                                                                                                           |
| `FOUNDRY_ENDPOINT`                    | none       | `https://` only; the host must end in `.openai.azure.com`, `.services.ai.azure.com` or `.cognitiveservices.azure.com`. The resource root or its `/openai/v1` path. A wrong value leaves the server in rules mode, with a reason that does not repeat it.            |
| `FOUNDRY_AUTH`                        | `entra`    | `entra` or `key`. A key is used only when `key` is chosen, and **a production deployment (`DEPLOYMENT_MODE=production`) refuses to start with it**.                                                                                                                 |
| `FOUNDRY_API_KEY`                     | none       | Read only when `FOUNDRY_AUTH=key`. Sent as the `api-key` header. Never logged, returned or exported.                                                                                                                                                                |
| `AZURE_CLIENT_ID`                     | none       | Client id of a user-assigned managed identity (not a secret).                                                                                                                                                                                                       |
| `FOUNDRY_DEPLOYMENT_RESEARCH_PLANNER` | `AI_MODEL` | Deployment for the role `research-planner`.                                                                                                                                                                                                                         |
| `FOUNDRY_DEPLOYMENT_EXTRACTION`       | `AI_MODEL` | … the role `extraction`.                                                                                                                                                                                                                                            |
| `FOUNDRY_DEPLOYMENT_ACTOR`            | `AI_MODEL` | … the role `actor`.                                                                                                                                                                                                                                                 |
| `FOUNDRY_DEPLOYMENT_SCENARIO`         | `AI_MODEL` | … the role `scenario`.                                                                                                                                                                                                                                              |
| `FOUNDRY_DEPLOYMENT_CRITIC`           | `AI_MODEL` | … the role `critic`.                                                                                                                                                                                                                                                |
| `FOUNDRY_DEPLOYMENT_SYNTHESIS`        | `AI_MODEL` | … the role `synthesis`.                                                                                                                                                                                                                                             |
| `FOUNDRY_DEPLOYMENT_REASONING`        | none       | Preferred when a task needs reasoning and its role's deployment is not a reasoning one.                                                                                                                                                                             |
| `FOUNDRY_DEPLOYMENT_FALLBACK`         | none       | Tried once, in place of the chosen deployment, when that one is missing, throttled, slow or failing.                                                                                                                                                                |
| `FOUNDRY_DEPLOYMENT_PROFILES`         | none       | JSON object, per deployment: `reasoning` (takes `reasoning_effort`, refuses `temperature`), `dataZone`, `maxContextChars`, `latency` (`fast`, `standard`, `slow`), `structuredOutputs` (`false`: never ask for strict output).                                      |
| `FOUNDRY_DATA_ZONE`                   | none       | When set, **every** task is served only from a deployment whose profile declares this zone. An undeclared deployment is never assumed to be in it.                                                                                                                  |
| `AI_TIMEOUT_MS`                       | `120000`   | The time limit of one request. A task's latency budget can only shorten it.                                                                                                                                                                                         |
| `MODEL_PRICES`                        | none       | JSON array of `{deployment, inputPerMillionUsd, outputPerMillionUsd}`; `deployment` is a name or a pattern with `*`. **Swarm ships no price.**                                                                                                                      |
| `MODEL_OPERATION_TOKEN_LIMIT`         | `0`        | Tokens (input plus output) an operation may use. `0`: no limit.                                                                                                                                                                                                     |
| `MODEL_OPERATION_COST_LIMIT_USD`      | `0`        | Estimated dollars an operation may spend. Needs `MODEL_PRICES`; the server does not start without them.                                                                                                                                                             |
| `MODEL_CACHE`                         | `off`      | `off` or `tenant`.                                                                                                                                                                                                                                                  |
| `MODEL_CACHE_MAX_ENTRIES`             | `256`      | Entries kept (the cache is also bounded to 16 MiB in all and 256 KiB per entry).                                                                                                                                                                                    |
| `MODEL_CACHE_TTL_SECONDS`             | `900`      | How long an entry is served.                                                                                                                                                                                                                                        |
| `TELEMETRY_TRACE_CONTENT`             | `off`      | `off` or `redacted`. See [Telemetry](#telemetry).                                                                                                                                                                                                                   |
| `DEPLOYMENT_MODE`                     | `local`    | `production` tightens what may be configured (a key is refused). The rules themselves are the deployment guard's: [identity.md](../production/identity.md#1-deployment-modes).                                                                                      |
| `FOUNDRY_TEST_ALLOW_LOOPBACK`         | none       | **Test seam.** `1` lets `FOUNDRY_ENDPOINT` be `http(s)://localhost`, `127.0.0.1` or `[::1]`, so that a test can use the fake server. A pilot or production deployment refuses to start with it set (`backend/src/deployment.ts`). Never set it for a real resource. |

A name that is not a deployment name (letters, digits, dots, hyphens, underscores), a malformed JSON value,
or an unknown option stops the server at start-up and names the variable, never its value. The role
variables, profiles and zone are read only when `AI_PROVIDER=foundry`; prices, allowances, the cache and
trace content apply to any provider.

## Where it is used today

The router, the allowances, the cache and the failover live in the task runner (`taskRunnerFor` in
`backend/src/models/factory.ts`, `runner.ts`), and one thing calls it: the planning of a research run
(`backend/src/research/run.ts`, role `research-planner`). The other steps that use a model go through the same client,
which asks a Foundry deployment for strict structured output, but not through the runner. They are sent to the default
deployment, `AI_MODEL`, and are held to no allowance of their own beyond the project's budget.

| Step                                                                                                                                      | How it asks                                                                                                  | Role               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| Research planning (`research/plan.ts`)                                                                                                    | The runner: routed, allowance, cache, failover, then `runStructuredTask`                                     | `research-planner` |
| Participants (`stakeholders/participants/propose.ts`)                                                                                     | `runStructuredTask`: strict schema, the server's checks, one correction, then rules                          | `actor`            |
| Constraints (`constraints/model.ts`)                                                                                                      | `runStructuredTask`                                                                                          | `scenario`         |
| Question reading, stakeholder discovery by a model, key-actor reading, model critiques, Report Studio, the deep dive, the grounding check | `jsonValidated` (`models/validated.ts`): the schema, bounded repairs; each has its own rules path or failure | none               |

The roles `extraction`, `critic` and `synthesis` exist and have settings (`FOUNDRY_DEPLOYMENT_EXTRACTION` and so on), but no
step asks for them yet, so setting one changes nothing.

## Roles

A task names its **role**, never a model. A deployment may serve several roles, or all of them.

| Role               | Used for                                     | Default temperature | Effort on a reasoning deployment | Answer budget (tokens) |
| ------------------ | -------------------------------------------- | ------------------- | -------------------------------- | ---------------------- |
| `research-planner` | deciding what to look for                    | 0.2                 | medium                           | 2,000                  |
| `extraction`       | reading a passage into structured evidence   | 0                   | low                              | 4,000                  |
| `actor`            | proposing and refining role-based actors     | 0.5                 | low                              | 2,500                  |
| `scenario`         | structuring a question into a scenario frame | 0.3                 | medium                           | 3,000                  |
| `critic`           | challenging a result                         | 0.2                 | high                             | 3,000                  |
| `synthesis`        | writing a conclusion from recorded results   | 0.3                 | medium                           | 4,000                  |

A reasoning deployment is sent `reasoning_effort` and no temperature, and is given room for its thinking on
top of the answer (500 to 4,000 tokens by effort, never more than 16,000 in all); a cost ceiling is held to
what is sent, that room included. A task may ask for another answer budget (`maxTokens`, at most 16,000):
anything that is not a number of one or more gets the role's own. These are defaults in
`backend/src/models/router.ts`; no model name is built into the code.

### Thinking is counted against the output limit

A reasoning deployment (the gpt-5 and o-series) spends hidden **reasoning tokens** before it writes the first
word of the answer, and they count against `max_completion_tokens`. A limit sized for the answer alone can be
used up by thinking: the reply then ends with `finish_reason: length` and no JSON in it, even for a request
that asks for one word. This is what a live pilot showed: the connection check asked for 50 tokens and was
cut off, and so were the research plan and the participants. So every call on a Foundry deployment, routed
or not (`backend/src/models/output-policy.ts`, applied in `ModelClient`):

- **Is asked at a low effort.** A structured answer is a form to be filled in; the schema constrains it, and
  thinking costs time, money and room for the answer. The effort is `low` unless a router names another for
  a deployment it knows reasons. A deployment that refuses the effort is asked again without it, and the
  refusal is remembered like any other (an hour, per deployment). A refusal that names no parameter, which
  is how Azure answers an argument a model does not know, is blamed first on the effort the client added,
  and not on strict output; if a second one follows, the effort is put back and the structured output is
  blamed instead. A deployment that takes an effort but not `minimal` is asked at `low`.
- **Is given room to think** on top of the answer the task wants: 500, 1,000, 2,000 or 4,000 tokens for
  `minimal`, `low`, `medium` and `high`, never more than 16,000 in all. A router that has made that room
  already (a deployment declared as reasoning) says so, and it is not made twice. The room is part of what
  an operation's allowance holds back for the call.
- **Never accepts a reply that ended at its limit,** even one that parses. It is asked for **once** more with
  twice the budget (up to 16,000) and one step less thinking (down to `minimal`), and if that is cut off too
  the call fails as `MODEL_TRUNCATED`. The retry is admitted by the project's budget, counted against the
  operation's call cap and held to its allowance, like any call; it **does not use up the correction round**,
  which is for a reply that was read and found wrong.
- **Keeps the strict schema** wherever the deployment takes it (`response_format: json_schema`). Only
  `key-actor-refinement.v1` still asks for plain JSON, because its `traits` object has free keys.

### The connection check

`POST /api/provider/check` (the **Verify connection** button in the engine chip's popover) makes one tiny real
request to every deployment a task could be routed to, and says what it found about **four things, apart**, for
each: whether it was **reachable**, whether the provider took the credentials (**authenticated**), whether the
**deployment was found**, and whether it gave **structured output**. Each is `ok`, `failed` or `unknown` (the
check did not get far enough to say, which is not a pass), with a reason in fixed words or counts and never a word
of the provider's. The request is made so that it cannot fail for a reason that is not a finding: one fixed word as
strict JSON (`{"status":"ok"}`), at the lowest reasoning effort, with 1,024 tokens to write and the room to think
that effort is given, and a cut-off reply is asked for once more with twice the room. A live pilot's check asked for
50 tokens, was cut off by the deployment's own thinking, and said "failed" while the chip said "connected".

| What the request ended in                     | Reachable | Authenticated | Deployment found | Structured output                                   |
| --------------------------------------------- | --------- | ------------- | ---------------- | --------------------------------------------------- |
| the JSON asked for                            | ok        | ok            | ok               | ok (strict schema, or plain JSON if strict refused) |
| cannot be reached, or does not answer in time | failed    | unknown       | unknown          | unknown                                             |
| an error status, or not the OpenAI chat API   | failed    | unknown       | unknown          | unknown                                             |
| credentials refused (401/403)                 | ok        | **failed**    | unknown          | unknown                                             |
| no such deployment (404)                      | ok        | unknown       | **failed**       | unknown                                             |
| throttled (429), or the provider declined     | ok        | ok            | ok               | unknown (not tested)                                |
| cut off at its limit, twice                   | ok        | ok            | ok               | **failed** (the counts of the reply)                |
| whole, but not the JSON asked for             | ok        | ok            | ok               | **failed** (which kind of check it failed)          |
| a request parameter refused                   | ok        | ok            | ok               | **failed**                                          |

**The connection is the first three, and it is confirmed or it is not.** The chip says `connected` exactly when all
three are confirmed for every deployment, and `failing` when they are not; it is read from the same result, so the
page cannot say "connected" and "the check failed" of the same check. A connection that works but whose deployment
gives cut-off or invalid replies is _connected, and structured output is not working_, and says which. A check
that ran is always an answer (**HTTP 200**) whatever it found, with `check` in the status (`ProviderCheck`, in
`shared/types.ts`; `shared/provider-check.ts` reads it the same way for the page and for the scripts). Only a check
that could not be made is an error: `503 MODEL_NOT_CONFIGURED`, or `503 MODEL_ROUTE_UNAVAILABLE` when no deployment
may serve a task. A script that must not go on without structured output reads `check.ok` (see `checkProblem`);
`npm run azure:verify`, the demo recorder and the live journey's preflight do.

### What a reply that could not be used says about itself

A reply that ended at its limit and a whole reply that was refused are different failures with different
remedies, and are kept apart everywhere (`backend/src/models/diagnostics.ts`):

- **`swarm.model.calls`** has one record per round trip, with the outcome `ok`, `repaired`, `truncated`,
  `schema-invalid` or `failed` (auth, quota, timeout), the task `role`, the provider's `finish_reason` and the
  effort asked. Tokens and the estimated cost are counted for every call whose usage was reported, used or
  not, and the hidden thinking is on `swarm.model.reasoning_tokens` (part of the output tokens, not added).
- **The failure message** says which it was, in numbers. For a cut-off reply:
  `finish_reason length; 9,000 of 9,000 output tokens, 8,900 of them hidden reasoning; reasoning effort minimal`,
  and that it was already asked for again once. For a whole reply that was refused: which kind of check it
  failed (not one JSON object, did not match the schema, failed the server's checks, repeated an instruction)
  and the same counts. The stored failure of a task carries the same facts in one short clause.
- **What is never in any of it:** a prompt, a passage, a name, or a word the model wrote. It is counts and
  closed-set words only, and the test of it (`model-diagnostics.test.ts`, `foundry-client.test.ts`) plants
  canaries in the data and in the reply and asserts that none comes out.
- **The provider panel** counts `truncated` and `schemaInvalid` apart from `failures`, and a cut-off or refused
  reply leaves the connection `ok`: the provider answered, and the connection is not what was wrong.

## How a deployment is chosen

`createRouter(config.routing).route(request)` is configuration and arithmetic: no network, no randomness,
no learning. The same request and settings always give the same route.

| Factor              | Rule                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task type           | The role's deployment, else `AI_MODEL`. Candidates, in order: the role's, the default, the reasoning one, the fallback.                                                                         |
| Availability        | A deployment the caller says is not available is skipped. Within an operation, the runner passes over a deployment that was not found, or throttled, for 30 seconds.                            |
| Privacy / data zone | Only a deployment declared in the zone may serve the task. `FOUNDRY_DATA_ZONE` pins every task to its zone: a task may name it, never another. None: no route, rules answer, nothing is sent.   |
| Context size        | A deployment with a smaller `maxContextChars` than the request is skipped.                                                                                                                      |
| Cost ceiling        | With a ceiling, a deployment needs a price and the worst case of the call as sent (input, a full answer, a reasoning deployment's thinking room) must fit under it. Unpriced: refused.          |
| Reasoning need      | A task that needs reasoning prefers a reasoning deployment. It is a preference: with none configured the task still runs.                                                                       |
| Latency budget      | The time limit becomes the budget. Under 20 s: prefer a `fast` deployment, cap the effort at `low`, one transient and one throttle retry. Under 60 s: one transient and three throttle retries. |
| Schema needs        | Strict structured output is asked for unless the deployment's profile says `structuredOutputs: false`.                                                                                          |

The route also carries `fallbackDeployment`: the next eligible candidate, tried once if the first fails with
`MODEL_NOT_FOUND`, `MODEL_RATE_LIMIT`, `MODEL_TIMEOUT` or `MODEL_HTTP_ERROR`. The runner never changes
deployment for a refusal, an authentication failure or a cancellation. A cost ceiling is checked when a
deployment is chosen, against the first call; the calls that may follow (a correction, a larger budget after
truncation) are each held to the operation's allowance. There is **no dependence on a preview model
router**: every deployment the router can return is one the operator named.

## Structured outputs

For a Foundry deployment the client sends
`response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}`, where `schema` is made
from the task's own zod schema (`z.toJSONSchema`) and adapted for strict mode
(`backend/src/models/strict-schema.ts`):

- every object is closed (`additionalProperties: false`) and lists every property as `required`;
- an **optional** or defaulted property becomes one that may be `null`, and a reply's `null` for it is turned
  back into an absence before zod judges it, so that a coercing schema (`z.coerce.number().optional()`)
  never reads it as `0` (only where strict mode put the null; a `null` the schema allows itself stays; a
  reply that passes only as it came is accepted as it came);
- unions are `anyOf`; a literal is a one-value `enum`;
- lengths, ranges, patterns, counts and defaults, which strict mode does not take, are left out and said in
  the property's description ("2 to 80 characters"). _The list of refused keywords is from the public
  documentation and is unverified._

A schema strict mode cannot say (a map with free keys, a tuple, a value of any type, an array at the root, a
very deep or large schema) is asked for as plain JSON (`json_object`) without trying.

**zod and the server's checks still judge every reply**, whatever the mode. A Foundry reply must be one JSON
document: a fenced block or prose is not repaired by pattern, it fails and gets the one correction round.

If a deployment rejects a parameter (`MODEL_PARAMETER_UNSUPPORTED`, or a plain 400), the client asks again
once without it: `json_schema` gives way to `json_object`, and a `temperature` or `reasoning_effort` is left
out. That round trip is admitted, counted and gated like any other and does not use up the correction
round. The refusal is remembered **per deployment**, only after a reply shows the call went through, and
expires after an hour. An explicit "not supported" for `response_format` is remembered for the deployment;
anything vaguer, for that one schema alone. A refused parameter is therefore found out once per process, not
once per operation, and everything a deployment refused is kept together: one that takes neither strict
output nor a temperature is found out in a single operation, and the next sends one request.

## Safety signals

The client reads the annotations Azure adds (`prompt_filter_results`, `choices[].content_filter_results`,
`finish_reason`, `message.refusal`) and the error of a blocked prompt (_shapes unverified_):

| Kind                           | Meaning                                                           | Outcome                                               |
| ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `refusal`                      | the model declined                                                | `MODEL_REFUSED`; never answered from rules            |
| `blocked_input`                | the prompt was blocked (HTTP 400 `content_filter`, or `filtered`) | `MODEL_REFUSED`                                       |
| `blocked_output`               | the answer was filtered or cut (`finish_reason`)                  | `MODEL_REFUSED`; partial content is never read        |
| `jailbreak`, `indirect_attack` | Prompt Shields saw an attack                                      | blocked: `MODEL_REFUSED`; detected only: a **signal** |
| `protected_material`           | protected text or code                                            | blocked: `MODEL_REFUSED`; detected only: a signal     |

A refusal is never answered from rules and never retried on another deployment. A detection that did not
block is counted and handed to the caller (`RunOutcome.safety`; `ModelRefusedError.findings` for a block);
the reply is judged as any other. Messages never carry text from the provider, only category names.

## Budgets and cost

Cost is an **estimate**, from the operator's `MODEL_PRICES`. A deployment with no price has a cost of
`unknown`: not zero and not a guess, and the cost metric is simply absent for it. Nothing here is a bill.

An **operation** (one research run, one stage) has its own allowance in tokens and in estimated dollars
(`OperationBudget`, by default from `MODEL_OPERATION_*`). Before **every** provider round trip (first reply,
correction round, refused-parameter retry, bigger-budget retry after truncation, failover) the call's worst
case must still fit, so calls that run at the same moment cannot pass the limit together. A call whose usage
the provider did not report is charged at an estimate, and so is a gateway that never asked. A dollar limit
is never enforced from a price that is not there: a deployment without a price is refused under one, and
the server does not start with a dollar limit and no price table. Beyond the allowance, the project's own
budget (`ModelUsageSink.admit`) is asked before every call, and the per-operation call cap (`maxCalls`, 16
by default) still applies. A limit is zero (none) or a number above it: one that is negative or not a number
is an error (`MODEL_BUDGET_INVALID`) when the allowance is made, never read as no limit.

A budget stop is not a failure: the task is answered by rules, with `failure.code` one of
`MODEL_TOKEN_BUDGET`, `MODEL_COST_BUDGET`, `MODEL_CALL_BUDGET` or `PROJECT_BUDGET` (`BUDGET_CODES` in
`backend/src/models/cost.ts`), so that a caller can stop instead of retrying.

## Cache

`MODEL_CACHE=tenant` keeps validated answers in process memory, keyed by **(tenant, role, task name, schema
version, deployment, SHA-256 of the instructions and data)**. It is off by default.

- A task with no `tenantId` is never cached, and one tenant never finds another's entry.
- Only a validated model answer is stored: never a refusal, a failure or a rules answer. It holds the hash
  and the answer, never the prompt.
- An answer is checked again (schema and `validate`) on every hit; one that fails is dropped.
- It is bounded in entries, in bytes per entry, in bytes in all, and in time. A reader gets a copy.
- The key includes the deployment the router would choose now, so a changed zone or routing is a miss, and a
  task that cannot be routed does not read the cache.

## Telemetry

Metrics are OpenTelemetry. The attribute allow-list in `backend/src/telemetry/attributes.ts` applies, so a
prompt, a reply, an endpoint or a credential has no name to travel under. For Foundry, `swarm.model.name` is
the deployment.

| Metric                              | Kind      | Attributes                                                                             |
| ----------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `swarm.model.calls`                 | counter   | provider, name, role, structured (`json_schema` or `json_object`), outcome, error code |
| `swarm.model.tokens`                | counter   | provider, name, role, direction (`input` or `output`)                                  |
| `swarm.model.cost.estimated_usd`    | counter   | provider, name, role. An **estimate**, and absent for a deployment with no price       |
| `swarm.model.task.duration`         | histogram | role, task, provider, outcome, source (`model`, `fallback` or `refused`), name         |
| `swarm.model.schema_failures`       | counter   | reason (`not_json`, `schema`, `validation`, `injection_echo`), repair, role, name      |
| `swarm.model.fallbacks`             | counter   | role, task, error code (only when rules stood in for a model)                          |
| `swarm.model.safety_blocks`         | counter   | safety kind, role, name                                                                |
| `swarm.model.safety_signals`        | counter   | safety kind, role, name (detections that did not block)                                |
| `swarm.model.cache.hits`, `.misses` | counter   | role, task                                                                             |

Each structured task, whichever path runs it, is recorded **once** as a `swarm.model.task` span and a `swarm.model.task.duration`
measurement (`models/task-telemetry.ts`). The task is named from a closed list (anything else is `other`), and how it ended is one of
`ok`, `corrected`, `fell-back`, `refused`, `failed` or `cancelled`. The span carries role, task, provider kind, outcome, source,
deployment and the error code. With
`TELEMETRY_TRACE_CONTENT=redacted` it also carries `swarm.model.input_chars`, `swarm.model.output_chars` and
the first 16 hex characters of a SHA-256 of the input: these are derived from content. With `off` (the
default) no content-derived attribute exists. In neither mode is the text of a prompt or a reply exported.

## Using it from code

```ts
import { taskRunnerFor } from '../models/factory.js';

const runner = taskRunnerFor(config, createModel, {
  onUsage: repository.modelUse(projectId), // the project's sink: records usage, refuses past its budget
  maxCalls: 40, // provider calls of this operation (default 16)
  // budget: newOperationBudget(config, { usd: 0.25 }), // an allowance of its own; default from MODEL_OPERATION_*
});

const outcome = await runner.run({
  role: 'extraction',
  name: 'evidence-extraction.v1',
  schema,
  instructions,
  data, // untrusted
  signal,
  validate,
  fallback, // the rules answer; it must pass `schema` and `validate`
  tenantId, // only needed for the cache
  // optional routing hints: requiresReasoning, latencyBudgetMs, costCeilingUsd, dataZone
});
// outcome: { value, source: 'model' | 'fallback', failure, deployment, usage, cost, cache, safety }
```

`runStructuredTask(model, task, observer)` in `backend/src/models/task.ts` keeps working unchanged and is
what the runner calls; use it directly when no routing or allowance is wanted. A refusal or a cancellation
is thrown, never answered from rules. The runner emits the task metrics itself.

The runner works with any provider: the allowances, the cache, the failover and the accounting do not
depend on Foundry. Strict structured output, `temperature` and `reasoning_effort` are sent only to a Foundry
deployment, and a task that names a data zone is only ever sent to a deployment that declares it, which
only a Foundry profile can do. A gateway that does not ask the call gate (a test double, another provider
client) is charged to the allowance at an estimate. Which deployment answered, and what it used, is on the
outcome; `ModelRefusedError.findings` says what a refusal was.

## Testing without Azure

`startFakeFoundry()` in `backend/test/support/fake-foundry.ts` is an HTTP server on a loopback port that
speaks the v1 chat-completions endpoint. It checks the credential, the deployment and what it accepts
(`jsonSchema`, `temperature`, `reasoningEffort`, `minimalEffort`, `maxContextChars`), spends hidden thinking
tokens against `max_completion_tokens` when a deployment is given `thinks` (so a reply that does not fit ends
with `finish_reason: length`), enforces the strict-schema rules on what
it is sent, can be scripted to reply, return invalid output, refuse, filter, truncate, throttle, fail, be
slow or hang, and records every request:

```ts
const fake = await startFakeFoundry({ deployments: { fast: {}, deep: { temperature: false } } });
const config = testConfig(fake.environment()); // AI_PROVIDER=foundry with the loopback seam
fake.script({ kind: 'reply', value: { answer: 'ok' } });
// ... use `config`, then assert on `fake.requests` and `fake.problems`
await fake.close();
```

## Verified and not verified

Verified against the fake only: the request shape (`response_format`, `max_completion_tokens`, sampling,
credentials), strict-schema conversion against the documented rules, downgrade and parameter handling,
refusal and filter classification, routing, budgets, cache isolation, failover, and that no credential,
endpoint or content reaches logs, status or telemetry.

**Not verified against Azure:** that the deployments you configure accept strict `json_schema` and
`reasoning_effort`; the exact error codes and bodies for refused parameters and blocked content; the shape of
the content-filter annotations; the schema keywords strict mode refuses; Retry-After behaviour; the token
usage fields; the Entra scope and role assignment; and any latency, quota or price. Run
`POST /api/provider/check` against the real resource first, then a small task, and read the status
counters.
