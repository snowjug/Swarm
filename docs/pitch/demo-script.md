# Demo script

Ten minutes. It walks one question through the six scenes of the product (Ask, Ground, Map, Simulate,
Compare, Decide) on the Larkholm pack, one of the [older demonstration
packs](../demo/README.md#the-older-source-packs), which are fictional, and keeps the evidence layer in
front: where sources disagree, what a statement rests on, and what the analyst will not answer. For the
scenario lab on its four flagship demos, with a five- and a ten-minute script for each, use the [demo
guide](../demo/README.md#the-ten-minute-script) instead. Start the app as the
[README](../../README.md#quick-start) describes. Rules mode needs nothing; with a model configured,
every step that has a model path calls the model, and the evidence ledger also shows classified
statements.

Swarm explores scenarios. It does not predict the future. Say so first and last.

This script builds a project live from the pack. For a presentation, prefer
[Presenting Swarm](../demo/presentation.md): it uses a recorded real-model run that restores in
seconds (`npm run demo:seed`), has five- and ten-minute scripts, a backup-screenshot plan and a
failure table, and says what a recording can and cannot open in the interface.

## Before you start

- Decide whether you are showing **rules mode** (fast, deterministic, no statements in the ledger) or
  **model mode** (slower, real statements). The chip at the right of the top bar says which one it is
  in (**Local rules**, or the provider and `connected`); say it aloud. Under **Options**, beside
  **Evidence** on the first screen, **Local rules** is the default.
- Have the Larkholm sources and question ready from the
  [pack's README](../demo/larkholm-ferry/README.md).
- Start from a fresh data directory (`DATA_DIR`), so that nothing else is in **History** or under
  **Continue**. Leave the detail on **Guided**, the default, under **Settings and tools**.

## The walk-through

| Time          | Scene                  | Click                                                                                                                           | Point at                                                                                                                                                                                                                               |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 to 0:45  | Ask                    | Paste the question; **Evidence** → **Files**, attach the five Larkholm sources; **Explore**, then **Ground it**                 | What is fictional: all of it. The sources' labels, and in **Your scenario** who made each assumption                                                                                                                                   |
| 0:45 to 2:15  | Ground                 | **Conflicts**: open the conflict, read both quotations, choose **Confirm**                                                      | The council counts 412,000 crossings in 2025, the operator 365,000: "Neither side is declared true". The source graph and what each topic cites. With a model, **Statements** and the **Assumptions** list (below)                     |
| 2:15 to 3:30  | Map                    | **Map the stakeholders**, **Find who is affected**, open one party; **Create actors**                                           | The stakeholder ecosystem: groups, relations, the quote each party stands on, where nobody was found. Actors are synthetic stand-ins, and each trait says where it came from                                                           |
| 3:30 to 5:00  | Simulate               | **Run the simulation**; in **Live**, play the replay; then **Network**, **Timeline** and **Story** in the **View** control      | The replay scrubber: the flag where the change lands, the dots where something was set off, the round card. **Story**: "How far to rely on this"                                                                                       |
| 5:00 to 6:00  | Compare                | **Compare**                                                                                                                     | The gap chart (a tick for each seeded run, the middle 80%, the mean, the gap); "It held in k of n seeded runs" and its class; **Depends on**; **How far to rely on this**                                                              |
| 6:00 to 7:15  | Decide                 | **Decide**, **Write the brief**; **Review**, **Run the independent review**; **Export**; optionally **Edit report** (below)     | The verdict and what happened, the origin mark on a statement, **Validation plan**, one objection and its basis. The brief's **Export** menu: Markdown or JSON; the data behind the charts travels with it                             |
| 7:15 to 8:15  | Ask the analyst        | On the recorded demonstration (**Continue** → **Recorded demonstration**): **Ask about this**, **Analyst**                      | A question the sources answer ("What ceiling applies to the annual ferry subsidy?"): the reply cites a passage. One they cannot ("What was ferry ridership in 2019?"): the exact sentence below. No model call was made                |
| 8:15 to 9:45  | The limits, on purpose | A new question (the Swarm mark, top left) with the Eastfield files: **Conflicts**, **Not a conflict**. Then the Docklands files | The false alarm, dismissed by a person. Docklands: the vendor says no roles would be lost and the union says about 300 of 1,400 are at risk, and **Conflicts** says "No conflicts found between the sources". Say that a person has to |
| 9:45 to 10:00 | Close                  | Nothing                                                                                                                         | "Swarm explores scenarios. It does not predict the future. It supports a person's analysis. It does not make the decision."                                                                                                            |

Notes on the table:

- **Map, when the list is held back.** The proposed participants are checked before they can be used. If the
  button reads "Fix N things first" instead of **Create actors**, open **Review**: each blocking check says what is
  wrong and how to mend it, and the list can be used once none stands. The demo guide's
  [Map step](../demo/README.md) says what to point at there.
- **Ground, with a model.** The statements of a report appear under **Statements** once a detailed report
  has been written (**Simulate** → **More** → **Deep dive**, **Prepare the environment**, **Start the
  simulation**, **Write the detailed report**). Filter by support class, and open an unsupported statement
  to show how it is labelled and why: **How it was checked** and **Why this class**. **Assumptions** lists
  the assumptions behind the simulated results, and how many statements rest on each. Rules mode lists no
  statements and says so.
- **Ask the analyst** needs a detailed report to speak from, so it is shown on the recorded
  demonstration, which has one. In the **Ask about this** sheet, the **Analyst** tab answers from the
  report; with a model, ask "Which statements in the report are least supported by the sources?" and the
  analyst names statements from the ledger by id. The **Actors** tab puts a question to one fictional
  actor.
- **The unanswerable question** gets exactly this sentence, and no model is called: _The available project
  evidence does not support a confident answer._
- **The report studio** (optional, about ninety seconds) works on a finished detailed report, so it
  follows the steps under **Ground, with a model** (rules mode writes a report too, with no statements to
  check). Then **Decide** → **Edit report** → **Open in the studio** opens a working copy. Change a
  sentence in a chapter and **Save as version N**; in **History**, **Compare** the version with the one
  before; then **Submit for review**. Point at the line that says every change is kept as a version and
  the generated report is never changed, and at **Statements** after the edit: "These statements describe
  an earlier text", because the words were changed after they were checked. Without a detailed report the
  studio says so and offers **Write the detailed report** itself (or, where the deep dive has not been run,
  **Go to the deep dive**).

## What to say, and not to say

Say:

- "It explores scenarios. It does not predict."
- "A support class says how well _your_ sources back a statement. It is not a claim that the
  statement is true."
- "The conflict detector is conservative. It finds shared-figure conflicts, raises some false alarms
  and misses conflicts of meaning. The person decides."
- "The replay is one typical run. The comparison is many runs on the same seeds, and what holds across
  them is repeatability under assumptions, not the chance of anything in the world."

Do not say:

- That it is production ready, or secure, or accurate.
- That sign-in works for your organisation. It has been verified against a local test provider
  only; no real tenant has been used.
- That the analyst never answers something it should not. A plausible question about something
  absent usually gets past the first check; the model's own refusal and its duty to cite are the
  second line, and they are observed only in live runs.
- Any figure from the evaluation without its limits. See [evaluation results](./evaluation-results.md).

## If something goes wrong

- **The network is down.** Nothing in this walk needs it: rules mode needs no network and no model, and
  the pack's sources are local files. Only fetching a public page does (**Evidence** → **Web page**), and
  it says why it failed and offers to let you paste the text instead. See the demo guide's
  [fallback](../demo/README.md#if-the-network-is-down).
- **The model path fails or is slow.** Say so, choose **Local rules** under **Options**, and carry on.
  The chip at the top right says which mode is in use, and the failure message names the cause without
  showing prompts or keys.
- **A run is interrupted.** A scenario comparison says it was interrupted and offers **Run it again with
  the same settings**; it can be reproduced exactly from its seeds. A deep dive that stops is marked
  failed and can be retried (**Retry the simulation**), or resumed from the last saved round if it was
  paused.
- **Resetting.** A rehearsal is an ordinary project: open **History**, choose the trash-can button on its
  row, then **Delete permanently**, or leave it and start another. For a clean machine, start the server
  with an empty `DATA_DIR`. The recorded demonstration is restored with `npm run demo:seed`. The audit
  log is append-only, so a rehearsal stays in it as ordinary entries.
