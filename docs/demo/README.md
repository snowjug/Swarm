# Demonstration packs

Six small, fictional scenarios. Each is a handful of short source documents that you can paste into
a new project. Everything in them is invented: no real place, organisation, person or figure.

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

## How to run one

1. Start Swarm and open the console (see the [README](../../README.md#quick-start)).
2. Create a project, attach the files in the pack's folder, and paste the pack's question from
   [demos.json](./demos.json).
3. Run it. Local rules mode needs nothing; with a model configured every stage calls the model.
4. Open **Evidence ledger**: look at the statements, the conflicts between sources and the
   assumptions behind the simulated results.
5. In **Interaction**, ask the report one question from the pack's `answerable` list and one from
   its `unanswerable` list.

## What to expect in each

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

## What the analyst does with a question

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
