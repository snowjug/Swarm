# Azure pre-flight and cost plan

> **Status: authored offline. Nothing in this page has been checked against the subscription it is about.**
> No Azure authorization exists on the machine this was written on (no `az` login, no credential, no managed
> identity), so **the remaining Visual Studio credit and the actual spend so far could NOT be read**, nothing was
> inspected in the subscription, and nothing was deployed. What is real here: public list prices fetched from
> Microsoft's unauthenticated Retail Prices API on **3 November 2026**, the arithmetic on them, and a read-only
> script that will inspect the subscription when someone signs in.

> **Stop condition.** Provisioning requires **owner action**: an authenticated `az` session, or a service
> principal / managed identity, holding the roles in [What the owner must do](#what-the-owner-must-do). Nothing in
> this repository provisions anything by itself, and no workflow holds a credential or a deploy job.

This is infrastructure for a **production-candidate controlled pilot** on a **Visual Studio Enterprise dev/test
credit subscription** (a monthly credit; a budget alert near INR 5,000 exists and is **not** a hard cap). It is not
a broad public production service, and it is kept portable: every setting is a parameter, so redeploying into a paid
subscription is a change of parameter file ([production-shaped](#the-production-shaped-profile)).

## Contents

- [Run the pre-flight](#run-the-pre-flight)
- [What could not be read](#what-could-not-be-read)
- [How prices were read](#how-prices-were-read)
- [Unit prices](#unit-prices)
- [Monthly estimate: the pilot](#monthly-estimate-the-pilot)
- [The development VM and the credit](#the-development-vm-and-the-credit)
- [Options priced and left off](#options-priced-and-left-off)
- [The production-shaped profile](#the-production-shaped-profile)
- [Pilot budget strategy and "stop if" thresholds](#pilot-budget-strategy-and-stop-if-thresholds)
- [Reuse, do not duplicate](#reuse-do-not-duplicate)
- [What the owner must do](#what-the-owner-must-do)
- [What is unverified](#what-is-unverified)

## Run the pre-flight

```bash
npm run azure:preflight                                  # inspects the active az session, prices Central India and East US 2
npm run azure:preflight -- --subscription <guid> --region centralindia --fallback-region eastus2
npm run azure:preflight -- --profile production-shaped   # prices the paid-subscription shape instead
npm run azure:preflight -- --offline                     # no az call at all: the cost plan only
npm run azure:preflight -- --json                        # the same report as JSON
```

**It is read-only, and enforced.** Every `az` call goes through [`readonly-az.ts`](../../scripts/azure/lib/readonly-az.ts),
an _allow-list_: only `show`, `list`, `list-skus`, `list-usage(s)`, `list-locations`, `list-definitions` and `exists`
verbs, and `az rest` only as a `GET` to Azure Resource Manager or Microsoft Graph, ever run. Anything else is refused
before a process is spawned (`group create`, `deployment ... create`, `role assignment create`, `provider register`,
`vm deallocate`, `postgres ... restore`...), and so is any read that would put a credential on the screen
(`keyvault secret ...`, `... keys list`, `acr credential show`, `--debug`). The tests
([`readonly-az.test.ts`](../../scripts/azure/lib/readonly-az.test.ts)) check both lists.

It reads, and prints (GUIDs are shown as their first eight characters unless `--show-ids`):

| Fact                                                                      | From                                                                                     | Why it matters                                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Active subscription, state, tenant, who is signed in                      | `account show`                                                                           | The default subscription is reported, never silently trusted                                    |
| Offer, **spending limit**, budgets and their month-to-date spend          | `rest GET /subscriptions/<id>`, `consumption budget list`                                | A spending limit that is ON is a hard stop: Azure disables resources when the credit runs out   |
| Resource groups, the ones tagged `app=swarm-lab`                          | `group list`                                                                             | The pilot gets a new group                                                                      |
| Foundry / Azure OpenAI accounts and their deployments                     | `cognitiveservices account list`, `... deployment list`                                  | The template references the existing account; it creates no model                               |
| Model quota in the region                                                 | `cognitiveservices usage list`                                                           | Only matters if the model moves                                                                 |
| Registered resource providers                                             | `provider list`                                                                          | An unregistered namespace fails the deployment                                                  |
| Region: Container Apps offered, PostgreSQL SKU offered                    | `account list-locations`, `provider show`, `postgres flexible-server list-skus`          | Some subscriptions are refused Burstable servers in a region ("region restricted")              |
| Who may provision: roles, whether users may register applications         | `ad signed-in-user show`, `role assignment list`, Graph `authorizationPolicy`            | Provisioning needs a role that can assign roles; the Entra app registration needs its own right |
| Existing PostgreSQL servers, registries, environments, vaults, workspaces | `postgres flexible-server list`, `acr list`, `containerapp env list`, `keyvault list`... | The things the template can **reuse** instead of duplicating                                    |
| The VM `swarm-dev` and whether it is running                              | `vm list --show-details`                                                                 | It already consumes credit                                                                      |
| Azure Policy assignments that may restrict a deployment                   | `policy assignment list`                                                                 | A policy refusal is found by deploying, which is the costly way                                 |
| The Bicep in this repository                                              | the working tree                                                                         | What would be deployed                                                                          |

With no `az`, or no sign-in, it says so, renders the cost plan anyway, prints the owner steps and exits `2`. Whatever
it cannot read it reports as **unknown**; it never fills a gap with a guess.

## What could not be read

| Fact                                      | Why not                                                                                                                                                                                         | Where to read it                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Remaining Visual Studio credit**        | No Azure authorization on this machine. Even with one, no `az` command that could be identified offline reads the credit balance of this kind of subscription, and it would need billing rights | The Azure portal: Cost Management + Billing, Credits; the Visual Studio benefits portal             |
| **Actual spend so far (this month)**      | The same. The pre-flight reads it from an existing budget's `currentSpend` when one exists and the session may see it                                                                           | The portal: Cost analysis; `az consumption budget list`                                             |
| Whether the **spending limit** is ON      | The same. The pre-flight reads `subscriptionPolicies.spendingLimit`                                                                                                                             | `az rest --method get --url https://management.azure.com/subscriptions/<id>?api-version=2022-12-01` |
| What exists in the subscription at all    | The same                                                                                                                                                                                        | `npm run azure:preflight`                                                                           |
| Container Apps and PostgreSQL vCore quota | `az` offers no subscription-level read for them; the model quota is read                                                                                                                        | Found out by deploying, or the portal's Quotas page                                                 |
| Whether Azure accepts the templates       | They were never deployed. They compile, lint and are evaluated offline ([iac:validate](../../scripts/iac/validate.mjs))                                                                         | A `what-if`, then a deployment                                                                      |

**The amount of the monthly credit is therefore an assumption here.** A Visual Studio Enterprise subscription is
documented to include **US$150 a month**; that is what the numbers below use, marked **UNVERIFIED for this
subscription**. If the real credit differs, recompute the thresholds in [the budget strategy](#pilot-budget-strategy-and-stop-if-thresholds),
which are written as fractions of it.

## How prices were read

Only the **public, unauthenticated Azure Retail Prices API** was used, with `curl`, read-only, on **2026-11-03**. Each
request is a `GET` of `https://prices.azure.com/api/retail/prices` with `api-version=2023-01-01-preview`, a
`currencyCode` (`USD` and `INR`, each fetched separately) and an OData `$filter`:

```bash
curl -sG 'https://prices.azure.com/api/retail/prices' \
  --data-urlencode 'api-version=2023-01-01-preview' \
  --data-urlencode "currencyCode='USD'" \
  --data-urlencode "\$filter=serviceName eq 'Azure Container Apps' and armRegionName eq 'centralindia' and priceType eq 'Consumption'"
```

The filters, for `centralindia` and for the fallback `eastus2` (the region of the existing Foundry account), are
recorded with the selected meters, their `meterId`s and effective dates in
[`prices/azure-retail-prices-2026-11-03.json`](./prices/azure-retail-prices-2026-11-03.json) (22 queries, 37 meters).
They are, by service: `Azure Container Apps`; `Azure Database for PostgreSQL`; `Container Registry`; `Log Analytics`;
`Azure Monitor` (alert rules); `Key Vault`; `Virtual Machines` with `armSkuName eq 'Standard_D4as_v5'`; `Virtual Network`
filtered on `IP Addresses`; `Azure Firewall`; `Bandwidth`; `NAT Gateway` (no region filter: its meters are listed under
`Global`); and `Foundry Models` filtered on the `gpt 4.1 mini`, `gpt 4.1` and `5.4 mini` meter names. A snapshot is
committed so that every figure below can be recomputed offline: [`cost-plan.ts`](../../scripts/azure/lib/cost-plan.ts)
does the arithmetic, and its test ([`cost-plan.test.ts`](../../scripts/azure/lib/cost-plan.test.ts)) fails if this page
and the code disagree.

**Cross-check.** East US 2 prices fetched now (B1ms US$0.017 an hour, storage US$0.115, backup US$0.095, Container Apps
US$0.000024 / US$0.000003, registry US$0.1666 a day, Log Analytics US$2.76) equal those in
[pilot-cost.md](../azure/pilot-cost.md), fetched four days earlier, so the two fetches agree.

**INR.** Microsoft's own INR list prices come from the same API. Dividing each meter's INR price by its USD price gives
the same number, **95.2289 INR per US$** (minimum 95.2287, maximum 95.2290, over 55 meter-and-region pairs), so every
INR figure below is **US$ × 95.2289**, the conversion the API applied on **2026-11-03**. It is **not** a market rate and
not the rate Azure will apply on an invoice (that follows the billing currency and the date of use): treat INR as
"about".

**These are list-price estimates.** Not an agreement price, not a dev/test discount, not the free grants a particular
subscription has used, and not real usage. Where a number rests on a guess about usage it is marked _assumption_; where
it rests on a ratio from Microsoft documentation that the API does not list (the doubling for a high-availability
standby), it is marked _documented_.

## Unit prices

From the snapshot. USD unless stated; INR is the API's own INR list price for Central India.

| Meter                                                       | Unit           | Central India US$                    | Central India INR | East US 2 US$ |
| ----------------------------------------------------------- | -------------- | ------------------------------------ | ----------------- | ------------- |
| Container Apps, vCPU, **active**                            | second         | 0.000024                             | 0.002285          | 0.000024      |
| Container Apps, vCPU, idle                                  | second         | 0.000003                             | 0.000286          | 0.000003      |
| Container Apps, memory, active and idle                     | GiB-second     | 0.000003                             | 0.000286          | 0.000003      |
| Container Apps, requests                                    | million        | 0.40                                 | 38.09             | 0.40          |
| Container Apps environment, private endpoint                | hour           | 0.10                                 | 9.52              | 0.10          |
| PostgreSQL flexible, Burstable B1ms compute                 | hour           | 0.0245                               | 2.333             | 0.017         |
| PostgreSQL flexible, General Purpose D2ds_v5                | hour (2 vCore) | 0.251                                | 23.90             | 0.178         |
| PostgreSQL flexible, storage                                | GB-month       | 0.131                                | 12.47             | 0.115         |
| PostgreSQL flexible, backup storage (LRS)                   | GB-month       | 0.095                                | 9.05              | 0.095         |
| Container Registry, Basic                                   | day            | 0.1666                               | 15.87             | 0.1666        |
| Container Registry, Premium                                 | day            | 1.6666                               | 158.71            | 1.6666        |
| Log Analytics ingestion, after the first 5 GB               | GB             | 3.22                                 | 306.64            | 2.76          |
| Azure Monitor, log alert rule, 15-minute frequency          | rule-month     | 0.50                                 | 47.61             | 0.50          |
| Azure Monitor, log alert rule, 5-minute frequency           | rule-month     | 1.50                                 | 142.84            | 1.50          |
| Azure Monitor, metric alert, after the first 10 time series | series-month   | 0.10                                 | 9.52              | 0.10          |
| Key Vault Standard, operations                              | 10,000         | 0.03                                 | 2.86              | 0.03          |
| NAT gateway (listed under `Global`)                         | hour           | 0.045                                | 4.29              | (same)        |
| NAT gateway data processed                                  | GB             | 0.045                                | 4.29              | (same)        |
| Public IP, Standard static IPv4                             | hour           | 0.005                                | 0.48              | 0.005         |
| Azure Firewall, Basic / Standard deployment                 | hour           | 0.395 / 1.25                         | 37.62 / 119.04    | same          |
| Data transfer out (default routing), after the first 100 GB | GB             | 0.12                                 | 11.43             | 0.087         |
| Inter-region data transfer                                  | GB             | 0.08                                 | 7.62              | 0.02          |
| **VM Standard_D4as_v5, Linux / base rate**                  | hour           | **0.111**                            | 10.57             | 0.172         |
| VM Standard_D4as_v5, Windows list rate                      | hour           | 0.295                                | 28.09             | 0.356         |
| gpt-4.1-mini, Global Standard, input / output               | 1M tokens      | 0.40 / 1.60 (listed under East US 2) | 38.09 / 152.37    | same          |
| gpt-4.1, Global Standard, input / output                    | 1M tokens      | 2.00 / 8.00                          | 190.46 / 761.83   | same          |
| gpt-5.4-mini, Global Standard, input / output               | 1M tokens      | 0.75 / 4.50                          | 71.42 / 428.53    | same          |

Free grants that are **not** in the price API (Microsoft billing documentation; assumed fully available, **UNVERIFIED**
for this subscription): Container Apps gives each _subscription_ 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million
requests a month; Log Analytics gives the first 5 GB a month of ingestion (a tier of the meter above); outbound data
transfer is free for the first 100 GB. Central India lists no regional `gpt-4.1-mini` meter: the Global Standard price is
used because the existing deployment is Global Standard in East US 2.

## Monthly estimate: the pilot

The pilot is the default `infra/pilot/main.bicepparam`: one container app at 0.5 vCPU / 1 GiB with **one replica that is
always on** (the embedded job runner stops with it, so the template refuses scale-to-zero), Burstable B1ms PostgreSQL with
32 GiB, a Basic registry, one Log Analytics workspace with Application Insights, nine log and nine metric alert rules, and
no Key Vault, no virtual network and no NAT gateway. **730 hours a month = 2,628,000 seconds.** _Low_ bills the replica at
the idle rate all month; _high_ at the active rate all month. A real month lies between, nearer the low end for a handful
of users.

### Central India (`centralindia`)

| Line                                                        | Arithmetic (US$)                                                                                                                                                                                                    | Low US$         | High US$        | Basis      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------- | ---------- |
| Container app, 0.5 vCPU, 1 GiB                              | vCPU 0.5 × 2,628,000 = 1,314,000 − 180,000 free = 1,134,000 s; memory 2,628,000 − 360,000 = 2,268,000 GiB-s. Idle: 1,134,000 × 0.000003 + 2,268,000 × 0.000003. Active: 1,134,000 × 0.000024 + 2,268,000 × 0.000003 | 10.21           | 34.02           | list price |
| Previous revision kept warm (blue/green), 4 releases × 4 h  | 4 × 4 × 3,600 = 57,600 s: 28,800 vCPU-s × 0.000024 + 57,600 GiB-s × 0.000003                                                                                                                                        | 0.86            | 0.86            | assumption |
| PostgreSQL B1ms, 32 GiB                                     | compute 730 × 0.0245 = 17.89; storage 32 × 0.131 = 4.19; backups up to the provisioned size are included                                                                                                            | 22.08           | 22.08           | list price |
| Container Registry Basic                                    | (730 / 24 = 30.4167 days) × 0.1666                                                                                                                                                                                  | 5.07            | 5.07            | list price |
| Log Analytics and Application Insights                      | low 0.5 GB (inside the 5 GB free); high 6 GB: (6 − 5) × 3.22                                                                                                                                                        | 0.00            | 3.22            | assumption |
| Alert rules                                                 | 9 log rules × 0.50 (15 minutes) = 4.50; 9 metric series, the first 10 free = 0.00                                                                                                                                   | 4.50            | 4.50            | list price |
| Outbound data                                               | 5 GB, the first 100 GB free                                                                                                                                                                                         | 0.00            | 0.00            | assumption |
| **Infrastructure per month**                                |                                                                                                                                                                                                                     | **42.71**       | **69.75**       |            |
| Model usage, ten recorded scenarios (separate, usage-based) | one scenario = 0.534 M in × 0.40 + 0.062 M out × 1.60 = 0.3128 (gpt-4.1-mini); × 10                                                                                                                                 | 0.00            | 3.13            | assumption |
| **Infrastructure plus model**                               |                                                                                                                                                                                                                     | **42.71**       | **72.88**       |            |
| **In INR** (× 95.2289)                                      |                                                                                                                                                                                                                     | **about 4,068** | **about 6,940** |            |

### East US 2 (`eastus2`, fallback: where the existing Foundry account is)

Same arithmetic with the East US 2 meters (B1ms 0.017, storage 0.115, Log Analytics 2.76): container app 10.21 / 34.02,
warm window 0.86, PostgreSQL 12.41 + 3.68 = 16.09, registry 5.07, logs 0.00 / 2.76, alerts 4.50, so
**infrastructure US$36.73 to US$63.30** (INR about 3,498 to 6,028), with the model **US$36.73 to US$66.43** (INR about
3,498 to 6,326). It is about US$6 a month cheaper and co-located with the model (no cross-region model traffic), but
farther from India-based users and the VM.

**Model usage per recorded scenario** (three runs, 199 calls, about 534,000 tokens in and 62,000 out, from
[pilot-cost.md](../azure/pilot-cost.md)): gpt-4.1-mini US$0.31; gpt-4.1 0.534 × 2.00 + 0.062 × 8.00 = US$1.56;
gpt-5.4-mini 0.534 × 0.75 + 0.062 × 4.50 = US$0.68. The per-project token limit in the template (4,000,000) bounds one
project at roughly US$2 on gpt-4.1-mini and US$10 on gpt-4.1 if the split were 90% input. Nothing totals a tenant or a
day; the token alert (`tokensPerHour`) is the early warning.

### A short evaluation window (then delete the resource group)

| Window         | Arithmetic (US$, Central India)                                                                                                                                                                                                        | Low        | High        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| 3 days (72 h)  | PostgreSQL 72 × 0.0245 = 1.76 + storage 32 × 0.131 × 72 / 730 = 0.41; registry 3 × 0.1666 = 0.50; container app inside the free grant; one scenario 0.31                                                                               | about 2.99 | about 7.49  |
| 7 days (168 h) | PostgreSQL 168 × 0.0245 = 4.12 + storage 32 × 0.131 × 168 / 730 = 0.96; registry 7 × 0.1666 = 1.17; app idle (302,400 − 180,000) × 0.000003 + (604,800 − 360,000) × 0.000003 = 1.10 (active 3.67, which adds 2.57); two scenarios 0.63 | about 7.97 | about 15.04 |

The upper figures add the alert rules at their full monthly price (US$4.50) in case a rule deleted within days is still
billed for the month (the 7-day high also bills the app at the active rate); whether Azure prorates a rule is
**unverified**. About **INR 285 to 713** for three days and **INR 759 to 1,432** for a week.

## The development VM and the credit

The VM `swarm-dev` (**Standard_D4as_v5, Central India**) already consumes credit and is **not** in any total above.

| VM state                                                                  | Arithmetic (US$)      | US$ a month                                      | INR a month  | Share of an assumed US$150 credit |
| ------------------------------------------------------------------------- | --------------------- | ------------------------------------------------ | ------------ | --------------------------------- |
| Running 24 × 7, Linux / base rate                                         | 730 × 0.111           | **81.03**                                        | about 7,716  | **54%**                           |
| Running 24 × 7 at the Windows list rate (if no dev/test discount applies) | 730 × 0.295           | 215.35                                           | about 20,508 | 144% (it would not fit)           |
| Running 10 h a day on 22 weekdays                                         | 220 × 0.111           | 24.42                                            | about 2,326  | 16%                               |
| Deallocated                                                               | compute is not billed | 0.00 (the disk still is, and is not priced here) | 0            | 0%                                |

Visual Studio dev/test offers are documented to bill Windows VMs at the base rate, which is the row used; the API
shows only list prices, so which applies here is **unknown** (the OS of `swarm-dev` was not read). **The VM alone is more
than the pilot's whole idle month, and it alone reaches the INR 5,000 alert threshold after about 20 days**
(5,000 / 10.57 = 473 hours): the existing budget alert does not mean the VM is cheap.

The credit arithmetic (US$150 ≈ INR 14,284, **assumed**):

| Month                               | US$ (low–high)  | Share of the credit                              |
| ----------------------------------- | --------------- | ------------------------------------------------ |
| Pilot always on + VM running 24 × 7 | 123.74 – 153.91 | **82% – 103%**: no buffer, can exceed the credit |
| Pilot always on + VM 10 h × 22 days | 67.13 – 97.30   | 45% – 65%                                        |
| Pilot always on + VM deallocated    | 42.71 – 72.88   | 28% – 49%                                        |
| One-week window + VM 10 h × 22 days | 32.39 – 39.46   | 22% – 26%                                        |

## Options priced and left off

All three are **off** in the pilot and priced here so that turning one on is a decision, not a surprise.

| Option                                                                                         | Arithmetic (US$)                                                         | US$ a month | INR             | What it does, and does not do                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| NAT gateway + one static public IP (`enableNatGateway`)                                        | gateway 730 × 0.045 = 32.85; IP 730 × 0.005 = 3.65; 10 GB × 0.045 = 0.45 | 36.95       | about 3,519     | One fixed **outbound address**. It does **not** filter destinations. Needs `enablePrivateNetworking`                                      |
| Azure Firewall Basic / Standard (not in any template)                                          | 730 × 0.395 = 288.35; 730 × 1.25 = 912.50; Standard also 0.016 per GB    | 288 / 913   | 27,460 / 86,900 | Can allow-list by **name**. A research crawler visits arbitrary public sites, so a firewall could only _block_ names, not allow-list them |
| Container Apps environment with a private endpoint, planned maintenance or a dedicated profile | 730 × 0.10                                                               | 73.00       | about 6,952     | **The single most expensive change to make by accident.** No template adds it                                                             |

### Controlled outbound for the crawler, honestly

The crawler is the only part of Swarm that opens connections to addresses a user chose. **The application's own controls
are the primary defence**: it resolves the name itself, refuses private, loopback, link-local and cloud-metadata
addresses, pins the connection to the address it checked, revalidates every redirect, refuses an https-to-http
downgrade, honours `robots.txt`, and bounds bytes, time and redirects ([url-ingestion.md](../security/url-ingestion.md),
[threat-model.md](./threat-model.md)). Infrastructure can add a second layer, and each layer has a price and a limit:

- **A NAT gateway** makes outbound traffic leave from one known address, which lets a site be told whose traffic it is,
  and lets the PostgreSQL public firewall name one address instead of "any Azure service". It restricts nothing.
- **A firewall with name rules** is the control that could limit destinations, but it cannot allow-list the open web the
  crawler is meant to read. It would work for the _other_ outbound paths (the model endpoint, Entra, the registry,
  Application Insights, Key Vault) if the crawler had its own subnet, which this design does not have.
- **A network security group** on the environment subnet can deny the private ranges and the metadata address at no cost.
  The Container Apps platform has outbound requirements that a deny rule can break, so it was **not** written without a
  deployment to test it against. It is the first thing to try if an infrastructure layer is wanted.

Until one of these is tried, **egress control is the application's alone**, and [LIMITATIONS.md](./LIMITATIONS.md) says so.

## The production-shaped profile

`infra/pilot/production-shaped.bicepparam` turns on: PostgreSQL General Purpose D2ds_v5, 128 GiB, zone-redundant high
availability, geo-redundant backups and 35 days of point-in-time restore; a virtual network with PostgreSQL private
access (no public endpoint, no firewall rule); a zone-redundant Container Apps environment integrated with it; a NAT
gateway; Premium registry with zone redundancy; Key Vault with purge protection; 90 days of logs.

| Line (Central India)                           | Arithmetic (US$)                                                                            | Low US$      | High US$     | Basis      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------ | ------------ | ---------- |
| Container app 1 vCPU, 2 GiB                    | (2,628,000 − 180,000) × 0.000003 + (5,256,000 − 360,000) × 0.000003; active vCPU × 0.000024 | 22.03        | 73.44        | list price |
| Warm window, 4 × 4 h                           | 57,600 vCPU-s × 0.000024 + 115,200 GiB-s × 0.000003                                         | 1.73         | 1.73         | assumption |
| PostgreSQL D2ds_v5, 128 GiB, zone-redundant HA | compute 730 × 0.251 × 2 = 366.46; storage 128 × 0.131 × 2 = 33.54                           | 400.00       | 400.00       | documented |
| Container Registry Premium                     | 30.4167 × 1.6666                                                                            | 50.69        | 50.69        | list price |
| Logs, 5 and 20 GB                              | (GB − 5) × 3.22                                                                             | 0.00         | 48.30        | assumption |
| Alert rules                                    | 9 × 0.50                                                                                    | 4.50         | 4.50         | list price |
| Key Vault, 100,000 operations                  | 10 × 0.03                                                                                   | 0.30         | 0.30         | assumption |
| NAT gateway                                    | 32.85 + 3.65 + 0.45                                                                         | 36.95        | 36.95        | assumption |
| **Infrastructure per month**                   |                                                                                             | **516.20**   | **615.91**   |            |
| In INR (× 95.2289)                             |                                                                                             | about 49,157 | about 58,652 |            |

It is **about twelve times the pilot** and cannot be paid from a Visual Studio credit; the standby's doubling and the
geo-redundant backup price are Microsoft-documented ratios the API does not list. It is a _shape_: the region must offer
zones and geo-redundant backup (the pre-flight reads what it can), the application behind it is still a controlled-pilot
build ([LIMITATIONS.md](./LIMITATIONS.md)), and replicas stay at one because several are argued, not measured.

## Pilot budget strategy and "stop if" thresholds

**Aim: finish every month with at least half of the credit unspent**, because the spending limit (if it is ON) is a
cliff and because nothing here has run in Azure, so the first month will contain surprises. A budget alerts; it never
stops anything.

1. **Read the credit and the spending limit first** (the portal; `npm run azure:preflight`). This page could not.
2. **Put the VM on a schedule** or deallocate it when it is not in use. It is the largest single lever: up to INR 7,716 a
   month.
3. **Run the pilot in windows**, not open-ended. A week costs about INR 759 to 1,432; delete the resource group at the end
   (or stop the database: compute stops, storage and backups continue).
4. **Keep the budget in the template** (`enableBudget`, `budgetAmount`, default **INR 4,500** on the resource group, in
   the _billing_ currency: the resource has no currency property, so check it). Notifications at 50%, 80% and 100% of
   actual cost and 100% of forecast cost go to `SWARM_ALERT_EMAIL`: INR 2,250, 3,600 and 4,500. An always-on month costs
   INR 4,068 to 6,642, so the forecast alert fires in anything but an idle month: **that is intended**. It is the point at which a person
   decides to carry on, on purpose, or to stop.
5. **Keep the in-app limits** (`projectModelCallLimit` 1,500, `projectModelTokenLimit` 4,000,000) and the token alert.

**Stop if** (all as fractions of the assumed US$150 ≈ INR 14,284 credit; recompute with the real number):

| #   | Stop the pilot's spend and investigate if...                                                                                   | Because                                                                                              | "Stop" means                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| S1  | The credit and the spending limit cannot be read before the first deployment                                                   | Starting blind is how a credit disappears                                                            | Do not provision                                                                           |
| S2  | Month-to-date cost of the **whole subscription** passes **50% of the credit (INR 7,142)** before the 20th of the billing month | The run-rate would end the month past the credit, with the VM on                                     | Deallocate the VM; stop the database; decide                                               |
| S3  | Month-to-date cost passes **75% (INR 10,713)** at any time                                                                     | The last quarter is the emergency reserve                                                            | Everything non-essential off; consider deleting the pilot group                            |
| S4  | The **resource group's budget** forecast alert fires and nobody decides within **one working day**                             | The forecast says the month leaves the planned envelope                                              | Treat as S2                                                                                |
| S5  | Any single day's cost passes **INR 500** (about 2.3 × the pilot's busy daily run-rate of INR 218)                              | A runaway (a model loop, a crawler) shows in a day, not at month end                                 | Set `projectModelCallLimit` and `projectModelTokenLimit` to 1 and redeploy; find the cause |
| S6  | The **token alert** (2,000,000 tokens an hour) fires, or `model.budget.exhausted` audit events arrive in bulk                  | The application sees spend hours before Cost Management does                                         | As S5                                                                                      |
| S7  | The **spending limit is ON** and month-to-date cost passes **80% of the credit**                                               | At 100% Azure disables resources: the database stops without warning, which is an outage, not a bill | Stop deliberately, before Azure does                                                       |

Emergency stop, cheapest first: deallocate the VM (`az vm deallocate`); stop the database (`az postgres flexible-server
stop`, which Azure undoes after seven days); deactivate every revision of the app (`az containerapp revision
deactivate`, which stops the replica and the job runner: the template forbids a scale-to-zero _setting_, not an operator
deciding to stop); delete the resource group (ends everything).

## Reuse, do not duplicate

The pre-flight lists what already exists and prints, for each, the variable to set. Every one of these is **optional**;
empty means "create it".

| Variable                                       | Reuses                                                            | What the template then does to it                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SWARM_AI_ACCOUNT_RESOURCE_ID` (**required**)  | The Foundry / Azure OpenAI account                                | One role assignment (`Cognitive Services OpenAI User`) for the app identity                                                                                           |
| `SWARM_EXISTING_POSTGRES_SERVER_ID`            | A PostgreSQL flexible server (the most expensive duplicate)       | **Adds the database `swarm` only.** No administrator, firewall rule or setting is touched; an administrator of that server must create the application's role (below) |
| `SWARM_EXISTING_REGISTRY_ID`                   | A container registry                                              | One `AcrPull` assignment                                                                                                                                              |
| `SWARM_EXISTING_WORKSPACE_ID`                  | A Log Analytics workspace                                         | Nothing; it receives the logs                                                                                                                                         |
| `SWARM_EXISTING_APPINSIGHTS_ID`                | An Application Insights component (must have local auth disabled) | One `Monitoring Metrics Publisher` assignment                                                                                                                         |
| `SWARM_EXISTING_KEYVAULT_ID`                   | A Key Vault (must use Azure RBAC)                                 | One `Key Vault Secrets User` assignment                                                                                                                               |
| `SWARM_EXISTING_CONTAINER_APPS_ENVIRONMENT_ID` | A workload-profiles Container Apps environment                    | Nothing; the app is created in it                                                                                                                                     |

Using an existing resource in another resource group needs the right to write a role assignment _there_. Every
reused-resource path is **unverified** against Azure.

## What the owner must do

**Roles** (the pre-flight prints whether the signed-in principal appears to hold them; it cannot prove it):

| On                                                                  | Role                                                                                                                                                                                     | For                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| The new resource group                                              | **Contributor**, plus **User Access Administrator** or **Role Based Access Control Administrator** (or Owner)                                                                            | Create everything, and assign the four roles to the app identity    |
| The existing AI account (and any reused registry, vault, component) | A role that can write role assignments there                                                                                                                                             | The one assignment on each                                          |
| The subscription                                                    | Permission to register resource providers (Contributor includes it); a role that may create budgets (`Microsoft.Consumption/budgets/write`; **unverified** whether Contributor suffices) | `provider register`; the budget                                     |
| Entra                                                               | **Application Administrator**, or the tenant allows users to register applications                                                                                                       | The app registration, its redirect URI and the federated credential |

**Authentication.** Either `az login` by a person who holds those roles, or a service principal or managed identity that
does (a federated credential is preferable to a secret). No workflow in this repository deploys, so this is a human step.

**First-deploy sequence** (every step before the third is offline or read-only):

1. `npm run iac:validate` (offline: compile, lint, evaluate).
2. `npm run azure:preflight -- --subscription <id>`; read it; read the credit and the spending limit in the portal.
3. Create the resource group (tags `app=swarm-lab`, `purpose=pilot`) and the Entra app registration
   ([pilot-plan.md](../azure/pilot-plan.md)); set `SWARM_AI_ACCOUNT_RESOURCE_ID`, `SWARM_AUTH_CLIENT_ID`,
   `SWARM_ALERT_EMAIL` (and the optional ones).
4. `az deployment group what-if --resource-group <group> --parameters infra/pilot/main.bicepparam`; read it; then
   `az deployment group create`. **Expect to fix something Azure objects to: it has never seen these templates.** The
   first deployment starts a placeholder image on port 80.
5. Finish the Entra steps that need the address; make the first release ([release-process.md](./release-process.md)), which
   replaces the placeholder with an image tagged by commit SHA; run the smoke test.
6. **Before any real data**: run the rollback drill and a database restore drill ([runbook.md](./runbook.md)). Neither has
   been run.

**If the pilot reuses an existing PostgreSQL server**, an administrator of that server must create the database role for
the app's managed identity (`SELECT * FROM pgaadauth_create_principal('<identity name>', false, false);`, then grant it what
the migrations need on the `swarm` database), because the template deliberately does not make the application an
administrator of a server other things may use. The exact grants have not been derived or tested.

## What is unverified

Everything that depends on Azure behaving as the templates assume. In this page specifically:

- **The credit amount (US$150), the spending-limit state, and all spend to date**: not read.
- **Free grants** apply as assumed (the per-subscription Container Apps grant to idle seconds, the shared metric-alert
  series, Log Analytics 5 GB), and **that Visual Studio dev/test pricing does not change the VM or other rates**.
- **That alert rules are prorated** when deleted early.
- **The doubling for a zone-redundant standby and the geo-redundant backup price**: Microsoft documentation, not the API.
- **Whether Burstable PostgreSQL, zone redundancy, geo-redundant backup and Container Apps are offered in Central India
  for this subscription**: the pre-flight reads what `az` exposes; "region restricted" is only found by deploying.
- **The metric names, dimensions and log lines the alert rules read** ([observability.md](./observability.md)).
- **Every reused-resource path, the private-networking path, the Key Vault secret path, and the blue/green revision and
  traffic behaviour**: compiled and evaluated offline only.
