// Swarm PUBLIC EDITION at subscription scope: a SEPARATE deployment of the same application (SWARM_EDITION=public), where anyone can
// sign in with Google or GitHub, or, in guest mode, press "Try it now" and get a temporary private workspace with no sign-in at all,
// and run on the owner's Azure OpenAI credits under strict caps (the free tier), or on their own Gemini key (bring your own key).
// It creates its own resource group, and in it:
//
//   identity            one user-assigned managed identity: the only credential holder (database, model, registry, vault, telemetry)
//   monitoring          Log Analytics workspace and Application Insights (local authentication off)
//   key vault           RBAC, soft delete and PURGE PROTECTION; holds the application's secrets (the pepper, the client secret of each OAuth
//                       provider that is configured and, if used, the Turnstile secret), which a person puts there: none is in this template
//   registry            Container Registry (Basic, admin user off, no anonymous pull); the identity pulls with AcrPull
//   database            PostgreSQL flexible server (Burstable B1ms), Microsoft Entra only: the app's identity is its administrator,
//                       which the application needs to create its row-level-security role (docs/public/DESIGN.md, section 5)
//   app environment     Container Apps environment (Consumption profile only)
//   container app       ONE app: external HTTPS ingress, ONE replica at most, CPU and memory capped, probes (when deployApp is true)
//   alerts              a few metric alert rules and an e-mail action group (when deployApp is true)
//   budget              a monthly budget with notices at 50, 80, 100 and 120 percent. The 100 and 120 percent notices call a webhook of the
//                       application that turns the FREE TIER OFF. See action-groups.bicep for the honest limits of that.
//
// It only REFERENCES, and creates nothing in: the Azure OpenAI / Foundry account and its model deployment (it reads the deployment and
// adds ONE role assignment, Cognitive Services OpenAI User, on the account). The account may be in another resource group or subscription.
//
// ORDER OF OPERATIONS. A Container Apps secret that is a Key Vault reference must exist when the app is created, and the template must
// not contain a secret, so a person puts the secrets in the vault between two deployments of this template (docs/public/DEPLOY.md):
//   1. deployApp = false    everything above except the container app and its alerts. The outputs name the address of the site, which is
//                           what the OAuth redirect URIs and the first image need.
//   2. by hand              register the Google and GitHub OAuth apps and put their secrets into the vault (guest mode needs neither), put
//                           the pepper into the vault, build the image in the new registry.
//   3. deployApp = true     the container app, with references to secrets that now exist, and its alerts.
// Nothing is created before the checks in modules/guards.bicep hold, and a required value that is missing is refused (the parameter
// file reads every value from the environment, and an empty one is "not set").
//
// This is NOT the pilot's template and does not change it: it reuses the pilot's modules by reference (../pilot/modules), and
// the pilot's resource group, resources and tags are never read or written. A name that contains "pilot" is refused.
//
// Authored and compiled offline. NOT DEPLOYED: nothing here has been seen working in Azure. See docs/public/DEPLOY.md.
targetScope = 'subscription'

// ---------------------------------------------------------------------------------------------
// Where and what
// ---------------------------------------------------------------------------------------------

@description('Short name used in resource names and tags: lower-case letters, digits and hyphens. A NEW name: never the pilot\'s, and one that contains "pilot" is refused.')
@minLength(3)
@maxLength(20)
param environmentName string = 'swarm-public'

@description('The resource group this deployment creates and owns. It must not exist yet. Deleting it removes everything created here except the Key Vault and the Log Analytics workspace, which stay soft-deleted for a while (docs/public/DEPLOY.md, "Teardown").')
param resourceGroupName string = 'rg-${environmentName}'

@description('Region of every resource created here. Defaults to the location given to `az deployment sub create --location`.')
param location string = deployment().location

@description('REQUIRED, no default, on purpose. false: everything except the container app and its alerts (the first deployment). true: the container app too, which needs the pepper and the secrets of the providers you configure in the vault (guest mode with no provider: the pepper only) and an image in the registry. Never answer false once the app exists: a re-deployment does not remove it, but it no longer applies its settings.')
param deployApp bool

@description('Extra tags on every resource, for example an owner alias or a cost centre. Never put a person\'s name or address in a tag.')
param extraTags object = {}

// ---------------------------------------------------------------------------------------------
// The model: referenced, never created
// ---------------------------------------------------------------------------------------------

@description('Resource ID of the EXISTING Azure OpenAI / Foundry account the free tier calls: /subscriptions/<id>/resourceGroups/<group>/providers/Microsoft.CognitiveServices/accounts/<name>. Use the public edition\'s own account, not the pilot\'s. This template reads one deployment of it and adds ONE role assignment on it; it creates nothing there.')
@minLength(100)
param aiAccountResourceId string

@description('Name of the existing model deployment of that account (AI_MODEL). It MUST BE A NON-REASONING MODEL, for example gpt-4.1-mini: a reasoning model spends hidden tokens that the free tier\'s caps cannot see coming. A name or a model of the o1 to o9 or gpt-5 families is refused (modules/guards.bicep), and the deployment is declared reasoning:false.')
@minLength(1)
@maxLength(64)
param aiDeploymentName string

@description('Endpoint of that account (FOUNDRY_ENDPOINT). Empty derives https://<account name>.openai.azure.com/, the convention of infra/modules/ai-services.bicep; set it when the account uses another custom sub-domain.')
param azureOpenAiEndpoint string = ''

@description('Price of ONE MILLION INPUT tokens of that deployment, in US dollars, as text (for example 0.40; Bicep has no decimal literals). REQUIRED: the application will not enforce a cost cap from a price it guessed, and will not start without one. Read it from the Azure OpenAI pricing page for the deployment\'s SKU and region.')
@minLength(1)
@maxLength(12)
param modelInputPricePerMillionUsd string

@description('Price of ONE MILLION OUTPUT tokens of that deployment, in US dollars, as text (for example 1.60). REQUIRED, see above.')
@minLength(1)
@maxLength(12)
param modelOutputPricePerMillionUsd string

@description('What the Ask screen preselects for a new question (DEFAULT_ENGINE). rules sends nothing to a model; model uses the free tier or the person\'s own key. It is only a preselection. The default is rules, which spends nothing until a person chooses the model.')
@allowed([
  'rules'
  'model'
])
param defaultEngine string = 'rules'

// ---------------------------------------------------------------------------------------------
// Sign-in and the public settings (docs/public/DESIGN.md, section 3)
// ---------------------------------------------------------------------------------------------

@description('The https origin of the site, in lower case, with no path, port or trailing slash (PUBLIC_BASE_URL). Empty: the default address of the app, https://<app>.<environment domain>. A custom domain is set here AND in customDomainName once its certificate exists (docs/public/DEPLOY.md, "Custom domain"). The OAuth redirect URIs derive from it.')
param publicBaseUrl string = ''

@description('Client ID of the Google OAuth client (PUBLIC_GOOGLE_CLIENT_ID). Not a secret. Empty: no Google sign-in. Its secret is the Key Vault secret public-google-client-secret, which a person puts in the vault. At least one of Google and GitHub is required when deployApp is true, unless guestMode is true.')
param googleClientId string = ''

@description('Client ID of the GitHub OAuth app (PUBLIC_GITHUB_CLIENT_ID). Not a secret. Empty: no GitHub sign-in. Its secret is the Key Vault secret public-github-client-secret.')
param githubClientId string = ''

@description('Comma-separated verified e-mail addresses that are platform administrators (PUBLIC_ADMIN_EMAILS): they can switch the free tier and signups off and disable accounts. Personal data: read from the environment, never committed. Empty: nobody (the budget webhook and the owner key still work). With no provider (guest mode alone) nobody can sign in, so nobody is an administrator: the owner key (ownerKeySha256) does the same with no sign-in.')
param adminEmails string = ''

@description('Starting value of the "signups open" switch (PUBLIC_SIGNUPS_ENABLED). An administrator can flip it at run time. It also decides whether new guests can be made (guestMode): false makes none.')
param signupsEnabled bool = true

@description('Comma-separated e-mail domains that cannot sign up, for example disposable mail (PUBLIC_BLOCKED_EMAIL_DOMAINS). Empty: none.')
param blockedEmailDomains string = ''

@description('Site key of Cloudflare Turnstile (TURNSTILE_SITE_KEY). Not a secret. Empty: bot protection is off (the default). When set, its secret is the Key Vault secret turnstile-secret-key.')
param turnstileSiteKey string = ''

@description('Projects per workspace (PUBLIC_MAX_PROJECTS).')
@minValue(1)
@maxValue(100)
param maxProjects int = 10

@description('Stored text per workspace, in megabytes (PUBLIC_STORAGE_QUOTA_MB).')
@minValue(1)
@maxValue(1000)
param storageQuotaMb int = 20

@description('Days the keyed counter of a deleted account is kept, so that deleting and signing up again does not reset the lifetime cap (PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS). 0 keeps nothing: a legal choice that is the owner\'s (docs/public/DECISIONS-FOR-OWNER.md, 5). The application allows at most 365.')
@minValue(0)
@maxValue(365)
param deletedAccountRetentionDays int = 30

@description('New accounts one address may make in 24 hours (PUBLIC_SIGNUPS_PER_IP_PER_DAY). Counted from the hashes of addresses, keyed with the pepper, so that no address is stored. It works only because TRUST_PROXY is 1: behind the ingress every caller would otherwise look like the same address.')
@minValue(1)
@maxValue(1000)
param signupsPerIpPerDay int = 5

@description('New accounts the whole site may make in an hour (PUBLIC_SIGNUPS_PER_HOUR). A second line of defence against signup farming, whatever addresses it uses.')
@minValue(1)
@maxValue(100000)
param signupsPerHour int = 60

@description('Minutes a session may sit idle before it ends (AUTH_SESSION_IDLE_MINUTES). A hosted deployment allows at most 60: the application refuses to start with more, so a larger value is refused here instead.')
@minValue(5)
@maxValue(60)
param sessionIdleMinutes int = 30

@description('Hours a session lasts in all, whatever the person does (AUTH_SESSION_ABSOLUTE_HOURS). A hosted deployment allows at most 12.')
@minValue(1)
@maxValue(12)
param sessionAbsoluteHours int = 8

@description('Allow the web-research crawler (PUBLIC_ALLOW_RESEARCH). It makes the server fetch pages for strangers: an abuse and reputation risk, so it is off.')
param allowResearch bool = false

@description('Most model calls one project may make in all (PROJECT_MODEL_CALL_LIMIT). At least 1: 0 would mean no limit in the pilot\'s convention, which the public edition never allows. The default is the public default of docs/public/DESIGN.md, section 6.4.')
@minValue(1)
@maxValue(1000000)
param projectModelCallLimit int = 300

@description('Most tokens, input and output together, one project may use in all (PROJECT_MODEL_TOKEN_LIMIT). At least 1, see above.')
@minValue(1)
@maxValue(1000000000)
param projectModelTokenLimit int = 400000

// ---------------------------------------------------------------------------------------------
// Guest mode: no sign-in (docs/public/DESIGN.md, section 3, and docs/public/DEPLOY.md, "Guest mode")
//
// A visitor presses "Try it now" and gets a temporary private workspace: no sign-in and no OAuth app. A guest is held to caps of
// their own on the free tier (the freeGuest* parameters in the next block) and is deleted, with their data, after
// guestRetentionHours without use. New guests are made only while signupsEnabled is true.
// ---------------------------------------------------------------------------------------------

@description('Guest mode (PUBLIC_GUEST_MODE): a visitor presses "Try it now" and gets a temporary private workspace, with no sign-in. It is what lets the app be deployed with NO Google or GitHub client ID: the guard atLeastOneSignInProviderIsConfigured then holds, and a provider that is not configured has no client ID and no secret reference in the app. It does not switch the providers off: with a client ID set, a visitor can also sign in. Guests are made only while signupsEnabled is true.')
param guestMode bool = false

@description('New guests one address may make in an hour (PUBLIC_GUESTS_PER_IP_PER_HOUR). Counted from the hashes of addresses, keyed with the pepper, so that no address is stored. It works only because TRUST_PROXY is 1.')
@minValue(1)
@maxValue(1000)
param guestsPerIpPerHour int = 10

@description('New guests the whole site may make in an hour (PUBLIC_GUESTS_PER_HOUR). A second line of defence against a flood, whatever addresses it uses.')
@minValue(1)
@maxValue(100000)
param guestsPerHour int = 300

@description('Hours without use after which a guest and all of their data are deleted (PUBLIC_GUEST_RETENTION_HOURS).')
@minValue(1)
@maxValue(168)
param guestRetentionHours int = 24

// ---------------------------------------------------------------------------------------------
// The free tier and bring your own key: the caps (docs/public/DESIGN.md, sections 6 and 7)
//
// Every value is read from the environment by main.bicepparam, so that an apply that forgets one puts back the default and
// not an older, stricter value that was given on the command line: keep one environment file. None of these can be 0, except the
// three per-guest caps of tokens and calls (freeGuestDailyTokens, freeGuestDailyCalls, freeGuestLifetimeTokens), where 0 means
// that a guest may use none of the free tier, never no limit. For everybody else a cap of 0 is a free tier that is off in
// everything but name, and `freeTierEnabled = false` says that plainly.
// ---------------------------------------------------------------------------------------------

@description('Hard switch from the environment (FREE_TIER_ENABLED): false turns the free tier off for the process, and wins over the run-time switch. It cannot be turned on at run time.')
param freeTierEnabled bool = true

@description('Tokens (input, output and hidden reasoning) one person may use per UTC day (FREE_USER_DAILY_TOKENS).')
@minValue(1)
@maxValue(1000000)
param freeUserDailyTokens int = 60000

@description('Model round trips one person may make per UTC day (FREE_USER_DAILY_CALLS).')
@minValue(1)
@maxValue(1000)
param freeUserDailyCalls int = 40

@description('Tokens one account may ever use on the free tier (FREE_USER_LIFETIME_TOKENS).')
@minValue(1)
@maxValue(10000000)
param freeUserLifetimeTokens int = 300000

@description('Runs (queued or running jobs) one workspace may have at once (FREE_USER_CONCURRENT_RUNS).')
@minValue(1)
@maxValue(3)
param freeUserConcurrentRuns int = 1

@description('Model round trips one person may have in flight (FREE_USER_CONCURRENT_CALLS).')
@minValue(1)
@maxValue(10)
param freeUserConcurrentCalls int = 3

@description('Tokens all free users together may use per UTC day (FREE_GLOBAL_DAILY_TOKENS). With the cost cap below, this is the REAL-TIME protection of the owner\'s credits: it does not depend on Azure\'s billing data, which arrives hours late.')
@minValue(1)
@maxValue(100000000)
param freeGlobalDailyTokens int = 2000000

@description('Estimated spend, in US dollars as text (for example 5 or 2.50), that all free users together may cause per UTC day (FREE_GLOBAL_DAILY_COST_USD). Priced from the prices above. It must be greater than 0.')
@minLength(1)
@maxLength(8)
param freeGlobalDailyCostUsd string = '5'

@description('Only for the meter: what one run is taken to cost, in tokens (FREE_TOKENS_PER_RUN).')
@minValue(1000)
@maxValue(200000)
param freeTokensPerRun int = 15000

@description('Tokens (input, output and hidden reasoning) one GUEST may use per UTC day (FREE_GUEST_DAILY_TOKENS). 0 is allowed here, and means that a guest may use none of the free tier: never no limit.')
@minValue(0)
@maxValue(100000000)
param freeGuestDailyTokens int = 80000

@description('Model round trips one guest may make per UTC day (FREE_GUEST_DAILY_CALLS). 0 is allowed here, and means none.')
@minValue(0)
@maxValue(100000)
param freeGuestDailyCalls int = 60

@description('Tokens one guest may ever use on the free tier (FREE_GUEST_LIFETIME_TOKENS). 0 is allowed here, and means none.')
@minValue(0)
@maxValue(1000000000)
param freeGuestLifetimeTokens int = 240000

@description('Runs (queued or running jobs) one guest workspace may have at once (FREE_GUEST_CONCURRENT_RUNS).')
@minValue(1)
@maxValue(20)
param freeGuestConcurrentRuns int = 2

@description('Model round trips one guest may have in flight (FREE_GUEST_CONCURRENT_CALLS).')
@minValue(1)
@maxValue(50)
param freeGuestConcurrentCalls int = 4

@description('Only for the meter of a guest: what one run is taken to cost, in tokens (FREE_GUEST_TOKENS_PER_RUN).')
@minValue(1000)
@maxValue(10000000)
param freeGuestTokensPerRun int = 15000

@description('JSON, per model role, of the most output tokens the free tier allows (FREE_ROLE_MAX_OUTPUT_TOKENS). Empty: the table in the application.')
param freeRoleMaxOutputTokens string = ''

@description('Allow people to bring their own Gemini key (BYOK_ENABLED).')
param byokEnabled bool = true

@description('Round trips one person may have in flight on their own key (BYOK_MAX_CONCURRENT_CALLS).')
@minValue(1)
@maxValue(20)
param byokMaxConcurrentCalls int = 4

// ---------------------------------------------------------------------------------------------
// The container app, its image and its address
// ---------------------------------------------------------------------------------------------

@description('Image to run, <registry>/swarm@sha256:<digest>, from the registry this deployment creates. REQUIRED when deployApp is true; there is no placeholder image. Every deployment must be given it again: a re-deployment with an older image rolls the app back to it.')
param containerImage string = ''

@description('vCPU of the one replica; memory is twice that. At most 1 vCPU and 2 GiB, which also caps what a flood of requests can cost.')
@allowed(['0.25', '0.5', '1'])
param cpu string = '0.5'

@description('0 or 1. DEFAULT 1, because scaling to zero would end a long run (the job runner is in the process) and drop every BYOK key held in memory. 0 is cheaper, and acceptable only if people understand that. There is no maxReplicas parameter: it is 1, always (modules/container-app.bicep).')
@allowed([0, 1])
param minReplicas int = 1

@description('Client address ranges (CIDR) allowed to reach the app. Empty allows every address, which a public site needs. Set it to your own address to deploy CLOSED, verify, and open it later. While it is set, the budget webhook cannot reach the app either.')
param ingressAllowedCidrs array = []

@description('Deactivated revisions Azure keeps, so that one can be looked up or re-activated.')
@minValue(0)
@maxValue(100)
param maxInactiveRevisions int = 5

@description('DEPLOYMENT_LABEL: what this deployment is, in words, shown to people (at most 80 characters). Production requires one, and it must not call itself a pilot.')
@minLength(1)
@maxLength(80)
param deploymentLabel string = 'Swarm public edition'

@description('BUILD_SHA: the commit the image was built from. Empty leaves the setting out.')
@maxLength(40)
param buildSha string = ''

@description('Public HTTPS address of the source code of the exact version deployed (SOURCE_URL), which the AGPL licence requires users of a network service to be offered. Empty leaves the setting out: set it before the site is opened to the public.')
param sourceUrl string = ''

@description('The custom domain bound to the app, for example swarm.example.com. Empty: none. A managed certificate needs DNS validation after the app exists, so this is filled in AFTER the two-phase procedure in docs/public/DEPLOY.md, together with customDomainCertificateId and publicBaseUrl. From then on every deployment must carry it, or the binding is removed.')
param customDomainName string = ''

@description('Resource ID of the managed certificate of customDomainName in the Container Apps environment. Empty when there is no custom domain.')
param customDomainCertificateId string = ''

// ---------------------------------------------------------------------------------------------
// The webhook key, and the owner key
// ---------------------------------------------------------------------------------------------

@description('The key the budget webhook presents to the application (?key=). A secret: generate it with `openssl rand -hex 32` and keep it out of every file. It goes only into the webhook address of the action group, which Azure shows to whoever can read the action group; the application can only be told to turn the free tier OFF with it. Never an output.')
@secure()
@minLength(32)
param opsKey string

@description('SHA-256 of opsKey in hexadecimal, 64 characters (PUBLIC_OPS_KEY_SHA256), made by `printf \'%s\' "$KEY" | sha256sum`: Bicep has no sha256, so this cannot be checked against opsKey here. The application stores only this hash; the proof that the two belong together is the webhook test in docs/public/DEPLOY.md.')
@minLength(64)
@maxLength(64)
param opsKeySha256 string

@description('SHA-256 of the OWNER\'s key in hexadecimal, 64 characters (PUBLIC_OWNER_KEY_SHA256), made by `printf \'%s\' "$KEY" | sha256sum`. Not a secret: it is the hash, and the key itself is never given to this template. The key, sent only in the header X-Swarm-Owner-Key, lets the owner turn the free tier on and off, turn the making of new accounts and guests on and off, and read the usage, with no sign-in. Empty (the default): those routes are off and the setting is left out. Anything but 64 hexadecimal characters is refused (modules/guards.bicep), because the application would not start on it.')
@maxLength(64)
param ownerKeySha256 string = ''

// ---------------------------------------------------------------------------------------------
// Budget and alerts
// ---------------------------------------------------------------------------------------------

@description('Receives every alert and every budget notice. Read from the environment by the parameter file; never stored in the repository.')
@minLength(5)
param alertEmailAddress string

param additionalAlertEmailAddresses array = []

@description('The monthly budget, in the BILLING currency of the subscription (Azure has no currency property on a budget). REQUIRED, with no default: it is the owner\'s money and the owner\'s number. It covers this resource group and, when it is in this subscription, the resource group of the model account. A budget ALERTS: it does not stop spend, and its cost data arrives hours late.')
@minValue(1)
param budgetAmount int

@description('What currency budgetAmount is meant in, three letters. Not sent to Azure; recorded in the notification names so that nobody reads INR as USD. REQUIRED.')
@minLength(3)
@maxLength(3)
param budgetCurrencyLabel string

@description('First day of the month the budget starts, as yyyy-MM-01T00:00:00Z. The default is the current month; Azure rejects a start date in a past month.')
param budgetStartDate string = '${utcNow('yyyy-MM')}-01T00:00:00Z'

@description('Five 5xx answers in five minutes are normal noise; this many are not.')
@minValue(1)
param http5xxPer5Minutes int = 10

// ---------------------------------------------------------------------------------------------
// PostgreSQL, logs, Key Vault
// ---------------------------------------------------------------------------------------------

@description('Compute SKU of the server. Burstable B1ms is the cheapest sane choice, but a subscription can be refused it in a region (SkuNotAvailable although list-skus shows it). The fallback that worked for the pilot in Central India is Standard_D2ds_v4 with databaseSkuTier GeneralPurpose, at about 8 times the price (docs/azure/pilot-cost.md). Both must stay set on every later apply: leaving them out asks Azure to change the running server.')
param databaseSkuName string = 'Standard_B1ms'

@description('Tier of the compute SKU above. It must match: Standard_B* is Burstable, Standard_D*ds_v4 and _v5 are GeneralPurpose.')
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param databaseSkuTier string = 'Burstable'

@minValue(32)
@maxValue(16384)
param databaseStorageGb int = 32

@allowed(['Enabled', 'Disabled'])
param databaseStorageAutoGrow string = 'Enabled'

@description('Days of PostgreSQL backups, which bound a point-in-time restore.')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Name of an EXISTING PostgreSQL flexible server in THIS resource group, used instead of the one this template makes. A point-in-time restore always makes a NEW server, so after one the template must be told its name: otherwise the next deployment points the app back at the old server, or makes a new empty one (docs/public/DEPLOY.md, "Rollback"). The template then only adds the database to it. Its administrators, network and settings are not touched, so the application\'s identity must already be an Entra administrator of it. Empty: the server this template makes.')
@maxLength(63)
param existingDatabaseServerName string = ''

@description('Days of Log Analytics retention. The first 31 days are included in the ingestion price.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

@description('Daily Log Analytics ingestion cap in GB, as text (for example 0.5). -1 removes the cap. At the cap collection stops until the next day, which trades visibility for a spend ceiling.')
param dailyLogCapGb string = '0.5'

@description('Days a deleted vault and its secrets can be recovered. Purge protection makes it also the minimum time before the vault name can be reused, so a teardown followed by a new deployment of the same environment name fails until it passes (docs/public/DEPLOY.md, "Teardown").')
@minValue(7)
@maxValue(90)
param keyVaultSoftDeleteRetentionInDays int = 90

// ---------------------------------------------------------------------------------------------

// Reads a segment of a resource ID, and gives '' for a missing one, so that a malformed ID can never fail with an index error:
// /subscriptions/<2>/resourceGroups/<4>/providers/<6>/<7>/<8>.
func idPart(resourceId string, index int) string => split('${resourceId}//////////', '/')[index]

// True for an https origin in lower case with no path, port, user or query: the form of PUBLIC_BASE_URL this template takes. It is
// stricter than the application, which would also take a port or capitals, because Container Apps serves 443 only and a host name is
// compared as written. scripts/iac/public-invariants.test.ts evaluates it with `bicep console` for a list of addresses.
func isHttpsOrigin(url string) bool =>
  startsWith(url, 'https://') && length(split(url, '/')) == 3 && !empty(idPart(url, 2)) && !contains(idPart(url, 2), ':') && !contains(idPart(url, 2), '@') && !contains(idPart(url, 2), '?') && !contains(idPart(url, 2), '#') && url == toLower(url)

// A name made comparable: lower case, '_' and '.' (the application's other separators) turned into hyphens, and a hyphen at each
// end, so that the start and the end of a name are separators too. No lambda: the offline evaluator of `npm run iac:validate`
// cannot read a function parameter inside one.
func paddedName(name string) string => '-${replace(replace(toLower(name), '_', '-'), '.', '-')}-'

// The model families that reason: the application refuses them as the free deployment (docs/public/DESIGN.md, section 3), by
// this same rule (REASONING_FAMILIES in backend/src/public/config.ts): a part of the name between '-', '_' or '.' that is o1 to
// o9, or a name or part that starts with gpt-5. So gpt-5-mini, o3 and o4-mini are refused, and gpt-4.1-mini and gpt-4o-mini are
// not. scripts/iac/public-invariants.test.ts evaluates this function against that pattern for a list of names.
func isReasoningFamily(name string) bool =>
  contains(paddedName(name), '-o1-') || contains(paddedName(name), '-o2-') || contains(paddedName(name), '-o3-') || contains(paddedName(name), '-o4-') || contains(paddedName(name), '-o5-') || contains(paddedName(name), '-o6-') || contains(paddedName(name), '-o7-') || contains(paddedName(name), '-o8-') || contains(paddedName(name), '-o9-') || startsWith(toLower(name), 'gpt-5') || contains(toLower(name), '-gpt-5') || contains(toLower(name), '_gpt-5') || contains(toLower(name), '.gpt-5')

func optionalSetting(name string, value string) array => empty(value) ? [] : [{ name: name, value: value }]

var baseName = toLower(environmentName)
var uniqueSuffix = uniqueString(subscription().subscriptionId, resourceGroupName)
var appName = 'ca-${baseName}'
var appPort = 3001

var aiAccountSubscriptionId = idPart(aiAccountResourceId, 2)
var aiAccountResourceGroup = idPart(aiAccountResourceId, 4)
var aiAccountName = idPart(aiAccountResourceId, 8)

// The address of the app is known before the app exists: <app name>.<environment default domain>.
var fqdn = '${appName}.${appEnvironment.outputs.defaultDomain}'
var publicHost = idPart(publicBaseUrl, 2)
var baseUrl = empty(publicBaseUrl) ? 'https://${fqdn}' : publicBaseUrl
// The default address stays allowed beside a custom domain: the probes and the budget webhook use it, and it does not
// depend on the domain's DNS or certificate. Only the origin of baseUrl may make a change from the page.
var allowedHosts = empty(publicHost) ? fqdn : '${publicHost},${fqdn}'

var tags = union(
  {
    app: 'swarm-lab'
    environment: baseName
    purpose: 'public'
    stage: 'public-edition'
    managedBy: 'bicep'
  },
  extraTags
)

// ---------------------------------------------------------------------------------------------
// Checks before anything is created
// ---------------------------------------------------------------------------------------------

// Read only, in the group of the model account. A deployment that does not exist fails here.
module model 'modules/model-deployment.bicep' = {
  name: '${baseName}-model'
  scope: resourceGroup(aiAccountSubscriptionId, aiAccountResourceGroup)
  params: {
    accountName: aiAccountName
    deploymentName: aiDeploymentName
  }
}

// The hash of the owner's key, as the application reads it (^[0-9a-f]{64}$ in backend/src/public/config.ts, after the toLower where it
// is set): 64 characters, each a hexadecimal digit. A variable and not a function, because the offline evaluator of
// `npm run iac:validate` cannot read a function parameter inside a lambda.
var ownerKeyCharacters = map(range(0, length(ownerKeySha256)), position => substring(toLower(ownerKeySha256), position, 1))
var ownerKeyIsASha256 = length(ownerKeySha256) == 64 && empty(filter(ownerKeyCharacters, character => !contains('0123456789abcdef', character)))

// `any()` because the checked parameters allow only the value true, which a Boolean expression is not a literal of.
module guards 'modules/guards.bicep' = {
  name: '${baseName}-guards'
  params: {
    resourceGroupAndEnvironmentAreNotThePilots: any(!contains(toLower(resourceGroupName), 'pilot') && !contains(baseName, 'pilot'))
    aiAccountResourceIdIsAnAccountId: any(startsWith(toLower(aiAccountResourceId), '/subscriptions/') && contains(toLower(aiAccountResourceId), '/providers/microsoft.cognitiveservices/accounts/') && !empty(aiAccountName))
    freeDeploymentNameIsNotAReasoningFamily: any(!isReasoningFamily(aiDeploymentName))
    freeDeploymentModelIsNotAReasoningFamily: any(!isReasoningFamily(model.outputs.modelName))
    publicBaseUrlIsAnHttpsOriginWithoutPath: any(empty(publicBaseUrl) || isHttpsOrigin(publicBaseUrl))
    customDomainIsTheHostOfThePublicBaseUrl: any(empty(customDomainName) || customDomainName == publicHost)
    customDomainHasACertificate: any(empty(customDomainName) || !empty(customDomainCertificateId))
    atLeastOneSignInProviderIsConfigured: any(!deployApp || guestMode || !empty(googleClientId) || !empty(githubClientId))
    ownerKeySha256IsEmptyOrSixtyFourHexDigits: any(empty(ownerKeySha256) || ownerKeyIsASha256)
    containerImageIsGivenWhenTheAppIsDeployed: any(!deployApp || !empty(containerImage))
  }
}

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
  dependsOn: [guards]
}

// ---------------------------------------------------------------------------------------------
// The foundation: everything except the container app
// ---------------------------------------------------------------------------------------------

module identity 'modules/identity.bicep' = {
  name: '${baseName}-identity'
  scope: group
  params: {
    identityName: 'id-${baseName}'
    location: location
    tags: tags
  }
}

module monitoring '../pilot/modules/monitoring.bicep' = {
  name: '${baseName}-monitoring'
  scope: group
  params: {
    workspaceName: 'log-${baseName}'
    appInsightsName: 'appi-${baseName}'
    location: location
    tags: tags
    retentionInDays: logRetentionDays
    dailyCapGb: dailyLogCapGb
  }
}

module appInsightsAccess '../pilot/modules/appinsights-access.bicep' = {
  name: '${baseName}-appinsights-access'
  scope: group
  params: {
    appInsightsName: 'appi-${baseName}'
    identityResourceId: identity.outputs.id
    principalId: identity.outputs.principalId
  }
  dependsOn: [monitoring]
}

module registry '../pilot/modules/registry.bicep' = {
  name: '${baseName}-registry'
  scope: group
  params: {
    registryName: take('cr${replace(baseName, '-', '')}${uniqueSuffix}', 50)
    location: location
    tags: tags
    identityResourceId: identity.outputs.id
    principalId: identity.outputs.principalId
  }
}

module keyVault '../pilot/modules/key-vault.bicep' = {
  name: '${baseName}-key-vault'
  scope: group
  params: {
    vaultName: 'kv${take(replace(baseName, '-', ''), 12)}${take(uniqueSuffix, 9)}'
    location: location
    tags: tags
    softDeleteRetentionInDays: keyVaultSoftDeleteRetentionInDays
    identityResourceId: identity.outputs.id
    principalId: identity.outputs.principalId
    auditWorkspaceResourceId: monitoring.outputs.workspaceId
  }
}

// The application's identity is the server's Microsoft Entra administrator, as in the pilot: the application creates and
// migrates its own tables, and in public mode also creates the non-owner role it runs as (swarm_app) and the row-level security
// policies (docs/public/DESIGN.md, section 5). Creating a role needs the administrator right. Whether the managed service
// honours that setup is proved by the application's own start-up self-check, which refuses to start if it does not.
module database '../pilot/modules/postgres.bicep' = {
  name: '${baseName}-database'
  scope: group
  params: {
    serverName: empty(existingDatabaseServerName) ? 'psql-${baseName}-${uniqueSuffix}' : existingDatabaseServerName
    useExistingServer: !empty(existingDatabaseServerName)
    location: location
    tags: tags
    skuName: databaseSkuName
    skuTier: databaseSkuTier
    storageSizeGB: databaseStorageGb
    storageAutoGrow: databaseStorageAutoGrow
    backupRetentionDays: backupRetentionDays
    administratorObjectId: identity.outputs.principalId
    administratorName: identity.outputs.name
  }
}

// The only change to the model account: one role assignment, scoped to the account itself.
module aiAccess '../pilot/modules/ai-access.bicep' = {
  name: 'ai-access-${uniqueSuffix}'
  scope: resourceGroup(aiAccountSubscriptionId, aiAccountResourceGroup)
  params: {
    accountName: aiAccountName
    identityResourceId: identity.outputs.id
    principalId: identity.outputs.principalId
  }
}

module appEnvironment '../pilot/modules/environment-new.bicep' = {
  name: '${baseName}-environment'
  scope: group
  params: {
    environmentName: 'cae-${baseName}'
    location: location
    tags: tags
    workspaceName: 'log-${baseName}'
    workspaceSubscriptionId: subscription().subscriptionId
    workspaceResourceGroup: group.name
  }
  dependsOn: [monitoring]
}

// ---------------------------------------------------------------------------------------------
// The container app (deployApp)
// ---------------------------------------------------------------------------------------------

// Core settings: what the pilot's container app sets, less every Microsoft Entra sign-in variable (AUTH_*), which the public
// edition does not use, and plus the model settings of the free tier.
var coreEnvironment = [
  { name: 'HOST', value: '0.0.0.0' }
  { name: 'PORT', value: string(appPort) }
  { name: 'DEPLOYMENT_MODE', value: 'production' }
  { name: 'DEPLOYMENT_LABEL', value: deploymentLabel }
  { name: 'ALLOWED_HOSTS', value: allowedHosts }
  { name: 'ALLOWED_ORIGINS', value: baseUrl }
  // One proxy hop: the Container Apps ingress. It MUST be 1: the application refuses to start in a hosted deployment with 0,
  // because every caller would then look like the ingress and the per-address limits and the signup throttle would count the whole
  // world as one address. The BYOK key is accepted only on a request that arrived over TLS, which the application reads from
  // x-forwarded-proto of a trusted proxy. It is not a parameter.
  { name: 'TRUST_PROXY', value: '1' }
  {
    name: 'DATABASE_URL'
    value: 'postgres://${uriComponent(identity.outputs.name)}@${database.outputs.fullyQualifiedDomainName}:5432/${database.outputs.databaseName}?sslmode=require'
  }
  { name: 'DATABASE_AUTH', value: 'entra' }
  // The free tier: Microsoft Foundry through its OpenAI-compatible v1 API, signed in with the managed identity (no key), on a
  // deployment that is declared NON-REASONING and has a price. FOUNDRY_DEPLOYMENT_REASONING is never set: the application
  // refuses to start in public mode if it is, and so does it for a deployment declared reasoning or without a price.
  { name: 'AI_PROVIDER', value: 'foundry' }
  { name: 'AI_MODEL', value: aiDeploymentName }
  {
    name: 'FOUNDRY_ENDPOINT'
    value: empty(azureOpenAiEndpoint) ? 'https://${aiAccountName}.openai.azure.com/' : azureOpenAiEndpoint
  }
  { name: 'FOUNDRY_AUTH', value: 'entra' }
  { name: 'FOUNDRY_DEPLOYMENT_PROFILES', value: string({ '${aiDeploymentName}': { reasoning: false } }) }
  {
    name: 'MODEL_PRICES'
    value: string([
      {
        deployment: aiDeploymentName
        inputPerMillionUsd: json(modelInputPricePerMillionUsd)
        outputPerMillionUsd: json(modelOutputPricePerMillionUsd)
      }
    ])
  }
  // Forced off by the application in public mode as well: a cache would answer one person from another's model call.
  { name: 'MODEL_CACHE', value: 'off' }
  { name: 'AZURE_CLIENT_ID', value: identity.outputs.clientId }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: monitoring.outputs.appInsightsConnectionString }
  {
    name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING'
    value: 'Authorization=AAD;ClientId=${identity.outputs.clientId}'
  }
  { name: 'OTEL_SERVICE_NAME', value: 'swarm' }
  { name: 'LOG_LEVEL', value: 'info' }
  { name: 'RATE_LIMIT_SCALE', value: '1' }
  { name: 'SWARM_ROLE', value: 'all' }
  { name: 'RESEARCH_SEARCH_PROVIDER', value: 'none' }
  { name: 'DEFAULT_ENGINE', value: defaultEngine }
  { name: 'PROJECT_MODEL_CALL_LIMIT', value: string(projectModelCallLimit) }
  { name: 'PROJECT_MODEL_TOKEN_LIMIT', value: string(projectModelTokenLimit) }
]

// The public edition: the names and defaults of docs/public/DESIGN.md, section 3, and nothing else. Never set here, on
// purpose: PUBLIC_ALLOW_UNSAFE_SQLITE and PUBLIC_ALLOW_REASONING_DEPLOYMENT (each a way round a safety check) and
// PUBLIC_DB_RUNTIME_ROLE (its default, swarm_app, is what docs/public/DEPLOY.md checks).
var publicEnvironment = concat(
  [
    { name: 'SWARM_EDITION', value: 'public' }
    { name: 'PUBLIC_BASE_URL', value: baseUrl }
    { name: 'PUBLIC_SIGNUPS_ENABLED', value: signupsEnabled ? 'true' : 'false' }
    // Guest mode: no sign-in. New guests obey PUBLIC_SIGNUPS_ENABLED above, and are counted per address and for the whole site.
    { name: 'PUBLIC_GUEST_MODE', value: guestMode ? 'true' : 'false' }
    { name: 'PUBLIC_GUESTS_PER_IP_PER_HOUR', value: string(guestsPerIpPerHour) }
    { name: 'PUBLIC_GUESTS_PER_HOUR', value: string(guestsPerHour) }
    { name: 'PUBLIC_GUEST_RETENTION_HOURS', value: string(guestRetentionHours) }
    { name: 'PUBLIC_MAX_PROJECTS', value: string(maxProjects) }
    { name: 'PUBLIC_STORAGE_QUOTA_MB', value: string(storageQuotaMb) }
    { name: 'PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS', value: string(deletedAccountRetentionDays) }
    { name: 'PUBLIC_ALLOW_RESEARCH', value: allowResearch ? 'true' : 'false' }
    { name: 'PUBLIC_OPS_KEY_SHA256', value: toLower(opsKeySha256) }
    { name: 'PUBLIC_SIGNUPS_PER_IP_PER_DAY', value: string(signupsPerIpPerDay) }
    { name: 'PUBLIC_SIGNUPS_PER_HOUR', value: string(signupsPerHour) }
    // The session limits of a hosted deployment (at most 60 idle minutes and 12 hours), which the parameters cannot exceed.
    { name: 'AUTH_SESSION_IDLE_MINUTES', value: string(sessionIdleMinutes) }
    { name: 'AUTH_SESSION_ABSOLUTE_HOURS', value: string(sessionAbsoluteHours) }
    { name: 'FREE_TIER_ENABLED', value: freeTierEnabled ? 'true' : 'false' }
    { name: 'FREE_USER_DAILY_TOKENS', value: string(freeUserDailyTokens) }
    { name: 'FREE_USER_DAILY_CALLS', value: string(freeUserDailyCalls) }
    { name: 'FREE_USER_LIFETIME_TOKENS', value: string(freeUserLifetimeTokens) }
    { name: 'FREE_USER_CONCURRENT_RUNS', value: string(freeUserConcurrentRuns) }
    { name: 'FREE_USER_CONCURRENT_CALLS', value: string(freeUserConcurrentCalls) }
    { name: 'FREE_GLOBAL_DAILY_TOKENS', value: string(freeGlobalDailyTokens) }
    { name: 'FREE_GLOBAL_DAILY_COST_USD', value: freeGlobalDailyCostUsd }
    { name: 'FREE_TOKENS_PER_RUN', value: string(freeTokensPerRun) }
    { name: 'FREE_GUEST_DAILY_TOKENS', value: string(freeGuestDailyTokens) }
    { name: 'FREE_GUEST_DAILY_CALLS', value: string(freeGuestDailyCalls) }
    { name: 'FREE_GUEST_LIFETIME_TOKENS', value: string(freeGuestLifetimeTokens) }
    { name: 'FREE_GUEST_CONCURRENT_RUNS', value: string(freeGuestConcurrentRuns) }
    { name: 'FREE_GUEST_CONCURRENT_CALLS', value: string(freeGuestConcurrentCalls) }
    { name: 'FREE_GUEST_TOKENS_PER_RUN', value: string(freeGuestTokensPerRun) }
    { name: 'BYOK_ENABLED', value: byokEnabled ? 'true' : 'false' }
    { name: 'BYOK_MAX_CONCURRENT_CALLS', value: string(byokMaxConcurrentCalls) }
  ],
  optionalSetting('PUBLIC_GOOGLE_CLIENT_ID', googleClientId),
  optionalSetting('PUBLIC_GITHUB_CLIENT_ID', githubClientId),
  optionalSetting('PUBLIC_ADMIN_EMAILS', adminEmails),
  optionalSetting('PUBLIC_BLOCKED_EMAIL_DOMAINS', blockedEmailDomains),
  optionalSetting('PUBLIC_OWNER_KEY_SHA256', toLower(ownerKeySha256)),
  optionalSetting('TURNSTILE_SITE_KEY', turnstileSiteKey),
  optionalSetting('FREE_ROLE_MAX_OUTPUT_TOKENS', freeRoleMaxOutputTokens),
  optionalSetting('SOURCE_URL', sourceUrl),
  optionalSetting('BUILD_SHA', buildSha)
)

// The secrets of the public edition. Each is read from Key Vault by the app's identity when a replica starts; the vault holds the
// value, a person put it there, and this template never sees it. The pepper (PUBLIC_PEPPER, at least 32 characters) is always
// needed: it keys the hashes of addresses and of deleted accounts, and the application refuses to start without it. A provider is
// offered only when both its client ID and its secret are set, so a provider that is not configured has no reference at all: in
// guest mode with no provider, the pepper is the only reference (and the Turnstile secret, when its site key is set).
var secretSettings = concat(
  [{ env: 'PUBLIC_PEPPER', secretName: 'public-pepper' }],
  empty(googleClientId) ? [] : [{ env: 'PUBLIC_GOOGLE_CLIENT_SECRET', secretName: 'public-google-client-secret' }],
  empty(githubClientId) ? [] : [{ env: 'PUBLIC_GITHUB_CLIENT_SECRET', secretName: 'public-github-client-secret' }],
  empty(turnstileSiteKey) ? [] : [{ env: 'TURNSTILE_SECRET_KEY', secretName: 'turnstile-secret-key' }]
)
var appSecrets = map(secretSettings, setting => {
  name: setting.secretName
  keyVaultUrl: '${keyVault.outputs.vaultUri}secrets/${setting.secretName}'
  identity: identity.outputs.id
})
var secretEnvironment = [
  for setting in secretSettings: {
    name: setting.env
    secretRef: setting.secretName
  }
]

// The app waits for every role assignment above: it starts using the identity as soon as it runs.
module app 'modules/container-app.bicep' = if (deployApp) {
  name: '${baseName}-app'
  scope: group
  params: {
    appName: appName
    location: location
    tags: tags
    environmentId: appEnvironment.outputs.id
    identityResourceId: identity.outputs.id
    registryLoginServer: registry.outputs.loginServer
    image: containerImage
    imageIsFromThisDeploymentsRegistry: any(startsWith(containerImage, '${registry.outputs.loginServer}/'))
    cpu: cpu
    minReplicas: minReplicas
    targetPort: appPort
    probeHost: fqdn
    environmentVariables: concat(coreEnvironment, publicEnvironment, secretEnvironment)
    secrets: appSecrets
    ingressAllowedCidrs: ingressAllowedCidrs
    customDomains: empty(customDomainName)
      ? []
      : [
          {
            name: customDomainName
            certificateId: customDomainCertificateId
            bindingType: 'SniEnabled'
          }
        ]
    maxInactiveRevisions: maxInactiveRevisions
  }
  dependsOn: [aiAccess, appInsightsAccess]
}

module alerts 'modules/alerts.bicep' = if (deployApp) {
  name: '${baseName}-alerts'
  scope: group
  params: {
    baseName: baseName
    tags: tags
    containerAppResourceId: app.?outputs.id ?? ''
    databaseServerResourceId: database.outputs.serverResourceId
    emailAddresses: concat([alertEmailAddress], additionalAlertEmailAddresses)
    alertOnNoReplicas: minReplicas == 1
    http5xxPer5Minutes: http5xxPer5Minutes
  }
}

// ---------------------------------------------------------------------------------------------
// The budget and the free-tier kill switch
// ---------------------------------------------------------------------------------------------

module actionGroups 'modules/action-groups.bicep' = {
  name: '${baseName}-action-groups'
  scope: group
  params: {
    baseName: baseName
    tags: tags
    emailAddresses: concat([alertEmailAddress], additionalAlertEmailAddresses)
    webhookHost: fqdn
    opsKey: opsKey
  }
}

// What the budget counts: this group and the group of the model account when it is in this subscription (the model is where
// the variable cost is). Both spellings of each name, because it is not known whether cost data keeps the case. A model account
// in another subscription is not counted: give that subscription a budget of its own.
var budgetResourceGroups = union(
  [resourceGroupName, toLower(resourceGroupName)],
  toLower(aiAccountSubscriptionId) == toLower(subscription().subscriptionId)
    ? [aiAccountResourceGroup, toLower(aiAccountResourceGroup)]
    : []
)
var budgetEmails = concat([alertEmailAddress], additionalAlertEmailAddresses)
var budgetNotice = {
  enabled: true
  operator: 'GreaterThan'
  thresholdType: 'Actual'
  contactEmails: budgetEmails
  locale: 'en-us'
}

// A budget is an ALERT, not a cap: Azure evaluates it a few times a day on cost data that is itself hours behind, and nothing
// is stopped when a threshold is crossed. The 100 and 120 percent notices also call the webhook that turns the free tier off;
// the application's own daily cap (FREE_GLOBAL_DAILY_*) is the protection that works in real time.
resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'budget-${baseName}'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    filter: {
      dimensions: {
        name: 'ResourceGroupName'
        operator: 'In'
        values: budgetResourceGroups
      }
    }
    notifications: {
      'Actual_GreaterThan_50_Percent_${budgetCurrencyLabel}': union(budgetNotice, {
        threshold: 50
        contactGroups: [actionGroups.outputs.warnActionGroupId]
      })
      'Actual_GreaterThan_80_Percent_${budgetCurrencyLabel}': union(budgetNotice, {
        threshold: 80
        contactGroups: [actionGroups.outputs.warnActionGroupId]
      })
      'Actual_GreaterThan_100_Percent_${budgetCurrencyLabel}': union(budgetNotice, {
        threshold: 100
        contactGroups: [actionGroups.outputs.stopActionGroupId]
      })
      'Actual_GreaterThan_120_Percent_${budgetCurrencyLabel}': union(budgetNotice, {
        threshold: 120
        contactGroups: [actionGroups.outputs.stopActionGroupId]
      })
      'Forecasted_GreaterThan_100_Percent_${budgetCurrencyLabel}': union(budgetNotice, {
        thresholdType: 'Forecasted'
        threshold: 100
        contactGroups: [actionGroups.outputs.warnActionGroupId]
      })
    }
  }
}

// None of these is a secret. The OAuth redirect URIs are what the Google and GitHub OAuth apps must list, exactly.
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = group.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.name
output AZURE_CONTAINER_APP_NAME string = appName
output AZURE_CONTAINER_APP_FQDN string = fqdn
output AZURE_CONTAINER_APPS_ENVIRONMENT_NAME string = appEnvironment.outputs.name
output AZURE_CONTAINER_APP_DEPLOYED bool = deployApp
output PUBLIC_BASE_URL string = baseUrl
output OAUTH_REDIRECT_URI_GOOGLE string = '${baseUrl}/auth/callback/google'
output OAUTH_REDIRECT_URI_GITHUB string = '${baseUrl}/auth/callback/github'
output AZURE_KEY_VAULT_NAME string = keyVault.outputs.vaultName
output AZURE_USER_ASSIGNED_IDENTITY_NAME string = identity.outputs.name
output AZURE_USER_ASSIGNED_IDENTITY_CLIENT_ID string = identity.outputs.clientId
output AZURE_USER_ASSIGNED_IDENTITY_PRINCIPAL_ID string = identity.outputs.principalId
output AZURE_POSTGRES_SERVER_NAME string = database.outputs.serverName
output AZURE_POSTGRES_DATABASE string = database.outputs.databaseName
output AZURE_BUDGET_NAME string = budget.name
output AZURE_BUDGET_ACTION_GROUP_NAME string = actionGroups.outputs.stopActionGroupName
output AZURE_ALERT_ACTION_GROUP_NAME string = alerts.?outputs.actionGroupName ?? ''
