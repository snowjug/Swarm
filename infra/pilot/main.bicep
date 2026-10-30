// Swarm hosted pilot at resource-group scope: one container app, one PostgreSQL database, and what they need.
//
// - Every credential is a Microsoft Entra token of ONE user-assigned managed identity. There are no
//   keys, passwords, connection strings with secrets, or Key Vault in this template.
// - The existing Foundry / Azure OpenAI account is only referenced: it gets one role assignment for the
//   identity, and nothing about it (resource, deployments, quota) is created, changed or deleted.
// - Deploy into a NEW resource group dedicated to the pilot; deleting that group removes everything
//   created here and nothing else.
//
// See docs/azure/pilot-plan.md for the architecture, the role matrix and the deployment procedure,
// and docs/azure/pilot-cost.md for what it costs.
targetScope = 'resourceGroup'

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

@description('Image to run. Empty keeps the image that already runs (when appExists) or starts a public placeholder until the first image is pushed.')
param containerImage string = ''

@description('True when the container app already exists, so that re-applying the template keeps its image. azd supplies it.')
param appExists bool = false

@description('vCPU of the one replica; memory is twice that.')
@allowed(['0.25', '0.5', '1', '2'])
param cpu string = '0.5'

@description('Replicas that always run. Zero stops the app, and its embedded job runner, when idle.')
@minValue(0)
@maxValue(10)
param minReplicas int = 1

@description('Most replicas. Keep 1 until several instances against one database have been validated.')
@minValue(1)
@maxValue(10)
param maxReplicas int = 1

@description('Days of PostgreSQL backups, which bound a point-in-time restore.')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Days of Log Analytics retention.')
@minValue(30)
@maxValue(90)
param logRetentionDays int = 30

@description('Daily Log Analytics ingestion cap in GB, as text (for example 0.5). -1 removes the cap.')
param dailyLogCapGb string = '0.5'

var baseName = toLower(environmentName)
var uniqueSuffix = uniqueString(resourceGroup().id)
var workspaceName = 'log-${baseName}'
var appName = 'ca-${baseName}'

// Public placeholder that listens on port 80, so the revision it creates is not healthy (the app
// expects 3001) until the first real image is deployed. It lets the infrastructure exist first.
var bootstrapImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

// pieces of aiAccountResourceId: /subscriptions/<id>/resourceGroups/<group>/providers/<type>/accounts/<name>
var aiAccountParts = split(aiAccountResourceId, '/')
var aiAccountSubscriptionId = aiAccountParts[2]
var aiAccountResourceGroup = aiAccountParts[4]
var aiAccountName = aiAccountParts[8]

var tags = {
  app: 'swarm-lab'
  environment: baseName
  purpose: 'pilot'
  managedBy: 'bicep'
  'azd-env-name': baseName
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-${baseName}'
  location: location
  tags: tags
}

// Read here, outside the deployment that owns the app (a resource cannot reference itself), so that
// re-applying this template keeps the image that was deployed instead of resetting it to the placeholder.
resource existingApp 'Microsoft.App/containerApps@2025-07-01' existing = if (appExists) {
  name: appName
}
var image = !empty(containerImage)
  ? containerImage
  : (existingApp.?properties.template.containers[0].image ?? bootstrapImage)

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    workspaceName: workspaceName
    appInsightsName: 'appi-${baseName}'
    location: location
    tags: tags
    retentionInDays: logRetentionDays
    dailyCapGb: dailyLogCapGb
    identityResourceId: identity.id
    principalId: identity.properties.principalId
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    registryName: take('cr${replace(baseName, '-', '')}${uniqueSuffix}', 50)
    location: location
    tags: tags
    identityResourceId: identity.id
    principalId: identity.properties.principalId
  }
}

module database 'modules/postgres.bicep' = {
  name: 'database'
  params: {
    serverName: 'psql-${baseName}-${uniqueSuffix}'
    location: location
    tags: tags
    backupRetentionDays: backupRetentionDays
    administratorObjectId: identity.properties.principalId
    administratorName: identity.name
  }
}

// The only change outside this resource group: one role assignment, scoped to the account itself.
module aiAccess 'modules/ai-access.bicep' = {
  name: 'ai-access-${uniqueSuffix}'
  scope: resourceGroup(aiAccountSubscriptionId, aiAccountResourceGroup)
  params: {
    accountName: aiAccountName
    identityResourceId: identity.id
    principalId: identity.properties.principalId
  }
}

// The app starts using the identity as soon as it runs, so it waits for every role assignment above:
// the registry, monitoring and database modules each contain theirs and are waited for through their outputs.
module app 'modules/container-app.bicep' = {
  name: 'app'
  params: {
    environmentResourceName: 'cae-${baseName}'
    appName: appName
    location: location
    tags: tags
    workspaceName: workspaceName
    identityResourceId: identity.id
    identityClientId: identity.properties.clientId
    identityName: identity.name
    registryLoginServer: registry.outputs.loginServer
    image: image
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
  }
  dependsOn: [aiAccess]
}

// Names that azd reads (AZURE_CONTAINER_REGISTRY_ENDPOINT is required by `azd deploy`) and values the
// Microsoft Entra steps in docs/azure/pilot-plan.md need. None of them is a secret.
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup().name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.name
output AZURE_CONTAINER_APP_NAME string = app.outputs.name
output AZURE_CONTAINER_APP_FQDN string = app.outputs.fqdn
output ENTRA_REDIRECT_URI string = 'https://${app.outputs.fqdn}/auth/callback'
output AZURE_USER_ASSIGNED_IDENTITY_NAME string = identity.name
output AZURE_USER_ASSIGNED_IDENTITY_CLIENT_ID string = identity.properties.clientId
output AZURE_USER_ASSIGNED_IDENTITY_PRINCIPAL_ID string = identity.properties.principalId
output AZURE_POSTGRES_SERVER_NAME string = database.outputs.serverName
output AZURE_POSTGRES_DATABASE string = database.outputs.databaseName
