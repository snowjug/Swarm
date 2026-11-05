// The shape infra/pilot/modules/container-app.bicep had when the first deployment of the pilot failed:
//
//   Microsoft.App/managedEnvironments/cae-swarm-pilot is defined multiple times
//
// A "create it" declaration and an `existing` declaration of the SAME environment in one template.
// `bicep build` and `bicep lint` accept it; Azure Resource Manager does not. It is kept here, outside
// every real template, so that scripts/iac/duplicates.test.ts can show that the offline check still
// catches it. Do not fix it and do not deploy it.
//
// The user-defined type is there on purpose: it makes Bicep compile with symbolic resource names
// (languageVersion 2.0), as container-app.bicep did, and only then does the template carry the `existing`
// declaration that Azure counts. Without it the read compiles to a reference() expression and is not a
// declaration at all.
targetScope = 'resourceGroup'

type SecretReference = {
  envName: string
  secretName: string
}

param keyVaultSecretReferences SecretReference[] = []

param environmentResourceName string
param createEnvironment bool = true
param location string = resourceGroup().location
param environmentSubscriptionId string = subscription().subscriptionId
param environmentResourceGroup string = resourceGroup().name

resource createdEnvironment 'Microsoft.App/managedEnvironments@2025-07-01' = if (createEnvironment) {
  name: environmentResourceName
  location: location
  properties: {}
}

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' existing = {
  name: environmentResourceName
  scope: resourceGroup(environmentSubscriptionId, environmentResourceGroup)
}

output defaultDomain string = environment.properties.defaultDomain
output secretCount int = length(keyVaultSecretReferences)
