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
- Sign-in with Microsoft Entra, as a bearer token or in the browser (Authorization Code with PKCE, a
  server-side session), seven roles through workspace and project membership, a default-deny route table and
  tenant scoping. Tested against a local test identity provider.
- An optional PostgreSQL implementation behind the same stores (the whole unit suite passes on it,
  in-process), and a copy tool between SQLite and PostgreSQL.
- Durable stage jobs: a refresh or restart does not lose a run; a stalled worker is replaced and a
  simulation resumes from its last saved round; bounded retries; cancel and pause across processes.
- OpenTelemetry spans and metrics with a redaction gate and a correlation id on every answer.
- Bicep for a hosted pilot, compiled and linted.
- An offline evaluation with hash-pinned labelled sets, a dev/test split, and floors that fail the
  build on a regression.
- Six synthetic demonstration packs, each checked by a test.
- Light, dark and high-contrast themes that follow the device until a choice is made; the contrast of
  every declared text colour is computed in each theme, and axe-core is run on the demonstration in each.
- Report Studio: a person opens the generated report as a copy and edits it section by section, every
  save a new version; locks sections; a reviewer approves or sends it back with a reason; an approval
  holds a hash of the exact text; a printable memo, Markdown and JSON say what was approved. An edited
  chapter's statements are shown as describing the earlier text. The whole workflow runs in a browser
  test on the demonstration, in each theme and on a phone, and 25 mutations of its rules are caught.

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
- **Sign-in** is verified against a test identity provider only. No real tenant has been used. People are added
  to a workspace or a project by Entra object ID from the People and Access screens; there is no directory
  lookup, so the page cannot say who an ID belongs to.
- **PostgreSQL, the job queue and telemetry** have not met the real thing: no deployed database, no
  separate worker containers, no Application Insights resource.
- **Accessibility** is checked by automated tools at four viewports, and on the demonstration in each
  of the three themes. No assistive-technology testing has been done.
- **Cost and budget controls** limit calls and run time, and each project has a model budget (calls and tokens)
  that only a workspace owner or administrator can change. There is no per-tenant total and no spend alert.
- **Report Studio** has run on a recording, not in use. Writing a chapter again has been tested only
  against a stand-in for the provider, never a live model. An approval is a record in the application,
  not an external attestation. There is no co-editing, merge or comment thread.

## Not built

- Anything deployed in Azure beyond the model: no host, no database server, no monitoring resource,
  no dashboards or alerts (written, not created).

- Quantitative analysis (sensitivity, intervals) of simulation results.
- A Fluent UI component library; Storybook.
- A model-in-the-loop regression suite, and any evaluation on real documents.
- The persistent Azure development machine: prepared but not provisioned, awaiting approval for
  chargeable resources.
