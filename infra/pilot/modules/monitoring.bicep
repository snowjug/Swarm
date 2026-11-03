// Log Analytics workspace and a workspace-based Application Insights component.
// Application Insights accepts telemetry only from callers that authenticate with Microsoft Entra
// (local auth is disabled), so its connection string is not a credential.
//
// Either part can already exist (createWorkspace / createAppInsights = false): it is then only read,
// from the resource group named by its coordinates. Nothing about an existing workspace or component
// (retention, cap, sampling) is changed here. The role that lets the application identity publish to
// the component is assigned by appinsights-access.bicep, in the component's own resource group.
targetScope = 'resourceGroup'

param workspaceName string
param appInsightsName string
param location string
param tags object

@description('False: the workspace already exists (see workspaceSubscriptionId and workspaceResourceGroup) and is only read.')
param createWorkspace bool = true

param workspaceSubscriptionId string = subscription().subscriptionId
param workspaceResourceGroup string = resourceGroup().name

@description('False: the Application Insights component already exists (see appInsightsSubscriptionId and appInsightsResourceGroup) and is only read.')
param createAppInsights bool = true

param appInsightsSubscriptionId string = subscription().subscriptionId
param appInsightsResourceGroup string = resourceGroup().name

@description('Days of log retention. The first 31 days are included in the ingestion price.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

@description('Daily ingestion cap in GB, written as text because Bicep has no decimal literals (for example 0.5). -1 removes the cap. When the cap is reached collection stops until the next day, which trades visibility for a spend ceiling.')
param dailyCapGb string = '0.5'

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = if (createWorkspace) {
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

resource workspaceRef 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: workspaceName
  scope: resourceGroup(workspaceSubscriptionId, workspaceResourceGroup)
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = if (createAppInsights) {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspaceRef.id
    IngestionMode: 'LogAnalytics'
    DisableLocalAuth: true
  }
  dependsOn: [workspace]
}

resource appInsightsRef 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
  scope: resourceGroup(appInsightsSubscriptionId, appInsightsResourceGroup)
}

output workspaceId string = workspaceRef.id
output appInsightsId string = appInsightsRef.id
output appInsightsConnectionString string = appInsightsRef.properties.ConnectionString
