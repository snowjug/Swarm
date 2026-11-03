// Alerting for the hosted pilot: one action group that e-mails the operator, and Azure Monitor alert
// rules in two layers.
//
//  - METRIC alert rules on the platform's own metrics (Container Apps, PostgreSQL). They need nothing
//    from the application, so they still fire when the application is down or its telemetry is broken,
//    and they are evaluated every minute. Up to ten time series a month are free.
//  - SCHEDULED QUERY (log) alert rules on what the application emits (docs/production/observability.md
//    lists every metric name and attribute, and which of them do not exist yet). They run every 15
//    minutes, the cheapest frequency, and each costs a fixed monthly price per rule.
//
// Every rule is annotated with the signal it reads. A rule that reads a signal the application does not
// emit yet is created DISABLED, so that nobody takes silence for health.
//
// None of this is a hard cap on anything and none of it has fired in Azure: the thresholds are the
// proposals of docs/operations/slo-dashboards-alerts.md and need tuning on real traffic.
targetScope = 'resourceGroup'

param baseName string
param tags object

@description('Region of the log alert rules. Metric alert rules and the action group are global.')
param location string = resourceGroup().location

@description('Resource ID of the container app (Microsoft.App/containerApps).')
param containerAppResourceId string

@description('Name of the container app; the platform log queries filter on it.')
param containerAppName string

@description('Resource ID of the PostgreSQL flexible server. It may live in another resource group.')
param databaseServerResourceId string

@description('Resource ID of the Application Insights component the application reports to.')
param appInsightsResourceId string

@description('Resource ID of the Log Analytics workspace that holds the Container Apps console and system logs.')
param workspaceResourceId string

@description('cloud_RoleName of the application in Application Insights: its OTEL_SERVICE_NAME. A query that filters on a name nothing uses returns nothing and so never alerts, except the heartbeat rule, which then alerts at once.')
param telemetryRoleName string = 'swarm'

@description('The person or shared mailbox that receives every alert. It is read from the environment by the parameter file and is never stored in the repository.')
@minLength(5)
param alertEmailAddress string

param additionalAlertEmailAddresses array = []

@description('True once the application emits the swarm.research.* signals named in docs/production/observability.md. Until then the crawler rule is created disabled.')
param researchSignalsEmitted bool = false

@description('The database server is Burstable, which has CPU credits that run out. The credit alert is meaningless on other tiers.')
param databaseIsBurstable bool = true

@description('Platform requests answered with a 5xx status in five minutes.')
@minValue(1)
param http5xxPer5Minutes int = 10

@description('Platform requests of any status in five minutes. A handful of pilot users send a few hundred; the application also rate-limits each address.')
@minValue(1)
param requestsPer5Minutes int = 3000

@description('Container restarts in fifteen minutes (liveness failures, out-of-memory kills, crash loops).')
@minValue(1)
param restartsPer15Minutes int = 3

@description('The most connections the database SKU allows (SHOW max_connections). The default is the documented value for B1ms and is UNVERIFIED on the live server.')
@minValue(1)
param databaseMaxConnections int = 50

@minValue(1)
@maxValue(100)
param databaseConnectionPercent int = 80

@minValue(1)
@maxValue(99)
param databaseStoragePercent int = 80

@description('Burstable CPU credits left. Below this the server is about to be throttled to its baseline.')
@minValue(1)
param databaseCpuCreditsRemaining int = 30

@description('Failed connection attempts in fifteen minutes: an Entra token problem, a firewall change or an attack.')
@minValue(1)
param databaseFailedConnectionsPer15Minutes int = 10

@description('95th percentile of non-export GET requests, in milliseconds. The service level objective is one second.')
@minValue(100)
param p95LatencyMs int = 1500

@minValue(1)
param latencyMinimumRequests int = 20

@description('Percent of model calls that failed in half an hour.')
@minValue(1)
@maxValue(100)
param modelFailurePercent int = 20

@minValue(1)
param modelMinimumCalls int = 10

@description('Model answers that failed the output schema even after the correction round, in an hour.')
@minValue(1)
param invalidModelOutputsPerHour int = 5

@description('Percent of model calls that needed the correction round in an hour.')
@minValue(1)
@maxValue(100)
param repairedModelCallsPercent int = 30

@description('Model tokens, input and output together, in an hour. It is the spend indicator: at the price of the pilot deployment 2,000,000 tokens are a few US dollars.')
@minValue(1)
param tokensPerHour int = 2000000

@description('Refused requests (no session, forbidden, bad host or origin) in fifteen minutes.')
@minValue(1)
param denialsPer15Minutes int = 150

@description('Requests answered 429 RATE_LIMITED in fifteen minutes.')
@minValue(1)
param rateLimitedPer15Minutes int = 300

@description('Fetches the crawler refused for safety reasons (a blocked address, scheme or port, a refused redirect, a decompression bomb) in an hour.')
@minValue(1)
param crawlerBlocksPerHour int = 10

var emailReceivers = [
  for (address, index) in concat([alertEmailAddress], additionalAlertEmailAddresses): {
    name: 'operator-${index}'
    emailAddress: address
    useCommonAlertSchema: true
  }
]

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${baseName}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: take(replace(baseName, '-', ''), 12)
    enabled: true
    emailReceivers: emailReceivers
  }
}

var metricActions = [{ actionGroupId: actionGroup.id }]
var logActions = { actionGroups: [actionGroup.id] }

// ---------------------------------------------------------------------------------------------
// Platform metric rules
// ---------------------------------------------------------------------------------------------

resource noReplicas 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${baseName}-app-no-replicas'
  location: 'global'
  tags: tags
  properties: {
    description: 'No replica of the container app ran for five minutes: it crashes at start, was scaled to zero, or its revision failed. The embedded job runner is stopped with it. See docs/production/runbook.md.'
    severity: 1
    enabled: true
    scopes: [containerAppResourceId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'replicas'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Replicas'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Maximum'
        }
      ]
    }
    actions: metricActions
  }
}

resource errors5xx 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${baseName}-http-5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'Server errors (5xx) answered by the ingress. Counted by the platform, so it also fires when the application emits no telemetry. Runbook: API errors.'
    severity: 2
    enabled: true
    scopes: [containerAppResourceId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'requests5xx'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Requests'
          operator: 'GreaterThan'
          threshold: http5xxPer5Minutes
          timeAggregation: 'Total'
          dimensions: [
            {
              name: 'statusCodeCategory'
              operator: 'Include'
              values: ['5xx']
            }
          ]
        }
      ]
    }
    actions: metricActions
  }
}

resource requestVolume 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${baseName}-request-volume'
  location: 'global'
  tags: tags
  properties: {
    description: 'Far more requests than a controlled pilot sends: a client loop, a scan or a flood. Runbook: a spike of refused requests.'
    severity: 2
    enabled: true
    scopes: [containerAppResourceId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'requests'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Requests'
          operator: 'GreaterThan'
          threshold: requestsPer5Minutes
          timeAggregation: 'Total'
        }
      ]
    }
    actions: metricActions
  }
}

resource restarts 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${baseName}-app-restarts'
  location: 'global'
  tags: tags
  properties: {
    description: 'The container restarted repeatedly: the liveness probe failed (the database connection was lost for good), the process was killed for memory, or it crashes at start.'
    severity: 2
    enabled: true
    scopes: [containerAppResourceId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'restarts'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'RestartCount'
          operator: 'GreaterThan'
          threshold: restartsPer15Minutes
          timeAggregation: 'Total'
        }
      ]
    }
    actions: metricActions
  }
}

resource databaseDown 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${baseName}-db-not-alive'
  location: 'global'
  tags: tags
  properties: {
    description: 'The platform reports the database server as not alive. The application then answers 503 on everything that needs it. Runbook: database down or not ready.'
    severity: 1
    enabled: true
    scopes: [databaseServerResourceId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'alive'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          metricName: 'is_db_alive'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Minimum'
        }
      ]
    }
    actions: metricActions
  }
}

resource databaseConnections 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${baseName}-db-connections'
  location: 'global'
  tags: tags
  properties: {
    description: 'Active connections are near the limit of the database SKU. The application holds one connection per process, so a rise means something else is connected or connections leak.'
    severity: 2
    enabled: true
    scopes: [databaseServerResourceId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'connections'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          metricName: 'active_connections'
          operator: 'GreaterThan'
          threshold: databaseMaxConnections * databaseConnectionPercent / 100
          timeAggregation: 'Maximum'
        }
      ]
    }
    actions: metricActions
  }
}

resource databaseStorage 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${baseName}-db-storage'
  location: 'global'
  tags: tags
  properties: {
    description: 'The database disk is filling. With auto-grow on it grows (and costs more) instead of stopping; without it the server goes read-only when full.'
    severity: 2
    enabled: true
    scopes: [databaseServerResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'storage'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          metricName: 'storage_percent'
          operator: 'GreaterThan'
          threshold: databaseStoragePercent
          timeAggregation: 'Maximum'
        }
      ]
    }
    actions: metricActions
  }
}

resource databaseCpuCredits 'Microsoft.Insights/metricAlerts@2018-03-01' = if (databaseIsBurstable) {
  name: '${baseName}-db-cpu-credits'
  location: 'global'
  tags: tags
  properties: {
    description: 'The Burstable database server is running out of CPU credits and will be throttled to its baseline: the application slows without any error.'
    severity: 3
    enabled: true
    scopes: [databaseServerResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'credits'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          metricName: 'cpu_credits_remaining'
          operator: 'LessThan'
          threshold: databaseCpuCreditsRemaining
          timeAggregation: 'Minimum'
        }
      ]
    }
    actions: metricActions
  }
}

resource databaseFailedConnections 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${baseName}-db-failed-connections'
  location: 'global'
  tags: tags
  properties: {
    description: 'Connection attempts to the database failed: usually the managed identity lost its Entra administrator role on the server, or a network rule changed.'
    severity: 3
    enabled: true
    scopes: [databaseServerResourceId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'failed'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          metricName: 'connections_failed'
          operator: 'GreaterThan'
          threshold: databaseFailedConnectionsPer15Minutes
          timeAggregation: 'Total'
        }
      ]
    }
    actions: metricActions
  }
}

// ---------------------------------------------------------------------------------------------
// Log rules over what the application emits. Each query returns a row only when the condition holds,
// so the rule fires when the row count is above zero.
// ---------------------------------------------------------------------------------------------

resource readinessFailing 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-readiness-failing'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: readiness or liveness probes failing'
    description: 'Probe failures in the Container Apps system log for the app. Reads ContainerAppSystemLogs_CL, a table that exists only after the first log line, so the rule skips query validation. The wording of the log line is UNVERIFIED: run the query once in the workspace after the first deployment.'
    severity: 1
    enabled: true
    scopes: [workspaceResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    skipQueryValidation: true
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            '''
ContainerAppSystemLogs_CL
| where ContainerAppName_s == '{{APP}}'
| where Log_s has 'probe' and Log_s has 'fail'
| summarize failures = count()
| where failures >= 5
''',
            '{{APP}}',
            containerAppName
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

resource databaseReportedDown 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-db-reported-down'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: the application reports its database as down'
    description: 'The swarm.db.up gauge was 0 in the last 15 minutes: the application could not run a trivial query. Signal exists today (backend/src/telemetry/signals.ts).'
    severity: 1
    enabled: true
    scopes: [appInsightsResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            '''
customMetrics
| where timestamp > ago(15m) and name == 'swarm.db.up' and cloud_RoleName == '{{ROLE}}'
| summarize lowest = min(value)
| where lowest < 1
''',
            '{{ROLE}}',
            telemetryRoleName
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

resource heartbeatMissing 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-telemetry-missing'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: no telemetry from the application'
    description: 'No swarm.db.up sample in 30 minutes: the application is down, scaled to zero, or its telemetry export is broken (identity role, connection string, ingestion cap). Fires at once if telemetryRoleName does not match OTEL_SERVICE_NAME, which is the point.'
    severity: 3
    enabled: true
    scopes: [appInsightsResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            '''
customMetrics
| where timestamp > ago(30m) and name == 'swarm.db.up' and cloud_RoleName == '{{ROLE}}'
| summarize samples = count()
| where samples == 0
''',
            '{{ROLE}}',
            telemetryRoleName
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

resource latencyP95 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-latency-p95'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: slow requests'
    description: '95th percentile of non-export GET request durations above the threshold in the last 30 minutes, with enough requests to mean something. Reads request spans (METHOD /route/:id), emitted today.'
    severity: 3
    enabled: true
    scopes: [appInsightsResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            replace(
              replace(
                '''
requests
| where timestamp > ago(30m) and cloud_RoleName == '{{ROLE}}'
| where name startswith 'GET ' and name !startswith 'GET /api/health' and name !has 'export'
| summarize requests = count(), p95 = percentile(duration, 95)
| where requests >= {{MIN}} and p95 > {{P95}}
''',
                '{{ROLE}}',
                telemetryRoleName
              ),
              '{{MIN}}',
              string(latencyMinimumRequests)
            ),
            '{{P95}}',
            string(p95LatencyMs)
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

resource modelFailures 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-model-failures'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: model calls failing'
    description: 'More than the threshold share of swarm.model.calls ended with outcome failed in the last 30 minutes (provider auth, quota, timeout, refusal). Signal exists today. Runbook: the model provider is failing.'
    severity: 2
    enabled: true
    scopes: [appInsightsResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            replace(
              replace(
                '''
customMetrics
| where timestamp > ago(30m) and name == 'swarm.model.calls' and cloud_RoleName == '{{ROLE}}'
| extend outcome = tostring(customDimensions['swarm.model.outcome'])
| summarize calls = sum(valueSum), failed = sumif(valueSum, outcome == 'failed')
| where calls >= {{MIN}} and failed * 100.0 / calls > {{PERCENT}}
''',
                '{{ROLE}}',
                telemetryRoleName
              ),
              '{{MIN}}',
              string(modelMinimumCalls)
            ),
            '{{PERCENT}}',
            string(modelFailurePercent)
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

resource schemaValidation 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-model-schema-failures'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: model output failing validation'
    description: 'Model answers that failed the strict output schema (error code MODEL_OUTPUT_INVALID) or needed the correction round (outcome repaired) in the last hour. Both exist today on swarm.model.calls; a dedicated fallback counter for the rules path is still to be emitted (docs/production/observability.md).'
    severity: 3
    enabled: true
    scopes: [appInsightsResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            replace(
              replace(
                replace(
                  '''
customMetrics
| where timestamp > ago(1h) and name == 'swarm.model.calls' and cloud_RoleName == '{{ROLE}}'
| extend outcome = tostring(customDimensions['swarm.model.outcome']), code = tostring(customDimensions['swarm.error.code'])
| summarize calls = sum(valueSum), invalid = sumif(valueSum, code == 'MODEL_OUTPUT_INVALID'), repaired = sumif(valueSum, outcome == 'repaired')
| where invalid >= {{INVALID}} or (calls >= {{MIN}} and repaired * 100.0 / calls > {{PERCENT}})
''',
                  '{{ROLE}}',
                  telemetryRoleName
                ),
                '{{INVALID}}',
                string(invalidModelOutputsPerHour)
              ),
              '{{MIN}}',
              string(modelMinimumCalls)
            ),
            '{{PERCENT}}',
            string(repairedModelCallsPercent)
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

resource tokenSpend 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-token-spend'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: model token spend in an hour'
    description: 'Tokens reported by the provider (swarm.model.tokens, both directions) in the last hour above the threshold. It is the cost-runaway indicator: a budget in Azure Cost Management reports with a delay of hours, this does not. Signal exists today.'
    severity: 3
    enabled: true
    scopes: [appInsightsResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            replace(
              '''
customMetrics
| where timestamp > ago(1h) and name == 'swarm.model.tokens' and cloud_RoleName == '{{ROLE}}'
| summarize tokens = sum(valueSum)
| where tokens > {{TOKENS}}
''',
              '{{ROLE}}',
              telemetryRoleName
            ),
            '{{TOKENS}}',
            string(tokensPerHour)
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

resource abuseSignals 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-refused-requests'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: refused or rate-limited requests'
    description: 'A spike of swarm.auth.denials (no session, forbidden, bad host or origin) or of swarm.http.errors with code RATE_LIMITED in the last 15 minutes. Both exist today. Runbook: a spike of refused requests.'
    severity: 2
    enabled: true
    scopes: [appInsightsResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            replace(
              replace(
                '''
customMetrics
| where timestamp > ago(15m) and cloud_RoleName == '{{ROLE}}' and name in ('swarm.auth.denials', 'swarm.http.errors')
| extend code = tostring(customDimensions['swarm.error.code'])
| summarize denials = sumif(valueSum, name == 'swarm.auth.denials'), limited = sumif(valueSum, name == 'swarm.http.errors' and code == 'RATE_LIMITED')
| where denials > {{DENIALS}} or limited > {{LIMITED}}
''',
                '{{ROLE}}',
                telemetryRoleName
              ),
              '{{DENIALS}}',
              string(denialsPer15Minutes)
            ),
            '{{LIMITED}}',
            string(rateLimitedPer15Minutes)
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

resource crawlerBlocks 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${baseName}-crawler-safety-blocks'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${baseName}: crawler safety refusals'
    description: 'The research crawler refused many fetches for safety reasons (a private, loopback, link-local, metadata or reserved address, an internal name, a blocked scheme or port, credentials in the address, a refused redirect or an https downgrade) in the last hour: someone is steering it, or a page links inward. READS swarm.research.safety.blocks by swarm.safety.reason (SAFETY_BLOCK_REASONS, backend/src/telemetry/product-signals.ts). robots-disallowed is polite and expected and prompt-injection is a content finding, so neither counts here. Created disabled until researchSignalsEmitted is true: whether customMetrics carries the counter total in valueSum is UNVERIFIED until the first deploy. Contract: docs/production/observability.md.'
    severity: 3
    enabled: researchSignalsEmitted
    scopes: [appInsightsResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: replace(
            replace(
              '''
customMetrics
| where timestamp > ago(1h) and cloud_RoleName == '{{ROLE}}' and name == 'swarm.research.safety.blocks'
| extend reason = tostring(customDimensions['swarm.safety.reason'])
| summarize blocked = sumif(valueSum, reason in ('private-address', 'loopback-address', 'link-local-address', 'metadata-address', 'reserved-address', 'invalid-address', 'internal-name', 'blocked-scheme', 'blocked-port', 'credentials-in-url', 'not-on-allow-list', 'redirect-refused', 'https-downgrade'))
| where blocked >= {{BLOCKS}}
''',
              '{{ROLE}}',
              telemetryRoleName
            ),
            '{{BLOCKS}}',
            string(crawlerBlocksPerHour)
          )
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: logActions
  }
}

output actionGroupName string = actionGroup.name
output actionGroupId string = actionGroup.id
