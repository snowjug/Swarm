# Using the guided console

This guide describes every stage of the console, the what-if loop (pause, resume, intervene, branch, compare) and the grounding review. Back to the [README](../README.md).

The default UI is a light, technical five-stage console, not a one-click replay.
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
