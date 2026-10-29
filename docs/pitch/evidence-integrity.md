# Evidence integrity

How a statement earns the right to be called a finding, with one worked example. The design record
is [ADR 0001](../adr/0001-evidence-integrity-model.md); the abstention rule is
[ADR 0002](../adr/0002-abstention-and-citation-rule.md).

## The two labels

Every material statement has a **type** that says what kind of thing it is, and a **support class**
that says how well the project's own evidence backs it.

| Type (10)                                                                                                                                                                                   | Support class (8)                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| source fact, extracted claim, user assumption, inferred relationship, AI hypothesis, simulated event, analytical conclusion, recommendation, contradicting evidence, unresolved uncertainty | directly supported, partially supported, contradicted, unsupported, not applicable, not checkable, simulation derived, assumption dependent |

Types are never merged. A support class is **not** a claim that the statement is true: it says how
far the project's own documents back it.

## What the product may do with each

A deterministic policy (a function of type and class, with no model involved) decides:

| Class                | May be shown as                                   |
| -------------------- | ------------------------------------------------- |
| Directly supported   | A finding                                         |
| Partially supported  | A finding, with its qualification attached        |
| Contradicted         | Shown together with the contradiction             |
| Unsupported          | A labelled hypothesis, never a finding            |
| Simulation derived   | A labelled simulation result, never a source fact |
| Assumption dependent | With the assumption it depends on                 |
| Not checkable        | Labelled not verified                             |
| Not applicable       | An input, such as an assumption you chose         |

A reviewer can accept, reject or ask for revision. Rejecting withholds the statement from the
report. Accepting only records that a person looked; it **cannot** raise an unsupported statement
into a finding. The review is versioned and audited.

## Worked example (the Larkholm demonstration)

Two of the five fictional sources disagree about the same year:

- The council briefing note counts 412,000 one-way crossings in 2025.
- The ferry operator's memo counts 365,000.

1. The conflict detector pairs the two sentences (same measured quantity, same explicit year) and
   lists a **conflict candidate** with both quotations side by side.
2. A statement in the report that repeats either figure is **weighed against the conflict**: a
   source statement that another source contradicts becomes partially supported (mixed evidence)
   instead of directly supported, and is shown with the contradiction.
3. A person opens the candidate and chooses **Confirm conflict** or **Not a conflict**. The choice is
   written to the audit log with their identity (their object id, not their name) and nothing else
   about them. If they dismiss it, the statements it touched are recalculated and keep their reviews.
4. In the analyst chat, a question the sources cannot answer ("What was ferry ridership in 2019?") is
   answered with exactly: _The available project evidence does not support a confident answer._ No
   model is called.

A second conflict in the same pack, between "islanders overwhelmingly prefer the electric ferry" and
"71% oppose a reduced winter timetable", is **not** found. It is a conflict of meaning, not of a
shared figure. The pack is kept as it is so that the miss stays visible.

## What it does not guarantee

- The checks behind a support class are heuristics. Word overlap and figure matching can show that a
  passage says something, not that it is true. The deterministic check accepted 3 of 8 unsupported
  statements in the labelled set; a model-assisted check can lower or confirm a verdict but is
  observed only in live runs.
- Rules mode produces no grounding review, so its ledger holds conflicts and assumptions but no
  statements. The statement classes appear with a model.
- A conflict candidate is a candidate. The detector has false alarms and misses (see the
  [demonstration packs](../demo/README.md)).
