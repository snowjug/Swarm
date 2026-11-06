// The ONE container app of the public edition: the React page, the API and the job runner in one process.
//
// What this module fixes, and why (docs/public/DESIGN.md, sections 3, 7.3 and 10; docs/public/DECISIONS-FOR-OWNER.md, 4):
//
//  - MAX REPLICAS IS 1, and it is not a parameter. A person's own model key (BYOK) is held in the memory of one process,
//    for the length of a run. A second replica would not have it, and a run that landed there would stop. It also bounds
//    what a flood of requests can cost.
//  - SINGLE-REVISION MODE, which the pilot does not use. The pilot keeps the previous revision running at no traffic so
//    that a rollback is a traffic change; here that second running revision would be a second process with a second job
//    runner and no keys. In Single mode the platform starts the new revision, waits until every replica passes its startup
//    and readiness probes, moves all traffic, and only then removes the old one; a revision that fails to start never
//    takes traffic, and the old one keeps serving. There is no canary: traffic is never split between two processes.
//  - The ingress is external, HTTPS ONLY (allowInsecure false: plain HTTP is redirected).
//  - CPU and memory are capped here (at most 1 vCPU and 2 GiB, the ratio of the Consumption profile), which bounds what a
//    flood of requests can cost.
//  - No secret value is defined here: every setting is an ordinary environment variable, every credential is a Microsoft
//    Entra token of the attached managed identity, and the few values that cannot be (the OAuth client secrets and the
//    Turnstile secret) are references to Key Vault secrets that a person puts there (docs/public/DEPLOY.md).
//
// The environment variables are built in main.bicep, where the contract of docs/public/DESIGN.md, section 3, is read in one place.
targetScope = 'resourceGroup'

param appName string
param location string
param tags object

@description('Resource ID of the Container Apps environment (environment-new.bicep).')
param environmentId string

@description('Resource ID of the user-assigned managed identity: it pulls the image and reads the Key Vault secrets.')
param identityResourceId string

param registryLoginServer string

@description('The image to run, <registry>/swarm@sha256:<digest>. There is no placeholder image: the app is only created when a real one exists.')
param image string

@description('The image comes from the registry this deployment created, the only one the identity may pull from. A check that main.bicep makes at deployment time; a value of false stops the deployment before the app is touched.')
@allowed([true])
param imageIsFromThisDeploymentsRegistry bool

@description('vCPU of the one replica; memory is twice that. At most 1 vCPU and 2 GiB: a cap on cost as much as on capacity.')
@allowed(['0.25', '0.5', '1'])
param cpu string = '0.5'

@description('0 or 1. 1 (the default) keeps the process, its job runner and any BYOK key in memory alive; 0 lets the app scale to zero when idle, which ends a long run and drops every BYOK key.')
@allowed([0, 1])
param minReplicas int = 1

@description('The port the application listens on, which the ingress targets and the probes ask.')
param targetPort int = 3001

@description('The Host header of the probes: the default address of the app, which is always in ALLOWED_HOSTS.')
param probeHost string

@description('Environment variables, built by main.bicep. A value that is a secret is a secretRef, never a value.')
param environmentVariables array

@description('Container Apps secrets that are Key Vault references: { name, keyVaultUrl, identity }. Never a value.')
param secrets array = []

@description('Client address ranges (CIDR) that may reach the ingress. Empty allows every address, which is what a public site is.')
param ingressAllowedCidrs array = []

@description('Custom domain bindings: [{ name, certificateId, bindingType }]. Empty: none, and a re-deployment removes a binding that was added with az (docs/public/DEPLOY.md, "Custom domain").')
param customDomains array = []

@description('Deactivated revisions Azure keeps, so that one can be looked up or re-activated.')
@minValue(0)
@maxValue(100)
param maxInactiveRevisions int = 5

// A hard-coded value, on purpose: see the first point above. A test (scripts/iac/public-invariants.test.ts) asserts it.
var maxReplicas = 1

var memoryByCpu = {
  '0.25': '0.5Gi'
  '0.5': '1Gi'
  '1': '2Gi'
}

var probeHeaders = [
  {
    name: 'Host'
    value: probeHost
  }
]

var probes = [
  {
    // Holds the other probes back while the process migrates the schema, sets up row-level security and opens its
    // database connection, during which it is not listening yet. It is also what a new revision must pass before it
    // takes traffic.
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

resource app 'Microsoft.App/containerApps@2025-07-01' = {
  name: appName
  location: location
  tags: tags
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
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: maxInactiveRevisions
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        ipSecurityRestrictions: [
          for (cidr, index) in ingressAllowedCidrs: {
            name: 'allow-${index}'
            description: 'Access list'
            action: 'Allow'
            ipAddressRange: cidr
          }
        ]
        customDomains: customDomains
      }
      registries: [
        {
          server: registryLoginServer
          identity: identityResourceId
        }
      ]
      // References only: Container Apps reads each value from Key Vault with the identity when a replica starts, and no
      // value is stored here. The secret must exist before this app does.
      secrets: secrets
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
          env: environmentVariables
          probes: probes
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
output imageChecked bool = imageIsFromThisDeploymentsRegistry
