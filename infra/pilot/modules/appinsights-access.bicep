// Lets the application identity publish telemetry to ONE Application Insights component: the role
// Monitoring Metrics Publisher, scoped to that component. The component may have been created by this
// deployment or may already exist; this module is deployed into the component's resource group and
// changes nothing but that one role assignment.
targetScope = 'resourceGroup'

@description('Name of the Application Insights component in this resource group.')
param appInsightsName string

@description('Resource ID of the identity that sends telemetry. It seeds the role assignment name, which therefore does not depend on a value known only after the identity exists.')
param identityResourceId string

@description('Entra object ID of that identity.')
param principalId string

var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource publish 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, identityResourceId, monitoringMetricsPublisherRoleId)
  scope: appInsights
  properties: {
    principalId: principalId
    // Declaring the type avoids waiting for a just-created identity to replicate through Microsoft Graph.
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      monitoringMetricsPublisherRoleId
    )
  }
}
