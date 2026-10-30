# Azure migration and deployment plan

## Starting point

The native local application is implemented: React/TypeScript, Fastify, SQLite,
bounded TXT/Markdown/PDF intake, two honest engine modes, separately gated stages,
independent platform state, synthetic memory, progress/cancellation,
tool-backed reporting, evidence inspection, asynchronous surveys and persistent history. The local
workflow has automated and browser validation. Real provider authentication/model
quality and Docker execution require their respective services; they are not
implied by mocked-provider tests or Compose syntax validation.

This plan does not provision paid services and is not an assertion that cloud
adapters, multi-user authentication or distributed execution already exist.

## Recommended destination

Use one **Azure Container Apps** application serving the built UI and API, with
managed identity and **Azure OpenAI / Foundry** for optional model-assisted runs.
Keep one replica until several instances against one database have been validated.
Require Entra authentication before internet exposure.

For durable hosting, use a small managed PostgreSQL database. The PostgreSQL adapter
([ADR 0009](./adr/0009-postgres-through-a-synchronous-bridge.md)) and durable job leases
([ADR 0010](./adr/0010-durable-jobs-leased-from-the-database.md)) are built and tested
in-process; they have not run against a deployed server. That is an additional database
service, not a claim that SQLite can safely scale on a network share.

```text
Authenticated user
  -> Container Apps HTTPS ingress + Entra authentication
     -> React + Fastify container
        -> PostgreSQL: tenant-scoped projects/chunks/events/conversations/jobs
        -> Azure OpenAI / Foundry v1 endpoint through managed identity
        -> optional Azure AI Search / Blob Storage only when justified
        -> content-redacted operational telemetry
```

App Service is a valid alternative if it matches the team's hosting standard;
do not deploy both hosting products for this single application.

## Service evaluation

| Service              | Decision                                                    | Reason / trigger                                                                                                          |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Azure AI Foundry     | Use for model deployment/evaluation/governance where useful | Existing orchestration does not require a hosted agent service                                                            |
| Azure OpenAI         | Preferred managed chat provider                             | Existing v1 adapter supports local API-key testing; add managed identity for production                                   |
| Azure AI Search      | Defer                                                       | Local sparse retrieval suffices for the bounded corpus; add after measuring multilingual/semantic recall or corpus growth |
| Azure Container Apps | Preferred container host                                    | One existing image, HTTPS ingress, managed identity, revisions and replica controls                                       |
| Azure App Service    | Alternative, not additional                                 | Useful for an established App Service/Easy Auth operating model                                                           |
| Azure Functions      | Do not add initially                                        | Stateful bounded simulation loops and long-running job ownership do not become simpler as HTTP functions                  |
| Azure Storage / Blob | Defer for current small text inputs                         | Add for larger original files, retention policies or future PDF/OCR; not for SQLite WAL                                   |
| Azure Cosmos DB      | Do not add initially                                        | Current project/event/conversation relations fit a relational repository; another API would add migration complexity      |
| Azure Key Vault      | Use only for unavoidable secrets                            | Prefer managed identity; avoid keeping a model API key when identity can replace it                                       |
| Application Insights | Add before production operation                             | Request/job/provider latency, failure codes and consumption telemetry with source/key redaction                           |
| Managed PostgreSQL   | Add for durable public hosting                              | Transactional snapshots, tenant scoping, durable job leases and backups without network-mounted SQLite                    |

Private endpoints, dedicated networking, regional redundancy and additional queue
services should follow actual compliance, load and recovery requirements, not be
added automatically.

## Hosted pilot: plan and cost (not deployed)

The smallest hosted shape this repository can serve safely has a template, an `azd` file, a
post-deployment check and two documents:

- [Pilot plan](./azure/pilot-plan.md): the architecture, what is created and what is left out, the
  managed-identity and role matrix, deployment with `azd` or `az`, the Entra app registration, the first
  owner, backup, restore and rollback, smoke checks, teardown, and what has **not** been validated.
- [Pilot cost](./azure/pilot-cost.md): a monthly range for each resource from list prices, free grants, and
  the approval request for the chargeable resources.
- `infra/pilot/` (Bicep at resource-group scope), `azure.yaml`, and
  `npx tsx scripts/azure/pilot-smoke.ts https://<address>`.

The template compiles and lints. **Nothing has been deployed and no chargeable resource exists.**

## Azure AI integration: what exists and what is verified

| Capability                                                    | Implemented | Verified how                                                                                                                                                         |
| ------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entra ID token auth (`DefaultAzureCredential`), no key        | Yes         | Unit tests with a fake credential; **live**: every call in the three verification runs was authorised by an Entra token against a keyless account                    |
| Host allow-list; bearer token never sent elsewhere            | Yes         | Unit tests                                                                                                                                                           |
| Actionable errors: `MODEL_AUTH`/`NOT_FOUND`/`RATE_LIMIT`      | Yes         | Unit tests with a fake HTTP server; **live**: the service's real content-filter refusal (HTTP 400) was classified as `MODEL_REFUSED`                                 |
| Bounded structured-output repair loop                         | Yes         | Unit + integration tests with scripted replies                                                                                                                       |
| Provider status/telemetry API and UI badge                    | Yes         | Unit tests, browser audit                                                                                                                                            |
| One real model call per proxy, platform and round             | Yes         | Integration tests and e2e against a fake provider; **live**: 24 decisions per run (4 proxies × 2 platforms × 3 rounds), each with a stated reason, in all three runs |
| Grounding review (quotes, support verdicts, contradiction)    | Yes         | Unit and integration tests against a fake provider; **live**: the independent model check ran in all three runs                                                      |
| Bicep for an Entra-only Foundry account + deployment          | Yes         | `bicep build` and lint; **deployed** once to a development subscription (28 Oct 2026)                                                                                |
| Bicep for the hosted pilot (container app, PostgreSQL)        | Yes         | `bicep build` and lint only; **never deployed**: see [pilot plan](./azure/pilot-plan.md)                                                                             |
| Provisioning/teardown scripts with safety gates               | Yes         | Unit tests with a fake Azure CLI; **live**: one real provisioning run (two script defects found and fixed)                                                           |
| One-command live verification (`npm run azure:verify`)        | Yes         | Unit/flow tests and a Playwright run against a fake provider; **live**: 15 of 15 checks in three consecutive runs                                                    |
| Live model calls, live verification run, live injection probe | Yes         | **Yes**, on one development deployment: see "Live evidence" below                                                                                                    |

### Live evidence

On 28 Oct 2026 the repository's provisioning script created `rg-swarm-dev` in a development
subscription, and `npm run azure:verify` then passed **15 of 15 checks in three consecutive runs**
against it. Earlier runs failed or half-passed; every failure is listed under
[What the live runs found](#what-the-live-runs-found).

| What                          | Value                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Resource group, region        | `rg-swarm-dev`, East US 2                                                                                                             |
| Account                       | Foundry (`AIServices`, S0) with `disableLocalAuth: true`. Azure refuses to list keys for it, so no key exists                         |
| Deployment                    | `swarm-chat` = `gpt-4.1-mini` 2025-04-14, `GlobalStandard`, 100K tokens per minute                                                    |
| Authentication                | Microsoft Entra only (the developer's `az` sign-in through `DefaultAzureCredential`) with the **Cognitive Services OpenAI User** role |
| Written to the ignored `.env` | `AI_PROVIDER`, `AI_MODEL`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_AUTH`: none is a secret                                             |

| Run                          | Pipeline | Server round trips | Corrective retries | Report statements (supported / partly / not supported / contradicted / not checkable) | Result |
| ---------------------------- | -------- | ------------------ | ------------------ | ------------------------------------------------------------------------------------- | ------ |
| 4                            | 136 s    | 61                 | 5                  | 24 (8 / 9 / 7 / 0 / 0)                                                                | 15/15  |
| 5                            | 151 s    | 64                 | 9                  | 17 (8 / 3 / 4 / 0 / 2)                                                                | 15/15  |
| 6 (fresh server, no tracing) | 187 s    | 67                 | 11                 | 24 (12 / 4 / 7 / 0 / 1)                                                               | 15/15  |

Each run is four fictional proxies on two platforms over three rounds, then a branch from round 1,
a report, an analyst chat, an actor chat and an export. The header badge in a real browser read
**REAL AZURE AI · swarm-chat · connected**, and **Verify connection** completed one real round trip
(about 4 s); the provider panel showed "Microsoft Entra ID — no API key" and 0 failures.

Read these numbers for what they are:

- The independent check judged **28 of the 65 report statements (43%) fully supported**, 16 partly
  supported, 18 not supported, 0 contradicted and 3 not checkable. The report shows each verdict
  next to its statement. Over a quarter of what this small model wrote (18 of 65) was not
  supported by the sources, which is the reason the check exists.
- It is one model, one scenario, one subscription and three runs: evidence that the integration
  works, not a benchmark of quality. Model output varies between runs (the statement counts above
  differ), so a pass is not a guarantee of the next run.
- Not tested live: revoked-permission behaviour, quota exhaustion, role-propagation delay,
  managed identity (the app is not hosted in Azure), multi-user behaviour and Application Insights.

**Why `gpt-4.1-mini`.** The ranking preferred `gpt-5.4-mini`, but this subscription has no quota for it
in any SKU. Real quota existed only for `GlobalStandard` `gpt-4.1-mini` (200K), `gpt-5-mini` (500K) and
`o4-mini` (100K). `gpt-5-mini` retires on 2027-02-09, inside the script's 120-day safety window, so
`gpt-4.1-mini` (lifecycle Legacy, retires 2027-04-14, therefore `--allow-legacy`) was deployed with
100K. `GlobalStandard` may process prompts in any Azure region; that is acceptable here only because the
resources are tagged `purpose=dev-synthetic-data-only` and the scenarios are fictional. To move to
`gpt-5.4-mini`, request quota in the portal, then run
`npm run azure:provision -- --subscription <guid> --regions eastus2 --models gpt-5.4-mini --yes`.

#### What the live runs found

Each item failed against the real service, was fixed at its cause, and has a test that fails without
the fix.

1. **Provisioning ranked fine-tuning quota as inference quota.** The catalog lists a model's inference
   and fine-tuning SKUs under the same names; keeping the roomier one reported "500K free" for a
   deployment that had no quota. Fine-tuning SKUs are now ignored.
2. **Provisioning could not read its own outputs.** ARM lower-cases the first letter of output names
   (`azurE_…`); the lookup is now case-insensitive. The first deployment had in fact succeeded.
3. **The report stage did not converge.** The validator named one problem per attempt, cut its message
   to 200 characters (mid-identifier) and echoed only 4,000 characters of the previous reply, so the
   model repeated a different mistake each time. It now names every problem at once with the valid
   identifiers (2,400 characters of feedback, 12,000 of the reply), chapters get three repairs and the
   report-stage call budget rose from 28 to 40.
4. **Avoidable failures on format limits.** A quote over 300 characters, a claim citing more than three
   passages, or a claim that did not restate its chapter failed the whole report. These are now
   disclosed normalizations (trimmed, de-duplicated, or left out with a note in the review). Unknown
   IDs, missing citations and non-verbatim quotes still fail.
5. **The model mislabelled simulation events as source claims.** The chapter prompt now defines the kinds
   precisely; the independent check flags the ones that remain.
6. **The hidden prompt injection worked.** In run 3 the planted token appeared in 24 of 24 proxy
   statements (parent and branch), although the prompt said instructions in the data must not be
   followed, and Azure's default content filter did not stop it. See
   [Prompt injection, measured](#prompt-injection-measured).
7. **Two defects in the verifier's own report:** the reason the independent check did not run was buried
   behind unrelated notes, and the telemetry line mixed this run's counters with the server's lifetime
   totals.
8. **A contradictory message in the UI:** the entry card said connectivity was "not yet verified" directly
   above "A real request has succeeded". The configuration text now describes configuration only.

#### The live demo milestone (28 Oct 2026, final build)

A five-source synthetic scenario ([docs/demo/larkholm-ferry](./demo/larkholm-ferry/README.md)) was built end to
end through the real browser against the same deployment, which found defects that the small verification
scenario had not:

9. **Graph Build failed on model quotes.** A quote over 240 characters, then one that joined two
   sentences that were not next to each other, failed the stage after two whole-graph retries of about
   25 seconds each. Over-long quotes are trimmed, a failing quote is cut to its verbatim start, a
   relation whose type is not in the ontology is left out, and each is disclosed in the graph notes.
10. **Reports failed on slips the model repeated through every correction**: an empty `""` quote, a reworded
    or stitched quote, a memory id it had not been given, a seventh statement, an omitted list, a body just
    over the stated length, and a "source fact" with no quote. Two of five report attempts on one project failed.
    One pure normalization now removes, shortens or weakens what the model claimed (it never adds), and
    lists every repair in the grounding review. Afterwards 11 of 11 reports finished.
11. **The independent check did not run in 3 of 3 reports.** One evidence quote over 300 characters, or stitched
    from two sentences, failed the whole batch of judgements. Afterwards it ran in 8 of 8.
12. **A chapter was titled "Predicted Future Trends".** Titles that use predict or forecast are sent back.
13. **Graph labels piled up** (78 collisions across four viewports) **and were painted under later markers.**
    Labels are now ranked and drawn only where they fit, in a layer above every marker.

Run 7 (a fresh server, the final build): `npm run azure:verify` passed **15 of 15** in 169 s with 58 server
round trips and 2 corrective retries; the report had 23 statements (10 supported, 4 partly supported,
6 not supported, 0 contradicted, 3 not checkable) and the independent check ran. The demo's reports had
18 statements (parent) and 29 (branch) with 0 and 1 not supported. These are single runs of one small model;
read them as evidence the integration works, not as a measure of quality.

#### Prompt injection, measured

| Condition                                                                                    | Result                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Run 3, before hardening                                                                      | Token in **24 of 24** proxy statements, parent and branch                                 |
| Runs 4-6, after a stronger boundary and a trusted reminder placed after the data             | Token in **0 of 144** proxy statements and reasons, 0 of 6 chat replies, 0 of 3 summaries |
| 16 single calls with the real source and instructions that invite following the planted note | 16 answered, **0** repeated the token                                                     |
| The same sentence alone in a short passage, 16 calls                                         | 16 refused by Azure's content filter (`MODEL_REFUSED`)                                    |

Two readings matter. First, the prompt change fixed it for this model on these runs; the
deterministic echo guard (a reply repeating text that an AI-directed instruction asked for is
rejected and re-requested) **has never fired against the live model**, so it is evidenced by unit
tests only. Second, Azure's filter blocked the bare sentence but not the same sentence inside the
scenario source, so platform filtering is inconsistent and is not a control to rely on. Counts of
this kind are evidence, not proof, and a different or newer model may behave differently.

## Provisioning the model account with this repository

The infrastructure is plain Bicep plus two TypeScript scripts, so it runs from the
Azure CLI login you already have, with no extra tooling and no `azd` hooks.

```text
infra/main.bicep                    subscription scope: resource group + account + deployment
infra/modules/ai-services.bicep     resource-group scope: the account, deployment, role assignment
scripts/azure/provision.ts          preflight, model selection, what-if, deploy, write .env
scripts/azure/teardown.ts           tagged-resources-only delete and purge
```

What the template creates, and what it deliberately does not:

- A Microsoft Foundry (`AIServices`) account with a custom sub-domain and
  `disableLocalAuth: true`, so **only Entra ID can call it** and no key can ever exist.
- One chat-model deployment on a **pay-as-you-go** SKU (`Standard`,
  `DataZoneStandard` or `GlobalStandard`). Provisioned (reserved, hourly-billed)
  capacity is not selectable. Capacity is a **rate limit, not a spend cap** (you pay
  per token used): the default is 50K tokens per minute and the template caps it at
  100K. A model-assisted run makes about `proxies × platforms × rounds` small calls
  of roughly 3K tokens each, so six proxies over eight rounds on both platforms is
  about 300K tokens; at 50K per minute that finishes in several minutes, and
  throttling (HTTP 429) is retried up to five times before the stage fails.
- The **Cognitive Services OpenAI User** role for the principal you name, and nothing
  broader. No Contributor/Owner grant, no key, secret or connection string, and no
  secret output.
- The service's default content filtering stays on, and the model version is pinned
  (`NoAutoUpgrade`) so evaluations are reproducible.

Preflight is read-only and needs only your `az login`:

```powershell
az login
az account list --query "[].{name:name,id:id}" -o table      # pick a DEVELOPMENT subscription
npm run azure:provision -- --subscription <guid> --preflight-only
```

If the account cannot deploy, the script stops and states which permissions are
missing. You need **Contributor plus Role Based Access Control Administrator** (or
Owner) on a development subscription, or **Contributor on an empty resource group**
with `--resource-group <name>` (add `--skip-role-assignment` if an administrator will
grant the inference role). Then:

```powershell
npm run azure:provision -- --subscription <guid> --list-models     # ranked, with reasons
npm run azure:provision -- --subscription <guid> --what-if         # preview, deploys nothing
npm run azure:provision -- --subscription <guid> --yes             # deploy and write .env
```

When the default ranking has no quota in your subscription, name the region, model and
capacity explicitly. The development deployment in
[Live evidence](#live-evidence) is equivalent to:

```powershell
npm run azure:provision -- --subscription <guid> --regions eastus2 --models gpt-4.1-mini --allow-legacy --capacity 100 --yes
```

`--capacity` is in thousands of tokens per minute (1-100). The ranking reads quota from the
usage API, which returns real figures only after `Microsoft.CognitiveServices` is registered;
the first deployment registers it.

Safety properties, all covered by tests:

- The subscription must be named explicitly; the CLI's default is never used, and
  disabled or production-looking names are refused.
- Nothing is deployed without `--yes`, and a what-if always runs first.
- Model choice comes from the live catalog and quota APIs, not a hard-coded name:
  generally-available chat models only, small non-reasoning models first, nothing
  retiring within 120 days, and quota-aware capacity. Legacy and preview models
  need `--allow-legacy` / `--allow-preview`.
- A resource group that already holds resources this project did not create is
  refused unless you pass `--allow-non-empty-resource-group`.
- `.env` receives only `AI_PROVIDER`, `AI_MODEL`, `AZURE_OPENAI_ENDPOINT` and
  `AZURE_OPENAI_AUTH`, each validated against a strict pattern. No key can be written.
- Azure CLI output is scrubbed of tokens and secret-shaped fields before display.

`npm run azure:teardown -- --subscription <guid> --resource-group <name> --yes`
deletes only what carries the `app=swarm-lab` tag and purges the soft-deleted account so
the name can be reused.

After provisioning, role assignments can take several minutes to propagate. Start
the app, open the provider panel in the header and choose **Verify connection**.
`REAL AZURE AI · connected` is shown only after a real call has succeeded.

## Verifying the live integration

`npm run azure:verify` is the single command that turns "implemented" into
"verified". It talks only to the running app's public HTTP API, reads and writes no
credentials, and exits `0` only if **every** check below passes against the provider
the server is really configured for.

```powershell
npm run dev                  # in one terminal: the app, with AI_PROVIDER=azure and Entra sign-in
npm run azure:verify         # in another: defaults to --expect-provider azure --expect-auth entra
```

It creates one clearly synthetic project (four fictional proxies, three rounds, one
fictional source document that contains a hidden prompt-injection instruction) and
runs the whole journey. Expect on the order of 60 small model calls.

| Check                            | What has to hold                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Server set up for a real model   | Status reports `real-model`, the expected provider and authentication (a keyless Azure setup reports `entra`)       |
| Real round trip                  | `POST /api/provider/check` succeeds against the endpoint; it never falls back to local mode                         |
| Pipeline                         | Graph, proxies, simulation and report all reach `ready`; a failed stage is reported with its recorded error         |
| Real calls recorded              | The project records the expected provider/model and at least one call per proxy, platform and round                 |
| One decision per proxy per round | Both platforms, every round, every proxy: one decision with a stated reason and a 0-1 confidence                    |
| Graph quotes                     | Every node's quote is found verbatim in a passage that node cites                                                   |
| Grounding                        | Verdict counts add up, every source fact has a verified quote, every citation resolves to stored evidence           |
| Independent model check          | The review method is `deterministic+model`, so the second model call really ran                                     |
| Branching                        | A branch inherits the earlier rounds unchanged, re-runs only the later ones, and the comparison declares the change |
| Analyst and actor chat           | Each reply is model-produced, cites only stored passages, and moves the server's provider counters                  |
| Telemetry                        | The server's own round-trip counter is at least the completions recorded on the projects (two independent counts)   |
| Injection probe                  | The hidden token never appears in proxy statements, chat replies or the executive summary                           |
| No credential-shaped text        | No bearer token, JWT, key or connection-string secret in the project, branch, evidence, status, export or replies   |
| Export                           | The Markdown export carries the grounding review and the synthetic-scenario disclaimer                              |

A check that never ran is reported as `SKIP` and can never count as a pass, so the
verdict cannot be reached by omission. The report prints only provider, model name and
authentication mode, never an endpoint, tenant or subscription.

Options: `--base-url`, `--expect-provider azure|openai|ollama`, `--expect-auth
entra|api-key|none`, `--agents 4-10`, `--rounds 3-10`, `--step-timeout-minutes`,
`--no-probe` and `--json`. Exit codes: `0` verified, `1` not verified, `2` usage error.

**If Azure's content filter blocks the probe.** The synthetic source deliberately
contains an "ignore all previous instructions" line. A deployment's content filter may
include prompt-shield (jailbreak) detection and refuse the request, which fails the
stage with `MODEL_REFUSED (flagged: jailbreak)` and a hint. Re-run with `--no-probe` to
test everything else. The injection check is then reported as `SKIP` and the overall
result is `NOT VERIFIED`, on purpose: the platform refusing an input is a real defence,
but it is not evidence that the app's or the model's own handling resisted it.

Observed live: the filter refused this sentence when it was the only text in a short
passage (16 of 16 calls), but did **not** refuse the same sentence inside the scenario
source in any of runs 3-6. Whether the platform intervenes therefore depends on the
surrounding text, which is why the app does not treat it as a control.

Provider errors are classified from the response's short machine codes only. A
`400` is reported as `MODEL_REFUSED` (content filter, with the flagged category
names), `MODEL_PARAMETER_UNSUPPORTED` (with the parameter name, for example a model that
rejects `response_format` or `max_completion_tokens`) or `MODEL_CONTEXT_LIMIT`. The
provider's free-text message is never read or shown, because it can echo prompt text.

What this is and is not:

- The checks were developed against an in-memory stand-in and, end to end through the
  real HTTP stack, against a protocol-faithful **fake** provider (`e2e/model/verify.spec.ts`).
  Those runs prove that the script and the app agree; they are **not** evidence about
  Azure, and running the script against any non-Azure provider prints a note saying so.
  The Azure evidence is the live runs in [Live evidence](#live-evidence).
- One hidden-instruction probe is evidence, not proof, of resistance to prompt
  injection. The quality of a real model's grounding judgements is reported by the
  counts, not assumed good.
- It does not test Entra role propagation delays, quota exhaustion, revoked permissions
  or multi-user behaviour. Those surface as clear failures in the relevant check when
  they happen.

## Migration phases and acceptance criteria

### 1. Validate a real model while still local

Provision a model deployment with the repository scripts (see
[Provisioning the model account](#provisioning-the-model-account-with-this-repository))
or use one you already own that supports Chat Completions and JSON output. Configure
the ignored local `.env`. None of these values is a secret:

- `AI_PROVIDER=azure`
- `AI_MODEL`: the **deployment** name, not just the catalog model name
- `AZURE_OPENAI_ENDPOINT`: resource root or `/openai/v1/` URL
- `AZURE_OPENAI_AUTH=entra` (the default): sign in with `az login`; no key exists

The signed-in identity needs the **Cognitive Services OpenAI User** role on the
resource and the resource needs quota. No key belongs in Git, browser variables, a
chat message or an image. Credentials are required only for actual Azure inference,
never for the rules-based local engine.

Then verify with a real round trip (it makes exactly one tiny model call and never
falls back to local mode): `POST /api/provider/check`, or the **Verify connection**
button in the header's provider panel.

Validate a small four-agent/three-round scenario first. Check actual JSON
compatibility, valid project citations, reported usage, rate-limit errors,
cancellation, model refusals, context budgets and data-region/privacy rules.
Inspect output quality separately from HTTP success. Keep generated claims
conditional; model assistance does not establish predictive accuracy.

### 2. Make persistence and jobs durable

- Implement a PostgreSQL repository with schema migrations and transactional writes.
- Preserve project IDs, per-project source IDs/offsets, settings, execution metadata,
  events and conversation order. JSON export has `schemaVersion: 1`; an importer
  is future work, not an existing restore mechanism.
- Add explicit tenant/user ownership to every project and query. Enforce isolation
  in both application authorization and database access.
- Persist job status, attempt number, cancellation request, lease owner, expiry and
  heartbeat. Use atomic claims, idempotent stage writes and recovery after lease loss.
- A small jobs table with a dedicated worker can be sufficient initially. Introduce
  Service Bus or another queue only when measured concurrency/operating needs demand it.
- Add per-user and global model-call/token/concurrency budgets. Current in-process
  limits are not distributed quotas.

Acceptance: kill/restart the worker and demonstrate an explicit failed/retry or
lease-recovered job, with no duplicate reports, lost records, cross-tenant reads
or “completed” state before result persistence. Verify backup restore.

### 3. Replace model API keys with managed identity

**Implemented, and verified live with a developer's `az` sign-in.** With
`AZURE_OPENAI_AUTH=entra` (the default) the adapter acquires a Microsoft Entra token
for `https://cognitiveservices.azure.com/.default` through `DefaultAzureCredential`
and sends it as `Authorization: Bearer …`. Locally that resolves to your `az login`;
in Azure it resolves to the managed identity (set `AZURE_CLIENT_ID` only for a
user-assigned one). Tokens are cached and refreshed by the SDK, are sent only to an
allow-listed Azure AI host, and never appear in logs, errors or API responses. A
leftover `AZURE_OPENAI_API_KEY` is ignored in Entra mode.

The identity needs the **Cognitive Services OpenAI User** role. A missing role
returns an explicit `MODEL_AUTH` error that names the role.

Acceptance, as demonstrated on 28 Oct 2026: inference succeeded in three verification
runs with no Azure model key anywhere (the account has `disableLocalAuth`, so none can
exist), and no credential-shaped text appeared in project data, replies, exports or in
the debug-level server logs and model traces of those runs (scanned with patterns shown to
detect synthetic samples of a JWT, bearer token, `sk-` key, `api-key` value, account key
and client secret). Still to demonstrate: a managed identity running in hosted Azure,
revoked permissions failing explicitly, and tokens, source passages and provider bodies
being absent from hosted logs. Unit tests cover the header construction, scope, refresh,
error mapping and secret hygiene with a fake credential.

### 4. Build and deploy one authenticated container

1. Run tests, format checks, `npm audit` against the approved registry (0 advisories at
   the last local review, which is not a standing guarantee) and a real Docker smoke test.
2. Publish an image tagged with the source commit and pin its digest for a release.
   Make the corresponding source/build instructions accessible to all remote users.
3. Configure Container Apps managed identity, database access and Entra authentication.
   Do not trust client-supplied identity headers or expose an unauthenticated bypass.
4. Configure exact production `ALLOWED_HOSTS` and `ALLOWED_ORIGINS`, HTTPS ingress,
   and `SOURCE_URL` for the deployed source version. Keep secrets in Key Vault only
   if they cannot be eliminated with managed identity.
5. Set minimum/maximum replicas to one until two instances against one database have
   been validated. Jobs are durable (a restart keeps them and a stopped worker's job is
   taken over after its lease), but scaling to zero stops the embedded job runner, so
   queued work waits; do not use local ephemeral disk as a durability mechanism.
6. Configure startup/liveness/readiness probes. `/api/health/live` fails only when the
   database connection is lost for good and `/api/health/ready` fails while the database
   does not answer; neither charges a model call. The pilot template uses them with the
   `Host` header set, because the app refuses any other host
   ([pilot plan](./azure/pilot-plan.md#what-the-container-is-given)).

Acceptance: authentication and tenant authorization are enforced, browser/API work
over HTTPS, state survives revision changes, a prior image can be rolled back,
and source availability matches the exact deployed version.

### 5. Add retrieval/storage services only with evidence

Compare a representative retrieval evaluation set before adding AI Search. Measure
relevant-passage recall, citation correctness, latency and cost against sparse
TF-IDF. If semantic/vector search is needed, select an embedding deployment and
keep embedding versions/dimensions and citation metadata consistent. Use managed
identity where supported. No embedding model is required by the current MVP.

If original documents become large, add Blob Storage with scoped authorization,
size limits, explicit content types and retention/deletion policies. Text-based PDF
extraction already has an isolated bounded parser; OCR and large original-file
retention need additional implementation.

### 6. Operate with explicit privacy and cost controls

Observe request/job IDs, stage durations, queue depth, cancellation/failure codes,
provider latency and reported token counts. Do not ingest full prompts, documents,
conversation bodies, keys or provider exception bodies into telemetry by default.
Distinguish missing usage reports from genuinely zero token consumption.

Set Azure budgets and alerts, but do not confuse budget alerts with a hard spending
cap. Keep application-level quotas and concurrency enforcement. Document retention,
user deletion, backups, incident response and rollback ownership.

## What is intentionally not deployed

Only the model account exists in Azure: one resource group (`rg-swarm-dev`) holding one
Foundry account and one deployment in a development subscription. No application
hosting, public endpoint, cloud database, Key Vault, Entra application registration,
semantic index, Blob upload pipeline, distributed worker or Application Insights has
been created. The Entra inference path, the Bicep and the verification script have run
against that account (see [Live evidence](#live-evidence)), but never under a managed
identity in hosted Azure.
Those are explicit migration tasks with acceptance criteria, not hidden dependencies
of a working local app. A template for the hosted pilot now exists (see
[Hosted pilot: plan and cost](#hosted-pilot-plan-and-cost-not-deployed)), but it has only
been compiled and linted: no part of it has been deployed.

## Provider contract references

- [Azure OpenAI / Foundry v1 Chat REST reference](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat):
  documents `/openai/v1/chat/completions` and API-key authentication using `api-key`.
- [Switching OpenAI and Azure OpenAI endpoints](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/switching-endpoints):
  explains the v1 base URL, deployment-name model parameter and identity migration.

These verify the adapter's intended protocol; they do not replace live credential,
quota, model-compatibility and output-quality validation.
