// Container Apps environment (Consumption profile only) and the one container app that serves both
// the React UI and the Fastify API. No secrets are defined: every setting is an ordinary environment
// variable, and every credential is a Microsoft Entra token of the attached managed identity.
targetScope = 'resourceGroup'

param environmentResourceName string
param appName string
param location string
param tags object

@description('Log Analytics workspace, in this resource group, that receives console and system logs.')
param workspaceName string

@description('Resource ID of the user-assigned managed identity attached to the app.')
param identityResourceId string

@description('Client ID of that identity. Selects it for DefaultAzureCredential (AZURE_CLIENT_ID).')
param identityClientId string

@description('Name of that identity. It is the PostgreSQL user the app connects as.')
param identityName string

param registryLoginServer string

@description('The image to run, already resolved by the caller (see main.bicep).')
param image string

@description('vCPU of the replica. Memory is set to twice that, the ratio the Consumption profile requires.')
@allowed(['0.25', '0.5', '1', '2'])
param cpu string = '0.5'

@description('Replicas that always run. Zero lets the app stop when idle, which also stops its embedded job runner.')
@minValue(0)
@maxValue(10)
param minReplicas int = 1

@description('Most replicas. Keep 1 until running several instances against one database has been validated (see ADR 0009).')
@minValue(1)
@maxValue(10)
param maxReplicas int = 1

param databaseHost string
param databaseName string

@description('Entra application (client) ID people sign in with.')
param authClientId string

@description('Audience tokens must carry (AUTH_ENTRA_AUDIENCE).')
param authAudience string

param aiDeploymentName string
param azureOpenAiEndpoint string

@description('Not a credential: the component accepts telemetry only from Entra-authenticated callers.')
param appInsightsConnectionString string

@description('Public HTTPS address of the exact source version (SOURCE_URL). Empty omits the setting.')
param sourceUrl string = ''

var targetPort = 3001
var memoryByCpu = {
  '0.25': '0.5Gi'
  '0.5': '1Gi'
  '1': '2Gi'
  '2': '4Gi'
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: workspaceName
}

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: environmentResourceName
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
    zoneRedundant: false
  }
}

// The app's own address is known before the app exists: <app name>.<environment default domain>.
var fqdn = '${appName}.${environment.properties.defaultDomain}'

// The app answers the two health routes for any Host, but names its own host anyway, so that the
// probes also pass a build that checks the host on every route.
var probeHeaders = [
  {
    name: 'Host'
    value: fqdn
  }
]

var baseEnvironment = [
  { name: 'PORT', value: string(targetPort) }
  { name: 'HOST', value: '0.0.0.0' }
  { name: 'AUTH_MODE', value: 'entra' }
  { name: 'AUTH_ENTRA_TENANT_ID', value: tenant().tenantId }
  { name: 'AUTH_ENTRA_AUDIENCE', value: authAudience }
  { name: 'AUTH_ENTRA_CLIENT_ID', value: authClientId }
  { name: 'AUTH_ENTRA_REDIRECT_URI', value: 'https://${fqdn}/auth/callback' }
  { name: 'AUTH_ENTRA_CLIENT_ASSERTION', value: 'managed-identity' }
  { name: 'ALLOWED_HOSTS', value: fqdn }
  { name: 'ALLOWED_ORIGINS', value: 'https://${fqdn}' }
  {
    name: 'DATABASE_URL'
    value: 'postgres://${uriComponent(identityName)}@${databaseHost}:5432/${databaseName}?sslmode=require'
  }
  { name: 'DATABASE_AUTH', value: 'entra' }
  { name: 'AI_PROVIDER', value: 'azure' }
  { name: 'AI_MODEL', value: aiDeploymentName }
  { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
  { name: 'AZURE_OPENAI_AUTH', value: 'entra' }
  { name: 'AZURE_CLIENT_ID', value: identityClientId }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
  {
    name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING'
    value: 'Authorization=AAD;ClientId=${identityClientId}'
  }
  { name: 'OTEL_SERVICE_NAME', value: 'swarm' }
  { name: 'LOG_LEVEL', value: 'info' }
  { name: 'TRUST_PROXY', value: '1' }
  { name: 'RATE_LIMIT_SCALE', value: '1' }
  { name: 'SWARM_ROLE', value: 'all' }
]
var sourceEnvironment = empty(sourceUrl) ? [] : [{ name: 'SOURCE_URL', value: sourceUrl }]

resource app 'Microsoft.App/containerApps@2025-07-01' = {
  name: appName
  location: location
  // azd finds the service to deploy to by this tag.
  tags: union(tags, { 'azd-service-name': 'swarm' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      // One revision serves at a time; a new one takes over only after its readiness probe passes.
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registryLoginServer
          identity: identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'swarm'
          image: image
          resources: {
            cpu: json(cpu)
            memory: memoryByCpu[cpu]
          }
          env: concat(baseEnvironment, sourceEnvironment)
          probes: [
            {
              // Holds the other probes back while the process migrates the schema and opens its database
              // connection, during which it is not listening yet.
              type: 'Startup'
              httpGet: {
                path: '/api/health/live'
                port: targetPort
                httpHeaders: probeHeaders
              }
              initialDelaySeconds: 15
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              // Fails only when the database connection is lost for good, which a restart cures.
              type: 'Liveness'
              httpGet: {
                path: '/api/health/live'
                port: targetPort
                httpHeaders: probeHeaders
              }
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              // Fails while the database does not answer: traffic stops, but nothing restarts.
              type: 'Readiness'
              httpGet: {
                path: '/api/health/ready'
                port: targetPort
                httpHeaders: probeHeaders
              }
              periodSeconds: 15
              timeoutSeconds: 5
              failureThreshold: 3
              successThreshold: 1
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
}

output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
