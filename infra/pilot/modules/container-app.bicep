// The one container app that serves both the React UI and the Fastify API, and the Container Apps
// environment it runs in: created by environment-new.bicep, or read from environment-existing.bicep. One
// of the two modules is deployed, never both, because a template must not declare the same resource
// twice. No secret value is defined here: every setting is an ordinary environment variable, every
// credential is a Microsoft Entra token of the attached managed identity, and the one thing that cannot be
// (an optional OIDC client secret) is a reference to a Key Vault secret.
//
// The app runs in MULTIPLE-revision mode so that a release is blue/green: the new revision starts
// beside the one that serves, takes no traffic until it is shifted to, and the previous revision stays
// available for an instant rollback (traffic back) until it is deactivated. See
// docs/production/release-process.md.
targetScope = 'resourceGroup'

param environmentResourceName string
param appName string
param location string
param tags object

@description('True: this module creates the Container Apps environment. False: it already exists (environmentSubscriptionId, environmentResourceGroup) and must be a workload-profiles environment with the Consumption profile.')
param createEnvironment bool = true

param environmentSubscriptionId string = subscription().subscriptionId
param environmentResourceGroup string = resourceGroup().name

@description('Log Analytics workspace that receives console and system logs of a NEW environment. Ignored for an existing one.')
param workspaceName string

param workspaceSubscriptionId string = subscription().subscriptionId
param workspaceResourceGroup string = resourceGroup().name

@description('Subnet for virtual network integration of a NEW environment (network.bicep). Empty: no virtual network.')
param infrastructureSubnetId string = ''

@description('Spreads the environment over availability zones. Needs the virtual network above and a region with zones; it costs nothing extra by itself.')
param zoneRedundant bool = false

@description('Resource ID of the user-assigned managed identity attached to the app.')
param identityResourceId string

@description('Client ID of that identity. Selects it for DefaultAzureCredential (AZURE_CLIENT_ID).')
param identityClientId string

@description('Name of that identity. It is the PostgreSQL user the app connects as.')
param identityName string

param registryLoginServer string

@description('The image to run, already resolved by the caller (see main.bicep).')
param image string

@description('True while the image is the public placeholder. It listens on port 80 and has no health routes, so the ingress targets port 80, no PORT is set (the application would refuse 80) and no probe is set. A real image gets port 3001, PORT=3001 and the three probes; see main.bicep for how the image is chosen, and docs/azure/pilot-plan.md.')
param placeholderImage bool = false

@description('vCPU of the replica. Memory is set to twice that, the ratio the Consumption profile requires.')
@allowed(['0.25', '0.5', '1', '2'])
param cpu string = '0.5'

@description('Replicas that always run: at least one, because the job runner is embedded in the process and a replica scaled to zero stops it (a queued run would then wait for the next request).')
@minValue(1)
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

@description('The search that finds pages for a question that names none (RESEARCH_SEARCH_PROVIDER). A key for brave is a Key Vault secret reference (RESEARCH_SEARCH_API_KEY), never a parameter.')
@allowed([
  'none'
  'wikipedia'
  'brave'
])
param researchSearchProvider string = 'none'

@description('What the Ask screen preselects for a new question (DEFAULT_ENGINE). rules keeps everything on the server; model asks the configured model, and a pilot meant to show the model sets it. Either is only a preselection: every person sees the choice and can change it, and a model that is not configured is never preselected.')
@allowed([
  'rules'
  'model'
])
param defaultEngine string = 'rules'

@description('Most model calls one project may make in all (PROJECT_MODEL_CALL_LIMIT); 0 is no limit.')
param projectModelCallLimit int = 0

@description('Most tokens, input and output together, one project may use in all (PROJECT_MODEL_TOKEN_LIMIT); 0 is no limit.')
param projectModelTokenLimit int = 0

@description('DEPLOYMENT_MODE. The application refuses to start in pilot or production unless every hosted-deployment guard passes (backend/src/deployment.ts), so a hosted app never runs with the permissive local defaults.')
@allowed(['pilot', 'production'])
param deploymentMode string = 'pilot'

@description('DEPLOYMENT_LABEL: what this deployment is, in words, for the people who use it (at most 80 characters). Empty uses the default of the mode; production requires one.')
@maxLength(80)
param deploymentLabel string = ''

@description('BUILD_SHA: the commit the image was built from. A release sets it on the revision it creates; this is the value of a template deployment. Empty leaves the setting out.')
@maxLength(40)
param buildSha string = ''

@description('Name suffix of the revision this deployment creates: <app>--<suffix>. Lower-case letters, digits and hyphens, starting with a letter, at most 20 characters. The release tooling uses the first 12 characters of the commit SHA behind an "r" so a revision name identifies the code. Empty lets the platform name it.')
@maxLength(20)
param revisionSuffix string = ''

@description('preserve: keep the traffic the live app has now (preservedTraffic), so that re-applying the template never moves traffic or undoes a rollback. latest: the newest revision takes all traffic. split: newRevisionTrafficPercent to this deployment\'s revision and the rest to previousRevisionName.')
@allowed(['preserve', 'latest', 'split'])
param trafficMode string = 'preserve'

@description('The ingress traffic of the live app, read by main.bicep. Empty before the app exists.')
param preservedTraffic array = []

@description('The revision that served before this release, kept active (warm) at the remaining weight so that rollback is a traffic change, not a start. Used by trafficMode split.')
param previousRevisionName string = ''

@description('Share of traffic the revision of this deployment receives in split mode: 0 starts it dark, a small number is a canary, 100 completes the release.')
@minValue(0)
@maxValue(100)
param newRevisionTrafficPercent int = 100

@description('Deactivated revisions Azure keeps so that one can be re-activated. Active revisions are never counted.')
@minValue(0)
@maxValue(100)
param maxInactiveRevisions int = 5

@description('Key Vault URI, with the trailing slash (https://<vault>.vault.azure.net/). Needed only when keyVaultSecretReferences is not empty.')
param keyVaultUri string = ''

@description('Settings whose value is a Key Vault secret. The secret must already exist; the identity reads it with Key Vault Secrets User.')
param keyVaultSecretReferences SecretReference[] = []

@description('Client address ranges (CIDR) that may reach the ingress. Empty allows every address, which sign-in and the rate limiter then guard.')
param ingressAllowedCidrs array = []

type SecretReference = {
  @description('The environment variable the application reads, for example AUTH_ENTRA_CLIENT_SECRET.')
  envName: string
  @description('Name of the secret in the Key Vault. Its value is created and rotated out of band and is never in a template.')
  secretName: string
}

// The port the application listens on (PORT, whose schema is 1024-65535) and the ingress targets. Only the
// placeholder differs: it listens on 80 and is replaced by the first real image.
var applicationPort = 3001
var targetPort = placeholderImage ? 80 : applicationPort
var memoryByCpu = {
  '0.25': '0.5Gi'
  '0.5': '1Gi'
  '1': '2Gi'
  '2': '4Gi'
}

// Exactly one of the two modules is deployed, so the environment is declared once per deployment.
module createdEnvironment 'environment-new.bicep' = if (createEnvironment) {
  name: 'environment-new'
  params: {
    environmentName: environmentResourceName
    location: location
    tags: tags
    workspaceName: workspaceName
    workspaceSubscriptionId: workspaceSubscriptionId
    workspaceResourceGroup: workspaceResourceGroup
    infrastructureSubnetId: infrastructureSubnetId
    zoneRedundant: zoneRedundant
  }
}

module existingEnvironment 'environment-existing.bicep' = if (!createEnvironment) {
  name: 'environment-existing'
  scope: resourceGroup(environmentSubscriptionId, environmentResourceGroup)
  params: {
    environmentName: environmentResourceName
  }
}

var environmentId = createEnvironment ? createdEnvironment!.outputs.id : existingEnvironment!.outputs.id
var environmentDefaultDomain = createEnvironment
  ? createdEnvironment!.outputs.defaultDomain
  : existingEnvironment!.outputs.defaultDomain

// The app's own address is known before the app exists: <app name>.<environment default domain>.
var fqdn = '${appName}.${environmentDefaultDomain}'

// The app answers the two health routes for any Host, but names its own host anyway, so that the
// probes also pass a build that checks the host on every route.
var probeHeaders = [
  {
    name: 'Host'
    value: fqdn
  }
]

// A real image is told its port. The placeholder is not: it ignores PORT, the application refuses 80 (the
// schema of PORT starts at 1024), and a revision made later with `az containerapp update` copies this
// list, so a PORT=80 here would reach the real image and stop it at start. Without PORT the application
// uses 3001, which is the port every real revision runs on.
var portEnvironment = placeholderImage ? [] : [{ name: 'PORT', value: string(applicationPort) }]

var baseEnvironment = [
  { name: 'HOST', value: '0.0.0.0' }
  { name: 'DEPLOYMENT_MODE', value: deploymentMode }
  { name: 'AUTH_MODE', value: 'entra' }
  { name: 'AUTH_ENTRA_TENANT_ID', value: tenant().tenantId }
  { name: 'AUTH_ENTRA_AUDIENCE', value: authAudience }
  { name: 'AUTH_ENTRA_CLIENT_ID', value: authClientId }
  { name: 'AUTH_ENTRA_REDIRECT_URI', value: 'https://${fqdn}/auth/callback' }
  { name: 'ALLOWED_HOSTS', value: fqdn }
  { name: 'ALLOWED_ORIGINS', value: 'https://${fqdn}' }
  {
    name: 'DATABASE_URL'
    value: 'postgres://${uriComponent(identityName)}@${databaseHost}:5432/${databaseName}?sslmode=require'
  }
  { name: 'DATABASE_AUTH', value: 'entra' }
  // Microsoft Foundry through its OpenAI-compatible v1 API, signed in with the managed identity: no key.
  { name: 'AI_PROVIDER', value: 'foundry' }
  { name: 'AI_MODEL', value: aiDeploymentName }
  { name: 'FOUNDRY_ENDPOINT', value: azureOpenAiEndpoint }
  { name: 'FOUNDRY_AUTH', value: 'entra' }
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
  { name: 'RESEARCH_SEARCH_PROVIDER', value: researchSearchProvider }
  { name: 'DEFAULT_ENGINE', value: defaultEngine }
  { name: 'PROJECT_MODEL_CALL_LIMIT', value: string(projectModelCallLimit) }
  { name: 'PROJECT_MODEL_TOKEN_LIMIT', value: string(projectModelTokenLimit) }
]
var sourceEnvironment = empty(sourceUrl) ? [] : [{ name: 'SOURCE_URL', value: sourceUrl }]
var identityEnvironment = concat(
  empty(deploymentLabel) ? [] : [{ name: 'DEPLOYMENT_LABEL', value: deploymentLabel }],
  empty(buildSha) ? [] : [{ name: 'BUILD_SHA', value: buildSha }]
)

// The application refuses both an Entra client secret and a client assertion, because a client
// authenticates one way. The pilot uses the managed identity; a secret in Key Vault replaces it.
var secretEnvironmentNames = map(keyVaultSecretReferences, reference => reference.envName)
var usesClientSecret = contains(secretEnvironmentNames, 'AUTH_ENTRA_CLIENT_SECRET')
var assertionEnvironment = usesClientSecret
  ? []
  : [{ name: 'AUTH_ENTRA_CLIENT_ASSERTION', value: 'managed-identity' }]

// Container Apps secret names are lower-case letters, digits, '-' and '.'.
var secretNameByEnvironmentName = toObject(
  keyVaultSecretReferences,
  reference => reference.envName,
  reference => toLower(replace(reference.envName, '_', '-'))
)
var secrets = [
  for reference in keyVaultSecretReferences: {
    name: secretNameByEnvironmentName[reference.envName]
    keyVaultUrl: '${keyVaultUri}secrets/${reference.secretName}'
    identity: identityResourceId
  }
]
var secretEnvironment = [
  for reference in keyVaultSecretReferences: {
    name: reference.envName
    secretRef: secretNameByEnvironmentName[reference.envName]
  }
]

var probes = [
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

// The revision this deployment creates is named from the suffix, so that traffic can name it before it exists.
var newRevisionName = '${appName}--${revisionSuffix}'
var latestOnlyTraffic = [
  {
    latestRevision: true
    weight: 100
  }
]
var splitTraffic = [
  {
    revisionName: newRevisionName
    weight: newRevisionTrafficPercent
    label: 'green'
  }
  {
    revisionName: previousRevisionName
    weight: 100 - newRevisionTrafficPercent
    label: 'blue'
  }
]
var canSplit = !empty(revisionSuffix) && !empty(previousRevisionName)
var traffic = trafficMode == 'split' && canSplit
  ? splitTraffic
  : (trafficMode == 'preserve' && !empty(preservedTraffic) ? preservedTraffic : latestOnlyTraffic)

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
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      // Blue/green: several revisions can be active, and traffic weights say which serve. A new revision
      // takes no traffic unless a weight names it (trafficMode), and a failing readiness probe keeps
      // it from taking any either way.
      activeRevisionsMode: 'Multiple'
      maxInactiveRevisions: maxInactiveRevisions
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        traffic: traffic
        ipSecurityRestrictions: [
          for (cidr, index) in ingressAllowedCidrs: {
            name: 'allow-${index}'
            description: 'Pilot access list'
            action: 'Allow'
            ipAddressRange: cidr
          }
        ]
      }
      registries: [
        {
          server: registryLoginServer
          identity: identityResourceId
        }
      ]
      // References only: Container Apps reads each value from Key Vault with the identity, and no value is stored here.
      secrets: secrets
    }
    template: {
      revisionSuffix: empty(revisionSuffix) ? null : revisionSuffix
      containers: [
        {
          name: 'swarm'
          image: image
          resources: {
            cpu: json(cpu)
            memory: memoryByCpu[cpu]
          }
          env: concat(
            portEnvironment,
            baseEnvironment,
            assertionEnvironment,
            secretEnvironment,
            sourceEnvironment,
            identityEnvironment
          )
          probes: placeholderImage ? [] : probes
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

output id string = app.id
output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
output latestRevisionName string = app.properties.latestRevisionName
