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
Keep one replica until storage and job ownership have been externalized. Require
Entra authentication before internet exposure.

For durable hosting, migrate the repository to a small managed PostgreSQL database
and add durable job/lease ownership before deployment. That is an additional
database service, not a claim that SQLite can safely scale on a network share.
The current encapsulated repository is the replacement boundary; extract an
interface when implementing the second adapter rather than inventing one early.

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

## Azure AI integration: what exists and what is verified

| Capability                                                 | Implemented | Verified how                                                                                                        |
| ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Entra ID token auth (`DefaultAzureCredential`), no key     | Yes         | Unit tests with a fake credential, plus one live token acquisition (see below). **Not** yet used against a resource |
| Host allow-list; bearer token never sent elsewhere         | Yes         | Unit tests                                                                                                          |
| Actionable errors: `MODEL_AUTH`/`NOT_FOUND`/`RATE_LIMIT`   | Yes         | Unit tests with a fake HTTP server                                                                                  |
| Bounded structured-output repair loop                      | Yes         | Unit + integration tests with scripted replies                                                                      |
| Provider status/telemetry API and UI badge                 | Yes         | Unit tests, browser audit                                                                                           |
| One real model call per proxy, platform and round          | Yes         | Integration tests and e2e against a **fake** provider                                                               |
| Grounding review (quotes, support verdicts, contradiction) | Yes         | Unit and integration tests against a **fake** provider                                                              |
| Bicep for an Entra-only Foundry account + deployment       | Yes         | `bicep build` and lint; **never deployed**                                                                          |
| Provisioning/teardown scripts with safety gates            | Yes         | Unit tests with a fake Azure CLI; read-only preflight against Azure                                                 |
| One-command live verification (`npm run azure:verify`)     | Yes         | Unit/flow tests and a Playwright run against a **fake** provider                                                    |
| Live Azure model calls, live E2E, live prompt-injection    | **No**      | Blocked: needs a subscription or resource group you can deploy to                                                   |

Nothing in this repository claims live Azure verification. The only live Azure
evidence is:

- the read-only permission checks, which found that the signed-in account has no
  permission to create a resource group, an AI account, a deployment or a role assignment
  in any of the 83 visible subscriptions (re-checked on 27 Oct 2026, with no errors); and
- one real Microsoft Entra token, acquired through the app's own token provider
  (`DefaultAzureCredential`, here via the `az` sign-in) for the Cognitive Services scope.
  Its audience was `https://cognitiveservices.azure.com` and it was valid for about
  64 minutes. The first acquisition took about 16 s (a cold start) and later ones about
  3 s. This shows the sign-in works for the account; **no resource has accepted a token
  yet**, because no resource exists.

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

Provider errors are classified from the response's short machine codes only. A
`400` is reported as `MODEL_REFUSED` (content filter, with the flagged category
names), `MODEL_PARAMETER_UNSUPPORTED` (with the parameter name, for example a model that
rejects `response_format` or `max_completion_tokens`) or `MODEL_CONTEXT_LIMIT`. The
provider's free-text message is never read or shown, because it can echo prompt text.

What this is and is not:

- It was developed and tested against an in-memory stand-in, and end-to-end through
  the real HTTP stack against a protocol-faithful **fake** provider (`e2e/model/verify.spec.ts`).
  That proves the script and the app agree; it is **not** evidence about Azure, and
  running it against any non-Azure provider prints a note saying so.
- One hidden-instruction probe is evidence, not proof, of resistance to prompt
  injection. The quality of a real model's grounding judgements is reported by the
  counts, not assumed good.
- It does not test Entra role propagation delays, quota exhaustion or multi-user
  behaviour. Those surface as clear failures in the relevant check when they happen.

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

**Implemented in the adapter, not yet verified against a live resource.** With
`AZURE_OPENAI_AUTH=entra` (the default) the adapter acquires a Microsoft Entra token
for `https://cognitiveservices.azure.com/.default` through `DefaultAzureCredential`
and sends it as `Authorization: Bearer …`. Locally that resolves to your `az login`;
in Azure it resolves to the managed identity (set `AZURE_CLIENT_ID` only for a
user-assigned one). Tokens are cached and refreshed by the SDK, are sent only to an
allow-listed Azure AI host, and never appear in logs, errors or API responses. A
leftover `AZURE_OPENAI_API_KEY` is ignored in Entra mode.

The identity needs the **Cognitive Services OpenAI User** role. A missing role
returns an explicit `MODEL_AUTH` error that names the role.

Acceptance (still to be demonstrated live): inference succeeds without any Azure
model key in environment or image; revoked permissions fail explicitly; tokens,
source passages and provider bodies are absent from logs. Unit tests cover the header
construction, scope, refresh, error mapping and secret hygiene with a fake
credential; they are not evidence of a real Entra exchange.

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
5. Set minimum/maximum replicas to one while job coordination remains single-worker.
   Do not scale to zero with active in-memory jobs; do not use local ephemeral disk
   as a durability mechanism. Scale only after durable job ownership is working.
6. Configure startup/liveness/readiness probes. Current `/api/health` verifies local
   API/storage/queue readiness; add database/worker readiness semantics for the new
   deployment, without charging a model call for every health probe.

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

No Azure subscription resources, public application endpoint, cloud database,
Entra application registration, semantic index, Blob upload pipeline or distributed
worker has been created by this milestone. The Entra inference path and the Bicep
exist in the repository but have not been exercised against a live resource.
Those are explicit migration tasks with acceptance criteria, not hidden dependencies
of a working local app.

## Provider contract references

- [Azure OpenAI / Foundry v1 Chat REST reference](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat):
  documents `/openai/v1/chat/completions` and API-key authentication using `api-key`.
- [Switching OpenAI and Azure OpenAI endpoints](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/switching-endpoints):
  explains the v1 base URL, deployment-name model parameter and identity migration.

These verify the adapter's intended protocol; they do not replace live credential,
quota, model-compatibility and output-quality validation.
