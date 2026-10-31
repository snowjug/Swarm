# Engineering note: moving workloads out of Region R

_Illustrative synthetic note; figures invented for demonstration; not information from or about any real company._

## What the engineers looked at

Platform engineers reviewed what it would take to run part of the Region R footprint in Region S, or with another provider, if the price change made that worth considering. This is a working note and not a plan.

## Effort and constraints

The platform team estimates that moving the service's workloads out of Region R would take 9 engineer-months. Most of that is data replication, testing and a staged cut-over. Latency for retail customers in the Region R jurisdiction would rise for any workload moved to Region S. Eleven customers have contracts naming that jurisdiction as the place where their data must stay, so their workloads could not move without each customer's agreement. The security team notes that a second provider would need its own review, and reviews of earlier suppliers took about five months.

## Capacity and risk

Region S has less spare capacity for the service than Region R, so a quota increase would have to be requested, and the provider's response time is unknown. Engineers also worry about running two replicas of the same data for a long period, because disaster-recovery tests would then have to cover two setups instead of one. Support engineers expect more incidents during any cut-over, especially for customers on shared accounts.

## What the engineers do not know

They have not tried another provider's equivalent service with the company's data volumes. They do not know whether the provider would change prices in Region S next. They have no estimate of how many customers would object to a move, because the sales team has not been asked.
