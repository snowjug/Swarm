using './main.bicep'

// THE PILOT PROFILE: the cheapest sane defaults for a controlled pilot. (infra/pilot/production-shaped.bicepparam
// is the other profile: zone redundancy, high availability, geo-redundant backups, private networking and
// larger SKUs, for a paid subscription.) azd reads this file, so it keeps the name main.bicepparam.
//
// Nothing environment-specific is stored in this file. Each value is read from an environment variable
// (`azd env set NAME value` for azd, `$env:NAME = 'value'` for az), and an unset variable gives an
// empty value: the template then rejects a required one before anything is created, and treats an
// optional one as "not set". Parameters that have a default (sizes, replicas, retention) are not listed;
// override one with `--parameters name=value`.

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'swarm-pilot')

// Required. The EXISTING Foundry / Azure OpenAI account the app calls (its resource ID).
param aiAccountResourceId = readEnvironmentVariable('SWARM_AI_ACCOUNT_RESOURCE_ID', '')
param aiDeploymentName = readEnvironmentVariable('SWARM_AI_DEPLOYMENT_NAME', 'swarm-chat')
// Optional. Empty derives https://<account name>.openai.azure.com/ from the resource ID.
param azureOpenAiEndpoint = readEnvironmentVariable('SWARM_AZURE_OPENAI_ENDPOINT', '')

// Required. Application (client) ID of the Microsoft Entra Web app registration people sign in with.
param authClientId = readEnvironmentVariable('SWARM_AUTH_CLIENT_ID', '')
// Optional. Empty uses the client ID.
param authAudience = readEnvironmentVariable('SWARM_AUTH_AUDIENCE', '')

// Required. Where alerts and budget notifications go: a person or a shared mailbox, never committed.
param alertEmailAddress = readEnvironmentVariable('SWARM_ALERT_EMAIL', '')
// Optional, comma separated.
param additionalAlertEmailAddresses = filter(split(readEnvironmentVariable('SWARM_ADDITIONAL_ALERT_EMAILS', ''), ','), address => !empty(address))

// Optional. The public address of the exact source version deployed.
param sourceUrl = readEnvironmentVariable('SWARM_SOURCE_URL', '')

// Optional. Empty keeps the image that already runs, or starts a placeholder on the first provision.
param containerImage = readEnvironmentVariable('SWARM_CONTAINER_IMAGE', '')
// azd sets this to true once the app exists, so that `azd provision` does not reset its image or its traffic.
param appExists = bool(readEnvironmentVariable('SERVICE_SWARM_RESOURCE_EXISTS', 'false'))

// Optional. The monthly budget in the BILLING currency of the subscription (a budget alerts; it is not a cap).
param budgetAmount = int(readEnvironmentVariable('SWARM_BUDGET_AMOUNT', '4500'))
param budgetCurrencyLabel = readEnvironmentVariable('SWARM_BUDGET_CURRENCY', 'INR')

// Optional: use what already exists instead of creating a duplicate. Each is a full resource ID, empty to create.
param existingWorkspaceResourceId = readEnvironmentVariable('SWARM_EXISTING_WORKSPACE_ID', '')
param existingAppInsightsResourceId = readEnvironmentVariable('SWARM_EXISTING_APPINSIGHTS_ID', '')
param existingRegistryResourceId = readEnvironmentVariable('SWARM_EXISTING_REGISTRY_ID', '')
param existingPostgresServerResourceId = readEnvironmentVariable('SWARM_EXISTING_POSTGRES_SERVER_ID', '')
param existingKeyVaultResourceId = readEnvironmentVariable('SWARM_EXISTING_KEYVAULT_ID', '')
param existingContainerAppsEnvironmentResourceId = readEnvironmentVariable('SWARM_EXISTING_CONTAINER_APPS_ENVIRONMENT_ID', '')

// Optional. Client address ranges (CIDR, comma separated) allowed to reach the app; empty allows everyone.
param ingressAllowedCidrs = filter(split(readEnvironmentVariable('SWARM_INGRESS_ALLOWED_CIDRS', ''), ','), cidr => !empty(cidr))

// Set to true once the application emits the swarm.research.* signals (docs/production/observability.md).
param researchSignalsEmitted = bool(readEnvironmentVariable('SWARM_RESEARCH_SIGNALS_EMITTED', 'false'))

// Releases (docs/production/release-process.md). scripts/azure/release.ts drives the revision with
// `az containerapp`; these let the same release be made with this template instead. The default keeps
// the live app's traffic, so applying the template without a release never moves traffic.
param revisionSuffix = readEnvironmentVariable('SWARM_REVISION_SUFFIX', '')
param trafficMode = readEnvironmentVariable('SWARM_TRAFFIC_MODE', 'preserve')
param previousRevisionName = readEnvironmentVariable('SWARM_PREVIOUS_REVISION', '')
param newRevisionTrafficPercent = int(readEnvironmentVariable('SWARM_NEW_REVISION_TRAFFIC_PERCENT', '100'))

// Optional. Settings whose value is a Key Vault secret, as JSON, for example
// [{"envName":"AUTH_ENTRA_CLIENT_SECRET","secretName":"swarm-client-secret"}]. Empty: no secret at all,
// which is the pilot's design (the app proves itself to Entra with its managed identity).
param keyVaultSecretReferences = json(readEnvironmentVariable('SWARM_KEYVAULT_SECRET_REFERENCES', '[]'))
// Optional. none (the default), wikipedia (no key; background pages) or brave (a key, as the Key Vault secret
// reference RESEARCH_SEARCH_API_KEY above). A provider is sent the names and topics of a question, so it is
// the owner's decision (docs/production/LIMITATIONS.md, A6).
param researchSearchProvider = readEnvironmentVariable('SWARM_RESEARCH_SEARCH_PROVIDER', 'none')
