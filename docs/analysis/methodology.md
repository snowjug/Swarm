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

### Which findings the page shows first

The results page does not list forty findings at once. It reads them by how steady they are: the
repeatable ones, and the rare ones that matter, first; then the mostly repeatable; then the unstable;
and last the rare ones that do not matter. Within each group it keeps the order above, which puts
the change before its alternatives. A rare finding matters when it is about what a change might set
off (an adverse threshold being crossed, or a follow-on event) under a scenario that is not the
baseline: how seldom the threshold was crossed, even never, is what the comparison was asked to find
out. A rare ordering, and anything under the baseline (which is only the reference), do not. The first
8 are shown, each as its statement, its class and how many runs it held in (with the interval), and
the rest are under "Show all N findings", in the same form and the same order. Nothing is left out or
changed: only the first screen is shorter.

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
rows are kept: sensitive ones first, then by size of shift. The page shows the first 6, with the rest
under "Show all N assumptions" on the same scale, and the table beside the chart has every row.

Cost is bounded: at most 38 moves, each on at most 30 seeds (the first seeds of the main runs), so at
most 1,140 extra runs. Sensitivity can be turned off. **Not explored:** moving two assumptions
together, assumptions of actors outside the four most influential, and anything about the rules of the
engine itself.

## What the results say first

Above everything else the page gives three lines, made only of what the comparison already states:

1. which scenarios were compared, and how many seeded runs of each, on the same seeds;
2. the finding that states the direction of the proposed change against the baseline, word for word;
3. whether that finding is repeatable: its class, how many runs it held in and its interval.

Nothing is added to the findings, and there is no number in these lines that a finding does not already
give. Where no finding sets the proposed change against the baseline, the second line says so. Where
the change cannot move anyone (below), there is no direction to state, and the lines say that instead
and do not call anything repeatable.

## A change that cannot move anyone

A change can move a simulated member only through an actor's `impact`: how it is expected to land on
them. The engine reads it from the actor, or from the scenario if the scenario sets its own for that
actor. When no stakeholder has been given an expected direction of impact, every actor's `impact` is 0, and
a scenario with any intensity still changes nothing. Every difference from no change is then noise, and a
comparison reports that noise faithfully: "30 of 30 runs about the same", and sensitivity rows of a few
thousandths that look robust only because there was nothing to move. A person could read that as a
result.

`changeCanMoveAnyone(actors, variants)` in [shared/signal.ts](../../shared/signal.ts) says whether the
declared assumptions give a change any way to move anyone: some scenario other than the baseline has an
intensity above 0, and some actor's impact (or the scenario's override of it) is not 0. The comparison
uses it twice, and refuses nothing:

- **Before running.** The list route's `readiness.warnings` holds the shared notice
  (`NO_DIRECTION_NOTICE`) when the suggested scenarios fail it, and is empty otherwise and before the
  actors exist. The page shows it above the button that starts a comparison, with the way to the
  stakeholder review where a direction is given. The comparison is still allowed: a comparison with no
  change is a fair test of how much the simulation varies by chance.
- **After running.** The same test on the comparison's own cast and scenarios. When it fails, the same
  notice is the first thing in the results, the three lines above say that nothing can move, and a
  sensitivity row that would have been called `robust` reads "No effect to test" (neutral, not green)
  with the explanation that this is not evidence that the result is robust. Rows that did move are
  reported as they are.

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
- **Time, said before running.** The screen says how long a comparison will take, from the engine's
  measured speed and not from any assumed one: 2 to 3 ms for a run of the typical cast of the
  [engine benchmark](./engine-benchmark.md) (600 simulated members over 24 rounds), multiplied by
  `members × rounds / 14,400` for a cast with more member updates than that, and never less, because
  what a run costs apart from its members does not shrink with them. The estimate is the runs of the
  comparison (sensitivity included) times that, said in whole seconds, rounded outwards ("about 2 to 4
  seconds"), with one line under it saying where the speed comes from. It was checked against whole
  comparisons on the real engine, with the summaries, findings and sensitivity around the runs:

  | Cast                                 | Simulated members | Rounds | A run, in a whole comparison                 |
  | ------------------------------------ | ----------------- | ------ | -------------------------------------------- |
  | Copilot in Teams example, rules mode | 334 (25 actors)   | 12     | 2.7 and 3.2 ms (1,201 runs: 3.3 s and 3.8 s) |
  | 8 actors of 20 members               | 160               | 12     | 0.64 to 0.69 ms                              |
  | 20 actors of 30 members              | 600               | 12     | 1.5 to 2.1 ms                                |
  | 20 actors of 30 members              | 600               | 24     | 2.4 ms                                       |
  | 60 actors of 200 members             | 12,000            | 12     | 17 to 18.5 ms                                |

  These are timings on one shared laptop, and they move with what else it is doing: the same cast took
  up to 4.5 ms a run when the CPU was fully busy. The estimate is a guide to the order of magnitude. A
  cast smaller than the typical one is counted at the typical speed, which overstates it (the 8-actor
  cast above took about a third of that); one that is much larger is counted in proportion, which is
  close at 12 rounds and overstates it at 36. When the actors are not known the screen gives no time.

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
| GET    | `/api/projects/:id/analysis`             | The saved comparisons (summaries, newest first) and what the next one would use (`readiness`: the actors, the suggested scenarios, `warnings`, whether the caller may run). 200 with an empty list for a project that has never run one. `read`.                                          |
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
