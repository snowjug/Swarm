# Example scenarios

Five worked examples that a person can pick and run through the real pipeline: question, evidence,
stakeholder discovery, synthetic actors, repeated runs, independent review and a decision brief.

Each example is only **a question and a few documents**. It carries no answer, no list of
stakeholders, no result and no conclusion. Everything after the evidence is made by the same code
that handles any question typed into the entry form, so what the audience sees is what Swarm does
with evidence, not what an author wrote down.

Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.

## Everything here is synthetic

Every document is an invented, illustrative note. Its first lines say so ("Illustrative synthetic
brief; figures invented for demonstration; not information from or about any real company", with
"summary" or "note" where that fits), and its provenance is `sample` with the licence
`Synthetic, CC0`, so the label travels with the evidence into the stakeholder list, the analysis and
the brief.

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

A custom scenario needs no content here: the entry form is that path. Type any "What could happen
if...?" question and add your own documents or a public address.

Each folder holds the example's scripts and a readable copy of every document. The copies are the
same text the picker loads from [`shared/examples`](../../../shared/examples), and a test fails if
they drift apart.

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

- **Five minutes:** choose the example (30 s); the question (40 s); the evidence (30 s);
  stakeholders and actors (60 s); compare scenarios (60 s); the decision brief (50 s); one objection
  from the independent review (20 s); close (10 s).
- **Ten minutes:** open (1 min); the question and the scenario (1.5 min); the evidence (1 min);
  stakeholders and actors (1.5 min); compare scenarios (1.5 min); sensitivity (1 min); review and
  brief (1.5 min); exports and a question to the analyst (1 min). The online-store script adds a
  step for the public page.

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
  gap as uncertainty, and the stakeholder step may show roles nobody was found for.

If a result, a stakeholder list or a recommendation ever appears in a pack, that is a defect in the
pack: tests check for the obvious forms of it.

## Before you present

1. Start Swarm as the [README](../../../README.md#quick-start) describes (`npm.cmd run build`, then
   `npm.cmd start`, and open <http://127.0.0.1:3001>), ideally with a fresh `DATA_DIR` so that
   rehearsal projects do not mix with real ones.
2. Read the header chip. With no model configured it says `LOCAL / RULES MODE`. With a model it
   says `REAL AZURE AI` and `connected` after **Verify connection**. Say which one you are in.
3. Choose **Try an example** on the entry page. It fills the question and the documents, with their
   provenance, and focuses the first action. Choosing an example only fills the form.
4. Rehearse the example you will show once end to end. A run in rules mode takes seconds; a model
   run takes minutes.

The scripts below name buttons and stages as the interface specification gives them (**Try an
example**, **Understand my question**, **Use this scenario**, **Find stakeholders**, **Approve
stakeholders and create actors**, **Compare scenarios**, **Run independent review**, **Generate
decision brief**). If a label has moved in the build you are showing, the step is the same. A journey
test that runs every example through the real interface (`e2e/lab/examples.spec.ts`) is a planned
follow-up and does not exist yet, so rehearse the example you will show before you rely on a script.

## Screens and what to point at

The order is the order of the product. Each row is something to show, in the words you can use.

| Step                  | Point at                                                                                                                 | What it proves                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Question and evidence | The question, then the document list: each document is labelled as a sample with the licence `Synthetic, CC0`.           | Evidence has a provenance, and invented evidence says so.                                                          |
| Scenario understood   | The structured form read from the question: decision, changes, baseline, alternatives, assumptions, ambiguities.         | The question is made explicit and editable before anything runs. Assumptions say who made them: you or the system. |
| Evidence ledger       | **Conflicts between sources**: two quotes side by side, marked **Different figures**.                                    | Swarm does not choose a side. A person confirms the conflict or dismisses it.                                      |
| Stakeholders          | The list grouped by kind, each with a cited quote and an uncertainty level; the prompt about roles nobody was found for. | Stakeholders are discovered from the evidence, with the passage shown, not asserted.                               |
| Actors                | The trait table: each trait carries a badge for where it came from (evidence, assumption, you).                          | Synthetic actors are not people. Every number they run on is an assumption you can edit.                           |
| Compare scenarios     | The spread across seeded runs for the baseline and each alternative; "holds in N of 30 seeded runs" with its interval.   | One run is never the answer. Repeatability is measured, not asserted.                                              |
| Sensitivity           | The assumptions the result moves with, and which of them have no evidence behind them.                                   | The result's weak points are on the screen.                                                                        |
| Second-order effects  | The chain read from the representative run ("because ... then ...").                                                     | Competitor, partner and regulator reactions come from generic rules, not a script.                                 |
| Independent review    | One objection, its basis, and the response form (respond, accept, dispute).                                              | Challenge stays visible. A critic never edits the analysis.                                                        |
| Decision brief        | The executive answer with origin chips, then **Assumptions**, **Uncertainty**, **Validation plan**, **Limitations**.     | Every statement names where it came from, and the brief says what to check in the real world.                      |

In rules mode the interface says so at each step (for example, that stakeholders were found by
reading the text for roles, and that outcomes are a mechanical consequence of declared
assumptions). Point at that wording. It is the honest description of what rules mode is.

## Speaking points

Say:

- "Swarm explores scenarios. It does not predict the future."
- "Everything in this example is invented, and every document says so. The point is the method."
- "The people on screen are synthetic actors. They are not real people, and their numbers are
  assumptions you can change."
- "Two sources disagree and Swarm did not pick one. A person decides."
- "A result here is a count of simulated runs, not a rate in the real world."
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

**"Why do the results change when I change an assumption?"** That is the point of the sensitivity
view: it shows which assumptions the result depends on and which of them have no evidence yet.

## If the model is unavailable

Rules mode needs no network and no model. Use it, and say so.

What has been checked, and what has not: the packs pass their tests, and each was run through the
evidence pipeline that exists today in rules mode, where it completes and the ledger reports the
conflicts listed above. The scenario, stakeholder, analysis, critic and brief steps each have a rules
path by specification, but the scripts have not yet been rehearsed against the merged interface.

- Leave `AI_PROVIDER` as `none` (the default), or choose local rules when you create the project.
  The header chip reads `LOCAL / RULES MODE`.
- Intake, stakeholders, actors, runs, review and the brief all have a rules path. Each says it was
  produced by rules. Expect fewer and plainer stakeholders, a mechanical simulation and a brief
  assembled from data, not worded by a model.
- The model is never replaced silently. If a model step fails you see the error and the rules
  result that was used instead, or you are asked to choose it.
- Fetching a public address needs the network. If it fails, or the page cannot be read, the form
  says so and offers to let you paste the text. The bundled documents are complete without it.

Do not hide a failure behind another mode. If something breaks, say what happened and move to the
nearest fallback; the [presenter guide](../presentation.md#if-something-fails) has the full table.

## Resetting

The examples live in the application (`shared/examples`), so choosing one always starts from the
same text. There is nothing to restore.

- A rehearsal is an ordinary project. Open the history drawer and choose **Delete permanently**, or
  leave it and start another.
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
