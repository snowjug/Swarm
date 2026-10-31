# Pilot plan (proposal)

A proposal for sponsors to change. Nothing here is agreed. Numbers marked _proposed_ are starting
points to be settled **before** the pilot begins, not after seeing results.

## Question the pilot answers

Does a report that labels each statement by how well the team's own sources back it, flags
disagreements between sources, and declines to answer beyond the evidence, make a scenario brief
easier to trust and easier to review than the team's current method?

## Two ways to run it

| Option                                 | What it needs                                                                                                                                                                                                       | When it can start                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **A. Local pilot (recommended first)** | Each analyst runs Swarm on their own machine with `az login`, using the team's existing Azure OpenAI deployment. No hosting, no database, no app registration                                                       | As soon as the [decisions](./decisions-needed.md) and data approval are made |
| **B. Hosted pilot**                    | The first roadmap phase: an asynchronous repository and PostgreSQL, browser sign-in with a real Entra app registration, tracing, a per-tenant total on top of the per-project model budgets, hosting infrastructure | After that work; weeks, not days                                             |

Option A suits the product as it stands: it is local first, and documents leave the machine only for
the Azure OpenAI deployment in the team's own tenant. Option B should wait until Option A shows that
the evidence layer is worth hosting.

## Proposed scope for Option A

- One team, 5 to 10 analysts, about 8 weeks: 2 preparing, 4 using, 2 evaluating.
- 3 to 5 real scenarios per team, on documents the data owner has approved for use with the
  model.
- Each report reviewed by a person other than its author, using the ledger.

## What to measure

| Measure                                           | How                                                                                                | Proposed threshold                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Do reviewers agree with the support classes       | A reviewer rereads a sample of 50 statements and the cited passages                                | Agreement at least 80%                          |
| Are conflict candidates worth the reviewer's time | Confirmed over dismissed; plus conflicts reviewers found by hand that the detector missed          | Report both; no target until seen               |
| Does the analyst answer what it should not        | A reviewer asks 20 questions the sources cannot answer and counts replies that are not abstentions | Report the rate; set a ceiling with the sponsor |
| Time and trust                                    | Time to a reviewed brief against the current method; a short reviewer survey                       | Report both                                     |
| Cost                                              | Token counts per project (recorded by the product) against the [cost model](./cost-model.md)       | Within 2x of the estimate                       |
| Safety                                            | Any secret in a log, any document sent anywhere unapproved, any cross-user exposure                | None                                            |

## Exit criteria

- **Proceed to a hosted pilot** if the agreement and abstention measures meet thresholds the sponsor
  set in advance, with no safety event.
- **Fix and repeat** if the evidence layer helps but a measure fails, with the cause identified.
- **Stop** on any safety event, or if reviewers find the labels add effort without adding trust.

## Roles

A sponsor; a product owner; a data owner who approves documents; security, privacy, licensing and
Responsible-AI reviewers (see the [checklist](./human-review-checklist.md)); the pilot analysts; and
engineering.

## Before the pilot starts

The reviews that only people can pass, an approved document set, thresholds agreed in writing, and a
retention rule for the audit log if more than one person's identifier will be recorded.
