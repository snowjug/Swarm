using './main.bicep'

// THE PRODUCTION-SHAPED PROFILE: what the pilot template looks like when money is no object and the
// subscription is a paid one. Redeploying there is a change of parameter file, not of template.
//
// It is a SHAPE, not a certificate. Nothing here has been deployed, no cost in it has been paid, and
// several settings depend on what the target region offers (availability zones, geo-redundant backup,
// the PostgreSQL SKU): run `npm run azure:preflight -- --region <region> --profile production-shaped`
// first (docs/production/azure-preflight.md). The application behind it is still a controlled-pilot
// build: docs/production/LIMITATIONS.md lists what is not production-grade whatever the infrastructure.
//
// Compared with main.bicepparam (the pilot):
//   - PostgreSQL: General Purpose D2ds_v5, 128 GiB, zone-redundant high availability, geo-redundant
//     backups, 35 days of point-in-time restore, private access (no public endpoint, no firewall rule)
//   - Container Apps: 1 vCPU / 2 GiB, a zone-redundant environment integrated with a virtual network,
//     a NAT gateway for one fixed outbound address
//   - Registry: Premium with zone redundancy
//   - Key Vault on (purge-protected), logs kept 90 days with a higher daily cap, 10 inactive revisions
//   - the latency alert at the service-level objective (1 s) rather than the pilot's 1.5 s
// Replicas stay at one: running several against one database is argued, not measured, and the research
// fetch registry is per process (docs/production/LIMITATIONS.md). Raise both only after that is tested.

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'swarm-prodshape')

param aiAccountResourceId = readEnvironmentVariable('SWARM_AI_ACCOUNT_RESOURCE_ID', '')
param aiDeploymentName = readEnvironmentVariable('SWARM_AI_DEPLOYMENT_NAME', 'swarm-chat')
param azureOpenAiEndpoint = readEnvironmentVariable('SWARM_AZURE_OPENAI_ENDPOINT', '')
param authClientId = readEnvironmentVariable('SWARM_AUTH_CLIENT_ID', '')
param authAudience = readEnvironmentVariable('SWARM_AUTH_AUDIENCE', '')
param sourceUrl = readEnvironmentVariable('SWARM_SOURCE_URL', '')
param containerImage = readEnvironmentVariable('SWARM_CONTAINER_IMAGE', '')
param appExists = bool(readEnvironmentVariable('SERVICE_SWARM_RESOURCE_EXISTS', 'false'))

param alertEmailAddress = readEnvironmentVariable('SWARM_ALERT_EMAIL', '')
param additionalAlertEmailAddresses = filter(split(readEnvironmentVariable('SWARM_ADDITIONAL_ALERT_EMAILS', ''), ','), address => !empty(address))
param budgetAmount = int(readEnvironmentVariable('SWARM_BUDGET_AMOUNT', '45000'))
param budgetCurrencyLabel = readEnvironmentVariable('SWARM_BUDGET_CURRENCY', 'INR')

param existingWorkspaceResourceId = readEnvironmentVariable('SWARM_EXISTING_WORKSPACE_ID', '')
param existingAppInsightsResourceId = readEnvironmentVariable('SWARM_EXISTING_APPINSIGHTS_ID', '')
param existingRegistryResourceId = readEnvironmentVariable('SWARM_EXISTING_REGISTRY_ID', '')
param existingPostgresServerResourceId = readEnvironmentVariable('SWARM_EXISTING_POSTGRES_SERVER_ID', '')
param existingKeyVaultResourceId = readEnvironmentVariable('SWARM_EXISTING_KEYVAULT_ID', '')
param existingContainerAppsEnvironmentResourceId = readEnvironmentVariable('SWARM_EXISTING_CONTAINER_APPS_ENVIRONMENT_ID', '')
param ingressAllowedCidrs = filter(split(readEnvironmentVariable('SWARM_INGRESS_ALLOWED_CIDRS', ''), ','), cidr => !empty(cidr))
param researchSignalsEmitted = bool(readEnvironmentVariable('SWARM_RESEARCH_SIGNALS_EMITTED', 'false'))
param revisionSuffix = readEnvironmentVariable('SWARM_REVISION_SUFFIX', '')
param trafficMode = readEnvironmentVariable('SWARM_TRAFFIC_MODE', 'preserve')
param previousRevisionName = readEnvironmentVariable('SWARM_PREVIOUS_REVISION', '')
param newRevisionTrafficPercent = int(readEnvironmentVariable('SWARM_NEW_REVISION_TRAFFIC_PERCENT', '100'))
param keyVaultSecretReferences = json(readEnvironmentVariable('SWARM_KEYVAULT_SECRET_REFERENCES', '[]'))

// Compute
param cpu = '1'
param minReplicas = 1
param maxReplicas = 1
param maxInactiveRevisions = 10

// PostgreSQL
param databaseSkuName = 'Standard_D2ds_v5'
param databaseSkuTier = 'GeneralPurpose'
param databaseStorageGb = 128
param databaseStorageAutoGrow = 'Enabled'
param databaseHighAvailability = 'ZoneRedundant'
param databaseGeoRedundantBackup = 'Enabled'
param backupRetentionDays = 35
// UNVERIFIED: the documented max_connections of an 8 GiB General Purpose server. Check SHOW max_connections.
param databaseMaxConnections = 859

// Registry, logs, secrets
param registrySku = 'Premium'
param registryZoneRedundant = true
param logRetentionDays = 90
param dailyLogCapGb = '5'
param enableKeyVault = true

// Network
param enablePrivateNetworking = true
param enableNatGateway = true
param containerAppsZoneRedundant = true

// Alerts
param p95LatencyMs = 1000

// What this deployment is. The application refuses to start in production without a label of its own
// (backend/src/deployment.ts): replace this with the description the people who use it should read.
param deploymentMode = 'production'
param deploymentLabel = 'Swarm scenario laboratory (replace with your own description)'
