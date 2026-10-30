// Log Analytics workspace and a workspace-based Application Insights component.
// Application Insights accepts telemetry only from callers that authenticate with Microsoft Entra
// (local auth is disabled), so its connection string is not a credential.
targetScope = 'resourceGroup'

param workspaceName string
param appInsightsName string
param location string
param tags object

@description('Days of log retention. The first 31 days are included in the ingestion price.')
@minValue(30)
@maxValue(90)
param retentionInDays int = 30

@description('Daily ingestion cap in GB, written as text because Bicep has no decimal literals (for example 0.5). -1 removes the cap. When the cap is reached collection stops until the next day, which trades visibility for a spend ceiling.')
param dailyCapGb string = '0.5'

@description('Resource ID of the identity that sends telemetry. It seeds the role assignment name, which therefore does not depend on a value known only after the identity exists.')
param identityResourceId string

@description('Entra object ID of that identity.')
param principalId string

var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionInDays
    workspaceCapping: { dailyQuotaGb: json(dailyCapGb) }
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    DisableLocalAuth: true
  }
}

resource publish 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, identityResourceId, monitoringMetricsPublisherRoleId)
  scope: appInsights
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      monitoringMetricsPublisherRoleId
    )
  }
}

output appInsightsConnectionString string = appInsights.properties.ConnectionString
