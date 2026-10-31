# Regional cloud price change

> What could happen if AWS increases the price of a particular cloud service by $1 in a selected
> region?

An invented software company of about 310 employees, which sells analytics to retailers, reads a
short relayed notice about a hypothetical one-dollar increase for one managed service in one region.
AWS is named only because the question names it. The service, the region, every price and the
company are invented, and nothing here is a real price list or a real notice.

Back to the [example scenarios](../README.md). The text the picker loads is in
[`shared/examples/regional-price-change.ts`](../../../../shared/examples/regional-price-change.ts), and
the files in this folder are readable copies of it.

## The evidence

| File                                                                                   | What it is                                                                | Why it is in the pack                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [01-finops-brief.md](./01-finops-brief.md)                                             | The finance team's working brief: premise, position, who is asking what   | Context that names many roles, with finance's own count of fixed-price contracts              |
| [02-usage-and-spend-summary.md](./02-usage-and-spend-summary.md)                       | Usage and cost by region at list price                                    | Numbers that can be checked by arithmetic, and a discount whose treatment is not stated       |
| [03-engineering-migration-note.md](./03-engineering-migration-note.md)                 | Platform engineers on what moving workloads out of the region would take  | The risk note: effort, contracts that pin data to a jurisdiction, capacity, a second provider |
| [04-sales-contracts-and-customers-note.md](./04-sales-contracts-and-customers-note.md) | Sales operations on contracts, earlier price rises, competitors, partners | Customer, competitor and partner behaviour as the sales team remembers it                     |
| [05-notice-as-relayed-and-gaps.md](./05-notice-as-relayed-and-gaps.md)                 | The reseller's message, a consultancy's estimate, and what nobody knows   | The stated gaps: no billing unit, date or scope, no price history, no customer view           |

## Built in on purpose

**Two source conflicts** that the evidence ledger flags (a test pins them):

- Finance says fixed-price contracts cover 38% of annual recurring revenue. Sales operations says
  55%. Sales operations counts contracts renewing within twelve months as fixed, and finance treats
  them as variable: the same words describe two definitions.
- The platform team estimates 9 engineer-months to move the workloads out of the region. A
  consultancy that offered migration services estimates 4, and would earn fees from the work.

**Tensions only a reader will notice.** The reseller calls the change modest. Finance reads the
one-dollar figure as per capacity block per month, while an engineering lead assumed it applied only
to the largest configurations. The last price rise two years ago coincided with a product outage, so
its effect on cancellations cannot be separated.

**Arithmetic the evidence supports.** This is your own check, not a Swarm result: 18,400 block-months
at $1 is $18,400 a month, or $220,800 a year at list price, before any discount. The pack does not say
whether the 18% committed-spend discount would apply to an increase. About 11,500 of the 18,400
block-months serve customers whose contracts set data-residency terms, and eleven customers have
contracts that name the jurisdiction.

**Evidence gaps the brief should show as uncertainty:** the notice has no billing unit, effective
date or scope; no price history for the provider in the region; nothing on other customers of the
provider or on what rival cloud providers charge; no regulator view; customers and resale partners
have not been asked; the sales team has not been asked about migration.

**Open points in the question itself.** "$1" is given without a unit, a time or a size relative to the
current price, "a particular cloud service" and "a selected region" are not named, and no horizon or
success measure is stated. The intake step should raise these as questions to answer.

Roles you can expect discovery to find and cite, depending on the mode: the finance team, engineering
and platform teams, the security team, the sales director and sales operations, customer success
managers, small retailers on monthly plans, large retailers and public-sector customers with
procurement teams, the board's audit committee and external auditors, investors, the cloud reseller,
a migration consultancy, implementation partners, rival analytics vendors, and the provider as the
supplier. Rules mode reads for generic role words and will find fewer and plainer ones than a model.

Alternatives worth adding by hand if the form has none: absorb the increase; pass it on at renewal;
move part of the workload to the second region; negotiate a commitment through the reseller.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** Entry page, **Try an example**, **Regional cloud price change**.
Say: "Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.
AWS is in the question; the documents describe an invented company reading an invented notice. Every
price is made up, and each document says so." Point at the question and at the sample provenance
with the licence `Synthetic, CC0`.

**0:30 The question (40 s).** **Understand my question**. Say: "It reads my question into a form I
can edit." Point at the quantity change ($1), the region, the baseline and the assumptions with
their origin. Say what the question leaves open: the unit, the service, the region and the timing.
Answer one open point, then **Use this scenario**.

**1:10 The evidence (30 s).** **Build Graph**. Open the notice document. Say: "The only evidence
about the change is a short relayed message. It names no billing unit and no date. Swarm will carry
that gap forward instead of filling it."

**1:40 Stakeholders and actors (60 s).** **Env Setup**, **Find stakeholders**. Point at the note on
how they were found, a few cited quotes (finance, engineering, customers, the reseller, rival
vendors), the uncertainty chips, and the prompt about roles nobody was found for. Say: "Roles, with
the passage shown." Then **Approve stakeholders and create actors**; point at a trait and its origin
badge. Say: "Population sizes are assumptions."

**2:40 Compare scenarios (60 s).** **Simulation**, **Compare scenarios**. Point at the baseline and
the proposed change, the spread across the seeded runs, one finding with "N of 30 seeded runs" and
its stability chip, and the sensitivity view with the assumption that has no evidence behind it. Say:
"This counts simulated runs. It is not a rate in the real world."

**3:40 The decision brief (50 s).** **Report**, **Generate decision brief**. Read the executive
answer and its origin chips. In the evidence base, open one of the two source conflicts (38% against
55%) and say: "Same words, two definitions. Swarm does not pick one." Show the unresolved uncertainty
about the notice and the validation plan, for example what to ask the provider and what to measure
with customers.

**4:30 One objection (20 s).** Run the independent review and read one objection with its basis.
Say: "A critic challenges and never edits. I can respond, accept or dispute it."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table and a plan
to check them. It supports a person's analysis; it does not make the decision."

## Ten-minute script

The five-minute script, slower, with the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "The arithmetic is easy. The open questions are behavioural: who
absorbs the cost, who passes it on, who moves, who complains, how rivals and partners respond." Do
the arithmetic aloud ($18,400 a month at list price) and say it is your own check.

**1:00 to 2:30 The question and the scenario.** Edit a field of the scenario form and show the label
that records that you changed it. Add an alternative by hand (for example, absorb the cost for a year).
Say: "The alternatives are what we compare against the baseline, so they are mine to define."

**2:30 to 3:30 Evidence.** **Build Graph**, then the notice, the usage summary and the sales note.
Search the evidence for "discount" and open a passage or two. Say: "The agreement summary does not say
whether the discount applies to an increase. Nobody has filled that gap here, and Swarm does not
either."

**3:30 to 5:00 Stakeholders and actors.** Open three stakeholders and read their cited quotes (for
example finance, customers on monthly plans, the reseller). Edit one stakeholder's priority and
remove or merge one. Read the prompt about roles nobody was found for and say what you would do. Approve,
then change one trait on one actor with a slider and show its badge change to "you".

**5:00 to 6:30 Compare scenarios.** Run the comparison. Show the response distribution per scenario,
the trajectory band and two findings with their intervals. If one is unstable, say what that means.
Open the second-order chain and read it aloud ("because ... then ..."): a rival's or a partner's
reaction follows from generic rules, not from a script written for this example.

**6:30 to 7:30 Sensitivity.** Point at the assumptions the result moves with and find one with no
evidence behind it. Say: "This is what we would test first, and the validation plan says how."

**7:30 to 9:00 Review and brief.** Run the independent review. Read one evidence objection (for
example, open source conflicts, or sources without a date) and one assumption objection, and respond
to one. Open the brief: assumptions, uncertainty, risks, recommendations (each linked to a finding,
with an owner function and a validation step), the validation plan and limitations. Show where the
missing billing unit appears.

**9:00 to 10:00 Exports and questions.** Export Markdown, JSON or the printable page. Ask the analyst
one question the sources answer ("How long would the platform team need to move workloads out of
Region R?") and one they cannot ("What was the company's headcount in 2019?"). Say that rules mode
returns the nearest passages.

## Points specific to this example

- "The only evidence about the change itself is one relayed message, and it leaves out the unit, the
  date and the scope."
- "Finance and sales operations use the same words for different definitions. The ledger shows both."
- "The consultancy would earn fees from the migration it is estimating. The pack says so, and
  Swarm does not use that to pick a number."
- "Nothing in the pack is a real price. The figures labelled illustrative are placeholders."

## Objections specific to this example

**"Is this what AWS would do, or what it would cost?"** No. AWS is in the question. The service,
the region, the prices and the company are invented for the exercise, and nothing here is a real
notice.

**"It is only a multiplication. Why simulate?"** The multiplication is in the evidence and is easy to
check. The hard part is behavioural: whether the company absorbs or passes on the increase, whether
customers on fixed prices, monthly plans or procurement-led renewals react differently, and what rival
vendors, partners and resellers do. Swarm explores those under declared assumptions and shows which
assumptions the result depends on.

**"Does a one-dollar rise matter?"** Whether it is material is what the brief explores. With the
invented figures it is 11% of the list price in the region, and the pack does not say whether
discounts apply.

**"Which migration estimate is right?"** The pack does not say. One comes from the team that would
do the work, the other from a firm that would be paid to do it. The validation plan, not the
simulation, is where that gets settled.
