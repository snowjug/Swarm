// The two action groups that a monthly BUDGET notifies. Both e-mail the owner. Only the second also calls a webhook of
// the application that turns the FREE TIER OFF (POST /api/ops/free-tier/off, docs/public/DESIGN.md, section 6.6).
//
//  - warn: e-mail only, for the 50 and 80 percent notices and the forecast. A person reads it and decides.
//  - stop: e-mail and the webhook, for the 100 and 120 percent notices. It switches the free tier off by itself.
//
// A BUDGET ALERTS: IT DOES NOT STOP SPEND, and Azure's cost data arrives hours late, so this is the SECOND line of
// defence. The first is the application's own daily token and cost cap (FREE_GLOBAL_DAILY_TOKENS and
// FREE_GLOBAL_DAILY_COST_USD), which counts every model call as it is made and does not depend on Azure's billing.
// The webhook can only turn the free tier off, never on, and never reads anything: a person who learns the key can
// disable the free tier, not use it.
//
// The key is a secure parameter and is NOT an output. It has to be in the webhook address, because an action group
// cannot set a header, and Azure shows a webhook address to whoever can read the action group: keep that role narrow.
// A budget notification is not an Azure Monitor alert, so the common alert schema does not apply to either group.
targetScope = 'resourceGroup'

param baseName string
param tags object

@description('Who is e-mailed by both groups. At least one address.')
@minLength(1)
param emailAddresses array

@description('Host of the application the webhook calls: its default address, which does not depend on a custom domain or its certificate.')
param webhookHost string

@description('The key the webhook presents (?key=). The application stores only its SHA-256 (PUBLIC_OPS_KEY_SHA256). At least 32 characters; 64 hexadecimal characters from `openssl rand -hex 32` are URL-safe.')
@secure()
@minLength(32)
param opsKey string

var shortName = take(replace(baseName, '-', ''), 9)
var emailReceivers = [
  for (address, index) in emailAddresses: {
    name: 'owner-${index}'
    emailAddress: address
    useCommonAlertSchema: false
  }
]

resource warn 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${baseName}-budget-warn'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: '${shortName}wrn'
    enabled: true
    emailReceivers: emailReceivers
  }
}

resource stop 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${baseName}-budget-stop'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: '${shortName}stp'
    enabled: true
    emailReceivers: emailReceivers
    webhookReceivers: [
      {
        name: 'free-tier-off'
        serviceUri: 'https://${webhookHost}/api/ops/free-tier/off?key=${uriComponent(opsKey)}'
        useCommonAlertSchema: false
      }
    ]
  }
}

output warnActionGroupId string = warn.id
output stopActionGroupId string = stop.id
output warnActionGroupName string = warn.name
output stopActionGroupName string = stop.name
