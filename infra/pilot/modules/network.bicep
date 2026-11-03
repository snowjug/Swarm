// Optional private network for the hosted pilot: a virtual network with one subnet for the Container
// Apps environment (VNet integration) and one delegated to PostgreSQL flexible server (private access),
// the private DNS zone that server needs, and, only when asked for, a NAT gateway that gives the app
// one fixed outbound address.
//
// Off by default (enablePrivateNetworking in main.bicep): a pilot that is only reachable by people
// who sign in with Microsoft Entra does not need it, and docs/production/azure-preflight.md prices what
// it adds. What this does NOT do: filter where the app may connect to. The crawler's protection against
// private, loopback and metadata addresses is the application's own (backend/src/ingest/url); a NAT
// gateway changes the source address of outbound traffic, it does not restrict the destination.
targetScope = 'resourceGroup'

param baseName string
param location string
param tags object

@description('Address space of the virtual network. Keep it disjoint from every network it may be peered with.')
param addressPrefix string = '10.40.0.0/24'

@description('Subnet of the Container Apps environment. Delegated to Microsoft.App/environments; /27 is the smallest size a workload-profiles environment accepts, and every replica (of every active revision) takes an address.')
param appSubnetPrefix string = '10.40.0.0/26'

@description('Subnet delegated to PostgreSQL flexible server. It holds nothing else.')
param databaseSubnetPrefix string = '10.40.0.64/28'

@description('Adds a NAT gateway and one static public IP to the app subnet, so outbound traffic (the crawler, the model call, the registry) leaves from one known address. It costs money by the hour: see docs/production/azure-preflight.md.')
param enableNatGateway bool = false

var databaseDnsZoneName = '${baseName}.private.postgres.database.azure.com'
var appSubnetName = 'snet-app'
var databaseSubnetName = 'snet-database'

resource publicIp 'Microsoft.Network/publicIPAddresses@2025-01-01' = if (enableNatGateway) {
  name: 'pip-${baseName}-egress'
  location: location
  tags: tags
  sku: { name: 'Standard', tier: 'Regional' }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource natGateway 'Microsoft.Network/natGateways@2025-01-01' = if (enableNatGateway) {
  name: 'ng-${baseName}'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    idleTimeoutInMinutes: 4
    publicIpAddresses: [{ id: publicIp.id }]
  }
}

resource network 'Microsoft.Network/virtualNetworks@2025-01-01' = {
  name: 'vnet-${baseName}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [addressPrefix] }
    subnets: [
      {
        name: appSubnetName
        properties: {
          addressPrefix: appSubnetPrefix
          natGateway: enableNatGateway ? { id: natGateway.id } : null
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
        }
      }
      {
        name: databaseSubnetName
        properties: {
          addressPrefix: databaseSubnetPrefix
          delegations: [
            {
              name: 'Microsoft.DBforPostgreSQL.flexibleServers'
              properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
            }
          ]
        }
      }
    ]
  }
}

resource databaseDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: databaseDnsZoneName
  location: 'global'
  tags: tags
}

resource databaseDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: databaseDnsZone
  name: 'link-${baseName}'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: network.id }
  }
}

output appSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', network.name, appSubnetName)
output databaseSubnetId string = resourceId(
  'Microsoft.Network/virtualNetworks/subnets',
  network.name,
  databaseSubnetName
)
output databasePrivateDnsZoneId string = databaseDnsZone.id
@description('The fixed outbound address when the NAT gateway is on, else empty. It is a public address, not a secret.')
output egressIpAddress string = enableNatGateway ? publicIp!.properties.ipAddress : ''
