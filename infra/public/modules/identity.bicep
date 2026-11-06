// The ONE credential holder of the public edition: a user-assigned managed identity. The database, the model,
// the registry, Key Vault and telemetry all accept a Microsoft Entra token of this identity, so no key, password
// or connection string with a secret exists anywhere in this deployment. It is declared in a module because
// main.bicep deploys at subscription scope, where a resource group's resources cannot be declared directly.
targetScope = 'resourceGroup'

param identityName string
param location string
param tags object

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: identityName
  location: location
  tags: tags
}

output id string = identity.id
output name string = identity.name
output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
