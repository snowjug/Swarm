// Azure Database for PostgreSQL flexible server for the application's single durable store.
// Microsoft Entra is the only way to authenticate: password authentication is off, so there is no
// administrator password to create, store or leak. Connections must use TLS.
//
// Three shapes, chosen by parameters (docs/production/azure-preflight.md prices each):
//  - the pilot: Burstable B1ms, public endpoint behind the "Azure services" rule, no HA, 7-day backups;
//  - production-shaped: General Purpose, zone-redundant HA, geo-redundant backups, 35 days, private access;
//  - an EXISTING server (useExistingServer): only the database is added. The server, its network, its
//    settings and its administrators are not touched, because they may be shared with other applications.
targetScope = 'resourceGroup'

@description('Globally unique server name; it becomes <name>.postgres.database.azure.com.')
@minLength(3)
@maxLength(63)
param serverName string

param location string
param tags object

@description('True when the server already exists in this resource group (the module is then deployed into the group that holds it). Only the database is created: the application identity is NOT made an administrator of a server that other applications may share, so an administrator of that server must create its database role (docs/production/runbook.md).')
param useExistingServer bool = false

@description('Compute SKU. Burstable B1ms is the cheapest sane choice for a pilot.')
param skuName string = 'Standard_B1ms'

@description('Burstable cannot have high availability; production-shaped uses GeneralPurpose.')
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param skuTier string = 'Burstable'

@allowed(['14', '15', '16', '17'])
param postgresVersion string = '16'

@minValue(32)
@maxValue(16384)
param storageSizeGB int = 32

@description('Grows the disk before it fills, which a full disk would otherwise turn into an outage. Storage cannot be shrunk again; the storage alert watches the growth.')
@allowed(['Enabled', 'Disabled'])
param storageAutoGrow string = 'Enabled'

@description('Days of automated backups. This is also how far back a point-in-time restore can reach.')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Copies backups to the paired region. It can only be chosen when the server is created, and doubles the backup storage price.')
@allowed(['Enabled', 'Disabled'])
param geoRedundantBackup string = 'Disabled'

@description('ZoneRedundant keeps a synchronous standby in another zone and roughly doubles the compute and storage price.')
@allowed(['Disabled', 'SameZone', 'ZoneRedundant'])
param highAvailabilityMode string = 'Disabled'

@description('Availability zone of the primary. Empty lets the service choose.')
@allowed(['', '1', '2', '3'])
param availabilityZone string = ''

@description('Availability zone of the standby when high availability is on. Empty lets the service choose.')
@allowed(['', '1', '2', '3'])
param standbyAvailabilityZone string = ''

@description('Subnet delegated to flexible servers. With the private DNS zone it turns on private access: the server then has no public endpoint at all, and no firewall rule is created.')
param delegatedSubnetResourceId string = ''

param privateDnsZoneResourceId string = ''

@description('Day of the weekly maintenance window, 0 (Sunday) to 6. Without a custom window the service picks one, and it may be in working hours.')
@allowed([0, 1, 2, 3, 4, 5, 6])
param maintenanceDayOfWeek int = 0

@description('Hour (UTC) the maintenance window starts. 21:00 UTC on Sunday is 02:30 Monday in India.')
@minValue(0)
@maxValue(23)
param maintenanceStartHourUtc int = 21

@description('Entra object ID of the identity that becomes the server administrator. It names the administrator resource. Ignored for an existing server.')
param administratorObjectId string = ''

@description('Display name of that identity. It is the database user the application connects as.')
param administratorName string = ''

@description('Optional Entra GROUP of people who may administer the server (break glass). Empty adds none. Ignored for an existing server.')
param breakGlassAdminGroupObjectId string = ''

param breakGlassAdminGroupName string = ''

param databaseName string = 'swarm'

var privateAccess = !empty(delegatedSubnetResourceId) && !empty(privateDnsZoneResourceId)

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = if (!useExistingServer) {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: postgresVersion
    createMode: 'Default'
    availabilityZone: empty(availabilityZone) ? null : availabilityZone
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: storageAutoGrow
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup
    }
    highAvailability: {
      mode: highAvailabilityMode
      standbyAvailabilityZone: empty(standbyAvailabilityZone) ? null : standbyAvailabilityZone
    }
    maintenanceWindow: {
      customWindow: 'Enabled'
      dayOfWeek: maintenanceDayOfWeek
      startHour: maintenanceStartHourUtc
      startMinute: 0
    }
    network: privateAccess
      ? {
          delegatedSubnetResourceId: delegatedSubnetResourceId
          privateDnsZoneArmResourceId: privateDnsZoneResourceId
          publicNetworkAccess: 'Disabled'
        }
      : { publicNetworkAccess: 'Enabled' }
    // No administrator login or password is set, because password authentication is off.
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
  }
}

// The same server, whether this template made it or not: the database below is a child of this name.
resource serverRef 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' existing = {
  name: serverName
}

// The operations below are chained on purpose: the service refuses overlapping changes to one server
// ("server is busy"), and a deployment runs unrelated child resources in parallel unless told not to.
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: serverRef
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [server]
}

// 0.0.0.0 to 0.0.0.0 is Azure's marker for "any Azure-hosted client". It is the one network rule of a
// server with a public endpoint, because a Container Apps environment without a virtual network has no
// fixed outbound address to name. Only an Entra principal that exists on this server can sign in, and
// the sign-in needs TLS. Private access (virtual network) has no public endpoint and so no rule.
resource azureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = if (!useExistingServer && !privateAccess) {
  parent: serverRef
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [database]
}

// Already the default; written out so that a change in the service's default cannot allow plain connections.
resource secureTransport 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2025-08-01' = if (!useExistingServer) {
  parent: serverRef
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
  dependsOn: [azureServices, database]
}

// The application creates and migrates its own tables, so its identity is the server's administrator.
// It is the only principal with access; add people separately and temporarily (see docs/azure/pilot-plan.md).
// Separating a migration identity from a least-privilege runtime role needs a change in the application
// (it migrates when it starts): docs/production/LIMITATIONS.md says what and why.
resource administrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2025-08-01' = if (!useExistingServer) {
  parent: serverRef
  name: administratorObjectId
  properties: {
    principalType: 'ServicePrincipal'
    principalName: administratorName
    tenantId: tenant().tenantId
  }
  dependsOn: [secureTransport]
}

resource breakGlass 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2025-08-01' = if (!useExistingServer && !empty(breakGlassAdminGroupObjectId)) {
  parent: serverRef
  name: breakGlassAdminGroupObjectId
  properties: {
    principalType: 'Group'
    principalName: breakGlassAdminGroupName
    tenantId: tenant().tenantId
  }
  dependsOn: [administrator]
}

output serverName string = serverRef.name
output serverResourceId string = serverRef.id
output fullyQualifiedDomainName string = serverRef.properties.fullyQualifiedDomainName
output databaseName string = database.name
output privateAccess bool = privateAccess
