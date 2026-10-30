// Azure Database for PostgreSQL flexible server for the application's single durable store.
// Microsoft Entra is the only way to authenticate: password authentication is off, so there is no
// administrator password to create, store or leak. Connections must use TLS.
targetScope = 'resourceGroup'

@description('Globally unique server name; it becomes <name>.postgres.database.azure.com.')
@minLength(3)
@maxLength(63)
param serverName string

param location string
param tags object

@description('Days of automated backups. This is also how far back a point-in-time restore can reach.')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Entra object ID of the identity that becomes the server administrator. It names the administrator resource.')
param administratorObjectId string

@description('Display name of that identity. It is the database user the application connects as.')
param administratorName string

param databaseName string = 'swarm'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
    // No administrator login or password is set, because password authentication is off.
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
  }
}

// The operations below are chained on purpose: the service refuses overlapping changes to one server
// ("server is busy"), and a deployment runs unrelated child resources in parallel unless told not to.
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// 0.0.0.0 to 0.0.0.0 is Azure's marker for "any Azure-hosted client". It is the one network rule here
// because a Container Apps environment without a virtual network has no fixed outbound address to name.
// Only an Entra principal that exists on this server can sign in, and the sign-in needs TLS.
resource azureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = {
  parent: server
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [database]
}

// Already the default; written out so that a change in the service's default cannot allow plain connections.
resource secureTransport 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2025-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
  dependsOn: [azureServices]
}

// The application creates and migrates its own tables, so its identity is the server's administrator.
// It is the only principal with access; add people separately and temporarily (see docs/azure/pilot-plan.md).
resource administrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2025-08-01' = {
  parent: server
  name: administratorObjectId
  properties: {
    principalType: 'ServicePrincipal'
    principalName: administratorName
    tenantId: tenant().tenantId
  }
  dependsOn: [secureTransport]
}

output serverName string = server.name
output fullyQualifiedDomainName string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
