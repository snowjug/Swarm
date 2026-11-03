# 0020. The Foundry provider on the OpenAI-compatible v1 API, Microsoft Entra by default

Status: Accepted. Built, and proved against an in-process fake of the endpoint
(`backend/test/support/fake-foundry.ts`). **Never run against a live Foundry resource.** The live evidence in
[docs/AZURE.md](../AZURE.md#live-evidence) was gathered with `AI_PROVIDER=azure`, on one development deployment,
and says nothing about this provider.

## Context

The `azure` provider already reached an Azure OpenAI resource through the v1 API with a Microsoft Entra token and
no key. The steps added for the pilot want more of a model than a single deployment and a plain JSON reply: a
deployment chosen for the kind of task, the model held to a strict schema, an allowance for one operation in
tokens and in estimated dollars, an optional cache that cannot cross a tenant, and the provider's own content
safety visible instead of folded into a failure. None of it may put a model name, a price or a region in the
code, because what a deployment is belongs to whoever runs it.

## Decision

1. **A provider of its own, `AI_PROVIDER=foundry`, on the same v1 API.** `FOUNDRY_ENDPOINT` is the resource
   root or its `/openai/v1` path. It must be https, with a host ending `.openai.azure.com`,
   `.services.ai.azure.com` or `.cognitiveservices.azure.com`, no credentials, query, fragment or port. A wrong
   value leaves the server in rules mode with a reason that does not repeat it. The Entra token is sent to such a
   host only. The `azure` provider remains beside it.
2. **Microsoft Entra by default.** The token comes from `DefaultAzureCredential` (a user-assigned managed
   identity when `AZURE_CLIENT_ID` names one), and the identity needs the Cognitive Services OpenAI User role. A
   key (`FOUNDRY_AUTH=key`) exists for development; the deployment guard refuses it in `production`, and in a
   `pilot` unless `ALLOW_MODEL_API_KEY=true` ([0021](./0021-the-deployment-guard.md)).
3. **A task names a role, never a model.** The roles are `research-planner`, `extraction`, `actor`, `scenario`,
   `critic` and `synthesis`. The operator names the deployment of each (`FOUNDRY_DEPLOYMENT_<ROLE>`), each
   defaulting to `AI_MODEL`, and says what a deployment is in a profile: reasoning, data zone, context size,
   latency, structured outputs. A reasoning deployment is sent `reasoning_effort` and no temperature. No model name
   is built into the code.
4. **Strict structured output.** A reply is asked for as `response_format: json_schema` with `strict: true`, made
   from the task's own zod schema and adapted for strict mode. What strict mode cannot say is asked for as plain
   JSON, and zod and the server's checks judge every reply whatever the mode ([0019](./0019-one-output-policy-for-model-replies.md)).
   A parameter a deployment rejects is asked again once without it, counted and gated like any call, and
   remembered for that deployment for an hour.
5. **A router that is configuration and arithmetic.** Role, availability, data zone, context size, cost
   ceiling, need for reasoning, latency budget and schema needs, in that order, with no network and no
   randomness, so a route can be explained and tested as a table. A deployment named as the fallback is tried once
   when the first is missing, throttled, slow or failing. No preview model router is used.
6. **Allowances from prices the operator enters.** `MODEL_PRICES` is the only source of a price, and Swarm ships
   none: a deployment with no price has an unknown cost, never zero, and a dollar limit with no price table stops the
   server from starting. One operation is held to `MODEL_OPERATION_TOKEN_LIMIT` and
   `MODEL_OPERATION_COST_LIMIT_USD` before every round trip, and the project's own budget
   ([0013](./0013-per-project-model-budget.md)) is asked as well.
7. **An optional cache, per tenant, in this process's memory, off by default** (`MODEL_CACHE=tenant`). A task with
   no tenant is never cached, only a validated model answer is stored, and an answer is checked again on every hit.
8. **The provider's safety is visible.** The client reads the content-filter annotations Azure adds. A refusal or a
   blocked prompt or answer is `MODEL_REFUSED` and is never answered from rules or tried on another deployment; a
   detection that did not block is a signal that is counted and handed on.
9. **Metrics without content.** `swarm.model.*` counts calls, tokens, estimated cost, fallbacks, schema failures
   and safety events by role, task and deployment, under an allow-list of attribute names. With
   `TELEMETRY_TRACE_CONTENT=off`, the default, no attribute is derived from content.
10. **One test seam.** `FOUNDRY_TEST_ALLOW_LOOPBACK=1` lets a test point at a server on this machine. A pilot or
    production deployment refuses to start with it set.

## Consequences

- **Not verified against Azure:** that the deployments you configure accept strict `json_schema` and
  `reasoning_effort`; the error codes and bodies for refused parameters and blocked content; the shape of the
  content-filter annotations; the schema keywords strict mode refuses; Retry-After behaviour; the token usage
  fields; the Entra scope and role assignment; and any latency, quota or price. The first live run is
  `POST /api/provider/check` against the real resource, then a small task, then the status counters
  ([the list](../models/foundry.md#verified-and-not-verified)).
- The router, the allowances, the cache and the failover are in the task runner, and only the planning of a
  research run uses the runner today. Every other step is sent to the default deployment, `AI_MODEL`, through the
  same client, which does ask a Foundry deployment for strict output. The roles `extraction`, `critic` and
  `synthesis` can be given a deployment and nothing asks for them.
- A cost is an estimate from prices an operator typed, and nothing in it is a bill.
- Two Azure providers exist side by side. The one that has run live is `azure`.

## Evidence

`backend/test/foundry-client.test.ts`, `foundry-config.test.ts`, `model-router.test.ts`,
`model-runner.test.ts`, `model-cost.test.ts`, `model-cache.test.ts`, `model-strict-schema.test.ts` and
`telemetry-model.test.ts`, against `backend/test/support/fake-foundry.ts`, check the request shape, the
credentials, strict-schema conversion against the documented rules, downgrades and refused parameters, the
classification of refusals and filters, routing, budgets, cache isolation between tenants, failover, and that no
credential, endpoint or content reaches logs, status or telemetry ([what is verified, and only against the
fake](../models/foundry.md#verified-and-not-verified)). The `fake-foundry` mode of `npm run eval:ai`
(`evaluation/test/ai-fake-foundry.test.ts`) runs the real client and the output policy against the same fake.
The specification is [Foundry models](../models/foundry.md).
