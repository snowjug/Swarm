# 0001. Every statement carries a type and a support class; a deterministic policy decides publication

Status: Accepted

## Context

A scenario report mixes things that are not the same kind of thing: what a source says, what an
analyst assumed, what a model inferred, what the simulation produced, and what is recommended. The
first version of Swarm checked each report statement against the sources and attached a verdict, but
no rule said what an unsupported statement may be called or how it must be shown. In the baseline
measurement (see [the baseline](../program/baseline.md)) a report with 30 statements had 14
supported, 5 partly supported, 8 not supported and 3 that could not be checked, and nothing in the
product's presentation of the report changed with that.

A model that writes the statement must not also decide how much to trust it.

## Decision

1. Every material statement is a record with a **statement type** (ten: source fact, extracted claim,
   user assumption, inferred relationship, AI hypothesis, simulated event, analytical conclusion,
   recommendation, contradicting evidence, unresolved uncertainty). The label travels with the
   statement and types are never merged.
2. It also has a **support class** (eight: directly supported, partially supported, contradicted,
   unsupported, not applicable, not checkable, simulation derived, assumption dependent). A support
   class says how well the project's own evidence backs the statement. It is not a claim that the
   statement is true.
3. A **publication policy** maps type and class to what the product may do: present a finding, a
   qualified finding, a contradiction, a labelled hypothesis, a labelled simulation result, a
   labelled not-verified statement, an input, or withhold it. The policy is a pure function in
   `backend/src/grounding/ledger.ts` with a table in `shared/evidence.ts`. No model is consulted.
4. Evidence is a pointer, not a paraphrase: passage id, document, character offsets, a SHA-256 of
   the passage text, and a quote only if it was found verbatim. The hash lets a reader check,
   independently of Swarm, that the text they hold is the passage that was cited. The API offers no
   way to edit a project's documents after creation, but nothing re-verifies the hash on read.
5. A model-assisted check may **lower or confirm** a verdict. It can never create support that the
   word-overlap and figure checks did not find.
6. A reviewer can accept, reject or ask for revision of a statement. That is recorded, versioned and
   audited, and it never changes the support class; it is a separate fact.
7. A conflict between two sources is a **candidate** until a person confirms or dismisses it.

## Consequences

- The report can say "unsupported" about its own sentences, and the interface shows those as
  hypotheses. This makes the report look less confident. That is the intended effect.
- Support classes are only as good as the checks behind them. Word overlap cannot read meaning: the
  deterministic check accepted 3 of the 8 unsupported statements in the labelled set
  (`evaluation/README.md`). The model check is where entailment happens, and it is measured only in
  live runs.
- A source statement that another source contradicts becomes partially supported (mixed evidence)
  instead of directly supported.
- The ledger is derived from the report's grounding review, so it holds no statements in rules mode
  (which produces no review).

## Evidence

`backend/test/ledger.test.ts`, `ledger-service.test.ts`, `contradictions.test.ts`,
`grounding-verify.test.ts`; `e2e/local/ledger.spec.ts`, `e2e/model/ledger-ui.spec.ts`; the
evaluation in `evaluation/results/latest.md`.
