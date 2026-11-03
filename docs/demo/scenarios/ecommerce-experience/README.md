# Online store: delivery and checkout

> How might different users react if this online store changes its delivery fees, free-delivery
> threshold and checkout flow?

An invented independent online bookshop is weighing a higher free-delivery threshold, a fee that
depends on delivery speed, a one-page checkout and a paid membership. The evidence is four short
documents, and a public sandbox page can be added as a fifth, to try the real address input. The
shop, its customers, its competitors and every figure are invented.

Back to the [example scenarios](../README.md). The text the sample case loads is in
[`shared/examples/ecommerce-experience.ts`](../../../../shared/examples/ecommerce-experience.ts), and
the files in this folder are readable copies of it.

## The evidence

| File                                                                       | What it is                                                           | Why it is in the pack                                                               |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [01-customer-survey-summary.md](./01-customer-survey-summary.md)           | An email survey of recent customers, with paraphrased free text      | Numbers with their own caveats, and the different kinds of shopper in the free text |
| [02-support-ticket-themes.md](./02-support-ticket-themes.md)               | Support ticket themes and the operational concerns of internal teams | The risk note, and the options under discussion, with the roles around the checkout |
| [03-analytics-summary.md](./03-analytics-summary.md)                       | Funnel, order value and exit pop-up answers for a quarter            | The numbers that can be checked by arithmetic, and what the analytics cannot show   |
| [04-competitor-delivery-policies.md](./04-competitor-delivery-policies.md) | Delivery policies of four invented sellers, noted by the shop's team | The competitive context, and a respondent's claim that the notes do not support     |

## The optional public page

The example's data names `https://books.toscrape.com/` as a page to try (`urlSuggestion` in
[`shared/examples/ecommerce-experience.ts`](../../../../shared/examples/ecommerce-experience.ts)), but
the first screen does not show the suggestion: type or paste the address yourself, under **Evidence** →
**Web page**. It is a public practice site built for
learning web scraping: a catalogue of books with prices in pounds and stock status. The page says
its prices and ratings were assigned at random, so it is not a real shop and no real customers are
involved.

Adding it lets you try the real address input: the Swarm server fetches the page, shows its title,
host, size and an excerpt, and adds it as a document whose provenance is a retrieved page, not a
sample. The four bundled documents are complete without it, and the example leaves one document
slot free for it.

## Built in on purpose

**One source conflict** that the evidence ledger flags (a test pins it), and that **Conflicts** in
Ground and **Evidence base and quality** in the brief show: the survey says 31% of
respondents who had left a basket without buying gave delivery cost as the main reason; the exit
pop-up says 41%. One is an email survey of recent customers that leans to frequent buyers, the other
is an on-site pop-up answered by 6% of the people shown it, which people who close the tab never see.

**Tensions only a reader will notice.** One respondent says free delivery above £20 is normal
across the market, while the competitor notes show £20 only for the marketplace's own items. 62% of
respondents say they added an item to reach free delivery, and the order data shows more orders just
above £30 than just below (17% against 12%). The survey says tracking matters, and "where is my
parcel" is the largest ticket theme.

**Arithmetic the evidence supports.** This is your own check, not a Swarm result: 412,000 sessions,
9.1% of which add an item, 41% of those reaching checkout and 52% of those completing it, give about
8,000 orders, which matches the pack's figure.

**Evidence gaps the brief should show as uncertainty:** what delivery costs the shop for each order,
so margin cannot be worked out; why some customers never return; what the carriers would charge for
fee tiers by speed; whether guest checkout stays; the new checkout has not been tested, and the
accessibility review has not been scheduled; one anecdote about charges that appear only on the final
page, with no regulator view. Check on your run that the brief shows them, and say so if one is
missing.

**Open points in the question itself.** "This online store", "different users" and the sizes of the
changes are not stated. The documents give the current fee and threshold and the options under
discussion; the question does not say which is chosen. The intake step should raise these as
questions to answer.

The different users here are kinds of shopper that appear in the survey's paraphrased free text: gift
buyers, students buying course books, people in remote areas, regular customers, people on phones and
guest-checkout users. They are not personas drawn from data.

Roles you can expect discovery to find and cite, depending on the mode: those kinds of shopper, the
customer support team, warehouse employees, the carriers as delivery partners, the payments provider,
the web developer, the marketing manager, finance, the operations manager, regulators such as a local
trading-standards office, and the four competitors. Rules mode reads for generic role words, so it finds
the groups the text names that way and misses the others; the review is where you add them.

Alternatives worth adding by hand if the form has none: keep the threshold and add a paid membership;
raise it to £40; charge by delivery speed; a one-page checkout that keeps guest checkout, and one that
asks for an account.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** First screen, then **Try a sample case** in the foot and **Online store
checkout**. Say: "Swarm explores scenarios. It does not guarantee or precisely predict
real-world behavior. This is an invented online bookshop and invented evidence, and each document says
so." Point at the question and at the evidence: the count on **Evidence** and the four documents in the
tray, each a sample (open one: "Sample evidence: invented, describes no real case"; in Ground it
carries the licence `Synthetic, CC0`).

**0:30 Your scenario (40 s).** **Explore**. Point at the three changes (fees, threshold, checkout),
**If nothing changes** and **Assumed**, where a dot says who made each assumption. Say what the question
leaves open: how big the changes are, and what counts as a good outcome. Answer one under **Swarm asks**
(**Answer**). If you have network access, add the public page now, before you go on (see the ten-minute
script). Then **Ground it**.

**1:10 Ground (30 s).** Point at the evidence and open the analytics summary under **Sources**. Say:
"Every passage keeps its source. Ground compares the sources and shows where they disagree."

**1:40 Map: stakeholders and actors (60 s).** **Map the stakeholders**, **Find who is affected**. Point
at the parties on the map, "N to review", the chip that says how they were found, one party opened to
its cited quotes and confidence, and the **Nobody found for** prompts. Say: "Kinds of shopper from survey
free text, not real individuals." Then **Create actors**, open an actor's **Traits**, and
point at one trait and its origin chip.

**2:40 Simulate and Compare (60 s).** **Simulate**, **Run the simulation**. Watch the replay in **Live**,
then choose **Compare**. Point at the baseline and the proposed change on the gap chart, a tick for each
seeded run, one finding with "It held in N of 30 seeded runs" and its class, and **Depends on**. Say:
"These are simulated members and seeded runs. They are not a conversion rate."

**3:40 Decide: the decision brief (50 s).** **Decide**, **Write the brief**. Read the verdict and the
numbers under **What happened**, and the origin mark on a statement. The evidence base is closed until
you open it from the contents: this pack was built with one source conflict, so open **Evidence base
and quality**, find it (31% against 41%) and say: "Two methods, two answers. Swarm shows both and does
not pick one." Then look for the uncertainty about delivery cost per order and the untested checkout,
and at the **Validation plan** (open, right after the recommendations).

**4:30 One objection (20 s).** Choose **Review**, then **Run the independent review**, and read one
objection with its basis. Say: "A critic challenges and never edits. I can respond, accept or dispute
it."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table and a plan
to check them. It supports a person's analysis; it does not make the decision."

## Ten-minute script

The five-minute script, slower, with the real address input and the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "The bundled documents are complete. A public page is optional
and I will add one in a minute."

**1:00 to 2:30 The question and the scenario.** Edit one field of **Your scenario** and point at the chip
at the top: it now reads "Edited by you". Add one alternative by hand with **Add a way** (for example,
keep the threshold and add a paid membership). Say: "The alternatives are what we compare against the
baseline, so they are mine to define."

**2:30 to 4:00 The public page.** Still on **Your scenario**, under **Evidence** choose **Add evidence**,
then **Web page**, type `https://books.toscrape.com/` into **Web address** and choose **Fetch**. Point at
the title, the site, the size, the time and the excerpt. Say: "The Swarm server fetched this, not my
browser. It is a public practice site, and the page itself says its prices and ratings were assigned at
random, so it tells us what a catalogue page looks like, not what any shop's customers do." Choose **Add
as evidence** and point at the new document: a retrieved page, tagged with its site, and in Ground the
time it was retrieved. Say: "If the page and the shop's analytics look inconsistent, that is expected.
The analytics are invented too. What matters is that the two kinds of evidence keep different labels."
If the fetch fails, read the notice: it says why and offers to let you paste the text instead. Leave it
out and continue; the example does not need it. Then **Ground it**.

**4:00 to 5:30 Map: stakeholders and actors.** **Map the stakeholders**, **Find who is affected**. Open
three parties and read their cited quotes under **Evidence**. Edit one (**Edit** on the party, or
**Modelled as** for its priority) and **Merge** or **Remove** one. Read the prompts about roles nobody
was found for. **Create actors**, open an actor, then change one trait with its slider and
show the chip change to "you"; **Save** keeps it.

**5:30 to 7:00 Simulate and Compare.** **Run the simulation** and watch **Live**. Then **Compare**: show
the gap chart and the two shares, **How it unfolds** (the spread of runs over the rounds), and two
findings under **What holds** with their intervals. If one is unstable, say what that means. Read **Sets
off** aloud: a competitor's or a carrier's reaction follows from generic rules, not from a script written
for this example.

**7:00 to 8:00 What the result depends on.** Under **Depends on**, point at the assumptions the result
moves with and find one with no evidence behind it. Say: "This is what we would test first, and the
validation plan says how."

**8:00 to 9:30 Decide: review and brief.** **Decide**, **Write the brief**, then **Review** and **Run the
independent review**. Read one evidence objection and one assumption objection, and respond to one. In
the brief, open **Sources and provenance** from the contents and look for the retrieved page, if you
added it, and how its origin differs from the supplied documents. Then look at the assumptions,
uncertainty, recommendations and the validation plan (the recommendations and the plan are open, the
assumptions and the uncertainty are closed until opened from the contents).

**9:30 to 10:00 Exports.** **Export** → **Markdown**, **JSON, with the data behind the charts** or
**Printable page**.

## Points specific to this example

- "The survey and the pop-up measure different things in different populations. Neither is declared
  true."
- "The shop does not know what each delivery costs it, and the pack says so."
- "The new checkout has not been tested with anyone. The pack says that too."
- "The public page is evidence about a catalogue page, not about this shop."

## Objections specific to this example

**"Is the sandbox page real data?"** No. The page says its prices and ratings were assigned at
random. It is a practice site for web scraping, which is why it is safe to fetch. It shows how a
retrieved page enters the analysis with its own label.

**"Does my browser fetch it?"** No. The address is fetched by the Swarm server, which allows only
public pages and refuses private or internal addresses. If you cannot reach it, paste the text.

**"Which is right, 31% or 41%?"** The pack does not say. The two figures come from different
methods and populations, and only a real-world check settles it, for example by asking the same question
of the same people; see whether the validation plan proposes something like that.

**"Are these shoppers real?"** No. They are kinds of shopper described, in paraphrase, in an invented
survey. Their numbers in the simulation are assumptions with their origin shown.

**"Does it check that the checkout is accessible?"** No. The pack says the accessibility review has
not been scheduled, and Swarm does not test interfaces. It can only carry that gap into the brief.
