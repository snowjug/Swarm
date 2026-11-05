# Hosted pilot on Azure: cost

> **What exists now is priced in [What exists now](#what-exists-now-5-november-2026)**: the pilot as it runs in Central
> India (a General Purpose database, a placeholder revision still active), in rupees, from the Retail Prices API read on
> 5 November 2026. **It is about INR 20,900 a month at list prices, about twice the INR 11,000 credit.** The rest of this page is the
> plan's original estimate (a Burstable database, East US 2, US dollars) and is kept as it was written.

> **An estimate, not a quote, and nothing has been created.** It prices the resources that
> [`infra/pilot`](../../infra/pilot/main.bicep) would create (see [pilot-plan.md](./pilot-plan.md)) at **public list
> prices** read from the Azure Retail Prices API on **30 October 2026**, in US dollars, pay-as-you-go, for a month of
> **730 hours**. An enterprise agreement, a different region or another date will change the figures. The last
> section, [Approval request](#approval-request), is what a budget owner is asked to approve.

> **Superseded in part.** [azure-preflight.md](../production/azure-preflight.md) re-reads the prices on **3 November 2026**
> for Central India and East US 2, in US dollars and rupees, and adds what this page does not price: the alert rules
> (nine log rules, nine metric alerts), the budget, Key Vault, the NAT gateway and private networking, the
> production-shaped profile, the development VM and the model line, with the arithmetic and the "stop if" thresholds. Where
> the two differ, read that page. The template **no longer allows `minReplicas = 0`**, so every line below that
> describes scaling to zero describes something the template refuses.

## What exists now (5 November 2026)

Priced from what the live resource group holds, which was **read, not changed**, and from **list prices read from the
Retail Prices API on 5 November 2026** (`currencyCode=INR`, `armRegionName=centralindia`, pay-as-you-go, a month of 730
hours). It is not a quote or an invoice: an enterprise agreement, a credit's own rules or a price change will differ, and
**no resource was created to produce it**. The credit is taken as **about INR 11,000**, as you said.

| What exists                                                                                                  | List price used                                                                                | Per month (INR)                                      |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| PostgreSQL flexible server, **General Purpose D2ds_v4** (2 vCores), 32 GiB, 7-day backups, no HA             | 11.9036 per vCore-hour × 2 × 730; storage 12.4750 per GiB-month × 32                           | **17,778** (compute 17,379, storage 399)             |
| Container app, **two active revisions** × 0.5 vCPU / 1 GiB, one replica each, mostly idle                    | 0.000286 per vCPU-second and per GiB-second idle; the monthly free grant (180,000 and 360,000) | **2,100** (2,255 without the free grant)             |
| Container Registry, Basic                                                                                    | 15.865 per day                                                                                 | 482                                                  |
| Alert rules: 8 enabled log rules (15 min), 8 metric rules (3 at 1 min, 4 at 5 min, 1 at 15 min)              | 47.614, 28.569, 14.284, 4.761 per rule-month                                                   | at most 529 (Azure may allow some free)              |
| Log Analytics, 30 days, capped at 0.5 GB a day (Application Insights is workspace-based and ingests into it) | 306.637 per GB after 5 GB free a month                                                         | about 0 so far (0.001 GB measured); 3,128 at the cap |
| Foundry `gpt-5-mini`, Global Standard (usage only)                                                           | 23.807 in, 2.381 cached in, 190.458 out per million tokens                                     | 0 unused; about 57 to 190 per million tokens         |
| Budget, action group, managed identity, Entra, Container Apps environment (Consumption profile only)         | no charge                                                                                      | 0                                                    |
| **The pilot as it runs**                                                                                     |                                                                                                | **about 20,890**                                     |
| The same after the placeholder revision is deactivated                                                       | one replica instead of two                                                                     | about 19,762                                         |
| The same with Burstable B1ms, if it could be had                                                             | 2.3331 per hour × 730 + storage 399                                                            | about 4,087                                          |
| The development VM (not in the pilot group), D4as_v5, running all month, with its 128 GiB Premium SSD        | 10.5704 per hour × 730; the disk 1,876.96 a month                                              | 9,593 (7,716 is compute, which stopping removes)     |
| **The pilot and the VM**                                                                                     |                                                                                                | **about 30,480**                                     |

**What this means for the credit.** At these prices the pilot alone spends about INR 690 a day, so INR 11,000 lasts about
**16 days**; with the VM running as well, about **11 days**. If the credit is monthly, the pilot costs about 1.9 times it, and
with the VM about 2.8 times. The template's budget is INR 4,500 a month and **only notifies** (at 50%, 80% and 100% of actual
spend and at a forecast of 100%): it does not stop anything, and it will fire. On a subscription with a spending limit,
when the credit is gone Azure disables the resources until the next billing period: do not let a demonstration run into that.

**Where it comes from.** The database is 85% of the pilot. Burstable (B1ms, B2s) was refused in Central India for this
subscription, and the next size down that was accepted is the smallest General Purpose (2 vCores). The placeholder revision
(0% of traffic, still running) is a second replica billed like the first. Model usage is the small part: a project is held to
4,000,000 tokens (`PROJECT_MODEL_TOKEN_LIMIT`), which is at most about INR 230 to 760 of `gpt-5-mini` however it is spent
(mostly input about 230, a heavy share of reasoning output more; all output 760), and nothing at all while nobody asks.

**What can be done, none of it done.** Each changes a live resource or a decision, so each is yours:

1. **Deallocate the VM when it is idle** (`az vm deallocate`): stops about INR 7,700 a month; the disk (INR 1,877) stays.
2. **Deactivate the placeholder revision** ([runbook](../production/runbook.md#deactivate-the-placeholder-revision)): about INR 1,130 a month.
3. **Stop the database when nobody uses it** (`az postgres flexible-server stop -g <group> -n <server>`; `start` brings it
   back): compute is not billed while it is stopped, storage is, and Azure starts a stopped server again after seven days.
   Four hours a day on 22 working days is 88 hours, about INR 2,100 of compute instead of 17,379. While it is stopped the app
   answers 503 on `/api/health/ready` and the database alerts email, so tell the people who use it.
4. **Find Burstable**: ask Azure support to lift the restriction, or try another region (a new region means a new server and
   moving the data with `pg_dump`/`pg_restore`: a new billable resource, so tell me before it is made). B1ms is about INR 2,100.
5. **Delete the pilot** when the demonstration is over ([Teardown](./pilot-plan.md#teardown)).

How to read the prices again: the Retail Prices API needs no key (`https://prices.azure.com/api/retail/prices`), for example
`$filter=serviceName eq 'Azure Database for PostgreSQL' and armRegionName eq 'centralindia'` with `currencyCode=INR`; the
configuration is `az postgres flexible-server show`, `az containerapp revision list`, `az monitor metrics alert list` and
`az monitor scheduled-query list`; and the ingestion is `Usage | where IsBillable | summarize sum(Quantity)/1024 by DataType`
in the workspace.

## The plan's original estimate (East US 2, US dollars, Burstable)

**Region priced: East US 2 (`eastus2`).** It is the region of the existing AI resource ([AZURE.md](../AZURE.md#live-evidence)),
so the app and the model share a region. The region is a parameter; two others are compared
[below](#other-regions).

**What "low" and "high" mean.** _Low_ is an idle month: nobody uses the pilot and the replica is idle, which is billed at
a reduced rate. _High_ is a conservative ceiling for steady light use: the replica is **never** idle (it is billed at
the full active rate for all 730 hours), logging exceeds the free grant by 1 GB, and ten demonstration-sized scenarios
run. A real month will sit between them, nearer the low end.

## Summary

| Line                                                   | Low (idle)   | High (steady light use) |
| ------------------------------------------------------ | ------------ | ----------------------- |
| Container app (0.5 vCPU, 1 GiB, one replica)           | US$10.21     | US$34.02                |
| Container Apps environment (Consumption profile)       | US$0.00      | US$0.00                 |
| PostgreSQL flexible server (B1ms, 32 GiB)              | US$16.09     | US$16.09                |
| Container Registry (Basic)                             | US$5.07      | US$5.07                 |
| Log Analytics workspace and Application Insights       | US$0.00      | US$2.76                 |
| Managed identity and role assignments                  | US$0.00      | US$0.00                 |
| **Infrastructure subtotal**                            | **US$31.36** | **US$57.94**            |
| Model usage (the existing deployment; **usage-based**) | US$0.00      | US$3.13                 |
| **Total**                                              | **US$31.36** | **US$61.07**            |

About **US$31 to US$61 a month**. A three-day demonstration followed by deleting the resource group costs about
**US$2.40** including one recorded model scenario ([below](#a-short-demonstration)). Almost all of the fixed cost is two
always-on things: the database and the replica.

## Unit prices used

From `https://prices.azure.com/api/retail/prices`, region `eastus2`, fetched 30 Oct 2026.

| Meter                                                                     | Price                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Container Apps, vCPU, active / idle                                       | US$0.000024 / US$0.000003 per second                       |
| Container Apps, memory, active / idle                                     | US$0.000003 / US$0.000003 per GiB-second                   |
| Container Apps, requests                                                  | US$0.40 per million                                        |
| PostgreSQL flexible server, Burstable B1ms compute                        | US$0.017 per hour                                          |
| PostgreSQL flexible server, storage                                       | US$0.115 per GB per month                                  |
| PostgreSQL flexible server, backup storage (LRS)                          | US$0.095 per GB per month beyond what is included          |
| Container Registry, Basic registry unit                                   | US$0.1666 per day (includes 10 GiB of storage)             |
| Container Registry, build tasks (Basic)                                   | US$0.0001 per vCPU-second after the first 6,000 each month |
| Log Analytics, analytics-logs ingestion (also bills Application Insights) | US$2.76 per GB after the first 5 GB each month             |
| Outbound data transfer to the internet                                    | Free for the first 100 GB a month, then US$0.087 per GB    |
| gpt-4.1-mini, Global Standard, input / output                             | US$0.0004 / US$0.0016 per 1,000 tokens                     |

## Free grants

The Container Apps grants are stated in Microsoft's billing documentation and the Log Analytics grant on the Azure
Monitor pricing page; the data-transfer and build-task allowances are tiers in the Retail Prices API itself. All were
read on the same date as the prices.

| Grant                                                                    | Applies to                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests a month | Container Apps, **per subscription**: any other container app in the subscription draws on the same grant. It equals 100 hours of one 0.5 vCPU / 1 GiB replica, and health probes are not billed |
| First 5 GB a month of ingestion                                          | Log Analytics, **per billing account**: other workspaces in the same account use the same 5 GB. Application Insights data in the workspace counts too                                            |
| First 100 GB a month outbound                                            | Data transfer, shared across the subscription's services                                                                                                                                         |
| 6,000 build-task seconds a month                                         | Container Registry Basic                                                                                                                                                                         |

The figures below assume the Container Apps and Log Analytics grants are **fully available**. If they are already used, the
cost rises by the amount shown in each line.

## Per resource

Each block gives the purpose, the arithmetic, and the four questions: does it scale to zero, can it be stopped, can it
be deleted after a demonstration, and what happens if it is left out.

### Container app

|                              |                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose                      | The application: UI, API and the job runner in one process                                                                                                                                                                                                                                                                                                   |
| SKU                          | Consumption plan, 0.5 vCPU and 1 GiB, minimum and maximum **one** replica                                                                                                                                                                                                                                                                                    |
| Low (idle all month)         | vCPU: 0.5 × 2,628,000 s = 1,314,000 vCPU-s, less the 180,000 free = 1,134,000 × US$0.000003 = **US$3.40**. Memory: 1 × 2,628,000 = 2,628,000 GiB-s, less 360,000 free = 2,268,000 × US$0.000003 = **US$6.80**. Requests under the 2 million free. **US$10.21**                                                                                               |
| High (never idle)            | vCPU: 1,134,000 × US$0.000024 = **US$27.22**. Memory US$6.80. **US$34.02**                                                                                                                                                                                                                                                                                   |
| Scales to zero               | **Yes** in principle (`minReplicas = 0`) and **refused by the template**: the cost is nil within the free grant (up to about 100 active hours a month), but **the embedded job runner stops with it**: a queued run waits for the next request, a running one is handed back and resumed, and the first request after a pause waits for the replica to start |
| Can be stopped               | Only by deactivating its revision (scaling to zero is refused by the template); there is no stop switch                                                                                                                                                                                                                                                      |
| Delete after a demonstration | Yes: deleting the resource group ends the charge. Billing is per second                                                                                                                                                                                                                                                                                      |
| If left out                  | There is no application                                                                                                                                                                                                                                                                                                                                      |

A replica is billed at the idle rate only while it uses under 0.01 vCPU, receives under 1,000 bytes a second and handles
no request. Whether this app's polling and probes keep it under that threshold has not been measured.

### Container Apps environment

|                              |                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                      | The shared host of the app; sends its console and system logs to the workspace                                                                                                                                                                                                                                    |
| SKU                          | Consumption profile only, no virtual network                                                                                                                                                                                                                                                                      |
| Cost                         | **US$0.00.** A separate **management charge of US$0.10 an hour (about US$73 a month)** applies to an environment that uses a dedicated workload profile, a private endpoint or planned maintenance. The template uses none of them, and adding one is the single most expensive change you could make by accident |
| Scales to zero / stop        | Not applicable: it has no usage charge                                                                                                                                                                                                                                                                            |
| Delete after a demonstration | Yes (with the group)                                                                                                                                                                                                                                                                                              |
| If left out                  | Not possible: a container app lives in an environment                                                                                                                                                                                                                                                             |

### PostgreSQL flexible server

|                              |                                                                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                      | The one durable store: projects, ledger, audit chain, sessions and the job queue                                                                                                                                                                                                             |
| SKU                          | Burstable B1ms (1 vCore burstable, 2 GiB), PostgreSQL 16, 32 GiB, 7-day backups, no high availability, no geo-redundancy                                                                                                                                                                     |
| Compute                      | 730 h × US$0.017 = **US$12.41**                                                                                                                                                                                                                                                              |
| Storage                      | 32 GB × US$0.115 = **US$3.68**                                                                                                                                                                                                                                                               |
| Backups                      | Included up to the provisioned size (32 GB). A pilot database is a few hundred MB, so **US$0.00**; beyond 32 GB it is US$0.095 per GB a month                                                                                                                                                |
| Low and high                 | **US$16.09**, the same: it is always on and billed by the hour                                                                                                                                                                                                                               |
| Scales to zero               | **No**                                                                                                                                                                                                                                                                                       |
| Can be stopped               | **Yes**: compute is not billed while it is stopped, for up to seven days, after which Azure starts it again. Storage (US$3.68) and backups continue. Stopping saves US$0.017 an hour, about US$0.41 a day, and the app is unavailable meanwhile                                              |
| Delete after a demonstration | Yes. Its backups are deleted with it, so take a copy first if the data matters                                                                                                                                                                                                               |
| If left out                  | The app has no shared, durable store. A single local SQLite file on the replica's disk would be lost on every restart or new revision, and only one instance could use it ([ADR 0006](../adr/0006-postgres-adapter-proposed.md)). Acceptable for a one-person demonstration, not for a pilot |

A new Azure free account includes 750 hours of a B1ms server and 32 GB of storage for twelve months. That is **not**
assumed here; check eligibility before counting on it.

### Container Registry

|                              |                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose                      | Holds the application image; the app pulls it with its managed identity                                                                                                                                                  |
| SKU                          | Basic, admin user off                                                                                                                                                                                                    |
| Cost                         | US$0.1666 × (730 / 24 = 30.42 days) = **US$5.07**, including 10 GiB. An image of a few hundred MB is far under that. A remote build of a few minutes uses a few hundred of the 6,000 free task seconds                   |
| Low and high                 | **US$5.07**, the same                                                                                                                                                                                                    |
| Scales to zero / stop        | **No**; a registry cannot be stopped, only deleted                                                                                                                                                                       |
| Delete after a demonstration | Yes (with the group); the image is rebuilt from source                                                                                                                                                                   |
| If left out                  | The image must come from somewhere else: a public registry is free, but then anyone can pull it (it holds no secret, and the source is AGPL), whereas a private one needs a stored pull secret, which this design avoids |

### Log Analytics workspace and Application Insights

|                                 |                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose                         | Console and system logs of the app; traces and failures from Application Insights                                                                                                                                                                                        |
| SKU                             | Pay-as-you-go (`PerGB2018`), 30 days of retention, **0.5 GB a day cap**. Application Insights is workspace-based with local authentication disabled                                                                                                                      |
| Expected volume                 | The app logs every request, including about 9,000 platform probes a day: roughly 0.1 to 0.3 GB a month. Application Insights adds a similar amount for requests. Call it **0.5 to 1 GB a month**, an estimate to be replaced by a measurement                            |
| Low                             | Under the 5 GB free grant: **US$0.00**                                                                                                                                                                                                                                   |
| High                            | 6 GB ingested, the first 5 GB free, so (6 − 5) × US$2.76 = **US$2.76**. This is a stress figure: debug logging, or other workspaces in the billing account using the grant                                                                                               |
| Worst case                      | The daily cap stops collection at 0.5 GB a day, at most about 15 GB a month: (15 − 5) × US$2.76 = about **US$28**. The cap is the ceiling on this line                                                                                                                   |
| Application Insights on its own | **US$0.00** extra: its data is billed as workspace ingestion, at the same rate, against the same grant, with 90 days of retention included                                                                                                                               |
| Scales to zero / stop           | Usage-based: no volume, no cost. There is nothing to stop; delete to end retention charges (US$0.12 per GB a month beyond 31 days of retention)                                                                                                                          |
| Delete after a demonstration    | Yes. A deleted workspace is recoverable for 14 days and its name cannot be reused meanwhile                                                                                                                                                                              |
| If left out                     | Container logs would be visible only as a live stream, with no history and no queries, and there would be no traces or failure telemetry. For a pilot that cannot be diagnosed after the fact, that is the cost of saving nothing, since the line is free at this volume |

### Managed identity and role assignments

|             |                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Purpose     | The app's only credential: database, model, registry and telemetry                                                                 |
| Cost        | **US$0.00**: identities and role assignments are free                                                                              |
| If left out | Not possible without secrets: the database, the registry and the model would each need a password or key, which the design forbids |

## Model usage (usage-based, separate)

The existing deployment is `gpt-4.1-mini` on **Global Standard**: pay per token, with no standing charge. Its capacity
is a rate limit, not a reservation, so the account has **no fixed monthly cost**. The list prices in the
[cost model](../pitch/cost-model.md) match the Retail Prices API for this SKU in East US 2 (US$0.0004 and US$0.0016 per
1,000 tokens).

| Usage                                                                                                                                          | Cost                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A recorded real-model demonstration scenario: three runs, 199 calls, about 534,000 tokens in and 62,000 out                                    | 0.534 × US$0.40 + 0.062 × US$1.60 = US$0.2136 + US$0.0992 = **US$0.31**, the "roughly US$0.30" of the [README](../../README.md) |
| Ten such scenarios in a month (the high end above)                                                                                             | **US$3.13**                                                                                                                     |
| The pilot sized in the [cost model](../pitch/cost-model.md): ten analysts, five scenarios each, four runs per scenario, at about US$0.20 a run | about **US$40** a month: more than the idle infrastructure, and not in the totals above                                         |

Prices are assumptions of list price; the model, SKU and region of the real deployment decide the real figure. Each project
is held to a model budget (the template's default is 1,500 calls and 4,000,000 tokens, which at the price above is a few
US dollars at most), but nothing totals a tenant or a day, and there is no spend alert in the app yet (the template adds a token alert and a budget notice: [observability.md](../production/observability.md)).

## A short demonstration

Three days, then `az group delete`:

| Item                         | Arithmetic                                                               | Cost              |
| ---------------------------- | ------------------------------------------------------------------------ | ----------------- |
| Container app                | 72 h idle = 129,600 vCPU-s and 259,200 GiB-s, both under the free grants | US$0.00           |
| PostgreSQL compute           | 72 h × US$0.017                                                          | US$1.22           |
| PostgreSQL storage           | 32 GB × US$0.115 × 72 / 730                                              | US$0.36           |
| Container Registry           | 3 days × US$0.1666                                                       | US$0.50           |
| Logs                         | under the free grant                                                     | US$0.00           |
| Model, one recorded scenario | as above                                                                 | US$0.31           |
| **Total**                    |                                                                          | **about US$2.40** |

## What changes the bill

| Change                                                                                     | Effect                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `minReplicas = 0` (refused by the template)                                                | The app costs about nothing within the free grant, but the job runner stops and the first request is slow                       |
| Stop the database between sessions (up to seven days at a time)                            | Saves US$0.017 an hour of compute                                                                                               |
| A dedicated workload profile, a private endpoint or planned maintenance on the environment | **Adds US$0.10 an hour (about US$73 a month)**                                                                                  |
| 1 vCPU and 2 GiB instead of 0.5 and 1                                                      | Active cost of the replica roughly doubles beyond the free grant                                                                |
| A second replica, or a separate worker app                                                 | Doubles the replica cost                                                                                                        |
| A NAT gateway or private networking for the database                                       | Adds resources and hourly charges: priced in [azure-preflight.md](../production/azure-preflight.md#options-priced-and-left-off) |
| Debug-level logging                                                                        | Can reach the 0.5 GB daily cap: up to about US$28 a month                                                                       |
| Delete the resource group                                                                  | Ends everything except the retained workspace name and the AI account's orphaned role assignment (free)                         |

## Other regions

The same arithmetic for the two other regions the team is most likely to use (prices fetched the same day):

| Region         | Container app (low–high) | PostgreSQL | Registry | Logs (high) | Infrastructure subtotal (low–high) |
| -------------- | ------------------------ | ---------- | -------- | ----------- | ---------------------------------- |
| East US 2      | US$10.21–34.02           | US$16.09   | US$5.07  | US$2.76     | **US$31.36–57.94**                 |
| Sweden Central | US$10.21–34.02           | US$18.91   | US$5.07  | US$2.99     | **US$34.18–60.99**                 |
| West Europe    | US$13.61–47.63           | US$18.91   | US$5.07  | US$2.99     | **US$37.58–74.59**                 |

## What is not included

- **Data transfer.** Outbound transfer is free for the first 100 GB a month, then US$0.087 per GB. A pilot serving a small
  single-page app and JSON stays far below that. Calls between the app, the database and the model in one region cost
  nothing; if the model is in another region the app pays inter-region transfer (US$0.02 per GB), a few megabytes per scenario.
- **Support plans,** taxes, currency conversion and any agreement discount.
- **The existing AI resource.** It has no fixed cost (see above); its usage is the model line.
- **Microsoft Entra.** The app registration, the app roles and the assignment of individual people are free. Assigning
  **groups** to an application needs Microsoft Entra ID P1, and the app does not use groups.
- **Cost Management, Azure Policy and a budget.** They are free to use. **The template now creates a budget** on the
  resource group (INR 4,500 by default, notifications at 50, 80 and 100% of actual and 100% of forecast) **and 18 alert
  rules**, which are priced in [azure-preflight.md](../production/azure-preflight.md#monthly-estimate-the-pilot) and not
  here. A budget alerts; it does not stop spending.
- **People's time** to set up Entra, to run the restore drill and to operate the pilot.
- **Anything that is optional and off by default**, priced in [azure-preflight.md](../production/azure-preflight.md#options-priced-and-left-off)
  and not here: a virtual network and private endpoints, a NAT gateway, Key Vault, high availability and geo-redundant
  backup. Not priced anywhere: Blob Storage, a queue service, a second region.

## How to check these numbers

Each unit price is one query to the public Retail Prices API, with no sign-in, for example
`https://prices.azure.com/api/retail/prices?$filter=serviceName eq 'Azure Container Apps' and armRegionName eq 'eastus2' and priceType eq 'Consumption'`.
The services used are `Azure Container Apps`, `Azure Database for PostgreSQL`, `Container Registry`, `Log Analytics`,
`Bandwidth` and `Foundry Models`. Prices change; the
[Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) applies your agreement.

## Approval request

These are the chargeable resources that would be created, in **one new resource group**, in `eastus2` (or the region you
choose). Nothing has been created.

| Resource                                                 | SKU                                                      | Region    | Monthly range                                      | Stoppable                                                      | Deletable after a demonstration |
| -------------------------------------------------------- | -------------------------------------------------------- | --------- | -------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| Container app and Container Apps environment             | Consumption, 0.5 vCPU / 1 GiB, one replica               | East US 2 | US$10.21 – US$34.02                                | By deactivating its revision (which also stops the job runner) | Yes                             |
| PostgreSQL flexible server, database `swarm`             | Burstable B1ms, 32 GiB, version 16, 7-day backups, no HA | East US 2 | US$16.09                                           | Yes, compute only, up to seven days at a time                  | Yes (its backups go with it)    |
| Container Registry                                       | Basic                                                    | East US 2 | US$5.07                                            | No                                                             | Yes                             |
| Log Analytics workspace, Application Insights            | Pay-as-you-go, 30 days, 0.5 GB a day cap                 | East US 2 | US$0.00 – US$2.76 (at most about US$28 at the cap) | No                                                             | Yes                             |
| Managed identity and three role assignments              | Not applicable                                           | East US 2 | US$0.00                                            | Not applicable                                                 | Yes                             |
| Model usage on the existing deployment (no new resource) | `gpt-4.1-mini`, Global Standard, per token               | existing  | US$0.00 – US$3.13                                  | Not applicable                                                 | Not applicable                  |
| **Total**                                                |                                                          |           | **US$31.36 – US$61.07**                            |                                                                |                                 |

**Not in the table above** (it is the 30 October version): the template now also creates an action group, **nine log alert
rules** (US$0.50 each a month at 15-minute evaluation, US$4.50) and nine platform-metric alerts (the first ten series are
free), and a budget (free). The current figures, re-read on 3 November 2026, are in
[azure-preflight.md](../production/azure-preflight.md#monthly-estimate-the-pilot): infrastructure **US$36.73 – US$63.30** a
month in `eastus2` and **US$42.71 – US$69.75** in `centralindia`, before the model line. They are list-price estimates; the
remaining credit and the spending limit could not be read.

**I ask for your explicit approval to create these resources, and nothing will be created until you give it.**
