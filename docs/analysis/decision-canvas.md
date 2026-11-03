# The Decision Canvas

The Decision Canvas is the answer-first picture of a decision: the first thing the Decide scene shows. It
says what the simulation shows, which option (if any) it supports, under which assumptions and
constraints, what weakens that, what would invalidate it, and what to check before anyone acts.
It is derived, not stored, and it is built entirely by rules: no model writes any of it.

> Explore scenarios, not predictions.

Code: `shared/decision.ts` (the contract, the labels, the status words and rules), `backend/src/decision/*`
(the pure builder), `backend/src/routes/decision.ts` (`GET /api/projects/:id/decision`),
`frontend/src/scenes/decide/canvas/*` (the page).

## What it is made from

`DecisionService.view` reads the artifacts a project already holds and calls the pure `buildCanvas`:

| Input                                 | Used for                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| newest finished `analysis`            | the options, their runs, findings, sensitivity rows, what the comparison recorded of its constraints |
| `scenario`, `stakeholders`            | the question, the baseline, the cast’s roles; participant fields are read defensively                |
| `constraints`                         | the constraints and the coverage gate, **worked out again at every read**                            |
| `constraint-counterfactuals`          | the counterfactual views, counted only while they still describe the project                         |
| `critiques`                           | the independent review, counted only when it is of this comparison                                   |
| project documents, ledger, `research` | the evidence reading                                                                                 |

Nothing is written, so a canvas is never older than what it describes. When the comparison was run before the
scenario, the stakeholders, the actors or the constraints changed (compared by revision, as the brief does), the canvas
says so, and it cannot be `robust-option`. With no finished comparison the route answers `canvas: null` and a
`readiness` that says what is missing and which step supplies it; the status rules still apply to that case and give
`insufficient-evidence`.

## The decision status

Exactly one of six. The rules are tried in this order and the first that applies wins. They are written as data in
`STATUS_RULES` (`shared/decision.ts`) and a test holds the table to the code.

| #   | Rule id                 | Applies when                                                                                                                                | Status                       |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | `no-analysis`           | There is no finished comparison with recorded runs, or it holds only one option.                                                            | `insufficient-evidence`      |
| 2   | `gate-blocked`          | The constraint gate, worked out now, is blocked (an unsettled hard legal, regulatory or safety constraint; or every alternative ruled out). | `blocked-by-hard-constraint` |
| 3   | `all-violate`           | Every alternative violates a **confirmed** hard constraint.                                                                                 | `blocked-by-hard-constraint` |
| 4   | `no-direction`          | The comparison cannot tell the change from no change because no stakeholder has an expected direction of impact.                            | `insufficient-evidence`      |
| 5   | `evidence-insufficient` | The evidence reading is `insufficient` (see below).                                                                                         | `insufficient-evidence`      |
| 6   | `hard-conflict`         | Two live **hard** constraints cannot hold together.                                                                                         | `needs-human-decision`       |
| 7   | `value-tradeoff`        | Two lenses each have a **different clear leader**.                                                                                          | `needs-human-decision`       |
| 8   | `no-clear-leader`       | The headline lens has no clear leader (a tie within run-to-run variation, fewer than 10 runs, or the change cannot be told from no change). | `multiple-plausible-options` |
| 9   | `robust`                | One option is the clear leader on the headline lens **and none of the conditions below applies**.                                           | `robust-option`              |
| 10  | `conditional`           | One option is the clear leader on the headline lens and at least one condition applies. The conditions are listed.                          | `conditional-option`         |

**Conditions** (`conditionsOf`). A leading option is robust only when none of these holds; each one on its own makes it
`conditional-option`:

- a counterfactual view or a sensitive assumption could reverse it (below);
- a hard constraint that is not confirmed would rule it out;
- the constraint gate is `provisional`, or there is no reviewed constraint set at all, or the comparison ran under
  constraints that were not all confirmed;
- the evidence reading is `limited`;
- the comparison was run before something it is made from changed (or did not record what it was made from);
- on some computed lens it cannot be told apart from another option; some lens could not be computed; fewer than two
  lenses could be computed;
- the independent review has not been run, belongs to another comparison, or has a blocking objection that stands;
- no counterfactual view that still describes the project was run (said as “no change to the situation was tried”,
  never as “nothing was tried”, since the sensitivity step may have moved assumptions all the same), or sensitivity was
  not run.

`needs-human-decision` is deliberately not “the lenses are close”: it is two lenses each **clearly** ahead for a
different option, which is a trade-off between what each lens values, or constraints that contradict each other.
`multiple-plausible-options` is the case where the headline lens cannot separate the leading options; the status then
lists any lens that does separate them, so that a lens that distinguishes is never hidden.

### What “clear” means

An option is told apart from another on a lens only when the paired difference between them, on the same seeds,
is **at least 0.05 of the lens’s own scale** (the sensitivity step’s “material” line) **and more than two standard
errors of that difference**, over **at least 10 paired runs**. Anything closer is _level_. An option is a lens’s
**clear leader** only when it is told apart from every other option that can be chosen.
(`LENS_MATERIAL_GAP`, `LENS_NOISE_FACTOR`, `LENS_MIN_RUNS` in `shared/decision.ts`.)

## The lenses

Swarm has no objective of its own and invents no outcome measure, probability or return. A lens is a named,
transparent reading of what the analysis measured, computed only from the stored runs: the share of simulated members
ending in a response, averaged over the seeded runs. Lenses can disagree, and when they do that is shown and never
averaged away. The scenario’s own `desiredOutput` wording is shown as context and is never parsed for numbers.

| Lens id                     | Name                                                 | Measures (lower or higher is better)                                                                     | Reads                                                          |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `overall-resistance`        | Least resistance overall (the **headline lens**)     | share ending in switch or resist, every actor counting equally (the engine’s own headline share) — lower | every actor                                                    |
| `key-actor-support`         | Broadest support among key actors                    | share going along or accepting with conditions — higher                                                  | actors simulated one by one (`kind: key`)                      |
| `decision-maker-resistance` | Least resistance among decision makers and approvers | share ending in switch or resist — lower                                                                 | actors whose authority is _decides_, _approves_ or _can block_ |
| `worst-affected-downside`   | Smallest downside for the worst-affected group       | in each run the highest adverse share of any one actor, averaged over runs — lower                       | the actor that fares worst under each option                   |

Authority comes from the participant fields when the stakeholder set carries them, and otherwise from the category
(decision maker decides; governance approves; regulator can block; influencer advises; everything else none).
A lens with nobody to read, or whose per-actor results were not kept, says it could not be computed and why. When the
analysis kept only totals over the runs, a lens shows its value and does not call a leader, because it cannot be told
from run-to-run variation. An option a **confirmed** hard constraint rules out is shown but never ranked.

The option that changes nothing is always an option. If it leads, the answer says to keep it; the canvas has no bias
toward acting.

### What could reverse the answer

The counterfactual views and the sensitivity rows both measure one thing: how far the headline share of the
**proposed change** moves when one limit or one assumption changes, on the same seeds. That is the headline lens’s own
scale. A check _could reverse_ the leader when it moves the proposed option’s value, in the direction that closes the
gap, by at least the leader’s margin over it, and only when the check is itself clearly larger than its noise
(`material` / `assumption-sensitive`). The other options were not re-run under the check, so this says the order
**could** change, never that it would, and every such statement says so.

## The evidence reading

`insufficient` when the grounding review abstains (the ledger’s sufficiency says `insufficient`, assessed only when the
ledger holds statements), or no source document is attached, or no actor in the cast has a cited supporting passage.
`limited` when not insufficient but the review says limited, a conflict between sources is open, or fewer than half of
the actors have a cited supporting passage. `adequate` otherwise. Counts of records (documents, pages read, pages set
aside) are labelled FACT. The authority of a researched page is an estimate from the kind of site and is labelled
ASSUMPTION; it is never a verdict on whether a page is right.

## Recommendation completeness

Whenever a recommendation is shown, in any status, it states: what is recommended; for whom; under which assumptions;
under which constraints; the evidence that supports it; the evidence that weakens it; what would invalidate it; what to
test next; whether it is reversible; and what human approval is needed. A part with nothing to say is `missing` with a
sentence, and the card lists the missing parts, so a gap is a finding and never an omission. Reversibility is `unknown`
in this version: nothing in the project says whether a choice can be undone, and the canvas does not guess. The page
counts a part that says only that something is not known as a gap, not as a part stated: “7 of 9 parts stated ·
Missing: Evidence that weakens it, Reversibility (unknown)”.

| Status                                | The recommendation (`kind`)                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `robust-option`, `conditional-option` | `proceed` with the option in steps that can be checked, or `keep-no-change` when no change leads |
| `multiple-plausible-options`          | `hold`: do not choose between them; test what separates them                                     |
| `insufficient-evidence`               | `gather-evidence`                                                                                |
| `blocked-by-hard-constraint`          | `resolve-constraint` with its owner                                                              |
| `needs-human-decision`                | `decide`: take the trade-off, or the conflicting constraints, to the decision owner              |

Human approval points: before the simulation (the actors and the constraints reviewed — shown `done` only where Swarm
holds the record) and before acting (the validation plan done; a named approver — always `open`, because Swarm cannot
know). A question or constraint that mentions employment, credit, legal, medical or safety matters (from a small word
list and from legal, regulatory and safety constraints) is flagged and adds an approval point for a qualified person.
Swarm recommends and explains; it contacts no one, executes nothing and decides nothing.

## Epistemic labels

Every statement carries one of eight labels, with a plain-words tooltip: **fact** (a source’s own words found verbatim,
or a record Swarm holds and can show) · **source claim** (a source says so; unverified) · **assumption** (taken as given
by a person, or a Swarm default) · **model inference** (Swarm inferred it, by rules or a model) · **simulation event**
(something that happened inside the simulation) · **scenario possibility** (one way things could unfold in the simulation;
never a forecast) · **recommendation** · **validation requirement** (to be checked in the world before relying on it).
Nothing inferred, assumed or simulated is ever a fact. `LABEL_TABLE` in `shared/decision.ts` is the one mapping, and
`labelOf(namespace, value)` the one function; a test holds every namespace to the enum it maps.

| Namespace            | Value → label                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brief-origin`       | supplied-evidence, retrieved-public-evidence, historical-comparison → source claim · user-assumption, system-assumption → assumption · inferred-stakeholder, model-interpretation → model inference · actor-behavior, simulation-aggregation → simulation event · unresolved-uncertainty → validation requirement   |
| `claim-kind`         | source-fact → fact · extracted-claim → source claim · user-assumption → assumption · ai-hypothesis → model inference · simulated-event, analytical-conclusion → simulation event                                                                                                                                    |
| `statement-type`     | source-fact → fact · extracted-claim, contradicting-evidence → source claim · user-assumption → assumption · inferred-relationship, ai-hypothesis → model inference · simulated-event, analytical-conclusion → simulation event · recommendation → recommendation · unresolved-uncertainty → validation requirement |
| `trait-origin`       | evidence → source claim · user, system-assumption → assumption · model → model inference                                                                                                                                                                                                                            |
| `sensitivity-origin` | evidence → source claim · user, system-assumption, scenario → assumption · model → model inference                                                                                                                                                                                                                  |
| `constraint-source`  | user → assumption · extracted → source claim · inferred → model inference                                                                                                                                                                                                                                           |
| `constraint-basis`   | evidence-quote → **fact** (the server found the quote in the passage) · user-entry, question-quote, scenario-quote → assumption · actor-statement, category-prompt, model-reading → model inference                                                                                                                 |
| `frame-origin`       | rules, user → assumption · model → model inference                                                                                                                                                                                                                                                                  |
| `stakeholder-origin` | rules, model → model inference · user, scenario → assumption                                                                                                                                                                                                                                                        |
| `critique-origin`    | rules → validation requirement · model → model inference                                                                                                                                                                                                                                                            |

## The validation plan and the stop conditions

Derived by rules (`backend/src/decision/validation.ts`), sorted by priority, then source, then id, at most 12 items:

| Source                   | Kind                         | Priority    | From                                                                                                                      |
| ------------------------ | ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `unvalidated-constraint` | `constraint`                 | high        | a hard constraint that is unvalidated, assumed or unknown; open questions (medium)                                        |
| `flipping-assumption`    | `assumption`                 | high        | an assumption whose move could reverse the answer; other sensitive, unevidenced ones (medium)                             |
| `missing-evidence`       | `evidence`                   | high/medium | no source attached; evidence the scenario lists as missing; a high-influence or authoritative actor with no cited passage |
| `stakeholder`            | `stakeholder`                | high/medium | a role with high influence or authority and high uncertainty                                                              |
| `conflict`               | `evidence`                   | medium      | an open conflict between sources                                                                                          |
| `critic`                 | by role                      | high/medium | an independent-review objection, blocking or major, that stands                                                           |
| `status`                 | `assumption` / `stakeholder` | high        | what would tell tied options apart; which lens the decision owner values most                                             |

Each item says what to check, why, and how. **Stop conditions** are when to pause or stop and rethink: an unconfirmed
hard constraint turns out not to hold; a real measurement falls where it would reverse the answer; a role that can
decide or block says no when asked directly; a blocking objection cannot be answered; the first step cannot be undone;
anything the comparison did not include appears. All are labelled validation requirement.

## What the canvas can and cannot say

It can say what the simulation did under stated assumptions, how options compare on named lenses, what the evidence
and the constraints are, what could change the picture, and what to check. It cannot say what will happen; it never
reports a probability, a confidence level, a return or a measured rate; it never treats a simulated actor as a person
or its behaviour as a real person’s; it never treats a model inference as a source; and it does not decide.
Figures are counts or shares **of simulated members or of seeded runs**, and every sentence that sums up the simulation
says it is simulated. Every generated sentence passes the brief’s wording guard (`brief/lint.ts`) at build time; a
sentence that would not is replaced and counted in `canvas.withheld` (expected: 0). A person’s own words only ever
enter a sentence inside curly quotation marks.

Uncertainty is shown as named limits (runs per option, fidelity and its caveats, actors with high uncertainty,
findings that did not repeat, totals-only results), never as a number that looks like confidence.

Not in this version: a model-written synthesis (none is attempted, so there is nothing to withhold or to repair);
reversibility other than `unknown`; the other options re-run under a counterfactual view.

## The page

The canvas is the first thing the Decide scene shows, in every state of the brief beneath it, and holds the page’s one
level-one heading (“Decision view”). The brief is the **full report** below it, behind a plain “Full report” rule that a
button in the canvas’s own header takes the reader to; its headline and the headings of its blocks are one level lower,
and its chapters stay level-two headings, so nothing about the brief changes but where it starts.

**The first viewport** holds nine things, in the order a decision is read: the question; the current best answer (the
status as a word and an icon, with why and the conditions it holds under, never a colour alone); the most plausible
futures (scenario possibilities, never forecasts, with the four groups the simulated members ended up in as a bar and in
words); what drives them; the material constraints (where the gate stands, hard and soft, which nobody has confirmed,
which the simulation only read); who moves (simulated roles, never people); what could change the result (the
counterfactual views, the ones that could reverse the answer first, the assumption that could, and what the sensitivity
step moved and found, so that “no view was run” is never read as “nothing was tried”); the recommended next move (what
it rests on, with how many of its parts are stated and which are missing, and that reversibility is unknown); and what
to validate before acting (the checks, with the ones that come before acting first). Every figure is simulated members
in 100, or seeded runs.

At 1440 × 900 all nine are in the viewport, whatever the project holds: each part has a budget (two futures, two
drivers, two constraints, three roles, two views and one assumption, three checks), what does not fit is counted and one
press away (“4 views and 2 assumptions in full”), and what a person wrote is clamped to a few lines (the whole of it is
under “What this rests on”). On a narrow screen the question and the answer keep their place and the other seven fold
to one line each, in the same order; a line says what was tried, and never that nothing reverses the answer when
nothing was tried.

**Beneath the nine** are the detail, each in a disclosure: why this status (the rules, the first that applied, the
conditions), how the options compare on each lens, the recommendation in full, everything that could change the
result, constraints in full, who moves in full, the validation plan and when to stop, what the answer rests on
(including the question as it was asked and as Swarm framed it), what the independent review challenged, human
approval and what Swarm does not do, and what the labels mean. They are open on paper, so print opens on the canvas
with everything under it.

**Every statement carries its kind** (the eight labels above) as text, with a sentence for a screen reader (“Kind of
statement: assumption”); the meaning is in a popover for the pointer and in the page (the last detail) for everyone,
since a tooltip holds the only copy of nothing. Server, model and source text is only ever put in the page as text.

**States:** loading (the shape of the page); could not be read, with a retry and what had been read kept; no comparison
(“Nothing to decide from yet”: what is missing, the step that supplies it, the detailed report where there is one); a
comparison running (“Not ready yet”); the last one failed; a picture that describes the project as it was (what
changed, or that it cannot be told, and a way to run it again); a newer comparison running; and each of the six
statuses, provisional or not.

## Exports

When a brief is handed over as Markdown, a printable page or JSON, the canvas is placed first (`backend/src/decision/export.ts`),
before the brief’s own answer, so that print and PDF open on the decision picture.

## Tests

`decision-status.test.ts` (every status, every boundary, precedence), `decision-lenses.test.ts`,
`decision-build.test.ts` (the five worked examples through the real pipeline, labels, wording, completeness, the
validation plan, defensive participant reads), `decision-labels.test.ts`, `decision-routes.test.ts`,
`decision-export.test.ts`; on the page, `frontend/src/scenes/decide/canvas/*.test.ts(x)` (logic, render of every status
and state, the folded layout, a copy guard) and `e2e/lab/decide-canvas.spec.ts` (the nine in order in one 1440 × 900
viewport, every status, a phone, the states, paper).
