# 0002. The analyst declines, without a model call, when the project's evidence cannot answer

Status: Accepted

## Context

The baseline analyst answered every question and cited nothing, so a question the sources could not
answer received a fluent, uncited reply. A model asked to "say when you don't know" does so
unreliably, and it cannot be tested without a model.

## Decision

1. Before any model call, a deterministic **evidence gate** (`backend/src/orchestration/evidence-gate.ts`)
   reads the question against the project's source passages and its own report, graph and recorded
   activity. It checks the share of the question's key terms the material contains, whether the
   question names a year the material never mentions, and the best passage score. If the material
   cannot answer, the reply is exactly:

   > The available project evidence does not support a confident answer.

   and no model is called. The sentence is a constant that tests compare verbatim.

2. When the gate lets a question through, the model's answer must **cite** a source passage, a
   recorded memory or a statement in the report's grounding review, or abstain in the same words.
   An answer **is** an abstention only when the sentence is the whole answer (ignoring case,
   spacing, wrapping quotes and a final stop). A reply that merely contains the sentence, such as
   the sentence followed by a figure, is an answer, and is held to the same rules as any other: an
   independent review found that treating it as an abstention let an uncited claim through with the
   figure check switched off.
   The existing bounded corrective retry (the repair loop) tells the model which rule it broke and
   asks again. Citations are validated against what the model was shown.
   If nothing at all can be cited, the answer is allowed but recorded as `uncited`.
3. Each reply records a grounding status: cited, caveated, abstained or uncited. A figure that only
   the question supplied does not excuse an answer.
4. The gate applies to the analyst (report) only. Personas speak as fictional proxies and are never
   shown the ledger.
5. The gate favours answering: its thresholds were chosen so that no answerable question in the
   labelled set is refused. A wrongly refused fair question costs the user more than a wrongly
   answered one, because the model's own rule is a second line of defence.

## Consequences

- A lexical gate cannot see meaning. It catches a question with nothing in common with the project
  and a year the project never mentions. It does not catch a plausible question about something
  absent ("Which councillors voted against?": 1 of 4 in the labelled set), nor one that mixes an
  unrelated topic with a word the project uses ("What will the weather be like next Tuesday?"). Those
  depend on the model's own refusal and its duty to cite.
- Measured on the labelled set, with the gate shown the same material the product shows it: 0% of
  answerable questions refused; 43% (dev) and 86% (test) of unanswerable questions refused. An earlier
  version of the harness showed the gate the sources alone and overstated the figure; the correction
  is recorded in the evaluation README.
- No model call on abstention means abstention is also free and instant.
- The thresholds are a documented trade-off, not a truth. They are in `evaluation/thresholds.json`
  and are re-measured by `npm run eval`.

## Evidence

`backend/test/evidence-gate.test.ts` (mutation-checked), `backend/test/demos.test.ts`,
`e2e/model/ledger-ui.spec.ts`, `evaluation/test/evaluation.test.ts`; one live Azure run in which the
analyst cited exactly the four statements the ledger classed as unsupported.
