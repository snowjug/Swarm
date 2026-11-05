// Reads a Container Apps environment that already exists, so that the app can be placed in it. Nothing is
// created or changed. It is the sibling of environment-new.bicep, and the two are separate modules because
// a template must not name the same resource twice (see the header of environment-new.bicep).
//
// The caller sets this module's scope to the environment's own subscription and resource group, so the
// environment may live outside the pilot group. It must be a workload-profiles environment with the
// Consumption profile, which is what the app asks for.
targetScope = 'resourceGroup'

param environmentName string

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' existing = {
  name: environmentName
}

output id string = environment.id
output name string = environment.name
output defaultDomain string = environment.properties.defaultDomain
