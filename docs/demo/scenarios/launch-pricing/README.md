# Launch pricing

> What could happen if we launch the new plan at a higher price with a free trial removed?

An invented software company that sells a project-planning tool is weighing a new plan at a higher
price with no free trial. The evidence is four short documents: a launch brief, funnel data with a
small price test, notes from sales, support and customer success, and market notes with a list of what
nobody has measured. The company, its customers, its competitors and every figure are invented.

Back to the [example scenarios](../README.md). The text the example chip loads is in
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

**One source conflict** that the evidence ledger flags (a test pins it), and that **Conflicts** in
Ground and **Evidence base and quality** in the brief show: the funnel data says 34% of
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
been modelled; no figure for what the trial costs in support and infrastructure. Check on your run
that the brief shows them, and say so if one is missing.

**Open points in the question itself.** "The new plan", "a higher price", and "a free trial removed"
are not defined: how much higher, removed from the new plan only or from every plan, what happens to
existing customers, over what period, and what counts as a good outcome. The brief says only that the
Team plan's future and existing customers are undecided. The intake step should raise these as
questions to answer.

Roles you can expect discovery to find and cite, depending on the mode: the head of product, the
chief financial officer, marketing managers, sales staff and account executives, customer success
managers, the support team, channel partners and resellers, procurement teams at larger customers,
small teams as prospects, analysts, and three competitors. Rules mode reads for generic role words, so it
finds the groups the text names that way and misses the others; the review is where you add them.

Alternatives worth adding by hand if the form has none: a smaller price rise; keeping a shorter trial;
a trial limited to some features; the Team plan kept on sale; existing customers moved or left alone.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** First screen, then the **Launch pricing** chip under **Start from an
example**. Say: "Swarm explores scenarios. It does not guarantee or precisely predict real-world
behavior. This is an invented software company and invented evidence, and each document says so."
Point at the question and at the evidence: the count on **Evidence** and the four documents in the
tray, each a sample (open one: "Sample evidence: invented, describes no real case"; in Ground it
carries the licence `Synthetic, CC0`).

**0:30 Your scenario (40 s).** **Explore**. Point at the two changes (a higher price and no trial),
**If nothing changes** and **Assumed**, where a dot says who made each assumption. Say what the question
leaves open: how much higher, which plans lose the trial, what happens to existing customers, and what
counts as a good outcome. Answer one under **Swarm asks** (**Answer**), then **Ground it**.

**1:10 Ground (30 s).** Open the funnel summary under **Sources**. Say: "Every passage keeps its
source. Ground compares the sources and shows where they disagree."

**1:40 Map: stakeholders and actors (60 s).** **Map the stakeholders**, **Find who is affected**. Point
at the parties on the map, "N to review", the chip that says how they were found, one party opened to
its cited quotes and confidence, and the **Nobody found for** prompts. Say: "Roles, with the passage
shown. They are not real people." Then **Approve & create actors**, open an actor's **Traits**, and
point at one trait and its origin chip.

**2:40 Simulate and Compare (60 s).** **Simulate**, **Run the simulation**. Watch the replay in **Live**,
then choose **Compare**. Point at the baseline and the proposed change on the gap chart, a tick for each
seeded run, one finding with "It held in N of 30 seeded runs" and its class, and **Depends on**. Say:
"These are simulated members and seeded runs. They are not a conversion rate."

**3:40 Decide: the decision brief (50 s).** **Decide**, **Write the brief**. Read the verdict and the
numbers under **What happened**, and the origin mark on a statement. The evidence base is closed until
you open it from the contents: this pack was built with one source conflict, so open **Evidence base
and quality**, find it (34% against 60%) and say: "Finance's funnel and the sales leads disagree on how
many customers started with a trial. Swarm shows both and does not pick one." Then look for the
uncertainty about prices above $34, and at the **Validation plan** (open, right after the
recommendations).

**4:30 One objection (20 s).** Choose **Review**, then **Run the independent review**, and read one
objection with its basis. Say: "A critic challenges and never edits. I can respond, accept or dispute
it."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table and a plan
to check them. It supports a person's analysis; it does not make the decision."

## Ten-minute script

The five-minute script, slower, with the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "A price and a trial are the kind of change where everyone has an
opinion and nobody has tested the new price."

**1:00 to 2:30 The question and the scenario.** Edit one field of **Your scenario** and point at the chip
at the top: it now reads "Edited by you". Add one alternative by hand with **Add a way** (for example, a
shorter trial). Say: "The alternatives are what we compare against the baseline, so they are mine to
define."

**2:30 to 3:30 Ground: the evidence.** **Ground it**, then the funnel summary and the sales notes under
**Sources**. Choose the **Passages** figure, search for "trial" and open two passages. Do the arithmetic
aloud and say it is your own check, and that the pack does not settle it.

**3:30 to 5:00 Map: stakeholders and actors.** **Map the stakeholders**, **Find who is affected**. Open
three parties and read their cited quotes under **Evidence**. Edit one (**Edit** on the party, or
**Modelled as** for its priority) and **Merge** or **Remove** one. Read the prompts about roles nobody
was found for and say what you would do. **Approve & create actors**, open an actor, then change one
trait with its slider and show the chip change to "you"; **Save** keeps it.

**5:00 to 6:30 Simulate and Compare.** **Run the simulation** and watch **Live**. Then **Compare**: show
the gap chart and the two shares, **How it unfolds** (the spread of runs over the rounds), and two
findings under **What holds** with their intervals. If one is unstable, say what that means. Read **Sets
off** aloud: a competitor's or a partner's reaction follows from generic rules, not from a script
written for this example.

**6:30 to 7:30 What the result depends on.** Under **Depends on**, point at the assumptions the result
moves with and find one with no evidence behind it. Say: "This is what we would test first, and the
validation plan says how."

**7:30 to 9:00 Decide: review and brief.** **Decide**, **Write the brief**, then **Review** and **Run the
independent review**. Read one evidence objection and one assumption objection, and respond to one. In
the brief, look at the recommendations (each resting on the findings it cites, with an owner function
and a way to check it) and the **Validation plan**, which are open, and at the assumptions and
uncertainty, which are closed until opened from the contents. Say that a staged price test with named
measures is the kind of check a validation plan should propose, and check whether yours does; the
evidence has none above $34.

**9:00 to 10:00 Exports and questions.** **Export** → **Markdown**, **JSON, with the data behind the
charts** or **Printable page**. **Ask about this** opens once a detailed report exists, so run the deep
dive first (**Simulate** → **More** → **Deep dive**, **Prepare the environment**, **Start the
simulation**, **Write the detailed report**), or leave this step out. Then ask the analyst one question
the sources answer ("What share of new paid accounts began with a free trial?") and one they cannot
("What was the company's revenue in 2019?"). Say that rules mode returns the nearest passages.

## Points specific to this example

- "The price test was too small to show an effect, and the pack says so. Do not read 15.8% against
  17.0% as one."
- "The funnel and the sales leads disagree on the trial share. A data pull settles that, not a
  simulation."
- "Nobody has tested a price above $34, and the pack says so."

## Objections specific to this example

**"Which is right, 34% or 60%?"** The pack does not say. The funnel's figures are consistent with
each other, and the sales figure would need conversions after 30 days or a different way of
counting. That is a check on the accounts' own data, and the validation plan is where it belongs.

**"Does it tell us the right price?"** No. It explores how different roles might react to a stated
change, under assumptions you can read and edit, and says which assumptions the result depends on.

**"Would customers leave?"** The pack has no evidence on that. Any such finding in the analysis is about
simulated members and seeded runs, not a rate in the real world, and the brief labels its origin.

**"Is this our company?"** No. The company, the plans, the prices and the competitors are invented.
