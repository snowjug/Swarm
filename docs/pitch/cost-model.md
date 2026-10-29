# Cost model

An estimate, not a quote. It multiplies token counts **measured** in live runs by **public list
prices**. Your price may differ (an enterprise agreement, provisioned throughput, a different model
or region). Replace the two prices below with yours and the rest follows.

## Assumptions

| Input                    | Value                                                                                                                                                                 | Source                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Model                    | A GPT-4.1 mini class chat model, pay-as-you-go, Global Standard                                                                                                       | The development deployment                                                                               |
| Input price              | US$0.40 per million tokens                                                                                                                                            | Public list price from price aggregators; **not** checked against the Azure pricing page or an agreement |
| Output price             | US$1.60 per million tokens                                                                                                                                            | As above                                                                                                 |
| Tokens per live scenario | 95,154 / 13,376 (baseline), 120,948 / 17,327 (after the chat change), 105,274 / 14,431 and 103,501 / 15,807 (final tree, before and after the review fixes), in / out | `npm run azure:verify`; see [evaluation results](./evaluation-results.md)                                |

## One scenario

The live scenario is four proxies, two platforms, three rounds, a branch, a report with a grounding
review, and both chats. At the assumed prices:

| Run                                 | Input cost | Output cost | Total    |
| ----------------------------------- | ---------- | ----------- | -------- |
| Baseline                            | US$0.038   | US$0.021    | US$0.060 |
| After the chat change               | US$0.048   | US$0.028    | US$0.076 |
| Final tree, before the review fixes | US$0.042   | US$0.023    | US$0.065 |
| Final tree, after the review fixes  | US$0.041   | US$0.025    | US$0.067 |

About **six to eight US cents**. The spread between runs is model variation (retries, report
length) as much as any change in the product. With one run per condition the effect of the evidence layer
on cost cannot be separated from that noise. What the layer adds is bounded: the analyst prompt carries
at most 40 statements and a handful of conflicts, which is small next to the simulation's calls.

A larger scenario costs more roughly in proportion to proxies x rounds x platforms. The Azure guide
estimates six proxies over eight rounds on both platforms at about 300,000 tokens. Taking the input
share seen in the live runs (about 88%), that is of the order of **US$0.15 to US$0.20**. It is an
extrapolation, not a measurement; only six proxies and six rounds were exercised live.

## A local pilot (Option A in the [pilot plan](./pilot-plan.md))

Ten analysts, five scenarios each, four runs per scenario (iterating on assumptions), at US$0.20 a
run is **about US$40** of model usage, with no hosting. Even at ten times the estimate it is in the
hundreds of dollars. The limit that matters more is time: the development deployment's quota is
100,000 tokens per minute, and the final live run took six minutes for a small scenario because the
model's latency varied.

## A hosted pilot (Option B)

Not estimated. It needs the Azure Pricing Calculator once the hosting design is approved. Expect it to
be dominated by always-on components (the application and a PostgreSQL server) at the smallest
sizes, in the tens of US dollars per month, not by model usage; that is an order-of-magnitude judgement
and not a price. Nothing in this repository provisions any of them, and no chargeable resource was
created for this program.

## Cost controls that exist, and what is missing

| Control                                        | Status                                   |
| ---------------------------------------------- | ---------------------------------------- |
| Token and call counts recorded per project     | Built and tested                         |
| A call budget per operation                    | Built                                    |
| A 15-minute budget per run                     | Built                                    |
| A rate limiter and a per-tenant project limit  | Built                                    |
| A per-tenant token budget and a spend alert    | **Not built**                            |
| A scheduled model-in-the-loop regression suite | **Not built**; it would need its own cap |
