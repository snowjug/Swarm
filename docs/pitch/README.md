# Pitch package

Material for an internal pitch and a proposed pilot of Swarm. It is written to be checked, not to
persuade: every figure names the test or the run behind it, and every limit is stated next to the
claim it limits.

Swarm runs locally and has been demonstrated end to end against a real Azure model. It is not hosted,
it has no browser sign-in, and it is not ready for production use. None of these documents says
otherwise. Read [the production-readiness gates](../production-readiness.md) beside them.

| Document                                                                | For whom              | What it answers                                                       |
| ----------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| [Executive summary](./executive-summary.md)                             | Sponsors              | What it is, what is real, what is not, what is asked                  |
| [Problem and value](./problem-and-value.md)                             | Sponsors, product     | Who needs this and why existing scenario tools fall short             |
| [What is built](./what-is-built.md)                                     | Everyone              | Built and evidenced, built with limits, not built                     |
| [Evidence integrity](./evidence-integrity.md)                           | Reviewers, sponsors   | How a statement earns the right to be called a finding                |
| [Demo script](./demo-script.md)                                         | Presenters            | A ten-minute walk-through, with what not to claim                     |
| [Architecture](./architecture.md)                                       | Engineers, architects | How it runs today, and the proposed hosted shape                      |
| [Security and responsible AI](./security-and-responsible-ai.md)         | Reviewers             | Controls in place, open risks, what only a reviewer can sign off      |
| [Evaluation results](./evaluation-results.md)                           | Reviewers, sponsors   | What was measured, how, and how far to trust it                       |
| [Comparison with the reference project](./comparison-with-reference.md) | Sponsors              | Where Swarm is the same, different, better or behind                  |
| [Pilot plan](./pilot-plan.md)                                           | Sponsors, pilot team  | A proposed scope, success measures, exit criteria                     |
| [Cost model](./cost-model.md)                                           | Sponsors              | What a run and a hosted pilot would cost, with the assumptions        |
| [Roadmap](./roadmap.md)                                                 | Sponsors, engineers   | What comes next, in order                                             |
| [Risks and limitations](./risks-and-limitations.md)                     | Everyone              | The short version of the [risk register](../program/risk-register.md) |
| [Questions and answers](./faq.md)                                       | Presenters            | Hard questions, answered plainly                                      |
| [Decisions needed](./decisions-needed.md)                               | Sponsors              | What has to be decided, by whom, and what each choice costs           |
| [Human review checklist](./human-review-checklist.md)                   | Review owners         | What to put in front of each reviewer before a pilot                  |

Supporting records: [requirement matrix](../program/requirement-matrix.md),
[risk register](../program/risk-register.md), [baseline measurement](../program/baseline.md),
[architecture decisions](../adr/README.md), [threat model](../threat-model.md),
[demonstration packs](../demo/README.md).

**Scope note.** The brief for this package named 23 deliverables. The list was not available when
the package was assembled, so it contains the sixteen documents above, chosen from what a sponsor, a
security reviewer and a pilot team would ask for. It may not match the brief one to one. Anything
missing should be raised on the pull request; nothing was left out on purpose.
