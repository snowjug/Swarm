# Public edition: deployment guide

For the owner, who runs the live deployment. **Nothing in this document has been run against Azure**: the template was
compiled and evaluated offline, and what was and was not checked is in [What was not verified](#18-what-was-not-verified).
Every command that changes something is marked **OWNER**. Placeholders are in `<angle brackets>`; no value of yours
belongs in a file in the repository.

> **A budget is an alert. It does not stop spend, and Azure's cost data arrives hours late.** The protection that works in
> real time is the application's own daily cap (`FREE_GLOBAL_DAILY_TOKENS` and `FREE_GLOBAL_DAILY_COST_USD`), which counts
> every model call as it is made and does not depend on Azure's billing. The budget is the second line: at 100 and 120
> percent it e-mails you and calls a webhook that turns the free tier **off** (it cannot turn it on). Choose the caps first.

> **No sign-in?** With `SWARM_PUBLIC_GUEST_MODE=true` a visitor presses "Try it now" and gets a temporary private workspace, and
> **no OAuth app and no OAuth secret is needed**: [section 6](#6-the-oauth-apps) becomes optional and [section 7](#7-the-secrets)
> needs only the pepper. Read [section 19](#19-guest-mode-no-sign-in) before you register anything.

Decisions only you can make (the caps, the model and its quota, the legal text, the domain, the budget, who the
administrators are) are in [DECISIONS-FOR-OWNER.md](DECISIONS-FOR-OWNER.md). The design is in [DESIGN.md](DESIGN.md);
this guide builds to its section 3 (configuration) and section 11 (what cannot be verified here).

## Contents

1. [What is created, and in what order](#1-what-is-created-and-in-what-order)
2. [Prerequisites](#2-prerequisites)
3. [The model account and deployment](#3-the-model-account-and-deployment)
4. [Your environment file](#4-your-environment-file)
5. [First deployment: the foundation](#5-first-deployment-the-foundation)
6. [The OAuth apps](#6-the-oauth-apps)
7. [The secrets](#7-the-secrets)
8. [The image](#8-the-image)
9. [Second deployment: the app](#9-second-deployment-the-app)
10. [First-run verification](#10-first-run-verification)
11. [Before you open it to the public](#11-before-you-open-it-to-the-public)
12. [Custom domain](#12-custom-domain)
13. [Operating it](#13-operating-it)
14. [Costs](#14-costs)
15. [Stopping and rolling back](#15-stopping-and-rolling-back)
16. [Teardown](#16-teardown)
17. [When a deployment is refused](#17-when-a-deployment-is-refused)
18. [What was not verified](#18-what-was-not-verified)
19. [Guest mode (no sign-in)](#19-guest-mode-no-sign-in)

## 1. What is created, and in what order

[`infra/public/main.bicep`](../../infra/public/main.bicep) deploys at **subscription scope** and creates its own resource group
(`rg-swarm-public` by default). It is a separate deployment from the pilot: it shares no resource and no name with it, it
reuses the pilot's modules by reference and changes none of them, and a name that contains `pilot` is refused.

| Created                                                       | Notes                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Resource group, user-assigned managed identity                | The identity is the only credential holder: database, model, registry, vault and telemetry all use its Entra token             |
| Log Analytics workspace, Application Insights                 | Local (key) authentication off                                                                                                 |
| Key Vault                                                     | RBAC, soft delete, **purge protection** (90 days). Holds up to four secrets that you put there; none is in the template        |
| Container Registry (Basic)                                    | Admin user off, no anonymous pull; the identity pulls with `AcrPull`                                                           |
| PostgreSQL flexible server (Burstable B1ms), database `swarm` | Microsoft Entra only, TLS required. The app's identity is the server's administrator                                           |
| Container Apps environment (Consumption profile)              |                                                                                                                                |
| **One container app**                                         | External HTTPS only, **one replica at most**, 0.5 vCPU and 1 GiB, single-revision mode, probes. Only when `deployApp=true`     |
| Metric alert rules and an e-mail action group                 | Errors, restarts, database. Only when `deployApp=true`                                                                         |
| Budget, and two action groups                                 | 50, 80, 100 and 120 percent and a forecast. 100 and 120 call the free-tier-off webhook                                         |
| Four role assignments                                         | `AcrPull`, `Monitoring Metrics Publisher`, `Key Vault Secrets User`, and `Cognitive Services OpenAI User` on the model account |

**Referenced, never created:** the Azure OpenAI / Foundry account and its model deployment. The template reads the
deployment (it must exist) and adds the one role assignment on the account. It creates nothing there.

**Why two deployments.** A Container Apps secret that points at Key Vault must exist when the app is created, and the template
must not hold a secret. So the order is fixed:

1. `deployApp=false`: everything except the app. The outputs give the site's address.
2. By hand: register the OAuth apps with that address (not needed in guest mode, [section 19](#19-guest-mode-no-sign-in)), put the secrets in the vault, build the image.
3. `deployApp=true`: the app, with references to secrets that now exist.

**Why single-revision mode and one replica** (both differ from the pilot, and the template fixes them). A person's own model key
lives in the memory of one process. The pilot keeps the previous revision running so that a rollback is a traffic change; here
that would be a second process with its own job runner and no keys. In single-revision mode the platform starts the new
revision, waits for its probes, moves all traffic, then removes the old one; a revision that fails to start never takes
traffic. `maxReplicas` is not a parameter: it is 1.

## 2. Prerequisites

- **A subscription you may put a public service in** (decision 8) and **Owner** on it: the template creates a resource
  group, role assignments and a subscription budget. Sign in as **yourself**, not as the development VM's service principal:
  `az login`, then `az account set --subscription <subscription id>`.
- **Tools:** Azure CLI with Bicep (`az bicep install`, `az bicep version`), `jq`, `openssl`, `curl`, `git`, Node 24 and `npm ci`
  in the repository (only for `iac:validate`), and `psql` for the database check.
- **Resource providers**, once per subscription (a new one fails with `MissingSubscriptionRegistration`). Registering is a
  change, so it is yours:

  ```bash
  for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL \
            Microsoft.Insights Microsoft.ManagedIdentity Microsoft.CognitiveServices Microsoft.Consumption Microsoft.KeyVault; do
    az provider register --namespace "$ns"        # OWNER
  done
  for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL \
            Microsoft.Insights Microsoft.ManagedIdentity Microsoft.CognitiveServices Microsoft.Consumption Microsoft.KeyVault; do
    echo "$ns $(az provider show --namespace "$ns" --query registrationState -o tsv)"   # wait until every one says Registered
  done
  ```

- **Shell variables used below** (set them once per shell):

  ```bash
  export SUB=<subscription id>
  export LOCATION=<region, for example centralindia>
  export SWARM_PUBLIC_ENV_NAME=swarm-public          # a NEW name, never the pilot's
  export RG=rg-$SWARM_PUBLIC_ENV_NAME
  export APP=ca-$SWARM_PUBLIC_ENV_NAME
  export DEPLOYMENT=swarm-public-$(date -u +%Y%m%d)-1    # a new name for every apply: -2, -3, ...
  az account set --subscription "$SUB"
  out() { az deployment sub show --name "$DEPLOYMENT" --query properties.outputs -o json \
          | jq -r --arg n "$1" 'to_entries[] | select(.key | ascii_downcase == ($n | ascii_downcase)) | .value.value'; }
  ```

  `out` reads one output of the deployment. It matches the name case-insensitively because Azure may change the first letter's case.

- **Read-only checks before anything is made:**

  ```bash
  az account show --query "{name:name, id:id, state:state}" -o table
  az group exists --name "$RG"     # must print false: the template creates the group, and must never be pointed at one that exists
  ```

- **Region.** Use the model account's region unless the database is refused there. The pilot's own deployment was refused
  Burstable in Central India (`SkuNotAvailable`, although `list-skus` showed it); if yours is, set
  `SWARM_PUBLIC_DATABASE_SKU_NAME=Standard_D2ds_v4` and `SWARM_PUBLIC_DATABASE_SKU_TIER=GeneralPurpose` (about eight times the
  price, [pilot-cost.md](../azure/pilot-cost.md#what-exists-now-5-november-2026)) and keep both set on every later apply.

## 3. The model account and deployment

The free tier needs an **existing** Azure OpenAI / Foundry account with a **non-reasoning** deployment (decision 3): the
public edition's own account, never the pilot's `gpt-5-mini` deployment, which spends hidden reasoning tokens. If you already
have one, skip to the next section and note its resource ID and the deployment's name.

**This step creates billable resources, and is yours.** The repository's
[`infra/main.bicep`](../../infra/main.bicep) makes an Entra-only account (keys off) in its own resource group, with one
deployment. List what your region offers first (read-only), then preview, then create:

```bash
az cognitiveservices model list --location "$LOCATION" \
  --query "[?model.name=='gpt-4.1-mini'].{name:model.name, version:model.version, skus:model.skus[].name}" -o json
az cognitiveservices usage list --location "$LOCATION" --query "[?contains(name.value,'gpt-4.1-mini')]" -o table   # quota

AI_ARGS=(--location "$LOCATION" --template-file infra/main.bicep --parameters
  environmentName=swarm-public-ai resourceGroupName=rg-swarm-public-ai location="$LOCATION"
  modelName=gpt-4.1-mini modelVersion=<version from the list> deploymentSku=GlobalStandard
  deploymentName=gpt-4.1-mini deploymentCapacity=<thousands of tokens a minute, 1 to 100>
  tags='{"purpose":"public-edition-model"}')
az deployment sub what-if --name swarm-public-ai-whatif "${AI_ARGS[@]}"
az deployment sub create  --name swarm-public-ai "${AI_ARGS[@]}"                       # OWNER, billable
az cognitiveservices account list -g rg-swarm-public-ai --query "[].{name:name, id:id}" -o json
```

`GlobalStandard` is pay per token with no standing charge, and may process prompts in any Azure region: a data-residency choice
that is yours. **Name the deployment after its model** (`gpt-4.1-mini`, as above): the page tells a person which model read
their question ("Read by a model · gpt-4.1-mini"), and the name of the deployment is what it says. Nothing else about the
deployment or the account is shown to anyone. A deployment type with **no quota** in your subscription fails the create; try another type or region. The
model name `gpt-4.1-mini` and its price are an example: read the price for **your** SKU and region from the Azure OpenAI
pricing page. The application will not start without a price for the deployment, and the cap is only as good as that price
([pilot-cost.md](../azure/pilot-cost.md#model-usage-usage-based-separate) lists `gpt-4.1-mini` Global Standard at US$0.40 in and
US$1.60 out per million tokens, East US 2, read on 30 October 2026).

Keep the account in **its own resource group**, not in the one this template creates: deleting the public edition's group
must never delete the model account and its quota, and the template refuses to create a group that already exists.

## 4. Your environment file

Every value is read from the environment by [`main.bicepparam`](../../infra/public/main.bicepparam), and an unset required one
stops the deployment before anything is created. **Keep one file and export all of it on every apply**: a variable that is
left out puts its default back, so a cap you lowered is silently raised again.

Make the file **outside the repository**, readable by you only (`chmod 600`), and never commit it:

```bash
# ~/swarm-public.env
export SWARM_PUBLIC_ENV_NAME=swarm-public
export SWARM_PUBLIC_AI_ACCOUNT_RESOURCE_ID=<resource ID of the model account>                # REQUIRED
export SWARM_PUBLIC_AI_DEPLOYMENT_NAME=<its non-reasoning deployment, named after its model, for example gpt-4.1-mini>   # REQUIRED
export SWARM_PUBLIC_MODEL_INPUT_PRICE_USD=<US$ per million input tokens, for example 0.40>    # REQUIRED
export SWARM_PUBLIC_MODEL_OUTPUT_PRICE_USD=<US$ per million output tokens, for example 1.60>  # REQUIRED
export SWARM_PUBLIC_ALERT_EMAIL=<where alerts and budget notices go>                          # REQUIRED
export SWARM_PUBLIC_BUDGET_AMOUNT=<monthly budget, a whole number>                            # REQUIRED, no default
export SWARM_PUBLIC_BUDGET_CURRENCY=<three letters, your billing currency>                    # REQUIRED
export SWARM_PUBLIC_ADMIN_EMAILS=<your verified Google or GitHub address, comma separated>
export SWARM_PUBLIC_SOURCE_URL=<public https address of the exact source version>             # AGPL-3.0, section 13
# Decide before you register the OAuth apps (section 12): export SWARM_PUBLIC_BASE_URL=https://<your domain>
# No sign-in and no OAuth apps (section 19):            export SWARM_PUBLIC_GUEST_MODE=true
# Closed first deployment (section 11):                 export SWARM_PUBLIC_INGRESS_ALLOWED_CIDRS=<your address>/32
# Every cap has a default from DESIGN.md section 3. To change one, set it here, for example:
#   export SWARM_PUBLIC_FREE_GLOBAL_DAILY_COST_USD=2.50
```

The caps, their variables and their defaults are in [`main.bicepparam`](../../infra/public/main.bicepparam). None can be 0 (use
`SWARM_PUBLIC_FREE_TIER_ENABLED=false` to switch the free tier off; the one exception is a guest's tokens and calls,
[section 19](#19-guest-mode-no-sign-in)), session lifetimes cannot pass the hosted limits (60 idle
minutes, 12 hours), and `SWARM_PUBLIC_MIN_REPLICAS` is 1 or 0 (**default 1**: scaling to zero would end a long run and drop every
bring-your-own-key held in memory). Two groups you may want to adjust early: sign-up throttling
(`SWARM_PUBLIC_SIGNUPS_PER_IP_PER_DAY`, default 5, and `SWARM_PUBLIC_SIGNUPS_PER_HOUR`, default 60) and the session lifetimes
(`SWARM_PUBLIC_SESSION_IDLE_MINUTES`, default 30, and `SWARM_PUBLIC_SESSION_ABSOLUTE_HOURS`, default 8). `TRUST_PROXY` is fixed at
1 and has no variable: without it every per-address limit would count all visitors as the platform's ingress, and the application
refuses to start in production with 0.

**The webhook key.** Make a fresh key and its SHA-256 in the shell that deploys, **every apply**. The template writes the key
into the action group's webhook address and the hash into the app, together, so you never have to keep it:

```bash
export SWARM_PUBLIC_OPS_KEY="$(openssl rand -hex 32)"
export SWARM_PUBLIC_OPS_KEY_SHA256="$(printf '%s' "$SWARM_PUBLIC_OPS_KEY" | sha256sum | cut -d' ' -f1)"
```

Never print the key or paste it anywhere. Azure shows a webhook's address to whoever can read the action group, so keep that
role narrow; the key can only turn the free tier **off**.

## 5. First deployment: the foundation

```bash
source ~/swarm-public.env
export SWARM_PUBLIC_DEPLOY_APP=false      # REQUIRED, no default: false now, true in section 9
# (the key and its hash from section 4 are exported)
```

**What-if first** (read-only). It previews the deployment and changes nothing. Use a stand-in key, so that the real one cannot
reach the output: a what-if prints the properties it would set, and a webhook's address is one of them.

```bash
SWARM_PUBLIC_OPS_KEY=stand-in-key-for-the-what-if-only-0000 \
  az deployment sub what-if --name "$DEPLOYMENT-whatif" --location "$LOCATION" \
    --parameters infra/public/main.bicepparam
```

**What to look for.**

- **No error.** A refusal names a parameter ([section 17](#17-when-a-deployment-is-refused)); a missing required value is
  named by its variable. Fix it and run the what-if again.
- **Only `Create`.** The group, the identity, the workspace, Application Insights, the vault, the registry, the PostgreSQL
  server with its database, firewall rule, TLS setting and administrator, the environment, four role assignments, two action
  groups and the budget. **No `Modify` and no `Delete` of anything**: nothing exists yet. Anything you did not expect to
  exist is a sign that a variable is wrong.
- **Nothing under `Microsoft.CognitiveServices`** except the one role assignment on your account, in **its** group.
- **The container app is not in this one.** It comes in section 9.
- A what-if may show **less** than the deployment makes: it cannot always expand a nested deployment into a group that does not
  exist yet. That is a limit of the preview, not a finding.

**Deploy** (OWNER, creates billable resources):

```bash
az deployment sub create --name "$DEPLOYMENT" --location "$LOCATION" \
  --parameters infra/public/main.bicepparam \
  --query "{state:properties.provisioningState, outputs:properties.outputs}" -o json
```

Read the outputs again with `out`. The ones you need now:

```bash
out OAUTH_REDIRECT_URI_GOOGLE ; out OAUTH_REDIRECT_URI_GITHUB     # register these exactly (section 6)
out AZURE_KEY_VAULT_NAME      ; out AZURE_CONTAINER_REGISTRY_NAME  # sections 7 and 8
```

If a deployment fails half way, fix the cause and apply again with a new `$DEPLOYMENT` name: it is incremental. A failed
PostgreSQL server keeps its name for a few minutes while it is dropped (`ServerNameAlreadyExists`): wait, do not rename.

## 6. The OAuth apps

**Skip this section in guest mode** ([section 19](#19-guest-mode-no-sign-in)): with `SWARM_PUBLIC_GUEST_MODE=true` no OAuth app is
needed. Do it only if you also want people to be able to sign in.

Register them under an account you control and will not lose (decision 7). You need the two redirect URIs of section 5. The
page's address is `https://<app>.<environment domain>` unless you set `SWARM_PUBLIC_BASE_URL`; with a custom domain, decide the
domain **first** (section 12) so that these are the final addresses. Register Google, GitHub, or both.

**Google** (UI wording changes; what matters is the type, the exact redirect URI, the two scopes and the publishing status):

1. In the [Google Cloud console](https://console.cloud.google.com/), create or choose a project of your own.
2. **Google Auth Platform** (formerly "APIs & Services", "OAuth consent screen"): set the app name, a support address and a
   contact address; **Audience: External**. The app asks for the scopes `openid` and `email` only, which are not sensitive, so
   no Google review is needed for them. Add no logo.
3. **Clients, Create client, Application type: Web application.** Under **Authorised redirect URIs** add
   `https://<host>/auth/callback/google`, exactly. No JavaScript origin is needed: the exchange happens on the server.
4. Copy the **client ID** (it goes in `SWARM_PUBLIC_GOOGLE_CLIENT_ID`) and the **client secret**. The secret may be shown only
   once.
5. **Audience: publish the app ("In production").** While it is in "Testing", only the test users you list can sign in.

**GitHub:**

1. Your account or organisation, **Settings, Developer settings, OAuth Apps, New OAuth App.**
2. Homepage URL `https://<host>`, **Authorization callback URL `https://<host>/auth/callback/github`**, exactly. A GitHub OAuth app
   has **one** callback URL: moving to another domain later means editing it. Leave Device Flow off.
3. **Register application**, copy the **Client ID** (`SWARM_PUBLIC_GITHUB_CLIENT_ID`), then **Generate a new client secret** and
   copy it.

The application asks GitHub for the scope **`user:email`** and nothing else (`backend/src/public/identity/github.ts`; design in
[DESIGN.md section 4.2](DESIGN.md#42-the-provider-interface-backendsrcpublicidentity)): it needs the person's _primary verified_ address,
and the account is refused without one. It asks Google for `openid email` and requires `email_verified`.

## 7. The secrets

Up to four secrets go in the vault, by you, with a data-plane role that the template gives to nobody. **In guest mode with no OAuth
app, only `public-pepper` is needed** (and `turnstile-secret-key` if you use Turnstile): skip the provider rows below. **Never** put a
value on a command line, in a file in the repository, in a ticket or in `$SWARM_*`. `az keyvault secret set` prints the secret in its
reply: every command below ends in `--output none`.

```bash
VAULT=$(out AZURE_KEY_VAULT_NAME)
VAULT_ID=$(az keyvault show --name "$VAULT" --resource-group "$RG" --query id -o tsv)
az role assignment create --role "Key Vault Secrets Officer" --scope "$VAULT_ID" \
  --assignee-object-id "$(az ad signed-in-user show --query id -o tsv)" --assignee-principal-type User      # OWNER; wait a few minutes
```

| Vault secret                  | Value                                                       | Needed                               |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| `public-pepper`               | 64 random hexadecimal characters (at least 32 are required) | **Always**                           |
| `public-google-client-secret` | the Google client secret                                    | If `SWARM_PUBLIC_GOOGLE_CLIENT_ID`   |
| `public-github-client-secret` | the GitHub client secret                                    | If `SWARM_PUBLIC_GITHUB_CLIENT_ID`   |
| `turnstile-secret-key`        | the Cloudflare Turnstile secret key                         | If `SWARM_PUBLIC_TURNSTILE_SITE_KEY` |

```bash
# The pepper: made here, put straight into the vault, never shown.
openssl rand -hex 32 | tr -d '\n' | az keyvault secret set --vault-name "$VAULT" --name public-pepper --file /dev/stdin --output none

# A provider secret: typed without echo, not kept.
read -rsp 'Google client secret: ' S; echo
printf '%s' "$S" | az keyvault secret set --vault-name "$VAULT" --name public-google-client-secret --file /dev/stdin --output none
unset S
# the same for public-github-client-secret (and turnstile-secret-key)

az keyvault secret list --vault-name "$VAULT" --query "[].name" -o tsv      # names only: every row of the table you need must be here
```

If your Azure CLI does not accept `--file /dev/stdin`, `--value "$S"` does the same, and puts the value in the process list for
a moment.

**The pepper must never change.** It keys the hashes of addresses (sign-up throttling) and of deleted accounts. Changing it, or
losing it, makes the application forget the counters of deleted accounts, so a person could delete their account and sign up
again with a fresh lifetime allowance. The vault is its backup: it is soft-deleted and purge-protected for 90 days.
Container Apps reads a secret when a replica **starts**, so a changed secret takes effect only in a new revision (section 13).

When you are done, take the role back: `az role assignment delete --role "Key Vault Secrets Officer" --scope "$VAULT_ID" --assignee <your object id>`.
The application's identity holds `Key Vault Secrets User`, which can read a value and nothing else.

## 8. The image

Edit `legal/terms.md` and `legal/privacy.md` first, and **commit** (section 11): the `Dockerfile` copies `legal/` into the image,
and an image is built from one commit with a clean working tree.

```bash
git status --porcelain            # must print nothing
SHA=$(git rev-parse HEAD)
REGISTRY=$(out AZURE_CONTAINER_REGISTRY_NAME)
az acr build --registry "$REGISTRY" --image "swarm:$SHA" --file Dockerfile .                       # OWNER
DIGEST=$(az acr repository show --name "$REGISTRY" --image "swarm:$SHA" --query digest -o tsv)
az acr repository update --name "$REGISTRY" --image "swarm:$SHA" --write-enabled false --delete-enabled false   # OWNER: the tag keeps meaning one image
export SWARM_PUBLIC_CONTAINER_IMAGE="$(out AZURE_CONTAINER_REGISTRY_ENDPOINT)/swarm@$DIGEST"
export SWARM_PUBLIC_BUILD_SHA="$SHA"
```

The app runs the image **by digest**, so what runs cannot change under a name. It must come from this registry (the identity
can pull from no other, and the template refuses another). Registry build tasks are unavailable on some free and student
subscriptions; then build with Docker, `az acr login --name "$REGISTRY"`, `docker push`, and read the digest from the registry.

This follows the pilot's process ([release-process.md](../production/release-process.md), "The first release"): the first image
goes on through the template, never through `az containerapp update`. The release tool does not drive the public edition yet:
[section 13](#13-operating-it) says which of its actions work.

## 9. Second deployment: the app

```bash
source ~/swarm-public.env
export SWARM_PUBLIC_DEPLOY_APP=true
export SWARM_PUBLIC_GOOGLE_CLIENT_ID=<client ID>        # and/or SWARM_PUBLIC_GITHUB_CLIENT_ID; at least one, unless SWARM_PUBLIC_GUEST_MODE=true (section 19)
# SWARM_PUBLIC_CONTAINER_IMAGE and SWARM_PUBLIC_BUILD_SHA from section 8
export SWARM_PUBLIC_OPS_KEY="$(openssl rand -hex 32)"
export SWARM_PUBLIC_OPS_KEY_SHA256="$(printf '%s' "$SWARM_PUBLIC_OPS_KEY" | sha256sum | cut -d' ' -f1)"
export DEPLOYMENT=swarm-public-$(date -u +%Y%m%d)-2

SWARM_PUBLIC_OPS_KEY=stand-in-key-for-the-what-if-only-0000 \
  az deployment sub what-if --name "$DEPLOYMENT-whatif" --location "$LOCATION" --parameters infra/public/main.bicepparam
```

**What to look for:** `Create` of the container app and the alert rules, and nothing else of substance. In the app: `ingress.allowInsecure
false`, `maxReplicas 1`, `activeRevisionsMode Single`, `cpu 0.5` and `memory 1Gi`, a `secrets` list of Key Vault URLs with **no
`value`**, `PUBLIC_PEPPER` and the client secrets as `secretRef` (in guest mode with no OAuth app: `PUBLIC_PEPPER` alone, and no client ID), `TRUST_PROXY 1`, `SWARM_EDITION public`, `DEPLOYMENT_MODE production`, **no
`AUTH_` variable except the two session limits, no `FOUNDRY_DEPLOYMENT_REASONING`**, and the image you built. The budget and the action
groups may show as `Modify` because the budget's start date and the webhook address are recomputed: read them, do not worry. The
key does not appear in the preview, because you gave a stand-in.

**Deploy** (OWNER):

```bash
az deployment sub create --name "$DEPLOYMENT" --location "$LOCATION" \
  --parameters infra/public/main.bicepparam \
  --query "{state:properties.provisioningState, outputs:properties.outputs}" -o json
az containerapp revision list -g "$RG" -n "$APP" \
  --query "[].{name:name, active:properties.active, running:properties.runningState, health:properties.healthState}" -o table
```

Wait for `Running` (the first start migrates the schema and sets up row security, and the startup probe allows about two
minutes). If the app cannot be created because a vault secret does not exist, Azure names its address (wording **unverified**):
put the secret ([section 7](#7-the-secrets)) and apply again.

**If the revision does not start,** read the console log:

```bash
az containerapp logs show -g "$RG" -n "$APP" --type console --tail 100
az containerapp logs show -g "$RG" -n "$APP" --type system --tail 50
```

- **`Row-level security is not in force, so the public edition will not start: …`** is the application's start-up self-check
  refusing to run on a database that does not enforce the isolation. The text after the colon names what is wrong
  (`Row security is not enabled on "<table>"`, `The role "swarm_app" is a superuser`, `A workspace that owns nothing can see
projects`). It is how you learn, on the first deploy, whether the managed PostgreSQL honours the setup. The role setup then
  needs fixing: check that the identity is a server administrator (below), then read the queries in section 10.
- **`permission denied to create role`** or a connection error: the identity is not an administrator of the server.
  `az postgres flexible-server microsoft-entra-admin list --resource-group "$RG" --server-name <server>` must list it as a
  `ServicePrincipal`. The template adds it only when it **creates** the server.
- **`Invalid server configuration: <NAME>.`** names a setting that is wrong; it never repeats the value.
- **`DEPLOYMENT_MODE=production refuses to start`** lists every unsafe setting at once.

## 10. First-run verification

`FQDN=$(out AZURE_CONTAINER_APP_FQDN)`, or your custom domain. The first five need no sign-in.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "https://$FQDN/api/health/live"       # 200
curl -sS "https://$FQDN/api/health/ready"                                       # {"status":"ready","checks":{"database":"ok"}}
curl -sS "https://$FQDN/api/public/status"  | jq    # status "ok"; freeTier.available true; byokEnabled; signupsOpen
curl -sS "https://$FQDN/api/public/session" | jq    # edition "public"; signedIn false; providers lists exactly the ones you configured (guest mode: guestMode true)
curl -sS "https://$FQDN/" | grep -o '<meta name="swarm-edition"[^>]*>'          # content="public"
curl -sS -o /dev/null -w '%{http_code}\n' "http://$FQDN/"                        # a redirect to https (301 or 302): plain HTTP is not served
```

Do **not** use `npx tsx scripts/azure/pilot-smoke.ts` or `azure:release` smoke tests: they expect the pilot's Microsoft sign-in
redirect, which this edition does not have.

Then, in a browser, each once. **In guest mode** ([section 19](#19-guest-mode-no-sign-in)) there is no sign-in and no Admin page: press
"Try it now" for step 1, read the usage with the owner key instead of the Admin page in step 2, and use the owner key for the kill
switch in step 5.

1. **Sign in with Google, then with GitHub** (a second account if you can). Each is a separate account: the same address through
   both is two accounts, by design. A refused sign-in returns to `/?signin=<reason>`.
2. **A signed-in free run.** Create a project from an example and run a model-assisted step. The meter shows "N free runs left
   today". On the Admin page (your address is in `PUBLIC_ADMIN_EMAILS`) the day's tokens and cost are above 0 and far below the caps.
   If the call fails, the message says why; read [`docs/production/runbook.md`](../production/runbook.md#the-model-verify-the-connection-and-read-what-fails)
   and check that the identity holds `Cognitive Services OpenAI User` on the account.
3. **Isolation, by hand.** Make a project as one account and, signed in as the other, try its address: it must say "not found".
4. **Bring your own key.** Connect a throwaway Gemini key with a spend limit and run one step. Nothing the key could be found
   in must appear in the console log. This also proves what the design could not check: Gemini's compatibility endpoint
   accepting the client's requests.
5. **The admin kill switch.** On the Admin page turn the free tier **off**. `GET /api/public/status` now says
   `freeTier.available: false, reason: "disabled"`, and a person is told to use their own key. Turn it **on** again.
   (The same call: `POST /api/admin/free-tier {"enabled": false}`, an administrator's session, with `X-Swarm-CSRF: 1`.)

**The budget webhook.** Prove that the key and its hash belong together, and that a wrong key is refused. **The second call turns
the free tier off**; turn it back on afterwards (from the Admin page, or in guest mode with the owner key,
[section 19](#19-guest-mode-no-sign-in)).

```bash
FQDN=$(out AZURE_CONTAINER_APP_FQDN)
# A wrong key: refused (401). Nothing changes.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "https://$FQDN/api/ops/free-tier/off?key=not-the-key-0000000000000000000000"
# The right key, which is not put on the command line: turns the free tier off, and answers {"freeTier":"off"}.
curl -sS -X POST -K <(printf 'url = "https://%s/api/ops/free-tier/off?key=%s"\n' "$FQDN" "$SWARM_PUBLIC_OPS_KEY")
curl -sS "https://$FQDN/api/public/status" | jq .freeTier
```

A `404 NOT_AVAILABLE` means `PUBLIC_OPS_KEY_SHA256` was not set. The call is rate limited (10 a minute). It can only turn the free
tier off. That Azure itself calls it is a separate fact: the action group's own **Test action group** button in the portal sends
a test payload to the webhook (and turns the free tier off, so turn it on again). A real budget notice cannot be forced.

**Row-level security on the real database**, read-only. Add yourself as an administrator and open the server to your address,
temporarily (both are changes, so both are yours, and the template does not know about either):

```bash
SERVER=$(out AZURE_POSTGRES_SERVER_NAME); IDENTITY=$(out AZURE_USER_ASSIGNED_IDENTITY_NAME)
az postgres flexible-server microsoft-entra-admin create --resource-group "$RG" --server-name "$SERVER" \
  --display-name "$(az ad signed-in-user show --query userPrincipalName -o tsv)" \
  --object-id "$(az ad signed-in-user show --query id -o tsv)" --type User                                  # OWNER
MYIP=<your public address>
az postgres flexible-server firewall-rule create --resource-group "$RG" --name "$SERVER" \
  --rule-name owner-temporary --start-ip-address "$MYIP" --end-ip-address "$MYIP"                          # OWNER, remove it below
export PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)"
psql "host=$SERVER.postgres.database.azure.com port=5432 dbname=swarm user=$(az ad signed-in-user show --query userPrincipalName -o tsv) sslmode=require"
```

```sql
-- 1. The runtime role: no login, not a superuser, cannot bypass row security.   Expect one row: swarm_app | f | f | f
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'swarm_app';

-- 2. The application's own role (its name is $IDENTITY): neither a superuser nor BYPASSRLS, and it is a member of swarm_app.
SELECT r.rolname, r.rolsuper, r.rolbypassrls, pg_has_role(r.rolname, 'swarm_app', 'member') AS member_of_swarm_app
  FROM pg_roles r WHERE r.rolname = '<identity name>';

-- 3. Row security on every table that holds user data; the owner is the application's role, never swarm_app.
--    (It is enabled but not forced, by design: the runtime role is not the owner, so the policies bind it.)
SELECT c.relname, c.relrowsecurity AS enabled, pg_get_userbyid(c.relowner) AS owner,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;
--    Expect enabled = t and policies >= 1 on every table except swarm_schema and public_schema, which hold no user data.

-- 4. The policies themselves.   Expect swarm_scope (and swarm_scope_read, swarm_scope_write on audit_events).
SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;

-- 5. What swarm_app may do, table by table.   Expect no grant at all on swarm_schema and public_schema.
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants WHERE grantee = 'swarm_app' GROUP BY table_name ORDER BY table_name;
```

Then take the access back:

```bash
az postgres flexible-server firewall-rule delete --resource-group "$RG" --name "$SERVER" --rule-name owner-temporary --yes     # OWNER
az postgres flexible-server microsoft-entra-admin delete --resource-group "$RG" --server-name "$SERVER" --object-id "$(az ad signed-in-user show --query id -o tsv)" --yes   # OWNER, if you do not want to stay an administrator
```

What these queries cannot show is that the policies **filter** correctly under load. The start-up self-check does the
behavioural test (a workspace that owns nothing must see nothing) on every start, and the isolation tests in the repository
run against PostgreSQL compiled to WebAssembly, not against the managed service. Check 3 above is the one you can do by hand.

## 11. Before you open it to the public

- [ ] **Terms and privacy written** (decision 6). `legal/terms.md` and `legal/privacy.md` are stubs marked "NOT YET REVIEWED", and the
      site says so until they are replaced. Replace them, commit, and build the image again (section 8). Do not open the site without them.
- [ ] **`SWARM_PUBLIC_SOURCE_URL` set** to the public address of the exact source version: the licence (AGPL-3.0) requires users of a
      network service to be offered it.
- [ ] **The caps are yours** (decision 2), and `SWARM_PUBLIC_MODEL_INPUT_PRICE_USD` and `SWARM_PUBLIC_MODEL_OUTPUT_PRICE_USD` are the real prices of **your** deployment.
- [ ] **The budget amount and the contacts are right** (decision 9). Remember what it is: an alert.
- [ ] **Administrators** are the people you mean (decision 7), by their verified address. In guest mode with no provider nobody can sign
      in, so nobody is an administrator: the owner key ([section 19](#19-guest-mode-no-sign-in)) is how you operate the site.
- [ ] **The crawler is off** (`PUBLIC_ALLOW_RESEARCH`, the default) and **bot protection** is a decision (decision 10): turn Turnstile on at
      the first sign of signup farming, with its site key in `SWARM_PUBLIC_TURNSTILE_SITE_KEY` and its secret as the vault secret.
- [ ] **The OAuth apps are published** ("In production" for Google) and registered under an account you will keep (if you use any: guest
      mode needs none).
- [ ] **In guest mode, the guest caps and the global caps are yours** ([section 19](#19-guest-mode-no-sign-in)): anyone with the link can
      use them up, and `FREE_GLOBAL_DAILY_TOKENS` and `FREE_GLOBAL_DAILY_COST_USD` are what bound a flood. `SWARM_PUBLIC_OWNER_KEY_SHA256`
      is set, and you have tried the key.
- [ ] **Deploy it closed first.** Give `SWARM_PUBLIC_INGRESS_ALLOWED_CIDRS=<your address>/32`, apply, run all of section 10, then unset it
      and apply again. While the list is set, **Azure's webhook cannot reach the app either**, so the budget cannot switch the free
      tier off: that is acceptable only while nobody else can use it.

## 12. Custom domain

The template does not create a certificate: a managed certificate needs DNS validation **after** the app exists, and the app's
domain binding is part of the app, so a deployment that does not carry it **removes** it. The procedure is two phases, then
the template learns the result.

1. **Choose the host before section 6** (a subdomain such as `swarm.example.com` is the simple case) and set
   `SWARM_PUBLIC_BASE_URL=https://swarm.example.com` from the first deployment. The OAuth redirect URIs then use that host, and the
   app accepts it (the default address stays allowed beside it; the probes and the webhook use that one, so they do not depend on
   your DNS or certificate).
2. **After section 9** (the app exists), read the two DNS values and make the records with your DNS provider:

   ```bash
   az containerapp show -g "$RG" -n "$APP" --query properties.customDomainVerificationId -o tsv     # the value of the TXT record
   out AZURE_CONTAINER_APP_FQDN                                                                      # the target of the CNAME
   #   TXT    asuid.swarm.example.com   ->  <the verification ID>
   #   CNAME  swarm.example.com         ->  <the app's default address>
   ```

   An apex domain (no subdomain) uses an `A` record and `TXT` or `HTTP` validation instead of a CNAME: read
   [Microsoft's custom-domain page](https://learn.microsoft.com/azure/container-apps/custom-domains-managed-certificates).

3. **Add the host, make the managed certificate, bind it** (OWNER; the certificate is free, and takes minutes):

   ```bash
   ENV=$(out AZURE_CONTAINER_APPS_ENVIRONMENT_NAME)
   az containerapp hostname add -g "$RG" -n "$APP" --hostname swarm.example.com
   az containerapp env certificate create -g "$RG" -n "$ENV" --certificate-name mc-swarm \
     --hostname swarm.example.com --validation-method CNAME
   az containerapp env certificate list -g "$RG" -n "$ENV" --managed-certificates-only \
     --query "[].{name:name, state:properties.provisioningState, subject:properties.subjectName}" -o table   # wait for Succeeded
   az containerapp hostname bind -g "$RG" -n "$APP" --hostname swarm.example.com --certificate mc-swarm --environment "$ENV"
   ```

4. **Teach the template**, so that a later apply keeps the binding:

   ```bash
   export SWARM_PUBLIC_CUSTOM_DOMAIN=swarm.example.com
   export SWARM_PUBLIC_CUSTOM_DOMAIN_CERTIFICATE_ID="$(az containerapp env certificate list -g "$RG" -n "$ENV" \
     --managed-certificates-only --query "[?properties.subjectName=='swarm.example.com'].id | [0]" -o tsv)"
   ```

   Put both in your environment file, run the what-if (it must show the custom domain **unchanged**), then apply. From now on, give
   both on every apply, or the domain is unbound until you bind it again. The template refuses a custom domain without its
   certificate, and one that is not the host of `SWARM_PUBLIC_BASE_URL`.

A GitHub OAuth app has one callback URL, and Google can list several: if you move from the default address to a domain, edit the
GitHub callback and add the new Google redirect URI.

## 13. Operating it

**Releasing.** `npm run azure:release` is the pilot's tool. For this deployment the resource group is `$RG`, the app is `$APP`,
the registry is the one in the outputs, and the subscription is `$SUB`:

```bash
npm run azure:release -- <action> --subscription "$SUB" --resource-group "$RG" --app "$APP" --registry "$REGISTRY"
```

| Action                                                        | For the public edition                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`, `check`                                             | Work, read-only. `check` expects the ingress on 3001, `PORT` unset or 3001, and the three probes, which is what the template sets                                                                                                                                   |
| `build --execute --confirm-resource-group "$RG"`              | Works once the app exists: builds the image of a clean commit and locks the tag. Ignore the template command it prints, which is the pilot's (`infra/pilot`); use the commands in this guide. A subscription name with "prod" in it needs `--allow-production-name` |
| `release`, `promote`, `rollback`, `finalize`, `record`, drill | **Do not use.** They need multiple-revision mode (this app is single-revision), and their smoke test expects the pilot's Microsoft sign-in redirect (`/auth/login`), which this edition does not have: a release would roll itself back                             |

So a new version is: build and lock the image (section 8), export the new `SWARM_PUBLIC_CONTAINER_IMAGE` and `SWARM_PUBLIC_BUILD_SHA`, make
a new key pair, run the what-if (the image must be the only change), apply, and read section 10 again. Single-revision mode
keeps serving the old revision until the new one passes its probes, and keeps it if the new one fails.

**Changing a setting** (a cap, the budget, a session limit) is the same: edit your environment file, what-if, apply. The image must be
given again each time: an apply with an older image rolls the app back to it.

**Rotating a secret:** put a new version in the vault, then make a new revision so that it is read (`az containerapp revision restart
--revision <name> -g "$RG" -n "$APP"`, or apply with a new image). Rotating `public-pepper` has the consequence in section 7.

**Reading the logs:** `az containerapp logs show -g "$RG" -n "$APP" --type console --tail 100`, or in the workspace
`ContainerAppConsoleLogs_CL` and `ContainerAppSystemLogs_CL` (filter on `ContainerAppName_s`). The alert rules e-mail you for
errors, restarts and the database; they are first proposals and have not fired in Azure.

## 14. Costs

Prices are the pilot's, read for one region on one date, and are **not re-read here**:
[pilot-cost.md](../azure/pilot-cost.md) (what exists now, per resource, model usage) and
[azure-preflight.md](../production/azure-preflight.md) (alert rules, the budget, unit prices). A second deployment of the same shape
costs about what the first does.

| Line                                   | Cost                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container app, always on               | 0.5 vCPU and 1 GiB, one replica: US$10 to US$34 a month (pilot-cost, East US 2, 30 October 2026). `minReplicas 0` would cost less and drop BYOK keys                                                                                                                                                                      |
| PostgreSQL                             | Burstable B1ms: about US$16 a month. **General Purpose, if Burstable is refused: about eight times that** (INR 17,800 against 2,100 in the pilot's Central India)                                                                                                                                                         |
| Container Registry (Basic)             | about US$5 a month                                                                                                                                                                                                                                                                                                        |
| Log Analytics and Application Insights | free under 5 GB a month; capped at 0.5 GB a day, which is at most about US$28 a month in the worst case                                                                                                                                                                                                                   |
| **New in this edition**                | A Key Vault (cents: a read per replica start), **six metric alert rules** (about US$1 to US$2 a month at most, some free), two more action groups and the budget (free), a managed certificate (free), egress from a public site                                                                                          |
| **Model usage**                        | **The one cost that strangers cause.** Bounded by the free tier's caps: at the defaults the token cap (2,000,000 a day) binds before the US$5 cap, at most US$3.20 a day at US$1.60 per million output tokens, about US$96 in 30 days. It is only as true as the prices you entered. A person's own key costs you nothing |

So the floor is about the pilot's (US$31 to US$61 a month with Burstable) plus the free tier's usage, which you cap. The budget
covers this group and the model account's group when it is in the same subscription; an account in another subscription is
**not** counted: give that subscription a budget of its own. If the account's group also holds other things, their cost is in the
budget too.

## 15. Stopping and rolling back

**Stop the spend, from the cheapest to the strongest.** Each is reversible except deleting things.

| What                                                     | Command                                                                                                                                                                                                                                                                      | Undo                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Free tier off, at once, shared by every replica          | The Admin page, the owner key (section 19), or the webhook of section 10 (the budget calls it)                                                                                                                                                                               | The Admin page                                            |
| Free tier off, from the environment (wins over the page) | `SWARM_PUBLIC_FREE_TIER_ENABLED=false`, apply                                                                                                                                                                                                                                | `true`, apply                                             |
| No new accounts or guests                                | The Admin page ("signups"), the owner key (section 19), or `SWARM_PUBLIC_SIGNUPS_ENABLED=false`                                                                                                                                                                              | the same                                                  |
| Close the door to everyone but you                       | `az containerapp ingress access-restriction set -g "$RG" -n "$APP" --rule-name operator-only --ip-address <your address>/32 --action Allow`                                                                                                                                  | `… access-restriction remove … --rule-name operator-only` |
| The app cannot spend on the model, whatever it does      | `az role assignment delete --assignee <identity principal id> --role "Cognitive Services OpenAI User" --scope <model account resource id>`                                                                                                                                   | `az role assignment create` with the same, or apply       |
| Stop the app                                             | `az containerapp revision deactivate -g "$RG" -n "$APP" --revision <active revision>`; if Azure refuses (**unverified**: it may not deactivate the only revision), `az containerapp delete -g "$RG" -n "$APP"`. The same name in the same environment gives the same address | `… revision activate …`, or section 9 again               |

**Scaling to zero is a second, weaker option, and not a stop.** `SWARM_PUBLIC_MIN_REPLICAS=0` lets the app sleep when idle, which saves
its idle cost, but any request wakes it, a long run is cut, and every BYOK key is lost. A budget alert could be made to do more
than turn the free tier off (an action group can call an Azure Automation runbook or a Logic App that deactivates the revision),
but that is an idea, not built here: a machine that takes the site down on a delayed cost figure is a decision for you
(decision 9). The same idea, as a small script you keep outside the repository, is a pause that stops the database
(`az postgres flexible-server stop`, which Azure undoes after seven days) and deactivates the revision, and a resume that reverses it.

**Roll back the app image.** The platform replaces the revision; going back is deploying the old image:

```bash
az containerapp revision list -g "$RG" -n "$APP" \
  --query "[].{name:name, created:properties.createdTime, active:properties.active, image:properties.template.containers[0].image}" -o table
```

Set `SWARM_PUBLIC_CONTAINER_IMAGE` to the previous image's reference, what-if, apply (or, faster, `az containerapp update -g "$RG" -n
"$APP" --image <previous reference>`, and then put the same value in your environment file so that the next apply agrees).
**A rollback of the image is not a rollback of the database.** The application migrates its schema when it starts and only goes
forward: an image older than the database's schema refuses to start (`STORAGE_VERSION`), and a bad migration needs the next
paragraph ([release-process.md](../production/release-process.md#database-schema-changes)). Note the time before any release that
carries one.

**Restore the database to a point in time.** The server keeps 7 days (`backupRetentionDays`, up to 35). A restore always makes a
**new** server, and **has not been rehearsed**: do the drill in [the runbook](../production/runbook.md#restore-the-database-to-a-new-server)
before real data arrives.

```bash
SERVER=$(out AZURE_POSTGRES_SERVER_NAME); IDENTITY=$(out AZURE_USER_ASSIGNED_IDENTITY_NAME)
az postgres flexible-server show -g "$RG" -n "$SERVER" --query backup.earliestRestoreDate -o tsv
az postgres flexible-server restore -g "$RG" --name <new server> --source-server "$SERVER" --restore-time "<2026-11-10T09:30:00+00:00>"   # OWNER
# The new server has no network rule and may not carry the Entra administrator. The application's identity must be one:
az postgres flexible-server firewall-rule create -g "$RG" -n <new server> --rule-name AllowAllAzureServicesAndResourcesWithinAzureIps --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
az postgres flexible-server microsoft-entra-admin create -g "$RG" --server-name <new server> --display-name "$IDENTITY" --object-id "$(out AZURE_USER_ASSIGNED_IDENTITY_PRINCIPAL_ID)" --type ServicePrincipal
export SWARM_PUBLIC_EXISTING_DATABASE_SERVER_NAME=<new server>
# what-if, then apply: DATABASE_URL points at the new server, and the template touches nothing else of it.
```

Without that last variable, the next apply points the app back at the old server, or makes a new, empty one. Roles live in the
server and come with a restore (**unverified**); the start-up self-check proves it. Keep the damaged server, stopped, for as long
as you may need it as evidence, then delete it: it is billed.

## 16. Teardown

The last resort, and the end of the deployment: `az group delete --name "$RG" --yes --no-wait`. That removes the database and its
backups. It does **not** remove:

- **The Key Vault**, which stays soft-deleted for 90 days with its name reserved. Purge protection means it **cannot be purged**: a new
  deployment with the same `SWARM_PUBLIC_ENV_NAME` fails until the time passes, so use another name, or recover it with `az keyvault recover`.
- **The Log Analytics workspace**, recoverable for 14 days; the same name cannot be reused meanwhile.
- **The role assignment on the model account**, which now names a deleted identity:
  `az role assignment list --scope <model account id> --query "[?principalName==''].{id:id, role:roleDefinitionName}"`, then
  `az role assignment delete --ids <id>`. Touch no other assignment.
- **The budget** (it is at the subscription): `az consumption budget delete --budget-name budget-swarm-public`.
- **The model account**, which is in its own group and yours to keep or delete, **the OAuth apps** in Google and GitHub, and your DNS records.

## 17. When a deployment is refused

Before anything is created, the template checks ([`modules/guards.bicep`](../../infra/public/modules/guards.bicep)). Azure says
`The provided value for the template parameter '<name>' is not valid … not part of the allowed value(s): 'True'`: the name is the
statement that was false.

| Parameter named                              | It means                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resourceGroupAndEnvironmentAreNotThePilots` | The environment or group name contains "pilot". Use another `SWARM_PUBLIC_ENV_NAME`                                                               |
| `aiAccountResourceIdIsAnAccountId`           | `SWARM_PUBLIC_AI_ACCOUNT_RESOURCE_ID` is not the ID of an Azure OpenAI / Foundry account                                                          |
| `freeDeploymentNameIsNotAReasoningFamily`    | The deployment's name has a part that is `o1` to `o9`, or starts `gpt-5`. The application refuses to start on one: use a non-reasoning deployment |
| `freeDeploymentModelIsNotAReasoningFamily`   | The deployment is not named for one, but the **model behind it** is. The free tier's caps cannot see hidden reasoning tokens                      |
| `publicBaseUrlIsAnHttpsOriginWithoutPath`    | `SWARM_PUBLIC_BASE_URL` must be `https://host` in lower case: no path, no port, no trailing slash                                                 |
| `customDomainIsTheHostOfThePublicBaseUrl`    | `SWARM_PUBLIC_CUSTOM_DOMAIN` must be the host of `SWARM_PUBLIC_BASE_URL`                                                                          |
| `customDomainHasACertificate`                | A custom domain needs `SWARM_PUBLIC_CUSTOM_DOMAIN_CERTIFICATE_ID`                                                                                 |
| `atLeastOneSignInProviderIsConfigured`       | `deployApp` is true, guest mode is off (`SWARM_PUBLIC_GUEST_MODE` is not `true`) and neither client ID is set                                     |
| `ownerKeySha256IsEmptyOrSixtyFourHexDigits`  | `SWARM_PUBLIC_OWNER_KEY_SHA256` is set but is not 64 hexadecimal characters: the application would not start on it                                |
| `containerImageIsGivenWhenTheAppIsDeployed`  | `deployApp` is true and `SWARM_PUBLIC_CONTAINER_IMAGE` is empty                                                                                   |
| `imageIsFromThisDeploymentsRegistry`         | (when the app is made) the image is not from the registry of this deployment                                                                      |

A **deployment that does not exist** (`ResourceNotFound` on the model deployment) means the name or the account is wrong, and
the same read is what refuses a reasoning model. `Environment variable "<NAME>" does not exist` is a required variable that is not
exported. A value that is too short, or a budget of 0, is refused where the file is read.

## 18. What was not verified

Nothing here was run against Azure, Google, GitHub or a model. The development machine's Azure login is a limited service
principal, and no resource was created. What was checked, **offline**:

- `bicep build` and `bicep lint` of every template, and `bicep snapshot` of the deployment in both phases and in guest mode with no OAuth
  client (no client ID and no provider secret reference in the app) (`npm run iac:validate`);
- the invariants in [`scripts/iac/public-invariants.test.ts`](../../scripts/iac/public-invariants.test.ts): one replica at most, HTTPS
  only, single-revision mode, no secret literal, the four roles and no others, the budget and both action groups, the environment
  against [DESIGN.md section 3](DESIGN.md#configuration), and each refusal of section 17 (the ones that read a runtime value, the model
  behind the deployment and the image's registry, are compile-checked only).

**A read-only `what-if` was tried from the development machine and Azure refused it**, so no what-if output exists for this
template. The answer was `AuthorizationFailed`: the client "does not have authorization to perform action
`Microsoft.Resources/deployments/whatIf/action` over scope `/subscriptions/<subscription id>` or the scope is invalid". Your
own what-if (sections 5 and 9) is the first real preview of what this template does in Azure.

**Not verified, and yours to prove** (each is a row of [DESIGN.md section 11](DESIGN.md#11-what-cannot-be-verified-here)):

- Row security on the real managed PostgreSQL, and that the identity (a server administrator) may create the role. The start-up
  self-check refuses to run if it is not so.
- Google and GitHub sign-in with real registrations: the redirect URIs, the consent screen's current wording, the GitHub address scope.
- The model deployment, its quota and its price; Gemini's compatibility endpoint with the client's requests.
- That Container Apps resolves the four vault references when the app is created and when a replica starts, and the wording of its error when one is missing.
- That a budget notice reaches the action group, that the webhook is posted with the body Azure sends and answers in time, and the cost
  data's delay. **A budget does not stop spend.**
- That the template's guards refuse in Azure as they do offline, and that a what-if of a subscription-scope deployment shows the nested resources.
- `az keyvault secret set --file /dev/stdin`, the managed-certificate commands, the `psql` login with an Entra token, and the restore.
- Behaviour under real load: one replica, one database connection per process, a synchronous database bridge.
- The release tooling for this edition: `status`, `check` and `build` work in principle; the rest of `azure:release` and the pilot's smoke
  test need a public variant that does not exist yet.
- Guest mode in Azure: that the app starts with no OAuth client and only the pepper in the vault, and what the owner-key routes
  ([section 19](#19-guest-mode-no-sign-in)) answer on the live deployment.

## 19. Guest mode (no sign-in)

`SWARM_PUBLIC_GUEST_MODE=true` lets anyone with the link use the site **without signing in**: a visitor presses "Try it now" and gets a
temporary private workspace on the free tier, under caps of its own. How it works, what a guest may do and the abuse limits are in
[GUEST-MODE.md](GUEST-MODE.md); this section is what changes in a deployment.

**What you do not need.** **No OAuth app and no OAuth secret.** Leave both client IDs empty and the template still deploys (its guard
`atLeastOneSignInProviderIsConfigured` holds when guest mode is on), and the app gets no client ID and no secret reference for a
provider you did not configure. So [section 6](#6-the-oauth-apps) is optional and [section 7](#7-the-secrets) needs only
`public-pepper` (and `turnstile-secret-key` if you use Turnstile). Set a client ID and its secret and a visitor can also sign in: guest mode
does not switch a provider off. With guest mode off, at least one client ID is required again, so turning it off with no provider
configured is refused (`atLeastOneSignInProviderIsConfigured`, section 17): the site would have no way in.

**Sign-ups must be enabled.** A guest is made only while new visitors are let in, which is the same switch as for any new account:
`SWARM_PUBLIC_SIGNUPS_ENABLED=true` (the default, and the starting value of the run-time switch). With it `false`, no new guest and no
new account is made.

| Variable                                   | Default  | Meaning                                                                |
| ------------------------------------------ | -------- | ---------------------------------------------------------------------- |
| `SWARM_PUBLIC_GUEST_MODE`                  | `false`  | `true`: visitors may start with no sign-in                             |
| `SWARM_PUBLIC_GUESTS_PER_IP_PER_HOUR`      | `10`     | New guests one address may make in an hour (1 to 1000)                 |
| `SWARM_PUBLIC_GUESTS_PER_HOUR`             | `300`    | New guests the whole site may make in an hour (1 to 100000)            |
| `SWARM_PUBLIC_GUEST_RETENTION_HOURS`       | `24`     | A guest's data is deleted after this many hours without use (1 to 168) |
| `SWARM_PUBLIC_FREE_GUEST_DAILY_TOKENS`     | `80000`  | Tokens one guest may use per UTC day (0 to 100000000)                  |
| `SWARM_PUBLIC_FREE_GUEST_DAILY_CALLS`      | `60`     | Model round trips one guest may make per UTC day (0 to 100000)         |
| `SWARM_PUBLIC_FREE_GUEST_LIFETIME_TOKENS`  | `240000` | Tokens one guest may ever use on the free tier (0 to 1000000000)       |
| `SWARM_PUBLIC_FREE_GUEST_CONCURRENT_RUNS`  | `2`      | Runs one guest may have at once (1 to 20)                              |
| `SWARM_PUBLIC_FREE_GUEST_CONCURRENT_CALLS` | `4`      | Model round trips one guest may have in flight (1 to 50)               |
| `SWARM_PUBLIC_FREE_GUEST_TOKENS_PER_RUN`   | `15000`  | What one run is taken to cost on a guest's meter (1000 to 10000000)    |
| `SWARM_PUBLIC_OWNER_KEY_SHA256`            | empty    | The SHA-256 of the owner key, below. Empty: the owner routes are off   |

A `0` in the three token and call caps means a guest may use **none** of the free tier, never "no limit" (they are the only caps the
template lets be `0`). Guests draw on the same global daily caps as everybody, `FREE_GLOBAL_DAILY_TOKENS` and
`FREE_GLOBAL_DAILY_COST_USD`: with no sign-in in the way, those and the address throttle are what bound the cost of a flood, so choose
them first (section 11). Keep these variables in your environment file and export them on every apply, like all the others.

**The owner key.** With no sign-in there is no administrator session and no Admin page, and the budget webhook can only turn the free
tier **off**. The owner key is how you operate the site. Make it once and **keep it**: it is a secret, so a file outside the
repository that only you can read (or a password manager). The template is given only its **hash**, which is not a secret:

```bash
(umask 077; mkdir -p ~/.swarm-public; openssl rand -hex 32 | tr -d '\n' > ~/.swarm-public/owner-key)
# The hash: put this line in your environment file (section 4), which every apply exports. An apply without it leaves the setting out,
# and the owner routes then answer 404 until an apply that has it.
printf 'export SWARM_PUBLIC_OWNER_KEY_SHA256=%s\n' "$(sha256sum < ~/.swarm-public/owner-key | cut -d' ' -f1)"
```

The key is sent **only in the header `X-Swarm-Owner-Key`**, never in an address, to these routes, which need no sign-in:

| Call                          | Does                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| `POST /api/ops/free-tier/off` | Turns the free tier off (the kill switch)                           |
| `POST /api/ops/free-tier/on`  | Turns it on again                                                   |
| `POST /api/ops/signups/off`   | Stops new guests and new accounts                                   |
| `POST /api/ops/signups/on`    | Lets them in again                                                  |
| `GET /api/ops/usage`          | The usage meter: spend by day, top users, refusals and the switches |

Each is rate limited, answers 404 when no owner key is configured, and is recorded without the key. A key that is not the one whose hash
is set is refused. Put the key on no command line (`ps` shows it): a curl config read from a descriptor keeps it off:

```bash
FQDN=$(out AZURE_CONTAINER_APP_FQDN)       # or your custom domain
owner() {   # owner <GET|POST> <path>
  curl -sS -X "$1" -K <(printf 'header = "X-Swarm-Owner-Key: %s"\nurl = "https://%s%s"\n' "$(cat ~/.swarm-public/owner-key)" "$FQDN" "$2")
}
owner GET  /api/ops/usage | jq          # the usage meter
owner POST /api/ops/free-tier/off       # the kill switch; /api/ops/free-tier/on turns it on again
owner POST /api/ops/signups/off         # no new guests or accounts; /api/ops/signups/on lets them in again
```

`SWARM_PUBLIC_FREE_TIER_ENABLED=false` in the environment still wins over `/api/ops/free-tier/on`, as it does over the Admin page.

**Check it after the second deployment** (section 9), in this order:

1. `curl -sS "https://$FQDN/api/public/session" | jq` says `guestMode: true`.
2. In a browser, press "Try it now": a private workspace opens with no sign-in. Run one model-assisted step; the meter shows the free
   runs left.
3. `owner GET /api/ops/usage | jq` shows that step, and the switches.
4. `owner POST /api/ops/signups/off`: a new visitor is not let in. Then `owner POST /api/ops/signups/on`.
