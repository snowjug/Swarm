// Swarm Lab Azure AI foundation: resource group + Entra-only model account + one deployment.
// No keys, secrets or connection strings are created or output.
targetScope = 'subscription'

@description('Short environment name such as swarm-dev. Used in names and tags.')
@minLength(3)
@maxLength(20)
param environmentName string

@description('Region of the resource group and the AI account.')
param location string

@description('Resource group to create.')
param resourceGroupName string = 'rg-${environmentName}'

@allowed(['AIServices', 'OpenAI'])
param accountKind string = 'AIServices'

param deploymentName string = 'swarm-chat'
param modelName string
param modelVersion string

@allowed(['Standard', 'GlobalStandard', 'DataZoneStandard'])
param deploymentSku string

@minValue(1)
@maxValue(100)
param deploymentCapacity int = 50

@description('Principals that receive the Cognitive Services OpenAI User role on the account.')
param inferenceUsers array = []

param tags object = {}

var allTags = union(
  {
    app: 'swarm-lab'
    environment: environmentName
    purpose: 'dev-synthetic-data-only'
    managedBy: 'bicep'
  },
  tags
)

var accountName = take('ai-${environmentName}-${uniqueString(subscription().id, environmentName, location)}', 64)

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: allTags
}

module ai 'modules/ai-services.bicep' = {
  name: 'ai-services-${uniqueString(group.id)}'
  scope: group
  params: {
    accountName: accountName
    location: location
    accountKind: accountKind
    deploymentName: deploymentName
    modelName: modelName
    modelVersion: modelVersion
    deploymentSku: deploymentSku
    deploymentCapacity: deploymentCapacity
    inferenceUsers: inferenceUsers
    tags: allTags
  }
}

output AZURE_RESOURCE_GROUP string = group.name
output AZURE_LOCATION string = location
output AZURE_AI_ACCOUNT_NAME string = ai.outputs.accountName
output AZURE_OPENAI_ENDPOINT string = ai.outputs.openAiEndpoint
output AZURE_OPENAI_DEPLOYMENT string = ai.outputs.deploymentName
output AZURE_OPENAI_MODEL string = modelName
output AZURE_OPENAI_MODEL_VERSION string = modelVersion
