# Online store: delivery and checkout

> How might different users react if this online store changes its delivery fees, free-delivery
> threshold and checkout flow?

An invented independent online bookshop is weighing a higher free-delivery threshold, a fee that
depends on delivery speed, a one-page checkout and a paid membership. The evidence is four short
documents, and a public sandbox page can be added as a fifth, to try the real address input. The
shop, its customers, its competitors and every figure are invented.

Back to the [example scenarios](../README.md). The text the picker loads is in
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

The picker may suggest `https://books.toscrape.com/`. It is a public practice site built for
learning web scraping: a catalogue of books with prices in pounds and stock status. The page says
its prices and ratings were assigned at random, so it is not a real shop and no real customers are
involved.

Adding it lets you try the real address input: the Swarm server fetches the page, shows its title,
host, size and an excerpt, and adds it as a document whose provenance is a retrieved page, not a
sample. The four bundled documents are complete without it, and the example leaves one document
slot free for it.

## Built in on purpose

**One source conflict** that the evidence ledger flags (a test pins it): the survey says 31% of
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
page, with no regulator view.

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
trading-standards office, and the four competitors. Rules mode reads for generic role words and will
find fewer and plainer ones than a model.

Alternatives worth adding by hand if the form has none: keep the threshold and add a paid membership;
raise it to £40; charge by delivery speed; a one-page checkout that keeps guest checkout, and one that
asks for an account.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** Entry page, **Try an example**, **Online store: delivery and
checkout**. Say: "Swarm explores scenarios. It does not guarantee or precisely predict real-world
behavior. This is an invented online bookshop and invented evidence, and each document says so."
Point at the question and the sample provenance with the licence `Synthetic, CC0`.

**0:30 The question (40 s).** **Understand my question**. Point at the three changes (fees,
threshold, checkout), the baseline and the assumptions with their origin. Say what the question
leaves open: how big the changes are, and what counts as a good outcome. Answer one, then **Use this
scenario**.

**1:10 The evidence (30 s).** Point at the document list and open the analytics summary. Say: "Every
passage keeps its source. The ledger later compares sources and shows where they disagree." If you
have network access, add the public page first (see the ten-minute script). Then press **Build
Graph**.

**1:40 Stakeholders and actors (60 s).** **Env Setup**, **Find stakeholders**. Point at the kinds of
shopper, the support team, the warehouse, the carriers and the competitors, each with a cited quote,
the uncertainty chips and the prompt about roles nobody was found for. Say: "Kinds of shopper from
survey free text, not real individuals." **Approve stakeholders and create actors**; point at a trait
and its origin badge.

**2:40 Compare scenarios (60 s).** **Simulation**, **Compare scenarios**. Point at the baseline and
the proposed change side by side, the spread across the seeded runs, one finding with "N of 30 seeded
runs" and its stability chip, and the sensitivity view. Say: "This counts simulated runs. It is not
a conversion rate."

**3:40 The decision brief (50 s).** **Report**, **Generate decision brief**. Read the executive
answer and its origin chips. In the evidence base, open the source conflict (31% against 41%) and say:
"Two methods, two answers. Swarm shows both and does not pick one." Show the uncertainty about
delivery cost per order and the untested checkout, and the validation plan.

**4:30 One objection (20 s).** Run the independent review and read one objection with its basis.
Say: "A critic challenges and never edits. I can respond, accept or dispute it."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table and a plan
to check them. It supports a person's analysis; it does not make the decision."

## Ten-minute script

The five-minute script, slower, with the real address input and the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "The bundled documents are complete. A public page is optional
and I will add one in a minute."

**1:00 to 2:30 The question and the scenario.** Edit a field of the scenario form and show the label
that records that you changed it. Add an alternative by hand (for example, keep the threshold and add
a paid membership). Say: "The alternatives are what we compare against the baseline, so they are mine
to define."

**2:30 to 4:00 The public page.** In the evidence section, paste `https://books.toscrape.com/` and
fetch it. Point at the title, the host, the size and the excerpt. Say: "The Swarm server fetched
this, not my browser. It is a public practice site, and the page itself says its prices and ratings
were assigned at random, so it tells us what a catalogue page looks like, not what any shop's
customers do." Add it as evidence and point at its provenance: a retrieved page, with the time it
was retrieved. Say: "If the page and the shop's analytics look inconsistent, that is expected. The
analytics are invented too. What matters is that the two kinds of evidence keep different labels."
If the fetch fails, read the message: it says why and offers to let you paste the text instead.
Leave it out and continue; the example does not need it.

**4:00 to 5:30 Stakeholders and actors.** **Build Graph**, then **Find stakeholders**. Open three
stakeholders and read their cited quotes. Edit one stakeholder's priority and remove or merge one.
Read the prompt about roles nobody was found for. Approve, then change one trait on one actor and
show its badge change to "you".

**5:30 to 7:00 Compare scenarios.** Run the comparison. Show the response distribution per scenario,
the trajectory band and two findings with their intervals. If one is unstable, say what that means.
Open the second-order chain and read it aloud: a competitor's or a carrier's reaction follows from
generic rules, not from a script written for this example.

**7:00 to 8:00 Sensitivity.** Point at the assumptions the result moves with and find one with no
evidence behind it. Say: "This is what we would test first, and the validation plan says how."

**8:00 to 9:30 Review and brief.** Run the independent review. Read one evidence objection and one
assumption objection, and respond to one. In the brief, show where the retrieved page, if you added
it, is listed under sources and how its origin differs from the supplied documents. Show the
assumptions, uncertainty, recommendations and the validation plan.

**9:30 to 10:00 Exports.** Export Markdown, JSON or the printable page.

## Points specific to this example

- "The survey and the pop-up measure different things in different populations. Neither is declared
  true."
- "The shop does not know what each delivery costs it. The pack says so, and the brief should show it
  as an unresolved question, not a guess."
- "The new checkout has not been tested with anyone. The pack says that too."
- "The public page is evidence about a catalogue page, not about this shop."

## Objections specific to this example

**"Is the sandbox page real data?"** No. The page says its prices and ratings were assigned at
random. It is a practice site for web scraping, which is why it is safe to fetch. It shows how a
retrieved page enters the analysis with its own label.

**"Does my browser fetch it?"** No. The address is fetched by the Swarm server, which allows only
public pages and refuses private or internal addresses. If you cannot reach it, paste the text.

**"Which is right, 31% or 41%?"** The pack does not say. The two figures come from different
methods and populations, and the validation plan is where this gets settled, for example by asking
the same question of the same people.

**"Are these shoppers real?"** No. They are kinds of shopper described, in paraphrase, in an invented
survey. Their numbers in the simulation are assumptions with their origin shown.

**"Does it check that the checkout is accessible?"** No. The pack says the accessibility review has
not been scheduled, and Swarm does not test interfaces. It can only carry that gap into the brief.
