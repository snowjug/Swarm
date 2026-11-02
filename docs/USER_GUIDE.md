# Using Swarm

This guide walks the interface from a question to a decision brief, one scene at a time: what each scene
shows and does, what opens it and why a scene is sometimes locked, how to read the results, the optional
deep dive and its what-if loop, the analyst and the actors, the grounding review, Report Studio, the model
budget and who has access. Back to the [README](../README.md). How the interface is built, and how a
feature adds to it, is in [UX.md](./UX.md).

Swarm explores what could happen if something changes. It does not guarantee or precisely predict
real-world behavior: everything it shows is a simulation of synthetic actors under assumptions that are
stated, and none of it is a measurement of real people.

![The first screen: the heading "Explore what could happen next.", a large question field with Evidence and Options buttons and an Explore button, a row of example chips, and the six steps of the journey underneath](./assets/swarm-ask.png)

## The journey

The work is six **scenes** along one journey: **Ask → Ground → Map → Simulate → Compare → Decide**. It is
not a one-click replay. Nothing runs until you say so, and no example results, actors or counters are
preloaded: an example only fills in a question and its evidence, and the scenario, the stakeholders and the
results are made the same way as for a question of your own.

| Scene        | What you do there                                                                         | Opens when                                                           |
| ------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Ask**      | Write the question, add the evidence and review the scenario that Swarm reads from it     | Always                                                               |
| **Ground**   | Read what the evidence says and settle where sources disagree                             | There is a project                                                   |
| **Map**      | Find who is affected, correct the list, approve it and read the actors made from it       | The evidence has been read, or stakeholders already exist            |
| **Simulate** | Set the futures side by side, run them and watch one typical run                          | There are simulated actors (or the deep dive's environment is ready) |
| **Compare**  | Read the answer, who moves, what held across the runs and what it depends on              | A comparison has finished                                            |
| **Decide**   | Write the decision brief, review it and export it; edit the detailed report in the studio | A comparison has finished                                            |

### Finding your way

- **The top bar** floats over the page. From the left: the **Swarm** mark (it starts a new question), the
  journey, a chip for the engine (**Local rules**, or the name of the provider), **Search and commands**,
  **Ask about this**, **History** and **Settings and tools**. On a phone the journey moves to a dock along the
  bottom edge, and the mark is the way back to the first screen.
- **Search and commands** (press Ctrl or ⌘ with K, from anywhere, also while you type; on a phone it is the first
  item of Settings and tools) goes to any scene or view of one, opens History, the audit log and the other panels,
  changes the theme, the motion and the detail level, and opens another exploration by its name. A scene that is not
  open yet is listed with what opens it. Everything it does can also be done from the page: it is only quicker.
- **The journey** shows each scene as done, current, ready, working, needing attention or locked, and ticks
  a scene only when the project's own record shows it. Proposed stakeholders do not tick Map, and a stopped
  comparison does not tick Simulate. A scene's tooltip says what it is for, or what opens it.
- **A scene that cannot be opened yet** is greyed out and says what it needs: "Ground it first" (Map),
  "Needs actors" (Simulate) and "Run a simulation first" (Compare and Decide). It does not open from a click
  or from the keyboard: a note says why. It opens by itself once the record allows it, with no reload and
  without choosing **Refresh**: the page looks for a comparison that has finished, was stopped or failed,
  and for a brief that has been written, and shows them within a few seconds. A comparison that was stopped
  or failed leaves Compare and Decide locked, unless an earlier one finished: a finished comparison is not
  forgotten because a later one was cancelled.
- **A project opens where the work has got to**: on Decide once a comparison has finished, on Simulate while
  one runs or once there are actors, on Map once the evidence has been read, and otherwise on Ground. Each
  scene's main button leads to the next.
- **The address holds where you are**: `?project=<id>&scene=<scene>`, and for a part of a scene `&view=<name>`
  (for example `view=deep` for the deep dive). Copy it to come back to the same place, or to give it to
  someone who has access.
- **A record that the guided flow did not make**, such as a quick run saved before the staged engine, keeps
  its results readable. Map and Compare say "Not in this record", and the other scenes show what the record
  holds without inventing what it did not record. See [History](#history-and-keeping-a-record).

## Ask: the question and the evidence

The first screen, and the only one before there is a project. It asks "What change do you want to explore?".

1. **Write the question.** Type a what-if question, one or two sentences, into **Your what-if question**, or
   choose an example from the row under it: **Copilot in Teams**, **Cloud price change**, **Online store
   checkout**, **AI-first support**, **Launch pricing**, or the fictional starter **Library hours**, which is
   there to learn the workflow. An example fills in the question and its evidence and nothing else. A note
   then names it and says how many documents it brought, and pressing the note brings the row back.
2. **Add evidence.** **Evidence** opens a panel with three ways to add it: **Files** (drop them, or choose
   them: TXT, MD, CSV, JSON or a text-based PDF), **Paste** (a name and the text, then **Attach**) and **Web
   page**, which is offered only when the server allows it. For a page, type an address, choose **Fetch**,
   read the title, site, size and time of retrieval, then choose **Add as evidence** (or **Discard**). The
   server fetches the page, not your browser: it runs no scripts, signs in nowhere, does not read private
   networks, and does not check that the page is true. If the page cannot be read, the message says why and
   you can paste its text instead. A project takes up to ten documents of 80 to 40,000 characters each.
   Everything attached sits in a row of pills, and a pill opens the text that Swarm will work from. Every
   document keeps where it came from.
3. **Choose the engine, if you want to.** **Options** holds the engine (**Local rules**, or **Model
   assisted**, which stays off until the server has a provider), an optional name, and the settings of the
   deep dive (proxies, rounds and seed). A line there says whether the question goes anywhere: "Rules run on
   this machine. Nothing is sent anywhere.", or which provider a model would send it to.
4. **Explore.** Choose **Explore** (or press Ctrl or ⌘ with Enter). It needs a sentence and at least one
   source, and says which is missing. Swarm reads the question into a scenario: rules on the server read it
   and it goes nowhere else, unless you chose **Model assisted**. Then it is sent to the model provider, and
   if that fails or takes more than 170 seconds the rules read it and a note says so.
5. **Review the scenario.** The heading becomes "Your scenario", and what Swarm read is laid out to read and
   correct, not as a form to fill. Everything is editable where it stands: the decision, what it affects,
   where and over what time, **What changes** (each with a from and a to), **If nothing changes**, **Ways to
   do it** (the alternatives to compare; **Add a way**), **Who is affected** and **Assumed**. Each assumption
   is marked **Yours** or **System assumption**, and you can add or remove them. **Swarm asks** lists at most
   three questions that it needs answered: **Answer** or **Skip** each. **Evidence** lists what was
   attached, and **How it was read** says how the question was read. A chip says whether it was read by
   rules, by a model, or edited by you. **Question** goes back to the first screen with everything you wrote.
6. **Ground it.** **Ground it** creates the project and starts reading the evidence. Nothing ran before
   this: "Nothing runs until you continue." sits beside the button. If the reading of the question fails,
   the page says so and offers **Try again** or **Continue without reading**, which starts without a
   scenario.

Under the question, **Continue** lists your newest explorations (and the recorded demonstration, when the
workspace has it), and **All explorations** opens History. **Duplicate as a new question**, under Settings
and tools, brings an exploration's question, evidence and settings back to this screen. "Only the question,
evidence and settings were copied. Nothing that was run."

## Ground: what the evidence says

![Ground: the question as the heading, four figures (sources, passages, topics and conflicts) and a constellation graph of the topics the sources talk about](./assets/swarm-ground.png)

Ground is where the evidence is read, before anything is simulated. Its heading is your question. A status
chip says where the reading stands (Not started, Queued, Reading, Ready, Failed, Stopped, or Saved record),
and four figures, **Sources**, **Passages**, **Topics** (**Entities** in a project made in Model assisted
mode) and **Conflicts**, are also the way into the rest of the page. The one main button changes as you go:
**Ground it** before reading has started, **Stop** while it runs, **Try again** or **Start again** after a
failure or a stop, and **Map the stakeholders** once the evidence is read. It waits at the bottom of the
screen once it has scrolled away.

- **The graph** draws what the sources talk about. In rules mode its points are topics, the words the
  sources lean on most, and a line joins two that share a passage: co-occurrence, not meaning. In a
  model-assisted project a model proposed the entities and links, each with a quote that the server checked
  word for word against the passage it cites, and it may be incomplete. A ring shows which documents cite a
  topic. Choose a topic to read its passages. **Find a topic** searches, and **Zoom in**, **Zoom out**, **Fit
  to view** and **Graph options** (which types to show) are beside it. With the keyboard, `[` and `]` step
  between topics, Enter or Space opens one, the arrow keys move the view, `+` and `-` zoom, `R` fits
  everything and Esc closes the panel.
- **Method** says how the evidence was read, with the engine's notes and the types it looked for. The local
  schema is a topic and co-occurrence schema, not AI extraction. In model mode a quote that runs past the
  source is shortened to its verbatim start, and a relation whose type is not in the scenario's ontology is
  left out; the notes say how many of each. An invented citation, an unknown entity type or a duplicate id is
  still rejected.
- **Sources** are drawn as threads, each as long as its document, with its numbered passages (S1, S2, …)
  along it. Choose one to read the document with its passages marked. A tag says where each came from:
  "Upload", "Pasted", "Synthetic sample" (an example's invented documents, which say they are not real
  information), or the site that a fetched page came from. A page's sheet says "Retrieved by Swarm on" a date
  and "Retrieved, not verified."
- **Conflicts** puts two sources that give different figures ("Different figures") or say opposite things
  ("Opposite statements") side by side. Swarm found them from wording alone, and "Neither side is declared
  true."; **How it was found** says which words the passages share. Each is a **Possible conflict** until a
  person settles it: **Confirm**, **Not a conflict** or **Mark resolved**, with an optional note (**Add a
  note**), and **Change decision** if you change your mind. A conflict that you dismiss or resolve no longer
  weighs on the statements it touched. Nothing requires you to settle them.
- **Statements** lists what a report written by a model says and how well the sources back each statement,
  not whether they are true: a bar counts the verdicts and filters the list, and a statement opens in a sheet
  with its passages, where you can **Accept**, mark **Needs revision** or **Reject** it. Until there is such a
  report the section says so quietly. See the [grounding review](#grounding-review-model-assisted-reports).
- **Operations**, the engine's recorded operations and events, is shown in Advanced detail only.

## Map: who is affected, and the actors

![Map: stakeholders drawn as clusters on a map, the details of the party in view in a floating panel, and the next action in a pill at the foot](./assets/swarm-map.png)

Map opens once the evidence has been read. Swarm proposes who is affected by the change, with the sources it
found for each; you review the list and approve it, and Swarm makes **simulated actors** from it. Every
trait of an actor says where it came from (an assumption of the category, the evidence, a model, or you) and
can be changed. The method is in [stakeholders](./stakeholders.md). This is what you meet, in order:

1. **Before anything is found** the page asks "Who is in play?", says that actors are synthetic stand-ins,
   not real people, and offers **Find who is affected** and **Add one yourself**. With no model,
   **Find who is affected** reads the text for roles. In a project made in **Model assisted** mode on a
   server with a provider it asks the model (which sends your source text, and the page says so beside the
   button), and **Read the text instead** reads the text with no model. **How stakeholders are found** says
   what each way costs and cannot do. A group that the model proposes without a quote that can be checked is
   kept (marked inferred) only if your question or scenario names it; otherwise it is dropped and the note
   says so.
2. **After finding**, the stakeholders are drawn as a map, in clusters by kind: Decide, Use & benefit, Bear
   cost & risk, Influence & reach, Rivals, Partners & operations, Regulators and Others. Under the heading,
   counts say how many parties there are, how many are key and how many are **to review**, and a chip says
   how they were found ("Read from your text", "Found by a model" or "Built by you"). Press the chip for the
   note, which says how many have a direction of impact read from the wording. In the toolbar, **Map** and
   **List** switch between the map and the same parties as text, **Stakeholders** and **Actors** switch what
   is drawn, **Groups** shows or hides a kind, and the focus control (`F`) dims all but what is connected to
   the party you have open. With the keyboard, the arrow keys move to the nearest party in that direction,
   Enter or Space opens it, Esc lets go, Ctrl or ⌘ with the wheel zooms, a drag pans, and **Zoom in**, **Zoom
   out** and **Fit everything** sit beside the map.
3. **A party** is a button on the map. Choose it to read it in the inspector, a floating panel (on a narrow
   screen a strip with **Details**, which opens a sheet): its direction of impact in words, with what that
   was read from ("read from the wording", "assumption", "model’s reading" or "set by you"), how directly it
   is affected, how it is modelled (**Key**, **Cohort** or **Small**), how sure Swarm is, what it wants and
   worries about (assumed from its category, or read by a model; not found in the sources), the quotes it
   rests on under **Evidence**, word for word with the passage and the document each comes from, and **Why
   they are here**. **Accept** is a button of its own, and beside it are icon buttons to edit, merge (into
   another stakeholder) and remove it, each named for the party ("Edit <name>"). Quotations cannot be
   changed here, and the server refuses an altered or invented one. Nothing is deleted: a removed or merged
   stakeholder moves to **Removed**, where **Restore** or **Undo the merge** brings it back. **Add a
   stakeholder** adds one of your own; it carries no evidence, says so and is marked "Added by you". The
   places marked "Nobody found for" (on the map, and under **List**) are the kinds of stakeholder that
   nobody was found for: a prompt to look, not an error, and a press adds one there. A project holds at
   most 40.
4. **Approving.** One pill at the foot of the map says the one thing to do next. While some stakeholders
   need review it says "N to review" (press it to open the next one) beside **Approve & create actors**,
   which stays disabled, with the hint "Keep or add two or more", until at least two stakeholders are kept.
   Approving accepts the ones you did not look at and makes the actors: a key actor for each key stakeholder
   and a cohort of simulated members for each of the others. When a model is available, pressing the button
   opens a small panel with the switch **Let the model read the key actors** (it sends your source text to
   the model, whatever it sets is labelled as the model's, and if it fails the category priors stand) and a
   confirming button. Changing the list afterwards takes the approval away until you approve again, and
   **Find stakeholders again…** (under **More** in the toolbar) replaces a list you have reviewed only after
   you confirm ("Replace the list?").
5. **The actors.** Once they are made the pill says "N actors ready", "Synthetic stand-ins", and offers
   **Simulate**. **Actors** in the toolbar draws them, and an actor opens to its traits, each on a slider
   with its origin (assumption, evidence, model or you) and the reason for its value. Moving a slider marks
   the trait "Changed by you; not saved yet", and the pill offers **Save** and **Discard**; a saved actor is
   "Edited by you". **Reset all actors…** (under **More**) makes every actor again from the approved list
   after you confirm. If you change the stakeholders later, the page says "The actors are out of date" and
   offers **Make them again**. A simulation will not start on a list that is no longer approved or on actors
   that do not match it: the server answers in words, "approve them and make the actors again", and you do
   that here.

The rules read the groups that the text names with a role word, and read a direction of impact only where a
cited sentence has a word of concern or welcome. The others stay unclear until you say who is helped or
harmed, which is what the warning before a simulation means when it says that nobody has an expected
direction of impact.

## Simulate: watch it unfold

![Simulate, Live: the actors on the map coloured by where each stands in the round shown, a round card with the share of each response, and a scrubber along the bottom](./assets/swarm-simulate-live.png)

Simulate needs actors. Without them it says "No actors to simulate yet" and offers **Open the map**.

- **Setting it up.** "Set the futures side by side" lists the **scenarios to compare**: no change, the
  proposed change and any alternatives (**Add an alternative**). Each says how strongly it lands (a slider)
  and from which round. Every scenario runs on the same seeds, so the only difference between them is the
  change. Choose how many seeded runs of each (10, 30 or 100) and whether to **Test which assumptions it
  leans on**, which moves one assumption at a time and runs the same seeds again. The page shows how many
  runs that is and a time estimate, and **How long this takes, and what it costs** says what the estimate
  rests on. **Run the simulation** starts it. Before that the page warns, with **Review stakeholders**, if no
  stakeholder has an expected direction yet or if nothing in the change can move anyone yet; you can still
  run it, and the warning says what the result then shows. See [the method](./analysis/methodology.md).
- **While it runs**, one ring for each scenario and one for the sensitivity runs fill as the server saves
  runs ("N of M simulated runs"), and **Cancel** stops it. Nothing is shown from a stopped run, because its
  scenarios would not yet all have the same seeds: **Run it again with the same settings** starts afresh. A
  simulation that the server stopped is marked interrupted, and can be reproduced exactly from its seeds. If
  the progress cannot be read for a moment, the page says so and tries again by itself; a simulation that is
  running goes on running on the server.
- **When it has finished**, the results are a theatre with four ways to look at the same run. **Story** is a
  headline written from the numbers, then **Who moves most**, **What it sets off**, **How steady it is** and
  **How far to rely on this**. **Live** plays one typical run, round by round: the actors sit on the map,
  coloured by where each stands in the round shown, and a round card gives the share of each response and the
  signals. **Network** shows the relations between the actors that the comparison used, with controls for
  which kinds to show. **Timeline** shows the spread of the runs over the rounds, with the change and the
  events marked. Only Story and Timeline are offered when no run was kept in detail.
- **The scrubber** plays the run, with **Play**, **Pause** and **Play again**, **Previous round** and **Next
  round**, a slider for the round (the arrow keys move it by one, Page Up and Page Down by three, Home and End
  to the ends, Space plays) and a speed of 0.5, 1 or 2 times. It plays by itself the first time you open a
  finished run in a session, and when you watched it run, and never when you have asked for less motion. On a
  small screen the round card is one line that opens in place.
- **Around it**, **Compare**, in the same bar, goes on to the next scene. Under **More**, **Run it
  again…** returns to the setup, **Deep dive** opens
  [the deep dive](#the-deep-dive-optional-pause-resume-intervene-branch-compare), and **Saved simulations**
  (when there is more than one) switches between them.

What is on the screen is one typical run of many, and it is said to be: "Synthetic actors, simulated under
stated assumptions. Not a prediction."

![Simulate, Network: the actors and the relations between them, with controls for which kinds of relation to show](./assets/swarm-simulate-network.png)

## Compare: the futures side by side

![Compare: the answer as a sentence, the share of simulated members under no change and under the change with the gap between them, and the contents of the page](./assets/swarm-compare.png)

Compare reads the simulation as a document. It opens on the answer as a sentence ("Under _the proposed
change_, simulated members end up …"), the share of simulated members under each scenario and the gap
between them with its spread, and how often it held across the seeded runs. A contents lists seven parts:
**Futures**, **Who moves**, **Over time**, **What holds**, **Depends on** (how the result moves when one
assumption does), **Sets off** (a chain of second-order events from one typical run) and **How far to
rely**. See [Reading the results](#reading-the-results).

A bar at the foot keeps in reach the pair being compared (choose which two scenarios, when there are more
than two), **Method**, a menu of the parts of the page and the saved comparisons, **Run again** and
**Decide**. A chip says when the comparison describes the project as it was ("Out of date") or a newer one
exists ("An older comparison"). **Compare two recorded runs**, from that menu or from the deep dive, lays two
runs of the deep dive side by side. At its end, "What next" offers **Decide**, simulating again and comparing
two recorded runs.

## Decide: the brief and the independent review

![Decide: the decision brief as a document, with the answer first and a contents list beside the chapters](./assets/swarm-decide.png)

Decide is the decision brief as a document, with the independent review beside it. Before there is a brief
it says so and offers one action, **Write the brief**: it writes the answer-first document from the
comparison, by rules, with no model, and says "Writing the brief" while it does. See [the brief](./analysis/brief.md)
and [the critics](./analysis/critics.md).

- **The brief opens on its answer**, with a caveat, then the story in four parts: **What happened**, **Why**,
  **What to do** and **On what ground**. Five chapters of reference stay closed until they are wanted: the
  assumptions, the evidence base, the sources, the limitations and the technical appendix. The contents
  (beside the page where there is room, or from **Contents** on a small screen) opens one, and **Open every
  chapter** opens them all (**Close the reference** shuts them again). A closed chapter is still in the page,
  so find in the page and a screen reader reach it, and an address ending `#brief-<chapter>` opens it. A long
  list of statements shows its first few, with **Show N more statements**. Press Ctrl+P (Cmd+P on a Mac): the
  page prints the whole brief, whatever is closed on the screen, and the review, in ink on white and without
  the application around them.
- **Every statement shows its origin.** Press the mark beside it to see what it rests on: one of ten origins
  (supplied or retrieved evidence, a user or system assumption, an inferred stakeholder, actor behaviour, a
  simulation aggregation, a model interpretation, a historical comparison, or unresolved uncertainty).
- **Tools for the brief** are at its head. **Review** opens the critics' objections and shows how many are
  open. **Edit report** opens [Report Studio](#report-studio). **Detailed report** opens the deep dive's
  report, when one was written. **Export** saves the brief as **Markdown**, as **JSON, with the data behind
  the charts**, or as a **Printable page**, or prints this page. Under **More**, **Write the brief again**
  and **Open every chapter**.
- **The independent review.** **Run the independent review** has the critics check the work, and the page
  shows each criticism with what it rests on and what it would do to the conclusion. For each you write a
  response and say what it means: **Respond** (not settled), **Accept** (the objection stands, so its impact
  applies to the conclusion) or **Dispute** (the disagreement stays in view), then **Save response**. The
  switch **Also ask a model** adds a deeper reading, and is available only in a project made in **Model
  assisted** mode on a server with a provider. Your responses are kept for any criticism that comes back
  unchanged when you run the review again. If someone else has changed the review while you were writing, the
  page reads it again and keeps your words.
- **When it is out of date.** "This brief may be out of date" says what changed since it was made. If the
  scenario, the stakeholders or the actors changed after the comparison ran, choose **Re-run the comparison**
  and then write the brief again; if only the review changed, or a newer comparison exists, choose **Write
  the brief again**. "This review may be out of date" appears when the comparison the review reads was run
  before the scenario, the stakeholders or the actors changed: run the comparison again, then the review
  again. Someone whose role may read the brief but not rewrite it is told to ask someone who can.

## Reading the results

A comparison does not say what will happen. It says what happened in a simulation of synthetic actors,
repeated over many seeds, under assumptions that the page lists.

- **Counts are synthetic, and the brief leads with a share.** Outcome counts are numbers of simulated
  members or of seeded runs; other figures are model scores, seeded-run proportions or stated
  assumptions. None is a conversion, churn, share, adoption or sentiment rate in a real population.
  The brief leads with the mean share of simulated members looking for an alternative or resisting,
  every group counting equally, written as members in every 100, because the number of simulated
  members depends on how many were sampled for each group. How many people a group stands for is an
  assumption, not a measurement.
- **Assumptions are labelled, and some are the system's.** Each trait and each scenario says where its
  value came from: the evidence (with a cited passage), you, the system's default for the category, a
  model, or the scenario. How strongly a change lands is a system assumption unless it says it was set
  by you. A result that moves with an assumption nothing supports is called out.
- **Uncertainty is shown, not hidden.** **What holds** says, for each finding, "holds in N of M seeded
  runs" with a 95% interval, and calls it **Repeatable**, **Mostly repeatable**, **Unstable** or **Rare**.
  These describe how stable the simulated result is. They are not probabilities and say nothing about the
  real world. **Over time** (and **Timeline** in Simulate) shows how results varied across runs. **Depends
  on** moves one assumption at a time and marks it **Sensitive**, **Robust** or **Inconclusive**.
- **Check what the comparison could tell.** If no stakeholder has a direction of impact (who is helped or
  harmed), the page says so first: either that the change cannot move anyone in the simulation (when
  nothing can land on anyone), or that nobody is set as helped or harmed, so what the comparison shows
  comes from how widely the members of a group are assumed to differ and not from a direction. Say who is
  helped or harmed on the Map, then simulate again.
- **How far to rely on it.** **How far to rely** states the fidelity of the comparison (it runs a
  rules engine: the outcome follows mechanically from the stated assumptions, and no model decided any
  actor's behaviour), its caveats, what it cost, and, when the optional deep-dive run exists, whether that
  run lies inside the range of the repeated runs (a plausibility check, not a validation). **Sets off**
  reads back a chain of events from the run nearest the middle; it is one run, not a forecast of the chain.
  An event is said to have happened because of the signal its responder watches; an earlier event is said to
  have been needed only where the run was replayed without it, and is otherwise said only to have come first.
- **The independent review is a second reader, not a verdict.** The critics check the evidence, the
  assumptions, the method, who is missing, bias, whether each recommendation follows from a finding, and
  what would have to be true for the conclusion to be wrong. Each criticism is **Blocking**, **Major**,
  **Minor** or a **Note**, and stays **Open** until someone answers it. You can mark an answer
  **responded** (not settled), **accepted** (the objection stands, so its impact applies to the
  conclusion) or **disputed** (the disagreement stays in view); an answer does not change the analysis or
  the criticism. The checks are rules and need no model. A deeper model review is optional (**Also ask a
  model**), is offered only for a project made in **Model assisted** mode on a server with a provider, is
  capped at Major so that it never blocks, and can only name things the review gave it; if the model fails
  or takes more than 170 seconds, the rules criticisms are shown with a note that says why, and a project
  that runs without a model says so beside the disabled switch. Neither is a measure of confidence, and
  neither can tell whether a source is true.
- **The decision brief puts the answer first, then what it rests on.** Its first section gives the
  decision, a recommendation that depends on conditions, the comparison of the change with no change in
  one measure (the paired difference, its standard error and how the paired runs divided: in how many the
  share was higher under the change, in how many lower, or the same in all), the groups it moves most, the
  three doubts that could change it and what would settle them. Its recommendations each name the findings,
  evidence or critiques they follow from, and its **validation plan** lists the real-world checks that would
  settle what the result depends on most, each saying what to observe, what to compare it with and who runs
  it, and leaving the decision threshold for you to set: run them before acting on any recommendation.
  Every statement in the brief carries one of ten origins (supplied or retrieved evidence, a user or system
  assumption, an inferred stakeholder, actor behaviour, a simulation aggregation, a model interpretation, a
  historical comparison, or unresolved uncertainty), and the limitations chapter says what the analysis
  cannot tell you. "No difference" is said only of the proposed change; another scenario is read on its own
  findings. A sensitivity row moves the value that governs the run (the scenario's own override or edit of an
  actor's trait when it has one, otherwise the actor's own), and says when that value is the scenario's.

## The deep dive (optional): pause, resume, intervene, branch, compare

The deep dive is the engine's older, slower run: fictional proxies act on two simulated platforms, round by
round, with a stated reason for each decision, and it can write a detailed report of its own, with an
evidence ledger. It is optional and apart from everything above: the comparison and the decision brief do not
wait for it, and it does not replace them. It opens from **More** and then **Deep dive** over a finished
simulation (and from **Compare two recorded runs**), at `?scene=simulate&view=deep`; **Simulation** at its
head goes back. When the project has approved actors, **Prepare the environment** makes the proxies from them
(see [how the deep dive uses the actors](./stakeholders.md#how-the-deep-dive-uses-the-actors)); otherwise it
generates a small fictional population. The comparison does not need the deep dive either way. A quick run
saved before the staged engine appears there as "Saved quick run", with nothing invented for what it did not
record.

A strip at the head says where the run stands (for example Not prepared, Preparing, Ready to start, Running,
Paused, Stopped, Cancelled or Finished) and holds the one button that moves it on. The tabs are **Setup**,
**Run**, **Rounds**, **Memory** and, in Advanced detail, **Advanced** (the engine's records: traces, the log
and the raw state; in Guided detail these are one disclosure away).

1. **Prepare the environment** makes the fictional proxies and the platforms. In **Setup**, **How it runs**
   sets the rounds, the minutes per round and the platforms to run: **Info Plaza** (broadcast exposure)
   and **Topic Community** (community exposure). **Where they start** holds the assumed seed text, stance
   and strength of each input, and **The cast** lists the proxies, whose personas, inclinations, influence and
   openness you can inspect and edit. **Save the setup** keeps your changes (**Discard** drops them), and
   starting needs them saved. IDs, source links and population size remain fixed after preparation.
2. **Start the simulation** runs the platforms. Each has a separate population state, recorded rounds, clock
   and action stream, and they are never added together or averaged into one audience. **Run** shows where
   the run stands, with what you can do next. **Rounds** scrubs through each platform and shows who moved,
   and what they did; **The same numbers, as a table** is one step away. **Memory** lists what was recorded
   ("Recorded rule events", or "Recorded fictional activity" from a model), filtered by proxy, round and
   kind. Synthetic memory is persisted and shown separately from original source facts, and the local update
   events are numeric state transitions under deterministic rules, not fabricated social posts.
3. **Write the detailed report**, explicitly, after the simulation. Local reports calculate recorded
   results. Model-assisted reports plan bounded tool use, search sources and memory, inspect timelines,
   optionally interview fictional proxies, and write real chapters progressively; in Advanced detail the
   operations behind the report are listed with it, and hidden model reasoning is not exposed. **Open the
   detailed report** reads it. See [the grounding review](#grounding-review-model-assisted-reports).
4. **Ask** the report and the proxies: see [Asking the analyst and the actors](#asking-the-analyst-and-the-actors).

Each execution step stops at **ready** and waits for the next explicit action. Later steps cannot bypass
prerequisites. Cancellation stops owned work before retry is allowed. A failed step preserves upstream
outputs; retry re-executes that step, replacing its unfinished output. Export a snapshot before a retry if
partial data matters (**Export snapshot**, under Settings and tools). Interrupted steps and surveys are
marked failed after restart, never silently completed. A simulation interrupted after at least one saved
round keeps those rounds and offers **Resume** from the next one (an explicit action); everything else
restarts the step.

Simulation rounds are saved atomically: the combined history, both platform populations and the recorded
memories are written in one update, so a saved round is never half-written. This makes the following
possible, all with real, tested behavior:

- **Pause and resume.** **Pause at the last saved round** waits for a safe boundary: the round in flight is
  discarded and every saved round is kept, and the run is paused, not failed. With no saved round the run is
  cancelled instead. **Resume** continues from the next round without recomputing earlier ones. In the local
  deterministic engine a resumed run is identical to an uninterrupted run (asserted by
  `backend/test/whatif.test.ts`). Resume also recovers from a crash or model error once rounds exist.
  Model-assisted runs are not reproducible, and usage from a discarded in-flight round is still counted
  because it was really spent.
- **An assumed event.** While paused you can schedule or remove the single event for a _future_ round, from
  **An assumed event**: the round it is applied before, what happens, and its stance and strength.
  **Schedule the event**, **Replace the event** or **Remove it**. It is an assumption you add, and not a
  finding. "Live injection" is therefore pause, schedule, resume at the next round boundary; nothing mutates
  a round in progress.
- **Branch from a round.** From a paused or finished run, **Branch from a round** opens "Branch from a
  checkpoint": the last round to copy unchanged (any saved round, or round 0), what to do with the scheduled
  event, per-proxy changes, and an optional name. **Create the branch and open it** makes an independent run
  that copies rounds 1…N unchanged and applies your declared changes only to later rounds; **Keep the source
  run unchanged** closes the sheet. The source run is never modified, and a branch's report and exports
  record its lineage. Declared changes are assumptions, not proof of a cause.
- **Compare two recorded runs** lays one run beside its parent, a branch or another run, round by round,
  with the round through which they are identical derived from recorded data, and notes that these are
  simulated differences, not forecasts or causal estimates. It is in the deep dive's list of what you can do,
  and in Compare's menu.
- **Restart from round 1** discards the saved rounds and starts again with the saved environment, after you
  confirm.

## Asking the analyst and the actors

**Ask about this**, in the top bar, opens a sheet called "Ask" on the exploration you have open. The deep
dive's detailed report has the same button. The analyst and the actors answer from the deep dive's written
report, so the sheet says "Ask opens with the report" until there is one. It has three tabs.

- **Analyst** takes questions about the report and its evidence. Its answers carry a grounding label; when
  the passage an answer cites is one half of a conflict between sources, the answer says so, and an answer
  that states only one side of a disputed figure is marked **Cited, with figures to check**, naming both
  documents and both figures ([ADR 0012](./adr/0012-answers-and-disputed-sources.md)).
- **Actors** holds a conversation with one of the deep dive's fictional proxies, chosen from a list. These
  are the proxies of the agent-by-agent run, made from the actors approved on the Map, so a large cohort is
  there through a few of its members and not as a whole. Replies are fictional role-play, not testimony or a
  forecast.
- **Survey** puts one question to several actors at once (up to five, and the exploration keeps up to five
  surveys). **Snapshot** records where each stands now: the numbers come back with no generated answer, and
  no one answers. **Interview**, offered only in a project made in **Model assisted** mode on a server with a
  provider, makes actual provider requests and shows progress, cancellation and partial failures as they
  happen. Neither is a survey of real people.

In a project run by rules, the analyst and the actors retrieve stored evidence and say so ("Evidence lookup ·
rules"): nothing is generated, no actor speaks, and no real person's thoughts are inferred.

## Grounding review (model-assisted reports)

A model-written report lists the statements each chapter rests on and labels every
one as a **source fact**, **extracted claim**, **user assumption**, **AI hypothesis**,
**simulated event** or **analytical conclusion**, so “the source says”, “the simulation
did”, “you assumed” and “the model guessed” are never blended. After the chapters are
written, each statement is checked:

- a quoted source fact must appear **verbatim** (ignoring case, spacing and
  quotation style) in a passage it cites, and a statement labelled a source fact
  that cannot meet this is shown as an extracted claim (see below); graph nodes
  carry the same verified quote;
- word overlap with the cited passage or simulation memory, and every figure compared
  with the cited material or the recorded simulation metrics;
- one independent model call judges support, contradiction or silence, and each
  judgement must **quote real text** from the passage or it is rejected.

Verdicts are `supported`, `partial`, `unsupported`, `contradicted` or `unchecked`
(hypotheses and assumptions are shown as such, not verified). A model judgement can
lower or confirm a verdict but cannot create support without word overlap. Figures
in chapter prose that match neither the cited material nor the recorded data are
listed as possible invented statistics. The review states which checks ran, and if
the independent check fails the report still completes with the deterministic
checks and says so.

You read the checks in the detailed report (**Statement checks**, and the sources and checks in each
chapter's margin), in Ground under **Statements**, and in Report Studio under **Statements**.

Limits: a citation proves provenance, not truth; only the statements the writer
lists are checked; the rules-based report has no model-written statements and gets
no review. This is a guard against unsupported claims, not a hallucination detector
or a substitute for reading the sources.

### What the review changes before it checks, and says so

A live model slips on format far more often than on substance: it rewords a quote it
meant to copy, joins two sentences that are not next to each other, cites a passage it
was never given, or lists a statement too many. Failing a whole report for that cost
a correction round trip each time, and in testing a report failed after the model
repeated the same slip through every correction. So the server repairs a slip when the
repair can only **remove, shorten or weaken** what the model claimed, and the review
lists every repair in its notes:

| Slip                                                    | What happens                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A quote runs past the cited text                        | It is cut back to the longest start that is verbatim in a cited passage               |
| A quote on a paraphrase is not in the cited passages    | The quote is removed; the statement is judged on its wording                          |
| A "source fact" has no verbatim quote left              | It is shown as an **extracted claim** instead: the label promises a quote             |
| A citation names a passage or memory that was not given | It is removed (a statement that needs a citation and has none left is still rejected) |
| A chapter lists more than six statements                | The first six are reviewed and the rest are left out                                  |
| An empty or tiny quote                                  | It is read as "no quote"                                                              |

A repair never adds a citation, a quote or a statement, and a verdict never rests on
the label or on anything the model asserted: it comes from the cited passages and the
independent check. What is **not** repaired: an invented figure, a statement whose
cited passage does not back it (it is reported as unsupported), and a simulated event
that cites no recorded memory.

The independent check also accepts an evidence quote that runs past the passage when
its start is verbatim, and cuts one that is over its length limit, because one such
slip used to fail the whole batch of judgements. A quote with no verbatim start is
still sent back for correction.

Report and chapter titles must not claim a prediction (the words _predict_ and
_forecast_ are rejected and corrected), because Swarm explores possible scenarios and
does not predict the future.

## Report Studio

![Report Studio: a section of the report as a page to edit, with its version, its statements and the review workflow](./assets/swarm-studio.png)

Report Studio is where a person works on the detailed report that was generated: it makes a copy, called the
_document_, and the generated report itself is never changed. The design and its limits are in
[ADR 0011](./adr/0011-report-studio.md). It opens from **Edit report** in Decide (or **Edit in the studio**
on the detailed report), at `?scene=decide&view=studio`. Because it works on the deep dive's detailed report,
it says "There is no report to work on yet" until one is written, and points to it.

- **Opening it.** The first time, choose **Open in the studio**. Analysts and project leads can; everyone
  else can read it once it is open. A report computed from recorded results, with no model, can be opened
  too.
- **Sections.** The summary, each chapter and the limitations are listed in an outline. A chapter shows the
  statements the server checked against the sources under **Statements**, and each statement opens to the
  passages that support it, the passages that contradict it and the assumptions it rests on. **Review record**
  (under **More**) holds the decisions made, the open conflicts between sources, the assumptions behind the
  simulated results, and any earlier copies.
- **Editing.** **Edit** a section, then **Save as version N**, with an optional reason. Every save is a new
  version. **History** compares any earlier version with the current text (added words are underlined,
  removed words are struck through, and a screen reader is told which is which) and **Restore** brings an
  earlier text back as a new version. A save that changes nothing is not offered. If someone else saved the
  section while you were writing, the page says "Version N was saved while you were writing", keeps your
  words and offers **See the differences** and **Drop mine**; saving then makes a new version on top of
  theirs, and theirs stays in the history.
- **What an edit does to the checks.** The server checked the statements against the text it generated. Once
  the text of a chapter has changed, those statements describe an earlier text: they are still shown,
  marked as such ("These statements describe an earlier text"), and nothing says they check the new words.
  Text a person wrote is not checked statement by statement. Bringing the exact earlier text back brings its
  statements back.
- **Locking.** A locked section cannot be edited, restored or written again until it is unlocked (**Lock
  this section as final wording**).
- **Writing a chapter again.** When the report was written by a model and the same provider and model are
  configured, **Rewrite** and **Write it again** ask the model to rewrite one chapter from the same sources,
  with an optional request about emphasis or wording (it cannot loosen a check). The server checks the new
  text the way the report was checked, then shows the changes against the text as it stands, what the checks
  found, and any figure that matches nothing in the cited material. Nothing changes until you **Accept the
  rewrite**; you can **Reject** it. It uses model calls (at most ten) that are counted in the project's
  usage. When it is not possible, the studio says why.
- **Notes.** A reviewer can leave a note on any section in any state; a note changes no text and does not
  disturb an approval.
- **Review.** **Submit for review** freezes the report so that a reviewer approves what they read. A
  reviewer (a reviewer or a project lead) chooses **Approve…** (and then **Approve this text**), or **Request
  changes…**, after which the author can edit and submit again. An approval records a hash of the exact text.
  **Withdraw…** takes a submission back and **Reopen…** takes an approval away, each with a reason. When the
  person who approves also wrote part of the text, the approval says so.
- **If the generated report is replaced** (the report was written again), the document can be read and
  exported but not changed. **Start again from the new report** makes a new document and keeps the old text
  in an archive.
- **Exports.** **Export** saves **Markdown** or **JSON, with the record**, which carry every section, its
  statements and the record. **Printable memo** opens a page to print or save as PDF with the browser's Print
  command. A memo says at the top whether it is approved, in review, a draft, or carries an approval that no
  longer matches its text; lists as findings only statements a source passage supports; shows hypotheses,
  simulation results and statements that are not verified under their own headings; and says which
  statements it left out because their text was changed.
- **Audit.** Each step is recorded in the [audit log](../README.md#security) with identifiers and counts,
  never with the text.

An approval means a person with the review capability read this text and accepted it. It does not mean
the statements are true, and it is not an external attestation. There is no live co-editing and no
merge: two people editing one section are told, and the later save is a new version on top of the first.

## Model budget

A project that calls a model has a budget for it: how many model calls, and how many tokens, it may use in
all. **Model budget**, under Settings and tools, shows how the project stands. A line above the work appears
when the project is running low or has used up its budget ("This project is running low on its model
budget", "This project has used its model budget"), with **Details** and a **Model budget** button. The
design and its limits are in [ADR 0013](./adr/0013-per-project-model-budget.md).

- **What it counts.** A call is counted when the provider answers, with its input and output tokens. It
  covers every use of the model: a run, an answer from the analyst or an actor, a generated interview, and a
  chapter written again in the studio. It does not start over when a run does.
- **Running low and used up.** From four fifths of a limit the project is **running low**; at the limit it is
  **used up**. The next call is then refused with a message that says so, and the operation fails like any
  other that does not pass: it is not repaired or retried. A simulation that stopped keeps its saved rounds
  and carries on from them once the limit is raised. Reading, editing and exporting never use the model and
  are not affected, and neither is the local rules engine.
- **Limits.** The deployment sets a default for every project. A workspace owner or administrator can give
  one project its own limits in the dialog: for the **Model call limit** and the **Token limit** choose
  **Default** (the deployment's), **Custom** with a whole number, or **No limit**, then **Save the limits**.
  A project lead cannot change them, so that the person who runs the work is not the one who lifts the
  limit on it. Everyone who can read the project can see them.
- **A few calls may go over.** Calls already in flight when a limit is reached may finish, and a token limit
  is checked between calls. It guards against a project that runs away; it is not a bill to the call.
- **Audit.** A change of limits and a refusal are in the project's [audit log](../README.md#security), with
  numbers and no content.

## Who has access

When sign-in is on (`AUTH_MODE=entra`), Settings and tools has two more items, **People** and **Who has
access**, which show who may use what. In the local single-user mode there is nobody to share with and they
do not appear. The rules are in [ADR 0007](./adr/0007-workspace-and-project-membership.md).

- **People** (under Settings and tools, for a workspace owner or administrator). Everyone in the workspace,
  with a role: owner, admin or member. A member can create projects and sees only the projects they were
  added to; an owner or admin sees every project. An administrator cannot make, change or remove an owner,
  and the page does not offer it. Taking someone out of the workspace takes them out of every project in it
  and ends their sign-ins. A workspace always keeps an owner.
- **Who has access** (under Settings and tools, on a project, for a project lead or a workspace owner or
  administrator). Who may use this project, as lead, analyst, reviewer or viewer. Anyone else who can read
  the project sees the list without the controls, and is told who changes it. A project always keeps a lead,
  and a person who is not listed cannot see the project at all. Adding someone to a project also makes them
  a member of the workspace.
- **Adding someone.** Under **Add a person**, paste their Microsoft Entra object ID (a UUID, on their page in
  the Entra admin centre), choose a **Role to give**, and choose **Add**; the dialog says what each role
  allows. There is no search by name or email, so the page cannot tell you whose ID it is: check it before
  you add it. Every change is in the [audit log](../README.md#security) with who made it, whom it was for,
  the role and the one before.
- **Changing or removing.** Choose another role in the row. Removing asks first. When the server refuses a
  change, for example the last owner or the last lead, the dialog shows its reason and nothing changes.

## Settings, history and keeping a record

![A scene of the interface in the dark theme: pale type on a near-black page, with the floating top bar as glass](./assets/swarm-dark.png)

**Settings and tools** (the three dots at the right of the top bar) is one menu for everything that is not a
step of the journey.

- **Appearance** offers System, Light, Dark and High contrast. System, the default, follows the device: high
  contrast when the device asks for more contrast, otherwise dark when it prefers a dark colour scheme,
  otherwise light; it changes with the device while the page is open. A choice is kept in this browser (local
  storage, the key `swarm.theme`, holding only the theme's name) and is applied before the page is drawn, so
  there is no flash of the wrong theme. The menu opens with the keyboard, and its choices with the arrow keys.
- **Motion** offers Follow device, Reduced and Full. Follow device is the default and does what the device
  asks. Reduced leaves a short fade, so that a change is still shown, and stops movement and loops. Full keeps
  the motion on even when the device asks for less, apart from the map's own settling and one reveal effect,
  which still follow the device. The choice is kept under `swarm.motion`.
- **Detail** offers **Guided** ("Plain-language help under each step.") and **Advanced** ("Engine terms and
  diagnostics, open by default."). Advanced adds the engine's own names, identifiers and records, to read,
  where they are the subject (for example the operations of Ground, the identifiers in Compare, the engine
  records of the deep dive and every reference chapter of the brief open at once). It removes and hides
  nothing, and no control depends on it. The choice is kept under `swarm.mode`, holding only `guided` or
  `advanced`.
- **This exploration** (with a project open): **Refresh** reads it from the server again, **Duplicate as a new
  question** (see [Ask](#ask-the-question-and-the-evidence)), **Export snapshot** saves the project as JSON,
  **Audit log**, and, where they apply, **Model budget** and **Who has access**.
- **The account** shows "Local · single user" or "Signed in · Microsoft Entra", **People** and **Sign out**
  where they apply, and, last, the version, the licence and a link to the source.
- **The engine chip** opens "Model provider": the provider, the deployment, how it signs in, what the
  connection last did and **Verify connection**, which makes one real request. It never says `connected` of
  something that has only been configured.

On a phone the journey is a dock along the bottom edge, panels rise from the bottom as sheets, the map's
inspector is a strip that opens in a sheet, and every control is at least 44 pixels (2.75rem) high so that a
finger can reach it.

![The interface on a phone-sized screen](./assets/swarm-mobile.png)

### History and keeping a record

**History** lists every exploration, newest first ("Your explorations"). Search by name or question, filter by
**All**, **Working**, **Done**, **Stopped** or **Branches**, and press a row to open it. For a guided
project that has a saved round, **Compare `<name>`** opens Compare's page for two recorded runs. **Delete
`<name>`** asks first ("Delete this exploration?": **Keep it** or **Delete permanently**), and the deletion
cannot be undone.

A record made by the earlier quick workflow is marked "Quick run". Its recorded results remain readable,
without invented ontology, operation traces or unrecorded second-platform results. Duplicate a historical
project to use the guided workflow. Completed scenarios are read-only apart from follow-up history;
duplicate inputs to run another scenario.

The **Audit log** ("Who did what, and when. Never your questions, answers or sources.") names every action in
plain words ("Stakeholders found", "Decision brief generated"), with the recorded code in its tooltip, who did
it and when. It can be searched and filtered, and **Verify integrity** recomputes its hash chain and says
"Chain intact" or "Chain broken".
