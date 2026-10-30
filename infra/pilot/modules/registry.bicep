// Azure Container Registry (Basic) holding the application image. The admin user is off and anonymous
// pull is off (its default), so the only way to pull is the application identity's AcrPull role, scoped
// to this registry.
targetScope = 'resourceGroup'

@description('Globally unique registry name: 5-50 lower-case letters and digits.')
@minLength(5)
@maxLength(50)
param registryName string

param location string
param tags object

@description('Resource ID of the identity that pulls the image. It seeds the role assignment name, which therefore does not depend on a value known only after the identity exists.')
param identityResourceId string

@description('Entra object ID of that identity.')
param principalId string

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: registryName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identityResourceId, acrPullRoleId)
  scope: registry
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

output name string = registry.name
output loginServer string = registry.properties.loginServer
