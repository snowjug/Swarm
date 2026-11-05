// Creates the Container Apps environment (Consumption profile only). It declares exactly one resource, and
// its sibling environment-existing.bicep declares the same one as `existing`: the two are separate modules
// because Azure Resource Manager rejects a template that names the same resource twice, even when one of the
// two is a read ("The resource Microsoft.App/managedEnvironments/<name> is defined multiple times").
// container-app.bicep deploys one of them, never both. `npm run iac:validate` fails on any template that
// declares one type and name twice (scripts/iac/duplicates.mjs).
targetScope = 'resourceGroup'

param environmentName string
param location string
param tags object

@description('Log Analytics workspace that receives the console and system logs of the environment.')
param workspaceName string

param workspaceSubscriptionId string = subscription().subscriptionId
param workspaceResourceGroup string = resourceGroup().name

@description('Subnet for virtual network integration (network.bicep). Empty: no virtual network.')
param infrastructureSubnetId string = ''

@description('Spreads the environment over availability zones. Needs the virtual network above and a region with zones; it costs nothing extra by itself.')
param zoneRedundant bool = false

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: workspaceName
  scope: resourceGroup(workspaceSubscriptionId, workspaceResourceGroup)
}

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        // Read by Azure Resource Manager while deploying; it is never written to a file or an output.
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    // Only the pay-per-use Consumption profile: no dedicated profile, no private endpoint and no
    // planned maintenance, which are the features that add an hourly management charge.
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    vnetConfiguration: empty(infrastructureSubnetId)
      ? null
      : {
          infrastructureSubnetId: infrastructureSubnetId
          internal: false
        }
    zoneRedundant: zoneRedundant
  }
}

output id string = environment.id
output name string = environment.name
output defaultDomain string = environment.properties.defaultDomain
