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

The panel for all of this sits at the top of the Environment stage. It is small until it is opened: a
title with four counts (how many stakeholders were **found**, how many **need review**, how many are
**approved**, how many **actors** there are), one button for the next step, and two toggles that open the
list and the actors. It never pushes the stage's own _Start Simulation_ button off the screen, and on a
phone the counts come first. A project that never opens it behaves exactly as before.

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

A mention counts only in a line that **says something**. Text taken from a web page also holds menus,
navigation boxes, tables of contents, rows of links and footers, which are made of the same words as a
sentence about a group and say nothing about it. They are told apart by their shape, not by any word:

- a line of three or more words that are nearly all capitalised, with no full stop, is a **list of names**
  (a menu row, a row of a table of contents), and no group is found in it;
- a line of up to three words with no full stop is a **heading** when it stands between sentences, which
  introduces what follows, so a group it names is found; next to another such line it is a menu entry or
  an outline, and is not;
- five or more capitalised words in a row are a list of names, never one name, except in a sentence written
  all in capitals that reads as prose (it ends like a sentence and a third of its words are function words,
  as in "THE CUSTOMERS WILL PAY MORE AND THE SUPPORT TEAM WILL LOSE STAFF."): there every word has a
  capital, so a capital says nothing, and only the words the lexicon lists describe a group. A menu, a
  footer or a row of names in capitals has too few function words and stays a list;
- a person's own bulleted list of groups is kept, an item each;
- a link is not read: a word in its path ("example.org/users/support") is not a word of the sentence.

A role word is also **not a group** when the line only uses it to say something else:

- it starts a compound that names a thing: a word the lexicon lists straight after it ("customer survey",
  "user interface"), or, after a role word in the singular, a noun for what a group has or sets ("admin
  controls", "admin panel", "reseller rates", "customer record"). "Customers control the rollout" stays: a
  plural subject and a verb. A noun that is also a verb ("the admin controls access") makes a compound only
  when no article or possessive stands before the role word;
- a count stands straight before it ("a firm with about 4,200 employees", "more than 500 members"), which
  says how many there are, not who they are;
- it is only the tail of a title for a function: a position that any organisation has (a manager, an
  employee, a member) straight after a noun that names a thing ("account manager", "records manager",
  "customer success manager"). "Sales manager" stays, since _sales_ is a describing word the lexicon knows.

What it decides, and how:

| Question        | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category        | From the role word and a modifier that signals a kind (a security reviewer is governance, a rival is a competitor). An end user whose sentences keep speaking of paying, gaining or being exposed (at least two sentences with the same cue) is read as that.                                                                                                                                                                                                                                                                                                                |
| Priority        | **Key** for a decision maker, a regulator, a competitor, and the two groups named in the most sentences (at least two); at most eight in all. **Standard** if named in two or more sentences or by the scenario; otherwise **background**. A role that names a position in any organisation (a manager, an employee) with nothing at stake for it in its sentences starts as background. It is a rule, and each stakeholder says so.                                                                                                                                         |
| Size            | A **placeholder**: 1 for a key actor, 100 for a standard cohort, 25 for a background one. It is an assumption, shown as one, never a count.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Expected impact | **Read from the wording** of the sentences cited for the group: words of concern (worried, objects to, pay more) give _harmed_, words of welcome (welcomes, saves, benefits) give _benefited_, both give _mixed_. A word turned round by a negation ("no concern") does not count. The rationale quotes the words counted and says it is a reading of tone, not a finding. With no such word the direction comes from the category only, and says so: a group that bears cost is assumed harmed, a beneficiary benefited, every other category has no direction (_unclear_). |
| Same group      | A name that is another with describing words in front ("Analyst" and "Independent analyst") in the same category, with no other longer name it could belong to, is folded into it and kept under _Removed_, so the fold can be seen and undone. Different words for one idea ("staff", "workers", "employees") stay apart: only a person can say they are one group.                                                                                                                                                                                                         |
| Relations       | Derived from categories, and worded "Assumed from categories, not found in the sources".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Evidence        | Up to four verbatim quotes for a group, each checked against the passage it was taken from. Those that carry a cue are chosen first, so that the direction can be seen in what is cited.                                                                                                                                                                                                                                                                                                                                                                                     |
| Missing groups  | A category with no stakeholder is listed as a **gap**: a prompt to look, not an error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Text for an AI  | A sentence that addresses an AI system is not read, and the person is told which passages had one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

At most 25 stakeholders are proposed. Whatever is set by rule or taken from a category (the priority, how
directly the group is affected, the size, a direction that is not read from the wording) is said to be so in
the stakeholder's **assumptions**, and the review screen marks it as an assumption. A direction read from the
wording is only a direction: no number is read from the words, so the actor's size of impact is a system
default (see [Actors](#actors)).

**What it cannot do.** It finds groups that the text names with a role word. It will miss a group the
lexicon has no word for ("the city council" is missed, because _council_ counts only after a describing word
that the lexicon knows, and "drivers" is not a role word), and it cannot tell who decides from a bare "the provider". Its reading of tone
is a count of listed words in a sentence: it does not understand the sentence, and a cue can belong to the
wrong group ("a year of slower growth" counted for the customers named just before it). It says so before it
runs, and the gaps list is there to prompt the person to add what it missed.

### By asking the model

Offered only for a project in model mode whose provider is configured; otherwise the panel says why not.
It sends a selection of the source passages (within a fixed size budget) and the question, and asks for
stakeholders with a passage id and a **verbatim quote** for each.

The reply is never trusted as it arrives:

- it must have the expected shape, with one repair attempt if it does not;
- a reply that repeats text planted in the sources is refused: a code, a quoted phrase, or the name that an
  instruction gives ("the group named …"). The check looks for text that addresses an AI system or dictates
  what the answer or the stakeholder list says, and it is a heuristic: an instruction worded in a way it does
  not know is not recognised;
- **each quote is checked, character by character, against the passage it names**. A quote that cannot be
  found, or names a passage that was not supplied, is dropped;
- a stakeholder left with no verified quote is kept, marked **inferred**, with high uncertainty and an
  assumption saying so, **only when the person's own question or scenario names that group**. Any other
  stakeholder with nothing quoted is dropped, and the note says how many and why: all it would rest on is the
  model's word, which text in a source can have dictated, so it is never put in the list as if found. When
  nothing that the model proposed can be kept, discovery falls back to reading the text, with that reason;
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

### What it finds on the examples

This is what reading the text for roles, with no model, finds on each of the five worked examples. It was
made by running the discovery itself on each example's question and sources, the way a project does, and a
test fails if this table and the code disagree (`npx tsx backend/test/support/print-pack-table.ts` prints it
again). _Found_ counts the groups in the list, not those folded into another or removed. A group that cites
no quote is one the question names and no passage does.

| Example                 | Found (key / standard / background) | Cite a quote | Direction (wording / category / unclear) | Key groups, and the others whose direction was read from the wording                                                                                           |
| ----------------------- | ----------------------------------- | ------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copilot-in-teams`      | 22 (4 / 11 / 7)                     | 22 of 22     | 5 / 0 / 17                               | Key: Clients, Competitors, Regulators, Administrators. Others: Users (mixed), Finance team (harmed), Managers (mixed), Staff (harmed), Support teams (harmed). |
| `regional-price-change` | 24 (5 / 6 / 13)                     | 24 of 24     | 5 / 0 / 19                               | Key: Sales director (harmed), Customers (harmed), Competitors, Regulator, Engineers (harmed). Others: Vendors (harmed), Support engineers (harmed).            |
| `ecommerce-experience`  | 16 (4 / 5 / 7)                      | 15 of 16     | 2 / 0 / 14                               | Key: Customers, Competitor, Sellers, Regulators. Others: Delivery partners (harmed), Employees (harmed).                                                       |
| `ai-first-support`      | 18 (5 / 3 / 10)                     | 18 of 18     | 3 / 0 / 15                               | Key: Support director, Customers (harmed), Competitors, Regulators, Engineers (mixed). Others: Support engineers (harmed).                                     |
| `launch-pricing`        | 19 (3 / 9 / 7)                      | 19 of 19     | 3 / 1 / 15                               | Key: Executives, Customers (harmed), Competitors. Others: Partners (harmed), Marketing managers (harmed).                                                      |

What the table shows is what the rules can and cannot do. They find the roles the sources name, with a quote
for each, and say how sure they are: most groups in these examples are named in only a few sentences, and
so are marked as uncertain (about one in six is not). They read a direction only where a cited sentence
carries a word of concern or welcome, which is for about a fifth of the groups at most, so most stay
_unclear_ and a person has to say who is helped or harmed. A direction read this way can be wrong: the
words are counted, not understood. They do not find a group the sources describe without a role word, and
they do not know which groups matter most: the keys here are by rule (decision makers, regulators,
competitors, and the groups named most often). The list is a starting point for the person's review, never
the answer.

## Categories are a lens

The categories (decision maker, end user, bears cost, bears risk, beneficiary, influencer, competitor,
substitute, partner, channel, regulator, governance, operations, other) are a prompt for "who else?", not
a list of answers. They set a starting direction of impact, a starting value for each trait, how the
relations between groups are assumed, and which groups are key by default, and nothing else. A category
with nobody in it appears as a gap, and it is the person's call whether it matters here.

## Reviewing

### The panel

The summary at the top of the panel is four counts and one button. The counts are text ("12 found", "9 need
review", "0 approved", "0 actors"), so that a screen reader says them as they are. _Need review_ counts the
stakeholders that nobody has accepted, edited or added yet; _approved_ is the whole list once it has been
approved. The one button says what it will do and changes as the work goes on:

| Where the person has got to   | The button                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing found yet             | _Find stakeholders by reading the text_ (or _with the model_ when the project has one, which is then the main way)                                                                                                  |
| Some stakeholders need review | _Review N stakeholders_, which opens the list at the first. While the list is open the person is reading, and the button is _Go to approval_ (secondary), which moves focus to the approval at the foot of the list |
| Every one is checked          | _Approve and create actors_ (_Approve stakeholders_ when actors the person edited are kept). With the list open it is a secondary shortcut, and the approval card's own button is the main one                      |
| Approved, no actors yet       | _Make the actors_                                                                                                                                                                                                   |
| Actors exist                  | _Review the N actors_, which is a way to look and not the next step                                                                                                                                                 |
| Fewer than two stakeholders   | _Add a stakeholder_                                                                                                                                                                                                 |
| A person who may only read    | _Read the N stakeholders_, which opens the list; there is nothing to approve                                                                                                                                        |

When a model is available, approving and making actors open the approval card first, so that the choice of
letting the model read the key actors, which sends the source text, is never skipped.

Two toggles open what the panel keeps shut: **Stakeholders** (the list, the means to add one, the gaps, the
note on how they were found, the approval, and finding them again) and **Actors**. Both are shut until
the person opens them, so the stage's _Start Simulation_ stays on the screen at every size; approving shuts
the list again.

The list is one line to scan for each stakeholder, **key actors first**, then standard and background
cohorts, and by category and name within each. The order never depends on the review status, so a row does
not move when it is accepted. Each line shows the name and role, the **direction of impact in words** with
where it came from (_read from the wording_, _assumption_, _set by you_ or _model's reading_), the
**uncertainty in words**, whether the stakeholder **cites a quote** or is an _assumption with no cited
evidence_, whether it still _needs review_, and one line on why it is listed. Opening a row shows the quotes
it rests on, word for word with the passage they come from, what is assumed, and the means to act on it.
Anything that is an assumption and not evidence is labelled so in words, and an assumed direction or a
stakeholder with no cited evidence has a dashed edge as well, so that no colour is needed to tell. The
actors are rows too: opening one shows what it is assumed to want and every trait on a slider, with where
the number came from and why. They stay editable after approval.

What a change takes away, the panel replaces: an accepted row loses its _Accept_ button, a removed one leaves
the list, an added one appears, and approving replaces the button that was pressed. Each change is said to a
screen reader and focus goes to the row, its neighbour or the next step, never back to the top of the page.
Headings run in order under the stage's (the panel's title is a third-level heading, its parts the fourth
and the rows the fifth), every control has a name, and every target is at least 24 pixels (44 on a phone). It is checked in
the light, dark and high-contrast themes, on a desktop and on a phone.

### What a person can do

| Action     | What it does                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accept     | Marks it as checked by a person.                                                                                                                     |
| Edit       | Changes name, category, directness, priority, size, description, relevance, impact and uncertainty. The status becomes _edited_ if anything changed. |
| Merge      | Marks one stakeholder removed and names the one it went into, which takes the other's evidence. **Undo the merge** brings it back.                   |
| Remove     | Marks it removed. It stays in the record and can be restored.                                                                                        |
| Add        | Adds a stakeholder of your own. It is marked _added by you_ and carries no evidence, because evidence comes from the sources.                        |
| Prioritise | Key (one actor of its own), standard or background (a cohort).                                                                                       |

The server enforces what the screen offers: a stakeholder is never deleted; who found it cannot be changed;
**evidence can be taken away but never added or rewritten**, because each cited quotation is compared whole
(its passage, its document and the document's name, where it sits, its words and fingerprint, and whether it
supports or contradicts), so a quotation cannot be moved to another source or turned round; a merge is always
visible in the record; an impact is marked as the person's only if they changed it, and a direction read from
the wording is an assumption again once every quote it was read from has been taken away; relations are
assumptions whoever wrote them. A change made after approval **takes the approval away** until it is given
again, and at least two stakeholders must remain to approve. Finding stakeholders again over a reviewed list
asks for confirmation first.

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

**What an impact rests on.** An impact has a direction (harmed or benefited) and a size, and they do not rest
on the same thing. A cited passage can show which way a change points for a group, by the tone of the
sentences about it; no passage gives a number. So the size is the documented value for the direction (see
below) and is a **system assumption**, unless the person sets the number on the slider or a model proposes it.
An actor whose direction was read from the wording of cited sentences says so in a separate `direction` of its
impact (`origin: "evidence"`, with the passages it was read from, and no other trait has one), and the reason
beside the trait reads, for example, "The direction (harmed) rests on cited passages (S1, S2); the size,
-0.60, is a system default, not read from any passage." The sentences cited are attached to the direction and
to nothing else.

- A label of evidence is a claim about passages, so it stands only while a quote is cited. When the person takes
  every quote of a stakeholder away, the direction becomes an assumption and says so in its reason, and the
  actors made from it claim no source. A direction is the person's once they change it.
- A person who moves the number keeps what the direction rests on for as long as its sign stays; flipping the
  sign makes the direction theirs. Nothing the request says about what a direction rests on is taken.
- The critics and the brief read the same fact: a sensitive impact appears as an assumption about its size even
  when its direction is cited, and a direction labelled as evidence is checked against what is cited now.
- An actor saved before direction and size were told apart, with the whole impact labelled `evidence`, is read
  as a direction from evidence with a system default size; nothing needs to be run again.

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
overwritten. A review that rewrites a cited quotation (its document, the document's name, its position, its
words or whether it supports or contradicts) is refused with `EVIDENCE_ALTERED`, and one that adds a quotation
with `EVIDENCE_NOT_VERIFIED` (both HTTP 400, nothing is stored). Other refusals say what to do:
`STAKEHOLDERS_REVIEWED` and `ACTORS_EDITED` (confirm to replace your work), `STAKEHOLDERS_NOT_APPROVED`,
`MODEL_NOT_AVAILABLE`, `STAKEHOLDERS_TOO_FEW` and `STAKEHOLDERS_BUSY` (one discovery or generation runs at a
time for a project). Finding stakeholders and making actors are limited to ten a minute.

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
npm test -- backend/test/stakeholders-packs.test.ts backend/test/stakeholders-tone.test.ts
npm test -- backend/test/stakeholders-noise.test.ts backend/test/stakeholders-speed.test.ts
npm test -- backend/test/stakeholders-docs.test.ts
npm test -- frontend/src/components/stakeholders frontend/src/api/stakeholders.test.ts
npx playwright test --project=lab e2e/lab/stakeholders.spec.ts
```

The discovery tests run on briefs of very different subjects, and a test checks that every name found
comes from the text it was given and that the code names no market or product. The noise tests give it
invented menus, tables of contents and rows of links, in the shape such text takes, and expect no group
from them; the speed tests give it 40,000 characters of full stops, of one capitalised word, of many
different names, and expect the time to grow with the length of the text and not with its square.
`stakeholders-docs.test.ts` holds this page to the code: the category table, the sizes and limits, the
routes, the error codes and the table of what the examples give.

The browser test takes three of the examples through the real screens, from the first page to the actors,
and checks in each state that the stage's own button is on the screen, nothing overflows, axe is clean in
every theme and focus is not lost.
