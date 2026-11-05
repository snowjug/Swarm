# Stakeholders and actors

Swarm can run its simulation on the people and groups a project is actually about. This page describes how
those groups are found, how a person reviews them on the Map, how an approved list becomes the actors the
simulation runs, and what none of it can claim.

Everything here is a modelling aid. The actors are **synthetic stand-ins, not real people**; every number
they carry is an **assumption** that the person can see, change and trace. Swarm explores scenarios; it
does not predict what real people will do.

## The flow

1. **Find** stakeholders, by reading the text (always available) or by asking the model (when the project
   uses one). Each stakeholder comes with the passages that support it, or says that it has none.
2. **Review** them: accept, edit, duplicate, merge, remove, add, set priority. Nothing is ever deleted.
3. **Approve** the list. Only an approved list can be turned into actors.
4. **Make the actors**: a key actor for each key stakeholder and a cohort for each of the others. Every
   trait starts from a [documented prior](#category-priors) and says where it came from. On the Map one
   button, **Create actors**, does steps 3 and 4 together.
5. **Adjust** any trait on a slider, and the wording of an actor (its role, starting belief, wants, worries
   and pressures). The simulation then runs on these actors, and the deep dive builds its agents from them.

All of this happens on the **Map** scene, after the evidence has been read. It opens on one invitation
("Who is in play?") and then shows the stakeholders as a map, with one pill at the foot that says the next
step. The counts (how many parties, how many key, how many to review) sit under its heading, and the
actors are one toggle away. Nothing is run until the person says so. The steps are in the
[user guide](./USER_GUIDE.md#map-who-is-affected-and-the-actors) and how the scene is built is in
[UX.md](./UX.md#map).

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

- an **instruction** ("Configure widgets", "Manage users") is what a person does with a thing, not who: a word
  that opens one never describes a group, and a name that begins with one is left out of a proposal. So is a
  name that opens like a **line of release notes** ("Added advanced controls", "Allowing admins", "Help
  users"): a verb that such a line begins with, in any form it takes, says what a change does and not who it is
  for (a help desk, a letting agent, an extended family and a registered nurse are groups, and stand). A
  **capability** is an activity and not the people who do it: "calendar management" and "advanced management"
  are features, while "senior management" and "store management" are people. A **department or office named by
  its rank alone** ("executive offices") says nothing of who is in it, while "finance department" does. A **thing**
  that shares a noun with a body ("content delivery network", "admin center", "notice board") and a role noun
  after a machine word ("auto attendant") are not groups either, and neither is the **very thing the decision
  changes** ("Acme Rooms" in a question about Rooms; unless the decision is worded as that name doing something).
  The same check holds a model's proposal: such a name is sent back once for correction, and the rules path
  leaves it out and says why in the list of what was left out. The rules refuse a **form of words**, never a
  word, and each form is a small list in `participants/vocabulary.ts`;
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

## Participants: who decides, who is reached, who is missing

A stakeholder is a group a change touches. A **participant** is a stakeholder read as a part in a decision:
what it is trying to do, what presses on it, what it could do, and what must never be said of it. Swarm
proposes the participants from the question and the scenario, so that a person does not have to think of
every party by hand, and the person reviews and edits the proposal before anything is simulated.
`POST /stakeholders/propose` does it, and it is what the Map's **Find who is affected** button asks for.
The older `discover` route still stands and is unchanged.

### Roles

Fourteen roles, in words that belong to no domain, sit beside the categories. A role names the categories
it may take (the first is its default) and every category has a default role, so a list saved before roles
existed reads as roles too. Not every role is wanted in every scenario: a role that nobody material is found
for is **named as a gap**, never filled to make the list look whole.

| Role                         | Starts as category | Means                                                                |
| ---------------------------- | ------------------ | -------------------------------------------------------------------- |
| decision owner               | decision-maker     | Decides whether and how the change goes ahead.                       |
| directly affected            | risk-bearer        | Feels the change in what they do, pay, risk or receive.              |
| indirectly affected          | other              | Is reached by the change through someone else.                       |
| implementers                 | operations         | Carries the change out, or keeps things running while it happens.    |
| approvers                    | governance         | Has to sign off before the change can go ahead.                      |
| beneficiaries                | beneficiary        | Stands to gain from the change.                                      |
| opponents and resistors      | risk-bearer        | Has reason to oppose, slow or work around the change.                |
| regulators and governance    | regulator          | Sets, applies or audits the rules the change has to meet.            |
| customers and users          | end-user           | Uses, buys or relies on what the change alters.                      |
| partners and suppliers       | partner            | Supplies, resells or works alongside the party making the change.    |
| competitors and alternatives | competitor         | Offers another option that others may turn to, and can respond.      |
| system and environment       | other              | A condition or system that acts on the others.                       |
| observers and influencers    | influencer         | Does not decide or bear the change but shapes how others see it.     |
| missing voices               | other              | Is reached by the change, has no say in it, and is easy to overlook. |

### What a participant holds

Every field is optional in what is stored, so a set saved before them still parses; a stakeholder with none
of them reads with the defaults of its role and makes the actor it always made.

- a stable id and a **concise, specific name**: never "staff", "users", "public", "employee", "management",
  "stakeholder" or "team" alone;
- its role, why it matters, what the role is trying to achieve, its incentives, pressures, constraints and
  concerns, its influence level, its decision authority, and what it is assumed to see;
- its **plausible actions**: things it could do, written as possibilities for the simulation to try, never
  predictions;
- its **prohibited claims**: what must never be asserted about it. Four are standing and cannot be taken off
  (that it is a real, identified person, its private motives or feelings, that its future conduct is
  certain, and that its objectives were found in a source unless a passage is quoted);
- the passages it cites, its assumptions, its uncertainty and its **confidence basis**: quoted from a
  source, named in the question, a role pattern, a model's inference, or the person's own assertion. Only the
  first is a claim about the sources, and it needs a quotation;
- `synthetic: true`. A participant is never an identified person.

### How a proposal is made

1. A bounded input is built: the question, the scenario (baseline, alternatives, geography, horizon), the
   most relevant passages **with their ids**, the kinds of source a research run read and the known
   constraints (both read only if they exist, and as data of unknown shape), and the role vocabulary. A
   credential a source held is replaced before anything leaves the server. Source text is untrusted data.
2. With a model (the person's choice, as for finding), the reply must be `ProposedParticipants` v1: a
   strict schema that refuses any field it was not asked for (an email, a gender, a private motive), then
   the server's own checks, one correction, and then the rules, with a sanitised reason and none of the
   model's words. A refusal and a cancelled request are never answered from rules. Without a model, the
   **rules path** runs and calls none: it reads the text for the groups it names, adds what a decision like
   this has and the sources leave unsaid, and marks each of those as an assumption (see
   [The rules path](#the-rules-path-what-it-reads-and-what-it-adds)).
3. The same deterministic steps follow either: every quote is checked against its passage; a participant
   found again keeps its id; the same name twice is folded into one (the copy stays under Removed, named by
   the one it went into); one role may hold at most six, the rules path keeps at most sixteen and a model's
   proposal twenty-five, and **each cut is recorded**; relations with a missing end, a loop or a repeat are
   dropped; a participant with no quotation is labelled an assumption; roles nobody holds, where the
   sources suggest one matters, are named as gaps.
4. A review is made from the result: **"Swarm proposes these participants because…"**, composed from the
   participants' own fields and never from a model's prose; the issues, each **blocking** or **advisory**
   with a sentence on what to do; and which roles are covered. It is made when a set is read and is never
   stored, so it cannot be out of date.

If the sources carry text addressed to an AI system, it is ignored, the passages are flagged on the set,
a reply that repeats text such an instruction asked for is refused, and what only the model's word backs is
left out unless the question names it.

### The rules path: what it reads, and what it adds

The rules path is for a project with no model, for a model that failed, and for the evaluation's `rules`
mode. It never calls a model and gives the same proposal for the same input. It has two parts, and keeps
them apart: **what the sources name**, which is read and quoted, and **what a decision like this has
anyway**, which is assumed and says so.

**What it reads** (`participants/reader.ts`, with the vocabulary in `participants/vocabulary.ts`). The
discovery lexicon above is small on purpose, and a group it does not know is not found. The participant
reader keeps its rules and widens its vocabulary to common nouns for people in a role, for the kinds of
body people form and for the kinds of text that set rules, from health, learning, public service,
transport, trade, labour and civil society alike, and names no organisation, product or place (a test holds
every entry to lower case). It differs from the discovery lexicon in what it takes a group's name to be:

- a group is named **as the text names it**, from its describing words to its noun: "ward nurses", "county
  social care team", not the bare noun it shares with others;
- the words after the noun that say which ones are meant belong to the name: "councillors from the
  harbour ward", "customers on monthly plans", "head of finance". They are left out after a single person
  or after a verb, where they describe one case or may belong to the verb, and they stop at a verb;
- a **body** is a group when it has a name of its own (a describing word with a capital and a kind of body
  for a noun: "Harbour Pilots' Association", also in a heading), and a few bodies that decide or check are
  a group when the text says "the council";
- a group the text ever writes in the plural is named in the plural, and a noun alone ("the Association")
  is folded into the fuller name of the group it refers to;
- a plural noun the vocabulary does not know is a group when the sentence has it say or want something
  ("baggage handlers say…"), and is not when it names what a text holds ("reports say…");
- a sentence that says what a group asks, says or does marks it as **voiced**, and a group the text says
  starts the change ("the council proposes…") is the **decision owner**.

It never takes into a name a person's name, a possessor ("the firm's supplier" is the supplier), a word that
is a verb, a count of members, a role noun that begins a compound ("patient records") or the name of a
rule ("the Marden Consumer Code"). A sentence addressed to an AI is skipped, and every name still passes
the rules that block a participant (an identified person, a personal detail, a generalisation about people,
a hidden motive) before it is proposed.

**How it keeps the list.** The reader hands on every group it found, and the builder ranks them: the
decision owner first, then by priority, then a missing voice the sources name, a group the sources have
asking or saying something, a group that says which ones it means (a role named as broadly as "engineers"
does not), one cited more, one with a name of its own, and one written in the plural; the alphabet is last,
so that the order is always the same. It keeps **at most three groups for one noun** ("support engineers",
"tier-two engineers", "new engineers" are a lot already), as it keeps at most six of a role, and records
every cut. The limits of the list do not change, and a model's proposal is still cut in the order it always
was (the owner, the priority, the more cited). A group written with the same words in another order
("Customers in Marlow", "Marlow customers") is one group: the later is left out, its relations go to the
first, and the cut is recorded, since a proposal that names a group twice fails the checks it is held to.

**What it adds** (`participants/scaffold.ts`). Each is a role-based assumption: it has `category-pattern`
as its basis (or, when a passage names the group, `source-quote`), no quotation as a party, an assumption
that says what it rests on, and a reason that says why it is on the list. Apart from the decision owner, it
ranks after every group the sources name, so an assumption never takes a named group's place; and apart
from the owner and those directly affected, which every decision has, it is added only while the list has
room.

| Added                                                        | When                                                                    | Named from                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------- |
| Decision owner for _the change_                              | Nobody is read as deciding: a decision has an owner.                    | The scenario's change, or its system.   |
| Those directly affected by _the change_                      | Nobody holds a role that is reached: a change lands on someone.         | The same.                               |
| Body that sets _the rule_                                    | The text names a code, a standard, a policy, a charter, a framework.    | The rule's own name.                    |
| Other side of the _kind_ contract                            | The text names a contract and not who is on its other side.             | The contract's own noun.                |
| A group the text says was left out (a **missing voice**)     | "were not asked", "no data on", as the sources write it. It is sourced. | The text's own words for the group.     |
| Approvers, oversight, implementers, suppliers, alternatives… | The question or the sources speak of the role and nobody holds it.      | The scenario, and the word that called. |
| Those reached by _the change_ who have no say in it          | No missing voice is named and nobody stands for the role.               | The scenario.                           |

A role the sources never speak of is not added: a scenario with no word about suppliers has no supplier
placeholder. The cue for each role is the one the review already uses to say a role is missing, so a role
that is added here no longer appears as a gap. What this does not do: it does not add who bears the cost or
the risk as a participant (the reading already places a group there when its sentences speak of paying or
exposure); it does not turn the scenario's alternatives into parties, since an alternative is a way to make
the change and not someone to ask; and it does not guess the groups a careful reader would think of from
world knowledge ("people who rely on a lift", "the crew of a vessel"), which needs a model and is left to
one, and to the person.

What the rules path cannot find is measured, apart from what the sources name, by the evaluation's `rules`
mode: [the evaluation](./production/evaluation.md) says how, and what it found.

### The checks

A set the proposal made is held to every rule. A set found before the proposal existed keeps its old
checks: the rules about quality only advise, and the rules about safety and integrity still block.

| Code                     | Proposed | Older    | What it catches                                                        |
| ------------------------ | -------- | -------- | ---------------------------------------------------------------------- |
| `too-few`                | blocking | blocking | Fewer than two participants.                                           |
| `duplicate-id`           | blocking | blocking | Two participants with one id.                                          |
| `generic-name`           | blocking | advisory | A name that is only a generic word.                                    |
| `broad-name`             | advisory | advisory | A real role named too broadly ("Customers").                           |
| `real-person`            | blocking | blocking | Text that points at an identified person.                              |
| `personal-detail`        | blocking | blocking | An email address, a phone number, a handle, an address, a credential.  |
| `stereotype`             | blocking | blocking | A sweeping claim about what a kind of person is like.                  |
| `unsupported-motive`     | blocking | blocking | A claim to know a hidden reason, or a mental state put on a person.    |
| `wording`                | blocking | advisory | A forecast, a claim of certainty, a percentage, a figure of the world. |
| `evidence-unknown`       | blocking | advisory | A citation of a passage that is not in the project.                    |
| `basis-unsupported`      | blocking | blocking | A participant said to be quoted that cites no passage.                 |
| `assumption-unmarked`    | blocking | advisory | No passage, and no word that it is an assumption.                      |
| `duplicate-participant`  | blocking | advisory | Two participants with the same name.                                   |
| `possible-duplicate`     | advisory | advisory | Two participants of one role with overlapping names.                   |
| `duplicate-incentives`   | blocking | advisory | Two participants whose incentives are the same.                        |
| `relation-invalid`       | blocking | blocking | A relation with a missing end, a loop, or a repeat.                    |
| `incomplete`             | blocking | none     | No objective, or no plausible action.                                  |
| `role-mismatch`          | advisory | advisory | A role and a kind of party that do not go together.                    |
| `missing-decision-owner` | advisory | advisory | Nobody is named as the decision owner.                                 |
| `missing-role`           | advisory | advisory | A role that looks material here and nobody holds.                      |
| `over-represented`       | advisory | advisory | One role is most of the list.                                          |
| `many-key`               | advisory | advisory | More key actors than the simulation runs as individuals.               |
| `too-many`               | advisory | advisory | More participants than are easy to review.                             |

`valid` is true only when no blocking issue remains. **Approving is refused with `PARTICIPANTS_INVALID`
while one does**, and the refusal says which and what to do. Because every change to a set takes its
approval away and actors are made only from an approved set, a simulation cannot start from participants
that did not pass. Making actors from a set the proposal made checks it again, so that nothing that changed
outside the routes after the approval can reach the simulation; a set found before participants existed
keeps the approval it has.

## Reviewing

### On the Map

Under the heading of the Map, three counts say how many parties there are, how many are key and how many
are **to review**. They are text ("12 parties", "4 key", "9 to review"), so that a screen reader says them
as they are. _To review_ counts the stakeholders that nobody has accepted, edited or added yet; once the
list has been approved it is gone. One pill at the foot of the map says what to do next and changes as the
work goes on:

| Where the person has got to                         | What the pill, or the page, offers                                                                                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing found yet                                   | The page asks "Who is in play?": **Find who is affected** (by the model when the project has one, which is then the main way, with **Read the text instead** beside it) and **Add one yourself**                                   |
| Some stakeholders need review                       | "N to review", which opens the next one, beside **Create actors** (**Approve** when actors the person edited are kept). It waits, with the hint "Keep or add two or more", until at least two stakeholders are kept                |
| Approved, no actors yet                             | **Create actors**                                                                                                                                                                                                                  |
| Actors exist                                        | "N actors ready", with **Simulate**. **Actors** in the toolbar is a way to look, and not the next step                                                                                                                             |
| Actors changed                                      | "N actors changed", "Not saved yet", with **Save** and **Discard**                                                                                                                                                                 |
| The stakeholders changed after the actors were made | A notice, "The actors are out of date", with **Make them again**, which asks before it replaces what the person changed (it approves the list again first when the change took the approval away)                                  |
| A check of the participants stands in the way       | The way on is shut: the approving button waits with the hint "Fix N things first", a notice under the heading says how many checks stand in the way with **Review participants**, and **Review** in the toolbar carries the number |
| A person who may only read                          | A line that says what is missing ("Approving needs the right to edit and to run the project."); the stakeholders and their evidence can still be read                                                                              |

When a model is available, pressing the approving button opens a small panel first, with the switch **Let
the model read the key actors**, so that the choice of letting the model read them, which sends the source
text, is never skipped.

The toolbar says what is drawn: **Map**, **List** or **Review**, and **Stakeholders** or **Actors**. **Groups** hides a
kind of party, the focus control dims all but what is connected to the party in view, **Add a stakeholder**
adds one, and under **More** are **Find stakeholders again…** and **Reset all actors…**. A legend ("How to
read this map") says what size, colour, ring and paleness mean: size is how much it matters (for an actor,
how much influence it has), colour is the effect, a solid ring is reached directly and a dashed one
indirectly, and a paler party is one that Swarm is less sure of.

**The list** (under **List**) is the same parties as text, in groups by kind and the weightiest first within
each. A line that every row of a group would say alike is said once, under the group's name. A row shows the
name, **Key** where it is a key actor, its own facts in words (direct or indirect, how many quotes it rests on
or "Assumed", and for an actor whether it is one actor or a cohort and where it stands), one line on why it
is listed where that line is its own, the **direction of impact in words** (nothing is printed for unclear),
for an actor a cue for its influence with the word beside it, and where it stands in the review, as a word.
The order never depends on the review status, so a row does not move when it is accepted. The kinds that
nobody was found for are listed under "Nobody found for", each with a button to add one, and the removed
stakeholders under **Removed**.

A press on a party, on the map or in the list, shows it in the inspector: the **direction of impact in
words** with where it came from (_read from the wording_, _assumption_, _set by you_ or _model's reading_),
how directly it is affected, how it is modelled, **how sure Swarm is** in words, what it is assumed to want
and fear, the quotes it rests on under **Evidence**, word for word with the passage they come from, and
under **Why they are here** what is assumed and how it was found. A stakeholder with no quote says why: it
was named in the question, inferred by a model, or added by the person. Anything that is an assumption and
not evidence is labelled so in words, so that no colour is needed to tell. The actors are parties too:
opening one shows its key assumption, what it is assumed to want and fear, and every trait on a slider,
with where the number came from and why. They stay editable after approval: **Edit what _name_ wants and
fears** opens the role, the starting belief and the lines of wants, worries and pressures to change in the
person's own words, and everything is held until **Save**.

What a change takes away, the page replaces: an accepted party loses its **Accept** button, a removed one
leaves the map for **Removed**, an added one appears, and approving replaces the button that was pressed.
Each change is said to a screen reader, and focus goes to the party, the inspector or the next step, not back
to the top of the page. The rules that hold the page to this are in [UX.md](./UX.md#accessibility).

### The review of the participants

**Find who is affected** now proposes participants (`POST …/stakeholders/propose`), so a list found on the
Map is checked as it is made. A notice under the heading says "Swarm proposed these participants" with
**Review participants**, which opens **Review** in the toolbar (`?scene=map&view=review`). A list found before
participants existed has no such notice and keeps its map, its pill and its approval as they were; **Review**
is there for it too, and holds it to the older, lighter checks (see [The checks](#the-checks)).

The review is a column to read, in this order:

1. **The summary line**, "Swarm proposes these N participants because…", composed from the participants'
   own fields and never from a model's prose, with the counts (participants, key, quoted, assumed, still to
   review). A passage that carries text addressed to an AI system is named in a notice: it was read as text
   and not followed as an instruction.
2. **The gate.** "Nothing blocks these participants", or "Fix N things before these can be used" with each
   blocking issue beside the button that mends it (**Rename**, **Edit**, **Merge**, **Add one**, **Propose
   again** or **Remove**) and **Show**, which takes focus to its card. Simulation starts only from a list
   that passes: the pill says "N checks to fix" and the button **Use these actors** waits, and the server
   refuses to approve (`409 PARTICIPANTS_INVALID`) however the request was made.
3. **Actions on the whole list:** **Accept all**, **Accept selected**, **Merge duplicates**, **Add a missing
   participant** and **Propose the list again…**, which asks before it replaces a reviewed list.
4. **Roles in this decision.** Which roles somebody holds, and which nobody does, each missing one with the
   reason it may matter here and **Add one**. Roles nothing points at are offered, not asked for, and nothing
   is made up to fill one.
5. **The participants, grouped by the role they play.** A card says who it is and why it is here (including
   the passage that names it), how much it can do about the decision, how directly it is reached, and in
   chips: _Synthetic role, not a person_; whether it rests on a quoted passage or is **assumed** (and on
   what); how uncertain it is; and where it stands in the review. **Details and evidence** holds what the
   role is assumed to want, the pressures and limits on it, what it can see, what it could do, what is never
   asserted about it, and the quotations word for word. **Ask why** reads the reasons from the participant
   itself and the passages it cites. **Edit** changes any of it (and says on the card that it was edited by
   the person), **Merge into another**, **Propose again** (it asks before replacing a participant the person
   changed, and offers the model only when the project has one) and **Remove** (nothing is deleted).
6. **Suggestions**, **Removed** (each restorable, a merge can be undone), **Left out** (what the proposal did
   not keep and why) and **How this list was checked**.

The page is the same on a phone: one column, controls of a finger's size, and the pill keeps **Use these
actors** whole beside what it says. Every change says what happened to a screen reader and puts focus on a
card that still exists.

### What a person can do

| Action     | What it does                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accept     | Marks it as checked by a person.                                                                                                                                          |
| Edit       | Changes name, category, directness, priority, size, description, relevance, impact and uncertainty. The status becomes _edited_ if anything changed.                      |
| Merge      | Marks one stakeholder removed and names the one it went into, which takes the other's evidence. **Undo the merge** brings it back.                                        |
| Duplicate  | Opens the form for a copy: the name ends in "(copy)", and the kind, size and reasons are the original's. The copy is _added by you_ and carries no evidence, and says so. |
| Remove     | Marks it removed. It stays in the record and can be restored.                                                                                                             |
| Add        | Adds a stakeholder of your own. It is marked _added by you_ and carries no evidence, because evidence comes from the sources.                                             |
| Prioritise | **Key** (one actor of its own), **Cohort** (standard) or **Small** (background), a cohort of simulated members.                                                           |

The server enforces its rules whatever the screen offers: a stakeholder is never deleted; who found it cannot
be changed; **evidence can be taken away but never added or rewritten** (the Map shows each quotation as it
was read and offers no way to change one), because each cited quotation is compared whole (its passage, its
document and the document's name, where it sits, its words and fingerprint, and whether it supports or
contradicts), so a quotation cannot be moved to another source or turned round; a merge is always visible in
the record; an impact is marked as the person's only if they changed it, and a direction read from the
wording is an assumption again once every quote it was read from has been taken away; relations are
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
moves becomes theirs, and the actor is marked _edited by you_. So does a line of wording the person changes:
the role, the starting belief, and what the actor wants, worries about and is pressed by. The server refuses
an edit that adds or removes an actor (`ACTORS_CHANGED`), that renames an actor or changes its stakeholder,
kind or category (`ACTOR_LOCKED`), that makes a key actor larger than one, or that makes a sample larger
than the group it stands for (`ACTOR_INVALID`). Who an actor is comes from its stakeholder: to add, remove,
rename or regroup one, change the stakeholder and make the actors again.

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

When the project uses a model, a person can ask it to read the **key actors** against the evidence (the switch
**Let the model read the key actors**, which is offered as the list is approved). Whatever it sets is
labelled _model_, with a rationale that cites the passage it relied on or says that none was cited. If the
call fails or its reply is not valid, the category priors stand and a note says so. Cohorts are never
refined by a model.

## How the deep dive uses the actors

When a project has actors, the deep dive's **Prepare the environment** makes its agents from them instead of
generating a population, and the existing simulation engine runs on them unchanged. (The comparison of
scenarios does not use these agents: it runs on the actors directly, and the deep dive is optional.)

- Key actors come first, ordered by influence and authority. The engine takes at most **24** agents in the
  local rules mode and **10** in model mode; the event log says how many key actors did not fit.
- The largest cohorts then give one representative each, and further members of a cohort (spread around its
  values by its spread) if the engine still needs more. It needs at least **4** agents. If the actors give
  fewer, the step stops with a plain instruction: add a stakeholder that stands for a group of people and
  make the actors again.
- A cohort is **never simulated at its size**: its size weights a cohort in the model, and the number of
  simulated members is small on purpose.
- An agent's persona is written by Swarm from the actor, says that it is fictional and that its numbers are
  assumptions, and the agent carries the ids of the passages behind it. No model is asked for personas when
  actors exist.
- The step records "Fictional persona preparation from approved actors" in its trace, so the run shows
  where its population came from.

A project without actors is unchanged.

## Routes and roles

All routes are under `/api/projects/:id`. Reading answers `200` with nothing in it for a project that has
no stakeholders yet; it is not an error.

| Route                                          | Role needed | Does                                                                                  |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `GET  /stakeholders`                           | read        | The list, its revision, whether a model is available, what you may do, and its review |
| `POST /stakeholders/discover`                  | run         | `{ mode: "rules" or "model", confirm }`; answers `201`                                |
| `PUT  /stakeholders`                           | edit        | The reviewed list and the revision you saw; `0` builds one by hand                    |
| `POST /stakeholders/approve`                   | edit        | `{ expectedRevision }`; refused while the review has a blocking issue                 |
| `POST /stakeholders/propose`                   | run         | `{ mode: "rules" or "model", confirm }`; the participants; answers `201`              |
| `GET  /stakeholders/validation`                | read        | `{ revision, review }`: the check that gates approval                                 |
| `POST /stakeholders/accept`                    | edit        | `{ expectedRevision, ids? }`: the ones named, or every one still only proposed        |
| `PATCH /stakeholders/:participantId`           | edit        | `{ expectedRevision, changes }`: only the fields a person may change                  |
| `DELETE /stakeholders/:participantId`          | edit        | `?expectedRevision=`: marks it removed; it stays in the record                        |
| `POST /stakeholders/:participantId/regenerate` | run         | `{ expectedRevision, mode, confirm }`: one participant again, given the rest          |
| `GET  /stakeholders/:participantId/why`        | read        | The participant explained from what it already holds; no model                        |
| `POST /stakeholders/merge-duplicates`          | edit        | `{ expectedRevision, groups? }`: the same names, or the groups you choose             |
| `POST /stakeholders/add-missing`               | edit        | `{ expectedRevision, role, name }`: a participant for a role nobody holds             |
| `GET  /actors`                                 | read        | The actors, and whether they are older than the stakeholders                          |
| `POST /actors/generate`                        | run         | `{ model, confirm }`; needs an approved list; answers `201`                           |
| `PUT  /actors`                                 | edit        | Edited actors and the revision you saw                                                |

A change made against an old revision is refused with `ARTIFACT_CONFLICT` (HTTP 409) and nothing is
overwritten. A review that rewrites a cited quotation (its document, the document's name, its position, its
words or whether it supports or contradicts) is refused with `EVIDENCE_ALTERED`, and one that adds a quotation
with `EVIDENCE_NOT_VERIFIED` (both HTTP 400, nothing is stored). Other refusals say what to do:
`STAKEHOLDERS_REVIEWED` and `ACTORS_EDITED` (confirm to replace your work), `STAKEHOLDERS_NOT_APPROVED`,
`MODEL_NOT_AVAILABLE`, `STAKEHOLDERS_TOO_FEW` and `STAKEHOLDERS_BUSY` (one discovery or generation runs at a
time for a project), and, for `PUT /actors`, `ACTORS_CHANGED` and `ACTOR_LOCKED` (the actors come from the
stakeholders, so one cannot be added, removed, renamed or regrouped there). For participants:
`PARTICIPANTS_INVALID` (approving, or making actors from a proposed set, while the review has a blocking issue), `PARTICIPANT_NOT_FOUND`,
`PARTICIPANT_REMOVED`, `PARTICIPANT_EDITED` and `PARTICIPANT_NOT_REGENERABLE` (one you added has nothing in the
sources to regenerate it from), `NO_DUPLICATES`, `MERGE_INVALID` and `ROLE_CATEGORY_MISMATCH`. Finding
stakeholders, proposing participants, proposing one again and making actors are limited to ten, twenty or ten a
minute; the other changes to sixty or a hundred and twenty.

Every change is recorded in the audit trail, in the same step as the change. The record holds **counts and
the mode only**: never the question, the sources or a stakeholder's text. A change to the participants is
recorded under the action that already names it (proposing as `stakeholders.discovered`, everything else as
`stakeholders.edited`) with an `operation` such as `accept`, `edit`, `remove`, `regenerate`, `merge` or
`add-missing`.

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
npm test -- backend/test/participants-schema.test.ts backend/test/participants-rules.test.ts
npm test -- backend/test/participants-reader.test.ts backend/test/participants-scaffold.test.ts
npm test -- backend/test/participants-checks.test.ts backend/test/participants-model.test.ts
npm test -- backend/test/participants-routes.test.ts
npm test -- frontend/src/scenes/map frontend/src/lib/stakeholders frontend/src/viz frontend/src/api frontend/src/hooks/useParticipants.test.tsx
E2E_PROJECTS=lab npx playwright test e2e/lab/map-participants.spec.ts
```

The discovery tests run on briefs of very different subjects, and a test checks that every name found
comes from the text it was given and that the code names no market or product. The noise tests give it
invented menus, tables of contents and rows of links, in the shape such text takes, and expect no group
from them; the speed tests give it 40,000 characters of full stops, of one capitalised word, of many
different names, and expect the time to grow with the length of the text and not with its square.
`stakeholders-docs.test.ts` holds this page to the code: the category table, the sizes and limits, the
routes, the error codes and the table of what the examples give.

The participant tests hold the contract and what an older save still parses as (`participants-schema`), the
rules proposal on every pack and the library notes with no model (`participants-rules`), the reader's
rules on invented sentences from other walks of life (`participants-reader`), what the rules path adds
and how it keeps its list (`participants-scaffold`), each check and
its two profiles (`participants-checks`), the model path against a scripted gateway that answers as a
model would, wrongly and rightly (`participants-model`), and the routes, the gate, the revisions, the
rate limits and who may do what (`participants-routes`). The model path has been exercised only against
that scripted double, never against a real model. The review's render tests
(`scenes/map/review/ReviewSurface.test.tsx`) walk its states: empty, blocked, valid, read-only, busy, and
a proposal with a flagged source and what was left out.

The front-end tests hold the review logic (`lib/stakeholders`), the Map scene's model and its keyboard and
pointer behaviour (`scenes/map`) and the ecosystem map (`viz`), and `backend/test/stakeholders-neutrality.test.ts`
also scans the Map's code for market and product words. The browser tests of the `lab` project take the
examples through the real screens, from the first screen to the actors, with axe on the states they visit;
the [testing guide](./TESTING.md) says which they are and what a passing run does not show.
