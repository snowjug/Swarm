# Launch pricing

> What could happen if we launch the new plan at a higher price with a free trial removed?

An invented software company that sells a project-planning tool is weighing a new plan at a higher
price with no free trial. The evidence is four short documents: a launch brief, funnel data with a
small price test, notes from sales, support and customer success, and market notes with a list of what
nobody has measured. The company, its customers, its competitors and every figure are invented.

Back to the [example scenarios](../README.md). The text the picker loads is in
[`shared/examples/launch-pricing.ts`](../../../../shared/examples/launch-pricing.ts), and the files
in this folder are readable copies of it.

## The evidence

| File                                                                             | What it is                                                          | Why it is in the pack                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [01-launch-brief.md](./01-launch-brief.md)                                       | The proposal, what has been said so far, and the timing             | Context that names many roles in ordinary sentences, with undecided points left open |
| [02-funnel-and-pricing-test-summary.md](./02-funnel-and-pricing-test-summary.md) | Trial and conversion figures, an earlier price test, an exit survey | Numbers that can be checked by arithmetic, and a test too small to show an effect    |
| [03-sales-support-and-partner-notes.md](./03-sales-support-and-partner-notes.md) | Notes from sales, customer success, support and partners            | The internal concerns, and a sales figure that disagrees with the funnel             |
| [04-market-notes-and-gaps.md](./04-market-notes-and-gaps.md)                     | Three competitors' plans, an analyst's note, and what is not known  | The competitive context and the stated gaps                                          |

## Built in on purpose

**One source conflict** that the evidence ledger flags (a test pins it): the funnel data says 34% of
new paid accounts began with a free trial. The regional sales leads say about 60%.

**Tensions only a reader will notice.** The launch brief says sales staff report that larger
prospects rarely use the trial, while the sales notes say larger deals often start with a trial run by
one champion inside the customer. One manager reads the Team plan customers' requests for reporting as
either demand for the new plan or a wish for the features at no extra cost. Support cannot tell whether
removing the trial would reduce its load or move it into the first paid month.

**Arithmetic the evidence supports.** This is your own check, not a Swarm result: 17% of 12,400 trial
starts is about 2,100 conversions within 30 days, and 34% of about 6,200 new paid accounts is also
about 2,100. For 60% to hold, about 3,700 accounts would need to have started with a trial, which
needs either conversions after 30 days or a different way of counting. The pack does not say which, and
that is a data pull, not a simulation. The earlier price test had about 110 trial starts in its test
group, so the pack's own 15.8% against 17.0% cannot be told from noise, and it says so.

**Evidence gaps the brief should show as uncertainty:** no price above $34 has ever been tested; no
evidence on how many existing customers would move to a $39 plan, or leave, if the Team plan closed to
new sign-ups; nothing separating customers who would have bought without a trial from those who needed
one; no view from procurement teams at larger customers; accounts that come through partners have not
been modelled; no figure for what the trial costs in support and infrastructure.

**Open points in the question itself.** "The new plan", "a higher price", and "a free trial removed"
are not defined: how much higher, removed from the new plan only or from every plan, what happens to
existing customers, over what period, and what counts as a good outcome. The brief says only that the
Team plan's future and existing customers are undecided. The intake step should raise these as
questions to answer.

Roles you can expect discovery to find and cite, depending on the mode: the head of product, the
chief financial officer, marketing managers, sales staff and account executives, customer success
managers, the support team, channel partners and resellers, procurement teams at larger customers,
small teams as prospects, analysts, and three competitors. Rules mode reads for generic role words and
will find fewer and plainer ones than a model.

Alternatives worth adding by hand if the form has none: a smaller price rise; keeping a shorter trial;
a trial limited to some features; the Team plan kept on sale; existing customers moved or left alone.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** Entry page, **Try an example**, **Launch pricing**. Say: "Swarm
explores scenarios. It does not guarantee or precisely predict real-world behavior. This is an
invented software company and invented evidence, and each document says so." Point at the question and
the sample provenance with the licence `Synthetic, CC0`.

**0:30 The question (40 s).** **Understand my question**. Point at the two changes (a higher price and
no trial), the baseline and the assumptions with their origin. Say what the question leaves open: how
much higher, which plans lose the trial, what happens to existing customers, and what counts as a good
outcome. Answer one, then **Use this scenario**.

**1:10 The evidence (30 s).** **Build Graph**. Open the funnel summary. Say: "Every passage keeps its
source. The ledger later compares sources and shows where they disagree."

**1:40 Stakeholders and actors (60 s).** **Env Setup**, **Find stakeholders**. Point at the prospects
and customers, sales, marketing, customer success, partners and competitors, each with a cited quote,
the uncertainty chips and the prompt about roles nobody was found for. Say: "Roles, with the passage
shown. They are not real people." **Approve stakeholders and create actors**; point at a trait and its
origin badge.

**2:40 Compare scenarios (60 s).** **Simulation**, **Compare scenarios**. Point at the baseline and
the proposed change, the spread across the seeded runs, one finding with "N of 30 seeded runs" and its
stability chip, and the sensitivity view. Say: "This counts simulated runs. It is not a conversion
rate."

**3:40 The decision brief (50 s).** **Report**, **Generate decision brief**. Read the executive
answer and its origin chips. In the evidence base, open the source conflict (34% against 60%) and say:
"Finance's funnel and the sales leads disagree on how many customers started with a trial. Swarm shows
both and does not pick one." Show the uncertainty about prices above $34 and the validation plan.

**4:30 One objection (20 s).** Run the independent review and read one objection with its basis.
Say: "A critic challenges and never edits. I can respond, accept or dispute it."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table and a plan
to check them. It supports a person's analysis; it does not make the decision."

## Ten-minute script

The five-minute script, slower, with the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "A price and a trial are the kind of change where everyone has an
opinion and nobody has tested the new price."

**1:00 to 2:30 The question and the scenario.** Edit a field of the scenario form and show the label
that records that you changed it. Add an alternative by hand (for example, a shorter trial). Say: "The
alternatives are what we compare against the baseline, so they are mine to define."

**2:30 to 3:30 Evidence.** **Build Graph**, then the funnel summary and the sales notes. Search the
evidence for "trial" and open two passages. Do the arithmetic aloud and say it is your own check, and
that the pack does not settle it.

**3:30 to 5:00 Stakeholders and actors.** Open three stakeholders and read their cited quotes. Edit
one stakeholder's priority and remove or merge one. Read the prompt about roles nobody was found for
and say what you would do. Approve, then change one trait on one actor and show its badge change to
"you".

**5:00 to 6:30 Compare scenarios.** Run the comparison. Show the response distribution per scenario,
the trajectory band and two findings with their intervals. If one is unstable, say what that means.
Open the second-order chain and read it aloud: a competitor's or a partner's reaction follows from
generic rules, not from a script written for this example.

**6:30 to 7:30 Sensitivity.** Point at the assumptions the result moves with and find one with no
evidence behind it. Say: "This is what we would test first, and the validation plan says how."

**7:30 to 9:00 Review and brief.** Run the independent review. Read one evidence objection and one
assumption objection, and respond to one. In the brief, show the assumptions, uncertainty,
recommendations (each linked to a finding, with an owner function and a validation step) and the
validation plan. Say that a staged price test with named measures is the kind of check the plan
proposes, and that the evidence has none above $34.

**9:00 to 10:00 Exports and questions.** Export Markdown, JSON or the printable page. Ask the analyst
one question the sources answer ("What share of new paid accounts began with a free trial?") and one
they cannot ("What was the company's revenue in 2019?"). Say that rules mode returns the nearest
passages.

## Points specific to this example

- "The price test was too small to show an effect, and the pack says so. Do not read 15.8% against
  17.0% as one."
- "The funnel and the sales leads disagree on the trial share. A data pull settles that, not a
  simulation."
- "Nobody has tested a price above $34. The brief should show that as uncertainty."

## Objections specific to this example

**"Which is right, 34% or 60%?"** The pack does not say. The funnel's figures are consistent with
each other, and the sales figure would need conversions after 30 days or a different way of
counting. That is a check on the accounts' own data, and the validation plan is where it belongs.

**"Does it tell us the right price?"** No. It explores how different roles might react to a stated
change, under assumptions you can read and edit, and says which assumptions the result depends on.

**"Would customers leave?"** The pack has no evidence on that. Any such finding in the analysis is a
count of simulated runs, not a rate in the real world, and the brief should show it with its
assumptions and its limits.

**"Is this our company?"** No. The company, the plans, the prices and the competitors are invented.
