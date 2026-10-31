# Demo guide

This is the guide for showing Swarm to an audience, such as a hackathon jury: a ten-minute script for
the four flagship demos, what to point at, what to do when the network is down, and how to reset.

Swarm explores possible scenarios. It does not predict the future. Say so first and last.

The four flagship demos are not four features. They are **four inputs to one generic pipeline**: a
question and some evidence. Nothing in the engine, the stakeholder step or the brief knows about Teams,
AWS or an online shop, and a test fails if it learns. What the audience sees is what Swarm does with
evidence, not what an author wrote down.

| Demo                                                                          | Input                                                                                          | Why it is in the set                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. [Copilot in Teams](./scenarios/copilot-in-teams/README.md)                 | A question about a default-on assistant, and 5 synthetic documents                             | The full walk, with two source conflicts and gaps the brief should show as uncertainty  |
| 2. [Regional cloud price change](./scenarios/regional-price-change/README.md) | A question about a $1 price rise in one region, and 5 synthetic documents                      | The same pipeline on an unrelated subject, with a notice that leaves its own unit open  |
| 3. [Online store](./scenarios/ecommerce-experience/README.md)                 | A question about delivery fees and checkout, 4 synthetic documents and an optional public page | Customer behaviour, and retrieved public evidence labelled apart from invented evidence |
| 4. Your own question and a public URL                                         | Whatever the audience asks, and a public page you or they choose                               | Proof that nothing was prepared: the thin evidence shows up as thin output              |

Everything in demos 1 to 3 is **synthetic**. Microsoft, Copilot, Teams and AWS are in the questions only
because the questions name them. Each document says so in its first lines, and its provenance is
`sample` with the licence `Synthetic, CC0`, so the label travels with the evidence into the brief.

## Before you present

Allow ten minutes.

1. **Start the server** with a fresh data directory, so that rehearsals do not mix with anything real:
   `npm run build`, then `DATA_DIR=./data/demo npm start` (on Windows PowerShell set `$env:DATA_DIR`
   first). Open <http://127.0.0.1:3001>.
2. **Say which mode you are in.** With no provider configured the header chip reads
   `LOCAL / RULES MODE`: nothing leaves the machine and every step is deterministic. With a provider, the
   chip names it and reads `connected` only after a real request has succeeded (**Verify connection**
   makes one). Rules mode is the one this script is written for: leave **Local rules** selected under **Run
   settings**, so that **Understand my question** is read by rules on this server and the question goes
   nowhere else. With **Model assisted** the question is sent to the provider.
3. **Rehearse each demo once end to end.** In rules mode every step takes seconds. The script contains
   no result, because results depend on the run: read the real screen and quote that.
4. **Decide about the network.** Only fetching a public page needs it, and the Swarm server does the
   fetching, not your browser. Test the address you plan to use. If it fails, use the
   [fallback](#if-the-network-is-down).
5. **Use a window of at least 1280 pixels, Guided mode (the default), zoom 100%.** Close other tabs and
   turn off notifications. Keep the laptop awake and on power.
6. **Prepare demos 2 and 3 ahead of time** (see the script's second half): run them once so that their
   projects are in **History**, ready to open.

## The ten-minute script

Demo 1 is the full walk. Demos 2 to 4 show what changes when the input changes, and the pipeline does
not. The labels are the ones in the interface (**Use this example**, **Understand my question**, **Use
this scenario**, **Build Graph**, **Find stakeholders by reading the text**, **Approve stakeholders
and create actors**, **Compare scenarios**, **Generate decision brief**, **Run independent review**).

| Time          | Where                                 | Click                                                                                                                                                                     | Point at                                                                                                                                                                                    |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 to 0:45  | First screen                          | Nothing                                                                                                                                                                   | The one-line question, the sentence about not predicting, the eight-step path                                                                                                               |
| 0:45 to 1:45  | Demo 1: the question and the evidence | **Use this example** on **Copilot in Teams**, then **Understand my question**, **Use this scenario**                                                                      | The five documents and their provenance (**provenance**); the scenario form: baseline, alternatives, who made each assumption (**assumptions**)                                             |
| 1:45 to 3:15  | Demo 1: stakeholders and actors       | **Build Graph**, then **Env Setup**, **Find stakeholders by reading the text**, open one row, then **Approve stakeholders and create actors** and **Review the N actors** | The four counts and the note on how they were found; a row opened to its cited quotes; the uncertainty; the kinds nobody was found for (**uncertainty**); each trait's origin badge         |
| 3:15 to 4:45  | Demo 1: the comparison                | **Simulation**, **Compare scenarios**                                                                                                                                     | Baseline against change; what held across the seeded runs, with its interval and class; the assumptions the result moves with; one chain of second-order effects (**second-order effects**) |
| 4:45 to 6:15  | Demo 1: the brief and the review      | **See the decision brief** (the Report stage unlocks by itself), **Generate decision brief**, then **Run independent review**                                             | The executive answer and its caveat; the origin chip on each statement; the validation plan (**validation plan**); one objection and its basis (**the independent critic**)                 |
| 6:15 to 7:15  | Demo 2: a different subject           | **History**, open the prepared project; or **Use this example** on **Regional cloud price change** and **Understand my question**                                         | The open points the question leaves ($1 with no unit, date or scope); the different stakeholders; "nothing in the engine knows AWS"                                                         |
| 7:15 to 8:45  | Demo 3: a public page                 | **Use this example** on **Online store: delivery and checkout**; in **Add a public web page**, **Fetch page**, **Add as evidence**                                        | The title, site, size and retrieval time; the document's own label as a retrieved page; then type a private address and read the refusal                                                    |
| 8:45 to 9:30  | Demo 4: the audience's question       | Type it; add a public page; **Understand my question**; in the stakeholder review keep or add at least two stakeholders before approving                                  | What the reading made of it; how thin evidence shows as gaps and a warning, not as confident output                                                                                         |
| 9:30 to 10:00 | Close                                 | **Markdown**, **JSON** or **Printable** on the brief                                                                                                                      | The limitations section; "It supports a person's analysis. It does not make the decision."                                                                                                  |

### What to say, segment by segment

**0:00, the first screen.** "Swarm answers one question: what could happen if something changes. It
explores scenarios. It does not predict the future, and every number you will see is a count of
simulated members or of seeded runs, never a real-world rate."

**0:45, the question and the evidence.** "These five documents are invented, and each says so. Every
document keeps where it came from. The scenario form is Swarm's reading of my question, made explicit
so that I can correct it before anything runs. Each assumption says whether I wrote it or the system
did." Point at what the question leaves open (for this one: for whom 'by default' applies, how deep,
over what period) and check that the form asks, rather than filling it in.

**1:45, stakeholders and actors.** "These are roles found in the evidence, with the passage shown. They
are not people. Rules mode reads for role words, so it finds the groups a text names that way, and
this note says how many of them it could read a direction of impact for. Where it could not, the change
cannot move that group, and I would set it here, with my reasons." Open one row to show its quotes, word
for word, with the passage they come from, and what is assumed. "Every number an actor runs on says
where it came from, and I can change it." Approve, open the actors, and move one trait's slider: its
badge becomes yours at once, and **Save changes to the actors** keeps it.

**3:15, the comparison.** "A single run is never the answer. The baseline and each alternative run many
times on the same seeds. 'Holds in k of n runs' measures how repeatable this simulation is under its own
assumptions. It is not the probability of the event." Point at a finding with a weak class and say that
it is not to be relied on. Point at the assumptions with no evidence behind them: "this is what we would
test first". Read the chain of second-order effects if the run has one, and say that competitor,
partner and regulator reactions come from generic rules, not from a script written for this example.
Read the line that says how far to rely on the result.

**4:45, the brief and the review.** "Every statement carries one of ten origins and the ids it rests
on: supplied evidence, retrieved public evidence, a user or system assumption, an inferred stakeholder,
actor behaviour, a simulation aggregation, a model's interpretation, a historical comparison or
unresolved uncertainty. Nothing is unsourced." Point at where two sources disagree, if the brief lists
one: "Swarm shows both and picks neither." Show the validation plan: "this is what we would check in the
real world before acting". Then run the review: "seven critics challenge the analysis and never edit
it". Read one objection with its basis, then respond, accept or dispute it: "the disagreement stays
visible".

**6:15, a different subject.** "Same engine, different question. The notice here gives a dollar figure
with no billing unit, date or scope, and the intake step should raise that. Nothing in the engine knows
about AWS."

**7:15, a public page.** "The Swarm server fetched this page, not my browser, and it records what the
page said and when. It does not check that it is true. It is a practice site whose prices are random,
so it tells us what a catalogue page looks like, not what any shop's customers do." Then type
`http://127.0.0.1/` or `http://169.254.169.254/` into **Web address** and choose **Fetch page**: "private,
local and cloud-metadata addresses are refused however they are written, and so is a name that resolves
to one". Read the message, which ends "You can paste the text instead."

**8:45, the audience's question.** Type what they ask. "No one prepared this. Whatever the evidence
supports is what appears, and where it is thin, the gaps and the warnings say so." A page may name
fewer than two stakeholders. **Approve stakeholders and create actors** stays disabled until there
are two, so add the missing group yourself and label it as your assumption. If the comparison warns
that the change cannot move anyone, say what that means: no group has a direction of impact yet.

**9:30, the close.** "Invented evidence, a repeatable method, assumptions on the table, independent
challenge, and a plan to check it in the real world. Swarm supports a person's analysis. A person
decides."

### The six things to point at

| Point at                   | Where                                                                                                                                      | Say                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Provenance**             | The document list, the stakeholder quotes, the origin chip on a brief statement and its **What this rests on**, **Sources and provenance** | "Every statement names where it came from, and invented evidence says so."                                |
| **Assumptions**            | The scenario form, the actor traits, the brief's assumptions                                                                               | "Every number an actor runs on is an assumption with an origin, and it is mine to edit."                  |
| **Uncertainty**            | The interval and class on each finding, the sensitivity list, the stakeholders' uncertainty chips, **Uncertainty and sensitivity**         | "'Holds in k of n runs' is repeatability under assumptions. This finding is unstable: do not rely on it." |
| **Second-order effects**   | The chain read from one typical run, **Second-order and competitor effects**                                                               | "Competitors, partners and regulators react by generic rules after a lag, not by a script."               |
| **The independent critic** | **Independent review**                                                                                                                     | "A critic challenges. It never edits the analysis, and its silence would not mean the analysis is right." |
| **The validation plan**    | **Validation plan**, the recommendations' own checks                                                                                       | "Swarm ends by saying what to measure in the real world, because a simulation cannot settle it."          |

### Do not say

- That an example shows what Microsoft, AWS or any real company will do, or that any figure in it is real.
- That "k of n runs" is a probability, or that a count of simulated members is a rate in a population.
- That the actors are people, or that their traits were measured.
- That rules mode is a language model. It is deterministic code, and it is labelled as such.
- That a critic's silence means the analysis is right, that a "supported" label means a statement is
  true, or that Swarm is production ready or secure. It is not claimed, and it has not been reviewed.

Do not state what a run will show. If a pack was built to show a gap, such as an unknown licence term,
check on your run that the brief shows it, and say so if it does not.

## If the network is down

Rules mode needs no network and no model. Only reading a public page does, and the demo is complete
without it: demos 1 and 2 need none, demo 3 has four bundled documents, and demo 4 can use notes that
you paste instead of a page.

- **Fetching fails.** The form says why (no network, the site did not answer, the site asks not to be
  fetched, a private address) and ends with "You can paste the text instead." Say what happened and
  move on. Do not hide a failure behind another mode.
- **Paste instead of fetching.** Open **Or paste a source document** in the **Evidence** section, give
  it a filename ending in `.txt` or `.md`, paste at least 80 characters of the page's text and choose
  **Attach pasted source**. Or save the page's text beforehand as a `.txt` or `.md` file and attach it
  with **Choose files**. Say that it is **pasted** evidence: it is labelled supplied evidence in the
  brief, not retrieved public evidence, because the server did not fetch it.
- **The refusal still works offline.** Typing `http://127.0.0.1/` into **Web address** is refused
  before the server looks anything up ("This address is not one that Swarm reads. Swarm reads only
  public web pages ..."), so the safety point can be shown with no network.
- **A model is unavailable.** Rules mode needs none. If you configured one and it fails, the error is
  shown with the rules result that was used instead, or you are asked to choose it. In the lab, a step
  that asks a model (reading the question, finding stakeholders, the review) is given 170 seconds; then
  the rules carry on and a note says so. The model is never replaced silently.

## Resetting

What is true, and nothing else:

- **The lab examples have nothing to restore.** They are part of the application (`shared/examples`),
  so choosing one always fills the same question and the same documents.
- **A rehearsal is an ordinary project.** Open **History**, choose the trash-can button on its card
  (named **Delete** and the project's name), then **Delete permanently**; or leave it and start another.
  A project that is queued or running cannot be deleted until it stops.
- **A clean machine:** stop the server, then start it with an empty `DATA_DIR`. Stop the server before
  copying or deleting a data directory.
- **The audit log is append-only by design.** A rehearsal stays in it as ordinary entries with
  identifiers and counts and no document text.
- **The recorded Larkholm demonstration** (below) is reset with `npm run demo:seed`.

## The recorded Larkholm demonstration

A second asset, older than the lab and built on the engine's five stages. Three projects about one
fictional decision, the Larkholm electric ferry, were run once against a real Azure OpenAI model
(Microsoft Entra sign-in, no keys) and stored in [seed/](./seed). They are the base run, a branch where an
assumed council guarantee replaces the operator notice, and a branch where the notice is withdrawn.
Restoring them takes seconds and makes no model call. The seed is the unedited export of those runs:
the sources, the assumed inputs that were given to them, and the recorded model output. The
[presenter guide](./presentation.md) says where the recording is weak, and has its own five- and
ten-minute scripts, objections and failure table.

```bash
npm run demo:seed                # restore, or reset after a rehearsal
npm run demo:seed -- --dry-run   # check the files and say what would change; write nothing
npm run demo:seed -- --remove    # delete the three demonstration projects
```

The seed touches only those three projects, which have fixed identifiers. Everything else in the
database is left as it is, and anything added to them during a rehearsal (a branch, a question, an
edit) is replaced. It writes to the SQLite file under `DATA_DIR`, and so not to a PostgreSQL database
named by `DATABASE_URL`. A server that signs people in (`AUTH_MODE=entra`) has no local workspace, so there
the target must be named: `--tenant <id> --owner <id>`. The **Demonstration workspace** below the form on
the first screen offers a project only when it is really in the workspace, and says how to restore it
otherwise.

| Command                | What it does                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run demo:seed`    | Restores the recorded workspace. No model calls.                                                                                                                                                                            |
| `npm run demo:journey` | Walks the 32-step presentation in a real browser against a running server (default `http://127.0.0.1:3001`) that uses a real model: a rehearsal that checks. It refuses a rules-mode server unless `JOURNEY_ALLOW_LOCAL=1`. |
| `npm run demo:record`  | Re-records the three projects against a server that uses a real model. Spends about US$0.30 of model usage, so it is run on purpose only.                                                                                   |

## Example scenarios

[Example scenarios](./scenarios/README.md) holds the five worked examples that the picker offers (the
four flagship demos use three of them and your own question): each is a question and a few synthetic
documents with a five-minute and a ten-minute script, a readable copy of its documents, and what it
was built to contain. They carry no answer and no result.

## The older source packs

Six small, fictional scenarios for the engine's evidence layer. Each is a handful of short source
documents that you can paste into a new project. Everything in them is invented: no real place,
organisation, person or figure.

They are not a benchmark. They exist so that a reviewer can watch each behaviour of the evidence
layer on material small enough to read in two minutes. Each pack is also checked by
`backend/test/demos.test.ts` against the expectations in [demos.json](./demos.json), so a pack that
stops demonstrating its point fails a test instead of quietly going stale.

| Pack                                                           | Sources | What it demonstrates                                                                        |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| [Larkholm electric ferry](./larkholm-ferry/README.md)          | 5       | The full walk-through: one figure conflict, one preference conflict, assumptions, branching |
| [Hartwell clinic booking](./hartwell-clinic-booking)           | 3       | Two figure conflicts between a clinic's report and an audit note                            |
| [Eastfield campus parking](./eastfield-campus-parking)         | 3       | Real conflicts **and two false alarms** that a person must dismiss                          |
| [Northgate bus redesign](./northgate-bus-redesign)             | 3       | Two conflicts between an authority and an operator over the same plan                       |
| [Docklands warehouse robotics](./docklands-warehouse-robotics) | 3       | A real conflict that the detector **does not find** (stated in different words)             |
| [Library hours: thin evidence](./library-hours-thin-evidence)  | 1       | Too little evidence: the analyst declines questions the single note cannot answer           |

### How to run one

1. Start Swarm and open the console (see the [README](../../README.md#quick-start)).
2. Create a project, attach the files in the pack's folder, and paste the pack's question from
   [demos.json](./demos.json).
3. Run it. Local rules mode needs nothing; in **Model assisted** mode every engine stage calls the model.
4. Run the engine's stages (**Prepare environment**, **Start Simulation**, **Generate Report**). In the
   report stage's detailed report, open **Evidence ledger**: look at the statements, the conflicts
   between sources and the assumptions behind the simulated results.
5. In **Interaction**, ask the report one question from the pack's `answerable` list and one from
   its `unanswerable` list.

### What to expect in each

| Pack      | Conflicts the detector reports | Notes                                                                                                                                                                                |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Larkholm  | 1                              | The operator and the council give different annual crossings. The preference conflict ("overwhelmingly prefer" against "71% oppose") is not found; see K3 in `evaluation/README.md`. |
| Hartwell  | 2                              | Both are real.                                                                                                                                                                       |
| Eastfield | 4                              | **Two are real** (permit price, parking occupancy). **Two are not**: the students' survey and the staff survey differ because they ask different people. Dismiss them.               |
| Northgate | 2                              | Both are real.                                                                                                                                                                       |
| Docklands | 0                              | The vendor says "no roles would be lost"; the Union says "about 300 of the 1,400 roles ... are at risk". That is a real conflict. It is missed, and a person must see it.            |
| Library   | 0                              | One source. The analyst declines what the note does not cover. How the sufficiency banner reads for it in model mode has not been observed in a live run.                            |

The two false alarms in Eastfield and the miss in Docklands are **kept on purpose**. The detector
is deliberately conservative, and it is the person, not the detector, who decides that two figures
conflict. A demo that only showed it succeeding would overstate it.

### What the analyst does with a question

The chat analyst first checks, without calling a model, whether the project's own material can
answer. If it cannot, it declines in exactly these words and makes no model call:

> The available project evidence does not support a confident answer.

If it can, the model's answer must cite a source passage, a recorded memory or a statement in the
grounding review, or say that it cannot. Each pack lists two questions its sources answer, and two
they do not.

## Known limits of these demos

- **The first check is lexical.** It catches a question with nothing in common with the project
  ("Who won the football match last night?") and a year the sources never mention. It does not catch
  a question that mixes an unrelated topic with a word the project uses. For example, "What is the
  weather forecast for next Tuesday?" is let through, because "forecast" appears in the project's own
  report. Only the model's own refusal and its duty to cite can catch that, and that is measured
  in live runs, not in these tests.
- **A plausible question about something absent also passes the first check.** "Which councillors
  voted against?" shares its words with the sources. See `evaluation/README.md` for the measured
  rates (1 of 4).
- **The packs are tiny.** Detecting a conflict in a three-page pack says little about detecting
  one in a three-hundred-page report.
- **The checks run in rules mode.** `backend/test/demos.test.ts` exercises the deterministic path.
  Rules mode produces no grounding review, so the ledger holds no statements and its sufficiency
  banner reads "insufficient" for every pack; that banner is informative only with a model, where
  the report's statements are classified. With a real model the same sources can produce different
  statements and different support classes; the live Azure run on the Larkholm pack is the only
  model evidence.
- **The lab's examples are tested through the pages, but on fixtures.** `e2e/lab/examples.spec.ts` takes
  the three flagship examples and a question that no example knows from the first screen to the
  exported brief in a real browser, and `backend/test/lab-journey.test.ts` does the same through the
  routes. Both run the rules engine with no model, and the public pages in them are served from this
  machine, so they say nothing about a real page or a real model. Rehearse the demo you will show
  before you rely on a script.
