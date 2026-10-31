# Comparing scenarios: method, limits and what the numbers mean

A comparison runs a baseline (nothing changes), the proposed change and its alternatives, each many
times on the same seeds, and reports how the outcomes spread, which statements about them hold
repeatedly, which declared assumptions the result is sensitive to, and how far the whole exercise can
be relied on. It is built on the `Simulator` type in [shared/analysis.ts](../../shared/analysis.ts);
the engine behind that type is injected, so everything here holds for any simulator that returns the
same outcome for the same specification and seed.

Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior. Every
number below is a count of simulated members or of seeded runs. None is a rate of anything real, and
none is a probability that something will happen.

## What a comparison does

1. **Scenarios.** `variants: 'auto'` is a baseline (intensity 0), the "Proposed change" (intensity 0.7,
   landing in round 2) and one scenario for each alternative the project's scenario names (intensity
   0.5, round 2). How strongly a change lands is not stated by the scenario, so these intensities are
   system assumptions; each description says so, and a person can edit them before running. When they
   do, the description is rewritten to say that the intensity "was set by you".
2. **Seeds.** Run `i` of every scenario uses the seed `baseSeed + i`. The same seeds are used for every
   scenario, so the runs can be paired: a run of the change shares its randomness with the run of the
   baseline that has the same seed, and a difference between them is the effect of the change and not
   of two unrelated draws. `baseSeed` defaults to the project's own seed setting. The runs go one seed
   at a time across all scenarios, so a comparison that is stopped part way has the same seeds in each.
3. **Runs.** Each run is simulated by the injected engine, and its end state, the overall mean stance at
   each round and the kinds of event that occurred are kept while the runs are in memory.
4. **Results.** When the runs are done: trajectory bands, findings, sensitivity, one representative run
   in full, the fidelity statement and the cost. A single run is never presented as the answer.

## What is kept

For every seeded run: its seed, the overall final stance, the overall final response shares and, for
each actor, its members, final stance and response shares (rounded to four decimals). Events are
counted per kind while the runs are in memory and then discarded; only the representative run keeps
its events.

A document may not exceed 2,000,000 bytes (`MAX_ARTIFACT_BYTES`). When the per-actor results of every
run would take it past 90% of that, the per-run `byActor` lists are left empty, the per-actor totals
over the runs of each scenario (`variants[].actors`) are kept, and a caveat says so. Every finding
was counted from the full results before this was done. For 200 runs of 8 scenarios of 60 actors the
document stays under the limit.

## Findings

A finding is a statement that is either true of a seeded run or not. Each carries the statement in
words, the test applied to every run (`predicate`), how many runs it held in (`holdsIn` of `of`), a
95% Wilson interval for that share, and a class (below). There is no score. Statements count
simulated members and seeded runs, for example: "In 27 of 30 seeded runs, the largest group of
simulated members of Subscribers ended up looking for an alternative or resisting under Proposed
change."

| Kind                    | True of a run when                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `majority-response`     | The largest of four response groups of an actor's members is the stated one (switch or resist, adapt, wait, or adopt or accept with conditions). Ties go to the more adverse group. The stated group is the one that was largest in most runs.       |
| `direction-vs-baseline` | The overall final stance is lower (or higher, or within 0.01) than under the baseline **on the same seed**. The direction tested is that of the mean paired difference. A difference under 0.01 on the scale from -1 to 1 is not called a direction. |
| `threshold-crossing`    | At some round, the share of all simulated members (each actor weighted equally) in switch or resist reached 30%. The threshold is a parameter of the generator, stated in the predicate.                                                             |
| `ordering`              | An actor had the least favourable change in stance against the baseline of the same seed (the first); and the three actors with the least favourable changes were the same three in the same order.                                                  |
| `second-order-event`    | At least one event of a kind (for example "counter-move") occurred in the run. The statement also gives how many baseline runs had it.                                                                                                               |

At most 40 findings are kept, most important first: comparisons with the baseline, then thresholds,
orderings, events and last the response of each actor; within a kind the change before its
alternatives, then the more repeatable first.

## Repeatability: the Wilson interval and the classes

For a finding that held in `x` of `n` runs, with `p = x / n` and `z = 1.96`:

```text
centre = (p + z²/2n) / (1 + z²/n)
half   = z · sqrt( p(1 − p)/n + z²/4n² ) / (1 + z²/n)
interval = [centre − half, centre + half]
```

The Wilson interval is used because, unlike the usual normal approximation, it stays inside 0 to 1 and
is not a single point at 0 of n or n of n, which is where a small number of runs often puts a finding.
It is checked in the tests against values worked out by a different route (solving the quadratic that
defines it) and against published tables, for example 27 of 30 gives 74% to 97%.

| Class               | When                                 |
| ------------------- | ------------------------------------ |
| `repeatable`        | the lower bound is 0.80 or more      |
| `mostly-repeatable` | the lower bound is 0.50 or more      |
| `rare`              | the upper bound is below 0.20        |
| `unstable`          | none of the above: the runs disagree |

The order of the tests is as listed. With fewer than 10 runs a finding is never called above
`mostly-repeatable`, and the comparison says so in its caveats. (At 95%, no count of fewer than 16
runs reaches a lower bound of 0.80 anyway; the rule is kept explicit so that it does not depend on
that arithmetic.)

What the cut-offs mean in runs, for 95% intervals:

| Seeded runs | `repeatable` when it holds in at least    | `mostly-repeatable` when at least | `rare` when at most |
| ----------- | ----------------------------------------- | --------------------------------- | ------------------- |
| 10          | never (10 of 10 has a lower bound of 72%) | 9                                 | never               |
| 16          | 16                                        | 12                                | 0                   |
| 30          | 29                                        | 21                                | 1                   |
| 50          | 46                                        | 32                                | 4                   |
| 100         | 88                                        | 60                                | 12                  |
| 200         | 172                                       | 114                               | 28                  |

The cut-offs are conventions chosen to be easy to read: "repeatable" says that even the cautious end of
the interval is four runs in five; "mostly repeatable" that it is at least half; "rare" that even the
generous end is under one in five. They are not derived from anything in the world, which is why the
interval is always shown beside the class and a reader may apply a stricter bar of their own.

**What they do not mean.** They measure how steady a statement is under the simulation's own seeded
randomness. They do not measure how likely the statement is to be true of the world, how accurate the
model is, or how well the assumptions were chosen. A finding can be repeatable and wrong, because
every run shares the same assumptions; sensitivity (below) is what shows how much the result depends
on them.

## Sensitivity

One declared assumption of the proposed change (the first alternative) is moved at a time and the
**same seeds** are run again, so each perturbed run is compared with the unperturbed run of its own
seed (common random numbers). What is moved:

- for the four most influential actors, `impact`, `sensitivity`, `switchingCost` and `trust`, each by
  +0.2 and -0.2 and then clamped to the trait's scale (a move that clamping makes into nothing is left
  out);
- the intensity of the proposed change, by +25% and -25% of itself;
- for the two most influential cohorts, how varied their members are (the spread of every trait,
  doubled and halved).

The headline measure is **the overall share of simulated members ending in switch or resist**, each
actor weighted equally. For each move: `shift` is the mean over the seeds of (perturbed − unperturbed),
and `standardError` is the standard deviation of those paired differences divided by √n.

| Class                  | When                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `assumption-sensitive` | \|shift\| is more than 2 standard errors and at least 0.05   |
| `robust`               | \|shift\| is under 0.02 and the standard error is under 0.01 |
| `inconclusive`         | otherwise                                                    |

Each row records where the moved assumption came from (`assumptionOrigin`): a trait's own origin
(evidence, user, system assumption or model), "system assumption" for a spread, and for the intensity
"system assumption" unless the scenario says it was set by the person. A sensitive assumption that no
evidence backs is highlighted, because it is where a result rests on a guess. The twelve most telling
rows are kept: sensitive ones first, then by size of shift.

Cost is bounded: at most 38 moves, each on at most 30 seeds (the first seeds of the main runs), so at
most 1,140 extra runs. Sensitivity can be turned off. **Not explored:** moving two assumptions
together, assumptions of actors outside the four most influential, and anything about the rules of the
engine itself.

## Spread over rounds, and the representative run

For each scenario and round, the 10th, 50th and 90th percentiles (linear interpolation between the
closest ranks) of the overall mean stance over the seeded runs. The chart draws the band from the 10th
to the 90th and the median line, and has a table beside it.

The representative run is the run whose overall final stance is nearest the median under the proposed
change (the lowest seed when two are as near). The engine is deterministic, so it is simulated once
more from that seed to keep its full detail: events with what each followed from, so that a chain can
be read as "because ..., then ...". The findings, not this one run, say how often each kind of event
occurred.

## Fidelity, cost and the cross-check

- **Fidelity.** `engine: rules`, `keyActors: rules`, `cohorts: rules`, `modelRepeats: 0`. Outcomes are a
  mechanical consequence of the declared assumptions; no model decided any actor's behaviour; and
  run-to-run variation of a model is not measured (the deep-dive model run is separate). The caveats
  also say which seeds were used and that repeatability describes the randomness of the runs.
- **Cost.** Every simulated run (including sensitivity and the repeated representative run), the
  simulated members and the wall time. Model calls and tokens are 0.
- **Cross-check.** When the project also has a completed deep-dive run, the comparison says whether
  that run's final mean stance lies within the 10th to 90th percentile of the proposed change's final
  round. The two use different engines, so being inside is a plausibility check and not a validation,
  and being outside means the two read the same assumptions differently.

## Limits, storage and failure

| Limit                            | Value                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Seeded runs for each scenario    | 3 to 200 (10, 30 or 100 in the screen)                                                                  |
| Scenarios                        | 2 to 8: exactly one baseline and at least one alternative                                               |
| Rounds                           | 3 to 36; 12 unless the request says otherwise                                                           |
| Simulated runs in one comparison | 2,400 at most, sensitivity included; a larger request is refused with a message saying how to shrink it |
| Comparisons running              | one for a project, two for the server                                                                   |
| Comparisons started              | 6 a minute (the rate limit of the route)                                                                |
| Comparisons kept for a project   | 12; the oldest finished ones are removed beyond that                                                    |

A comparison runs in the server process after the answer to the request is sent, gives the event loop
a turn after every run, and saves its progress every few runs. It can be stopped between runs. Statuses:
`running`, `completed`, `cancelled` (stopped by a person; nothing is shown from a partial comparison,
because its scenarios would not all have the same seeds), `failed` (with the reason) and `interrupted`.

When the server starts, every comparison still marked `running` or `queued` is marked `interrupted`, and
a server that is stopping marks what it is running the same way. An interrupted comparison says that it
can be reproduced exactly from its seeds and can be run again with the same settings. This assumes a
single server instance, as in [ADR 0009](../adr/0009-postgres-through-a-synchronous-bridge.md): a
second instance starting would mark the other's running comparison as interrupted.

## Routes

| Method | Path                                     | Behavior                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/projects/:id/analysis`             | The saved comparisons (summaries, newest first) and what the next one would use (`readiness`). 200 with an empty list for a project that has never run one. `read`.                                                                                                                       |
| GET    | `/api/projects/:id/analysis/:aid`        | One comparison in full. 404 `ANALYSIS_NOT_FOUND` for another project's. `read`.                                                                                                                                                                                                           |
| POST   | `/api/projects/:id/analysis`             | Starts one: `{ runsPerVariant?, baseSeed?, variants?: 'auto' \| Variant[], sensitivity?, rounds? }`. 202 with the comparison as `running`. 409 `ACTORS_REQUIRED` without an `actors` artifact, 409 `ANALYSIS_RUNNING`, 429 `ANALYSIS_BUSY`, 400 for a request that is not allowed. `run`. |
| POST   | `/api/projects/:id/analysis/:aid/cancel` | Asks a running comparison to stop at its next run. 202; 409 `ANALYSIS_NOT_RUNNING` when it is not running. `run`.                                                                                                                                                                         |

Audit entries `analysis.started` (the comparison's id, scenario count, runs for each scenario, planned
runs, whether sensitivity was asked for) and `analysis.cancelled` (id and runs done) hold identifiers
and counts only: never a scenario's name or description.

## What this does not do

- It does not say what will happen. It counts what happened in simulated runs of declared assumptions.
- It does not measure the variation of a model, because no model decides anything here.
- It does not validate the engine against real outcomes. Backtesting is a separate piece of work that
  has not been built.
- Its sensitivity is one assumption at a time, on a subset of actors, on the first 30 seeds.
- It does not run more than one comparison at once for a project, and it does not resume an
  interrupted one: it runs it again.
