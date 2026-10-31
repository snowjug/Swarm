# Simulator benchmark

Time and memory of the population simulator ([engine.md](engine.md)) on casts of the size the
repeated-run analysis will use. These are measurements of the engine on one machine, not a promise
about any other, and not a result about any scenario. They were taken on the engine as recalibrated
(relaxation toward an anchored stance); the recalibration did not change the cost of a run noticeably.

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
(500 runs per case per script run); each cell gives the range over the two. A third, earlier run, made
while other processes kept the CPU 97% to 99% busy, is mentioned below.

| Case                                            | One run, median | One run, p95  | 100 runs, fastest batch | 100 runs, slowest batch |
| ----------------------------------------------- | --------------- | ------------- | ----------------------- | ----------------------- |
| With signals and responders, validated each run | 1.85 to 2.24 ms | 3.2 to 5.2 ms | 168 to 231 ms           | 252 to 341 ms           |
| Without signals, validated each run             | 1.92 to 2.10 ms | 3.9 to 4.1 ms | 177 to 220 ms           | 262 to 352 ms           |
| With signals, validated once                    | 1.57 to 1.94 ms | 3.5 to 4.5 ms | 167 to 208 ms           | 241 to 294 ms           |

- The target was one run well under 10 ms and 100 runs under a second. At the median a run takes about
  2 ms (2.4 ms in the loaded run) and 100 runs about 0.2 to 0.3 s; in every one of the ten batches of
  every case, 100 runs took under 0.36 s. The tail is contention: the p95 of a run was 3 to 5 ms.
- Throughput at the median is about 6 to 8 million member updates per second including drawing the
  members, validating and building the outcome, and about 7 to 9 million when validated once.
- The signals and responders cost about 0.3 ms of a run of this size. The two script runs put the
  difference at -0.3 and +0.3 ms (in the first, the case with signals was the faster), so it is inside
  the noise of this machine; timing the parts separately (below) gives 0.3 ms.
- Validating the spec alone takes 0.55 to 0.63 ms for 20 actors: about a quarter of a run. A caller that
  runs one spec on many seeds saves that by calling `simulateValidated`.

Where a run's time goes, from timing the parts separately on a cast of this size: drawing the members
(about 0.6 ms: 200 truncated-normal samplers and 6,000 draws), the round loop (about 0.2 ms), the
aggregates of each round and the outcome (about 0.3 ms), the signals and responders (about 0.3 ms) and
validation (0.6 ms).

## Memory

| Measure                                           | 20 x 30 x 24                  | 60 x 200 x 36 |
| ------------------------------------------------- | ----------------------------- | ------------- |
| Heap retained after a batch and a collection      | 0.1 to 0.2 MB                 | 0.1 to 0.2 MB |
| Most the heap grew between collections in a batch | 8 to 16 MB                    | 16 to 32 MB   |
| One outcome as JSON                               | 41 KB (37 KB without signals) | 145 KB        |

A run holds its members in flat arrays of 8-byte values (nine per member) and keeps nothing after it
returns; the growth between collections is the garbage of the runs in the batch, not memory that stays.
The outcome is aggregates only, so its size depends on actors and rounds, not on the number of members.
An analysis that keeps many outcomes should keep what it needs from each: the stored artifact has a 2 MB
limit.

## Smallest cast: 8 actors, 20 members each, 8 rounds

160 members, 1,280 member updates per run; 100 runs per batch, 3 batches.

| Case                                            | One run, median | 100 runs, fastest batch | 100 runs, slowest batch |
| ----------------------------------------------- | --------------- | ----------------------- | ----------------------- |
| With signals and responders, validated each run | 0.47 ms         | 35 ms                   | 72 ms                   |
| Without signals, validated each run             | 0.31 ms         | 33 ms                   | 44 ms                   |
| With signals, validated once                    | 0.21 ms         | 19 ms                   | 38 ms                   |

## Largest cast the contract allows: 60 actors, 200 members each, 36 rounds

12,000 members, 432,000 member updates per run; 20 runs per batch, 3 batches. This is the upper bound,
not a cast anyone is expected to run many times.

| Case                                            | One run, median | One run, p95 | 20 runs, fastest batch | 20 runs, slowest batch |
| ----------------------------------------------- | --------------- | ------------ | ---------------------- | ---------------------- |
| With signals and responders, validated each run | 39 ms           | 51 ms        | 0.78 s                 | 0.81 s                 |
| Without signals, validated each run             | 31 ms           | 43 ms        | 0.59 s                 | 0.69 s                 |
| With signals, validated once                    | 34 ms           | 47 ms        | 0.63 s                 | 0.82 s                 |

At this size a run is a few tens of milliseconds, so 100 runs take roughly 3 to 4 seconds, well beyond
the target for the typical cast. The cost is linear in members times rounds, and `sampleSizeCap` is the
lever: capping cohorts at 30 members cuts this cast's member updates from 432,000 to 64,800.

## What these numbers do not show

- Speed on other hardware, under load from a server, or with many runs in parallel. The simulator is
  single-threaded and holds no shared state, so runs can be spread over workers, but that was not
  measured.
- The cost of what surrounds a run in an analysis (comparing variants, findings, sensitivity, storing
  results).
- Any property of the results. The benchmark checks nothing about what the simulator says; the tests do.
