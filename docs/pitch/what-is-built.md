# What is built

A plain statement of status. **Built and evidenced** means a test or a run you can repeat shows it
working. **Built with limits** says what the limit is. **Not built** means exactly that. The full
list, with evidence for each row, is the [requirement matrix](../program/requirement-matrix.md).

## Built and evidenced

- The scenario workflow: sources, graph, proxies, simulation with pause, intervention and
  resume, branching from a checkpoint, comparison, report, actor chat, analyst chat, export.
- Two modes that both work: a deterministic local mode with no network call, and a real model mode
  (Azure OpenAI, keyless Entra authentication, one model call per proxy per platform per round).
- The evidence ledger: ten statement types, eight support classes, a deterministic publication
  policy, evidence pointers with passage hashes, reviewer decisions that are versioned and audited.
- The analyst's abstention gate and the cite-or-abstain rule; a grounding status on every reply.
- An append-only, hash-chained audit log; versioned storage migrations with a backup before an
  upgrade.
- API sign-in verification for Microsoft Entra tokens, four roles, a default-deny route table, and
  tenant and owner scoping. Tested against a local test identity provider.
- An offline evaluation with hash-pinned labelled sets, a dev/test split, and floors that fail the
  build on a regression.
- Six synthetic demonstration packs, each checked by a test.

## Built with limits

- **Conflict detection** found 1 of 3 labelled conflicts, with no false alarm on that set. It raises
  false alarms on some real material (two surveys of different groups) and misses conflicts of
  meaning. A person confirms or dismisses every candidate.
- **Abstention** catches off-topic questions and unknown years. It lets through 3 of 4 plausible
  questions about something absent, and a question that mixes an unrelated topic with a word the
  project uses. The model's own refusal and the duty to cite are the second line, and are observed
  only in live runs.
- **The assumption register** is derived from the scenario and read-only. An analyst cannot add an
  assumption of their own.
- **Sign-in** is verified in the API only. No real tenant has been used, and the browser has no
  sign-in screen.
- **Accessibility** is checked by automated tools at four viewports. No assistive-technology testing
  has been done.
- **Cost and budget controls** limit calls and run time. There is no per-tenant token budget.

## Not built

- A PostgreSQL implementation (proposed in [ADR 0006](../adr/0006-postgres-adapter-proposed.md)).
- Automatic resume of a run after a restart.
- OpenTelemetry tracing, Application Insights, alerts.
- A report studio for assembling and publishing a report from reviewed statements.
- Quantitative analysis (sensitivity, intervals) of simulation results.
- Hosting infrastructure as code (Container Apps, a database, a key vault, monitoring).
- Dark and high-contrast themes; a Fluent UI component library; Storybook.
- A model-in-the-loop regression suite, and any evaluation on real documents.
- The persistent Azure development machine: prepared but not provisioned, awaiting approval for
  chargeable resources.
