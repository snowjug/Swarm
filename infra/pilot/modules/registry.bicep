// Azure Container Registry holding the application image. The admin user is off and anonymous pull is
// off (its default), so the only way to pull is the application identity's AcrPull role, scoped to this
// registry. Basic is the pilot; Premium adds zone redundancy and is what private networking would need
// (this template does not add a private endpoint; docs/production/LIMITATIONS.md says so).
//
// createRegistry = false uses a registry that already exists: this module is then deployed into ITS
// resource group and only grants the pull role. The registry is not changed.
targetScope = 'resourceGroup'

@description('Globally unique registry name: 5-50 lower-case letters and digits.')
@minLength(5)
@maxLength(50)
param registryName string

param location string
param tags object

@description('False: the registry already exists in this resource group, and only the AcrPull assignment is made.')
param createRegistry bool = true

@allowed(['Basic', 'Standard', 'Premium'])
param sku string = 'Basic'

@description('Zone redundancy needs the Premium SKU and a region with availability zones.')
param zoneRedundant bool = false

@description('Resource ID of the identity that pulls the image. It seeds the role assignment name, which therefore does not depend on a value known only after the identity exists.')
param identityResourceId string

@description('Entra object ID of that identity.')
param principalId string

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource created 'Microsoft.ContainerRegistry/registries@2025-04-01' = if (createRegistry) {
  name: registryName
  location: location
  tags: tags
  sku: { name: sku }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    zoneRedundancy: zoneRedundant ? 'Enabled' : 'Disabled'
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: registryName
}

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identityResourceId, acrPullRoleId)
  scope: registry
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
  dependsOn: [created]
}

output name string = registry.name
output loginServer string = registry.properties.loginServer
