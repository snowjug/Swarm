// Gives the application identity the Cognitive Services OpenAI User role on ONE existing account.
// The account is only the scope of the role assignment: it is never created, changed or deleted
// here, and its model deployments and quota are untouched. Deployed into the account's resource group.
targetScope = 'resourceGroup'

@description('Name of the existing Foundry / Azure OpenAI account in this resource group.')
param accountName string

@description('Resource ID of the application identity. It seeds the role assignment name, which therefore does not depend on a value known only after the identity exists.')
param identityResourceId string

@description('Entra object ID of the application identity.')
param principalId string

var cognitiveServicesOpenAIUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}

resource inferenceAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, identityResourceId, cognitiveServicesOpenAIUserRoleId)
  scope: account
  properties: {
    principalId: principalId
    // Declaring the type avoids waiting for a just-created identity to replicate through Microsoft Graph.
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesOpenAIUserRoleId
    )
  }
}
