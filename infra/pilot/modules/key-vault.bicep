// Key Vault for the few values that cannot be a Microsoft Entra token: today only an optional OIDC client
// secret (AUTH_ENTRA_CLIENT_SECRET), which the pilot does not use because the app proves itself to Entra
// with its managed identity. No secret value is ever written by a template: the vault is created empty,
// and a person puts a secret in it out of band (docs/production/runbook.md).
//
// - Azure RBAC authorization (no access policies), soft delete, purge protection.
// - The application identity gets Key Vault Secrets User on this vault: it can read secret values, and
//   nothing else (no keys, no certificates, no management).
// - useExistingVault = true uses a vault that already exists: this module is then deployed into ITS
//   resource group, only the role assignment is made, and the vault itself is not changed.
//
// Purge protection cannot be switched off again and keeps a deleted vault (and its name) for
// softDeleteRetentionInDays, which makes a throwaway pilot awkward to tear down. That is why
// main.bicep leaves the vault off unless asked.
targetScope = 'resourceGroup'

@description('Globally unique vault name: 3-24 letters, digits and hyphens, starting with a letter.')
@minLength(3)
@maxLength(24)
param vaultName string

param location string
param tags object

@description('True: the vault already exists in this resource group and is only read.')
param useExistingVault bool = false

@description('Days a deleted vault and its secrets can be recovered. Purge protection makes it also the minimum time before the name can be reused.')
@minValue(7)
@maxValue(90)
param softDeleteRetentionInDays int = 90

@description('Disabled blocks the public endpoint; it then needs a private endpoint, which this template does not create.')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Enabled'

@description('Resource ID of the identity that reads secrets. It seeds the role assignment name, which therefore does not depend on a value known only after the identity exists.')
param identityResourceId string

@description('Entra object ID of that identity.')
param principalId string

@description('Optional Log Analytics workspace that receives the vault audit log (who read which secret). Empty sends it nowhere.')
param auditWorkspaceResourceId string = ''

var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource created 'Microsoft.KeyVault/vaults@2025-05-01' = if (!useExistingVault) {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: softDeleteRetentionInDays
    enablePurgeProtection: true
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: publicNetworkAccess
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: vaultName
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identityResourceId, keyVaultSecretsUserRoleId)
  scope: vault
  properties: {
    principalId: principalId
    // Declaring the type avoids waiting for a just-created identity to replicate through Microsoft Graph.
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      keyVaultSecretsUserRoleId
    )
  }
  dependsOn: [created]
}

resource audit 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (!useExistingVault && !empty(auditWorkspaceResourceId)) {
  name: 'audit-to-workspace'
  scope: vault
  properties: {
    workspaceId: auditWorkspaceResourceId
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
  }
  dependsOn: [created]
}

output vaultName string = vault.name
@description('https://<vault>.vault.azure.net/ with the trailing slash. Not a secret.')
output vaultUri string = vault.properties.vaultUri
