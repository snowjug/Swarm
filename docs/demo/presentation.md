# Presenting Swarm

This is the guide for showing Swarm to an audience: how to get ready, two scripts (five and ten
minutes), what to say, what to do when a question is awkward, and what to do when something breaks.

Swarm explores possible scenarios. It does not predict the future. Say so first and last.

Everything shown is **fictional**. The island, the council, the people and every figure were invented
for the demonstration ([the sources](./larkholm-ferry/README.md)).

This guide is about the **recorded** demonstration. For the four flagship demos built live on the
generic pipeline, with a script that walks the whole journey (Ask, Ground, Map, Simulate, Compare,
Decide), use the [demo guide](./README.md).

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
scenario state, not measured opinion. The runs are identical through round 3 by construction, and a
branch's own screen says that its declared changes are assumptions, not proof of a cause.

### What the interface opens for a recording

The three projects were made by the engine's own stages, before the scenario lab existed. They hold the
sources, a graph of them, six proxies, six rounds on two platforms and a report with its statement checks
(and, on the base run, a recorded conversation). They hold no stakeholder list and no scenario
comparison, and the scenes open from what a project holds. So:

- They open on **Map**, which has nothing found yet ("Who is in play?"). Do not press **Find who is
  affected** on a recording: it adds a list to it, until the next reset. Choose **Ground** in the journey.
- **Ground** works fully: the question, the sources, the graph, the conflict and the statements.
- **Simulate** says "No actors to simulate yet" until the address asks for the **deep dive**
  (`scene=simulate&view=deep`), where the recorded run lives. See the bookmarks below.
- **Ask about this** works: the analyst, the fictional proxies and the surveys, with the recorded
  conversation already in place.
- **Compare** and **Decide** stay locked ("Run a simulation first"). So the recorded detailed report, the
  report studio and the comparison of two recorded runs cannot be opened from a recording. Show those on a
  flagship demo from the [demo guide](./README.md).

## Before you present

Ten minutes before:

1. **Start the server** with the real model configured (`.env`, see [Azure](../AZURE.md)):
   `npm start`. The app is then at <http://127.0.0.1:3001>.
2. **Reset the demonstration:** `npm run demo:seed`. It restores the three projects exactly as
   recorded and replaces anything a rehearsal added to them. It touches nothing else.
3. **Open the provider chip** at the right of the top bar and press **Verify connection**. One real
   request goes to the model; the chip should read `connected`. If it does not, read
   [if something fails](#if-something-fails) now, not in front of people.
4. **Bookmark the recordings.** Their identifiers are fixed, so you can open any screen of them by address.
   The recorded run is not linked from **Simulate** for a recording, so the deep dive is the one you need.

   | Recording                                    | Ground                                                        | Deep dive                                                                 |
   | -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
   | **Larkholm electric ferry: operator notice** | `/?project=de300001-0000-4000-8000-000000000001&scene=ground` | `/?project=de300001-0000-4000-8000-000000000001&scene=simulate&view=deep` |
   | **Branch: council guarantee**                | `/?project=de300001-0000-4000-8000-000000000002&scene=ground` | `/?project=de300001-0000-4000-8000-000000000002&scene=simulate&view=deep` |
   | **Branch: no operator notice**               | `/?project=de300001-0000-4000-8000-000000000003&scene=ground` | `/?project=de300001-0000-4000-8000-000000000003&scene=simulate&view=deep` |

   From a branch's deep dive, **Open the parent run** goes back to the base.

5. **Rehearse once** if there is time: `npm run demo:journey` walks the recorded presentation in a real
   browser against this server and makes real model calls. [TESTING.md](../TESTING.md) says what it
   covers, how long it takes and what it costs. Then reset again with `npm run demo:seed`: a rehearsal
   that asks a question adds messages to the base project's conversation, and the reset replaces them.
   (The audit log is append-only on purpose, so the rehearsal stays in it after a reset. It shows as
   ordinary entries.)
6. **Make the backup screenshots** if you have not (see [the backup plan](#backup-screenshots)).
7. **The screen:** a browser window of at least 1440 × 900, zoom 100%, full screen. Close other tabs
   and turn off notifications. Keep the laptop awake and on power.

## Screen sequence

The order the screens appear in the longer script. The right-hand column is the part of the address that
opens the screen, for the bookmarks. The browser test that walks the recording is described in
[TESTING.md](../TESTING.md).

| Screen                             | What to click                                                                               | Address                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| Home: introduction                 | Nothing: read the statement aloud                                                           | `/`                            |
| Home: recorded demonstration       | Under **Continue**, in **Recorded demonstration**, the base run                             | `/`                            |
| Map: nothing found yet             | Nothing: the recording opens here. Leave it                                                 | `scene=map`                    |
| Ground: the evidence               | Nothing: the question and the four figures; then a node of the source graph                 | `scene=ground`                 |
| Ground: sources                    | A source row, for example the council note                                                  | `scene=ground&view=sources`    |
| Ground: passages                   | The **Passages** figure                                                                     | `scene=ground`                 |
| Ground: conflicts                  | The conflict, both quotations                                                               | `scene=ground&view=conflicts`  |
| Ground: statements and assumptions | A supported statement, then one with contradicting evidence; **Assumptions**                | `scene=ground&view=statements` |
| Deep dive: setup and cast          | **Setup**: the six fictional proxies                                                        | `scene=simulate&view=deep`     |
| Deep dive: rounds                  | **Rounds**: the chart, **The same numbers, as a table**, the platform control               | `scene=simulate&view=deep`     |
| Deep dive: reasons                 | **Memory**: the proxy and round filters                                                     | `scene=simulate&view=deep`     |
| Deep dive: branch and lineage      | **Run**: **Branch from a round** (do not create one in front of people); a branch's lineage | `scene=simulate&view=deep`     |
| Ask: analyst                       | **Ask about this**; an answerable question, then an unsupported one                         | any scene                      |
| Ask: fictional actor               | The **Actors** tab: one proxy                                                               | any scene                      |
| Export                             | **Settings and tools** → **Export snapshot**                                                | any scene                      |
| Audit log                          | **Settings and tools** → **Audit log**, then **Verify integrity**                           | any scene                      |

## The five-minute script

For a short slot. Do not resume anything and do not create a project: everything is recorded.

**0:00 Home (30 s).** "Swarm turns source documents into an evidence ledger, runs fictional
stakeholders through a scenario, and writes a report in which every statement shows what supports it,
or that nothing does. It explores possible scenarios. It does not predict the future." Point at
**Continue** and the **Recorded demonstration** under it: "All of this is synthetic: a fictional island
and a fictional ferry decision. These were recorded with a real model."

**0:30 The project (45 s).** Open the base run. It opens on **Map**, where nothing has been found,
because the recording was made before there was a stakeholder map: choose **Ground** in the journey.
Read the question, the heading. "Five sources. Two of them disagree on purpose." Under **Sources**, open
the council note: it says 412,000 one-way crossings in 2025.

**1:15 The conflict and the statements (1 min).** Go down to **Conflicts**. "The detector found the
disagreement itself: the council counts 412,000, the operator's ticketing says 365,000. It does not say
which is right. A person decides." Then **Statements**, and the button beside the heading: "Limited: treat
as tentative. The evidence is limited: treat any recommendation as tentative." Then **Assumptions**:
"Everything the simulation rests on is listed as an input, and you can see which statements depend on
each."

**2:15 The run (45 s).** Open the base run's deep dive from your bookmark. It opens on **Rounds**. "The
mean inclination climbs to 0.57, then drops to 0.27 at round 4, when an assumed notice cuts winter
sailings. Each fictional stakeholder gives a stated reason for each decision." Open **The same numbers,
as a table**. On **Memory**, choose one proxy and read one stated reason.

**3:00 The branch (45 s).** Open the deep dive of **Branch: council guarantee**, on its **Run** tab. It
says "A branch of Larkholm electric ferry: operator notice", left after round 3. "Same first three rounds,
by construction. After that, with a guarantee instead of the notice, the mean is 0.78 at round 4, not
0.27" (read it on **Rounds**). "That is a difference between two runs of a model, not a causal estimate,
and the screen says so: 'Declared changes are assumptions, not proof of a cause.'" Do not choose
**Compare with the parent**: it is refused on a recording.

**3:45 The analyst (45 s).** **Ask about this**. The recorded conversation is already on the **Analyst**
tab: the subsidy ceiling is $1.8 million, citing the council note. Open a citation: the stored passage.
Then the unsupported one, "What was ferry ridership in 2019?". The reply is the sentence **The available
project evidence does not support a confident answer.** "No model call was made: the project never
mentions 2019."

**4:30 Close (30 s).** **Settings and tools** → **Audit log**: "Who did what, with identifiers and
counts, never what was said; tamper-evident." **Verify integrity**. Then **Export snapshot**. "Swarm
supports a person's analysis. It does not make the decision."

## The ten-minute script

Everything above, slower, plus the parts that show how it works.

**0:00 to 1:00 Home and positioning.** As above. Add the responsible-use line: "It supports human
analysis. It must not make a high-impact decision on its own."

**1:00 to 2:30 Sources and the graph.** In **Ground**, open each source briefly under **Sources**: the
council note, the operator memo, the residents' survey, the stakeholder statements, the analyst's
assumptions (labelled as assumptions, not facts). Then the source graph: eleven entities and thirteen
relations, each with a quote the server checked verbatim against a passage. Show the keyboard route:
**[** and **]** move between the entities, Enter opens one, the arrow keys pan, plus and minus zoom.

**2:30 to 3:45 Actors and configuration.** Deep dive, **Setup**: six fictional proxies with goals that
conflict, for example the residents' association chair and the Green Tide Alliance coordinator start at
opposite ends. The configuration (rounds, minutes per round, both platforms, the seed posts) is shown and
closed: "This is the setup the run started from. Editing closes when the simulation starts; branch a run
to try another." A recorded run is never rewritten. The seed posts are labelled **Assumed input**.

**3:45 to 5:15 The simulation in detail.** **Rounds**: the chart and its table. On **Memory**, filter by
the residents' association chair: read the reason he gave in round 1 and in round 4. Filter by round 4 for
everyone. "Meaningfully different decisions: they start between −0.70 and +0.90 and end between +0.10 and
+1.00." Name the limit yourself: "Notice how readily the fictional residents come round. That is a known
tendency of language-model role play. It is not evidence about real islanders."

**5:15 to 6:30 Branching.** On the base run's **Run** tab, choose **Branch from a round**. Set **Last
round to copy unchanged** to 2, under **The assumed event** choose **Replace** and write one, change one
proxy under **Proxy assumptions**, and look at the sentence at the foot of the sheet that says what the
branch will do. Then **Keep the source run unchanged**: "A branch is a separate exploration; the source
run never changes. It waits for you to start it. We will not run one here, because with a real model that
is several minutes." Then open **Branch: council guarantee**: on its **Run** tab its lineage names its
parent, the round it left at and every declared change, and **Open the parent run** goes back. If you do
create a branch, it is a project of its own: delete it under **History** afterwards. The recorded **no
notice** branch is its sibling.

**6:30 to 8:00 The statements and their evidence.** **Ground**, **Statements**: the bar is the whole
ledger in one glance and doubles as its filter. Open a **Directly supported** statement: the passage that
supports it. Open the statement that has contradicting evidence (**Contradicted**): the passage that cuts
against it. Open **How it was checked** and read **Why this class**. "A class says how well your sources
back a statement. It does not say the statement is true."

**8:00 to 9:15 The analyst and an actor, live.** **Ask about this**. On the **Analyst** tab, ask a new
answerable question (for example, what share of the electric ferry's cost the Clean Coasts Fund would pay,
and on what condition): about half a minute with a real model, and it cites the sources. Then an
unsupported one (for example, the ferry company's passenger revenue in 2018): immediate, the exact
abstention sentence. Then the **Actors** tab: choose one fictional actor and ask what would reassure them.

**9:15 to 10:00 Exports and the audit log.** **Settings and tools** → **Export snapshot**: the whole
project as JSON, with its evidence records and its conversation. **Audit log**: what you just did is in
it, with no questions or answers. **Verify integrity**.

**Optional, about ninety seconds more: the report studio.** It cannot be opened on a recording (its
route is **Decide** → **Edit report**, and **Decide** is locked there), so use a project you made from a
flagship demo, after its deep dive has written a detailed report (until it has, the brief offers **Write the
detailed report** in place of **Edit report**). Delete that project afterwards under
**History**. In **Decide**, choose **Edit report**, then **Open in the studio**. "The generated report is
never changed: this is a copy that a person works on." Open a chapter and its **Statements** tool: "Each
statement shows what the server checked it against." Choose **Edit**, add a sentence, **Save as version
2**: "Every save is a version. The statements now say they describe an earlier text, because nobody has
checked these new words." Open the **History** tool and **Compare** with the current text: the added
sentence is marked as added. Choose **Submit for review**, then **Approve…**: "A reviewer approves exactly
these words; the record holds a hash of them and says that the approver also wrote part of the text."
Open **Export** → **Printable memo**: the status at the top, the hash, and only the statements a source
supports listed as findings. Close by saying that an approval is a person's decision, recorded. It does
not make a statement true.

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
- "An approval is of the exact words, and says who approved and when. It does not make a statement true."

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
- That an approved report is a verified one, or that the studio's approval is signed or attested. It is a
  record in this application: who, when and a hash of the words.
- That the recording shows the whole interface. It holds no scenario comparison, so **Compare** and
  **Decide** are locked on it; show those on a flagship demo from the [demo guide](./README.md).

## Likely objections and answers

**"Is this a forecast?"** No. It is a structured way to explore what a set of assumptions could imply,
with the assumptions and the evidence on the screen. The first screen says so, and so do the deep dive,
the replay and the comparison.

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

**"Is it secure? Is it production ready?"** No claim. The server verifies Entra tokens, signs a person in
through the browser, enforces seven roles and separates tenants, all tested against a local test identity
provider and never against a real tenant, and nothing is hosted. The [FAQ](../pitch/faq.md) and the
readiness gates are specific.

**"Can someone edit the report and keep the check marks?"** No. Once a chapter's words change, its
statements are shown as describing the earlier text, the memo does not list them as findings, and the
review summary counts the chapter as not current. Words a person writes are not checked statement by
statement, and the page says so beside them.

**"Can I get the same answer again?"** Not from the model. The recorded demonstration is fixed; a
re-recording would differ. The deterministic parts (the checks, the ledger, the comparison) are
repeatable.

**"What does it cost to run?"** The whole recording (three runs, 199 model calls) used about 534,000
tokens in and 62,000 out, roughly thirty cents at list prices (assumed US$0.40 per million input
tokens and US$1.60 per million output). The base run was about fourteen cents and each branch about
eight. A rehearsal's own calls show in the provider chip's counters (**Calls** and **Tokens in / out**),
and an unsupported question makes none.

**"Why did the residents' mood recover so fast?"** Because the model made them. It is the kind of
result that should make you more careful about reading a trajectory as a finding.

## Backup screenshots

If the browser, the laptop or the network fails completely, you can still present from images.

Take them yourself, after the last change to the interface and after the last reset, and again whenever
either changes. The journey rehearsal can also save a screenshot of each of its steps when
`JOURNEY_SCREENSHOTS` names a folder (see [TESTING.md](../TESTING.md)). Put them in `docs/demo/backup`:
that folder is ignored by Git, because the images belong on the presenting laptop, not in the repository.
Open the folder before you start and keep a copy on a USB drive or in a second location.

| Shot                              | Screen                                                      | Use it for                         |
| --------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| Home                              | The first screen, with **Recorded demonstration** in view   | Opening, "Everything is fictional" |
| Ground: the evidence              | The question, the four figures and the source graph         | Sources, extracted entities        |
| Ground: a source                  | The council note opened                                     | Sources                            |
| Ground: the conflict              | The 412,000 and 365,000 conflict, both quotations           | Disagreeing sources                |
| Ground: statements                | The bar, the pill and the list of statements                | What the report rests on           |
| Ground: assumptions               | **Assumptions**, opened                                     | Inputs, not findings               |
| Ground: a supporting statement    | A statement and the passage that supports it                | Evidence                           |
| Ground: a contradicting statement | A statement and the passage that contradicts it             | Evidence against                   |
| Deep dive: the cast               | **Setup**, the six fictional proxies                        | Conflicting goals                  |
| Deep dive: rounds                 | **Rounds**: the chart and the platform control              | The dip at round 4                 |
| Deep dive: reasons                | **Memory**, filtered to one proxy                           | Why they decided                   |
| Deep dive: the branch sheet       | **Branch from a checkpoint**, with an event                 | Branching                          |
| Deep dive: a branch               | **Branch: council guarantee**, with its lineage             | Where it came from                 |
| Deep dive: the table              | **The same numbers, as a table**, for the base and a branch | Same first three rounds, then not  |
| Ask: a cited answer               | **Ask**, **Analyst**, an answer with its citations          | Cited answer                       |
| Ask: an abstention                | The abstention sentence                                     | Honest refusal                     |
| Ask: an actor                     | **Actors**: a fictional actor's reply                       | Role play, labelled                |
| Audit log                         | **Audit log**, after **Verify integrity**                   | Accountability                     |

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

A branch you made in a rehearsal is a project of its own, so the reset leaves it; delete it under
**History**. A project you made for the report studio is the same.

Two things it cannot undo, by design: the audit log is append-only, so a rehearsal's entries stay in
it, and a model that differs from the recorded one blocks **new** questions on the recorded projects
(the reset says so). Reading and exporting still work.

To record the demonstration again (an hour of model time and a few tens of cents, on a server of its
own), see `npm run demo:record`; read what it writes before committing it.

## If something fails

Say what happened, plainly, and move to the nearest fallback. The audience forgives a failed demo and
does not forgive a pretended one.

| What fails                                                                    | What it looks like                                                                                              | What to do                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The model or its sign-in is unavailable                                       | **Verify connection** fails and the chip reads `failing`; a new answerable question fails with a provider error | Everything recorded still works: **Ground** (the sources, the graph, the conflict and the statements), the deep dive, the recorded conversation in **Ask** (a cited answer, an abstention, an actor), the audit log and the export. Read those instead of asking new questions. Fix later with `az login`. An unsupported question still gets its immediate abstention. |
| The server will not start                                                     | The page does not load                                                                                          | `GET http://127.0.0.1:3001/api/health`. If something else holds the port, stop it or set `PORT`. Start again with `npm start`. See [troubleshooting](../TROUBLESHOOTING.md).                                                                                                                                                                                            |
| The projects are missing or altered                                           | There is no **Recorded demonstration** under **Continue**, or a recording is not as recorded                    | `npm run demo:seed`.                                                                                                                                                                                                                                                                                                                                                    |
| **Compare with the parent**, or **Open the detailed report**, on a recording  | A short message in the corner: "Run a simulation first"                                                         | Those scenes open from a finished scenario comparison, which the recordings do not hold. Say so, and read the two runs side by side in their deep dives instead.                                                                                                                                                                                                        |
| The report studio will not open, or a save is refused (a project of your own) | An error under the studio's heading; `That change was not made`                                                 | It is optional: leave it out, or read its screens from the backup set. A refused save says why (someone else changed the section, it is locked, the report is in review): reload the studio and say so. Delete the half-finished project under **History**.                                                                                                             |
| The browser misbehaves                                                        | Blank page, stuck layout                                                                                        | Reload. Try a private window, or the other browser.                                                                                                                                                                                                                                                                                                                     |
| The laptop sleeps or the network drops                                        | The page stops updating                                                                                         | Wake it and reload. Recorded content does not need the network; only new model questions do.                                                                                                                                                                                                                                                                            |
| Everything fails                                                              | No live system                                                                                                  | Present from the [backup screenshots](#backup-screenshots) and this guide. Say so.                                                                                                                                                                                                                                                                                      |
| You need a live run and the model is down                                     | Nothing to demonstrate                                                                                          | Rules mode works with no network: choose a chip on the first screen (the last, **Library hours**, is the smallest), then **Explore** and **Ground it**. The chip at the top right reads **Local rules**, and you should say that it is not the model.                                                                                                                   |

Do not hide a failure behind another mode. The history rows and the deep dive's engine chip show which
mode a project was run in, and there is no silent fallback from the real model to the rules engine.
