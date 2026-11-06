// READS the model deployment that the free tier calls. It creates, changes and deletes nothing: both resources
// below are `existing`. It is deployed into the group of the Azure OpenAI / Foundry account (which may be another
// resource group, or another subscription), and exists for two reasons:
//
//  - a name that does not exist fails the deployment here, before anything is created, instead of leaving an app
//    that answers MODEL_NOT_FOUND to everyone;
//  - the model behind the deployment is read, so that guards.bicep can refuse a reasoning model (o1 to o9,
//    gpt-5) whatever the deployment is called. Hidden reasoning tokens would eat the free tier's caps.
//
// Reading the deployment needs Reader on the account, which the person who deploys has anyway: they must be able to
// write the one role assignment that ai-access.bicep makes on the same account.
targetScope = 'resourceGroup'

@description('Name of the existing Azure OpenAI / Foundry account in this resource group.')
param accountName string

@description('Name of the existing model deployment of that account.')
param deploymentName string

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}

resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' existing = {
  parent: account
  name: deploymentName
}

@description('The model behind the deployment, for example gpt-4.1-mini. Not a secret.')
output modelName string = modelDeployment.properties.model.name
