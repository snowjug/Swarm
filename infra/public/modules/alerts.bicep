// A small set of Azure Monitor METRIC alert rules for the public edition and the e-mail action group they use. They read
// the platform's own metrics (Container Apps, PostgreSQL), so they still fire when the application is down or its
// telemetry is broken. It is the pilot's idea (infra/pilot/modules/alerts.bicep: nine metric and nine log rules) cut down
// to what a public service needs first; the log rules read signals that the pilot's application emits, and are not copied.
//
// This is NOT the budget path: these rules e-mail the owner and nothing else. The action group that switches the free
// tier off is a different one (action-groups.bicep), so that a burst of errors can never disable the free tier by itself.
//
// None of these rules has fired in Azure, and the thresholds are first proposals to tune on real traffic.
targetScope = 'resourceGroup'

param baseName string
param tags object

@description('Resource ID of the container app (Microsoft.App/containerApps).')
param containerAppResourceId string

@description('Resource ID of the PostgreSQL flexible server.')
param databaseServerResourceId string

@description('Who is e-mailed. At least one address.')
@minLength(1)
param emailAddresses array

@description('True when the app always runs (minReplicas 1): then no replica for five minutes is an outage. With minReplicas 0 it is normal, so the rule is not created.')
param alertOnNoReplicas bool

@description('Platform requests answered with a 5xx status in five minutes.')
@minValue(1)
param http5xxPer5Minutes int = 10

@description('Container restarts in fifteen minutes (a failed probe, an out-of-memory kill, a crash loop, or a start-up self-check that refuses to run).')
@minValue(1)
param restartsPer15Minutes int = 3

@description('Average database CPU, in percent, over fifteen minutes. A Burstable server that stays above it runs out of CPU credits.')
@minValue(1)
@maxValue(100)
param databaseCpuPercent int = 80

@description('Database storage used, in percent. With auto-grow on the disk grows (and costs more) instead of filling.')
@minValue(1)
@maxValue(99)
param databaseStoragePercent int = 80

var emailReceivers = [
  for (address, index) in emailAddresses: {
    name: 'owner-${index}'
    emailAddress: address
    useCommonAlertSchema: true
  }
]

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${baseName}-ops'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: '${take(replace(baseName, '-', ''), 9)}ops'
    enabled: true
    emailReceivers: emailReceivers
  }
}

var noReplicasRule = alertOnNoReplicas
  ? [
      {
        name: 'app-no-replicas'
        description: 'No replica of the container app ran for five minutes: it crashes at start, was scaled to zero, or its revision failed. People cannot use the site and a queued run waits.'
        severity: 1
        resourceId: containerAppResourceId
        namespace: 'Microsoft.App/containerApps'
        metric: 'Replicas'
        operator: 'LessThan'
        threshold: 1
        aggregation: 'Maximum'
        frequency: 'PT1M'
        window: 'PT5M'
      }
    ]
  : []

var metricRules = concat(noReplicasRule, [
  {
    name: 'http-5xx'
    description: 'Server errors (5xx) answered by the ingress. Counted by the platform, so it also fires when the application emits no telemetry.'
    severity: 2
    resourceId: containerAppResourceId
    namespace: 'Microsoft.App/containerApps'
    metric: 'Requests'
    operator: 'GreaterThan'
    threshold: http5xxPer5Minutes
    aggregation: 'Total'
    frequency: 'PT1M'
    window: 'PT5M'
    dimensions: [
      {
        name: 'statusCodeCategory'
        operator: 'Include'
        values: ['5xx']
      }
    ]
  }
  {
    name: 'app-restarts'
    description: 'The container restarted repeatedly. The start-up self-check REFUSES TO START the application when row-level security is not in force, which shows here as a crash loop: read the console log.'
    severity: 2
    resourceId: containerAppResourceId
    namespace: 'Microsoft.App/containerApps'
    metric: 'RestartCount'
    operator: 'GreaterThan'
    threshold: restartsPer15Minutes
    aggregation: 'Total'
    frequency: 'PT5M'
    window: 'PT15M'
  }
  {
    name: 'db-not-alive'
    description: 'The platform reports the database server as not alive. The application answers 503 on everything that needs it.'
    severity: 1
    resourceId: databaseServerResourceId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'is_db_alive'
    operator: 'LessThan'
    threshold: 1
    aggregation: 'Minimum'
    frequency: 'PT1M'
    window: 'PT5M'
  }
  {
    name: 'db-cpu'
    description: 'Database CPU is high for fifteen minutes. A Burstable server then runs out of CPU credits and is throttled to its baseline: the application slows without any error.'
    severity: 2
    resourceId: databaseServerResourceId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'cpu_percent'
    operator: 'GreaterThan'
    threshold: databaseCpuPercent
    aggregation: 'Average'
    frequency: 'PT5M'
    window: 'PT15M'
  }
  {
    name: 'db-storage'
    description: 'The database disk is filling. With auto-grow on it grows (and costs more) instead of stopping; without it the server goes read-only when full.'
    severity: 2
    resourceId: databaseServerResourceId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'storage_percent'
    operator: 'GreaterThan'
    threshold: databaseStoragePercent
    aggregation: 'Maximum'
    frequency: 'PT15M'
    window: 'PT1H'
  }
])

resource metricAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for rule in metricRules: {
    name: '${baseName}-${rule.name}'
    location: 'global'
    tags: tags
    properties: {
      description: rule.description
      severity: rule.severity
      enabled: true
      scopes: [rule.resourceId]
      evaluationFrequency: rule.frequency
      windowSize: rule.window
      autoMitigate: true
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: rule.name
            metricNamespace: rule.namespace
            metricName: rule.metric
            operator: rule.operator
            threshold: rule.threshold
            timeAggregation: rule.aggregation
            dimensions: rule.?dimensions ?? []
          }
        ]
      }
      actions: [{ actionGroupId: actionGroup.id }]
    }
  }
]

output actionGroupName string = actionGroup.name
output ruleNames array = [for (rule, index) in metricRules: metricAlerts[index].name]
