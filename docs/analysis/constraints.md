# Constraints

What limits a decision, kept as a document of its own so that a person reviews it before a simulation
runs, and so that the answer can say which limits it rests on. A constraint is never a fact because
Swarm, or a model, proposed it: where it came from, whether anyone has checked it and whether the
simulation applies it are three separate things, and the last two are decided by rules, not typed.

Code: [`shared/constraints.ts`](../../shared/constraints.ts) and
[`shared/constraint-effects.ts`](../../shared/constraint-effects.ts) (the contract, version 1),
[`backend/src/constraints/`](../../backend/src/constraints/) (discovery, review, the gate, the views),
[`backend/src/simulation/constraints.ts`](../../backend/src/simulation/constraints.ts) (the engine),
[`backend/src/routes/constraints.ts`](../../backend/src/routes/constraints.ts) (the routes) and
[`frontend/src/scenes/map/constraints/`](../../frontend/src/scenes/map/constraints/) (the page).

## The document

Artifact `constraints` (key `default`, revisioned) holds a `ConstraintSet`: the constraints, the latest
gate result (`coverage`), the open and answered `clarifications`, how it was made (`mode` rules, model or
user, and a `note` that says so in words), and the scenario and actors revisions it was read against.
Artifact `constraint-counterfactuals` holds the last run of the seven views.

A constraint has: `id`, `category` (one of 28), `statement`, `source`, `evidenceRefs`, `hardness`,
`scope`, `affectedActorIds`, `affectedAlternativeIds`, `window` (rounds and the person's own words),
`severity`, `confidenceBasis` and `uncertainty`, `validation`, `conflict`, `impactIfViolated`,
`assumptionId` (a scenario assumption it holds only while that assumption holds), `mitigations`,
`enforcement`, `effects`, `consideredIn`, `review` and a `note`.

| Field          | Values                                                           | Who sets it                                                                                                      |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `source`       | `user`, `extracted`, `inferred`                                  | Rules, from where the words came from. Never a model, and never a client.                                        |
| `validation`   | `unvalidated`, `confirmed`, `rejected`, `unknown`, `assumed`     | A person, through a review action. A proposal is always `unvalidated` (or `assumed`, for a scenario assumption). |
| `enforcement`  | `enforced`, `interpretive`                                       | Rules, from whether the simulation can apply its effects to the cast there is now. Recomputed on every read.     |
| `conflict`     | `conflicts-with:<id>`                                            | Rules, from the numbers two constraints state. Recomputed on every read; a client cannot write it.               |
| `consideredIn` | `gate`, `critic`, `counterfactual`, `analysis-record`            | The server, from what happened to an interpretive constraint. Never typed.                                       |
| `review`       | `proposed`, `accepted`, `edited`, `added`, `removed`, `excluded` | A person. `removed` and `excluded` stay in the set so that the review can be audited.                            |

At most 60 constraints, 20 clarifications (three are put to a person at a time) and three effects on one
constraint.

## Where a constraint comes from

Rules always read the person's own words (the question, the scenario, its assumptions), the sources, the
cast and who is involved. A model reads the sources as well when the person chooses it.

- **Rules.** A sentence is read as a limit where words that name what is limited (money, time, capacity,
  law, privacy, a dependence, an order of work, and so on) and words that limit it (an obligation, a
  ceiling, a condition, a shortage) stand in one clause. The quote is the sentence as written. A sentence
  that gives a share of people is a count, not a limit, unless it states an obligation. A sentence that
  says a limit is not settled ("has not been defined") becomes a question, not a constraint.
- **A model.** `runStructuredTask` with role `scenario`, a strict `ProposedConstraints` v1 schema and the
  server's own checks, one correction round, then the rules' answer. The schema has no field for source,
  validation or effects: none of that is for a model to say. A quote it cites is kept only if the server
  finds it in the passage it names; otherwise the constraint is kept as `inferred`. A reply that repeats
  what an instruction inside a source asked for, or that is itself written as an instruction, is refused.
  A refusal, or a client that has left, is never answered from rules.
- **Text addressed to an AI is not read.** A passage that tells its reader what to answer, or that research
  set aside, is neither read by the rules nor shown to a model, and a model cannot cite it. What it asks
  for is still refused if a reply repeats it.

How a constraint is labelled follows from where its words are:

| Words came from                                                  | `source`    | `hardness`                                                          |
| ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| The question, the scenario, a scenario assumption a person wrote | `user`      | Hard only where the words say so (a requirement, a ban, a ceiling). |
| A source passage, with the quote found in it                     | `extracted` | Hard only where the quoted words are hard words.                    |
| Who is involved (a regulator, a partner, an owner of operations) | `inferred`  | Always soft. No source or person has said it holds.                 |
| A model, with a quote the server could not find                  | `inferred`  | Always soft.                                                        |

Nothing proposed is reviewed, validated or applied by being proposed. Reading again adds only what is new
and never undoes what a person decided; an edited constraint is not proposed again under its old words.

## What a person does

`POST …/constraints/review` takes one action and the revision the person was looking at. `accept` keeps
a proposal in the list (it stays not yet validated); `confirm` says it holds; `edit` changes what a person
may change (never where it came from or its quote); `add` writes one of their own (source `user`, no
evidence); `remove` and `exclude` set one aside; `restore` puts it back; `mark-unknown` and
`use-assumption` say they do not know or choose to treat it as true; `answer`, `mark-unknown`,
`use-assumption` and `exclude` on a question; `confirm-set` says they have been through the list.

An unknown stays unknown: it is not applied and not treated as true. A person who answers a question
writes a constraint of their own. An assumption is written down as a constraint (`Assumed for now: …`)
labelled assumed, so that it shows wherever the constraints do.

## The Constraint Coverage Gate

Rules over the constraints and the scenario, `backend/src/constraints/gate.ts`. The same inputs give the
same answer; it decides nothing about the world.

| Status        | When                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blocked`     | A hard legal, regulatory or safety constraint is `unvalidated` (not confirmed, rejected, assumed, marked unknown or set aside), or a hard `block` with no actor and no window covers every alternative.                                                                                                                              |
| `provisional` | Anything is left a person has not confirmed: an unvalidated, assumed or unknown constraint, a possible conflict, an open question, a hard constraint the simulation can only read, a constraint that names something that is gone, or constraints read against an earlier scenario or cast. The result carries a label that says so. |
| `clear`       | Everything is confirmed. With no constraints at all it says that what was found is not proof that none exist.                                                                                                                                                                                                                        |

It lists: what is known (hard and confirmed), assumed, unvalidated and unknown; conflicting pairs;
what is missing (every open question); the alternatives a hard constraint rules out; who is affected;
the constraints the simulation does not apply; what needs confirming. `GET …/constraints/gate` also
measures which applied constraint, taken away, moves the simulated headline share most (a leave-one-out
on eight paired seeds with the existing sensitivity machinery). The page's own copy of the gate does not
run a simulation.

**Wired into starting a comparison.** A project with no constraints runs as it always did. With a
constraint set, `POST …/analysis` refuses with `409 CONSTRAINTS_BLOCKED` while the gate is blocked, and
with `409 CONSTRAINTS_UNREVIEWED` until a person has been through the list (`confirm-set`, with nothing
waiting for a first look); both say what to do. A provisional gate lets it run, and its label is carried
into the comparison record (`analysis.constraints.label` and the comparison's caveats), so that the review,
the brief and the decision view can say so. `GET …/analysis` reports the same as `readiness.constraints`.

## What the simulation applies, and what it only reads

A constraint is applied once a person has looked at it and has neither set it aside nor said it is
unknown. Its `effects` are what the engine applies, each deterministically for a given seed. Everything
else is `interpretive`: read, listed with the reason, and changing nothing in a run.

| Effect             | What the engine does                                                                                                                                                                                                    | Window read         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `block`            | The change does not reach the actors in scope (all of them when none is named) in the rounds the constraint is active. Applied only for a hard constraint; a soft block is never run as a ban.                          | from and to         |
| `limit-actions`    | A final stance that would read as a response the constraint takes away is read as the nearest open one: adopt as accept with conditions, switch as resist, resist as adapt defensively. Stances do not change.          | from and to         |
| `delay`            | The change reaches the actors in scope that many rounds later. When the delay names actors, an external responder among them also acts that many rounds later. A delay past the last round means it never reaches them. | none: the whole run |
| `reduce-influence` | The influence of the actors in scope is scaled down for the whole run.                                                                                                                                                  | none: the whole run |
| `add-cost`         | Raises the cost of switching of the actors in scope, or lowers their readiness to take something up, for the whole run.                                                                                                 | none: the whole run |
| `require-approval` | The change reaches the actors in scope only from the round after the approver's simulated mean stance is at or above a threshold. If it never is, it never reaches them.                                                | from and to         |
| `add-risk`         | From the first round of the window, members who accept little risk settle at a lower stance. Removed after its last round.                                                                                              | from and to         |
| `force-sequencing` | The change reaches the actors in scope that many rounds after it reaches the named earlier actors.                                                                                                                      | none: the whole run |
| `branch`           | **Not applied.** The engine runs the alternatives it is given and does not open new ones. Not part of the effect schema; the counterfactual views explore such a branch instead.                                        | none                |

A constraint with no effect, a soft `block`, one that names an actor or a scenario that is gone, one an
unknown or an exclusion, and any beyond the 100 effects a comparison applies, is not applied; each is listed
in `analysis.constraints.notApplied` with its reason. A window the engine does not read for an effect is
kept, said so (`note`) and ignored. The amounts in an effect (a threshold, a cost, a delay) are settings the
person or Swarm chose; where a source states a limit in words, the size of its effect is a modelling choice,
and the independent review says so.

What the simulation did because of a constraint is recorded as events (`held`, `delayed`, `sequenced`,
`approval-granted`, `approval-withheld`, `limited`, `risk-added`, `influence-reduced`, `friction-added`) on
the run, in the simulation's words. A comparison also takes each applied constraint away in turn, on the first
eight seeds, and records the paired difference in the headline share (`analysis.constraints.impacts`). That
difference is a result of the simulation, not a finding about the world.

**With no constraints, outputs are bit-identical to before.** A spec with no constraints takes the same
arithmetic path as it did, tested by SHA-256 digests of whole runs over every worked example, scenario and
several seeds (`backend/test/constraints-golden.test.ts`, with the digests in `constraints-golden.json`).
A set whose constraints are all only read changes nothing in the runs either (tested through the routes).

## Counterfactual views

`POST …/constraints/counterfactuals` runs seven views of the proposed change on the same twelve seeds as its
base, so that a difference is the view's and not the dice's: without the budget constraint, delayed
implementation (three rounds later), stronger regulatory restriction, lower adoption, higher capacity, a
different decision owner, and a critical dependency fails. Each reports the paired difference in the simulated
headline share, its standard error, whether it moves the result more than the noise, and what moved it. A view
that does not fit the project says why it was not run. A limit that is only read is not taken away. They are
kept with the revisions they were made from, so that a later change is told from a view that still holds.
`summariseCounterfactual` in `shared/constraints.ts` gives the compact `{counterfactual, deltaVsBase, driver}`
a Decision view renders.

## Lineage

The constraints are an input of a comparison: a comparison records the revision of the set it ran under
(`inputRevisions.constraints`, only where there is one), and `changedInputs` reports `constraints` once the
set has changed since, and for a comparison made before there were any. A comparison, and the review and the
brief made from it, then describe the project as it was.

## The independent review

`backend/src/critics/constraints.ts` (one registration in `critics/rules.ts`) reads only what the comparison
recorded of its constraints, and says nothing for one run without a reviewed set. Under the assumption role it
raises a provisional label, an unconfirmed constraint whose removal moves the simulated result, and constraints
marked unknown and so left out; under the methodology role it raises hard constraints the simulation could not
test, constraints that name what is gone, and that effect sizes are a modelling choice. The other critics'
output is unchanged.

## Routes

| Method     | Path                                            | Needs          | What it does                                                                                                                     |
| ---------- | ----------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET        | `/api/projects/:id/constraints`                 | `read`         | The set, its revision, the gate worked out now, the questions to put now, what is stale, the options and what the caller may do. |
| PUT        | `/api/projects/:id/constraints`                 | `edit`         | The whole set as the person now wants it (`expectedRevision`). A constraint left out is refused (`CONSTRAINTS_OMITTED`).         |
| POST       | `/api/projects/:id/constraints/propose`         | `run`          | Read the sources (`{ mode: "rules" \| "model" }`, 10 a minute). 409 `MODEL_NOT_AVAILABLE` when the project has no model.         |
| POST       | `/api/projects/:id/constraints/review`          | `edit`         | One action, with `expectedRevision` (409 `ARTIFACT_CONFLICT` when the set changed).                                              |
| GET        | `/api/projects/:id/constraints/gate`            | `read`         | The gate, with the constraint whose removal moves the simulated result most.                                                     |
| GET / POST | `/api/projects/:id/constraints/counterfactuals` | `read` / `run` | The stored views and whether they are current / run them (6 a minute).                                                           |

Every change is written with its audit entry in one transaction (`constraints.proposed`, `constraints.reviewed`,
`constraints.edited`, `constraints.counterfactuals.run`). The entry holds counts and a status: never a
statement or a quote.

## What it cannot tell you

- **Whether a constraint is real.** A quote shows that a source says it, not that it is so. A model-proposed
  constraint that cites a passage which passes verification is `extracted` and `unvalidated`: a person still
  has to confirm it, and a source can say something false.
- **That nothing is missing.** The rules read the common ways a limit is put; a limit they have no word for is
  not found, and a clear gate says only that what was found is confirmed. The questions are a table of what
  can limit a decision, asked where something in the question, scenario or cast gives a reason to. Which
  limits "materially change the outcome" is judged from the kind of limit and whether the cast can express it,
  not measured; the measured version is the leave-one-out above.
- **Everything a limit does.** Only the effects above are applied. Hard constraints without one are read and
  said so on the comparison, and a violation is found only for an explicit hard `block`: a limit stated in
  words is not tested against the outcome.
- **A project that never opened constraints.** It runs ungated, as before.
