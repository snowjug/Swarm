# Independent review (critics)

The independent review challenges a finished analysis from seven angles. Critics never edit the
analysis, the stakeholders, the cast or the decision brief. Every criticism is shown with what it
rests on, any response, what disagreement remains, and what it would do to the conclusion if it
stands. Where there is one clear next step, it also carries the action it asks for
(`requestedAction`, optional). A criticism is a challenge, not a verdict, and a review with no
criticism does not show that an analysis is right: the checks look only for the faults listed below.

Swarm explores scenarios. It does not guarantee or precisely predict real-world behaviour, and a
critic cannot change that.

## Two kinds of critic

- **Rules critics** are fixed rules applied to the data. They are pure functions: the same scenario,
  stakeholders, cast, analysis and brief always give the same criticisms, with the same ids, in the
  same order. They need no model and no network. Every one has `origin: "rules"`.
- **The model critic** is optional. It makes one validated call with a compact digest of the
  analysis (finding ids and statements, the top sensitive assumptions, stakeholder names and
  categories, evidence excerpts with passage ids, the fidelity, and what the rules already raised).
  Its criticisms have `origin: "model"` and are a model's reading, not a measurement. See "The model
  critic" below.

Without a model the review is complete as far as the rules go. With one it can be deeper, never
different in kind: a model criticism can add an objection and has no way to edit a finding.

## What each critic checks

Each critic asks one question. Severities run `note`, `minor`, `major`, `blocking`; each rule's
severity is part of its definition and is listed here, with the limits it uses. The ids below are
stable: they are made from the rule and the thing it is about, never from a counter or the time.

### Evidence: is each important statement backed by the sources, and are the sources good enough?

| Id                                | Raised when                                                                    | Severity                                                       |
| --------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `evidence-uncited-stakeholders`   | Stakeholders that are not removed or background cite no source passage         | `major` if a key stakeholder is among them, else `minor`       |
| `evidence-single-source`          | At least 3 passages are cited and one document supplies more than half of them | `major` from four fifths, else `minor`                         |
| `evidence-unverified-web-sources` | A document came with a web address but was not fetched by this server          | `minor`                                                        |
| `evidence-open-conflicts`         | The source ledger holds conflicts that nobody has resolved or dismissed        | `major` if a cited passage comes from a conflict, else `minor` |
| `evidence-undated-sources`        | The scenario has a horizon and a document carries no `asOf` date               | `minor`                                                        |

Only a page this server fetched itself counts as retrieved public evidence. `retrievedAt` says when
a page was fetched, not how current it is, so it does not count as a date. When the ledger has not
been built, conflicts are not checked, and the review says so in a note instead of reading "no
conflicts" into the silence.

### Assumption: which assumptions carry the result, and does anything support them?

| Id                                | Raised when                                                                                                           | Severity                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `assumption-sensitive-<row>`      | A sensitivity row is `assumption-sensitive` and its value is not backed by evidence                                   | `major` for a system assumption; `minor` for a value a person set, a model proposed or the scenario states |
| `assumption-defaults-<actor>`     | A key actor nobody edited still has traits at their system default                                                    | `minor`                                                                                                    |
| `assumption-key-actor-defaults`   | The same, folded into one for all such key actors while the change cannot move anyone (see below)                     | `minor`                                                                                                    |
| `assumption-unconfirmed-impact`   | An actor's impact (harmed or benefited) is a system assumption or a model's proposal, and not zero                    | `major` if a key actor is among them, else `minor`                                                         |
| `assumption-no-registered-effect` | A repeatable "about the same" finding for a scenario that could move someone, with no sensitive intensity (see below) | `major`                                                                                                    |

An `assumption-sensitive` row whose origin is `evidence` is not criticised: something supports it.

### Methodology: are there enough repeated runs, and does the fidelity justify the wording?

| Id                                      | Raised when                                                                         | Severity                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| `methodology-change-cannot-move-anyone` | No scenario other than the baseline can move any actor (see below)                  | `major`, and it sorts before every other criticism  |
| `methodology-few-runs`                  | Fewer than 20 runs per variant                                                      | `major` below 10, else `minor`                      |
| `methodology-rules-only`                | The engine and the key actors are both rules                                        | `minor`                                             |
| `methodology-model-repeats`             | A model drove part of the behaviour and it was repeated no more than once           | `major`                                             |
| `methodology-unstable-findings`         | At least 2 findings, and at least a third of them, are `unstable`                   | `major` above one half, else `minor`                |
| `methodology-no-cross-check`            | No deeper run was compared with the repeated runs                                   | `minor`                                             |
| `methodology-cross-check-disagrees`     | The deeper run lies outside the range of the repeated runs                          | `major`                                             |
| `methodology-wide-intervals`            | A headline finding (one not about a single actor) has a 95% interval wider than 0.4 | `major` if its lower end is below 0.5, else `minor` |

The few-runs basis quotes the lower end of the 95% Wilson interval for a finding that holds in every
run, so that "few" is a number: with 10 runs it starts at 0.72.

"Rules only" is a statement of fidelity, not a fault of the engine: every outcome is a mechanical
consequence of the declared assumptions, and the wording of any result must say so.

### Stakeholder coverage: who is missing, and who was assumed rather than found?

| Id                                    | Raised when                                                                                                                           | Severity                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `coverage-missing-<category>`         | No stakeholder of that category (competitor, substitute, regulator, partner or channel) is in the set, while the scenario implies one | `major` if the scenario lists it as a likely stakeholder, `minor` if its own text only mentions it |
| `coverage-unmatched-likely`           | Stakeholders the scenario lists as likely match none in the set                                                                       | `major` if at least half are unmatched, else `minor`                                               |
| `coverage-uncertain-key-stakeholders` | A key stakeholder is marked highly uncertain                                                                                          | `minor`                                                                                            |
| `coverage-thin-cohorts`               | A cohort stands for at least 100 members and simulates at most 5                                                                      | `minor`                                                                                            |

"The scenario implies one" is decided by word stems in the scenario's own text (for a competitor,
words that begin `compet` or `rival`, and so on). The stems are a lens for asking "who else?", not a
list of answers, and they can miss a kind of stakeholder that the scenario implies without naming.
A listed stakeholder matches when more than half of its words are in a stakeholder's name, id or
category label.

### Bias: does the wording or the evidence lean one way without saying so?

| Id                            | Raised when                                                                      | Severity                               |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| `bias-one-sided-priors`       | At least 3 actors, and every prior stance is above zero or every one is below    | `minor`                                |
| `bias-one-sided-impact`       | At least 3 actors, and every impact is above zero or every one is below          | `minor`                                |
| `bias-single-viewpoint`       | At least 3 cited passages, all from one document                                 | `minor`                                |
| `bias-confident-wording`      | The brief uses "will", "certainly", "proves" or "guarantee" without negating it  | `minor` for "will" alone, else `major` |
| `bias-real-world-percentages` | A percentage in the brief's headline or a statement is not labelled as simulated | `major`                                |

Wording is checked in the brief's headline, its statements and its recommendations, but not in its
limitations, sources or technical appendix. "Does not guarantee" and "no guarantee" are disclaimers
and are not raised. A percentage is accepted when the statement says it is simulated (it mentions
simulation, runs, an interval or seeds) or its origin is a source, an assumption or a historical
comparison. A figure in a recommendation is an action, so only a recommendation's wording is checked.

### Recommendation: does each recommendation follow from a finding and say how to check it?

Raised only when a brief exists for the analysis being reviewed.

| Id                                  | Raised when                                                                                   | Severity |
| ----------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| `recommendation-no-finding-<id>`    | None of its linked findings is a finding of this analysis                                     | `major`  |
| `recommendation-no-validation-<id>` | It has no validation step and no experiment in the validation plan targets it or its findings | `major`  |
| `recommendation-no-owner-<id>`      | It names no owner function                                                                    | `minor`  |
| `recommendation-weak-basis-<id>`    | Every finding it rests on is `unstable` or `rare`                                             | `major`  |

### Adversarial: what would have to be true for the conclusion to be wrong?

| Id                               | Raised when                                                                                                     | Severity                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `adversarial-gap-<row>`          | One tested change in an assumption covers at least a quarter of the gap between no change and a proposed change | by the share covered, below                  |
| `adversarial-unstable-<finding>` | A finding is `unstable` (the first six)                                                                         | `major` for a headline finding, else `minor` |

The gap is recomputed from the runs, on the headline measure that the sensitivity rows are about:
the mean share of simulated members ending in "switch" or "resist" under the proposed variant minus
the same under the baseline. A row is set against that gap only when its base value matches the
proposed variant's mean to within 0.05 and its shift moves the measure toward closing the gap, so a
row about some other measure is left out rather than compared with the wrong thing. The gap must be
at least 0.05. The criticism names the one assumption whose tested change covers the most of the gap,
with the numbers, and, if the effect is linear, how big a change would close it. Severity: `minor`
from a quarter of the gap, `major` from a half, and from the whole gap `blocking` when the assumption
is not backed by evidence (`major` when it is).

## When a comparison cannot say anything about the change

Two rules guard against reading a result that the assumptions could not have produced.

**The change cannot move anyone** (`methodology-change-cannot-move-anyone`, methodology, `major`).
An actor moves under a scenario only when the scenario is not the baseline, its intensity is above
nothing, and the actor has a direction of impact that is not zero: the actor's own `impact` trait, or
the scenario's figure for that actor where it gives one. That test is `changeCanMoveAnyone` in
`shared/signal.ts`, the one the page and the brief use too. Where no scenario and actor meet it, every
difference from no change is noise, and so is a finding that the two are "about the same", however
repeatable it looks. The review says so once:

- When no actor has a direction of impact at all, the objection and the requested action are the two
  sentences of the shared notice (`NO_DIRECTION_NOTICE`), word for word: what is wrong, and then to
  say who is helped or harmed in the stakeholder review, or to read the evidence with a model, before
  reading anything into the results.
- When someone has a direction but no scenario has both an intensity and an actor it affects, the
  objection says that instead, and asks for a scenario with an intensity that affects someone. It never
  claims that nobody has a direction when somebody does.
- The basis counts the actors with a direction, lists the scenarios other than the baseline with
  their intensities, and quotes the first finding about the direction of the change. The stated effect
  is the strongest the review can give: nothing in the comparison is about the change, so the
  conclusions drawn from it do not follow.
- It sorts before every other criticism, a `blocking` one included, and the page shows it first, in a
  section of its own above the controls and the summary. Its id is exported as `CHANGE_CANNOT_MOVE_ID`
  in `shared/critique.ts` so that the page and the server agree on which one it is.
- While it stands, the per-actor `assumption-defaults-<actor>` criticisms are folded into one `minor`
  criticism, `assumption-key-actor-defaults`, which names up to four of the actors and how many of
  their traits are defaults. A dozen minor items would otherwise bury the one that matters. A response
  given to a per-actor criticism is dropped with it when the review changes over, as for any
  criticism that no longer applies.

**"No difference" that the assumptions may be too weak to show** (`assumption-no-registered-effect`,
assumption, `major`). A finding about the direction of the change that says simulated members ended
up "about the same" as under no change, and that holds in enough runs to be `repeatable` or
`mostly-repeatable`, is a result about the change only if the assumptions could have produced a
difference. When some actor does have a direction under that scenario and its intensity is above
nothing, the review says that the assumptions may be too weak to register an effect, and asks to raise
the intensity of the change or to check the impact each actor is given, then to compare again. It does
not claim that they are too weak, only that nothing shows they were not. It is raised once, however
many scenarios came out the same, and its target is the first such finding. It is not raised:

- when sensitivity already showed that a change in the intensity moves the result: that is an
  `assumption-sensitive` row, with a criticism of its own;
- for a finding that holds in only some runs (`unstable` or `rare`), that is about one actor, or that
  does not say "about the same";
- for a scenario that cannot move anyone, or when nobody has a direction: the first rule says more.

The basis quotes the finding, how often it held and its interval, the intensity of the scenario and
how many actors have a direction, and what sensitivity did to the intensity, or that it did not test
it.

## The model critic

One call through the validated, untrusted-data path. The digest is data, never instructions, and
the instructions never contain text taken from a document or an analysis. The server then checks
the reply:

- A criticism may name only ids the digest held (a finding, a stakeholder, a sensitivity row, the
  analysis) and only passage ids the digest held. Anything else is **dropped**. If every criticism
  names something that was not given, the whole reply fails its check and is repaired or refused.
- Each carries a basis (one to six lines). A reply without one fails its check.
- Severity is capped at `major`: a model's reading can raise a concern but never blocks.
- At most 12 are kept. Each gets an id from its critic, its target and its wording, so the same
  criticism offered again keeps its response, and a differently worded one is a different criticism.
- Evidence passage ids are replaced by the real passages, with their quotes, so a criticism cannot
  invent a quotation.

If the model is not configured, fails, is refused by the project's model budget, or returns nothing
usable, the rules criticisms are shown with a note that says why. Nothing is replaced silently. Model
calls count against the project's budget like any other.

## Responses and status

A person with the capability to edit the experiment answers a criticism with
`PUT /api/projects/:id/critiques/:cid/response` and a body of `text` (required), `status` and
optionally `remainingDisagreement`:

| Status      | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `open`      | Nobody has answered. The impact applies if the objection stands.                        |
| `responded` | Answered, but not settled. The objection and its impact stay in view.                   |
| `accepted`  | The objection stands, so its impact applies to the conclusion.                          |
| `disputed`  | The objection is disputed. The disagreement stays visible, with what is still disputed. |

A later response replaces an earlier one. Responding never changes the criticism's wording, severity
or basis.

**Running the review again keeps responses.** A criticism that comes back with the same id keeps its
status, response, remaining disagreement and the time it was first raised, including a response
given while a model review was still working. A criticism that no longer applies is dropped, with its
response. A response is kept even if the numbers in the basis have moved, and it shows the day it was
written, so a reader can tell it is older than the criticism's current wording.

## Where it lives

- The review is one artifact of kind `critiques` per project, key `default`. Running it again
  replaces the set; the history of who ran and answered is in the audit log.
- `POST /api/projects/:id/critiques/run` takes `{ analysisId?, useModel? }`. Without `analysisId` it
  reviews the newest finished analysis. A project with no finished analysis gets a plain 409.
- `GET /api/projects/:id/critiques` answers 200 with `critiques: null` when there is none, the
  newest finished analysis (so that a review of an older one can be called out of date), what the
  caller may do, and whether a model is configured.
- Reading needs `read`, running `run`, responding `edit`. A reviewer reads and does not run or edit
  what they review.
- The audit log records `critiques.run` (analysis id, counts, whether a model was asked for and
  failed) and `critique.responded` (critique id, critic, status). It never records the words of a
  criticism or of a response.
- At most 100 rules criticisms are kept (the least severe are left out, and the review says so) and
  at most 12 model criticisms, so a set always fits the stored document. They are ordered most severe
  first, then by critic, then by id, except that the criticism that the change cannot move anyone
  comes before all of them. The page shows that one first, in a section of its own, groups the rest
  by critic, headed by the question that critic asks, and shows counts by severity and by status.

## What the critics cannot do

- They cannot tell whether a source is true. They check where evidence came from, how it is spread
  and whether sources conflict, not whether any of it is right.
- They cannot find a stakeholder that nothing in the scenario implies, and the stems that decide what
  the scenario implies are lexical.
- The wording and percentage checks are lexical. They can miss a confident claim phrased another
  way, and can raise a "will" that is harmless.
- The gap check compares a gap with a shift on one measure. It uses a linear reading of a single
  test, which is a way to size a change, not a prediction of what a change would do.
- "About the same" is recognised by the words of the finding the analysis wrote, not by a field. A
  change in that wording has to be followed here. The no-effect check also cannot tell weak
  assumptions from a real null: a change that helps some actors and harms others by the same amount
  also ends up "about the same", and gets the same prompt to look at the intensity and the impacts.
- A model criticism is checked against ids, not for being right.
- The review does not run on its own when an analysis, the stakeholders or the brief change. The page
  says when a review is of an earlier analysis; it does not say when the stakeholders have changed
  since.
- Nothing here is a measure of confidence. The severities are fixed by the rules above, and the
  numbers in a basis are the checked facts.
