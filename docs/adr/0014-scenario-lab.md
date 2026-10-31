# 0014. The scenario lab: one engine for any what-if question

Status: Accepted. Built in slices; the Evidence section says what each has been tested against.

## Context

Swarm could read sources and run an opinion simulation on social-style platforms. A strategic question
("what could happen if X changes?") needs more: a structured scenario, stakeholders found in the
evidence, actors that stand for groups rather than accounts, many seeded runs instead of one, and an
honest account of uncertainty. It had to be added to the working application, not built beside it, and
without making any one domain (a price, a product, a market) special.

## Decision

1. **Artifacts, not new tables.** Everything a project carries beyond its own record is one validated
   JSON document in `project_artifacts` (project, kind, key, revision): `scenario`, `stakeholders`,
   `actors`, `analysis`, `critiques`, `brief`. The schemas are in `shared/` and are the contract between
   features; a write is checked against its kind, a stale write is refused by revision, documents are
   copied to branches and go with their project, and the table is in the backup copy list.
2. **Evidence has provenance.** A document can say it was uploaded, pasted, a sample, or fetched from a
   public page (address with secret query values removed, final address, retrieval time, content hash).
   `fetchedByServer` can only be set by the server that did the fetch.
3. **Stakeholder categories are a lens, not a list.** Discovery proposes stakeholders from the scenario
   and the evidence, with cited passages and stated uncertainty; the person accepts, edits, merges,
   removes, adds and prioritises; only then do actors exist. Every actor trait has an origin (evidence, a
   person, a system assumption, a model) and a reason, so no input to a run is unexplained.
4. **Two engines, one cast.** The existing agent engine stays as the deep dive (reasons for every
   decision, optional model, pause and branch) and runs on the key actors. A new pure simulator
   (`backend/src/simulation/`) runs key actors and cohorts of sampled members for any seed, and is the
   engine of the repeated-run analysis. Second-order effects come from generic signals and responder
   actors (competitor, substitute, partner, regulator) reacting after lags, never from a script.
5. **Repeatability, not confidence scores.** Every variant is run on the same seeds. A finding is a
   statement tested on each run and reported as "holds in k of n runs" with a Wilson interval and one of
   four classes. Sensitivity moves one assumption at a time on the same seeds and compares the shift with
   the noise. The fidelity of the engine is stated wherever results appear: rules-mode results follow from
   the declared assumptions and are not evidence about the world.
6. **A model is optional and never silent.** Every feature has a rules path. A model path is validated
   against a schema and the evidence it cites, and any failure is shown with the rules result.
7. **The brief is assembled from data.** Every statement has one of ten origins and the ids it rests on;
   results are worded as simulated counts, never as real-world rates or predictions.
8. **Critics challenge and never edit.** Their objections, the responses, what is still disputed and the
   effect on the conclusion stay visible beside the finding.

## Consequences

- No migration is needed to add a new kind of result; a schema and the code that owns it are enough.
- The two engines can disagree. The analysis records whether a deep-dive run falls inside the ensemble's
  range, and says it compares different engines.
- Population sizes are modelling assumptions: cost and diversity come from the number of simulated
  members, never from the number a cohort stands for.
- **Not built:** historical backtesting, a model run repeated many times (run-to-run variation of a model
  is unmeasured and said to be), word or slide exports (the brief prints from the browser), hosted
  execution of long analyses (they run in the server process and are marked interrupted if it stops).

## Evidence

Added with each slice: `backend/test/artifacts.test.ts` (store, both dialects, copy and restore),
`backend/test/lab-fixtures.test.ts`, then the tests of each feature named in its task.
