import type { ExampleScenario } from '../example-scenarios.js';
import { sampleDocument } from './sample-document.js';

export const regionalPriceChange: ExampleScenario = {
  id: 'regional-price-change',
  title: 'Regional cloud price change',
  blurb:
    'A one-dollar price rise for one cloud service in one region: a software company weighs its costs, contracts and migration options while the notice leaves the billing unit open.',
  question:
    'What could happen if AWS increases the price of a particular cloud service by $1 in a selected region?',
  documents: [
    sampleDocument(
      '01-finops-brief.md',
      'Illustrative synthetic FinOps working brief',
      `# FinOps working brief: a one-dollar increase for one managed service in one region

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

## Premise

This brief assumes a hypothetical change: AWS raises the price of one managed database service by $1 in a single region, called Region R here. The service, the region, the prices and the company are invented for the exercise. Nothing here is a real price list, a real notice or a real customer. The company is a software-as-a-service business with about 310 employees that sells analytics to retailers.

## Where the company stands

Most customer-facing workloads run in Region R because several customers require their data to stay in that jurisdiction. A smaller secondary footprint sits in Region S. Cloud costs are about 19% of annual revenue, and the service accounts for roughly a third of the cloud bill.

Finance counts fixed-price contracts as covering 38% of annual recurring revenue. The other contracts allow re-pricing at renewal, some with caps. Customers on monthly plans, mostly small retailers, can leave with 30 days' notice.

## Who is already asking questions

The head of finance wants a range for the annual cost and a view on whether the company's committed-spend discount would apply to the increase. Engineering managers have been asked whether workloads could run in Region S or with another provider, and at what effort. The sales director is concerned about customers that renewed at fixed prices last quarter. Customer success managers say small retailers react quickly to any price change. The audit committee of the board has asked for a written note on supplier concentration, and the external auditors have raised the same point. The company's cloud reseller has offered a call about commitment options.

## Open at the time of writing

The notice, as relayed by the reseller, says one dollar more without a billing unit, an effective date or a scope. Finance has assumed per capacity block per month. Nobody has confirmed that with the provider.
`,
    ),
    sampleDocument(
      '02-usage-and-spend-summary.md',
      'Illustrative synthetic usage and spend summary',
      `# Usage and spend summary: the managed service by region

_Illustrative synthetic summary; figures invented for demonstration; not information from or about any real company._

All figures are invented and rounded. The billing unit is a capacity block per month. The list price in Region R is an illustrative figure of $9 per block-month, and the price in Region S is an illustrative $8.

## Monthly usage

- Region R: 18,400 block-months, of which 11,500 serve customers whose contracts set data-residency terms.
- Region S: 6,100 block-months, mostly disaster-recovery copies and a pilot environment for new customers.
- Usage in Region R grew 3% a month over the last four quarters.

## Cost at list price

- Region R: $165,600 a month.
- Region S: $48,800 a month.
- A $1 increase in Region R would add $18,400 a month at list price, or $220,800 a year, before any discount.
- A committed-spend agreement gives 18% off list. The agreement summary the company holds does not say whether the discount would apply to an increase.

## Margin context

Gross margin on the analytics product is 71%, and investors and the board follow it each quarter. Customers on monthly plans pay $480 a month on average and make up 22% of customers but 9% of recurring revenue.

## Notes on quality

Usage counts come from billing exports for the last full month. Region S includes a temporary load test of about 600 block-months that is not expected to repeat. Reserved-capacity purchases are reported separately and are not in these numbers.
`,
    ),
    sampleDocument(
      '03-engineering-migration-note.md',
      'Illustrative synthetic engineering migration note',
      `# Engineering note: moving workloads out of Region R

_Illustrative synthetic note; figures invented for demonstration; not information from or about any real company._

## What the engineers looked at

Platform engineers reviewed what it would take to run part of the Region R footprint in Region S, or with another provider, if the price change made that worth considering. This is a working note and not a plan.

## Effort and constraints

The platform team estimates that moving the service's workloads out of Region R would take 9 engineer-months. Most of that is data replication, testing and a staged cut-over. Latency for retail customers in the Region R jurisdiction would rise for any workload moved to Region S. Eleven customers have contracts naming that jurisdiction as the place where their data must stay, so their workloads could not move without each customer's agreement. The security team notes that a second provider would need its own review, and reviews of earlier suppliers took about five months.

## Capacity and risk

Region S has less spare capacity for the service than Region R, so a quota increase would have to be requested, and the provider's response time is unknown. Engineers also worry about running two replicas of the same data for a long period, because disaster-recovery tests would then have to cover two setups instead of one. Support engineers expect more incidents during any cut-over, especially for customers on shared accounts.

## What the engineers do not know

They have not tried another provider's equivalent service with the company's data volumes. They do not know whether the provider would change prices in Region S next. They have no estimate of how many customers would object to a move, because the sales team has not been asked.
`,
    ),
    sampleDocument(
      '04-sales-contracts-and-customers-note.md',
      'Illustrative synthetic sales operations note',
      `# Sales operations note: contracts, renewals and customer reactions

_Illustrative synthetic note; figures invented for demonstration; not information from or about any real company._

## Contracts

Sales operations counts fixed-price contracts as covering 55% of annual recurring revenue. That count includes contracts that renew within the next twelve months, which finance treats as variable. Pass-through clauses, which let the company raise prices after a supplier increase, exist in a minority of contracts, and some require 60 days' notice. Public-sector customers and large retailers negotiate renewals through procurement teams and usually ask for a written justification of any rise.

## How customers reacted before

Two years ago the company raised list prices for monthly plans by 6%. Customer success managers recall that cancellations in the following quarter were higher than usual, but nobody separated the effect of the price rise from a product outage in the same month. Large customers rarely cancelled over a price rise; they asked for discounts or extra services.

## Competitors

Three rival analytics vendors sell to the same retailers. Sales staff report that two of them advertise price locks of 12 to 24 months. Whether those vendors run on the same cloud provider, and whether they would absorb a cost rise, is not known. Small retailers also compare the product with spreadsheet reporting and with free tools that cover part of the need.

## Partners

Implementation partners who resell the product keep 15% of subscription revenue. They have said they would be unwilling to explain a price rise to their own clients without notice.
`,
    ),
    sampleDocument(
      '05-notice-as-relayed-and-gaps.md',
      'Illustrative synthetic note on the relayed notice and what is missing',
      `# The notice as relayed, and what is not known

_Illustrative synthetic note; figures invented for demonstration; not information from or about any real company._

## What the company has

The only document is a short message from the company's cloud reseller. It says that the provider is raising the price of the service in Region R by one dollar and that details are to follow. It gives no effective date, does not say whether committed-spend agreements or reserved capacity are affected and does not name the billing unit for the one-dollar figure. It does not say whether other regions would follow. The reseller's account manager described the change as modest and offered a call about commitment options.

## Two estimates of moving

The platform team's estimate of the work is in the engineering note. A consultancy that has offered migration services estimates that moving the service's workloads out of Region R would take 4 engineer-months. The consultancy would earn fees from the work.

## Differences in reading the notice

Finance reads the one-dollar figure as per capacity block per month. An engineering lead, reading the same message, assumed it applied only to the largest configurations of the service, which would touch fewer workloads.

## What this pack does not contain

There is no price history for the provider in this region, so nobody can say how often prices have moved before or by how much. There is no information on what other customers of the provider are doing or what rival cloud providers charge for similar services in the same region. No regulator has commented. The company has not asked its customers how they would respond to a price change passed on to them, and has not discussed the change with the partners that resell its product.
`,
    ),
  ],
};
