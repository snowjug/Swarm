# Example scenarios

Five worked examples that a person can pick and run through the real pipeline: question, evidence,
stakeholder discovery, synthetic actors, repeated runs, independent review and a decision brief.

Each example is only **a question and a few documents**. It carries no answer, no list of
stakeholders, no result and no conclusion. Everything after the evidence is made by the same code
that handles any question typed into the question field on the first screen, so what the audience sees
is what Swarm does with evidence, not what an author wrote down.

Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.

## Everything here is synthetic

Every document is an invented, illustrative brief. Its first lines say so ("Illustrative synthetic
brief; figures invented for demonstration; not information from or about any real company"), and
its provenance is `sample` with the licence `Synthetic, CC0`, so the label travels with the evidence
into the stakeholder list, the analysis and the brief.

- Names such as Microsoft, Copilot, Teams and AWS appear only because the question names them, and
  only as well-known products. Nothing says what any real company has done or intends to do.
- No number in these documents is a fact about a real product, price, customer or person. Where a
  figure sits next to a real product it is labelled an illustrative figure.
- There are no quotations, addresses, contact details, logos or customer data. People are described
  by role and their words are paraphrased.

## The examples

| Example                                                                 | Question                                                                                                                    | Documents | Built in on purpose                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| [Copilot in Teams](./copilot-in-teams/README.md)                        | What could happen if Microsoft integrates Copilot more deeply into Teams and enables additional AI capabilities by default? | 5         | Two source conflicts; unknown licence terms; regulators and works councils silent                  |
| [Regional cloud price change](./regional-price-change/README.md)        | What could happen if AWS increases the price of a particular cloud service by $1 in a selected region?                      | 5         | Two source conflicts; a notice with no billing unit, date or scope; no price history               |
| [Online store: delivery and checkout](./ecommerce-experience/README.md) | How might different users react if this online store changes its delivery fees, free-delivery threshold and checkout flow?  | 4         | One source conflict; no cost per delivery; an untested checkout; a public page you can add as well |
| [AI-first support](./ai-first-support/README.md)                        | What could happen if an AI assistant handles initial troubleshooting before a customer reaches a human support engineer?    | 4         | One source conflict; a pilot that covers only part of the work; nothing on customers who give up   |
| [Launch pricing](./launch-pricing/README.md)                            | What could happen if we launch the new plan at a higher price with a free trial removed?                                    | 4         | One source conflict, plus two sales views that disagree; no price tested above $34                 |

A custom scenario needs no content here: the first screen is that path. Type any "What could happen
if...?" question and add your own documents or a public address.

Each folder holds the example's scripts and a readable copy of every document. The copies are the
same text the example chips load from [`shared/examples`](../../../shared/examples), and a test fails
if they drift apart.

| Example                                                                 | Five-minute script                                                   | Ten-minute script                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Copilot in Teams](./copilot-in-teams/README.md)                        | [Five minutes](./copilot-in-teams/README.md#five-minute-script)      | [Ten minutes](./copilot-in-teams/README.md#ten-minute-script)      |
| [Regional cloud price change](./regional-price-change/README.md)        | [Five minutes](./regional-price-change/README.md#five-minute-script) | [Ten minutes](./regional-price-change/README.md#ten-minute-script) |
| [Online store: delivery and checkout](./ecommerce-experience/README.md) | [Five minutes](./ecommerce-experience/README.md#five-minute-script)  | [Ten minutes](./ecommerce-experience/README.md#ten-minute-script)  |
| [AI-first support](./ai-first-support/README.md)                        | [Five minutes](./ai-first-support/README.md#five-minute-script)      | [Ten minutes](./ai-first-support/README.md#ten-minute-script)      |
| [Launch pricing](./launch-pricing/README.md)                            | [Five minutes](./launch-pricing/README.md#five-minute-script)        | [Ten minutes](./launch-pricing/README.md#ten-minute-script)        |

### The shape of the scripts

The product is the same for every example, so the scripts share a shape. Each one says what to
click, what to say and what to point at, with the details of its own evidence.

- **Five minutes:** choose the example (30 s); your scenario (40 s); Ground (30 s); Map: stakeholders
  and actors (60 s); Simulate and Compare (60 s); Decide: the decision brief (50 s); one objection
  from the independent review (20 s); close (10 s).
- **Ten minutes:** open (1 min); the question and the scenario (1.5 min); Ground (1 min); Map:
  stakeholders and actors (1.5 min); Simulate and Compare (1.5 min); what the result depends on
  (1 min); Decide: review and brief (1.5 min); exports and a question to the analyst (1 min). The
  online-store script adds a step for the public page.

Run an example once before you present it. The scripts contain no results, because the results
depend on the run: read the real screen and quote that.

## What every pack is built to show

Each pack was written so that a careful analyst has something real to work with, and so that the
pipeline has something to be honest about:

- **A context brief that mentions many roles** in ordinary sentences, not in a list, so that
  stakeholder discovery has something to find and cite.
- **A summary with numbers**, including caveats about who answered and how things were counted.
- **Two sources that disagree** on a figure or a claim. The evidence ledger flags the figures it can
  compare (a test pins which ones); other disagreements need a reader.
- **A note of concerns or risks** written by the people who carry them.
- **A stated evidence gap.** One document says what nobody has measured. The brief should show that
  gap as uncertainty, and the stakeholder step may show roles nobody was found for. Check on your run
  that it does; if a gap is missing from the brief, say so rather than filling it in.

If a result, a stakeholder list or a recommendation ever appears in a pack, that is a defect in the
pack: tests check for the obvious forms of it.

## Before you present

1. Start Swarm as the [README](../../../README.md#quick-start) describes (`npm.cmd run build`, then
   `npm.cmd start`, and open <http://127.0.0.1:3001>), ideally with a fresh `DATA_DIR` so that
   rehearsal projects do not mix with real ones.
2. Read the chip at the right of the top bar. With no model configured it says **Local rules**. With
   a model it names the provider (for example `REAL AZURE AI`, `REAL MODEL · OpenAI` or
   `REAL MODEL · Ollama (local)`) and the deployment, and says `connected` after **Verify connection**
   (open the chip to find it). Say which one you are in.
3. Choose an example chip under **Start from an example** on the first screen. It fills the question
   and the documents, with their provenance, and puts the cursor in the question field. Choosing an
   example only fills the question and the evidence: nothing is read or run until you press
   **Explore**.
4. Rehearse the example you will show once end to end. A run in rules mode takes seconds; a model
   run takes minutes.

The scripts below name buttons and scenes as the interface gives them (**Explore**, **Ground it**,
**Find who is affected**, **Approve & create actors**, **Run the simulation**, **Compare**, **Decide**,
**Write the brief**, **Review**, **Run the independent review**). If a label has moved in the build you
are showing, the step is the same. The [demo guide](../README.md) has the ten-minute script across the
flagship examples. The browser tests (see [TESTING.md](../../TESTING.md)) take the three flagship
examples and a question of its own through the real pages, with the public pages served from fixtures;
rehearse the example you will show before you rely on a script.

## Screens and what to point at

The order is the order of the product: Ask, Ground, Map, Simulate, Compare, Decide. Each row is
something to show, in the words you can use.

| Step                          | Point at                                                                                                                                                                                                                                                                                                                                                              | What it proves                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Ask: question and evidence    | The question, then the **Evidence** count and the tray of documents: each document opens to its text and says "Sample evidence: invented, describes no real case". In Ground, each source is tagged **Synthetic sample** and opens to its licence `Synthetic, CC0`.                                                                                                   | Evidence has a provenance, and invented evidence says so.                                                          |
| Ask: your scenario            | The scenario read from the question: the decision, **What changes**, **If nothing changes**, **Ways to do it**, **Who is affected**, **Assumed** and what **Swarm asks**.                                                                                                                                                                                             | The question is made explicit and editable before anything runs. Assumptions say who made them: you or the system. |
| Ground: conflicts             | **Conflicts**: two quotes side by side, marked **Different figures** or **Opposite statements**, with **Confirm** and **Not a conflict**. The brief lists the same conflicts under **Evidence base and quality** (closed until opened from the contents). Once the deep dive's report exists, **Statements** lists every statement with how well the sources back it. | Swarm does not choose a side. A person confirms the conflict or dismisses it.                                      |
| Map: stakeholders             | The map: parties in clusters, "N to review", one party opened to its cited quote and its confidence; the dashed **Nobody found for** prompts for roles nobody was found for.                                                                                                                                                                                          | Stakeholders are discovered from the evidence, with the passage shown, not asserted.                               |
| Map: actors                   | An actor's **Traits**: each carries a chip for where it came from (assumption, evidence, model, you).                                                                                                                                                                                                                                                                 | Synthetic actors are not people. Every number they run on is an assumption you can edit.                           |
| Simulate: the replay          | **Live**: one typical run on the map, with the scrubber, the round card and what each round **Set off**. **Story** for the answer written from the numbers.                                                                                                                                                                                                           | A run can be watched, round by round, and it is one run, not the answer.                                           |
| Compare: the futures          | The gap chart: a tick for each seeded run of the baseline and each alternative, "It held in N of 30 seeded runs" with its class.                                                                                                                                                                                                                                      | One run is never the answer. Repeatability is measured, not asserted.                                              |
| Compare: depends on           | **Depends on**: the assumptions the result moves with, and which of them have no evidence behind them.                                                                                                                                                                                                                                                                | The result's weak points are on the screen.                                                                        |
| Compare: second-order effects | **Sets off**: the chain read from the representative run (what each event acted on, then what only came first).                                                                                                                                                                                                                                                       | Competitor, partner and regulator reactions come from generic rules, not a script.                                 |
| Decide: independent review    | **Review**, then one objection, its basis, and the response form (**Respond**, **Accept**, **Dispute**).                                                                                                                                                                                                                                                              | Challenge stays visible. A critic never edits the analysis.                                                        |
| Decide: decision brief        | The verdict and **What happened** with origin marks, then the **Validation plan** (open, right after the recommendations) and, from the contents, **Important assumptions**, **Uncertainty and sensitivity** and **Limitations** (closed until opened).                                                                                                               | Every statement names where it came from, and the brief says what to check in the real world.                      |

In rules mode the interface says so at each step (for example, the chip on the map says the stakeholders
were read from your text for roles, and **How far to rely on this** says that outcomes follow from the
declared assumptions). Point at that wording. It is the honest description of what rules mode is.

## Speaking points

Say:

- "Swarm explores scenarios. It does not predict the future."
- "Everything in this example is invented, and every document says so. The point is the method."
- "The people on screen are synthetic actors. They are not real people, and their numbers are
  assumptions you can change."
- "Two sources disagree and Swarm did not pick one. A person decides."
- "A result here is about simulated members and seeded runs, not a rate in the real world."
- "The brief shows where each statement came from, and what we would check in the real world before
  acting."

Do not say:

- That the example shows what a real company will do, or that any figure in it is real.
- That "N of 30 runs" is a probability of the event in the real world. It measures repeatability
  under the model's own assumptions.
- That rules mode is a language model. It is deterministic code, and it is labelled that way.
- That a critic's silence means the analysis is right. Critics check what they can see.

## Likely objections and honest answers

**"Are these real people?"** No. They are synthetic actors made from stakeholder roles found in the
evidence. Their size is a modelling assumption, and every trait is labelled with where it came from.

**"Is this a forecast?"** No. It explores what a set of stated assumptions could imply, with the
assumptions and the evidence on screen. It does not guarantee or precisely predict real-world
behavior.

**"Why trust it?"** Four things, each visible on screen. Repeatability: every scenario runs many
times with controlled seeds, and a finding is shown with how often it held. Provenance: every
statement names its origin and the passage it rests on. Critics: independent challenges that stay
visible with their responses. A validation plan: what to measure in the real world to find out
whether an assumption holds. None of this makes it right. It makes it checkable.

**"The evidence is invented. What does that show?"** How Swarm treats evidence: it labels it,
quotes it, finds where sources disagree, and says what is missing. With your own evidence the same
steps apply. The invented figures should not be quoted as findings.

**"Does it know what Microsoft or AWS will do?"** No. The real names are in the questions because
the questions name them. The documents describe invented organisations and hypothetical changes.

**"The model could just make things up."** In rules mode no model is involved. With a model, outputs
are validated against a schema, and statements that cite evidence are checked against the cited
passage. A model reading is labelled as one. See the [presenter guide](../presentation.md) for the
checks and where they are weak.

**"Where does our data go?"** In rules mode, nowhere. With a model, to the deployment you
configured. A public address you type is fetched by the Swarm server, not by your browser, and
only public pages are allowed.

**"What if a document contains instructions?"** Documents are treated as untrusted data, never as
instructions, and text that addresses a model is flagged. That lowers the risk. It does not remove
it.

**"Why do the results change when I change an assumption?"** That is the point of the **Depends on**
section (the sensitivity view): it shows which assumptions the result depends on and which of them have
no evidence yet.

## If the model is unavailable

Rules mode needs no network and no model. Use it, and say so.

What has been checked, and what has not: the packs pass their tests, and `backend/test/lab-journey.test.ts`
walks every example, and a question that no example knows, from the question to the brief through the
routes the pages use, in rules mode with no model, checking that it completes and that the brief carries
its origins, recommendations and validation plan. The scenario, stakeholder, analysis, critic and brief
steps each have a rules path. The browser tests (see [TESTING.md](../../TESTING.md)) walk the three
flagship examples and a question of its own through the pages in a real browser, with fixtures for the
public pages, so rehearse the example you will show.

- Leave `AI_PROVIDER` as `none` (the default), or choose **Local rules** under **Options** when you
  create the project. The chip at the right of the top bar reads **Local rules**.
- Intake, stakeholders, actors, runs, review and the brief all have a rules path. Each says it was
  produced by rules. Expect the groups that a text names with a role word, a mechanical simulation and a
  brief assembled from data, not worded by a model.
- Rules mode classifies no statements, so Ground's **Statements** has nothing to list and says so; the
  sufficiency pill beside it (**Supports a recommendation**, **Limited: treat as tentative**, **Not
  enough yet**) appears only once there are statements to rate. Say that it is informative only with a
  model; see the [known limits of the demonstration packs](../README.md#known-limits-of-these-demos).
- The model is never replaced silently. If a model step fails you see the error and the rules
  result that was used instead, or you are asked to choose it.
- Fetching a public address needs the network. If it fails, or the page cannot be read, the notice
  says so and offers to let you paste the text (**Evidence** → **Paste**). The bundled documents are
  complete without it.

Do not hide a failure behind another mode. If something breaks, say what happened and move to the
nearest fallback; the [presenter guide](../presentation.md#if-something-fails) has the full table.

## Resetting

The examples live in the application (`shared/examples`), so choosing one always starts from the
same text. There is nothing to restore.

- A rehearsal is an ordinary project. Open **History** in the top bar, choose the trash-can button on its
  row (named **Delete** and the project's name), then **Delete permanently**, or leave it and start
  another with the Swarm mark at the top left.
- For a clean machine, start the server with an empty `DATA_DIR`.
- The audit log is append-only by design: a rehearsal stays in it, as ordinary entries with
  identifiers and counts and no document text.

## What these examples do not show

- Real-world accuracy. There is no backtest here and no ground truth to compare with.
- A model's behaviour, unless you run in model mode. Rules-mode outcomes are mechanical.
- Anything about the real companies named in two of the questions.
- Fetching and reading many kinds of page. The online-store example suggests one public sandbox
  page; the other examples have no address.

## Changing an example

The source is `shared/examples/<id>.ts`. The copies in these folders are checked against it by
`backend/test/example-packs.test.ts`; after editing a document, run that test with the update flag
(`-u`) to rewrite the copies, then format them. The same test pins which source conflicts the
ledger finds, and `frontend/src/lib/examples.test.ts` checks the rules every pack follows: sizes,
labels, provenance, no addresses or keys, no instruction-like text, no predictions or conclusions,
no stakeholder list.
