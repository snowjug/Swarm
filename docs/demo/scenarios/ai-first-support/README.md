# AI-first support

> What could happen if an AI assistant handles initial troubleshooting before a customer reaches a
> human support engineer?

An invented software company with about 6,000 customer organisations is considering an assistant that
takes the first pass at support cases. The evidence is four short documents: a brief, ticket and
handling data with a small pilot, a note of concerns from engineers, customers and reviewers, and a
supplier's case study with a list of what nobody has measured. The company, its customers, its
engineers and every figure are invented.

Back to the [example scenarios](../README.md). The text the picker loads is in
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

**One source conflict** that the evidence ledger flags (a test pins it): the company's pilot resolved
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
for generic role words and will find fewer and plainer ones than a model.

Roles are not individuals. The example involves employees' work, so use it to show that actors stand
for roles and rest on declared assumptions, and never to say anything about a person.

Alternatives worth adding by hand if the form has none: an assistant-first route for all customers;
outside office hours only; suggestions shown to the engineer only; a visible route to a person on the
first screen; premium and enterprise customers left out at first.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** Entry page, **Try an example**, **AI-first support**. Say: "Swarm
explores scenarios. It does not guarantee or precisely predict real-world behavior. This is an
invented software company and invented evidence, and each document says so." Point at the question
and the sample provenance with the licence `Synthetic, CC0`.

**0:30 The question (40 s).** **Understand my question**. Point at the change (an assistant before a
person), the baseline and the assumptions with their origin. Say what the question leaves open: which
cases and customers, what counts as a good outcome, and over what period. Answer one, then **Use this
scenario**.

**1:10 The evidence (30 s).** **Build Graph**. Open the ticket summary. Say: "Every passage keeps its
source. The ledger later compares sources and shows where they disagree."

**1:40 Stakeholders and actors (60 s).** **Env Setup**, **Find stakeholders**. Point at the support
engineers, the customers by plan, the privacy reviewers and the competitors, each with a cited quote,
the uncertainty chips and the prompt about roles nobody was found for. Say: "Roles, with the passage
shown. They are not real people." **Approve stakeholders and create actors**; point at a trait and its
origin badge.

**2:40 Compare scenarios (60 s).** **Simulation**, **Compare scenarios**. Point at the baseline and
the proposed change, the spread across the seeded runs, one finding with "N of 30 seeded runs" and its
stability chip, and the sensitivity view. Say: "This counts simulated runs. It is not a resolution
rate."

**3:40 The decision brief (50 s).** **Report**, **Generate decision brief**. Read the executive
answer and its origin chips. In the evidence base, open the source conflict (34% against 62%) and
say: "A pilot and a supplier's case study disagree. The supplier sells the product and gives no
denominators. Swarm shows both and does not pick one." Show the uncertainty about customers who give
up and the validation plan.

**4:30 One objection (20 s).** Run the independent review and read one objection with its basis.
Say: "A critic challenges and never edits. I can respond, accept or dispute it."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table and a plan
to check them. It supports a person's analysis; it does not make the decision."

## Ten-minute script

The five-minute script, slower, with the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "People's jobs are involved here. The actors are roles with
assumptions, and the example says nothing about any individual."

**1:00 to 2:30 The question and the scenario.** Edit a field of the scenario form and show the label
that records that you changed it. Add an alternative by hand (for example, suggestions shown to the
engineer only). Say: "The alternatives are what we compare against the baseline, so they are mine to
define."

**2:30 to 3:30 Evidence.** **Build Graph**, then the ticket summary and the case study. Search the
evidence for "resolved" and open two passages. Say: "The pilot covered only access cases on standard
plans. The case study does not say what it covered."

**3:30 to 5:00 Stakeholders and actors.** Open three stakeholders and read their cited quotes. Edit
one stakeholder's priority and remove or merge one. Read the prompt about roles nobody was found for
and say what you would do. Approve, then change one trait on one actor and show its badge change to
"you".

**5:00 to 6:30 Compare scenarios.** Run the comparison. Show the response distribution per scenario,
the trajectory band and two findings with their intervals. If one is unstable, say what that means.
Open the second-order chain and read it aloud: a competitor's or a reseller's reaction follows from
generic rules, not from a script written for this example.

**6:30 to 7:30 Sensitivity.** Point at the assumptions the result moves with and find one with no
evidence behind it. Say: "This is what we would test first, and the validation plan says how."

**7:30 to 9:00 Review and brief.** Run the independent review. Read one evidence objection and one
assumption objection, and respond to one. In the brief, show the assumptions, uncertainty, risks,
recommendations (each linked to a finding, with an owner function and a validation step) and the
validation plan. Say that a staged trial with named measures is the kind of check the plan proposes.

**9:00 to 10:00 Exports and questions.** Export Markdown, JSON or the printable page. Ask the analyst
one question the sources answer ("How many cases did the pilot cover and how many did the assistant
resolve?") and one they cannot ("What was the support headcount in 2019?"). Say that rules mode
returns the nearest passages.

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
