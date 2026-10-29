# Problem and value

## The problem

People who weigh a policy or business change (a ferry timetable, a clinic booking rule, a warehouse
automation) read a stack of documents that disagree with each other, and then try to imagine how
the people affected will react. Generative tools can write that imagining fluently. The difficulty is
that fluent text is cheap and trust is not:

- A report written by a model mixes what the sources say, what the model inferred and what it made
  up, and nothing marks the difference.
- When two sources disagree, a summary quietly picks one.
- A chat assistant answers every question, including ones the documents cannot answer.
- Afterwards nobody can say who reviewed what, or on what basis.

In the baseline measurement of this project's own earlier version, a live report had 30 statements:
14 supported, 5 partly supported, 8 not supported and 3 not checkable. No rule decided how an
unsupported statement could be presented, and the analyst's reply cited nothing
([baseline](../program/baseline.md)).

## Who it is for

Analysts and strategy or programme teams who must explain a decision, not only reach one: people who
will be asked "where does that come from?" and "who looked at it?" It is not for forecasting.

## What Swarm does about it

| Need                                 | What Swarm does                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Know what is sourced and what is not | Types and support classes on every statement; unsupported text is shown only as a labelled hypothesis    |
| See where sources disagree           | Cross-source conflict candidates, shown for a person to confirm or dismiss                               |
| Stop a confident answer to nothing   | The analyst declines in fixed words when the evidence cannot answer, and answers must cite or decline    |
| See what a result depends on         | An assumption register: the inputs behind the simulated results, with the statements that depend on each |
| Show who reviewed what               | Reviews are recorded and versioned; an append-only, hash-chained audit log                               |
| Keep people out of each other's work | Sign-in verification, four roles and tenant isolation in the API (not yet used with a real tenant)       |
| Check the system itself              | An offline evaluation with published limits, and a baseline to compare against                           |

## What it does not do

It does not predict outcomes, it does not replace a person's judgement about whether two figures
really conflict, and it does not make a model's text true. A support class says how well the
project's own evidence backs a statement, which is not the same as saying the statement is correct.

## Why it is credible to build on

It is small, it is tested (see the [requirement matrix](../program/requirement-matrix.md)), and
it was measured honestly: one number in the evaluation was found to be overstated and was corrected in
the open ([evaluation results](./evaluation-results.md)). It also runs against a real Azure model
with keyless authentication, so a pilot does not start from a mock.
