# 0022. A constraint is applied or only read, and its hardness is a proposal with a basis

Status: Accepted. Built and tested through the routes, the engine and the interface against scripted stand-ins for
a model. The rules path is measured and **falls short of two registered thresholds** (below). **No live model has
read a constraint.**

## Context

A decision is limited by things that are not in the question: a budget, a law, a notice period, a capacity, an
order of work. A simulation that ignores them answers a question nobody asked, and one that invents them is worse.
Three things can be said about a limit and must not be confused: where its words came from, whether anyone has
checked it, and whether the simulation can apply it. A model that reads a source will often call a wish or a
possibility a requirement, and a constraint that is wrongly hard can stop a decision: an unsettled hard legal,
regulatory or safety constraint blocks a run at the gate, so a wrongly hard one costs more than a wrongly soft one.

## Decision

1. **Constraints are a document a person reviews before a simulation** ([0016](./0016-research-and-constraints-are-artifacts.md)),
   with at most 60 constraints, 20 clarifications (never more than three open) and three effects on one constraint.
   Where a constraint came from (`source`) and whether the simulation applies it (`enforcement`) are set by rules,
   never by a model or a client. Whether anyone has checked it (`validation`) is set only by a person, and a
   proposal is never validated by being proposed.
2. **Applied or only read.** The engine can apply eight kinds of effect, each deterministic for a seed: block,
   limit-actions, delay, reduce-influence, add-cost, require-approval, add-risk and force-sequencing. A constraint
   is applied once a person has looked at it and has neither set it aside nor said it is unknown. Every other
   constraint is **interpretive**: read, listed with the reason, and changing nothing in a run. A soft constraint is
   never run as a ban on the change, and one that names an actor or a scenario that is gone is not applied.
   Branching is not applied: the engine runs the alternatives it is given and does not open new ones.
3. **Hardness is a proposal with a basis.** It is the server's reading of the quoted words: a cue word makes a
   limit hard only if its clause asserts it, and what is asked for, proposed, hoped, feared, supposed, denied or
   measured does not. The basis is stored and shown ("Hard because the source says 'must'"), and a person can change
   it. A model's `hardness` is a suggestion that can raise a limit only where the quote carries a word of limits
   and nothing in it asks, hedges, denies or reports a measurement; it never lowers a limit the words state.
4. **A gate, in rules.** The Constraint Coverage Gate says what is known, assumed, conflicting and missing, and
   returns `blocked`, `provisional` or `clear`. Starting a comparison is refused with `409 CONSTRAINTS_BLOCKED`
   while it is blocked and with `409 CONSTRAINTS_UNREVIEWED` until a person has been through the list. A
   provisional gate lets it run and its label is carried into the comparison, the review, the brief and the
   Decision Canvas. A project that never opened constraints runs as it always did.
5. **Nothing changes when there are no constraints.** A spec without constraints takes the same arithmetic path as
   before, held by digests of whole runs over every worked example, scenario and several seeds.
6. **Taking a limit away is measured, on the same seeds.** A comparison removes each applied constraint in turn on
   eight seeds, and seven counterfactual views of the proposed change run on twelve, so a difference is the view's
   and not the dice's. They are results of the simulation, not findings about the world.
7. **Constraints are an input of a comparison.** A comparison records the revision it ran under and says when the
   set has changed since. An independent critic reads only what the comparison recorded of them.

## Consequences

- **Recall is limited.** On the labelled set the rules found 75.5% (37 of 49) of the hard constraints against a
  threshold of 80%, and the misses are limits stated as bare quantities or by implication, which words alone do not
  make a limit. The threshold is recorded as breached in `evaluation/known-breaches.json` and was not edited to
  pass. A clear gate says that what was found is confirmed, not that nothing is missing.
- **A guard, not a wall.** A soft statement that carries a limit word can still be raised by an inflated reply:
  against a scripted fake of a model that called too many limits hard, 12 of 100 were accepted. A person can still
  lower any of them.
- **Only the effects above are applied.** A hard limit with no effect is read and said so on the comparison, and a
  violation is found only for an explicit hard `block`: a limit stated in words is not tested against the outcome.
- **The size of an effect is a modelling choice.** A threshold, a cost or a delay is a setting that a person or Swarm
  chose, and the independent review says so.
- **Questions are few.** A question follows what the situation points to, and never more than three are open
  at a time: what was left out waits for the next reading, when an answer has made room.

## Evidence

`backend/test/constraints-schema.test.ts`, `constraints-discovery.test.ts` (reading with rules and with a model),
`constraints-hardness.test.ts` (what a model may add to what the words say), `constraints-situation.test.ts`,
`constraints-review.test.ts`, `constraints-gate.test.ts`, `constraints-engine.test.ts` (each effect),
`constraints-golden.test.ts` (the digests, with `constraints-golden.json`), `constraints-counterfactuals.test.ts`,
`constraints-critic.test.ts` and `constraints-routes.test.ts` (including the two refusals at the start of a
comparison). `npm run eval:ai` (`evaluation/test/ai-rules.test.ts` and `ai-fake-foundry.test.ts`) measures recall
and the inflated-hardness arm ([docs/production/evaluation.md](../production/evaluation.md)). The specification is
[docs/analysis/constraints.md](../analysis/constraints.md).
