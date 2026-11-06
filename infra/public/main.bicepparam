using './main.bicep'

// THE PUBLIC EDITION. Nothing environment-specific is stored in this file. Each value is read from an environment variable
// (export it in the shell that runs `az`), and an unset variable gives an empty value: the template then rejects a required one
// before anything is created, and treats an optional one as "not set". Every variable starts with SWARM_PUBLIC_, so that a
// variable of the pilot (AZURE_ENV_NAME, SWARM_AI_ACCOUNT_RESOURCE_ID, SWARM_ALERT_EMAIL, ...) can never be picked up by mistake.
//
// KEEP ONE ENVIRONMENT FILE and export all of it on every apply. A variable that is left out puts its default back, so a cap
// that was lowered once is silently raised again by an apply that forgets it. The values with a default below are the defaults
// of docs/public/DESIGN.md, section 3. The commands, in order, are in docs/public/DEPLOY.md.
//
// Not read here, and set with `--parameters name=value` when needed: location (use --location), resourceGroupName, extraTags,
// budgetStartDate, the alert thresholds, the Log Analytics, Key Vault and storage settings, maxInactiveRevisions.

param environmentName = readEnvironmentVariable('SWARM_PUBLIC_ENV_NAME', 'swarm-public')

// REQUIRED, with no default, on purpose. false: everything except the container app (the first deployment). true: the app too, which
// needs the provider secrets in the vault and an image in the registry. An unset variable stops the deployment before anything is
// created: BCP427, Environment variable "SWARM_PUBLIC_DEPLOY_APP" does not exist.
param deployApp = bool(readEnvironmentVariable('SWARM_PUBLIC_DEPLOY_APP'))

// REQUIRED. The EXISTING Azure OpenAI / Foundry account of the public edition (its resource ID), and the name of its NON-REASONING
// deployment, for example gpt-4.1-mini. The template reads the deployment and refuses a reasoning model.
param aiAccountResourceId = readEnvironmentVariable('SWARM_PUBLIC_AI_ACCOUNT_RESOURCE_ID', '')
param aiDeploymentName = readEnvironmentVariable('SWARM_PUBLIC_AI_DEPLOYMENT_NAME', '')
// Optional. Empty derives https://<account name>.openai.azure.com/ from the resource ID.
param azureOpenAiEndpoint = readEnvironmentVariable('SWARM_PUBLIC_AZURE_OPENAI_ENDPOINT', '')
// REQUIRED. US dollars per ONE MILLION tokens of that deployment, as text, from the Azure OpenAI pricing page for its SKU and region.
param modelInputPricePerMillionUsd = readEnvironmentVariable('SWARM_PUBLIC_MODEL_INPUT_PRICE_USD', '')
param modelOutputPricePerMillionUsd = readEnvironmentVariable('SWARM_PUBLIC_MODEL_OUTPUT_PRICE_USD', '')
// Optional. rules (the default) or model: what a new question starts with. A preselection; the person can change it.
param defaultEngine = readEnvironmentVariable('SWARM_PUBLIC_DEFAULT_ENGINE', 'rules')

// Optional. The https origin of the site, in lower case, with no path: empty is the default address of the app.
param publicBaseUrl = readEnvironmentVariable('SWARM_PUBLIC_BASE_URL', '')
// The client IDs are not secrets. The secrets are Key Vault secrets that a person puts there, never a value in this file or in the
// environment: public-pepper (always: at least 32 characters, it keys the hashes of addresses and of deleted accounts, and must never
// change), public-google-client-secret, public-github-client-secret and turnstile-secret-key (docs/public/DEPLOY.md).
// At least one provider is required when SWARM_PUBLIC_DEPLOY_APP is true.
param googleClientId = readEnvironmentVariable('SWARM_PUBLIC_GOOGLE_CLIENT_ID', '')
param githubClientId = readEnvironmentVariable('SWARM_PUBLIC_GITHUB_CLIENT_ID', '')
// Optional, comma separated: the verified e-mail addresses of the platform administrators. Personal data: never commit them.
param adminEmails = readEnvironmentVariable('SWARM_PUBLIC_ADMIN_EMAILS', '')
param signupsEnabled = bool(readEnvironmentVariable('SWARM_PUBLIC_SIGNUPS_ENABLED', 'true'))
// Optional, comma separated: e-mail domains that cannot sign up.
param blockedEmailDomains = readEnvironmentVariable('SWARM_PUBLIC_BLOCKED_EMAIL_DOMAINS', '')
// Optional. Empty: bot protection is off. Its secret is the Key Vault secret turnstile-secret-key.
param turnstileSiteKey = readEnvironmentVariable('SWARM_PUBLIC_TURNSTILE_SITE_KEY', '')
param maxProjects = int(readEnvironmentVariable('SWARM_PUBLIC_MAX_PROJECTS', '10'))
param storageQuotaMb = int(readEnvironmentVariable('SWARM_PUBLIC_STORAGE_QUOTA_MB', '20'))
param deletedAccountRetentionDays = int(readEnvironmentVariable('SWARM_PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS', '30'))
param signupsPerIpPerDay = int(readEnvironmentVariable('SWARM_PUBLIC_SIGNUPS_PER_IP_PER_DAY', '5'))
param signupsPerHour = int(readEnvironmentVariable('SWARM_PUBLIC_SIGNUPS_PER_HOUR', '60'))
// A hosted deployment allows at most 60 idle minutes and 12 hours in all.
param sessionIdleMinutes = int(readEnvironmentVariable('SWARM_PUBLIC_SESSION_IDLE_MINUTES', '30'))
param sessionAbsoluteHours = int(readEnvironmentVariable('SWARM_PUBLIC_SESSION_ABSOLUTE_HOURS', '8'))
param allowResearch = bool(readEnvironmentVariable('SWARM_PUBLIC_ALLOW_RESEARCH', 'false'))
param projectModelCallLimit = int(readEnvironmentVariable('SWARM_PUBLIC_PROJECT_MODEL_CALL_LIMIT', '300'))
param projectModelTokenLimit = int(readEnvironmentVariable('SWARM_PUBLIC_PROJECT_MODEL_TOKEN_LIMIT', '400000'))

// The free tier and bring your own key: docs/public/DESIGN.md, sections 6 and 7. None of them can be 0.
param freeTierEnabled = bool(readEnvironmentVariable('SWARM_PUBLIC_FREE_TIER_ENABLED', 'true'))
param freeUserDailyTokens = int(readEnvironmentVariable('SWARM_PUBLIC_FREE_USER_DAILY_TOKENS', '60000'))
param freeUserDailyCalls = int(readEnvironmentVariable('SWARM_PUBLIC_FREE_USER_DAILY_CALLS', '40'))
param freeUserLifetimeTokens = int(readEnvironmentVariable('SWARM_PUBLIC_FREE_USER_LIFETIME_TOKENS', '300000'))
param freeUserConcurrentRuns = int(readEnvironmentVariable('SWARM_PUBLIC_FREE_USER_CONCURRENT_RUNS', '1'))
param freeUserConcurrentCalls = int(readEnvironmentVariable('SWARM_PUBLIC_FREE_USER_CONCURRENT_CALLS', '3'))
param freeGlobalDailyTokens = int(readEnvironmentVariable('SWARM_PUBLIC_FREE_GLOBAL_DAILY_TOKENS', '2000000'))
// US dollars a day, as text: 5, or 2.50.
param freeGlobalDailyCostUsd = readEnvironmentVariable('SWARM_PUBLIC_FREE_GLOBAL_DAILY_COST_USD', '5')
param freeTokensPerRun = int(readEnvironmentVariable('SWARM_PUBLIC_FREE_TOKENS_PER_RUN', '15000'))
// Optional JSON, per model role. Empty: the table in the application.
param freeRoleMaxOutputTokens = readEnvironmentVariable('SWARM_PUBLIC_FREE_ROLE_MAX_OUTPUT_TOKENS', '')
param byokEnabled = bool(readEnvironmentVariable('SWARM_PUBLIC_BYOK_ENABLED', 'true'))
param byokMaxConcurrentCalls = int(readEnvironmentVariable('SWARM_PUBLIC_BYOK_MAX_CONCURRENT_CALLS', '4'))

// Required when SWARM_PUBLIC_DEPLOY_APP is true: <registry>.azurecr.io/swarm@sha256:<digest>, from the registry this deployment made.
// Give it on EVERY apply: an apply with an older image rolls the app back to it.
param containerImage = readEnvironmentVariable('SWARM_PUBLIC_CONTAINER_IMAGE', '')
param cpu = readEnvironmentVariable('SWARM_PUBLIC_CPU', '0.5')
// 1 (the default) or 0. Scaling to zero ends a long run and drops every BYOK key held in memory. There is no maximum: it is 1.
param minReplicas = int(readEnvironmentVariable('SWARM_PUBLIC_MIN_REPLICAS', '1'))
// Optional. Client address ranges (CIDR, comma separated) allowed to reach the app; empty allows everyone, which a public site needs.
param ingressAllowedCidrs = filter(split(readEnvironmentVariable('SWARM_PUBLIC_INGRESS_ALLOWED_CIDRS', ''), ','), cidr => !empty(cidr))
param deploymentLabel = readEnvironmentVariable('SWARM_PUBLIC_DEPLOYMENT_LABEL', 'Swarm public edition')
// Optional. The commit the image was built from, and the public address of the exact source version (the licence is AGPL-3.0).
param buildSha = readEnvironmentVariable('SWARM_PUBLIC_BUILD_SHA', '')
param sourceUrl = readEnvironmentVariable('SWARM_PUBLIC_SOURCE_URL', '')
// Optional, and filled in only AFTER the two-phase custom domain procedure of docs/public/DEPLOY.md. From then on, give both on every
// apply, or the domain is unbound.
param customDomainName = readEnvironmentVariable('SWARM_PUBLIC_CUSTOM_DOMAIN', '')
param customDomainCertificateId = readEnvironmentVariable('SWARM_PUBLIC_CUSTOM_DOMAIN_CERTIFICATE_ID', '')

// REQUIRED. The webhook key (a secret: openssl rand -hex 32, kept out of files) and its SHA-256 (printf '%s' "$KEY" | sha256sum).
param opsKey = readEnvironmentVariable('SWARM_PUBLIC_OPS_KEY', '')
param opsKeySha256 = readEnvironmentVariable('SWARM_PUBLIC_OPS_KEY_SHA256', '')

// REQUIRED. Where alerts and budget notices go: a person or a shared mailbox, never committed. Additional addresses are comma separated.
param alertEmailAddress = readEnvironmentVariable('SWARM_PUBLIC_ALERT_EMAIL', '')
param additionalAlertEmailAddresses = filter(split(readEnvironmentVariable('SWARM_PUBLIC_ADDITIONAL_ALERT_EMAILS', ''), ','), address => !empty(address))
// REQUIRED, with no default: the owner's money and the owner's number, in the BILLING currency of the subscription, and its three-letter
// label (a budget alerts; it is not a cap, and Azure's cost data arrives hours late).
param budgetAmount = int(readEnvironmentVariable('SWARM_PUBLIC_BUDGET_AMOUNT'))
param budgetCurrencyLabel = readEnvironmentVariable('SWARM_PUBLIC_BUDGET_CURRENCY', '')

// PostgreSQL compute. Burstable B1ms is the cheapest choice, but a subscription can be refused it in a region (SkuNotAvailable). The
// fallback that worked for the pilot is SWARM_PUBLIC_DATABASE_SKU_NAME=Standard_D2ds_v4 with SWARM_PUBLIC_DATABASE_SKU_TIER=GeneralPurpose
// (about 8 times the price: docs/azure/pilot-cost.md). Keep them set on every later apply.
param databaseSkuName = readEnvironmentVariable('SWARM_PUBLIC_DATABASE_SKU_NAME', 'Standard_B1ms')
param databaseSkuTier = readEnvironmentVariable('SWARM_PUBLIC_DATABASE_SKU_TIER', 'Burstable')
// Optional. After a point-in-time restore (which always makes a NEW server): the name of that server, in this resource group, so that
// the template and the app use it (docs/public/DEPLOY.md, "Rollback"). Empty: the server this template makes.
param existingDatabaseServerName = readEnvironmentVariable('SWARM_PUBLIC_EXISTING_DATABASE_SERVER_NAME', '')
