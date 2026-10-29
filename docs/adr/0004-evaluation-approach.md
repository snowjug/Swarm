# 0004. Hash-pinned labelled datasets, a dev/test split, and floors rather than targets

Status: Accepted

## Context

The mission rules out claiming an improvement without evidence. The things worth measuring here
(does the analyst refuse what it cannot answer, are conflicts between sources found, does retrieval
return the passage a question needs, are injection warnings raised) have no off-the-shelf benchmark
for this product, and a model run costs money and varies from one run to the next.

## Decision

1. A small **offline harness** (`evaluation/`, `npm run eval`) measures the deterministic parts: the
   evidence gate, retrieval, conflict detection, the deterministic support checks and the
   injection warnings. It runs in seconds, calls no model and is deterministic; a test asserts that
   two runs give identical results.
2. The labelled sets are written against the exact text of the Larkholm demo sources. Each source
   is pinned by a SHA-256 of its line-ending-normalised text, and the harness refuses to run if a
   source changed, so a label can never silently drift from its text.
3. Labels were written from the source text before looking at results. Cases an early version of
   the detector missed were kept as expected (two of three conflicts), not removed.
4. Items are split **dev** and **test** by alternation. Thresholds are chosen on dev. The test split
   was printed once while choosing a margin, so it is a sanity check, not a blind exam.
5. `evaluation/thresholds.json` holds **floors and ceilings** set a little below what was measured,
   so a regression fails a test, without pretending the numbers are targets. A floor may only be
   raised when an improvement is measured on dev and confirmed on test. It may be lowered only to
   correct a measurement, and the file says why (it was, once; see below).
6. The harness shows the gate what the product shows it. Its first version showed the sources only
   and overstated abstention recall (57% reported, 43% measured faithfully on dev). That was found
   because a demo test disagreed with it, and is recorded in `evaluation/README.md`.

## Consequences

- The sets are small (24 retrieval, 28 answerability, 3 conflicts, 22 statements, 18 injection
  samples), in one domain, and labelled by the person who wrote the rules. A figure of 100% means
  "no failure among these examples". Rules that were extended after seeing misses (the injection
  patterns) are in-sample, so their improvement is an upper bound.
- "Before" figures are structural: they describe behaviour that did not exist at the starting
  commit (the analyst always answered; no conflict was ever reported), not a competing algorithm.
- Nothing here measures a model. How a real model behaves with these rules is known only from live
  runs, one at a time, and one run is not a distribution.
- Grounding quality against **real** documents is unmeasured. A pilot should add a labelled set from
  documents the pilot users supply, under a data-handling agreement.

## Evidence

`evaluation/test/evaluation.test.ts` (15 tests, including the arithmetic of the scoring code and a
check that every retrieval label is satisfiable), `evaluation/results/latest.md`.
