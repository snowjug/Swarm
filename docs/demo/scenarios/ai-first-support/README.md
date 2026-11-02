# AI-first support

> What could happen if an AI assistant handles initial troubleshooting before a customer reaches a
> human support engineer?

An invented software company with about 6,000 customer organisations is considering an assistant that
takes the first pass at support cases. The evidence is four short documents: a brief, ticket and
handling data with a small pilot, a note of concerns from engineers, customers and reviewers, and a
supplier's case study with a list of what nobody has measured. The company, its customers, its
engineers and every figure are invented.

Back to the [example scenarios](../README.md). The text the example chip loads is in
[`shared/examples/ai-first-support.ts`](../../../../shared/examples/ai-first-support.ts), and the
files in this folder are readable copies of it.

## The evidence

| File                                                                     | What it is                                                         | Why it is in the pack                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [01-support-operations-brief.md](./01-support-operations-brief.md)       | The proposal, how support works today, and who has reacted         | Context that names many roles in ordinary sentences, and three variants of the proposal |
| [02-ticket-and-handling-summary.md](./02-ticket-and-handling-summary.md) | A quarter of ticket data and a six-week pilot                      | Numbers with caveats, and a pilot that covers only part of the work                     |
| [03-concerns-and-feedback-note.md](./03-concerns-and-feedback-note.md)   | Concerns from engineers, customers, privacy and security reviewers | The risk note, written by the people who carry the risks                                |
| [04-case-study-and-gaps.md](./04-case-study-and-gaps.md)                 | A supplier's case study, and what no source in the pack covers     | A figure from an interested party that disagrees with the pilot, and the stated gaps    |

## Built in on purpose

**One source conflict** that the evidence ledger flags (a test pins it), and that **Conflicts** in
Ground and **Evidence base and quality** in the brief show: the company's pilot resolved
34% of its cases without a human. A supplier's case study about another company says 62%. The
supplier sells the assistant software, and the case study gives no number of cases, no period, no
satisfaction method and no word on whether customers could opt out.

**Tensions only a reader will notice.** Most engineers said the assistant handled routine
access cases acceptably, while several said a wrong first suggestion costs more time than a case
that starts with a person. Satisfaction averages 4.3 out of 5, but only 11% of customers answered the
survey. Only 22% of a sample of cases passed to a person arrived with a usable summary.

**Arithmetic the evidence supports.** This is your own check, not a Swarm result: access cases are
29% of 46,000 cases a quarter, about 13,300. The pilot's 1,900 cases cover access cases on standard
plans only, on weekdays, in two of three time zones. It is a small slice of the work, and none of it
involves premium or enterprise customers or integration cases.

**Evidence gaps the brief should show as uncertainty:** customers who are not helped and give up
without opening a case; the cost of a wrong first answer; whether customers who meet the assistant
first renew at the same rate; languages other than English; the running cost per case; the effect on
how new engineers learn the product; reopen rates for cases the assistant resolved. Check on your run
that the brief shows them, and say so if one is missing.

**Open points in the question itself.** "Initial troubleshooting" is not defined, nor is which
customers, which kinds of case, what counts as a good outcome or over what period. The brief names
three variants (all customers, outside office hours only, suggestions shown to the engineer instead).
The intake step should raise the open points as questions to answer.

Roles you can expect discovery to find and cite, depending on the mode: support engineers and the
tier-two team, team leads, the support director, the head of product, customer success managers,
administrators at larger customers, customers on standard, premium and enterprise plans, the legal
and privacy team, security reviewers, the compliance team, knowledge-base authors, a reseller partner,
competitors, regulators, an employee representative and accessibility reviewers. Rules mode reads
for generic role words, so it finds the groups the text names that way and misses the others; the
review is where you add them.

Roles are not individuals. The example involves employees' work, so use it to show that actors stand
for roles and rest on declared assumptions, and never to say anything about a person.

Alternatives worth adding by hand if the form has none: an assistant-first route for all customers;
outside office hours only; suggestions shown to the engineer only; a visible route to a person on the
first screen; premium and enterprise customers left out at first.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** First screen, then the **AI-first support** chip under **Start from an
example**. Say: "Swarm explores scenarios. It does not guarantee or precisely predict real-world
behavior. This is an invented software company and invented evidence, and each document says so."
Point at the question and at the evidence: the count on **Evidence** and the four documents in the
tray, each a sample (open one: "Sample evidence: invented, describes no real case"; in Ground it
carries the licence `Synthetic, CC0`).

**0:30 Your scenario (40 s).** **Explore**. Point at the change (an assistant before a person), **If
nothing changes** and **Assumed**, where a dot says who made each assumption. Say what the question
leaves open: which cases and customers, what counts as a good outcome, and over what period. Answer one
under **Swarm asks** (**Answer**), then **Ground it**.

**1:10 Ground (30 s).** Open the ticket summary under **Sources**. Say: "Every passage keeps its
source. Ground compares the sources and shows where they disagree."

**1:40 Map: stakeholders and actors (60 s).** **Map the stakeholders**, **Find who is affected**. Point
at the parties on the map, "N to review", the chip that says how they were found, one party opened to
its cited quotes and confidence, and the **Nobody found for** prompts. Say: "Roles, with the passage
shown. They are not real people." Then **Create actors**, open an actor's **Traits**, and
point at one trait and its origin chip.

**2:40 Simulate and Compare (60 s).** **Simulate**, **Run the simulation**. Watch the replay in **Live**,
then choose **Compare**. Point at the baseline and the proposed change on the gap chart, a tick for each
seeded run, one finding with "It held in N of 30 seeded runs" and its class, and **Depends on**. Say:
"These are simulated members and seeded runs. They are not a resolution rate."

**3:40 Decide: the decision brief (50 s).** **Decide**, **Write the brief**. Read the verdict and the
numbers under **What happened**, and the origin mark on a statement. The evidence base is closed until
you open it from the contents: this pack was built with one source conflict, so open **Evidence base
and quality**, find it (34% against 62%) and say: "A pilot and a supplier's case study disagree. The
supplier sells the product and gives no denominators. Swarm shows both and does not pick one." Then look
for the uncertainty about customers who give up, and at the **Validation plan** (open, right after the
recommendations).

**4:30 One objection (20 s).** Choose **Review**, then **Run the independent review**, and read one
objection with its basis. Say: "A critic challenges and never edits. I can respond, accept or dispute
it."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table and a plan
to check them. It supports a person's analysis; it does not make the decision."

## Ten-minute script

The five-minute script, slower, with the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "People's jobs are involved here. The actors are roles with
assumptions, and the example says nothing about any individual."

**1:00 to 2:30 The question and the scenario.** Edit one field of **Your scenario** and point at the chip
at the top: it now reads "Edited by you". Add one alternative by hand with **Add a way** (for example,
suggestions shown to the engineer only). Say: "The alternatives are what we compare against the
baseline, so they are mine to define."

**2:30 to 3:30 Ground: the evidence.** **Ground it**, then the ticket summary and the case study under
**Sources**. Choose the **Passages** figure, search for "resolved" and open two passages. Say: "The pilot
covered only access cases on standard plans. The case study does not say what it covered."

**3:30 to 5:00 Map: stakeholders and actors.** **Map the stakeholders**, **Find who is affected**. Open
three parties and read their cited quotes under **Evidence**. Edit one (**Edit** on the party, or
**Modelled as** for its priority) and **Merge** or **Remove** one. Read the prompts about roles nobody
was found for and say what you would do. **Create actors**, open an actor, then change one
trait with its slider and show the chip change to "you"; **Save** keeps it.

**5:00 to 6:30 Simulate and Compare.** **Run the simulation** and watch **Live**. Then **Compare**: show
the gap chart and the two shares, **How it unfolds** (the spread of runs over the rounds), and two
findings under **What holds** with their intervals. If one is unstable, say what that means. Read **Sets
off** aloud: a competitor's or a reseller's reaction follows from generic rules, not from a script
written for this example.

**6:30 to 7:30 What the result depends on.** Under **Depends on**, point at the assumptions the result
moves with and find one with no evidence behind it. Say: "This is what we would test first, and the
validation plan says how."

**7:30 to 9:00 Decide: review and brief.** **Decide**, **Write the brief**, then **Review** and **Run the
independent review**. Read one evidence objection and one assumption objection, and respond to one. In
the brief, look at the recommendations (each resting on the findings it cites, with an owner function
and a way to check it) and the **Validation plan**, which are open, and at the assumptions and
uncertainty, which are closed until opened from the contents. Say that a staged trial with named
measures is the kind of check a validation plan should propose, and check whether yours does.

**9:00 to 10:00 Exports and questions.** **Export** → **Markdown**, **JSON, with the data behind the
charts** or **Printable page**. **Ask about this** opens once a detailed report exists, so run the deep
dive first (**Simulate** → **More** → **Deep dive**, **Prepare the environment**, **Start the
simulation**, **Write the detailed report**), or leave this step out. Then ask the analyst one question
the sources answer ("How many cases did the pilot cover and how many did the assistant resolve?") and
one they cannot ("What was the support headcount in 2019?"). Say that rules mode returns the nearest
passages.

## Points specific to this example

- "The pilot and the case study are not comparable. One covers part of the work in one company, and
  the other comes from a seller with no denominators."
- "Nobody knows what happens to the customers who give up. They never appear in the data."
- "The privacy and security notes state concerns, not findings."
- "Actors are roles with declared assumptions. Nothing here evaluates any person."

## Objections specific to this example

**"Will an assistant cut our support costs?"** The pack has no cost per case and says so. Swarm
explores how different roles might react under stated assumptions; it does not estimate savings.

**"The case study says 62%. Is that what we would get?"** It is an invented case study from an
invented supplier, with no denominators, and the pack's own pilot found 34% on a narrower slice.
Swarm shows both.

**"Does it evaluate support engineers?"** No. It treats roles as groups of synthetic actors with
assumptions you can read and change, and it does not profile individuals or use sensitive personal
characteristics.

**"What about customers who need a person?"** The pack records requests for a visible route to a
person and has no data on those who give up. Both appear as stakeholder concerns and as stated
gaps, not as findings.
