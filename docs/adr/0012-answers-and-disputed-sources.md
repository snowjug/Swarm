# 0012. An answer says when a source it cites is disputed by another

Status: Accepted. Built, tested with a scripted model and in rules mode, and its rules mutation-checked.
**Not measured on a live model**, and the labelled evaluation sets do not cover it.

## Context

[ADR 0002](./0002-abstention-and-citation-rule.md) makes the analyst cite, or decline. A cited answer can still
mislead when the passage it cites is one half of a disagreement. The ledger already finds open conflicts
between sources (`grounding/contradictions.ts`) and lowers a report statement that a conflict touches, and the
model is shown the open conflicts in its prompt. Nothing checked what the answer did with them: an analyst that
says "the council reports 412,000 crossings", citing the council's note, was shown as plainly cited while the
operator's memo, in the same project, gives 365,000.

## Decision

After an answer is accepted, a deterministic check (`disputeNotes` in `evidence-gate.ts`) looks at the open
conflicts that the answer touches: a conflict is touched when the answer cites one of its passages, or a
report statement that rests on one. It never changes the answer's words.

1. **A figure stated from one side is marked.** If the answer is the analyst's own assertion and states one
   side of a disputed figure without the other, the reply is `caveated` ("Cited, with figures to check") and a
   note names both documents, both figures and the conflict. An answer that gives both sides has handled the
   disagreement and is left alone.
2. **A conflict about what was asked is named.** When the conflict's topic shares enough words with the
   question, a note says the sources disagree and that the answer does not settle it, and the status does not
   change. A conflict about something else in the same passage is not mentioned: an unrelated disputed figure is
   not a reason to caveat every answer drawn on a passage.
3. **A rules-mode answer is not an assertion.** It is a quotation of passages, so it is never marked from one
   side, though a conflict about the question is still named.
4. Only open conflicts count (`detected` or `confirmed`). One a person has dismissed or resolved does not.
   At most three are listed, and the rest are counted.

## Consequences

- A cited answer in a project that holds a dispute may now be `caveated`. In the recorded demonstration the
  council's 412,000 and the operator's 365,000 are such a dispute, and an analyst that quotes one of them alone
  is shown as having a figure to check. That is the intended reading; a recorded conversation is stored with the
  status it had and is not recomputed.
- The check is lexical and numeric. It finds a disputed figure only where the detector found a conflict of
  figures, and a conflict about the question only by shared words. A conflict of meaning that the detector
  misses (see the evaluation) is still missed, and a model that restates a figure in words is not caught.
- The label's meaning changed with it: "Cited, with figures to check" now covers a figure another source gives
  differently, as well as one not found in what was cited.

## Evidence

`backend/test/evidence-gate.test.ts` (one side, the other side, both sides, a conflict about the question,
a dismissed conflict, an unrelated disputed figure, a rules-mode answer, and `disputeNotes` as a function) and
seven mutations of its rules (`npm run mutation:security -- --area=analyst`), each of which a test catches.
