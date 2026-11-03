// A monthly cost budget on the pilot's resource group, with e-mail notifications at 50, 80 and 100 percent
// of ACTUAL cost and at 100 percent of FORECAST cost.
//
// A budget is an ALERT, not a cap. Azure Cost Management evaluates it a few times a day on cost data
// that is itself hours behind, nothing is stopped or deleted when a threshold is crossed, and spending
// continues. The only things that limit spend are what the templates leave out, the application's own
// per-project model budget, a subscription spending limit where one exists, and a person who acts on
// the e-mail. docs/production/azure-preflight.md has the numbers and the "stop if" rules.
targetScope = 'resourceGroup'

param baseName string

@description('The budget for one month, in the BILLING currency of the subscription. The resource has no currency property: Azure reads this number in the currency the subscription is billed in, so check it against the billing currency before relying on it.')
@minValue(1)
param amount int

@description('The currency the amount is meant in. It is NOT sent to Azure; it is written into the notification names and the output so that a reader cannot take INR for USD.')
@maxLength(3)
@minLength(3)
param currencyLabel string = 'INR'

@description('First day of the month the budget starts, as yyyy-MM-01T00:00:00Z. The default is the current month; Azure rejects a start date in a past month.')
param startDate string = '${utcNow('yyyy-MM')}-01T00:00:00Z'

@description('People who receive the notifications. At least one.')
@minLength(1)
param contactEmails array

@description('Percent of the budget, actual cost, that triggers each notification.')
param actualThresholds array = [50, 80, 100]

@description('Percent of the budget, forecast cost, that triggers a notification. 0 turns the forecast notification off.')
@minValue(0)
@maxValue(1000)
param forecastThreshold int = 100

var actualNotifications = toObject(
  actualThresholds,
  threshold => 'Actual_GreaterThan_${threshold}_Percent_${currencyLabel}',
  threshold => {
    enabled: true
    operator: 'GreaterThan'
    threshold: threshold
    thresholdType: 'Actual'
    contactEmails: contactEmails
    locale: 'en-us'
  }
)

var forecastNotifications = forecastThreshold == 0
  ? {}
  : {
      'Forecasted_GreaterThan_${forecastThreshold}_Percent_${currencyLabel}': {
        enabled: true
        operator: 'GreaterThan'
        threshold: forecastThreshold
        thresholdType: 'Forecasted'
        contactEmails: contactEmails
        locale: 'en-us'
      }
    }

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'budget-${baseName}'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: union(actualNotifications, forecastNotifications)
  }
}

output budgetName string = budget.name
output budgetAmount string = '${amount} ${currencyLabel}'
