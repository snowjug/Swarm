# Larkholm ferry: a synthetic demo scenario

Everything here is **fictional**. The island, the council, the people and every figure were invented
for this demonstration. None of it describes a real place, organisation or person.

The five files in this folder are the source material for the demo project. They are small on
purpose, and they disagree with each other on purpose, so that you can watch how Swarm handles
conflicting evidence.

## The question

> What might happen to community support if Larkholm Island replaces its diesel ferry with a
> battery-electric ferry, raises fares by 12% and runs a reduced winter timetable?

## The sources

| File                                                                             | What it is             | Why it is in the demo                                                                                |
| -------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| [01-council-briefing-note.md](./01-council-briefing-note.md)                     | Council briefing       | Gives one ridership figure and the proposal                                                          |
| [02-ferry-operator-feasibility-memo.md](./02-ferry-operator-feasibility-memo.md) | Operator memo          | Gives a **different** ridership figure and the operator's own case for a reduced winter timetable    |
| [03-residents-survey-summary.md](./03-residents-survey-summary.md)               | Residents' survey      | Opposes a reduced winter timetable and the fare rise, which conflicts with one stakeholder statement |
| [04-stakeholder-statements.md](./04-stakeholder-statements.md)                   | Stakeholder statements | Two groups with conflicting goals: an environmental campaign and a harbour business council          |
| [05-scenario-assumptions.md](./05-scenario-assumptions.md)                       | Analyst assumptions    | Inputs the analyst chose. They are **assumptions, not facts**                                        |

Two contradictions are planted deliberately:

- **Ridership.** The council note and the operator memo give different annual crossings and summer
  shares for the same year.
- **Preferences.** One statement says islanders prefer the electric ferry even with fewer winter
  sailings. The residents' survey reports that most (71%) oppose a reduced winter timetable.

## How to run it

1. Start Swarm (see the [README](../../../README.md#quick-start)) and open the console.
2. Create a guided project, attach the five files and paste the question above.
3. Run **Graph Build**, open a few nodes, and check that each quote is marked as checked verbatim
   against a numbered passage (S1, S2, …).
4. Run **Env Setup**. Read the proxies and the seed posts, which are labelled _assumed input_. Edit
   one persona if you like; your edit is saved and labelled as an assumption.
5. Run **Simulation**. You can pause after a round, schedule an intervention for a later round, and
   resume. The demo scheduled an assumed operator notice before round 4.
6. **Branch from here** at round 3, replace the intervention (for example, an assumed council
   guarantee of six winter sailings and a 5% fare cap) and change one proxy assumption. Rounds 1–3
   are copied unchanged. Use **Compare with parent**.
7. Generate the **Report**, inspect the **Grounding review**, and open a citation to read the exact
   source passage.
8. In **Interaction**, ask the report a question and ask a fictional proxy a question. Then export
   Markdown or JSON.

With a model provider configured, every one of these steps calls the model. In **rules mode**
(no provider), graph, actors, simulation and report are produced by deterministic local rules
instead, and the interface says so.

## What the recorded demo run showed

This is one run with a real Azure-hosted model. A different run will differ, because model output
is not reproducible.

- **Graph.** 13 source-grounded entities and 16 relations. Every entity carries a verbatim quote
  from a source passage that the server checked.
- **Actors.** Six fictional proxies with conflicting starting inclinations, from firmly opposed to
  strongly in favour.
- **Simulation.** Six rounds on each of two platforms. Every decision has a stated reason, and the
  chart shows the recorded trajectory.
- **Branch.** An assumed council guarantee at round 4 instead of an assumed operator notice, plus one
  proxy made more open to persuasion. The comparison shows the runs are identical through round 3
  and then diverge, and it states that a difference is not a causal estimate.
- **Report (on the branch).** 29 statements were checked: 21 supported, 4 partly supported, 1 not
  supported, 0 contradicted and 3 not checkable. Each statement carries one of six labels (source
  fact, extracted claim, user assumption, AI hypothesis, simulated event, analytical conclusion);
  not every label appears in every report.
- **Chat.** Asked directly about the two ridership figures, the analyst contrasted them and named
  both sources.

## Limits you should know about

- **The sources are invented.** Nothing here says what would happen on a real island.
- **These are hypothetical scenarios, not predictions.** The simulated people are fictional proxies
  driven by a model and by assumptions. Their trajectories describe the scenario, not the world.
- **Model output varies.** A rerun gives different actors, different posts and a different report.
- **The grounding review checks the report against the sources, not the sources against the world.**
  A "supported" statement means the cited passage backs it, not that the passage is true.
- **The analyst can miss a conflict unless you ask about it.** Asked in general terms whether the
  sources disagree, it said it found no direct contradictions even though two are planted. Asked
  about the ridership figures by name, it found the difference.
- **Fictional proxies tend to sound like an analyst.** Asked what a proxy would need to hear, the
  answers were useful but often read as a summary rather than as the character speaking.
- **Chat citations show what the model was given, not what supports each sentence.** They are chosen
  by lexical retrieval against your question.
- **Only six proxies and six rounds were exercised.** Larger populations are limited by model latency
  and the per-run call budget.
