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

## Migration phases and acceptance criteria

### 1. Validate a real model while still local

Create or select a suitable Azure model deployment supporting Chat Completions
and JSON output. Configure the ignored local `.env`:

- `AI_PROVIDER=azure`
- `AI_MODEL`: deployment name, not just the catalog model name
- `AZURE_OPENAI_ENDPOINT`: resource root or `/openai/v1/` URL
- `AZURE_OPENAI_API_KEY`: configured privately in the environment

No key belongs in Git, browser variables, a chat message, or an image.
The service account/resource must permit inference and have quota. This credential
is required only for actual Azure inference, not the rules-based local engine.

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

Add an Azure identity token provider to the model adapter. Use the appropriate
Azure model resource audience/scope and inference role for the deployed endpoint.
For Azure OpenAI this normally includes the **Cognitive Services OpenAI User**
role; verify requirements for the specific Foundry/resource API being selected.

Do not simply place a managed-identity name in the API-key field: the current
local Azure adapter uses an `api-key` header. Production identity authentication
requires an implemented token acquisition/refresh path and `Authorization` header.

Acceptance: inference succeeds without any Azure model key in environment or image;
revoked permissions fail explicitly; tokens, source passages and provider bodies
are absent from logs.

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
Entra application registration, managed-identity inference path, semantic index,
Blob upload pipeline or distributed worker has been created by this milestone.
Those are explicit migration tasks with acceptance criteria, not hidden dependencies
of a working local app.

## Provider contract references

- [Azure OpenAI / Foundry v1 Chat REST reference](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat):
  documents `/openai/v1/chat/completions` and API-key authentication using `api-key`.
- [Switching OpenAI and Azure OpenAI endpoints](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/switching-endpoints):
  explains the v1 base URL, deployment-name model parameter and identity migration.

These verify the adapter's intended protocol; they do not replace live credential,
quota, model-compatibility and output-quality validation.
