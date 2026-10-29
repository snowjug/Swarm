# Demo script

Ten minutes. It uses the [demonstration packs](../demo/README.md), which are fictional. Start the
app as the [README](../../README.md#quick-start) describes. Rules mode needs nothing; with a model
configured, every stage calls the model and the evidence ledger also shows classified statements.

## Before you start

- Decide whether you are showing **rules mode** (fast, deterministic, no statements in the ledger) or
  **model mode** (slower, real statements). The interface says which one it is in; say it aloud.
- Have the Larkholm sources and question ready from the
  [pack's README](../demo/larkholm-ferry/README.md).

## The walk-through

1. **Create the project** (1 min). Paste the question, attach the five Larkholm sources. Say what is
   fictional: all of it.
2. **Run the stages** (2 min). Graph, actors, simulation, report. Point at the labels that say which
   items are assumed input and which come from sources. Pause after a round, schedule an
   intervention, resume. Branch from round 3 and use **Compare with parent**.
3. **Open the Evidence ledger** on the report (2 min).
   - The conflict candidate: the council counts 412,000 crossings in 2025, the operator 365,000.
     Open it, read both quotations, choose **Confirm conflict**.
   - The assumptions behind the simulated results, and how many statements depend on each.
   - In model mode: the statements, filtered by support class. Open an unsupported one and show how
     it is labelled and why. Open **Why this class** and **How it was checked**.
4. **Ask the analyst** (2 min), in **Interaction**.
   - A question the sources answer ("What ceiling applies to the annual ferry subsidy?"): the reply
     cites a passage.
   - A question they cannot ("What was ferry ridership in 2019?"): the exact sentence _The available
     project evidence does not support a confident answer._ No model call was made.
   - In model mode: "Which statements in the report are least supported by the sources?" The
     analyst names statements from the ledger by id.
5. **Export** (30 s). Markdown or JSON; the ledger travels with the report.
6. **Show the limits on purpose** (2 min). Switch to the Eastfield pack and dismiss a false alarm
   with **Not a conflict**. Switch to the Docklands pack: the vendor says no roles would be lost and
   the union says about 300 of 1,400 are at risk, and the detector does **not** find it. Say that a
   person has to.

## What to say, and not to say

Say:

- "It explores scenarios. It does not predict."
- "A support class says how well _your_ sources back a statement. It is not a claim that the
  statement is true."
- "The conflict detector is conservative. It finds shared-figure conflicts, raises some false alarms
  and misses conflicts of meaning. The person decides."

Do not say:

- That it is production ready, or secure, or accurate.
- That sign-in works for your organisation. It has been verified against a local test provider
  only, and the browser has no sign-in screen.
- That the analyst never answers something it should not. A plausible question about something
  absent usually gets past the first check; the model's own refusal and its duty to cite are the
  second line, and they are observed only in live runs.
- Any figure from the evaluation without its limits. See [evaluation results](./evaluation-results.md).

## If something goes wrong

- The model path fails or is slow: say so, switch to rules mode, and carry on. The interface
  labels the mode, and the failure message names the cause without showing prompts or keys.
- A run is interrupted: the run is marked failed and can be retried, or resumed from the last saved
  round if it was paused.
