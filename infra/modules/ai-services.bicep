// Microsoft Foundry (AIServices) account with one chat-model deployment, Entra-only auth.
// Deployable on its own at resource-group scope, or through ../main.bicep.
targetScope = 'resourceGroup'

type InferenceUser = {
  @description('Entra object id of the user, group or service principal.')
  principalId: string
  principalType: 'User' | 'Group' | 'ServicePrincipal'
}

@description('Account name. Also the custom sub-domain, which Entra authentication requires.')
@minLength(2)
@maxLength(64)
param accountName string

@description('Region of the account. It may differ from the resource group region.')
param location string = resourceGroup().location

@description('AIServices is the Microsoft Foundry resource. OpenAI is the Azure OpenAI-only resource.')
@allowed(['AIServices', 'OpenAI'])
param accountKind string = 'AIServices'

@description('Deployment name. The application sends it as the model id (AI_MODEL).')
param deploymentName string = 'swarm-chat'

param modelName string
param modelVersion string

@description('Pay-as-you-go SKUs only. Provisioned (reserved, hourly-billed) capacity is deliberately excluded.')
@allowed(['Standard', 'GlobalStandard', 'DataZoneStandard'])
param deploymentSku string

@description('Capacity in thousands of tokens per minute. Capped to keep a mistake cheap.')
@minValue(1)
@maxValue(100)
param deploymentCapacity int = 50

@description('Principals that may call the model with Entra ID (Cognitive Services OpenAI User).')
param inferenceUsers InferenceUser[] = []

param tags object = {}

var cognitiveServicesOpenAIUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: accountName
  location: location
  kind: accountKind
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: accountName
    // Keys are disabled: every caller must authenticate with Microsoft Entra ID.
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    networkAcls: { defaultAction: 'Allow' }
  }
  tags: tags
}

// raiPolicyName is intentionally omitted so the service's default content filtering stays on.
resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: deploymentName
  sku: {
    name: deploymentSku
    capacity: deploymentCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    // Pinned so evaluations stay reproducible. Watch the model's retirement date.
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource inferenceAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for user in inferenceUsers: {
    name: guid(account.id, user.principalId, cognitiveServicesOpenAIUserRoleId)
    scope: account
    properties: {
      principalId: user.principalId
      principalType: user.principalType
      roleDefinitionId: subscriptionResourceId(
        'Microsoft.Authorization/roleDefinitions',
        cognitiveServicesOpenAIUserRoleId
      )
    }
  }
]

output accountName string = account.name
output deploymentName string = deployment.name
@description('Azure OpenAI v1 base host (public cloud). No key or token is ever output.')
output openAiEndpoint string = 'https://${account.name}.openai.azure.com/'
