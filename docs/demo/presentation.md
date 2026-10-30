# Presenting Swarm

This is the guide for showing Swarm to an audience: how to get ready, two scripts (five and ten
minutes), what to say, what to do when a question is awkward, and what to do when something breaks.

Swarm explores possible scenarios. It does not predict the future. Say so first and last.

Everything shown is **fictional**. The island, the council, the people and every figure were invented
for the demonstration ([the sources](./larkholm-ferry/README.md)).

## What you are showing

Three projects, restored by one command, recorded once with a real model (the Azure deployment, signed
in with Microsoft Entra, no key):

| Project                                      | What it is                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Larkholm electric ferry: operator notice** | The base run. Six fictional stakeholders, six rounds on two platforms, an assumed operator notice (a cut in winter sailings) before round 4. |
| **Branch: council guarantee**                | Rounds 1 to 3 copied unchanged. An assumed council guarantee (six winter sailings, a 5% fare cap) replaces the notice before round 4.        |
| **Branch: no operator notice**               | Rounds 1 to 3 copied unchanged. The notice is withdrawn.                                                                                     |

Nothing in them was written for the demonstration. What the actors decided, the reasons they gave, the
report and the answers are what the model produced on the day it was recorded, including a fictional
resident who sounds like an analyst and five report statements the sources do not support. The figures
below are from that recording. They are the same every time you reset; a new recording would differ,
because model output is not reproducible.

| Round | Base: operator notice | Branch: council guarantee | Branch: no notice |
| ----- | --------------------- | ------------------------- | ----------------- |
| 1     | 0.36                  | 0.36                      | 0.36              |
| 2     | 0.47                  | 0.47                      | 0.47              |
| 3     | 0.57                  | 0.57                      | 0.57              |
| 4     | **0.27**              | **0.78**                  | **0.61**          |
| 5     | 0.52                  | 0.89                      | 0.81              |
| 6     | 0.66                  | 0.92                      | 0.92              |

Mean inclination of the six fictional stakeholders, from −1 (opposed) to +1 (in favour). It is
scenario state, not measured opinion. The runs are identical through round 3 by construction, and the
comparison screen says that a difference after that is not a causal estimate.

## Before you present

Ten minutes before:

1. **Start the server** with the real model configured (`.env`, see [Azure](../AZURE.md)):
   `npm start`. The app is then at <http://127.0.0.1:3001>.
2. **Reset the demonstration:** `npm run demo:seed`. It restores the three projects exactly as
   recorded and replaces anything a rehearsal added. It touches nothing else.
3. **Open the provider badge** in the header and press **Verify connection**. One real request goes
   to the model; the badge should read connected. If it does not, read
   [if something fails](#if-something-fails) now, not in front of people.
4. **Rehearse once** if there is time: `npm run demo:journey` performs all 32 steps in a real
   browser against this server and takes about eight minutes on a busy laptop. It asks the analyst
   one question the sources answer and one they do not, and asks one actor a question: three model
   calls in all (with the preflight check), about 13,000 tokens in and 500 out, well under one US
   cent at list prices. Then reset again with
   `npm run demo:seed`: the rehearsal adds messages to the base project's conversation and entries to
   its audit log. (The audit log is append-only on purpose, so the rehearsal stays in it after a reset.
   It shows as ordinary entries.)
5. **Make the backup screenshots** if you have not (see [the backup plan](#backup-screenshots)).
6. **The screen:** a browser window of at least 1440 × 900, zoom 100%, full screen. Close other tabs
   and turn off notifications. Keep the laptop awake and on power.

## Screen sequence

The order the screens appear in the longer script. The right-hand column is the step of the automated
journey that checks the same screen, so that every screen you show has been exercised.

| Screen                              | What to click                                               | Journey step |
| ----------------------------------- | ----------------------------------------------------------- | ------------ |
| Home: introduction                  | Nothing: read the statement aloud                           | 1, 2, 3      |
| Home: demonstration workspace       | **Open project** on the base run                            | 4, 5         |
| Project: the decision question      | Nothing                                                     | 6            |
| Graph Build: source documents       | A document chip, for example the council note               | 7            |
| Graph Build: evidence               | **Browse evidence**                                         | 8            |
| Graph Build: scenario graph         | A node, or **Inspect node** for the keyboard route          | 11           |
| Env Setup: actors and configuration | Scroll to the six fictional proxies                         | 12, 13       |
| Simulation: replay                  | **Show trajectory data table**; the platform buttons        | 14           |
| Simulation: decisions and rounds    | The proxy and round filters                                 | 15, 16       |
| Simulation: branch at a checkpoint  | **Branch from here**; do not resume                         | 17, 18       |
| Branch: council guarantee           | Open it from the home page; **Compare with parent**         | 19, 20       |
| Report: reader                      | A chapter                                                   | 21           |
| Report: evidence ledger             | The conflict, the assumptions, a statement                  | 8, 9, 10     |
| Report: statement inspector         | A supported statement, then one with contradicting evidence | 22, 23, 24   |
| Interaction: analyst                | An answerable question, then an unsupported one             | 25 to 28     |
| Interaction: fictional actor        | One proxy                                                   | 29           |
| Export                              | **Export Markdown**, **Export JSON**                        | 30, 31       |
| Audit log                           | **Audit log**, then **Verify integrity**                    | 32           |

## The five-minute script

For a short slot. Do not resume anything and do not create a project: everything is recorded.

**0:00 Home (30 s).** "Swarm turns source documents into an evidence ledger, runs fictional
stakeholders through a scenario, and writes a report in which every statement shows what supports it,
or that nothing does. It explores possible scenarios. It does not predict the future." Point at the
workspace: "All of this is synthetic: a fictional island and a fictional ferry decision. These were
recorded with a real model."

**0:30 The project (45 s).** Open the base run. Read the decision question. "Five sources. Two of them
disagree on purpose." Open **Graph Build**, open the council note: it says 412,000 one-way crossings
in 2025.

**1:15 The evidence ledger (1 min).** Go to **Report**, scroll to the ledger. "The ledger found the
disagreement itself: the council counts 412,000, the operator's ticketing says 365,000. It does not
say which is right. A person decides." Then the banner: "The evidence is limited: treat any
recommendation as tentative." Then the assumptions: "Everything the simulation rests on is listed as
an input, and you can see which statements depend on each."

**2:15 The simulation (45 s).** **Simulation**, **Show trajectory data table**. "The mean inclination
climbs to 0.57, then drops to 0.27 at round 4, when an assumed notice cuts winter sailings. Each
fictional stakeholder gives a stated reason for each decision." Filter to one proxy and read one
reason.

**3:00 Branch and compare (45 s).** Open **Branch: council guarantee**, then **Compare with parent**.
"Same first three rounds, by construction. After that, with a guarantee instead of the notice, the mean
is 0.78 at round 4, not 0.27. That is a difference between two runs of a model, not a causal
estimate, and the screen says so."

**3:45 The analyst (45 s).** **Interaction**. Ask the answerable question. "The subsidy ceiling is $1.8
million, citing the council note." Open a citation: the stored passage. Then the unsupported one:
"What was ferry ridership in 2019?" The reply is the sentence **The available project evidence does
not support a confident answer.** "No model call was made: the project never mentions 2019."

**4:30 Close (30 s).** **Audit log**: "Who did what, with identifiers and counts, never what was said;
tamper-evident." **Verify integrity**. Export Markdown. "Swarm supports a person's analysis. It does
not make the decision."

## The ten-minute script

Everything above, slower, plus the parts that show how it works.

**0:00 to 1:00 Home and positioning.** As above. Add the responsible-use line: "It supports human
analysis. It must not make a high-impact decision on its own."

**1:00 to 2:30 Sources and the graph.** Open each source briefly: the council note, the operator memo,
the residents' survey, the stakeholder statements, the analyst's assumptions (labelled as assumptions,
not facts). Open the **scenario graph**: eleven entities and thirteen relations, each with a quote the
server checked verbatim against a passage. Use **Inspect node** to show the keyboard route.

**2:30 to 3:45 Actors and configuration.** **Env Setup**: six fictional proxies with goals that
conflict, for example the residents' association chair and the Green Tide Alliance coordinator start
at opposite ends. The configuration (rounds, minutes per round, both platforms, seed posts) is shown
and closed: "a recorded run is never rewritten." The seed posts are labelled **assumed input**.

**3:45 to 5:15 The simulation in detail.** The trajectory and its data table. Filter by the residents'
association chair: read the reason he gave in round 1 and in round 4. Filter by round 4 for everyone.
"Meaningfully different decisions: they start between −0.70 and +0.90 and end between +0.10 and
+1.00." Name the limit yourself: "Notice how readily the fictional residents come round. That is a known
tendency of language-model role play. It is not evidence about real islanders."

**5:15 to 6:30 Branching.** **Branch from here** at round 2: choose an intervention, add a proxy edit,
create. The branch opens **paused after round 2 of 6**, with **Resume** available. Open **Edit
scheduled intervention**, change it, save. "Pause, schedule, resume: that is how an intervention is
injected. We will not resume here, because with a real model that is several minutes." Then open
**Branch: council guarantee** and **Compare with parent**; mention that the no-notice branch is its
sibling.

**6:30 to 8:00 The report and its evidence.** **Report**: a chapter, then the limitations ("Boundaries
of this scenario"). In the ledger, open a **directly supported** statement: the passage that supports
it. Open the statement that has **contradicting** evidence: the passage that cuts against it. Show
**How it was checked** and **Why this class**. "A class says how well your sources back a statement.
It does not say the statement is true."

**8:00 to 9:15 The analyst and an actor, live.** Ask a new answerable question (for example, what
share of the electric ferry's cost the Clean Coasts Fund would pay, and on what condition): about half
a minute with a real model, cites the sources. Then an unsupported one (for example, the ferry
company's passenger revenue in 2018): immediate, the exact abstention sentence. Then ask one fictional
actor what would reassure them.

**9:15 to 10:00 Exports and the audit log.** Markdown and JSON: the ledger travels with the report.
The audit log: what you just did is in it, with no questions or answers. **Verify integrity**.

## Speaking points

Say:

- "It explores possible scenarios. It does not predict the future."
- "The people are fictional proxies driven by a model and by assumptions. Their trajectories describe
  the scenario, not the world."
- "A statement is a finding only if a source passage directly supports it. Everything else is labelled
  as a hypothesis, an assumption or a simulated event."
- "Two sources disagreed and Swarm did not pick one. Neither passage is declared true."
- "If the project cannot answer, the analyst says so, in those words, before any model is asked."
- "It supports a person's analysis. A person decides."

Do not say:

- That it is production ready, secure or accurate. It is neither claimed nor reviewed. See the
  [production-readiness gates](../production-readiness.md) for what is and is not met.
- That a "supported" label means the statement is true, or that the figures are calibrated.
- That the analyst never answers something it should not. A plausible question about something the
  project mentions only in passing can get an answer; the model's duty to cite is the second check and
  it is observed, not proved.
- That prompt injection is solved. It is an active risk: documents are treated as untrusted data and
  warned about, and that reduces the risk without removing it.
- That the same run would repeat. The demonstration is a recording; a new run would differ.

## Likely objections and answers

**"Is this a forecast?"** No. It is a structured way to explore what a set of assumptions could imply,
with the assumptions and the evidence on the screen. The first screen says so and so does the
comparison.

**"Why should we believe fictional people generated by a model?"** You should not, as evidence about
people. They make assumptions explicit and testable: change one and see what moves, in a run you can
inspect round by round with the reasons given. They tend to converge on agreement, which is a known
weakness, and the limitations list says it.

**"The model could just make things up."** It can, and it is checked: every report statement is
compared with the cited passages by deterministic checks and an independent model check that can only
lower a grade. Five of this report's 28 statements are classed unsupported and are shown as such.

**"What if the documents contain instructions to the model?"** That is prompt injection, and it is an
active risk. Documents go to the model as data, never as instructions, hostile wording is flagged, and
a test plants an instruction in a document. This reduces the risk. It does not remove it.

**"Where does our data go?"** In rules mode, nowhere. In model mode, to the Azure OpenAI deployment you
configure, signed in with Microsoft Entra, with no key stored. Nothing is sent to anyone else.

**"Is it secure? Is it production ready?"** No claim. The API verifies Entra tokens, enforces roles
and separates tenants, tested against a local test identity provider. The browser has no sign-in
screen, so a hosted deployment is not ready. The [FAQ](../pitch/faq.md) and the readiness gates are
specific.

**"Can I get the same answer again?"** Not from the model. The recorded demonstration is fixed; a
re-recording would differ. The deterministic parts (the checks, the ledger, the comparison) are
repeatable.

**"What does it cost to run?"** The whole recording (three runs, 199 model calls) used about 534,000
tokens in and 62,000 out, roughly thirty cents at list prices (assumed US$0.40 per million input
tokens and US$1.60 per million output). The base run was about fourteen cents and each branch about
eight. A rehearsal journey makes three model calls and costs well under one cent, and an unsupported
question makes none.

**"Why did the residents' mood recover so fast?"** Because the model made them. It is the kind of
result that should make you more careful about reading a trajectory as a finding.

## Backup screenshots

If the browser, the laptop or the network fails completely, you can still present from images.

The journey saves one screenshot per key step when you give it a folder:

```powershell
$env:JOURNEY_SCREENSHOTS = 'docs/demo/backup'
npm run demo:journey
```

That folder is ignored by Git: the images belong on the presenting laptop, not in the repository. Make
them after the last change to the interface and after the last reset, and again whenever either
changes. Open the folder before you start and keep a copy on a USB drive or in a second location.

| File                      | Screen                                          | Use it for                        |
| ------------------------- | ----------------------------------------------- | --------------------------------- |
| `01-home.png`             | Introduction and the exact statement            | Opening                           |
| `02-workspace.png`        | The demonstration workspace                     | "Everything here is fictional"    |
| `03-source-document.png`  | The council note                                | Sources                           |
| `04-ledger.png`           | The evidence ledger                             | What the report rests on          |
| `05-conflict.png`         | The 412,000 and 365,000 conflict                | Disagreeing sources               |
| `06-assumptions.png`      | The assumption register, filtered               | Inputs, not findings              |
| `07-graph.png`            | The scenario graph                              | Extracted entities                |
| `08-actors.png`           | The six fictional proxies                       | Conflicting goals                 |
| `09-simulation.png`       | The trajectory and platforms                    | The dip at round 4                |
| `10-decisions.png`        | One proxy's decisions with stated reasons       | Why they decided                  |
| `11-branch-dialog.png`    | The branch dialog with an intervention          | Branching                         |
| `12-intervention.png`     | Editing the scheduled intervention              | Pause, schedule, resume           |
| `13-branch.png`           | A recorded branch and its lineage               | Where it came from                |
| `14-compare.png`          | The comparison                                  | Same first three rounds, then not |
| `15-report.png`           | The report reader                               | The report                        |
| `16-supporting.png`       | A statement and the passage that supports it    | Evidence                          |
| `17-contradicting.png`    | A statement and the passage that contradicts it | Evidence against                  |
| `18-analyst-answer.png`   | A cited analyst answer                          | Cited answer                      |
| `19-analyst-abstains.png` | The abstention sentence                         | Honest refusal                    |
| `20-actor-chat.png`       | A fictional actor's reply                       | Role play, labelled               |
| `21-audit-log.png`        | The audit log                                   | Accountability                    |

If you present from images, say so at the start: "The live system is unavailable, so these are
captures from a rehearsal today."

## Resetting the demonstration

```powershell
npm run demo:seed             # restore, or reset: replaces the three projects with the recording
npm run demo:seed -- --dry-run  # check the files and say what would change; writes nothing
npm run demo:seed -- --remove   # delete the three projects, and nothing else
```

The reset validates every file before it writes anything. It only ever touches the three
demonstration identifiers; any other project in the database is left as it is. It refuses to replace a
project that belongs to another workspace. Restoring twice leaves the same state as restoring once.

Two things it cannot undo, by design: the audit log is append-only, so a rehearsal's entries stay in
it, and a model that differs from the recorded one blocks **new** questions on the recorded projects
(the reset says so). Reading, comparing and exporting still work.

To record the demonstration again (an hour of model time and a few tens of cents, on a server of its
own), see `npm run demo:record`; read what it writes before committing it.

## If something fails

Say what happened, plainly, and move to the nearest fallback. The audience forgives a failed demo and
does not forgive a pretended one.

| What fails                                | What it looks like                                                                 | What to do                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The model or its sign-in is unavailable   | **Verify connection** fails; a new answerable question fails with a provider error | Everything recorded still works: all of the sources, graph, ledger, simulation, branches, comparison, report, exports and audit log, and the recorded conversation (a cited answer, an abstention, an actor). Read those instead of asking new questions. Fix later with `az login`. An unsupported question still gets its immediate abstention. |
| The server will not start                 | The page does not load                                                             | `GET http://127.0.0.1:3001/api/health`. If something else holds the port, stop it or set `PORT`. Start again with `npm start`. See [troubleshooting](../TROUBLESHOOTING.md).                                                                                                                                                                      |
| The projects are missing or altered       | The workspace says **Not loaded in this workspace**                                | `npm run demo:seed`.                                                                                                                                                                                                                                                                                                                              |
| The browser misbehaves                    | Blank page, stuck layout                                                           | Reload. Try a private window, or the other browser.                                                                                                                                                                                                                                                                                               |
| The laptop sleeps or the network drops    | The page stops updating                                                            | Wake it and reload. Recorded content does not need the network; only new model questions do.                                                                                                                                                                                                                                                      |
| Everything fails                          | No live system                                                                     | Present from the [backup screenshots](#backup-screenshots) and this guide. Say so.                                                                                                                                                                                                                                                                |
| You need a live run and the model is down | Nothing to demonstrate                                                             | Rules mode works with no network: **Load fictional starter input**, then build. The interface labels it **local rules**, and you should say that it is not the model.                                                                                                                                                                             |

Do not hide a failure behind another mode. The interface shows which mode a project was run in, and
there is no silent fallback from the real model to the rules engine.
