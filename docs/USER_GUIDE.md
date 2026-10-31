# Using the guided console

This guide describes the journey from a question to a decision brief, what opens each stage and why the
page sometimes says a stage is locked, how to read the results, every stage of the console, the what-if loop
(pause, resume, intervene, branch, compare), the grounding review and Report Studio. Back to the
[README](../README.md).

Swarm explores what could happen if something changes. It does not guarantee or precisely predict
real-world behavior: everything it shows is a simulation of synthetic actors under assumptions that are
stated, and none of it is a measurement of real people.

The default UI is a technical five-stage console, not a one-click replay. It has light, dark and
high-contrast themes (see [Themes](#themes)).
On wide screens a single **Graph / Split / Workbench** control switches the working
layout (on narrow screens it becomes a two-way **Graph | Workbench** pane switch);
the graph, inspectors and the collapsible, in-flow operation log show actual
persisted data and never overlay stage content. No example results, actors
or counters are preloaded. A fictional starter fills editable input only.

## From a question to a decision brief

Every question goes through the same steps. An example only fills in a question and its evidence; the
scenario, the stakeholders and the results are made the same way as for a question of your own.

1. **Ask.** On the first screen type a what-if question (one or two sentences), or choose an example. You
   can press **Understand my question** to see how Swarm reads it into a scenario (what changes, what is
   affected, what is expected without the change, the options to compare) and correct it. Rules on the
   server read it and it goes nowhere else, unless you chose **Model assisted** under **Run settings**:
   then it is sent to the model provider, and if that fails or takes more than 170 seconds the rules read
   it and a note says so. Nothing runs until you start, and you can skip this.
2. **Add evidence.** Attach TXT, MD or text-based PDF files, paste text, or add a public web page (the
   server fetches its text; it does not run scripts, sign in or read private networks, and it does not
   check that the page is true). Up to ten documents. Every document keeps where it came from.
3. **Build Graph.** This saves a draft and starts Graph Build only: no environment, simulation or report
   runs until you ask. Graph Build shows what was read from the evidence, with citations.
4. **Stakeholders and actors** (the **Env Setup** stage, at the top). Swarm proposes who is affected,
   with the sources it found for each: by reading the text for roles with no model, or, only in a
   model-assisted project and only if you choose it, by asking the model. You review the list (accept,
   edit, add, merge, remove), then **approve** it. Swarm makes **simulated actors** from the approved list.
   Every trait of an actor says where it came from (an assumption of the category, the evidence, a model,
   or you) and can be changed. See [Reviewing the stakeholders and the actors](#reviewing-the-stakeholders-and-the-actors)
   and [stakeholders](./stakeholders.md).
5. **Compare scenarios** (the **Simulation** stage, at the top). Choose the scenarios (no change, the
   proposed change and any alternatives), how many seeded runs of each (10, 30 or 100), and whether to
   also test which assumptions the result is sensitive to. The comparison runs on the server while you
   watch its progress, and you can cancel it. See [the method](./analysis/methodology.md).
6. **Decision brief and independent review** (the **Report** stage, at the top). **Generate decision
   brief** writes the answer-first document from the comparison, by rules. **Run independent review** has
   critics check the work; you can respond to each criticism. The brief exports as Markdown, JSON and a
   printable page. See [the brief](./analysis/brief.md) and [the critics](./analysis/critics.md).
7. **Interaction** is the engine's stage for asking questions of its detailed report.

Below the comparison, the Simulation stage also keeps the engine's **Deep dive (optional)**: a slower,
agent-by-agent run, followed by its own detailed report under the brief in the Report stage. It does not
replace the comparison, and the decision brief does not wait for it.

## What opens each stage

A stage opens when the engine's own order allows it, or, for two of them, when the scenario lab's own
record does. The page reads that record from the project: whether the stakeholders are proposed or
approved, how many simulated actors there are, and whether a comparison is running, has finished or was
stopped.

| Stage       | Opens when                                                       | What it says under its name                              |
| ----------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Graph Build | Always                                                           | The state of the build                                   |
| Env Setup   | Graph Build is ready                                             | `actors ready` once there are simulated actors           |
| Simulation  | There are simulated actors, or the engine's Env Setup is ready   | `ready to compare`, `comparing`, `compared` or `stopped` |
| Report      | A comparison has finished, or the engine's Simulation is ready   | `ready to write`, then `brief written`                   |
| Interaction | The engine's Report is ready (a decision brief does not open it) | The engine's state                                       |

A stage that cannot be opened yet is greyed out and says **locked**. In Guided mode a line under it says
what it needs ("Needs actors from Env Setup", "Needs a finished comparison"), and a screen reader is told
the same in both modes. It does not open from a click or from the keyboard. It opens by itself once the
record allows it, with no reload and without pressing Refresh: the page looks for a comparison that has
finished, was stopped or failed, and for a brief that has been written, and shows them within a few
seconds.

The **Next step** bar above the stage names the one next piece of work, with one button, whenever that work
is in a stage other than the one you are in:

- stakeholders proposed: **Review the stakeholders**, which opens Env Setup;
- approved, no actors yet: **Make the actors**, which opens Env Setup;
- actors made, no comparison (or only stopped ones): **Compare the scenarios**, which opens Simulation;
- a comparison is running: **Follow the comparison**, which opens Simulation;
- a comparison has finished: **See the decision brief**, which opens Report, and from Report **Back to the
  comparison**.

The bar only says where to go: the work is done in the stage it opens, and that is where keyboard focus
goes. It does not appear in Interaction, and a project that the lab has not touched shows none (the stage's
own button leads on). A project opens in the stage the engine is at, usually Graph Build, whatever the lab
has done since, so the bar is the quickest way back to where the work has got to. A **comparison that was
stopped or failed leaves Report locked**; a comparison that finished earlier still opens it.

The journey strip above the stages (Question, Evidence, Stakeholders, Actors, Scenarios, Run, Progress,
Results, Explore, Change, Compare, Export) ticks a step only when the project's record shows it. Proposed
stakeholders are not ticked, and neither is a stopped comparison.

## Reviewing the stakeholders and the actors

In **Env Setup** the **Stakeholders and actors** panel is at the top. It is small until you ask for more, so
that the stage's own **Start Simulation** button stays on the screen. This is what you meet, in order:

1. **Before anything is found** the panel holds one line (actors are synthetic stand-ins, not real people),
   **Find stakeholders by reading the text**, and **Or add stakeholders yourself**. In a project made in
   **Model assisted** mode on a server with a provider there is also **Find stakeholders with the model**,
   which is then the main button. **How stakeholders are found** says what each way costs and cannot do.
2. **After finding**, the list opens under four counts: **found**, **need review**, **approved** and
   **actors**. A line says how the stakeholders were found ("Found by reading the text, not by a model", or
   by which model), and a note says how many have a direction of impact read from the wording. One button
   says what to do next and changes as you go: **Review N stakeholders**, then **Approve stakeholders and
   create actors**, then **Review the N actors**. **Stakeholders** and **Actors** are toggles that open and shut the
   list and the actors.
3. **A row** is one line to scan, key actors first: the name, whether it is a key actor (one actor of its
   own) or a cohort (a group of simulated members), its category, the direction of impact in words ("Impact:
   mixed · read from the wording"), its uncertainty, whether it cites quotes ("4 cited quotes") or is an
   "Assumption: no cited evidence", and whether it still needs review. Open a row (choose its name) to read
   the quotes it rests on, word for word, each with the passage and the document it comes from, and what is
   assumed, marked as an assumption in words. Its buttons are **Accept**, **Edit**, **Merge** (into another
   stakeholder) and **Remove**, and a **Priority** menu (**Key actor**, **Standard cohort** or **Background
   cohort**). Nothing is deleted: a
   removed or merged stakeholder moves to **Removed**, where **Restore** or **Undo the merge** brings it
   back. **Add a stakeholder** adds one of your own; it carries no evidence, says so and is marked "Added by
   you". **Perspectives that may be missing** lists the kinds of stakeholder that nobody was found for: a
   prompt to look, not an error.
4. **Approving.** **Approve stakeholders and create actors** is below the list. It needs at least two
   stakeholders, accepts the ones you did not look at, and makes the actors: a key actor for each key
   stakeholder and a cohort of simulated members for each of the others. It shuts the list and puts focus on
   **Review the N actors**. Changing the list afterwards takes the approval away until you approve again, and
   **Find stakeholders again** replaces a list you have reviewed only after you confirm.
5. **The actors.** **Review the N actors** opens them. An actor opens to its traits, each on a slider with its
   origin (assumption, evidence, model or you) and the reason for its value. Moving a slider marks the trait
   "Changed by you; not saved yet". **Save changes to the actors** keeps it, and the actor is then "Edited by
   you"; **Discard unsaved changes** drops it, and **Reset all actors…** makes every actor again from the
   approved list after you confirm. If you change the stakeholders later, the page says the actors are out
   of date.

The rules read the groups that the text names with a role word, and read a direction of impact only where a
cited sentence has a word of concern or welcome. The others stay unclear until you say who is helped or
harmed, which is what the warning before a comparison means when it says that nobody has an expected
direction of impact. The
method is in [Stakeholders and actors](./stakeholders.md), and how the panel behaves is in
[UX.md](./UX.md#the-stakeholder-review).

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
- **Uncertainty is shown, not hidden.** **What held across the seeded runs** says, for each finding, "holds
  in N of M seeded runs" with a 95% interval, and calls it **Repeatable**, **Mostly repeatable**,
  **Unstable** or **Rare**. These describe how stable the simulated result is. They are not probabilities
  and say nothing about the real world. **The spread of outcomes** shows how results varied across runs.
  **Which assumptions the result is sensitive to** moves one assumption at a time and marks it
  **Sensitive**, **Robust** or **Inconclusive**.
- **Check what the comparison could tell.** If no stakeholder has a direction of impact (who is helped or
  harmed), the page says so first: either that the change cannot move anyone in the simulation (when
  nothing can land on anyone), or that nobody is set as helped or harmed, so what the comparison shows
  comes from how widely the members of a group are assumed to differ and not from a direction. Say who is
  helped or harmed in the stakeholder review, then compare again.
- **How far to rely on it.** **How far to rely on this** states the fidelity of the comparison (it runs a
  rules engine: the outcome follows mechanically from the stated assumptions, and no model decided any
  actor's behaviour), its caveats, what it cost, and, when the optional deep-dive run exists, whether that
  run lies inside the range of the repeated runs (a plausibility check, not a validation).
  **Second-order effects in one typical run** reads back a chain of events from the run nearest the
  middle; it is one run, not a forecast of the chain. An event is said to have happened because of the
  signal its responder watches; an earlier event is said to have been needed only where the run was
  replayed without it, and is otherwise said only to have come first.
- **The independent review is a second reader, not a verdict.** The critics check the evidence, the
  assumptions, the method, who is missing, bias, whether each recommendation follows from a finding, and
  what would have to be true for the conclusion to be wrong. Each criticism is **Blocking**, **Major**,
  **Minor** or a **Note**, and stays **Open** until someone answers it. You can mark an answer
  **responded** (not settled), **accepted** (the objection stands, so its impact applies to the
  conclusion) or **disputed** (the disagreement stays in view); an answer does not change the analysis or
  the criticism. The checks are rules and need no model. A deeper model review is optional (**Also ask the
  model for a deeper review**), is offered only for a project made in **Model assisted** mode on a server
  with a provider, is capped at Major so that it never blocks, and can only name things the review gave it;
  if the model fails or takes more than 170 seconds, the rules criticisms are shown with a note that says
  why, and a project that runs without a model says so beside the disabled box. Neither is a measure of
  confidence, and neither can tell whether a source is true.
- **The decision brief puts the answer first, then what it rests on.** Its first section gives the
  decision, a recommendation that depends on conditions, the comparison of the change with no change in
  one measure, the groups it moves most, the three doubts that could change it and what would settle
  them. Its recommendations each name the findings, evidence or critiques they follow from, and its
  **validation plan** lists the real-world checks that would settle what the result depends on most,
  each saying what to observe, what to compare it with and who runs it, and leaving the decision
  threshold for you to set: run them before acting on any recommendation. Every statement in the
  brief carries one of ten origins (supplied or retrieved evidence, a user or system assumption, an
  inferred stakeholder, actor behaviour, a simulation aggregation, a model interpretation, a historical
  comparison, or unresolved uncertainty), and the limitations section says what the analysis cannot tell
  you.

## The five stages in detail

1. **Graph Build:** attach or paste source material, name the scenario and frame
   a question. Choose local rules or explicitly opt into a configured provider,
   then build. Inspect the ontology, graph, counts and source citations.
   Local ontology is explicitly a topic/co-occurrence schema, not AI extraction.
   In model mode every entity carries a quote that the server checked verbatim against
   the passage it cites. A quote that runs past the source is shortened to its verbatim
   start, and a relation whose type is not in the scenario ontology is left out; the
   graph notes say how many of each. An invented citation, an unknown entity type or a
   duplicate id is still rejected.
2. **Environment Setup:** prepare fictional proxies and configuration, then
   inspect/edit persona assumptions, inclinations, influence, openness, rounds,
   minutes per round, platform selection and initial scenario inputs. Save before
   starting. IDs, source links and population size remain fixed after preparation.
3. **Simulation:** run **Info Plaza** (broadcast exposure) and/or **Topic Community**
   (community exposure). Each has a separate population state, recorded rounds,
   clock and action stream. Synthetic memory is persisted and shown separately
   from original source facts. Local update events are not fabricated social posts.
4. **Report:** explicitly generate the report after simulation. Local reports
   calculate recorded results. Model-assisted reports plan bounded tool use,
   search sources/memory, inspect timelines, optionally interview fictional
   proxies, and write real chapters progressively. Inspect tool input/output
   beside the report; hidden model reasoning is not exposed.
5. **Interaction:** keep the report beside evidence lookup or model-assisted
   report/persona chat. Survey up to five selected proxies: **state snapshots**
   return recorded numbers with no generated answer; **model interviews** make
   actual provider requests and expose asynchronous progress, cancellation and
   partial failures. Neither is a survey of real people. The analyst's answers carry a grounding label; when the
   passage an answer cites is one half of a conflict between sources, the answer says so, and an answer that
   states only one side of a disputed figure is marked **Cited, with figures to check**, naming both documents
   and both figures ([ADR 0012](./adr/0012-answers-and-disputed-sources.md)).

Each execution stage stops at **ready** and waits for the next explicit action.
Later stages cannot bypass prerequisites. Cancellation stops owned work before
retry is allowed. A failed stage preserves upstream outputs; retry re-executes that
stage, replacing its unfinished output. Export JSON before retry if partial data
matters. Interrupted stages and surveys are marked failed after restart, never
silently completed. A simulation interrupted after at least one saved round keeps
those rounds and offers **Resume from round N** (an explicit action); everything
else restarts the stage.

## Themes

The **Colour theme** selector in the header offers System, Light, Dark and High contrast. System, the
default, follows the device: high contrast when the device asks for more contrast, otherwise dark when it
prefers a dark colour scheme, otherwise light; it changes with the device while the page is open. A
choice is kept in this browser (local storage, the key `swarm.theme`, holding only the theme's name) and
is applied before the page is drawn, so there is no flash of the wrong theme. The selector is a native
control: open it with the keyboard and change it with the arrow keys.

## The first screen, the journey and Guided / Advanced

The first screen leads with the question "What could happen if…?", the sentence that Swarm explores
scenarios and does not guarantee or precisely predict real-world behavior, and the path from
evidence to a decision. The question is the first field; examples fill in a question and its
evidence, nothing more. In a project, a journey strip shows where you are on the twelve steps from
Question to Export and marks a step done only when the project's own record shows it, and each stage
button carries a line of plain help under its engine name and, if the stage is locked, what it needs
(see [What opens each stage](#what-opens-each-stage)).

The **Interface mode** switch in the header is Guided (the default) or Advanced. Advanced opens the
system details, the engine's stages, the project details and the operation log, and leaves the step
help out, and with it the line that says what a locked stage needs (a screen reader is still told). The
Next step bar is the same in both. It removes and hides nothing, and Guided hides nothing either. The
choice is kept in this browser (local storage, the key `swarm.mode`, holding only `guided` or
`advanced`). The design, the seams where features add their panels and the accessibility rules are in
[UX.md](./UX.md).

On a phone the header scrolls away with the page instead of staying at the top, the examples and the
project tools are one row that scrolls sideways, and the five stages stay in one row.

## What-if loop: pause, resume, intervene, branch, compare

Simulation rounds are saved atomically: the combined history, both platform
populations and the recorded memories are written in one update, so a saved round
is never half-written. This makes the following possible, all with real, tested
behavior:

- **Pause / Resume.** Pausing discards the in-flight round and keeps every saved
  round; the project is `ready`, not failed. Resume continues from the next round
  without recomputing earlier ones. In the local deterministic engine a resumed run
  is identical to an uninterrupted run (asserted by `backend/test/whatif.test.ts`).
  Resume also recovers from a crash or model error once rounds exist. Model-assisted
  runs are not reproducible, and usage from a discarded in-flight round is still
  counted because it was really spent.
- **Intervention.** While paused you can schedule or remove the single scheduled
  intervention for a _future_ round. "Live injection" is therefore pause → inject →
  resume at the next round boundary; nothing mutates a round in progress.
- **Branch.** From a paused or finished scenario, branch after any saved round (or
  from round 0). The branch is an independent scenario that copies rounds 1…N
  unchanged and applies your declared changes (a different intervention, or
  per-proxy influence/openness/opinion) only to later rounds. The source run is
  never modified, and a branch's report and exports record its lineage.
- **Compare.** Compare two guided scenarios round by round (mean inclination,
  support, opposition, polarization, activity), with the round through which they
  are identical derived from recorded data, and notes that these are simulated
  differences, not forecasts or causal estimates.

**History** preserves existing quick-run projects. Their recorded results remain
readable in the new console, without invented ontology, operation traces or
unrecorded second-platform results. Duplicate a historical project to use the
guided workflow. Completed scenarios are read-only apart from follow-up history;
duplicate inputs to run another scenario.

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

The Report stage ends with **Open Report Studio**. The studio is where a person works on the report that
was generated: it makes a copy, called the _document_, and the generated report itself is never changed.
The design and its limits are in [ADR 0011](./adr/0011-report-studio.md).

- **Opening it.** The first time, choose **Open the report in the studio**. Analysts and project leads
  can; everyone else can read it once it is open. A report computed from recorded results, with no model,
  can be opened too.
- **Sections.** The executive summary, each chapter and the limitations are listed on the left. A
  chapter shows the statements the server checked against the sources, and each statement opens to the
  passages that support it, the passages that contradict it and the assumptions it rests on. Open
  conflicts between sources and the assumptions behind the simulated results are under the section.
- **Editing.** **Edit text** and save: the save is a new version, with an optional reason. The version
  history compares any earlier version with the current text (added words are underlined, removed
  words are struck through, and a screen reader is told which is which) and can bring an earlier text
  back as a new version. A save that changes nothing is refused. A save made on a section that someone
  else changed in the meantime is refused, and the page then shows their text: you cannot overwrite it by
  accident.
- **What an edit does to the checks.** The server checked the statements against the text it
  generated. Once the text of a chapter has changed, those statements describe an earlier text: they are
  still shown, marked as such, and nothing says they check the new words. Text a person wrote is not
  checked statement by statement. Bringing the exact earlier text back brings its statements back.
- **Locking.** A locked section cannot be edited, restored or written again until it is unlocked.
- **Writing a chapter again.** When the report was written by a model and the same provider and model are
  configured, **Write this chapter again** asks the model to rewrite one chapter from the same sources, with
  an optional request about emphasis or wording (it cannot loosen a check). The server checks the new text
  the way the report was checked, then shows the changes against the text as it stands, what the checks
  found, and any figure that matches nothing in the cited material. Nothing changes until you
  **accept** it; you can **reject** it. It uses model calls (at most ten) that are counted in the
  project's usage. When it is not possible, the studio says why.
- **Review.** **Submit for review** freezes the report so that a reviewer approves what they read. A
  reviewer (a reviewer or a project lead) **approves** it, or **requests changes** with a reason, after
  which the author can edit and submit again. An approval records a hash of the exact text. **Reopen**
  (with a reason) takes an approval away. A reviewer can leave a note on any section in any state; a
  note changes no text and does not disturb an approval. When the person who approves also wrote part
  of the text, the approval says so.
- **If the generated report is replaced** (the Report stage was run again), the document can be read and
  exported but not changed. **Start again from the new report** makes a new document and keeps the old
  text in an archive.
- **Exports.** **Export Markdown** and **Export JSON** carry every section, its statements and the
  record. **Open the printable memo** opens a page to print or save as PDF with the browser's Print
  command. A memo says at the top whether it is approved, in review, a draft, or carries an approval that
  no longer matches its text; lists as findings only statements a source passage supports; shows
  hypotheses, simulation results and statements that are not verified under their own headings; and
  says which statements it left out because their text was changed.
- **Audit.** Each step is recorded in the [audit log](../README.md#security) with identifiers and counts,
  never with the text.

An approval means a person with the review capability read this text and accepted it. It does not mean
the statements are true, and it is not an external attestation. There is no live co-editing and no
merge: two people editing one section are told, and the second sees the first's text.

## Model budget

A project that calls a model has a budget for it: how many model calls, and how many tokens, it may use in
all. The project header shows a **Model budget** button (it says how the project stands once a limit is near),
and a notice above the work appears when the project is running low or has used up its budget. The design and
its limits are in [ADR 0013](./adr/0013-per-project-model-budget.md).

- **What it counts.** A call is counted when the provider answers, with its input and output tokens. It
  covers every use of the model: a run, an answer from the analyst or an actor, a generated interview, and a
  chapter written again in the studio. It does not start over when a run does.
- **Running low and used up.** From four fifths of a limit the project is **running low**; at the limit it is
  **used up**. The next call is then refused with a message that says so, and the operation fails like any
  other that does not pass: it is not repaired or retried. A simulation that stopped keeps its saved rounds
  and carries on from them once the limit is raised. Reading, editing and exporting never use the model and
  are not affected, and neither is the local rules engine.
- **Limits.** The deployment sets a default for every project. A workspace owner or administrator can give
  one project its own limits in the dialog: leave a field empty for the deployment's default, enter 0 for no
  limit. A project lead cannot change them, so that the person who runs the work is not the one who lifts the
  limit on it. Everyone who can read the project can see them.
- **A few calls may go over.** Calls already in flight when a limit is reached may finish, and a token limit
  is checked between calls. It guards against a project that runs away; it is not a bill to the call.
- **Audit.** A change of limits and a refusal are in the project's [audit log](../README.md#security), with
  numbers and no content.

## Who has access

When sign-in is on (`AUTH_MODE=entra`) the header and each project show who may use what; in the local
single-user mode there is nobody to share with and these buttons do not appear. The rules are in
[ADR 0007](./adr/0007-workspace-and-project-membership.md).

- **People** (in the header, for a workspace owner or administrator). Everyone in the workspace, with a role:
  owner, admin or member. A member can create projects and sees only the projects they were added to; an owner
  or admin sees every project. An administrator cannot make, change or remove an owner, and the page does not
  offer it. Taking someone out of the workspace takes them out of every project in it and ends their
  sign-ins. A workspace always keeps an owner.
- **Access** (on a project, for a project lead or a workspace owner or administrator). Who may use this
  project, as lead, analyst, reviewer or viewer. Anyone else who can read the project sees the list without
  the controls, and is told who changes it. A project always keeps a lead, and a person who is not listed
  cannot see the project at all. Adding someone to a project also makes them a member of the workspace.
- **Adding someone.** Paste their Microsoft Entra object ID (a UUID, on their page in the Entra admin
  centre) and choose a role; the dialog says what each role allows. There is no search by name or email, so
  the page cannot tell you whose ID it is: check it before you add it. Every change is in the
  [audit log](../README.md#security) with who made it, whom it was for, the role and the one before.
- **Changing or removing.** Choose another role in the row. Removing asks first. When the server refuses a
  change, for example the last owner or the last lead, the dialog shows its reason and nothing changes.
