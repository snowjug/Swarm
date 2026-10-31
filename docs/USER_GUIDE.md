# Using the guided console

This guide describes every stage of the console, the what-if loop (pause, resume, intervene, branch, compare), the grounding review and Report Studio. Back to the [README](../README.md).

The default UI is a technical five-stage console, not a one-click replay. It has light, dark and
high-contrast themes (see [Themes](#themes)).
On wide screens a single **Graph / Split / Workbench** control switches the working
layout (on narrow screens it becomes a two-way **Graph | Workbench** pane switch);
the graph, inspectors and the collapsible, in-flow operation log show actual
persisted data and never overlay stage content. No example results, actors
or counters are preloaded. A fictional starter fills editable input only.

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
   partial failures. Neither is a survey of real people.

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
