# 0023. The Decision Canvas is derived on read, with named lenses and no objective function

Status: Accepted. Built and tested through the pure builder, the route, the export, the wording table, the page
and a browser. It is a reading of simulated results and says so. **Nothing in it has been checked against what
happened in the world**, and no model writes any part of it.

## Context

The brief is long, and its answer is a chapter in it. The Decide scene needed a first view that says what the
simulation shows, which option (if any) it supports, under which assumptions and constraints, what weakens that,
what would invalidate it and what to check before anyone acts. Three temptations came with it. A single score
would need an objective that Swarm does not have and cannot know. A stored picture would be able to describe a
project that has since changed. A picture written by a model would be unauditable, and would say "will".

## Decision

1. **It is derived on read and stores nothing.** `GET /api/projects/:id/decision` has `DecisionService.view`
   read the newest finished comparison, the scenario, the participants, the constraints, the counterfactual
   views, the independent review and the evidence, and call a pure builder (`backend/src/decision/`). The
   constraint gate is worked out again at every read. When the comparison was run before something it is made from
   changed (compared by revision, as the brief is), the canvas says so, and it cannot be `robust-option`.
2. **One of six statuses, by rules written as data.** `STATUS_RULES` in `shared/decision.ts` is an ordered table,
   the first rule that applies wins, and a test holds the table to the code: `robust-option`,
   `conditional-option`, `multiple-plausible-options`, `needs-human-decision`, `blocked-by-hard-constraint` and
   `insufficient-evidence`. `needs-human-decision` is not "the lenses are close": it is two lenses each clearly
   ahead for a different option, or two hard constraints that cannot hold together.
3. **No objective function, and four named lenses.** Overall resistance (the headline), broadest support among
   key actors, least resistance among decision makers and approvers, and the smallest downside for the worst-affected
   group. Each is a transparent reading of what the analysis measured, computed only from the stored runs. They can
   disagree, and then the canvas shows it and does not average it away. The scenario's own `desiredOutput` wording is
   shown as context and is never parsed for numbers.
4. **"Clear" has a definition.** An option is told apart from another on a lens only when the paired difference
   on the same seeds is at least 0.05 of the lens's own scale (`LENS_MATERIAL_GAP`) and more than two standard
   errors (`LENS_NOISE_FACTOR`), over at least ten paired runs (`LENS_MIN_RUNS`). A clear leader is told apart from
   every other option that can be chosen. An option that a confirmed hard constraint rules out is shown and never
   ranked.
5. **The option that changes nothing is always an option.** If it leads, the answer says to keep it: the canvas
   has no bias toward acting.
6. **"Could", never "would".** A counterfactual view or a sensitive assumption could reverse a leader when it
   moves the proposed option's value, in the direction that closes the gap, by at least the leader's margin and
   by more than its own noise. The other options were not re-run under it, so every such statement says the order
   could change.
7. **Every statement carries one of eight epistemic labels:** fact, source claim, assumption, model inference,
   simulation event, scenario possibility, recommendation and validation requirement. One table
   (`LABEL_TABLE`) maps what the product already says onto them, and a test holds every namespace to the enum it
   maps. Only a source's own words found verbatim, or a record Swarm holds and can show, is a fact; nothing
   inferred, assumed or simulated ever is.
8. **No model writes any of it.** Every sentence is fixed text or filled in by rules, and passes the brief's
   wording guard at build time; one that would not is replaced and counted in `canvas.withheld`, which is expected
   to be 0.
9. **A recommendation is complete or says what is missing.** Whenever one is shown it states what, for whom,
   under which assumptions and constraints, the evidence that supports and weakens it, what would invalidate it,
   what to test next, whether it is reversible and what human approval is needed. A part with nothing to say is
   marked missing with a sentence. Reversibility is `unknown`: nothing in a project says whether a choice can be
   undone, and the canvas does not guess. Swarm recommends and explains; it contacts no one, executes nothing and
   decides nothing.
10. **It comes first.** It is the first thing the Decide scene shows, in every state of the brief beneath it, and
    when a brief is exported the canvas is placed before the brief's own answer.

## Consequences

- It is rebuilt on every read, with no cache, and the route is limited to 120 requests a minute. How long it takes
  is recorded (`swarm.report.duration`); these documents record no measurement of how it scales with a very large
  project.
- A canvas for a comparison that predates a change describes the project as it was, and says so, with a way to run
  it again. A project with no finished comparison gets `canvas: null` and a `readiness` that says what is missing.
- A lens with nobody to read, or whose per-actor results were not kept, says it could not be computed. When the
  analysis kept only totals, a lens shows its value and does not call a leader.
- Reversibility, a model-written synthesis, and the other options re-run under a counterfactual view are not in
  this version.
- The canvas cannot say what will happen. It never reports a probability, a confidence level, a return or a
  measured rate, never treats a simulated actor as a person, and never treats a model inference as a source. Every
  figure is a count or a share of simulated members or of seeded runs.
- No evaluation suite measures whether the status chosen is the right one for a real decision; the status matrix
  is listed as not measured ([docs/production/evaluation.md](../production/evaluation.md)), and
  `decision-status.test.ts` checks the rules against their own table.

## Evidence

`backend/test/decision-status.test.ts` (every status, every boundary, precedence), `decision-lenses.test.ts`,
`decision-build.test.ts` (the five worked examples through the real pipeline, the labels, the wording, the
completeness of a recommendation, the validation plan, defensive reads of participants),
`decision-labels.test.ts` (the label table, row by row, against the document), `decision-routes.test.ts` and
`decision-export.test.ts`; on the page, `frontend/src/scenes/decide/canvas/*.test.tsx`; and in a browser,
`e2e/lab/decide-canvas.spec.ts`. The specification is
[docs/analysis/decision-canvas.md](../analysis/decision-canvas.md).
