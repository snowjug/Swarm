# The Decision Canvas

The Decision Canvas is the answer-first picture of a decision: the first thing the Decide scene shows. It
says what the simulation shows, which option (if any) it supports, under which assumptions and
constraints, what weakens that, what would invalidate it, and what to check before anyone acts.
It is derived, not stored, and it is built entirely by rules: no model writes any of it. It explores scenarios and
decides nothing about a person’s employment, credit, legal, medical or safety situation: a question about one is
met by a deterministic scope check, with a notice, a human decision as the status and no option named (see
[What Swarm does not decide](#what-swarm-does-not-decide)).

> Explore scenarios, not predictions.

Code: `shared/decision.ts` (the contract, the labels, the status words and rules), `backend/src/decision/*`
(the pure builder, with the scope check in `scope.ts`, `scope-cues.ts` and `scope-words.ts`),
`backend/src/routes/decision.ts` (`GET /api/projects/:id/decision`), `frontend/src/scenes/decide/canvas/*` (the page).

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
| the question and the scenario frame   | the scope check: which matters the question touches and whether it is about one person               |

Nothing is written, so a canvas is never older than what it describes. When the comparison was run before the
scenario, the stakeholders, the actors or the constraints changed (compared by revision, as the brief does), the canvas
says so, and it cannot be `robust-option`. With no finished comparison the route answers `canvas: null` and a
`readiness` that says what is missing and which step supplies it; the status rules still apply to that case and give
`insufficient-evidence`, unless the question is about one person, which is the first rule and gives
`needs-human-decision` with or without a comparison. The readiness carries the `scope` too, so the notice is on the page
before there is anything to decide from.

## The decision status

Exactly one of six. The rules are tried in this order and the first that applies wins. They are written as data in
`STATUS_RULES` (`shared/decision.ts`) and a test holds the table to the code.

| #   | Rule id                 | Applies when                                                                                                                                | Status                       |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | `individual-decision`   | The scope check reads the question as a **decision about one person** in a matter of employment, credit, legal, medical or safety.          | `needs-human-decision`       |
| 2   | `no-analysis`           | There is no finished comparison with recorded runs, or it holds only one option.                                                            | `insufficient-evidence`      |
| 3   | `gate-blocked`          | The constraint gate, worked out now, is blocked (an unsettled hard legal, regulatory or safety constraint; or every alternative ruled out). | `blocked-by-hard-constraint` |
| 4   | `all-violate`           | Every alternative violates a **confirmed** hard constraint.                                                                                 | `blocked-by-hard-constraint` |
| 5   | `no-direction`          | The comparison cannot tell the change from no change because no stakeholder has an expected direction of impact.                            | `insufficient-evidence`      |
| 6   | `evidence-insufficient` | The evidence reading is `insufficient` (see below).                                                                                         | `insufficient-evidence`      |
| 7   | `hard-conflict`         | Two live **hard** constraints cannot hold together.                                                                                         | `needs-human-decision`       |
| 8   | `value-tradeoff`        | Two lenses each have a **different clear leader**.                                                                                          | `needs-human-decision`       |
| 9   | `no-clear-leader`       | The headline lens has no clear leader (a tie within run-to-run variation, fewer than 10 runs, or the change cannot be told from no change). | `multiple-plausible-options` |
| 10  | `robust`                | One option is the clear leader on the headline lens **and none of the conditions below applies**.                                           | `robust-option`              |
| 11  | `conditional`           | One option is the clear leader on the headline lens and at least one condition applies. The conditions are listed.                          | `conditional-option`         |

Rule 1 comes before everything, including a missing comparison, a blocked gate and insufficient evidence: whatever else
is true, a decision about a person’s employment, credit, legal, medical or safety situation is for a qualified person,
and no other reading may put a recommendation or a different status in front of that. It names no leader and no
preferred option.

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

## What Swarm does not decide

Swarm explores scenarios. It does not make or recommend decisions about a person’s employment, credit, legal, medical
or safety situation; a qualified person must decide. The canvas is the last thing a reader sees before acting, so it
checks for this itself. `consequentialScope(question, scenarioFrame)` (`backend/src/decision/scope.ts`) is pure,
deterministic and uses no model. It returns `{ domains, aboutIndividual, basis }`:

- **`domains`**: which of the five matters the question or its framing speaks of. It reads the question and the frame’s
  decision, requested decision, system and the labels and descriptions of its alternatives, clause by clause (a clause
  ends at a sentence, a list item, a comma or a word such as _if_, _because_ or _but_). Every cue is a whole word or
  phrase; the word tables are data in `scope-cues.ts`.
- **`aboutIndividual`**: true only when, **in one clause**, an _act or matter_ of one of the five and a _reference to one
  person_ stand together.
- **`basis`**: the cues found, a few words each (`employment: “fire”`, `employment: “make redundant”`,
  `about one person: “this employee”`), and **never a name**: a cue is made of the words of the act (“promote”, not
  “promote Priya Raman to head”), a person is said as `a named person`, a pronoun or a role, and a last guard removes any
  word that is a name in the text it was read from. The same cues stand in the status’s reasons, the approval points, the
  page and every export, so none of them repeats a name.

| Domain       | Cues (families, not the whole list)                                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `employment` | hire, dismiss, sack, terminate (an employee), fire (a person: “fire up” and “fire safety” are not), lay off, let go, make redundant, part ways, demote, discipline, promote (a person), a raise, rank or reject applicants |
| `credit`     | loan, mortgage, overdraft, lend, underwrite, credit limit, score or check, a credit or loan application, approve or decline a card or account, borrow                                                                      |
| `legal`      | sue, lawsuit, litigate, legal advice, action or dispute, contract dispute or breach, convict, sentence, bail, custody, evict, deport, arrest, prosecute, press charges, cancel a visa                                      |
| `medical`    | diagnose, treat (a patient), prescribe, dose or dosage, medication or a class of drug, symptoms, surgery, therapy, hospitalise, a quantity in mg or ml                                                                     |
| `safety`     | safety-critical, life-threatening, injury, fatal, unsafe, evacuate, “safe to” do something, fit for duty, emergency shutdown, grounding, safeguarding                                                                      |

**An act, and a field.** A word for the field and not for an act (_recruitment_, _layoffs_, _lender_, _patients_,
_hospital_, _court_, _hazard_, _credit scoring_, _promotion criteria_) calls for the notice and never pairs with a
person. So does a cue that is followed or preceded by a word for a rule, a process or a market (_hiring policy_,
_lending criteria_, _triage protocol_, _credit card market_, _medical device launch_). A bare _safety_, _medical_,
_credit_ or _fire safety_ names nothing at all.

**One person** is read from four kinds of words, in the order the code has them (`scope-cues.ts`, `scope-people.ts`,
`scope-generic.ts`; the word tables are data, not logic):

1. **A construction that says the act and the person in one** (`scope-people.ts`). A verb or a matter of a domain, and a
   person put where the construction puts one: _promote_ a person or a role (and “promote Notion to our teams” is not one:
   a name after _promote_ is a person only when a post follows or the name is a given name); _appoint_, _reprimand_;
   “keep … on”; “put … on probation, notice or a plan”; “report … to HR” (employment) or “to the police” (legal);
   “settle with”; “press or file charges against”; _discharge_, “admit … to the ward”, “operate on”, “put … on a
   ventilator”; “let, send or keep the patient home”; “let, allow or clear … operate, drive, fly, work”; _ground_; a matter
   that a person has (“his claim”, “the nurse’s hours”, “Mr Okafor’s mortgage”), is given (“give her a raise”, “lend Maria
   the money”) or is denied them (“offer the job to the second candidate”, “refuse service to this customer”, “sponsor this
   candidate’s visa”); “let … go”, “make … redundant”, “part ways with”, “replace”, “repossess”, “refer … to a specialist”.
2. **A person read where they stand** (`scope-generic.ts`), beside any act or matter in the clause. A pronoun (“he”, “she”,
   “him”, “his”, “her”; “he”/“she” as the one who does the act, as in “if she hires …”, is not the one it is done to); a
   **name**: a capitalised word that is not a title, a day, a place, a language or a well-known organisation or product,
   put where a person is put (after a verb, or after “to”, “for”, “with”, “against”; not after “in”, “at”, “from”, “the”
   or “our”), or after “and”/“or” another name (“Ananya or Rohit”), or as the subject of “should X get …” when it is a given
   name or said to get, deserve, qualify or be eligible; a **role** with “this”, “that”, “the”, “my”, “our”, “his”, “her” or
   “your”, with qualifiers (“the second candidate”, “our oldest developer”, “the former employee”) and not when a word of a
   process follows (“the employee handbook”) or when the role acts (“how would the customer react”); “an employee who”,
   “someone who”; “fire, dismiss or evict **an** employee” (a punitive act said in the indefinite is still about someone,
   unless the question asks how to go about it); a plural surname (“foreclose on the Nguyens”); **the person that the
   question asks about**: “who should we …”, “which of our two engineers should we …”, “which one do we …”, “who should be
   …”; and the asker’s own matter (“do we file for divorce”, “should I contest my father’s will”, “start eviction
   proceedings”, “should I quit my job”: that is the asker’s own employment situation, and the cost of reading it as one
   person’s is a more careful canvas, so it is read).
3. **A matter that is a person’s only when a person stands in the clause.** A notice, severance, part-time, unpaid leave, a
   secondment, “step down”, “resign”, a second chance, an interview, a suspension; an interest rate, a payment holiday,
   a repayment, “write off”; a settlement, evidence, a plea deal, probate, a tenancy; a biopsy, dialysis, a ventilator, a
   feeding tube, blood thinners, insulin, “be discharged”; “unsupervised”, a forklift, a crane, a ladder, “safely”,
   “a safe pilot”. These are everyday words in other uses, so they count only beside a person, and never before a word for
   a policy or a process (“notice period policy”).
4. **A phrasal verb of a domain, with the person between its words, after them, or put first**, up to four words between:
   “make … redundant”, “let … go”, “lay … off”, “take … off the project / the ventilator / the line”, “put … on notice / a
   plan / the night shift / a ventilator”, “write … off”, “turn … down”, “sign … off”, “call … in”, “stand … down”,
   “pass … over for promotion”, “ask … to step down or leave the company”, “refer … for a biopsy”, “admit … overnight”,
   “wean … off”, “clear … to dive”, “stop … from driving”, “let … alone or unsupervised”, “hand … over to the police”, “take
   … to court”, “throw … out of the flat”. So “Should we make Tom Becker redundant?”, “Should we make redundant Tom
   Becker?”, “Who should we make redundant?”, “We must make redundant the engineer who was late.” and “Which of our two
   engineers should we make redundant?” are read the same, and so are the same words said of a thing (“make our legacy
   servers redundant”, “turn down the volume”, “sign off the budget”), which have no person and are not.

A role that is a matter of its domain by itself (patient, defendant, plaintiff, suspect, prisoner, claimant, borrower)
counts as an act of that domain. A group (“our employees”, “all new hires”, “applicants”), a policy and a process are not
one person, and neither is a capitalised title, day or word of an organisation taken for a name.

**Which way the check errs.** A false positive costs a more careful canvas (a notice, “a qualified person decides this”,
no preferred option, the exploration still shown); a false negative costs Swarm sounding as if it recommended “promote
Priya”. So where the signal is structurally specific (a name, a pronoun, a role with “this”, “the”, “my” or “our” beside a
decision verb or an act of a domain), the check reads a person; where the question is about a policy, a group, a
market, a product or an organisation, it does not. The notice for a matter with no person is at least as generous as
the forcing: whatever forces also lists the domain.

| Question                                                      | `domains`    | `aboutIndividual`                 |
| ------------------------------------------------------------- | ------------ | --------------------------------- |
| Should we fire this employee?                                 | `employment` | **true**                          |
| What happens if we change our hiring policy?                  | `employment` | false: a policy, so a notice only |
| Should we approve the loan for Maria Gomez?                   | `credit`     | **true**                          |
| What happens to our lending criteria if rates rise?           | `credit`     | false                             |
| Should the clinic prescribe a higher dosage for this patient? | `medical`    | **true**                          |
| What if we change our triage protocol?                        | `medical`    | false                             |
| Should we evacuate the building when the alarm sounds?        | `safety`     | false: no person                  |
| Is the credit card market growing?                            | none         | false: a word in common           |
| What would a safety culture programme change?                 | none         | false                             |
| Should we let go of the legacy billing system?                | none         | false                             |
| Which of our two engineers should we let go?                  | `employment` | **true**                          |
| Who should we make redundant?                                 | `employment` | **true**: the person is “who”     |
| Should we make our legacy servers redundant?                  | none         | false: a thing, not a person      |

**What the canvas does with it.**

- **`domains` is not empty, `aboutIndividual` is false.** A calm scope notice, in the canvas data (`scope.notice`), at the
  top of the page and in every export: “Swarm explores scenarios. It does not make or recommend decisions about a
  person’s employment, credit, legal, medical or safety situation; a qualified person must decide.”, with the matters
  matched. The human-approval point is stronger: a person qualified in the matter (`approve-qualified`: a human resources or
  employment-law professional, a credit decision-maker, a lawyer, a clinician, a safety professional) reviews anything
  that touches it before it is acted on, besides the named approver. The status is whatever the simulation gives.
- **`aboutIndividual` is true.** Rule 1 `individual-decision` forces `needs-human-decision` and says why, with the cues.
  No leader and no preferred option is named; the options are shown as explored and **not ranked**. The recommended next
  move is replaced: “A qualified person decides this; here is what the exploration can and cannot tell them.” (the kind
  is the status’s own, `decide`; the words say which person), followed by what it can tell them (how the simulated roles responded under the stated assumptions;
  which assumptions the result is most sensitive to) and what it cannot (what is right, fair or lawful for this person;
  how this person responds, since a simulated role stands for a group; whether a decision follows the rules that apply).
  The validation plan starts with a high-priority check to have the qualified person decide, and a stop condition says
  the same. The rest of the canvas (futures, drivers, constraints, who moves, the validation plan) is shown as
  exploration, with every epistemic label as before; no view or assumption is said to reverse a choice that is not made.
- **No canvas yet.** The readiness carries the same `scope`, so the notice is on the page before there is anything to
  decide from, and the status there is the same human decision, not “insufficient evidence”.

It blocks nothing and refuses nothing: project creation is not touched, and the picture is still there.

**Limits, stated plainly.** Rules that read words cannot be complete and this is not. It recognises questions in the
words it has, and the tables below say what it does and does not.

- **In-sample, and measured on first pass.** Every table in the tests is _in-sample_: its rules were corrected until it
  read as it should, so it shows that a fix holds and not how well the check does on questions nobody has written. The
  honest numbers are the **first pass** over each round of fresh questions, before its fixes, one person against one that
  is not: round one (written after the first set of constructions): 54 of 72 read as one person (75 %), none of 54
  look-alikes; round two (before the generic person finder): 32 of 81 (40 %), none of 77; the same round after the
  generic finder: 66 of 81 (81 %), none of 77; round three (written after it, for phrasal verbs and the person put first):
  67 of 75 (89 %), none of 64; round four (other ways of asking: a context sentence first, “whether to”, “my”, a passive):
  19 of 30 (63 %), **one** of 20 look-alikes (“give notice to our landlord”, since fixed); round five (short questions in
  a reviewer’s style, other roles, verbs and domains): 28 of 40 (70 %), none of 20. Each round found families the rounds
  before had not, and the first pass has not settled above about 90 %. The reviewer keeps a separate
  held-out set; its numbers are theirs, and these are not a forecast of them.
- **The matter is in another sentence than the person.** “Priya has been late six times this month. What should we do about
  her?” has a person and no matter in the clause that asks. Nothing is carried from one sentence to the next.
- **A person and a decision verb, and no matter.** “Should we keep him?”, “Should we reject her?” name nothing of the five.
- **An act with no word of the five domains.** “Was the nurse right to refuse the transfer?”
- **A matter that is not one of the five.** A school (“expel a student”), housing beyond eviction, benefits, a visa
  other than as a legal matter. The notice says employment, credit, legal, medical and safety only.
- **Names.** About 700 given names of many regions are known, and a capitalised word put where a person is put is read as a
  name beside any act or matter, so an unknown name is read (“terminate Ravi”). A word that is a name and is also a
  place, an organisation or a product is read as a person where no list knows it (“hire Accenture” is not, since the
  list does; “sue Acme” is), which makes the canvas more careful and not less. A name in lower case or in capitals is not
  read as one (all-capitals text is read in lower case). A name that is the subject of “should X get …” is read when it is
  a given name or the verb says what a person does.
- **Other languages**, and other spellings of a role, are not read.
- **How much is read.** The first 40 clauses of the question and its framing together, and the first 12,000 characters of
  each text: what is said only after that is not read (a test says so). The check runs on every canvas read and is
  linear and bounded: every pattern begins at a word, a name has at most three words, the words between those of a
  phrasal verb at most four, and a test reads ten-kilobyte hostile texts of thirteen shapes (a long word, a gap, a
  comma every word, a paragraph per line, a name over and over) in well under a second each. A steady read of such a text
  is about a tenth of a second on a busy machine; the first read in a process compiles the rules and takes a few hundred
  milliseconds.
- **More careful than needed.** It reads some things as a person that are not (“who should we hire for the new role” asks
  about whoever is hired; a single capitalised organisation after _sue_), because the cost of missing a decision about
  a person was judged higher than the cost of a notice that is not needed; the cues are listed in the Approvals detail
  so that a reader can see why.

The check is a safety net, not a classifier of the person’s situation: a qualified person decides every such matter
whatever it says, and the notice says so whenever any matter is found. `STILL_NOT_READ` in
`backend/test/support/scope-cases.ts` keeps the known misses on record.

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
sentence, and the card lists the missing parts, so a gap is a finding and never an omission: every part is either
stated or in `recommendation.missing`, and nothing is in the list that is stated. Reversibility is `unknown` in this
version (nothing in the project says whether a choice can be undone, and the canvas does not guess), and a part that says
only that something is not known is a gap and not a part stated, so **the data lists `reversibility` in `missing` for as
long as it is unknown**. The list is the single source: the page and the exports count and word it with the same function
(`recommendationCompleteness`, `shared/decision.ts`), so “N of 9 parts stated” is nine less the length of the list and
no screen adds a gap of its own: “7 of 9 parts stated · Missing: Evidence that weakens it, Reversibility (unknown)”.
The nine are `CARD_PARTS`; `RECOMMENDATION_PARTS` is the eight that hold statements.

| Status                                | The recommendation (`kind`)                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `robust-option`, `conditional-option` | `proceed` with the option in steps that can be checked, or `keep-no-change` when no change leads                                                                                               |
| `multiple-plausible-options`          | `hold`: do not choose between them; test what separates them                                                                                                                                   |
| `insufficient-evidence`               | `gather-evidence`                                                                                                                                                                              |
| `blocked-by-hard-constraint`          | `resolve-constraint` with its owner                                                                                                                                                            |
| `needs-human-decision`                | `decide`: take the trade-off, or the conflicting constraints, to the decision owner; for a decision about one person (rule 1) the same kind, and the words say that a qualified person decides |

Human approval points: before the simulation (the actors and the constraints reviewed — shown `done` only where Swarm
holds the record) and before acting (the validation plan done; a named approver — always `open`, because Swarm cannot
know). Where the scope check finds employment, credit, legal, medical or safety matters, or a legal, regulatory or
safety constraint says so, a third point is added and stays open: a person qualified in the matter reviews before
anything is acted on, named by matter (a clinician for a medical one, a lawyer for a legal one). For a decision about
one person it reads “A qualified person decides”, and the named approver agrees to act on that. Swarm recommends and
explains; it contacts no one, executes nothing and decides nothing.

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
| `scope`                  | `stakeholder`                | high        | a question about one person: have a qualified person decide it, with this view as one input (always first)                |
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
anything the comparison did not include appears; and, for a decision about one person, this view is used in place of
the decision of a qualified person. All are labelled validation requirement.

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
reversibility other than `unknown`; the other options re-run under a counterfactual view; a note at the Ask step (the
scope check runs on the server and the Ask scene reads nothing from it, so the notice first stands on the Decide page);
a scope-aware **brief**: the full report beneath the canvas is the brief as it was written, and for a question about one
person it may still carry its own conditional recommendation. The notice above it, the note on the bridge and, in an
export, the notice paragraph before it say that what Swarm does not decide applies to everything below.

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

**What Swarm does not decide** has its place in every one of those states. Beside the title, in the free space of the
line and on a line of its own when narrow, is the scope notice (a note, not a refusal) with the matters matched; it is
there with no comparison, while one runs, and over an old picture kept after a failed read. For a decision about one
person the answer says “Needs a human decision” with the cues behind it; the options read “Not ranked”; the next move is
“A qualified person decides this; here is what the exploration can and cannot tell them”, with one thing it can tell them
and one it cannot at a glance (the rest are under “The recommendation in full”); and the approvals detail lists the
matters, who reviews each and the cues the reading rests on, and says that the rules read words and are not complete.
The bridge to the full report carries a note that the notice applies to everything below it.

## Exports

When a brief is handed over as Markdown, a printable page or JSON, the canvas is placed first (`backend/src/decision/export.ts`),
before the brief’s own answer, so that print and PDF open on the decision picture. Where the scope check found a
matter, a “Scope.” paragraph with the notice and the matters follows the line that says the picture explores and does not
predict; for a decision about one person what the exploration can and cannot tell comes after the recommendation; and the
closing paragraph carries the notice and the cues, or says that nothing in the question or its framing pointed to such
a matter and that Swarm still does not make the decision. After the recommendation a line says how many of its nine parts
are stated and which are not (“7 of 9 parts stated. Missing: Evidence that weakens it, Reversibility (unknown).”), in
the words of the page. The JSON export holds the whole canvas, `scope` and the card’s `missing` list included.

## Tests

`decision-status.test.ts` (every status, every boundary, precedence, rule 1 before every other),
`decision-scope.test.ts` (the original tables of 135 questions, one person and not, in all five matters, with the
look-alikes; the reviewer’s own questions: 12 that were missed, 13 that were read and 10 about a policy; 293 fresh
one-person questions in five rounds, 114 of them with the person said as a pronoun, an ordinal or qualified role, or a
possessive, and 234 look-alikes in the five domains and in ordinary business, none of which may be read as one person;
the phrasal verbs in both positions and with the person put first; **500 questions made from 20 names and 25 templates**,
none of whose cues, status reasons, approval points or section may hold a word of the name, titles, hyphens and
apostrophes included, and the same for names in the framing; the basis; the same answer every time; speed on hostile
ten-kilobyte text and what is read of a long one; the canvas section; the limits on record in
`backend/test/support/scope-cases.ts`), `decision-lenses.test.ts`, `decision-build.test.ts` (the five worked examples
through the real pipeline, labels, wording, completeness, the validation plan, defensive participant reads, a decision
about one person end to end), `decision-labels.test.ts`, `decision-routes.test.ts`, `decision-export.test.ts` (the notice
in Markdown, HTML and JSON, and its absence where there is no matter; no name in a cue anywhere that is handed over, only
where the question is quoted); on the page, `frontend/src/scenes/decide/canvas/*.test.ts(x)` (logic, render of every
status and state, the notice with and without a canvas, one person against a matter in general, the folded layout, a copy
guard) and `e2e/lab/decide-canvas.spec.ts` (the nine in order in one 1440 × 900 viewport, every status, a phone, the
states, paper, the scope notice at both sizes, and a phrasal verb with the person put first and a name never repeated).
