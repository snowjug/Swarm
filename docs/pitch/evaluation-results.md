# Evaluation results

What was measured, how, and how far to trust it. The method is in
[ADR 0004](../adr/0004-evaluation-approach.md); the full tables are in
[evaluation/results/latest.md](../../evaluation/results/latest.md); the limits are in
[evaluation/README.md](../../evaluation/README.md). Read the limits before the numbers.

## Offline evaluation

It runs in seconds with `npm run eval`, calls no model, and is deterministic. The sets were labelled
by one person, from the source text, in one fictional domain. They are small, so a figure of 100% means
"no failure among these examples".

| Area                                      | Before (at the baseline)               | Now                                                                                                                             |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Analyst abstention, fair questions        | Always answered                        | 0% of answerable questions refused (28 questions: 14 answerable, 14 not)                                                        |
| Analyst abstention, unanswerable ones     | Always answered                        | **43%** refused on the development split (3 of 7), **86%** on the test split (6 of 7)                                           |
| Conflicts between sources                 | None reported                          | **1 of 3** labelled conflicts found; the one reported was real. The other two (anaphoric, and a conflict of meaning) are missed |
| Injection warnings in sources             | 30% of labelled samples                | 80% of 18 samples (all 8 direct instructions); no false alarm on look-alike text; 2 known gaps; in-sample                       |
| Retrieval of the passage a question needs | Not measured                           | recall@4 100% (dev) and 89% (test); about two of the four returned passages are irrelevant                                      |
| Unsupported statements shown as findings  | Every statement was presentable as one | 3 per split instead of 6 (but a larger share of the few that remain, because few statements pass the checks at all)             |
| Deterministic support check               | Not measured                           | Accuracy 36% (dev) and 45% (test); it accepted 3 of the 8 unsupported statements                                                |

### What the abstention numbers hide

- It refuses what has nothing to do with the sources and years the sources never mention: 6 of 7 such
  questions. The one it misses ("What will the weather be like next Tuesday?") shares two of its three
  key words with the project's own report.
- It passes 3 of 4 plausible questions about something absent ("Which councillors voted against…?").
  Those rely on the model declining, which is seen only in live runs.
- Nobody should read "43%" as the analyst's overall abstention rate. It is the rate of a cheap
  first check on a small labelled set.

### A correction made in the open

The first version of the harness showed the gate the sources alone, as if the analyst could answer from
nothing else. The product also lets it answer from the report, graph and recorded activity of a run.
Measured as the product runs it, recall on the development split is 43%, where 57% had been reported,
and one off-topic question is a miss, where "always refused" had been claimed. The floor in
`evaluation/thresholds.json` was lowered for that reason and no other, and the test that claimed
"always refused" now names the miss. It was found because a demonstration test disagreed with the
harness.

## Live model runs

Three runs of `npm run azure:verify` against a real deployment (a small GPT-4.1-class chat model,
keyless Microsoft Entra authentication). The scenario is synthetic: four proxies, two platforms, three
rounds, a branch, a report, both chats and a planted instruction. All three passed all 15 checks.

| Run                            | Round trips | Tokens in / out  | Report statements                                                              | Analyst reply                                               |
| ------------------------------ | ----------- | ---------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Baseline (before this program) | 60          | 95,154 / 13,376  | 30: 14 supported, 5 partly, 8 not supported, 3 not checkable                   | 2,696 characters, **cited nothing**                         |
| After the chat change          | 65          | 120,948 / 17,327 | 30: ledger classed 20 as simulation, 3 partial, 4 unsupported, 3 not checkable | Cited the four statements the ledger classed as unsupported |
| Final tree                     | 61          | 105,274 / 14,431 | 29: 19 supported, 1 partly, 4 not supported, 0 contradicted, 5 not checkable   | Cited 4 report statements, all present in the ledger        |

In every run the planted instruction did not appear in 48 proxy statements, two chat replies or the
summary. One probe is evidence, not proof, of resistance.

How far to trust this: three runs, one small model, one synthetic scenario, and model output varies
from run to run (the statement counts and the token totals differ between runs with no change to the
scenario). The runs show that the path works and that the analyst can now cite the ledger. They do not
measure how well it does so.

## Tests and load

| Check                                 | Result                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Unit and integration tests            | 1,182 in 67 files (baseline 935 in 56)                                                                 |
| End-to-end, Microsoft Edge            | 92 passed, none failed or flaky (baseline 78); axe and keyboard checks at four viewports on the ledger |
| Evaluation floors                     | all hold                                                                                               |
| Load test (rules engine, one machine) | See below                                                                                              |

The load test (`node scripts/load-test.mjs`) drives the deterministic engine, with no model, on one
Windows machine. It predates the ledger and sign-in routes and does not exercise them. Idle reads at 64
concurrent requests: p50 about 40 ms, p95 about 85 to 110 ms. Twelve complete workflows (four stages
each): all completed, none failed, 92 clean queue-full rejections as back-pressure, no server error.
Reads while those ran: p50 150 ms, p95 584 ms, p99 960 ms, worst 1.09 s. Peak server memory 392 MB.
These are numbers for that machine and not a capacity guarantee.

## What this does not show

That any of the support classes is correct on real documents; that the abstention rate or the
conflict detector would hold outside the fictional domain; that a model-assisted check catches what the
deterministic check misses; or that the product is ready for production. A pilot would need a labelled
set from real, approved documents ([pilot plan](./pilot-plan.md)).
