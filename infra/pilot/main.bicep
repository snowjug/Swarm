// Swarm hosted pilot at resource-group scope: a production-candidate CONTROLLED PILOT, not a broad
// public production service. One container app, one PostgreSQL database, and what they need.
//
// - Every credential is a Microsoft Entra token of ONE user-assigned managed identity. There are no
//   keys, passwords or connection strings with secrets in this template. Key Vault exists only for a
//   value that cannot be a token (an optional OIDC client secret) and is off unless asked for.
// - The app runs in multiple-revision mode: a release is blue/green and a rollback is a traffic change.
// - Everything expensive or shared can be an EXISTING resource instead of a new one (existing*ResourceId):
//   the Foundry / Azure OpenAI account (always), PostgreSQL server, container registry, Log Analytics
//   workspace, Application Insights component, Key Vault, Container Apps environment. An existing resource
//   is read, and at most one role assignment for the application identity is added to it.
// - Deploy into a NEW resource group dedicated to the pilot; deleting that group removes everything
//   created here and nothing else.
//
// Authored and compiled offline. NOT deployed: nothing here has been seen working in Azure. See
// docs/azure/pilot-plan.md for the architecture and the deployment procedure,
// docs/production/azure-preflight.md for the cost plan and the owner actions, and
// docs/production/release-process.md for releases and rollback.
targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------------------------
// Identity, model and sign-in
// ---------------------------------------------------------------------------------------------

@description('Short name used in resource names and tags: lower-case letters, digits and hyphens.')
@minLength(3)
@maxLength(20)
param environmentName string = 'swarm-pilot'

@description('Region of every resource created here. Defaults to the resource group region.')
param location string = resourceGroup().location

@description('Resource ID of the EXISTING Foundry / Azure OpenAI account the app calls: /subscriptions/<id>/resourceGroups/<group>/providers/Microsoft.CognitiveServices/accounts/<name>.')
@minLength(100)
param aiAccountResourceId string

@description('Name of the existing model deployment. The app sends it as the model id (AI_MODEL).')
param aiDeploymentName string = 'swarm-chat'

@description('Endpoint of that account (AZURE_OPENAI_ENDPOINT). Empty derives https://<account name>.openai.azure.com/, the convention of infra/modules/ai-services.bicep; set it when the account uses another custom sub-domain.')
param azureOpenAiEndpoint string = ''

@description('Application (client) ID of the Microsoft Entra Web app registration that people sign in with (AUTH_ENTRA_CLIENT_ID).')
@minLength(36)
@maxLength(36)
param authClientId string

@description('Audience that tokens must carry (AUTH_ENTRA_AUDIENCE): an application ID URI or a client ID. Empty uses the client ID.')
param authAudience string = ''

@description('Public HTTPS address of the source code of the exact version deployed (SOURCE_URL), which the AGPL licence requires users to be offered. Empty leaves the setting out.')
param sourceUrl string = ''

@description('Extra tags on every resource, for example an owner alias or a cost centre. Never put a person\'s name or address in a tag.')
param extraTags object = {}

@description('DEPLOYMENT_MODE of the app: pilot (a controlled pilot, the default) or production. The app refuses to start unless every hosted guard passes.')
@allowed(['pilot', 'production'])
param deploymentMode string = 'pilot'

@description('DEPLOYMENT_LABEL: what this deployment is, in words (at most 80 characters). Empty uses the default of the mode; production requires one.')
@maxLength(80)
param deploymentLabel string = ''

@description('BUILD_SHA of a template deployment: the commit the image was built from. A release sets it on the revision it creates. Empty keeps the BUILD_SHA of the app that runs now (when appExists), and leaves it out otherwise.')
@maxLength(40)
param buildSha string = ''

// ---------------------------------------------------------------------------------------------
// The container app and its releases
// ---------------------------------------------------------------------------------------------

@description('Image to run, as <registry>/swarm@sha256:<digest>. Empty means: keep the image the app runs now (appExists true), or start the public placeholder (appExists false). A real image is given port 3001, PORT=3001 and the three probes; the placeholder gets port 80, no PORT and no probe. The release tool normally changes the image, not this parameter.')
param containerImage string = ''

@description('REQUIRED, no default, on purpose. true: the container app already exists, so the image it runs now and its traffic are read from it and kept, and its port and probes follow from that image. false: it does not exist yet (the first deployment), so a public placeholder starts it. Answering false for an app that exists resets it to the placeholder on port 80 with no probes, and a template cannot tell the difference, so there is no default to fall back on. azd supplies it as SERVICE_SWARM_RESOURCE_EXISTS; main.bicepparam reads that variable and refuses to compile without it.')
param appExists bool

@description('vCPU of the one replica; memory is twice that.')
@allowed(['0.25', '0.5', '1', '2'])
param cpu string = '0.5'

@description('Replicas that always run: at least one. The job runner is embedded in the process, and a replica scaled to zero stops it.')
@minValue(1)
@maxValue(10)
param minReplicas int = 1

@description('Most replicas. Keep 1 until several instances against one database have been validated.')
@minValue(1)
@maxValue(10)
param maxReplicas int = 1

@description('Suffix of the revision this deployment creates (<app>--<suffix>), at most 20 characters: lower-case letters, digits and hyphens, starting with a letter. Empty lets the platform name it.')
@maxLength(20)
param revisionSuffix string = ''

@description('preserve (default): keep the live app\'s traffic, so re-applying never moves traffic or undoes a rollback. latest: the newest revision takes everything. split: newRevisionTrafficPercent to this deployment\'s revision, the rest to previousRevisionName.')
@allowed(['preserve', 'latest', 'split'])
param trafficMode string = 'preserve'

@description('The revision that served before this release. It stays active at the remaining weight, which is what makes rollback instant.')
param previousRevisionName string = ''

@description('Share of traffic for the new revision in split mode. 0 starts it dark.')
@minValue(0)
@maxValue(100)
param newRevisionTrafficPercent int = 100

@description('Deactivated revisions Azure keeps, so that one can be re-activated.')
@minValue(0)
@maxValue(100)
param maxInactiveRevisions int = 5

@description('Client address ranges (CIDR) allowed to reach the app. Empty allows every address; sign-in and the rate limiter guard it.')
param ingressAllowedCidrs array = []

@description('Most model calls one project may make in all, unless a workspace owner or administrator gives it a limit of its own (PROJECT_MODEL_CALL_LIMIT). 0 is no limit. A recorded demonstration scenario of three runs is about 200 calls.')
@minValue(0)
@maxValue(1000000000)
param projectModelCallLimit int = 1500

@description('Most tokens, input and output together, one project may use in all (PROJECT_MODEL_TOKEN_LIMIT). 0 is no limit. A recorded demonstration scenario of three runs is about 600,000 tokens. At the price of the existing deployment the default is a few US dollars at most per project.')
@minValue(0)
@maxValue(1000000000)
param projectModelTokenLimit int = 4000000

@description('The search that finds pages for a question that names none (RESEARCH_SEARCH_PROVIDER). none switches discovery off: such a question ends blocked and asks for a site. wikipedia needs no key and finds background pages. brave needs a key, which is a Key Vault secret named in keyVaultSecretReferences as RESEARCH_SEARCH_API_KEY, never a parameter. Either sends the names and topics of a question to a third party, so choosing one is the owner\'s decision.')
@allowed([
  'none'
  'wikipedia'
  'brave'
])
param researchSearchProvider string = 'none'

@description('What the Ask screen preselects for a new question (DEFAULT_ENGINE). rules keeps everything on the server; model asks the configured model, and a pilot meant to show the model sets it. Either is only a preselection: every person sees the choice and can change it, and a model that is not configured is never preselected.')
@allowed([
  'rules'
  'model'
])
param defaultEngine string = 'rules'

// ---------------------------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------------------------

@description('Compute SKU of a NEW server. Burstable B1ms is the cheapest sane choice for a pilot (about INR 2,100 a month with 32 GiB, at the list prices of 5 November 2026 in Central India), but a subscription can be refused it in a region (the deployment fails with SkuNotAvailable, and `list-skus` still shows it). The fallback that worked in Central India is databaseSkuName=Standard_D2ds_v4 with databaseSkuTier=GeneralPurpose, at about INR 17,800 a month, which is more than a Visual Studio credit of INR 11,000: stop the server when nobody uses it, or look for Burstable elsewhere (docs/azure/pilot-cost.md, "What exists now"). A server that exists keeps its SKU: both are ignored with existingPostgresServerResourceId.')
param databaseSkuName string = 'Standard_B1ms'

@description('Tier of the compute SKU above. It must match the SKU: Standard_B* is Burstable, Standard_D*ds_v4 and _v5 are GeneralPurpose. The CPU-credit alert exists only for Burstable.')
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

@description('Copy backups to the paired region. Chosen when the server is created and not changeable later.')
@allowed(['Enabled', 'Disabled'])
param databaseGeoRedundantBackup string = 'Disabled'

@description('ZoneRedundant keeps a synchronous standby in another zone and roughly doubles the compute and storage price. Not available on Burstable.')
@allowed(['Disabled', 'SameZone', 'ZoneRedundant'])
param databaseHighAvailability string = 'Disabled'

@allowed(['', '1', '2', '3'])
param databaseAvailabilityZone string = ''

@allowed(['', '1', '2', '3'])
param databaseStandbyAvailabilityZone string = ''

@description('Weekly maintenance window: day of week, 0 (Sunday) to 6.')
@allowed([0, 1, 2, 3, 4, 5, 6])
param databaseMaintenanceDayOfWeek int = 0

@description('Weekly maintenance window: start hour in UTC. 21 on Sunday is 02:30 Monday in India.')
@minValue(0)
@maxValue(23)
param databaseMaintenanceStartHourUtc int = 21

@description('The most connections the SKU allows (SHOW max_connections); the connection alert is a share of it. 50 is the documented value for B1ms and is UNVERIFIED on the live server.')
@minValue(1)
param databaseMaxConnections int = 50

@description('Optional Entra GROUP of people who may administer the database server (break glass). Empty adds none.')
param breakGlassAdminGroupObjectId string = ''

param breakGlassAdminGroupName string = ''

// ---------------------------------------------------------------------------------------------
// Registry, logs, Key Vault
// ---------------------------------------------------------------------------------------------

@allowed(['Basic', 'Standard', 'Premium'])
param registrySku string = 'Basic'

@description('Needs the Premium registry SKU.')
param registryZoneRedundant bool = false

@description('Days of Log Analytics retention. The first 31 days are included in the ingestion price.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

@description('Daily Log Analytics ingestion cap in GB, as text (for example 0.5). -1 removes the cap.')
param dailyLogCapGb string = '0.5'

@description('Creates (or, with existingKeyVaultResourceId, uses) a Key Vault. Off by default: the pilot has no secret, and a purge-protected vault cannot be deleted for softDeleteRetentionInDays, which makes teardown awkward.')
param enableKeyVault bool = false

@minValue(7)
@maxValue(90)
param keyVaultSoftDeleteRetentionInDays int = 90

@description('Settings whose value is a Key Vault secret, for example AUTH_ENTRA_CLIENT_SECRET. Naming one turns the vault on. The secret must exist before the app starts; no value is ever in a template.')
param keyVaultSecretReferences SecretReference[] = []

// ---------------------------------------------------------------------------------------------
// Networking (off by default, for cost)
// ---------------------------------------------------------------------------------------------

@description('Creates a virtual network, integrates the Container Apps environment with it and gives PostgreSQL private access (no public endpoint, no firewall rule). Costs nothing by itself, but see docs/production/azure-preflight.md for what it changes, and the limits of what it protects.')
param enablePrivateNetworking bool = false

@description('Adds a NAT gateway and a static public IP so that all outbound traffic leaves from one known address. Needs enablePrivateNetworking. It costs money by the hour. It does NOT restrict where the app may connect.')
param enableNatGateway bool = false

param vnetAddressPrefix string = '10.40.0.0/24'
param appSubnetPrefix string = '10.40.0.0/26'
param databaseSubnetPrefix string = '10.40.0.64/28'

@description('Spreads the Container Apps environment over availability zones. Needs enablePrivateNetworking.')
param containerAppsZoneRedundant bool = false

// ---------------------------------------------------------------------------------------------
// Existing resources: empty creates, a resource ID uses what is there
// ---------------------------------------------------------------------------------------------

@maxLength(400)
param existingWorkspaceResourceId string = ''

@maxLength(400)
param existingAppInsightsResourceId string = ''

@maxLength(400)
param existingRegistryResourceId string = ''

@maxLength(400)
param existingPostgresServerResourceId string = ''

@maxLength(400)
param existingKeyVaultResourceId string = ''

@maxLength(400)
param existingContainerAppsEnvironmentResourceId string = ''

// ---------------------------------------------------------------------------------------------
// Alerts and budget
// ---------------------------------------------------------------------------------------------

@description('Receives every alert. Read from the environment by the parameter file; never stored in the repository.')
@minLength(5)
param alertEmailAddress string

param additionalAlertEmailAddresses array = []

@description('True once the application emits the swarm.research.* signals named in docs/production/observability.md; until then the crawler alert is created disabled.')
param researchSignalsEmitted bool = false

@description('95th percentile request duration, in milliseconds, that raises the latency alert.')
@minValue(100)
param p95LatencyMs int = 1500

@description('Model tokens in an hour that raise the spend alert.')
@minValue(1)
param tokensPerHour int = 2000000

@description('Creates a monthly budget on this resource group. A budget alerts; it is not a cap.')
param enableBudget bool = true

@description('Monthly budget in the BILLING currency of the subscription (Azure has no currency property on a budget).')
@minValue(1)
param budgetAmount int = 4500

@description('What currency budgetAmount is meant in. Not sent to Azure; recorded in the notification names and outputs.')
@minLength(3)
@maxLength(3)
param budgetCurrencyLabel string = 'INR'

@description('Also notify the alert address for the budget; add more addresses here.')
param additionalBudgetEmailAddresses array = []

type SecretReference = {
  @description('The environment variable the application reads, for example AUTH_ENTRA_CLIENT_SECRET.')
  envName: string
  @description('Name of the secret in the Key Vault.')
  secretName: string
}

// ---------------------------------------------------------------------------------------------

// Reads a segment of a resource ID, and gives '' for a missing one, so that an unused (empty) ID can
// never fail the deployment: /subscriptions/<2>/resourceGroups/<4>/providers/<6>/<7>/<8>.
func idPart(resourceId string, index int) string => split('${resourceId}//////////', '/')[index]

var baseName = toLower(environmentName)
var uniqueSuffix = uniqueString(resourceGroup().id)
var appName = 'ca-${baseName}'

// Public placeholder that listens on port 80, so that the infrastructure can exist before the first real
// image is pushed. While it runs, the ingress targets port 80 and no probe is set (it has no health routes).
var bootstrapImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

// pieces of aiAccountResourceId: /subscriptions/<id>/resourceGroups/<group>/providers/<type>/accounts/<name>
var aiAccountParts = split(aiAccountResourceId, '/')
var aiAccountSubscriptionId = aiAccountParts[2]
var aiAccountResourceGroup = aiAccountParts[4]
var aiAccountName = aiAccountParts[8]

var useExistingWorkspace = !empty(existingWorkspaceResourceId)
var useExistingAppInsights = !empty(existingAppInsightsResourceId)
var useExistingRegistry = !empty(existingRegistryResourceId)
var useExistingPostgres = !empty(existingPostgresServerResourceId)
var useExistingKeyVault = !empty(existingKeyVaultResourceId)
var useExistingEnvironment = !empty(existingContainerAppsEnvironmentResourceId)
var keyVaultEnabled = enableKeyVault || useExistingKeyVault || !empty(keyVaultSecretReferences)

// Where each resource lives: the existing one, or a new one in this group. Always complete, so that a
// module never receives an empty scope.
var workspaceCoordinates = {
  name: useExistingWorkspace ? idPart(existingWorkspaceResourceId, 8) : 'log-${baseName}'
  subscriptionId: useExistingWorkspace ? idPart(existingWorkspaceResourceId, 2) : subscription().subscriptionId
  resourceGroup: useExistingWorkspace ? idPart(existingWorkspaceResourceId, 4) : resourceGroup().name
}
var appInsightsCoordinates = {
  name: useExistingAppInsights ? idPart(existingAppInsightsResourceId, 8) : 'appi-${baseName}'
  subscriptionId: useExistingAppInsights ? idPart(existingAppInsightsResourceId, 2) : subscription().subscriptionId
  resourceGroup: useExistingAppInsights ? idPart(existingAppInsightsResourceId, 4) : resourceGroup().name
}
var registryCoordinates = {
  name: useExistingRegistry ? idPart(existingRegistryResourceId, 8) : take('cr${replace(baseName, '-', '')}${uniqueSuffix}', 50)
  subscriptionId: useExistingRegistry ? idPart(existingRegistryResourceId, 2) : subscription().subscriptionId
  resourceGroup: useExistingRegistry ? idPart(existingRegistryResourceId, 4) : resourceGroup().name
}
var postgresCoordinates = {
  name: useExistingPostgres ? idPart(existingPostgresServerResourceId, 8) : 'psql-${baseName}-${uniqueSuffix}'
  subscriptionId: useExistingPostgres ? idPart(existingPostgresServerResourceId, 2) : subscription().subscriptionId
  resourceGroup: useExistingPostgres ? idPart(existingPostgresServerResourceId, 4) : resourceGroup().name
}
var keyVaultCoordinates = {
  name: useExistingKeyVault ? idPart(existingKeyVaultResourceId, 8) : 'kv${take(replace(baseName, '-', ''), 12)}${take(uniqueSuffix, 9)}'
  subscriptionId: useExistingKeyVault ? idPart(existingKeyVaultResourceId, 2) : subscription().subscriptionId
  resourceGroup: useExistingKeyVault ? idPart(existingKeyVaultResourceId, 4) : resourceGroup().name
}
var environmentCoordinates = {
  name: useExistingEnvironment ? idPart(existingContainerAppsEnvironmentResourceId, 8) : 'cae-${baseName}'
  subscriptionId: useExistingEnvironment ? idPart(existingContainerAppsEnvironmentResourceId, 2) : subscription().subscriptionId
  resourceGroup: useExistingEnvironment ? idPart(existingContainerAppsEnvironmentResourceId, 4) : resourceGroup().name
}

var tags = union(
  {
    app: 'swarm-lab'
    environment: baseName
    purpose: 'pilot'
    stage: 'production-candidate-controlled-pilot'
    managedBy: 'bicep'
    'azd-env-name': baseName
  },
  extraTags
)

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-${baseName}'
  location: location
  tags: tags
}

// Read here, outside the deployment that owns the app (a resource cannot reference itself), so that
// re-applying this template keeps the image that was deployed instead of resetting it to the placeholder,
// and keeps the traffic that was set (a rollback is a traffic change, which a re-apply must not undo).
resource existingApp 'Microsoft.App/containerApps@2025-07-01' existing = if (appExists) {
  name: appName
}
var image = !empty(containerImage)
  ? containerImage
  : (existingApp.?properties.template.containers[0].image ?? bootstrapImage)
var preservedTraffic = existingApp.?properties.configuration.ingress.traffic ?? []

// The commit the running image was built from. A release sets it on its revision with `az containerapp update`,
// so a re-apply that is not given a buildSha keeps the one that is there, and does not erase it.
var runningEnvironment = existingApp.?properties.template.containers[0].env ?? []
var runningBuildSha = join(
  map(filter(runningEnvironment, entry => entry.name == 'BUILD_SHA'), entry => entry.?value ?? ''),
  ''
)
var effectiveBuildSha = !empty(buildSha) ? buildSha : runningBuildSha

module network 'modules/network.bicep' = if (enablePrivateNetworking) {
  name: 'network'
  params: {
    baseName: baseName
    location: location
    tags: tags
    addressPrefix: vnetAddressPrefix
    appSubnetPrefix: appSubnetPrefix
    databaseSubnetPrefix: databaseSubnetPrefix
    enableNatGateway: enableNatGateway
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    workspaceName: workspaceCoordinates.name
    appInsightsName: appInsightsCoordinates.name
    location: location
    tags: tags
    createWorkspace: !useExistingWorkspace
    workspaceSubscriptionId: workspaceCoordinates.subscriptionId
    workspaceResourceGroup: workspaceCoordinates.resourceGroup
    createAppInsights: !useExistingAppInsights
    appInsightsSubscriptionId: appInsightsCoordinates.subscriptionId
    appInsightsResourceGroup: appInsightsCoordinates.resourceGroup
    retentionInDays: logRetentionDays
    dailyCapGb: dailyLogCapGb
  }
}

// In the component's own group, which is this one unless the component already exists elsewhere.
module appInsightsAccess 'modules/appinsights-access.bicep' = {
  name: 'appinsights-access'
  scope: resourceGroup(appInsightsCoordinates.subscriptionId, appInsightsCoordinates.resourceGroup)
  params: {
    appInsightsName: appInsightsCoordinates.name
    identityResourceId: identity.id
    principalId: identity.properties.principalId
  }
  dependsOn: [monitoring]
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  scope: resourceGroup(registryCoordinates.subscriptionId, registryCoordinates.resourceGroup)
  params: {
    registryName: registryCoordinates.name
    location: location
    tags: tags
    createRegistry: !useExistingRegistry
    sku: registrySku
    zoneRedundant: registryZoneRedundant
    identityResourceId: identity.id
    principalId: identity.properties.principalId
  }
}

module keyVault 'modules/key-vault.bicep' = if (keyVaultEnabled) {
  name: 'key-vault'
  scope: resourceGroup(keyVaultCoordinates.subscriptionId, keyVaultCoordinates.resourceGroup)
  params: {
    vaultName: keyVaultCoordinates.name
    location: location
    tags: tags
    useExistingVault: useExistingKeyVault
    softDeleteRetentionInDays: keyVaultSoftDeleteRetentionInDays
    identityResourceId: identity.id
    principalId: identity.properties.principalId
    auditWorkspaceResourceId: monitoring.outputs.workspaceId
  }
}

module database 'modules/postgres.bicep' = {
  name: 'database'
  scope: resourceGroup(postgresCoordinates.subscriptionId, postgresCoordinates.resourceGroup)
  params: {
    serverName: postgresCoordinates.name
    location: location
    tags: tags
    useExistingServer: useExistingPostgres
    skuName: databaseSkuName
    skuTier: databaseSkuTier
    storageSizeGB: databaseStorageGb
    storageAutoGrow: databaseStorageAutoGrow
    backupRetentionDays: backupRetentionDays
    geoRedundantBackup: databaseGeoRedundantBackup
    highAvailabilityMode: databaseHighAvailability
    availabilityZone: databaseAvailabilityZone
    standbyAvailabilityZone: databaseStandbyAvailabilityZone
    maintenanceDayOfWeek: databaseMaintenanceDayOfWeek
    maintenanceStartHourUtc: databaseMaintenanceStartHourUtc
    delegatedSubnetResourceId: network.?outputs.databaseSubnetId ?? ''
    privateDnsZoneResourceId: network.?outputs.databasePrivateDnsZoneId ?? ''
    administratorObjectId: identity.properties.principalId
    administratorName: identity.name
    breakGlassAdminGroupObjectId: breakGlassAdminGroupObjectId
    breakGlassAdminGroupName: breakGlassAdminGroupName
  }
}

// The only change to the model account: one role assignment, scoped to the account itself.
module aiAccess 'modules/ai-access.bicep' = {
  name: 'ai-access-${uniqueSuffix}'
  scope: resourceGroup(aiAccountSubscriptionId, aiAccountResourceGroup)
  params: {
    accountName: aiAccountName
    identityResourceId: identity.id
    principalId: identity.properties.principalId
  }
}

// The app starts using the identity as soon as it runs, so it waits for every role assignment above.
module app 'modules/container-app.bicep' = {
  name: 'app'
  params: {
    environmentResourceName: environmentCoordinates.name
    appName: appName
    location: location
    tags: tags
    createEnvironment: !useExistingEnvironment
    environmentSubscriptionId: environmentCoordinates.subscriptionId
    environmentResourceGroup: environmentCoordinates.resourceGroup
    workspaceName: workspaceCoordinates.name
    workspaceSubscriptionId: workspaceCoordinates.subscriptionId
    workspaceResourceGroup: workspaceCoordinates.resourceGroup
    infrastructureSubnetId: network.?outputs.appSubnetId ?? ''
    zoneRedundant: containerAppsZoneRedundant
    identityResourceId: identity.id
    identityClientId: identity.properties.clientId
    identityName: identity.name
    registryLoginServer: registry.outputs.loginServer
    image: image
    placeholderImage: image == bootstrapImage
    cpu: cpu
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    databaseHost: database.outputs.fullyQualifiedDomainName
    databaseName: database.outputs.databaseName
    authClientId: authClientId
    authAudience: empty(authAudience) ? authClientId : authAudience
    aiDeploymentName: aiDeploymentName
    azureOpenAiEndpoint: empty(azureOpenAiEndpoint) ? 'https://${aiAccountName}.openai.azure.com/' : azureOpenAiEndpoint
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    sourceUrl: sourceUrl
    projectModelCallLimit: projectModelCallLimit
    projectModelTokenLimit: projectModelTokenLimit
    researchSearchProvider: researchSearchProvider
    defaultEngine: defaultEngine
    deploymentMode: deploymentMode
    deploymentLabel: deploymentLabel
    buildSha: effectiveBuildSha
    revisionSuffix: revisionSuffix
    trafficMode: trafficMode
    preservedTraffic: preservedTraffic
    previousRevisionName: previousRevisionName
    newRevisionTrafficPercent: newRevisionTrafficPercent
    maxInactiveRevisions: maxInactiveRevisions
    keyVaultUri: keyVault.?outputs.vaultUri ?? ''
    keyVaultSecretReferences: keyVaultSecretReferences
    ingressAllowedCidrs: ingressAllowedCidrs
  }
  dependsOn: [aiAccess, appInsightsAccess]
}

module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    baseName: baseName
    tags: tags
    location: location
    containerAppResourceId: app.outputs.id
    containerAppName: app.outputs.name
    databaseServerResourceId: database.outputs.serverResourceId
    appInsightsResourceId: monitoring.outputs.appInsightsId
    workspaceResourceId: monitoring.outputs.workspaceId
    alertEmailAddress: alertEmailAddress
    additionalAlertEmailAddresses: additionalAlertEmailAddresses
    researchSignalsEmitted: researchSignalsEmitted
    databaseIsBurstable: databaseSkuTier == 'Burstable'
    databaseMaxConnections: databaseMaxConnections
    p95LatencyMs: p95LatencyMs
    tokensPerHour: tokensPerHour
  }
}

module budget 'modules/budget.bicep' = if (enableBudget) {
  name: 'budget'
  params: {
    baseName: baseName
    amount: budgetAmount
    currencyLabel: budgetCurrencyLabel
    contactEmails: concat([alertEmailAddress], additionalBudgetEmailAddresses)
  }
}

// Names that azd reads (AZURE_CONTAINER_REGISTRY_ENDPOINT is required by `azd deploy`) and values the
// Microsoft Entra steps in docs/azure/pilot-plan.md and the release tooling need. None of them is a secret.
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup().name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.name
output AZURE_CONTAINER_APP_NAME string = app.outputs.name
output AZURE_CONTAINER_APP_FQDN string = app.outputs.fqdn
output AZURE_CONTAINER_APP_LATEST_REVISION string = app.outputs.latestRevisionName
output ENTRA_REDIRECT_URI string = 'https://${app.outputs.fqdn}/auth/callback'
output AZURE_USER_ASSIGNED_IDENTITY_NAME string = identity.name
output AZURE_USER_ASSIGNED_IDENTITY_CLIENT_ID string = identity.properties.clientId
output AZURE_USER_ASSIGNED_IDENTITY_PRINCIPAL_ID string = identity.properties.principalId
output AZURE_POSTGRES_SERVER_NAME string = database.outputs.serverName
output AZURE_POSTGRES_DATABASE string = database.outputs.databaseName
output AZURE_KEY_VAULT_NAME string = keyVault.?outputs.vaultName ?? ''
output AZURE_ACTION_GROUP_NAME string = alerts.outputs.actionGroupName
output AZURE_EGRESS_IP_ADDRESS string = network.?outputs.egressIpAddress ?? ''
output AZURE_BUDGET_NAME string = budget.?outputs.budgetName ?? ''
