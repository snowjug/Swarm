# Simulator benchmark

Time and memory of the population simulator ([engine.md](engine.md)) on casts of the size the
repeated-run analysis will use. These are measurements of the engine on one machine, not a promise
about any other, and not a result about any scenario.

## Machine and method

- 4-core laptop: 11th Gen Intel Core i7-1185G7 at 3.0 GHz (4 cores, 8 logical), 32 GB memory, Windows,
  Node 24.22.2. The machine was shared with other work during every measurement (CPU use by other
  processes was between 40% and 100%), so medians are more trustworthy than means, and batches are
  given as a range.
- Script: [`scripts/bench/simulate-bench.ts`](../../scripts/bench/simulate-bench.ts), run with
  `node node_modules/tsx/dist/cli.mjs scripts/bench/simulate-bench.ts [--actors N] [--members N] [--rounds N] [--runs N] [--batches N]`.
- The cast is built without randomness: a ring of cohorts that listen to their neighbours (relation
  strength 0.4), the last four being a competitor, a substitute, a regulator and a partner, each related
  to two cohorts. The change lands in round 2 at intensity 0.7. Seeds 1 to N, in batches, after 20
  warm-up runs; the heap is read after a forced collection.
- "Validated on every run" is `simulate`, which parses the spec with the schema each time. "Validated
  once" is `simulateValidated` on a spec parsed beforehand. "Without signals" is `signals: false`.

## Typical cast: 20 actors, 30 members each, 24 rounds

600 members, 14,400 member updates per run. Two runs of the script, 100 runs per batch, 5 batches each
(500 runs per case per script run); figures from the quieter run, with the range over both in brackets.

| Case                                            | One run, median        | One run, p95         | 100 runs, fastest batch | 100 runs, slowest batch |
| ----------------------------------------------- | ---------------------- | -------------------- | ----------------------- | ----------------------- |
| With signals and responders, validated each run | 2.46 ms (2.46 to 2.56) | 7.3 ms (7.3 to 17.4) | 277 ms (277 to 419)     | 387 ms (387 to 659)     |
| Without signals, validated each run             | 2.17 ms (2.07 to 2.17) | 7.5 ms (7.5 to 8.3)  | 228 ms (228 to 231)     | 472 ms (466 to 472)     |
| With signals, validated once                    | 1.48 ms (1.48 to 1.60) | 3.0 ms (3.0 to 5.6)  | 138 ms (138 to 175)     | 212 ms (212 to 280)     |

- The target was one run well under 10 ms and 100 runs under a second. At the median a run takes about
  2.5 ms and 100 runs about 0.3 s; in every one of the ten batches, 100 runs took under 0.7 s. The tail
  is contention: the p95 of a run was 7 ms in the quieter script run and 17 ms in the other.
- Throughput at the median is about 6 million member updates per second including drawing the members,
  validating and building the outcome, and about 9 million when validated once.
- The signals and responders cost about 0.3 ms of a run of this size (around an eighth).
- Validating the spec alone takes 0.5 to 0.6 ms for 20 actors: about a fifth of a run. A caller that
  runs one spec on many seeds saves that by calling `simulateValidated`.

Where a run's time goes, from timing the parts separately on a cast of this size: drawing the members
(about 0.8 ms: 200 truncated-normal samplers and 6,000 draws), the round loop (about 0.4 ms),
validation (0.5 ms) and the outcome and bookkeeping (the rest).

## Memory

| Measure                                           | 20 x 30 x 24                  | 60 x 200 x 36 |
| ------------------------------------------------- | ----------------------------- | ------------- |
| Heap retained after a batch and a collection      | 0.1 to 0.3 MB                 | 0.1 to 0.2 MB |
| Most the heap grew between collections in a batch | 8 to 16 MB                    | 16 to 32 MB   |
| One outcome as JSON                               | 41 KB (37 KB without signals) | 146 KB        |

A run holds its members in flat arrays of 8-byte values (seven per member) and keeps nothing after it
returns; the growth between collections is the garbage of the runs in the batch, not memory that stays.
The outcome is aggregates only, so its size depends on actors and rounds, not on the number of members.
An analysis that keeps many outcomes should keep what it needs from each: the stored artifact has a 2 MB
limit.

## Smallest cast: 8 actors, 20 members each, 8 rounds

160 members, 1,280 member updates per run; 100 runs per batch, 3 batches.

| Case                                            | One run, median | 100 runs, fastest batch | 100 runs, slowest batch |
| ----------------------------------------------- | --------------- | ----------------------- | ----------------------- |
| With signals and responders, validated each run | 0.78 ms         | 116 ms                  | 397 ms                  |
| Without signals, validated each run             | 0.57 ms         | 128 ms                  | 164 ms                  |
| With signals, validated once                    | 0.41 ms         | 51 ms                   | 145 ms                  |

## Largest cast the contract allows: 60 actors, 200 members each, 36 rounds

12,000 members, 432,000 member updates per run; 20 runs per batch, 3 batches. This is the upper bound,
not a cast anyone is expected to run many times.

| Case                                            | One run, median | One run, p95 | 20 runs, fastest batch | 20 runs, slowest batch |
| ----------------------------------------------- | --------------- | ------------ | ---------------------- | ---------------------- |
| With signals and responders, validated each run | 65 ms           | 97 ms        | 1.28 s                 | 1.49 s                 |
| Without signals, validated each run             | 68 ms           | 291 ms       | 1.22 s                 | 3.13 s                 |
| With signals, validated once                    | 43 ms           | 81 ms        | 0.93 s                 | 0.96 s                 |

A separate timing of a cast of the same size (60 actors, no relations) found 20 ms at best, validated
once, when the machine was quieter. At this size a run is tens of milliseconds, so 100 runs take roughly
2 to 7 seconds, well beyond the target for the typical cast. The cost is linear in members times rounds,
and `sampleSizeCap` is the lever: capping cohorts at 30 members cuts this cast's member updates from
432,000 to 64,800.

## What these numbers do not show

- Speed on other hardware, under load from a server, or with many runs in parallel. The simulator is
  single-threaded and holds no shared state, so runs can be spread over workers, but that was not
  measured.
- The cost of what surrounds a run in an analysis (comparing variants, findings, sensitivity, storing
  results).
- Any property of the results. The benchmark checks nothing about what the simulator says; the tests do.
