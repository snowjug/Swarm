# Production runbook: the controlled pilot

> **Status: written from the design. No incident has been handled with it, no rollback drill has been run, and no
> database restore has been rehearsed.** Every command below is `az` or SQL as documented, not as observed: nothing
> here has touched Azure. Treat each **UNVERIFIED** as an instruction to check before relying on it.

This page is for the people who own and operate the hosted pilot ([azure-preflight.md](./azure-preflight.md) says what it
is and what it costs; [release-process.md](./release-process.md) says how versions move). For a specific failure (an API
error code, stuck jobs, the model provider failing, missing telemetry) the existing
[operations runbook](../operations/runbook.md) has the detail; this page is the layer above it: who decides, what to
do in the first fifteen minutes, how to stop, how to go back, and how to get data back.

## Contents

- [Duties](#duties)
- [The first fifteen minutes](#the-first-fifteen-minutes)
- [Roll back a release](#roll-back-a-release)
- [Emergency stop](#emergency-stop)
- [Restore the database to a new server](#restore-the-database-to-a-new-server)
- [Database roles: what the application needs, and what it does not yet allow](#database-roles-what-the-application-needs-and-what-it-does-not-yet-allow)
- [Secrets in Key Vault](#secrets-in-key-vault)
- [Reusing an existing PostgreSQL server](#reusing-an-existing-postgresql-server)
- [The model: verify the connection, and read what fails](#the-model-verify-the-connection-and-read-what-fails)
- [Switch on the model by default, and question-only research](#switch-on-the-model-by-default-and-question-only-research)
- [Deactivate the placeholder revision](#deactivate-the-placeholder-revision)
- [After an incident](#after-an-incident)

## Duties

| Who                  | Duty                                                                                                                                                                                                                                                                                                                                               | How often                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Owner**            | Holds the subscription. Reads the credit and the spending limit ([azure-preflight.md](./azure-preflight.md#what-could-not-be-read)). Decides every "stop if" ([thresholds S1–S7](./azure-preflight.md#pilot-budget-strategy-and-stop-if-thresholds)). Receives the alert e-mail (`SWARM_ALERT_EMAIL`). Provisions and releases (no pipeline does). | Before the first deploy; weekly while it runs |
| **Owner**            | Runs the **rollback drill** and the **restore drill** before any real data, and again after a change to ingress, revisions, probes or the database. Keeps the records.                                                                                                                                                                             | Before real data; after changes               |
| **Operator**         | Watches the dashboard and the alerts ([observability.md](./observability.md)); acts on the first fifteen minutes below; escalates to the owner on anything in the [escalation list](#escalate-to-the-owner-at-once).                                                                                                                               | Daily while a pilot is running                |
| **Operator**         | Keeps one release record per release, **outside the machine it was made on** (`.azure/releases/` is git-ignored and local).                                                                                                                                                                                                                        | Every release                                 |
| **Operator**         | `finalize`s the previous revision after the warm window, so that two job runners are not left running ([release-process.md](./release-process.md#two-revisions-two-job-runners)).                                                                                                                                                                  | After every release                           |
| **Security contact** | Receives anything that looks like a disclosure, wrong-tenant data, or a leaked credential. These are incidents of their own: [stop](#emergency-stop), preserve the audit log, escalate.                                                                                                                                                            | On suspicion                                  |

There is no on-call rota, no paging integration and no service-level objective with a commitment behind it. The alerts
e-mail one address. That is the honest extent of the operations here.

## The first fifteen minutes

1. **Is it up?** `GET https://<address>/api/health/live` and `/api/health/ready` (no sign-in needed). Live but not ready:
   the database. Neither: the container. A person's browser is not evidence; this is.
2. **What changed?** The last release record (`.azure/releases/`), then
   `npm run azure:release -- status --subscription <guid> --resource-group <group> --app <app>` (read-only: revisions,
   who serves, replicas, the latest record).
3. **Is it the release?** If the trouble started within the warm window of a release and the previous revision is still
   running: [roll back](#roll-back-a-release). That is the cheapest, fastest action available and the one the drill rehearses.
4. **Is it the database?** [Operations runbook: database down or not ready](../operations/runbook.md#database-down-or-not-ready).
   If data is damaged or lost: [restore](#restore-the-database-to-a-new-server) (do not restore over the original).
5. **Is it money?** A budget e-mail, the token alert, or `model.budget.exhausted` in bulk: [emergency stop](#emergency-stop),
   tier 3 first. The budget **never stops anything**.
6. **Is a person's data at risk?** Suspected disclosure, wrong-tenant data or a leaked credential: tier 1 of the
   emergency stop at once; preserve the audit log (`GET /api/projects/:id/audit`, `GET /api/audit/verify`); escalate.
7. **Write down** what you saw and what you did, in order, with times. Quote the `x-request-id` of a failed request. Never
   paste a token, a connection string or a document into a ticket.

### Escalate to the owner at once

- Any "stop if" threshold ([S1–S7](./azure-preflight.md#pilot-budget-strategy-and-stop-if-thresholds)) is met.
- A rollback did not work, or the revision it returned to is not healthy either (`azure:release rollback` exits 1).
- Database restore is needed.
- Anything in step 6.
- Azure refuses an action in this page: the claim about it is **UNVERIFIED**, and the owner decides the substitute.

## Roll back a release

The commands, the warm and cold cases and the raw-`az` fallback are in
[release-process.md → Rolling back](./release-process.md#rolling-back). In one line:

```bash
npm run azure:release -- rollback --subscription <guid> --resource-group <group> --app <app> \
  --execute --confirm-resource-group <group>          # dry run: omit the last two flags
```

**Do not tell anyone rollback works until the [drill](./release-process.md#the-rollback-drill) has been run and its record
kept.** If the release carried a database migration, read [Database schema changes](./release-process.md#database-schema-changes)
before rolling back: the previous image may refuse to _restart_ against the newer schema.

## Emergency stop

Three tiers, from "keep the app, close the door" to "turn it off". All are **UNVERIFIED** against a live app; each is
reversible except deleting things. [Thresholds S1–S7](./azure-preflight.md#pilot-budget-strategy-and-stop-if-thresholds)
say _when_; the ladder in that page says what is cheapest to stop.

| Tier | Goal                                                                           | Command (placeholders in `<>`)                                                                                                                                                                                                                    | Undo                                                                                                                          |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1    | Nobody but the operator can reach the app                                      | `az containerapp ingress access-restriction set --name <app> --resource-group <group> --subscription <guid> --rule-name operator-only --ip-address <operator public IP>/32 --action Allow`                                                        | `az containerapp ingress access-restriction remove … --rule-name operator-only`, or redeploy with `ingressAllowedCidrs` empty |
| 2    | The app does nothing, **including the job runner** (which can spend on models) | `az containerapp revision deactivate --name <app> --resource-group <group> --subscription <guid> --revision <each active revision>`. If Azure refuses because the revision has traffic, do tier 1 first, then `az containerapp ingress disable …` | `az containerapp revision activate …` then restore traffic (`azure:release rollback --to <revision>`)                         |
| 3    | The app cannot spend on models, whatever it does                               | `az role assignment delete --assignee <app identity principal id> --role "Cognitive Services OpenAI User" --scope <AI account resource id>`                                                                                                       | `az role assignment create …` with the same arguments, or redeploy `infra/pilot` (it owns the assignment)                     |

Also available, and in [azure-preflight.md](./azure-preflight.md#pilot-budget-strategy-and-stop-if-thresholds): lower the
per-project model limits to 1 (`projectModelCallLimit`, `projectModelTokenLimit`) and redeploy; stop the database
(`az postgres flexible-server stop`); deallocate the dev VM; delete the resource group.

Tier 3 makes model calls fail with an authorization error (`swarm.model.calls` outcome `failed`, the model-failures alert
fires); what the application does then is whatever it does when a model is unavailable, which is **not drilled**.

## Restore the database to a new server

**Never restore over the damaged server.** Azure's point-in-time restore (PITR) always creates a **new** server; the
original stays untouched until a person deletes it, which is what makes this safe to try and what makes it cost money
until it is cleaned up.

> **UNVERIFIED, all of it.** Nothing in this section has been run. Not the commands, not the time they take, not how
> much data a restore loses, not which settings the new server inherits. The pilot's database is tiny and has no real
> data yet; **do the drill below before that changes.**

**Facts to start from.**

- Retention is the Bicep parameter `backupRetentionDays` (default **7**, range 7–35 on this service). Backups are
  `Disabled` for geo-redundancy in the pilot profile and `Enabled` in the production-shaped one
  ([`production-shaped.bicepparam`](../../infra/pilot/production-shaped.bicepparam)). Without geo-redundancy a **region**
  loss loses the backups with the server.
- The restore point must be within retention and not earlier than the server's earliest restore point:
  `az postgres flexible-server show --resource-group <group> --name <server> --query "backup.earliestRestoreDate"`.
- A release that carried a migration records its **restore point** (a UTC time just before it started) in
  `migrations.restorePointUtc` of the release record. Restoring to that point returns to the schema before the migration.
- The recovery point objective is therefore "everything written after the restore point is lost", and the recovery time
  objective is "however long Azure takes plus the cut-over": **both unmeasured**.

**Steps.**

1. **Stop the writes** that would be lost or that would make a mess: [emergency stop](#emergency-stop) tier 1 (so only the
   operator reaches the app) if the data is wrong; skip it if the restore is a rehearsal.
2. **Choose the restore time (UTC)**: just before the damage, or `restorePointUtc`. Write it down.
3. **Restore into a new server** (a name that says why: `<server>-restore-<yyyymmdd>`):

   ```bash
   az postgres flexible-server restore --subscription <guid> --resource-group <group> \
     --name <new server> --source-server <server> --restore-time "<2026-11-10T09:30:00+00:00>"
   # a server on private networking needs the network arguments of the original: --vnet --subnet --private-dns-zone
   ```

4. **Check what the new server did and did not inherit** (do not assume): compute tier and storage; that
   `require_secure_transport` is `ON` (`az postgres flexible-server parameter show … --name require_secure_transport`);
   **Microsoft Entra authentication enabled and the Entra administrator present** (`az postgres flexible-server microsoft-entra-admin list --resource-group <group> --server-name <new server>`
   — if empty, add the same administrators the original has: `az postgres flexible-server microsoft-entra-admin create …`, as in
   [pilot-plan.md](../azure/pilot-plan.md#the-database)); network
   access and firewall rules (public rules are **UNVERIFIED** to carry over: add the verifier's address, or use the private
   network). The database **role of the application identity** is a role inside the database and comes with the data
   (**UNVERIFIED**); the Entra administrator is server configuration and may not.
5. **Verify the data before anything points at it.** Connect as the Entra administrator (the token is the password:
   `PGPASSWORD=$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)`) and run, read-only:

   ```sql
   SELECT version FROM swarm_schema WHERE id = 1;        -- must equal the schema version you expect (see below)
   SELECT 'projects' AS t, count(*) FROM projects UNION ALL
   SELECT 'chunks', count(*) FROM chunks UNION ALL      SELECT 'events', count(*) FROM events UNION ALL
   SELECT 'messages', count(*) FROM messages UNION ALL  SELECT 'claim_records', count(*) FROM claim_records UNION ALL
   SELECT 'audit_events', count(*) FROM audit_events UNION ALL SELECT 'jobs', count(*) FROM jobs UNION ALL
   SELECT 'sessions', count(*) FROM sessions UNION ALL  SELECT 'workspace_members', count(*) FROM workspace_members UNION ALL
   SELECT 'project_members', count(*) FROM project_members UNION ALL SELECT 'project_usage', count(*) FROM project_usage UNION ALL
   SELECT 'project_artifacts', count(*) FROM project_artifacts UNION ALL SELECT 'studio_documents', count(*) FROM studio_documents;
   ```

   - The schema version is the **`migrations.schemaVersionBefore`** of the release that damaged things if you restored to
     before it, or `schemaVersionAfter` of the last good release otherwise. The application **refuses a database newer
     than its build** (`STORAGE_VERSION`), so a restore to a point before a migration needs the **previous image** to run
     against it, not the new one.
   - Compare the counts with the last numbers you trust (an earlier run of this query, a dashboard, the damaged server if
     it is still readable). The difference is the data-loss window; write it down.
   - Optionally, on a machine with the repository: `npm run db:drill -- --from <connection string for the restored
server>` backs the restored database up and proves the copy is exact by digest of every table, that the audit chain
     verifies and that every project opens as the application opens it (it needs the database to be at this release's
     schema version, and only reads it). It is the existing, tested logical check; **it has never been pointed at a hosted
     server**, and it does not prove the server's configuration.

6. **Cut over.** The application reaches its database through `DATABASE_URL`
   (`postgres://<identity name>@<host>:5432/<database>?sslmode=require`; no password: the identity gets a token). Point a
   **new revision** at the restored server, prove it dark, then shift, exactly as a release does but with a changed
   environment variable instead of a changed image:

   ```bash
   az containerapp update --subscription <guid> --resource-group <group> --name <app> \
     --revision-suffix cutover<yymmddhhmm> \
     --set-env-vars "DATABASE_URL=postgres://<identity name>@<restored server host>:5432/<database>?sslmode=require"
   # wait until the revision runs; GET https://<that revision's address>/api/health/ready must say database ok;
   az containerapp ingress traffic set … --revision-weight <cutover revision>=100 <previous revision>=0
   npx tsx scripts/azure/pilot-smoke.ts https://<address>      # then: GET /api/audit/verify as a platform administrator
   ```

   (If `azure:release` has traffic pinned and the previous revision is warm, this is a release whose "change" is the
   server: the same checks apply. The release tool does not drive it yet.) **Then make the template agree**: set
   `SWARM_EXISTING_POSTGRES_SERVER_ID` (the `existingPostgresServerResourceId` parameter) to the restored server before the
   next deployment, otherwise a redeploy points the app back at the old one.

7. **Afterwards.** Keep the damaged server (stopped) for evidence for a stated time, then delete it, because it is billed
   ([azure-preflight.md](./azure-preflight.md#unit-prices)). Record: restore time chosen, how long the restore took, the
   data-loss window, what had to be fixed by hand, and who decided.

**The restore drill** (do this before real data; it costs a few cents):

1. Restore the pilot server to a point about an hour ago into `<server>-restoretest` (step 3).
2. Steps 4 and 5. **Pass:** the restore completes; the schema version matches; the counts equal the live counts less the
   writes since; `npm run db:drill` is exact; you can say, from this page and from the Azure messages alone, what you
   had to do to the new server for the application to use it.
3. Optional and cheap: step 6 up to the readiness check on the revision's own address at 0% traffic (database `ok`), then
   deactivate that revision. This proves the identity can reach the restored server.
4. **Delete `<server>-restoretest`** and record the time, the duration, and every surprise in the drill log below.

| Date (UTC)  | Restore time chosen | Restore took | Data-loss window | Surprises | Record kept at |
| ----------- | ------------------- | ------------ | ---------------- | --------- | -------------- |
| _never run_ |                     |              |                  |           |                |

## Database roles: what the application needs, and what it does not yet allow

**Finding from reading the code, not from a server.** The application migrates its own schema **at startup, with its own
connection**, and it also runs `CREATE TABLE IF NOT EXISTS swarm_schema (…)` on **every** start
(`readSchemaVersion` in `backend/src/storage/migrations.ts`). PostgreSQL checks the `CREATE` privilege on the schema
before it looks at `IF NOT EXISTS` (**UNVERIFIED**: confirm against a real server with a restricted role). So today:

- The application's database role must be able to create objects in the schema. **It is not least-privilege**, and a
  data-only (DML) role is **not** enough to start it, even when no migration is pending.
- **Worse than "can create objects": when the template creates the server, the application identity IS the server's
  Microsoft Entra administrator** (`administrators` child resource, `azure_pg_admin`), because it creates and migrates its
  own tables. It can therefore do anything inside the server: read every database on it, create roles and extensions. An
  optional **break-glass** administrator group (`breakGlassAdminGroupObjectId`) is a second administrator, for a person.
- **Separating a migration identity from a runtime identity needs an application change** (a migrate command run with
  the administrator identity; a runtime that only verifies the schema version and does not run DDL), and then a template
  change to stop making the runtime identity an administrator. Neither is done. The application half belongs with the
  database guidance in [database.md](./database.md#10-the-database-role).
- What infra _does_ provide: the application authenticates as a **user-assigned managed identity** that is mapped to a
  database role through Microsoft Entra (**no password exists**: `DATABASE_AUTH=entra`, `require_secure_transport=ON`);
  an optional break-glass group; and, for a server it did not create, **no administrator right at all** for the identity
  (see [existing server](#reusing-an-existing-postgresql-server)).

**Intended end state (not implemented, not tested; for the person who does the application change).** Two Entra
principals: a _migration_ identity (owns the schema objects; used only by a release step) and a _runtime_ identity:

```sql
-- as the Entra administrator, connected to the application's database
SELECT * FROM pgaadauth_create_principal('<runtime identity name>', false, false);
GRANT CONNECT ON DATABASE <database> TO "<runtime identity name>";
GRANT USAGE ON SCHEMA public TO "<runtime identity name>";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "<runtime identity name>";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "<runtime identity name>";
ALTER DEFAULT PRIVILEGES FOR ROLE "<migration identity name>" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "<runtime identity name>";
```

The grants were **not derived from the migrations and have not been run**: the application also takes
`pg_advisory_lock`, writes `swarm_schema`, and may need more (or less) than this. Until the application change exists,
the truthful statement is: **the runtime identity can change the schema, and on a server this template creates it is the
server's administrator**.

## Secrets in Key Vault

The pilot needs **no secret** by default: Entra sign-in uses the managed identity as its client assertion
(`AUTH_ENTRA_CLIENT_ASSERTION=managed-identity`), the database and the model use tokens. A secret appears only if the
sign-in client must be a confidential client with a **client secret** (`AUTH_ENTRA_CLIENT_SECRET`), which the
application treats as mutually exclusive with the assertion. For that case the template has an opt-in Key Vault
(`enableKeyVault`, or an existing one through `existingKeyVaultResourceId`): RBAC authorization, soft delete, **purge
protection**, the app identity holding **Key Vault Secrets User** only, no secret created by any template, and the
app's setting a **reference** to the vault secret.

1. Deploy with a reference declared in `SWARM_KEYVAULT_SECRET_REFERENCES` (parameter `keyVaultSecretReferences`; declaring
   one turns the vault on, as do `enableKeyVault=true` and `SWARM_EXISTING_KEYVAULT_ID`), for example
   `[{"envName":"AUTH_ENTRA_CLIENT_SECRET","secretName":"auth-entra-client-secret"}]`. The parameter holds names, never a value.
2. **A person puts the value in** (the owner needs a data-plane role such as _Key Vault Secrets Officer_; the template
   gives nobody one): `az keyvault secret set --vault-name <vault> --name auth-entra-client-secret --file <path>`.
   Do not put the value on a command line, in a template, in a ticket, or in a release record (the record redacts
   secret-shaped values by name and shape, and holds a secret reference by name only).
3. Create a new revision so that it resolves the reference (a release, or a `containerapp update` with a new suffix).
4. **Rotation** is: set a new secret version, create a new revision, confirm sign-in, retire the old revision. Container
   Apps resolves a Key Vault reference **when a replica starts**, so a changed secret is picked up only by a new revision
   (**UNVERIFIED**).

## Reusing an existing PostgreSQL server

When the pilot uses a server it did not create (`existingPostgresServerResourceId`), the template creates **only the
database** on it and nothing else; it does not change the server's administrators, network, parameters or backups. So:

1. An **administrator of that server** adds the application identity as a database principal. In the database:
   `SELECT * FROM pgaadauth_create_principal('<identity name>', false, false);` where the identity name is the deployment
   output `AZURE_USER_ASSIGNED_IDENTITY_NAME`.
2. Grant it what the application needs ([above](#database-roles-what-the-application-needs-and-what-it-does-not-yet-allow):
   today that includes the right to create objects in the schema, and the exact grants have not been derived or tested).
3. Confirm Entra authentication is enabled on the server and `require_secure_transport` is `ON`; the template cannot
   assert either on a server it does not own.
4. The existing server's **backup retention is whatever it has**. The `backupRetentionDays` parameter does not apply to it.

## The model: verify the connection, and read what fails

Who may check: a workspace **owner or admin**, or a **platform administrator** (`Swarm.PlatformAdmin`); the first person a
pilot signs in is the workspace owner, so they can. In the app: the engine chip at the right of the top bar, then
**Verify connection**. It sends one small request to each deployment a task could be routed to (one, for the pilot) and the
chip reads **connected** only after it succeeds. The chip describes the **server**; the mark beside it, and the head of the
Ground screen, say which engine the **project** uses: a project made on rules never calls the model whatever the chip says.

Before the click, and when it fails, read the four things it depends on (all read-only):

```bash
az cognitiveservices account show -g <group> -n <account> --query "{state:properties.provisioningState,localAuthDisabled:properties.disableLocalAuth}" -o json
az cognitiveservices account deployment list -g <group> -n <account> --query "[].{name:name,model:properties.model.name,sku:sku.name,state:properties.provisioningState}" -o table
az containerapp show -g <group> -n <app> --query "properties.template.containers[0].env[?name=='AI_PROVIDER'||name=='AI_MODEL'||name=='FOUNDRY_ENDPOINT'||name=='FOUNDRY_AUTH'||name=='AZURE_CLIENT_ID']" -o table
PRINCIPAL=$(az identity show -g <group> -n <identity> --query principalId -o tsv)
az role assignment list --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal --all --query "[].{role:roleDefinitionName,scope:scope}" -o table
```

Expected: the account `Succeeded` with local authentication disabled; the deployment named by `AI_MODEL` `Succeeded`;
`AZURE_CLIENT_ID` equal to the identity's client ID; **Cognitive Services OpenAI User** on the account. The failure texts
and what each means are in [the pilot plan](../azure/pilot-plan.md#verify-the-model-connection-the-owners-click). The
server logs the code of a failed call (`MODEL_AUTH`, `MODEL_NOT_FOUND`, `MODEL_RATE_LIMIT`, …) and never a prompt, a
completion or a token:

```kusto
ContainerAppConsoleLogs_CL | where ContainerAppName_s == '<app>' and Log_s has 'MODEL_' | project TimeGenerated, Log_s | order by TimeGenerated desc | take 50
```

## Switch on the model by default, and question-only research

Both are settings of the template, applied with the image **named** so that `what-if` is concrete
([the plan](../azure/pilot-plan.md#putting-the-probes-on-the-running-app)): `SWARM_DEFAULT_ENGINE=model` preselects the model
for a new question (it is still shown, and changeable, on the question's card), and `SWARM_RESEARCH_SEARCH_PROVIDER=wikipedia`
(no key) or `brave` (a key in Key Vault, [above](#secrets-in-key-vault)) lets a question that names no site find pages. Either
sends the names and topics of a question to a third party, so it is the owner's decision.

## Deactivate the placeholder revision

The first deployment leaves the placeholder revision **active** at 0% traffic, which costs compute. After the real revision
serves 100%: `az containerapp revision list -g <group> -n <app> -o table`, then
`az containerapp revision deactivate -g <group> -n <app> --revision <placeholder revision>`. Never deactivate the revision
that has traffic.

## After an incident

Write down the timeline, the cause, what detected it and how long that took, what fixed it, what it cost, and what would
have prevented it. Update this page, [the operations runbook](../operations/runbook.md), and the alert that should have
fired. Add the drill or test that would have caught it to [LIMITATIONS.md](./LIMITATIONS.md) if it does not exist.
