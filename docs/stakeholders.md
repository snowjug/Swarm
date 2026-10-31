# Stakeholders and actors

Swarm's Environment stage can run its simulation on the people and groups a project is actually about.
This page describes how those groups are found, how a person reviews them, how an approved list becomes
the actors the simulation runs, and what none of it can claim.

Everything here is a modelling aid. The actors are **synthetic stand-ins, not real people**; every number
they carry is an **assumption** that the person can see, change and trace. Swarm explores scenarios; it
does not predict what real people will do.

## The flow

1. **Find** stakeholders, by reading the text (always available) or by asking the model (when the project
   uses one). Each stakeholder comes with the passages that support it, or says that it has none.
2. **Review** them: accept, edit, merge, remove, add, set priority. Nothing is ever deleted.
3. **Approve** the list. Only an approved list can be turned into actors.
4. **Make the actors**: a key actor for each key stakeholder and a cohort for each of the others. Every
   trait starts from a [documented prior](#category-priors) and says where it came from.
5. **Adjust** any trait on a slider. The Environment stage then builds its agents from these actors.

The panel for all of this sits at the top of the Environment stage's setup. A project that never opens it
behaves exactly as before.

## Finding stakeholders

### By reading the text

No model is used, so this is always available, costs nothing and gives the same answer for the same input.
It reads three things:

- the **question** and the scenario's _likely stakeholders_, if the scenario names any;
- the **passages** of the sources, sentence by sentence;
- the **people and organisations** in the source graph, if one was built.

In the passages it looks for **role nouns** from a small generic lexicon: roles any organisation has (a
customer, a user, an administrator, an engineer, a regulator, a competitor, a reseller, and similar), plus
a few words that only count with a modifier (a _team_ or a _department_ is a stakeholder only when something
says which). The lexicon names no market, product or organisation. A role word is a **mention**; the same
group named in several ways (a plural, a possessive, "end user" and "user") is one stakeholder.

What it decides, and how:

| Question        | Rule                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category        | From the role word and a modifier that signals a kind (a security reviewer is governance, a rival is a competitor). An end user whose sentences keep speaking of paying, gaining or being exposed (at least two sentences with the same cue) is read as that. |
| Priority        | **Key** for a decision maker, a regulator, a competitor, and the two groups named in the most sentences (at least two); at most eight in all. **Standard** if named in two or more sentences or by the scenario; otherwise **background**.                    |
| Size            | A **placeholder**: 1 for a key actor, 100 for a standard cohort, 25 for a background one. It is an assumption, shown as one, never a count.                                                                                                                   |
| Expected impact | From the category only, and labelled so: a group that bears cost is assumed harmed, a beneficiary benefited, every other category has no direction.                                                                                                           |
| Relations       | Derived from categories, and worded "Assumed from categories, not found in the sources".                                                                                                                                                                      |
| Evidence        | Up to four verbatim quotes for a group, each checked against the passage it was taken from.                                                                                                                                                                   |
| Missing groups  | A category with no stakeholder is listed as a **gap**: a prompt to look, not an error.                                                                                                                                                                        |
| Text for an AI  | A sentence that addresses an AI system is not read, and the person is told which passages had one.                                                                                                                                                            |

At most 25 stakeholders are proposed.

**What it cannot do.** It finds groups that the text names with a role word. It will miss a group the
lexicon has no word for, and it cannot tell who decides from a bare "the provider". It says so before it
runs, and the gaps list is there to prompt the person to add what it missed.

### By asking the model

Offered only for a project in model mode whose provider is configured; otherwise the panel says why not.
It sends a selection of the source passages (within a fixed size budget) and the question, and asks for
stakeholders with a passage id and a **verbatim quote** for each.

The reply is never trusted as it arrives:

- it must have the expected shape, with one repair attempt if it does not;
- a reply that repeats text planted in the sources is refused;
- **each quote is checked, character by character, against the passage it names**. A quote that cannot be
  found, or names a passage that was not supplied, is dropped;
- a stakeholder left with no verified quote is marked **inferred**, with high uncertainty and an
  assumption saying so;
- categories outside the list become _other_, identifiers are made unique, at most 25 are kept (at most
  eight of them key), and a scenario's named stakeholders that the model left out are added back.

If the model cannot be used (an error, an exhausted budget, a reply that fails validation after the
repair, or no answer in time), discovery **falls back to reading the text** and says so at the top of the
list: "The model could not be used (…)". A model failure does not end in an error: the list comes from the
text instead. The calls count against the project's model budget.

### Uncertainty

Every stakeholder has an uncertainty level and a reason, from how much the evidence says about it:

| Evidence                                                  | Level      |
| --------------------------------------------------------- | ---------- |
| Not mentioned by any passage (named only in the question) | **high**   |
| One sentence                                              | **high**   |
| Two or three sentences                                    | **medium** |
| Four or more sentences, in at least two passages          | **low**    |
| Proposed by the model with no verified quote              | **high**   |

Even "low" supports only that the group is in the evidence. It does not say what the group wants. For a
stakeholder a model proposed, the level is the higher of the one the quotes support and the one the model
reported.

## Categories are a lens

The categories (decision maker, end user, bears cost, bears risk, beneficiary, influencer, competitor,
substitute, partner, channel, regulator, governance, operations, other) are a prompt for "who else?", not
a list of answers. They set a starting direction of impact, a starting value for each trait, how the
relations between groups are assumed, and which groups are key by default, and nothing else. A category
with nobody in it appears as a gap, and it is the person's call whether it matters here.

## Reviewing

| Action     | What it does                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accept     | Marks it as checked by a person.                                                                                                                     |
| Edit       | Changes name, category, directness, priority, size, description, relevance, impact and uncertainty. The status becomes _edited_ if anything changed. |
| Merge      | Marks one stakeholder removed and names the one it went into, which takes the other's evidence. **Undo the merge** brings it back.                   |
| Remove     | Marks it removed. It stays in the record and can be restored.                                                                                        |
| Add        | Adds a stakeholder of your own. It is marked _added by you_ and carries no evidence, because evidence comes from the sources.                        |
| Prioritise | Key (one actor of its own), standard or background (a cohort).                                                                                       |

The server enforces what the screen offers: a stakeholder is never deleted; who found it cannot be changed;
**evidence can be taken away but never added**; a merge is always visible in the record; an impact is marked
as the person's only if they changed it; relations are assumptions whoever wrote them. A change made after
approval **takes the approval away** until it is given again, and at least two stakeholders must remain to
approve. Finding stakeholders again over a reviewed list asks for confirmation first.

## Actors

Approving a list lets Swarm make an **actor set** from it:

- a **key actor** for every key stakeholder: one actor, size 1;
- a **cohort** for every other: the stakeholder's size is what it _stands for_ in the model, an
  assumption, and a smaller number of simulated members (at most 20 for a standard cohort and 10 for a
  background one, never more than its size) represents it.

Every actor trait is a value with a **spread**, an **origin** and a **rationale**:

| Origin              | Shown as   | Meaning                                                  |
| ------------------- | ---------- | -------------------------------------------------------- |
| `system-assumption` | assumption | A starting value taken from the category table below.    |
| `evidence`          | evidence   | Stated by a passage of the sources.                      |
| `model`             | model      | A model's reading of the evidence; it cites the passage. |
| `user`              | you        | Set by the person on a slider.                           |

A cohort's spread (0.15 for every trait) is the assumed difference between its members. A trait the person
moves becomes theirs, and the actor is marked _edited by you_. The server refuses an edit that adds or
removes an actor, changes a kind or a category, makes a key actor larger than one, or makes a sample larger
than the group it stands for.

### Category priors

Each 0-to-1 trait starts from the value for the stakeholder's category. They are chosen so that categories
differ in the way a reader would expect (a regulator holds authority and moves slowly; a competitor reacts
quickly and trusts little), and for no other reason. They are not measurements. `Starting stance` is 0 for
every category, and `Impact` comes from the stakeholder's expected impact (harmed −0.6, benefited +0.6,
mixed −0.1, unclear 0).

| Category       | Influence | Openness | Sensitivity | Risk tolerance | Switching cost | Trust | Adoption | Authority | Reactivity |
| -------------- | --------: | -------: | ----------: | -------------: | -------------: | ----: | -------: | --------: | ---------: |
| decision-maker |       0.8 |      0.3 |         0.6 |            0.5 |            0.5 |   0.6 |      0.6 |       0.9 |        0.5 |
| end-user       |       0.3 |      0.5 |         0.7 |            0.4 |            0.5 |   0.5 |      0.5 |       0.1 |        0.5 |
| cost-bearer    |       0.3 |      0.4 |         0.8 |            0.3 |            0.5 |   0.4 |      0.4 |       0.1 |        0.6 |
| risk-bearer    |       0.3 |      0.4 |         0.8 |            0.2 |            0.5 |   0.4 |      0.4 |       0.1 |        0.5 |
| beneficiary    |       0.3 |      0.6 |         0.5 |            0.5 |            0.4 |   0.6 |      0.6 |       0.1 |        0.5 |
| influencer     |       0.7 |      0.5 |         0.5 |            0.5 |            0.2 |   0.5 |      0.5 |       0.2 |        0.7 |
| competitor     |       0.5 |      0.2 |         0.6 |            0.6 |            0.1 |   0.2 |      0.5 |       0.6 |        0.8 |
| substitute     |       0.3 |      0.3 |         0.5 |            0.5 |            0.2 |   0.3 |      0.5 |       0.3 |        0.6 |
| partner        |       0.5 |      0.5 |         0.6 |            0.4 |            0.6 |   0.6 |      0.5 |       0.4 |        0.5 |
| channel        |       0.5 |      0.4 |         0.7 |            0.4 |            0.6 |   0.5 |      0.5 |       0.3 |        0.6 |
| regulator      |       0.7 |      0.2 |         0.4 |            0.2 |            0.2 |   0.4 |      0.3 |       0.9 |        0.3 |
| governance     |       0.5 |      0.3 |         0.4 |            0.2 |            0.3 |   0.5 |      0.3 |       0.6 |        0.3 |
| operations     |       0.4 |      0.5 |         0.6 |            0.4 |            0.6 |   0.5 |      0.5 |       0.3 |        0.6 |
| other          |       0.4 |      0.4 |         0.5 |            0.4 |            0.4 |   0.5 |      0.5 |       0.3 |        0.5 |

The table is the code's table: a test fails if this page and the code disagree. The rationale shown beside
each trait names the category it came from ("Category prior for regulator: applies rules, not preferences…").

### Optional model refinement

When the project uses a model, a person can ask it to read the **key actors** against the evidence. Whatever
it sets is labelled _model_, with a rationale that cites the passage it relied on or says that none was
cited. If the call fails or its reply is not valid, the category priors stand and a note says so. Cohorts
are never refined by a model.

## How the Environment stage uses the actors

When a project has actors, the Environment stage makes its agents from them instead of generating a
population, and the existing simulation engine runs on them unchanged.

- Key actors come first, ordered by influence and authority. The engine takes at most **24** agents in the
  local rules mode and **10** in model mode; the event log says how many key actors did not fit.
- The largest cohorts then give one representative each, and further members of a cohort (spread around its
  values by its spread) if the engine still needs more. It needs at least **4** agents. If the actors give
  fewer, the stage stops with a plain instruction: add a stakeholder that stands for a group of people and
  make the actors again.
- A cohort is **never simulated at its size**: its size weights a cohort in the model, and the number of
  simulated members is small on purpose.
- An agent's persona is written by Swarm from the actor, says that it is fictional and that its numbers are
  assumptions, and the agent carries the ids of the passages behind it. No model is asked for personas when
  actors exist.
- The stage records "Fictional persona preparation from approved actors" in its trace, so the run shows
  where its population came from.

A project without actors is unchanged.

## Routes and roles

All routes are under `/api/projects/:id`. Reading answers `200` with nothing in it for a project that has
no stakeholders yet; it is not an error.

| Route                         | Role needed | Does                                                                  |
| ----------------------------- | ----------- | --------------------------------------------------------------------- |
| `GET  /stakeholders`          | read        | The list, its revision, whether a model is available, what you may do |
| `POST /stakeholders/discover` | run         | `{ mode: "rules" or "model", confirm }`; answers `201`                |
| `PUT  /stakeholders`          | edit        | The reviewed list and the revision you saw; `0` builds one by hand    |
| `POST /stakeholders/approve`  | edit        | `{ expectedRevision }`                                                |
| `GET  /actors`                | read        | The actors, and whether they are older than the stakeholders          |
| `POST /actors/generate`       | run         | `{ model, confirm }`; needs an approved list; answers `201`           |
| `PUT  /actors`                | edit        | Edited actors and the revision you saw                                |

A change made against an old revision is refused with `ARTIFACT_CONFLICT` (HTTP 409) and nothing is
overwritten. Other refusals say what to do: `STAKEHOLDERS_REVIEWED` and `ACTORS_EDITED` (confirm to replace
your work), `STAKEHOLDERS_NOT_APPROVED`, `MODEL_NOT_AVAILABLE`, `STAKEHOLDERS_TOO_FEW` and
`STAKEHOLDERS_BUSY` (one discovery or generation runs at a time for a project). Finding stakeholders and
making actors are limited to ten a minute.

Every change is recorded in the audit trail, in the same step as the change. The record holds **counts and
the mode only**: never the question, the sources or a stakeholder's text.

## What this does not do

- It does not predict anything. A simulation on these actors shows what follows from the assumptions on
  the page, no more.
- It does not measure populations. A size is an assumption used to weight a cohort.
- It does not find groups the lexicon has no word for, unless the scenario, the graph or the person names
  them, and it does not decide who matters. The person reviews and approves every list.
- It does not model individuals. A person named in the sources is modelled as a role.
- Relations between stakeholders are assumptions from categories, never findings.
- It does not guess a trait from nothing: a trait the sources do not support starts from its category
  prior and says so.

## Tests

```text
npm test -- backend/test/stakeholders-discover.test.ts backend/test/stakeholders-review.test.ts
npm test -- backend/test/stakeholders-actors.test.ts backend/test/stakeholders-environment.test.ts
npm test -- backend/test/stakeholders-routes.test.ts backend/test/stakeholders-neutrality.test.ts
npm test -- frontend/src/components/stakeholders frontend/src/api/stakeholders.test.ts
```

The discovery tests run on briefs of very different subjects, and a test checks that every name found
comes from the text it was given and that the code names no market or product.
