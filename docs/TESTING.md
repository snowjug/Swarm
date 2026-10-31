# Testing, linting and formatting

Back to the [README](../README.md).

```powershell
npm.cmd run check
npm.cmd run format:check
```

`check` runs strict backend/test/frontend/scripts/evaluation TypeScript checks, ESLint, Vitest, and
production backend/frontend builds. Tests cover input thresholds, exact source
offsets, real retrieval, deterministic state transitions, measurable intervention
effects, stage prerequisites, editable preparation, separate platform state,
memory, tool/citation validation, PDF extraction/bounds, asynchronous surveys,
persistence/restart recovery, cancellation/queue bounds, HTTP boundaries, exports,
frontend graph/console helpers, provider protocol/error handling, the per-proxy
simulation (context isolation, validation, concurrency and cancellation), the
grounding review (quote matching, verdict table, entailment validation), Entra token
handling with a fake credential, and the Azure provisioning scripts with a fake Azure CLI.

The evidence layer has its own tests: the ledger and its publication policy
(`ledger.test.ts`, `ledger-service.test.ts`), conflicts between sources
(`contradictions.test.ts`), the analyst's gate and citation rule (`evidence-gate.test.ts`),
sign-in, roles and tenant isolation against a local test identity provider (`auth.test.ts`,
`membership.test.ts`, `session.test.ts`), migrations and the audit log (`storage.test.ts`), the six
demonstration packs (`demos.test.ts`) and a front-end guard against raw-HTML sinks
(`markup-sinks.test.ts`). The job queue has two files: `jobs.test.ts` drives the queue rules directly (claims, leases, retries, poison, cancel, pause, the lease fence on repository writes), and `durable-jobs.test.ts` drives the orchestrator with a scripted model and a clock the test sets: a stalled worker, a crash, a stopped backend, cancel and pause from another process, retries, idempotency and branch lineage. Both run on PostgreSQL as part of `npm run test:postgres`. Report Studio has five files: `studio-model.test.ts` drives its rules as pure functions of a document, `studio.test.ts` drives the service and routes over HTTP (the memo, the exports, the audit entries, a report that has been replaced), `studio-access.test.ts` drives every studio route as every kind of caller against the test identity provider, `studio-regenerate.test.ts` runs writing a chapter again against a provider that speaks the real protocol (including hostile instructions and concurrency), and `studio-store.test.ts` covers the store, migration 7 and its backup. The built console is tested as it is served: `static-assets.test.ts` runs `scripts/precompress.mjs` on a fixture (a Brotli and a gzip copy beside each text asset that gets smaller, and nothing else, and nothing compressed twice, and a second run over the same folder that neither fails nor compresses its own copies) and the server over HTTP (the copy the browser accepts, with the original type, the security headers and `Vary: Accept-Encoding`, and a dotfile still refused). Security-critical rules, the queue's rules and the studio's rules are mutation-checked, as described next.

Commands are written for Windows PowerShell (`npm.cmd`, which avoids the script-policy problem without
changing it); on macOS and Linux write `npm`. Run a focused part of the unit suite with
`npx vitest run <file or pattern>` and a focused browser run with
`npx playwright test --project=<name> <spec file>`.

## Test layers at a glance

| Layer                    | Command                                | Where                                                                          | Establishes                                                                                                                                                                                                                                                  | Does **not** establish                              |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Types, lint, unit, build | `npm run check`                        | `backend/test`, `frontend/src`, `evaluation/test`, `scripts/**` tests          | Business rules, contracts, state machines, security boundaries, the lab pipeline on the real engine                                                                                                                                                          | Browser rendering, real networks, any live model    |
| Formatting               | `npm run format:check`                 | The whole repository, documents included                                       | Prettier formatting of code and docs                                                                                                                                                                                                                         | Anything about behaviour                            |
| Unit suite on PostgreSQL | `npm run test:postgres`                | The same files, with every in-memory database made a PostgreSQL one (PGlite)   | The stores behave the same on both dialects                                                                                                                                                                                                                  | A deployed PostgreSQL server                        |
| Browser, `local`         | `npm run test:e2e`                     | `e2e/local`                                                                    | The engine's whole journey, errors, responsive layout, axe, keyboard                                                                                                                                                                                         | Model behaviour                                     |
| Browser, `model`         | `npm run test:e2e`                     | `e2e/model`, against `e2e/support/fake-provider.ts`                            | Orchestration of the model path, budget, grounding and chapter regeneration; that a question is read by a model only when the project is Model assisted                                                                                                      | The quality or safety of a live model               |
| Browser, `journey`       | `npm run test:e2e`                     | `e2e/journey`, on a server holding the recorded Larkholm demonstration         | The 32-step presentation, Report Studio, the three themes                                                                                                                                                                                                    | A live model (see `npm run demo:journey`)           |
| Browser, `signin`        | `npm run test:e2e`                     | `e2e/signin`, on `backend/test/support/signin-e2e-server.ts`                   | Browser sign-in and access management against a test identity provider                                                                                                                                                                                       | A real Microsoft Entra tenant                       |
| Browser, `lab`           | `npm run test:e2e`                     | `e2e/lab`, on rules-mode servers of their own, one with a web of fixture pages | The lab through its pages: the shell and the entry screen, the flagship and custom journeys from the question to the brief, the stakeholder review, the comparison, what opens each stage, the Report page and its print, what is out of date, the deep dive | Model behaviour, or any page on the real internet   |
| Live presentation        | `npm run demo:journey`                 | `e2e/journey/demo-journey.spec.ts` against a server you started                | The recorded presentation against the real model that will be shown                                                                                                                                                                                          | Anything in the lab, which it does not visit        |
| Offline evaluation       | `npm run eval`                         | `evaluation/`                                                                  | The gate, retrieval, conflicts and injection warnings against labelled sets                                                                                                                                                                                  | Anything on real documents                          |
| Mutation checks          | `npm run mutation:security`            | `scripts/mutation`                                                             | That the tests for security rules fail when a rule is broken                                                                                                                                                                                                 | That the rules are right                            |
| Load and crash recovery  | `npm run test:load`, `test:resilience` | `scripts/`                                                                     | Latency, back-pressure, memory and recovery on this machine                                                                                                                                                                                                  | Capacity of any deployment                          |
| UI audit                 | `npm run audit:ui`                     | `scripts/ui-audit.mjs`                                                         | Screenshots and layout and axe metrics at four viewports                                                                                                                                                                                                     | Design quality                                      |
| Live Azure verification  | `npm run azure:verify`                 | `scripts/azure`                                                                | Fifteen checks of the whole engine journey against your own deployment                                                                                                                                                                                       | Quality beyond the counts it reports                |
| Secret scan              | `npm run scan:secrets`                 | `scripts/secret-scan.mjs`                                                      | No credential shape in any reachable commit or in the working tree                                                                                                                                                                                           | That none exists in a form the patterns do not know |

## The scenario lab

Every piece of the lab has its own unit tests, and one test walks them together. They all run on the
rules engine with no model, and none reaches the network (a test that reads a page serves it from this
machine).

| What                                           | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reading a question into a scenario             | `scenario-parser.test.ts`, `scenario-model.test.ts`, `scenario-routes.test.ts`, `frontend/src/components/intake/ScenarioIntake.test.tsx`, `ScenarioIntake.interaction.test.tsx` (what a person's actions do: asking for a reading, `useModel`, adding, removing and editing what was read), `frontend/src/lib/intake.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Public web evidence                            | `url-policy.test.ts`, `url-fetcher.test.ts`, `url-robots.test.ts`, `url-extract.test.ts`, `url-normalize.test.ts`, `url-provenance.test.ts`, `url-route.test.ts`, `url-limiter.test.ts` (the limit on pages read at once by the whole server, and `503 URL_BUSY`), `url-config.test.ts`, `url-upload.test.ts`, `url-server.test.ts` (the fixture web server of these tests listens on loopback addresses only), `frontend/src/components/evidence/UrlEvidence.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Source conflicts and text that instructs an AI | `contradictions.test.ts` (the conflicts between sources, and the bounds of the scan: a word held by too many sentences is not read, a sentence is compared with a limited number of partners), `injection.test.ts` (the detector behind the notes on a page, a source, a question and the stakeholder step)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Stakeholders and actors                        | `stakeholders-discover.test.ts`, `-tone`, `-review`, `-actors`, `-environment`, `-routes`, `-packs`, `-neutrality`, `-noise`, `-speed` and `-docs` (all `stakeholders-*.test.ts`), `frontend/src/components/stakeholders/*.test.ts(x)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The population simulator                       | `simulation-engine.test.ts`, `-calibration`, `-chain`, `-random`, `-response`, `-explain` (an earlier event is listed as a cause only where the same seed without it shows it was needed) and `-neutrality` (all `simulation-*.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Repeated runs, findings, sensitivity           | `analysis-runset.test.ts`, `analysis-findings.test.ts`, `analysis-sensitivity.test.ts`, `analysis-stats.test.ts`, `analysis-routes.test.ts`, `signal.test.ts`, `frontend/src/components/analysis/AnalysisPanel.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Independent critics                            | `critics-rules.test.ts`, `critics-model.test.ts`, `critiques-routes.test.ts`, `frontend/src/components/critics/CriticPanel.test.tsx`, `reviewStatus.test.ts` (the review's status in the Report page's jump bar), `frontend/src/hooks/useCritiques.test.ts` (a response says which review it answers, and what the page does when the server says it changed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| The decision brief                             | `brief-build.test.ts`, `brief-rules.test.ts`, `brief-text.test.ts`, `brief-signal.test.ts` (including the undirected state: the first doubt, the do-not-decide recommendation and the direction check first), `brief-measures.test.ts` (the paired headline measure: pairing by seed and not by position), `brief-export.test.ts`, `brief-routes.test.ts`, `brief-neutrality.test.ts`, `brief-packs.test.ts` (what the brief says for the example packs on the real engine: the paired share first, the advice on the actors the runs name, a plan of checks that belongs to its pack), `brief-size-limit.test.ts` (a comparison of the largest size a person may ask for, whose per-run detail is dropped to fit: the brief reads what was kept and never reads a missing result as no members), `wording-guards.test.ts`, `frontend/src/components/brief/DecisionBriefView.test.tsx`, `ReportSeam.test.tsx` (the jump bar of the Report page, and the review read once for the bar and the panel), `reportNavigation.test.ts` (which sections open by default, which section a URL hash names) |
| Storage and progress                           | `artifacts.test.ts` (the store, both dialects, copy and restore), `lab-progress.test.ts`, `lab-fixtures.test.ts`, `lineage.test.ts` (what each document was made from: a comparison records the scenario, stakeholders and actors it ran on, a stale cast cannot start one, the brief and the review say when they predate a change, an exported brief carries that, and a response to a review that has changed is refused)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The workspace around the lab                   | `frontend/src/lib/console.test.ts` (what opens each stage, what it says when locked, the journey, the next step, the view each stage opens in), `ConsoleWorkspace.test.tsx`, `ConsoleAccessibility.test.tsx`, `HistoryDrawer.test.tsx` (a saved project opens by a button that says so), `ExamplePicker.test.tsx` (the cards, the one line that replaces them once an example is loaded), `entryReadiness.test.ts` (what the bar beside Build Graph says, from the rules that accept or refuse the form), `frontend/src/lib/audit.test.ts` (every action the backend records has a plain label), and `frontend/src/hooks/useLabRefresh.test.ts` and `useAnalysis.test.ts` (the page reads what the server did, without a reload)                                                                                                                                                                                                                                                                                                                                                                 |
| The whole path                                 | `lab-pipeline.test.ts` (comparison, review and brief joined by the real engine) and `lab-journey.test.ts` (every route a person uses, from the question to the brief, for each example and for a question that no example knows, then repeated to show the same findings)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The example packs                              | `example-packs.test.ts` (the readable copies match `shared/examples`; which source conflicts the ledger finds) and `frontend/src/lib/examples.test.ts` (sizes, labels, provenance, nothing predicted)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Five tests are guards rather than checks of behaviour. `simulation-neutrality`, `stakeholders-neutrality`
and `brief-neutrality` read the source of the simulator, the stakeholder step and the brief and fail if
a word that belongs to one market, product or industry appears in it, so an example can only be an
input. `neutrality-metamorphic.test.ts` is the other half: a scan of the source can name only a few
subjects, so it changes nothing but the subject (and the name of the people in it) and requires the same
structure, the same numbers and the same owner for the same category, which a branch for one subject
would break. `wording-guards.test.ts` holds the two guards on what the product may claim (the brief
builder's check on every statement it writes, in `backend/src/brief/lint.ts`, and the browser tests'
check on what the pages show, in `e2e/support/claims.ts`) to the same sentences: what neither may let
through (a forecast, a figure about the world that is not the simulation's) and what both must. It also
runs both over the briefs of the example packs. `readme.test.ts` fails if the README names a script, a
variable, a link or an image that does not exist, or claims what the evidence does not support.

Browser coverage of the lab is the `lab` project, which runs `e2e/lab/*.spec.ts` against built,
rules-mode servers (`AI_PROVIDER=none`) of their own and reaches no page on the real internet. Its eleven
specs are described under [End-to-end, accessibility, security and load
evidence](#end-to-end-accessibility-security-and-load-evidence). `examples.spec.ts` walks the flagship
demonstrations and a question that no example knows, from the first screen to the exported brief, through
the pages; `lab-journey.test.ts` walks the same path through the routes the pages use, on the real engine
and with no browser.

## Mutation checks on security code

A test that passes proves little unless it would fail when the rule it guards is gone. For the access
rules (workspace and project membership, the seven roles, tenant isolation), for browser sign-in
(PKCE, nonce, state, sessions, expiry, the anti-forgery header, cookies) for the job queue (leases,
the fence on a worker that lost its lease, retries, cancel and pause across processes), for the
redaction gate of telemetry (which names and values may leave the process) for Report Studio (who may
edit and who may approve, locks and versions, what an approval is of, what a memo may call a finding)
for the analyst's handling of disputed sources, for the backup taken before an upgrade and the restore
rehearsal, and for each project's model budget (where it is held, who may change it), and for the screens that manage who has access (who is offered which controls, and what an object ID must be), each rule is listed in
[`scripts/mutation/mutants.json`](../scripts/mutation/mutants.json) as one small edit that breaks it:
a check replaced by `false`, a capability added to a role, a `DELETE` that no longer deletes, a
nonce that is no longer compared. The runner applies one edit at a time to the working copy, runs the
tests that should notice, and restores the file.

```powershell
npm.cmd run mutation:security                     # all of them; 19 minutes for the first 150 on a laptop, longer on a busy one
npm.cmd run mutation:security -- --area=sign-in   # or membership, storage, jobs, telemetry, studio, analyst, budget, access or lab
npm.cmd run mutation:security -- --only=M3,S8     # named ones
npm.cmd run mutation:security -- --list           # only reads: it changes nothing, anywhere
```

A run keeps the original of the file it is changing in the scratch folder, in a folder named for the
clone it is in and for the run, with a record of what it changed (`scripts/mutation/lib/backups.ts`).
Several clones can share one scratch folder and one run at a time may use a clone. If a run is killed
outright, the next run in the same clone puts back what it left mutated, and only if the file is still as
the killed run left it and the backup is what the killed run recorded; anything else it leaves where it is,
and says so. `scripts/mutation/lib/backups.test.ts` and `scripts/mutation/run.test.ts` hold this: two clones
with one scratch folder never touch each other's backups, an interrupted run is put right by the next run in
its own clone only, and `--list` changes nothing.

Result of the last full run: **all 150 were caught** (15 of 15 membership, 27 of 27 sign-in, 22 of 22 storage, 19 of 19
job, 9 of 9 telemetry, 25 of 25 studio, 7 of 7 analyst, 17 of 17 budget and 9 of 9 access mutations). The `lab` area
(L1 to L16: the robots.txt redirect from https to http, the size limit of a stored document, the guards on
recommendations and checks, a brief that predicts, the intake's choice of where a question goes and its Add,
Remove and edit controls, the cap on a model's reply, and three subject-dependent branches in stakeholder reading,
the simulator and the brief) was added after that run and has been run on its own: all 16 were caught. One studio mutation survived the first run
(a memo that said APPROVED for an approval whose text had since changed, which no test had stored and
exported), and a test was added. Two sign-in mutations survived the first run (an error reply that
still carried a code, and a session that remembered every caller as a platform administrator); a
test for each was added and both are now caught. This is a check of the tests, not proof that the
rules are right, and a rule that is not in the list is not covered by it. Two storage rules cannot be
checked this way: that an operation on a shared database is made atomic, and that an audit entry
is not forked by two instances, need two real connections to one PostgreSQL server, which the
in-process test server does not give. The list itself is tested
(`scripts/mutation/lib/mutants.test.ts`): every edit must still apply exactly once, and the named
tests must be able to reach the file it changes, so the list cannot quietly go stale. The full run
is not part of CI, because of its length.

## Model budget

- **Rules** (`backend/test/usage.test.ts`): what a project has used and that it never goes back when a run
  starts again, where a limit comes from (the deployment's default, the project's own, 0 for none), the exact
  boundary of the call limit and of the token limit, one audit entry for each client that is refused, and the
  state (none, ok, running low, used up). On PostgreSQL too (`npm run test:postgres`).
- **The client and its five places of use** (`backend/test/model-budget.test.ts`): a client is asked before every
  call, repairs included, and sends nothing once refused; a quick run, a stage, an answer, a generated
  interview and a chapter written again each hold the budget of their own project and of no other; and a whole
  run is stopped at its limit with no request beyond it, says why, keeps what it did, and carries on when the
  limit is lifted.
- **Routes and access** (`backend/test/budget-routes.test.ts`, and the matrix in `backend/test/membership.test.ts`):
  what is shown, what is refused (a limit that is not a whole number, a missing or unknown field), and for every
  kind of person whether they may read it, may change it, and are told so. Only a workspace owner or
  administrator may change it; a project lead may not.
- **The page** (`frontend/src/lib/budget.test.ts`, `frontend/src/components/console/BudgetDialog.test.tsx`,
  `frontend/src/api.test.ts`) and a browser test against the fake provider (`e2e/model/budget.spec.ts`): the
  project stops at its budget with the reason, the page says so before it is asked, a limit that is not a
  number is refused in the form, lifting the limit is saved and recorded and the stage runs again, a project
  just short of its limit is warned, and the dialog passes axe in each theme and on a phone.

## Who has access

- **The server** (`backend/test/membership.test.ts`): every project route as every kind of person, the member
  routes and their invariants (the last owner, the last lead, an administrator and an owner), and what the page is
  told it may offer (`may.manage` on a project's member list) checked against what the same people are then
  refused.
- **The page** (`frontend/src/lib/members.test.ts`, `frontend/src/components/console/AccessDialog.test.tsx`,
  `frontend/src/api.test.ts`): the role lists are held to `backend/src/auth/roles.ts` so that the two cannot
  drift, an object ID is accepted only as a UUID and is lower-cased, which roles and which rows each kind of
  person is offered, what each dialog shows, and the requests the client makes.
- **A browser** (`e2e/signin/access.spec.ts`, on the sign-in test server): an owner adds a person by object ID,
  changes their role and removes them, and is refused when removing the last owner; a colleague added to one
  project sees that project and no other, reads who has access and is offered no control, and the server
  refuses what the page withheld; an administrator is offered no way to touch an owner; and both dialogs pass
  axe in each theme on a desktop and on a phone. Showing the People button to a member was seen to fail it.

## PostgreSQL tests

```powershell
npm.cmd run test:postgres                              # the whole unit suite, on PostgreSQL
npm.cmd run test:postgres -- backend/test/session.test.ts   # or some of it
```

`test:postgres` sets `SWARM_TEST_DATABASE=pglite`, which turns every in-memory database in the unit
tests into PostgreSQL running inside the test process ([PGlite](https://pglite.dev)), so the tests that
guard the SQLite stores guard the PostgreSQL ones. CI runs it as a separate job. Three files are
about PostgreSQL itself: `postgres.test.ts` (the SQL translation, the retry of a transaction that
loses a race, and the repository on PGlite), `postgres-driver.test.ts` (the repository through the
real `pg` driver against PGlite behind the PostgreSQL wire protocol, in another process) and
`copy.test.ts` (copying a database each way, with every table compared). None of this reaches a real
server, so TLS, Entra authentication and two instances racing are not covered.

## Backup, rollback and restore

Four files, all in `npm test` (and in `npm run test:postgres`):

- `copy.test.ts` covers `npm run db:copy`: a copy each way between SQLite and PostgreSQL with every table
  compared, nothing kept when a copy fails part-way or the audit chain does not verify, and every kind of
  lab artifact carried with its revision. It also checks that a source that is being written to is read
  as one snapshot. A second connection to the same SQLite file commits a change to a project and its
  actors, or deletes the project, after the first table has been read: the copy holds the moment before,
  whole, and the writer is not held back (before the fix the first copied a project with the actors of
  the moment after, and the second an empty project, both with intact row counts and audit chain). The
  in-process PostgreSQL is one connection, so a concurrent writer cannot be played against it: there the
  test shows what the copy asks of the server (every table read in one read-only repeatable-read
  transaction, on one snapshot), and that PostgreSQL then isolates a writer is PostgreSQL's own
  guarantee, not covered here.
- `storage-backup.test.ts` covers the copy taken before a SQLite file is upgraded: it is kept when the
  file has not changed since (a restart loop does not fill the disk), set aside under a name that says
  when it was last written when the file has (it is never overwritten), and compared block by block.
- `rollback.test.ts` rehearses going back: the release before refuses an upgraded database untouched,
  putting the copy back returns it with its data, and the upgrade can be tried again. It reproduced a
  real defect before the fix: after a rollback and some work, the next upgrade reported the first,
  stale copy as its backup.
- `restore-drill.test.ts` covers `npm run db:drill`: a backup and a restore from the backup alone,
  checked table by table by digest, by the audit chain and by opening every project, from SQLite and
  from PostgreSQL. It checks that a changed cell, a missing row and a rewritten history are noticed,
  that a database in use is read as a snapshot including its write-ahead log, that the digests and the
  backup are of the same snapshot when the database changes meanwhile, and that the database it is run
  on and its folder are not changed.

Restoring a hosted PostgreSQL server to a point in time, and rolling a Container Apps revision back,
have not been rehearsed: they need a deployment.

```powershell
npm.cmd run eval             # the offline evaluation, printed
npm.cmd run eval -- --write  # also rewrite evaluation/results/latest.{json,md}
npm.cmd run eval -- --sweep  # score the abstention gate's thresholds on the dev split
```

The evaluation measures only the deterministic parts (the gate, retrieval, conflict detection, the
deterministic support checks and the injection warnings) against labelled sets pinned to their
sources. `evaluation/test/evaluation.test.ts` runs it as part of `npm test` and fails if a result
drops below `evaluation/thresholds.json`. Its limits are in
[evaluation/README.md](../evaluation/README.md).

Provider tests use explicitly labeled fixture HTTP responses; they do **not**
establish live model connectivity or reasoning quality. Live evidence comes only from
`npm run azure:verify` against a real deployment (see
[AZURE.md](./AZURE.md#live-evidence)).

## Report Studio

Report Studio is tested at four levels, each of which would fail for a different mistake.

- **Rules** (`backend/test/studio-model.test.ts`): what each change to a document allows or refuses,
  as functions of the document alone: states, locks, versions, the revision a decision must name,
  reasons, limits, staleness.
- **Service, routes and storage** (`studio.test.ts`, `studio-access.test.ts`, `studio-regenerate.test.ts`,
  `studio-store.test.ts`): the same through HTTP, with every role and every kind of outsider, the memo
  and exports, the audit entries, migration 7 and the backup it takes. Writing a chapter again runs
  against a provider that speaks the real protocol, which is a test of the code that builds the request
  and checks the answer, not of any model.
- **The page** (`frontend/src/components/studio/studio.test.tsx`, `frontend/src/lib/studio.test.ts`): what
  each state, capability and refusal looks like, including that edited text is shown as written by a
  person and its old statements as describing an earlier text, and that text with markup in it stays text.
- **A real browser** (`e2e/journey/studio.spec.ts` on the demonstration, `e2e/model/studio-regenerate.spec.ts`
  on a model-assisted project made through the fake provider): open the report, edit, compare, lock,
  note, submit, send back, restore, approve, open the memo and check what it says and how it is served,
  export both formats, reopen, read the audit log; a save made on a section someone else changed is
  refused and the page shows their text; the keyboard, focus return and a phone-sized screen; axe-core
  in the light, dark and high-contrast themes on every state of the controls; a chapter written again is
  a proposal that changes nothing until accepted, and a provider that fails leaves the document as it was.

```powershell
npm.cmd run build
$env:PW_CHANNEL = 'msedge'   # locally; CI uses Chromium
npx.cmd playwright test --project=journey e2e/journey/studio.spec.ts
npx.cmd playwright test --project=model e2e/model/studio-regenerate.spec.ts
```

Every browser action in these files has a 30-second limit, so an element that never appears fails with
its locator and does not wait out the test. A regular expression given to Playwright's text locator is
matched against the text as written, spaces included, so a summary that begins with an icon is not found
by `^`; the specs find summaries by string.

## Colour themes

The console has three themes: light, dark and high contrast. Every colour in a stylesheet is a token,
`var(--t-bg-ffffff)`, named for its role (`bg` background, `fg` text, icons and strokes, `bd` borders)
and its light value. `frontend/src/styles/theme-tokens.css` gives each token a value per theme; the dark
and high-contrast values are derived from the light one in OKLab by `scripts/ui/themes.mjs`, so a new
colour needs no hand-picked pair. A derived value that is wrong is corrected in
`frontend/src/styles/theme.css`, which loads after the tokens, and never by editing the generated file.
Colours that charts and the graph draw with from script are custom properties too (`--chart-*`,
`--graph-*`); the only colour literals left in the sources are the browser-chrome colours in
`frontend/src/lib/theme.ts`.

```powershell
node scripts/ui/themes.mjs rewrite   # after writing a hex colour in a stylesheet: turns it into a token
node scripts/ui/themes.mjs tokens    # rewrites theme-tokens.css from the tokens the stylesheets use
node scripts/ui/themes.mjs check     # what the unit tests run: no literals, and the token file is current
```

What guards them:

- `scripts/ui/themes.test.ts` runs the checker on temporary trees: no hex, `rgb()` or `hsl()` colour in a
  stylesheet or a component, a token file that lacks a used token or has a hand-edited value is refused,
  and the real tree passes.
- `frontend/src/test/theme-contrast.test.ts`, `accessibility.test.ts` and `grounding-guards.test.ts`
  resolve every custom property to a colour in each theme and compute the WCAG contrast of text on
  the surface it is declared with: 4.5:1 in light and dark, 7:1 in high contrast, and 3:1 for the parts
  of the charts and the graph. They scan every declared text colour in the stylesheets, which covers
  states a browser test does not visit. A degraded token makes them fail, which was checked by hand.
- `frontend/src/lib/theme.test.ts` covers the rule that picks the theme (a choice beats the device; more
  contrast beats dark beats light; an unknown stored value is ignored) and runs the real pre-paint
  script, `frontend/public/theme-init.js`, against the same cases.
- `e2e/journey/themes.spec.ts` uses a real browser: the page follows a changed device setting without a
  reload, keeps a choice across a reload, works from the keyboard, and axe-core, contrast rule included,
  finds nothing on the entry page, the project page and all five stages in each theme.

What they do not show: the contrast of text on a surface other than the one it is declared with (a rule
without a background is assumed to sit on the page), the Windows forced-colours rules in `theme.css`
beyond one check (`e2e/lab/shell.spec.ts` reads the computed borders that mark the stage in view, the
stages that cannot be opened and the chosen mode, under the browser's emulation of forced colours;
Windows high contrast itself has not been tried), or what a person using a screen reader or a magnifier
makes of any theme.

## End-to-end, accessibility, security and load evidence

```powershell
npm.cmd run build          # the E2E servers run the built output in dist/
$env:PW_CHANNEL = 'msedge' # reuse the installed Edge; CI installs Chromium instead
npm.cmd run test:e2e       # npx playwright install chromium first if you do not use Edge
npm.cmd run audit:ui       # starts its own local-mode server on a free port; screenshots + layout/axe metrics for four viewports (see scripts/ui-audit.mjs)
npm.cmd run test:load       # latency, queue back-pressure, memory, and the newer endpoints, on this machine
npm.cmd run test:resilience # kills a real server mid-simulation, restarts it, and checks the run finishes intact
```

`test:e2e` runs five Playwright projects (`local`, `model`, `journey`, `signin` and `lab`; see
`playwright.config.ts`), each against an application server of its own with a throwaway data
directory (never your own data):

- **`e2e/local`** — the deterministic local engine: the complete guided journey
  (input → graph → environment → simulation → branch with a declared intervention →
  resume → compare → report → citations → interaction → Markdown export → history/delete),
  error conditions (bad/corrupt/oversized uploads, API outage, rate limit, unknown
  project, double click, hostile requests), responsive checks at 1920×1080, 1440×900,
  1366×768 and 390×844 (no overflow, ≥11 px text, ≥24 px targets, unobstructed graph
  nodes, ≥11 px rendered graph/chart text), and **axe-core on every reachable
  state at two viewports with zero violations of any impact** plus keyboard/focus tests.
- **`e2e/model`** — the model-assisted path against a **protocol-faithful fake Ollama
  provider** (`e2e/support/fake-provider.ts`): real Pause clicked while rounds run,
  resume (saved rounds are never requested again), intervention, one provider call
  per proxy per platform per round, injected mid-run provider failure with checkpoint
  recovery, invented-citation rejection, a grounding-checked report, actor chat and
  token accounting. The fake is a test double; it is **not** evidence about any live model.
  `scenario-privacy.spec.ts` watches the provider while a person asks Swarm to read a question into a
  scenario: with the project in Local rules the request says `useModel: false` and the provider is never
  called, and in Model assisted it is called once and the page says that a model read it; changing the mode
  back changes where the next reading goes.
- **`e2e/journey`** — the 32-step presentation (see
  [Presenting Swarm](./demo/presentation.md)), on a server of its own that holds the
  committed real-model recording of the demonstration scenario, with no model. It
  checks every screen for console errors and warnings, failed API calls, credential-shaped
  strings and private cloud hosts, horizontal overflow, endless spinners, axe violations,
  undersized targets and unreadable text, and a guard test plants each of those to prove
  the checks can fail. The same file runs against a live server with a real model:
  `npm run demo:journey` (`JOURNEY_URL`, `JOURNEY_ASK=0`, `JOURNEY_SCREENSHOTS`,
  `JOURNEY_FORBIDDEN`; see `playwright.journey.config.ts`). Its budget is 20 minutes because it
  makes more than a dozen whole-page axe scans, which can take up to a minute each on a machine
  that other work has saturated (it took 6.9 and 11.7 minutes on one such machine, and well under
  two on a CI runner).
- **`e2e/signin`** — browser sign-in with Microsoft Entra, on the real application with Microsoft replaced
  by a test identity provider on a second loopback port
  (`backend/test/support/signin-e2e-server.ts`; Microsoft's own page is never reached, and no real tenant is
  used). `signin.spec.ts`: the redirect with PKCE, no token anywhere the page can read, an HttpOnly session
  cookie, sign-out ending the session on the server, the anti-forgery header, a person with no role, a
  declined sign-in, and a form on another site. `access.spec.ts`: who has access, managed from the page by
  the people who may: an owner adds, changes and removes a person by object ID and is refused when removing
  the last owner; a colleague added to one project sees that project and no other and is offered no control;
  an administrator is offered no way to touch an owner; the dialogs pass axe in each theme on a desktop and a
  phone.
- **`e2e/lab`** — the scenario lab in rules mode (`AI_PROVIDER=none`), through its pages, so that it needs no
  model. The servers are the real application with throwaway data, so the project neither depends on nor
  changes what the others leave behind, and no test in it reaches a page on the real internet. Eleven specs:
  - `shell.spec.ts` — the shell around the lab's features: the first screen (one `h1`, "What could happen
    if…?", the sentence Swarm is never to be read without, the eight-step path, the question field in the
    first viewport), the example picker (never empty; choosing fills the question and the evidence and moves
    focus; keyboard only), Guided and Advanced (the choice is kept, an unknown stored value is ignored), the
    workspace (five stage names with their plain-words help, the twelve-step journey that shows where the
    person is, is not navigation and names every step to a screen reader at desktop and phone width, a
    button that stands alone as wide as its words on a desktop and across the column on a phone, the stage
    in view and the chosen mode drawn by their edge under forced colours, the Interaction agent picker
    saying it holds the deep-dive proxies and not every actor, the project tools, the report stage open for
    the brief and the critics), every control of the lab at 44 px on a phone (the stakeholders, the
    comparison, the brief and the dialogs), and the first screen and a project's workspace under axe,
    contrast, target-size and overflow checks in each theme at 1440 and at 390 px, plus reduced motion.
  - `entry-screen.spec.ts` — the first screen as a person fills it in, at 1440×900 and 390×844, and with a
    phone's keyboard open (390×420): **Build Graph** stays on the screen once the question is long enough,
    beside a line that says what the form still needs or that it is ready, and the field that has focus is
    never left under it; an example that is loaded folds the six cards into one line with **Change example**
    and a way to keep it; the fictional starter loads like any other card and says that it is invented; and
    the choice to use a scenario stays in reach while it is open, with Build Graph in reach after. One theme
    at each of three sizes (light, dark and high contrast) is checked with axe, for overflow and for the
    review's **Use this scenario** button being in view.
  - `intake.spec.ts` — the scenario a person checks and edits before it is used, in a real browser because
    focus cannot be seen any other way: adding an alternative or a change leaves the others as they were and
    names the new one, removing one returns focus to the control that adds, and an edit of the decision is
    used, shown again and stored with the project.
  - `public-page.spec.ts` — **Fetch page** answers in place. It fetches two refused addresses (so it needs no
    network), by the button and by Enter, because the control sits inside the entry form and a form nested in
    a form is not submitted by a real browser the way a page's handlers expect: the answer must appear in
    place, the entry form must keep its question, nothing else may be posted and the page must not navigate.
  - `journey-gates.spec.ts` — what opens each stage. Projects are made through the routes at each point of the
    way (nothing, graph built, stakeholders proposed, approved, actors, a comparison stopped, finished,
    reviewed, brief written) and read in the browser: what is locked and why, the path, the next step and
    where it leads, a comparison started, stopped and finished in the page, and the brief written there, each
    without a reload or a press of Refresh (these fail if the workspace stops looking for the change), Guided
    and Advanced, the keyboard and focus, a reload, and three themes on a laptop and a phone.
  - `stakeholders.spec.ts` — the compact stakeholder review through the real screens, for three examples, from
    the first page to the actors: stakeholders found with the passage each came from (every quote is checked
    to be in the example's own text), a row opened, edited, added, removed and restored, merged and unmerged,
    the list shut so that **Start Simulation** stays on the screen, **Go to approval** (while the list is open
    the bar's action is a shortcut to the approval card's button), approval, the actors with every trait
    labelled by its origin, one changed from the keyboard and kept after a reload. It also runs on a phone and
    a laptop, from the keyboard alone, and in each theme, with axe, overflow, text and target checks in every
    state.
  - `analysis.spec.ts` — the Simulation stage as a person meets it, on seeded projects: the comparison for
    three examples and for a question of the person's own, what it says and must not say (a change that
    cannot move anyone shows only chance), the same numbers when it is repeated on the same seeds, progress,
    cancelling and no partial result, a second or an oversized request refused in a sentence, a comparison that
    the server did not finish (the spec starts a server of its own on a free port, ends it mid-run and starts
    it again, and checks that the page says it cannot read the progress and then that the run was
    interrupted), and the brief and the review made from the newest comparison and called out of date by a
    newer one, at desktop and phone width in each theme.
  - `examples.spec.ts` — the completion test. The same pipeline, through the pages, serves the three
    flagship examples and a question that none of them knows (a congestion charge, with pasted notes and a
    public page), each from the first screen to the exported brief. It checks that the four journeys make the
    same calls and find different stakeholders from different evidence, that a question and its evidence reach
    a labelled brief without a scenario read, what **Add a public web page** says to twelve addresses it will
    not or cannot read (a loopback or private address, the cloud metadata service, a file, a password in the
    address, names that lead inside a network, a page that robots.txt forbids, a page that is not there, a
    site that does not exist) in words, without ever connecting to a private address, with a page that tries
    to run something or to instruct the analysis, and with a page the person then edits (no longer called a
    retrieved page), that editing a source changes the groups found, that the sentences of the comparison and
    the brief say nothing about what will happen and give no rate that is not the simulation's, and that the
    workspace opens **Report** by itself when the comparison finishes. It runs on its own server,
    `backend/test/support/lab-e2e-server.ts`: the real application in rules mode with its data in memory, and
    the real public page reader with every check it has. Only two things around the reader are replaced, as a
    network lab replaces them: the lookup of a name is a table, and the connection goes to a fixture web
    server on this machine. Any other host, and every https request, fails, so the process cannot reach the
    network whatever the checks let through.
  - `deep-dive.spec.ts` — the engine's own stages (**Prepare environment**, **Start Simulation**, **Generate
    Report**) run on the key actors a person approved, with no model, and the report they write sits below the
    decision brief.
  - `report-page.spec.ts` — the Report stage as a page to read: it opens on the executive answer with the
    reference sections closed and every section still listed in the contents and still in the page, the
    page is under 60 % of the height it has with everything open, a section opens and closes from its heading
    by keyboard, a link, an address (`#brief-<id>`, `#brief-<number>`) and **Expand all sections** open a
    closed section before they scroll to it, the **Jump to** bar sticks under the header and leads to the
    brief, the independent review (saying what is not yet closed, from the one read the page makes) and the
    detailed report without covering them at desktop, laptop and phone size, and printing (the browser's
    PDF, read back as text) holds the whole brief whatever is closed on the screen, the review, no
    application chrome and no second copy of a chart as a table, while the other stages print as they did.
    It also runs axe with the reference closed and open, in one theme at each of three sizes.
  - `freshness.spec.ts` — what is out of date, in a real browser: **Refresh project from server** shows a
    criticism answered in another tab and the brief out of date, shows stakeholders changed elsewhere and asks
    for the comparison to be run again, and running it again and writing the brief again brings the page
    up to date; on one page, answering a criticism makes the brief beside it say that it may be out of date,
    and a response written about a review that has since changed is refused, the review is read again and
    the words are kept.

The suite sets `RATE_LIMIT_SCALE=100`; the production limiter itself is tested in
`backend/test/security.test.ts` (including that a genuinely rate-limited request
returns HTTP 429 `RATE_LIMITED` with `Retry-After`).

### Running one project, and the ports

Playwright starts every server in `playwright.config.ts` even when you select one project, because the
servers are listed once for the whole run. Each listens on a port that an environment variable can move,
which is how two runs on one machine, or a run beside your own server, avoid each other:

| Variable                   | Default                | What listens there                                                                                                              |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_LOCAL_PORT`           | 3111                   | The application for the `local` project (rules mode)                                                                            |
| `E2E_MODEL_PORT`           | 3112                   | The application for the `model` project (`AI_PROVIDER=ollama`, the fake)                                                        |
| `E2E_JOURNEY_PORT`         | 3113                   | The application for the `journey` project (rules mode, the recording)                                                           |
| `E2E_SIGNIN_PORT`          | 3114                   | The application for the `signin` project, with sign-in switched on                                                              |
| `E2E_SIGNIN_IDP_PORT`      | 3115                   | The test identity provider that the `signin` project signs in against                                                           |
| `E2E_LAB_PORT`             | 3116                   | The application for the `lab` project (rules mode)                                                                              |
| `E2E_LAB_WEB_PORT`         | 3117                   | The application for `e2e/lab/examples.spec.ts`: rules mode, data in memory, and a web of fixture pages to fetch                 |
| `E2E_LAB_WEB_FIXTURE_PORT` | 3118                   | The fixture web server on this machine that the connections to those pages end on                                               |
| `E2E_PROVIDER_PORT`        | 11999                  | The fake Ollama-protocol provider that the `model` server talks to                                                              |
| `E2E_DATA_ROOT`            | a new temporary folder | The folder that holds one throwaway data directory for each server (created for the run, and inherited by Playwright's workers) |

`E2E_LAB_WEB_URL` and `E2E_LAB_WEB_FIXTURE_URL` are worked out from the two ports above for the workers (the
examples spec reads them), and you do not set them.

```powershell
npm.cmd run build   # the servers run the built output in dist/
$env:E2E_LOCAL_PORT = 3280; $env:E2E_MODEL_PORT = 3281; $env:E2E_JOURNEY_PORT = 3282
$env:E2E_SIGNIN_PORT = 3283; $env:E2E_SIGNIN_IDP_PORT = 3284; $env:E2E_LAB_PORT = 3285
$env:E2E_LAB_WEB_PORT = 3286; $env:E2E_LAB_WEB_FIXTURE_PORT = 3287; $env:E2E_PROVIDER_PORT = 3288
npx.cmd playwright test --project=lab e2e/lab/shell.spec.ts
```

Set all nine ports, not only the one for your project, when another run may be using the defaults:
a port that is already taken stops the whole run before a test starts, because the config does not reuse
a server that is already up. `PW_CHANNEL=msedge` reuses the installed Edge, and `CI` adds one retry and
the HTML report.

Automated checks do not replace a manual assistive-technology review (screen reader,
200 % zoom, forced colors), which has not been done. `scripts/load-test.mjs`
reports numbers for the machine it runs on; see
[requirements-matrix.md](./requirements-matrix.md) for the measured results and
their limits.

### Load, and a killed process

`npm run test:load` starts a server of its own (local rules engine, no model, throwaway data) and reports
latency percentiles, queue back-pressure (`QUEUE_FULL` rejections are the queue refusing work, not
errors), memory and 5xx counts for health and listing reads, 40 creations and 12 whole workflows. It then
exercises, on the projects those workflows finished, the evidence ledger (first build and repeated reads),
the model budget, the audit log and Report Studio (opening, reading, the printable memo), and has **eight
people save the same section from the same version at once**: exactly one must be accepted and seven told
the section changed, with no failure. It fails on a 5xx, a failed workflow or any other outcome of that
race. One run on a Windows laptop with Node 24 (the numbers are for that machine and say nothing about a
deployment): 3,000 health reads at 64 at a time took 35 ms at the median and 76 ms at the 95th
percentile, 3,000 budget reads 30 ms and 49 ms, 600 ledger reads at 32 at a time 149 ms and 177 ms,
150 memo exports at 8 at a time 170 ms and 220 ms, 12 whole workflows finished in 20 s with 93
back-pressure refusals, there were no 5xx, the race gave one winner and seven told, and the server
peaked at 358 MB. Browser sign-in is not exercised, a model is not called, and nothing was run for
longer than a minute.

`npm run test:resilience` is the crash-recovery rehearsal, on real processes and with no simulation of
the failure: it starts the built server and the fake provider, runs a model-assisted guided project
(6 proxies, 8 rounds, two platforms) to the simulation, ends the server with **SIGKILL** after three
rounds are saved and while the next round's model calls are in flight, starts it again on the same
data, and leaves the run alone. It checks that the restart does not mark the run failed, that the run
finishes by itself once the dead process's lease runs out, that each platform holds all 8 rounds with one
action per proxy per round and none twice, that no saved round was asked of the model again (only the
round that was under way, whose in-flight calls never reached the server), that the model budget counted
the calls on both sides of the kill and none twice, that the job was taken again (attempt 2) and
completed, and that the audit chain verifies. On the same laptop: 96 actions, 96 distinct; 4 of the 96
actor calls asked twice, all for round 4; budget 100 counted of the 104 the provider answered (4 in flight
when the process died); finished 18 s after the restart. It uses SQLite and one process at a time. It
does not show two containers sharing a PostgreSQL server (the in-process PostgreSQL cannot be shared by
two processes), a worker killed while an API process lives, or anything about a deployment.

Useful focused commands:

```powershell
npm.cmd test -- backend\test\local.test.ts backend\test\knowledge.test.ts
npx.cmd vitest run backend/test/lab-journey.test.ts backend/test/lab-pipeline.test.ts   # the lab, no model
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format
```

CI (`.github/workflows/ci.yml`) runs, with `AI_PROVIDER=none`: `npm run check`, `format:check`,
`npm audit --audit-level=high`, `scan:secrets`, a Playwright install of Chromium and `npm run test:e2e`
(all five projects), Compose validation, and an actual Docker build with a health, UI and
`smoke:console` check inside the container (PDF parsing and the full staged local workflow included).
A second job runs `npm run test:postgres`. It does not run the mutation checks, the load and
resilience tests, the UI audit, `azure:verify` or the live `demo:journey`. Local Docker image execution
requires a running engine and is separate from native validation.

Run the same real HTTP smoke flow against a local **0.3.0** backend:

```powershell
npm.cmd run smoke:console -- http://127.0.0.1:3001
```

It creates its own fictional PDF/scenario, verifies every gated stage and both
platforms, checks a real report/state survey, and deletes that scenario on success.
It never selects a model or spends provider quota. On failure, a scenario may remain
for diagnosis; the container CI removes its own container in all cases.

## Capabilities and what exercises them

Moved here from the README. Each row is something a person can do in the console's engine stages,
with the tests that exercise it. A capability is listed only if a test drives it. The lab's own tests
are in [The scenario lab](#the-scenario-lab) above, and what is not built is in
[ARCHITECTURE.md](../ARCHITECTURE.md#known-limitations).

| Capability                             | What you can do                                                                                                                                                                                                                                                                       | Exercised by                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source-grounded graph                  | Read numbered passages, inspect every entity and relation with its verified quote, browse and search the evidence                                                                                                                                                                     | `knowledge.test.ts`, `grounding-quotes.test.ts`, `pdf.test.ts`, `e2e/local/journey.spec.ts`                                                                                           |
| Evidence ledger                        | Filter statements by type and support class, open a statement's supporting and contradicting passages, confirm or dismiss conflicts, see the assumptions behind simulated results                                                                                                     | `ledger.test.ts`, `ledger-service.test.ts`, `contradictions.test.ts`, `e2e/local/ledger.spec.ts`, `e2e/model/ledger-ui.spec.ts`                                                       |
| Fictional actors (engine)              | Read each proxy's profile and assumed traits; edit them before a run, or on a branch before it is resumed; records are read-only afterwards                                                                                                                                           | `actor.test.ts`, `guided.test.ts`, `e2e/local/journey.spec.ts`                                                                                                                        |
| Multi-round simulation                 | Configure rounds and platforms, replay a run, read each decision with its stated reason, filter by proxy and round, pause and resume                                                                                                                                                  | `guided.test.ts`, `guided-model.test.ts`, `whatif.test.ts`, `e2e/local/whatif.spec.ts`                                                                                                |
| Intervention, branches, compare        | Schedule an assumed intervention, branch from a checkpoint with declared edits, compare a branch with its parent or sibling                                                                                                                                                           | `whatif.test.ts`, `whatif-model.test.ts`, `e2e/local/whatif.spec.ts`                                                                                                                  |
| Grounded report                        | Read a chaptered report with a grounding review: verdicts, the checks that ran, and what the server repaired or withheld                                                                                                                                                              | `grounding-*.test.ts`, `report-plan.test.ts`, `e2e/model/grounding-ui.spec.ts`                                                                                                        |
| Report Studio                          | Open the generated report as a document and work on it: versions, locks, reviewer notes, submit, approve or send back with a reason, reopen, write a chapter again and accept or reject it, export Markdown, JSON and a printable memo. The generated report is never changed         | `studio-model.test.ts`, `studio.test.ts`, `studio-access.test.ts`, `studio-regenerate.test.ts`, `studio-store.test.ts`, `studio.test.tsx`, `e2e/journey/studio.spec.ts`, 25 mutations |
| Analyst chat with abstention           | Ask a question the sources answer (cited, with a note when a source it cites is disputed by another) and one they do not (exact refusal sentence, no model call)                                                                                                                      | `evidence-gate.test.ts`, `model-workflow.test.ts`, `evaluation/test/evaluation.test.ts`, `e2e/model/model.spec.ts`                                                                    |
| Actor chat and survey                  | Ask one fictional proxy a question, or survey all of them, against what that proxy was given                                                                                                                                                                                          | `model-workflow.test.ts`, `e2e/model/model.spec.ts`                                                                                                                                   |
| Export and audit                       | Export Markdown and JSON; read and verify the append-only, hash-chained audit log                                                                                                                                                                                                     | `audit-trail.test.ts`, `storage.test.ts`, `snapshot.test.ts`, `e2e/journey/demo-journey.spec.ts`                                                                                      |
| Themes                                 | Choose light, dark or high contrast in the header, or follow the device; the choice is kept and applied before the page is drawn                                                                                                                                                      | `theme.test.ts`, `theme-contrast.test.ts`, `accessibility.test.ts`, `scripts/ui/themes.test.ts`, `e2e/journey/themes.spec.ts`                                                         |
| Identity and access                    | Sign in with Microsoft in the browser (PKCE, a server-side session, no token in the page) or call with an Entra bearer token; seven roles through workspace and project membership; default-deny routes; tenant isolation; People and Access screens (tested against a test provider) | `auth.test.ts`, `membership.test.ts`, `session.test.ts`, `AccessDialog.test.tsx`, `e2e/signin/signin.spec.ts`, `e2e/signin/access.spec.ts`, `security.test.ts`, 9 access mutations    |
| Real Azure AI, no key                  | Run every engine stage against an Azure model deployment with Entra authentication                                                                                                                                                                                                    | `npm run azure:verify` (15 checks), `scripts/azure/lib/*.test.ts`                                                                                                                     |
| PostgreSQL storage (optional)          | Run the same stores on PostgreSQL (`DATABASE_URL`), with serializable transactions retried when they lose a race; copy a database between SQLite and PostgreSQL in either direction, checked                                                                                          | `postgres.test.ts`, `postgres-driver.test.ts`, `copy.test.ts`, `npm run test:postgres`                                                                                                |
| Durable stage jobs                     | A refresh or a restart does not lose a run: stages are queued in the database, taken under a lease, retried a bounded number of times, resumed from the last saved round, cancelled or paused from any process; the same `Idempotency-Key` is one job                                 | `jobs.test.ts`, `durable-jobs.test.ts` (each also on PostgreSQL), 19 job mutations                                                                                                    |
| Observability                          | A correlation id on every answer; OpenTelemetry spans and metrics with a gate that keeps content, headers and credentials out; export to Application Insights signed by Entra (tested with in-memory exporters)                                                                       | `telemetry.test.ts`, `telemetry-start.test.ts`, 9 telemetry mutations                                                                                                                 |
| Model budget per project               | A budget of model calls and tokens for each project: the deployment sets a default and only a workspace owner or administrator changes one project's limits; the next call is refused before anything is sent once it is used                                                         | `usage.test.ts`, `model-budget.test.ts`, `budget-routes.test.ts`, `membership.test.ts`, `BudgetDialog.test.tsx`, `e2e/model/budget.spec.ts`, 17 budget mutations                      |
| Backup, rollback and restore rehearsal | A SQLite file is copied before an upgrade and a copy that is out of date is set aside, never overwritten; the release before refuses an upgraded database; `npm run db:drill` proves a restore from the backup alone                                                                  | `rollback.test.ts`, `storage-backup.test.ts`, `restore-drill.test.ts`, 12 storage mutations                                                                                           |
| Recorded demonstration                 | Restore a real-model recording of one scenario and two branches, and walk the 32-step presentation in a real browser                                                                                                                                                                  | `scripts/demo/lib/*.test.ts`, `e2e/journey/demo-journey.spec.ts`                                                                                                                      |
| Accessibility checks                   | Use the console by keyboard; axe-core finds no violation on the audited screens at four viewport sizes                                                                                                                                                                                | `e2e/local/a11y.spec.ts`, `e2e/local/responsive.spec.ts`, `npm run audit:ui`                                                                                                          |

## Results recorded on earlier trees

Moved here from the README, with their dates. These are numbers from runs on the tree **before the
scenario lab was added**: the unit suite and the browser suite have grown since, and these figures have
not been recorded again. Re-run the commands for today's result; none of this shows that a model's
output is correct, that any scenario predicts the real world, that a manual screen-reader review has
been done (it has not), that sign-in works against a real Entra tenant, or that Swarm is ready for
production.

<!-- TEST COUNTS: the next three rows (npm run check, npm run test:e2e, npm run test:postgres) hold the recorded counts. Replace them after a full run on the integrated tree, and say which tree and date. -->

| Check                                                    | Command                     | Result recorded then                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types, lint, unit and integration tests, build           | `npm run check`             | Passed: 1,925 tests in 112 files (Vitest), strict typecheck of five projects, ESLint with zero warnings                                                                                                                                                                                                                             |
| Formatting                                               | `npm run format:check`      | Passed                                                                                                                                                                                                                                                                                                                              |
| Browser end-to-end tests                                 | `npm run test:e2e`          | 143 passed, 0 failed, 0 flaky (Edge on Windows, 23.0 minutes; CI runs Chromium on Linux): 71 against the local engine, 39 model-assisted against a protocol-faithful fake provider, 20 for the 32-step presentation, and 13 for browser sign-in and access against a test identity provider, with axe-core on every reachable state |
| Unit tests on PostgreSQL                                 | `npm run test:postgres`     | The same 1,925 tests on PGlite: all passed. The real driver is also tested over the wire protocol; no deployed server has been used                                                                                                                                                                                                 |
| Mutation checks on the access, sign-in, storage and more | `npm run mutation:security` | 150 of 150 mutations caught in one run (19 minutes): 15 membership, 27 sign-in, 22 storage, 19 job, 9 telemetry, 25 studio, 7 analyst, 17 budget, 9 access screens. See [Mutation checks on security code](#mutation-checks-on-security-code)                                                                                       |
| Load on one machine                                      | `npm run test:load`         | One Windows run of 44 s: no 5xx, 3,000 health reads at p95 76 ms, 600 ledger reads at p95 177 ms, a burst of 12 workflows held back with `429 QUEUE_FULL`, peak memory 358 MB, eight simultaneous saves of one section with one accepted. Not a capacity claim. See [Load, and a killed process](#load-and-a-killed-process)        |
| A server killed mid-simulation                           | `npm run test:resilience`   | 9 of 9 checks in two runs: the run finished by itself 22 s and 18 s after the restart, every platform had every round, 96 actions and none twice, saved rounds were not computed again, the budget counted both sides of the crash and the audit chain verified. SQLite, one machine, a stand-in provider                           |
| Backup and restore rehearsal                             | `npm run db:drill`          | On the demonstration database (409 rows, 11 tables, 9 projects): backed up in 0.25 s, restored from the backup alone in 0.24 s, and every table, the audit chain and every project came back identical. Restoring a hosted server from a point-in-time backup has not been rehearsed                                                |
| The presentation against a real model                    | `npm run demo:journey`      | Passed twice against the live server with the real Azure model (7.6 minutes each): once reading the recorded conversation, once asking the analyst and an actor new questions while checking that five private values appear on no page. A negative control made it fail as intended                                                |
| Real Azure AI, Microsoft Entra only                      | `npm run azure:verify`      | 15 of 15 checks passed in 467 s with 59 round trips: every stage, per-proxy decisions, verbatim quotes, grounding, branching, both chats, an injection probe and a scan for credentials                                                                                                                                             |
| Dependency audit                                         | `npm audit`                 | On 2026-10-31, through a corporate registry mirror: 0 high or critical and 14 moderate, all from two advisories published the day before (`minimatch`, and `glob` reached only through `@fastify/static`), neither reachable from a request. CI fails on high or above. A point-in-time result                                      |
| Secret scan, every reachable commit                      | `npm run scan:secrets`      | 0 findings (933 history blobs and 483 working-tree files at that run); no `.env` tracked. One history blob that holds only fake credentials made up for a redaction test is accepted by its hash, because history is not rewritten                                                                                                  |
| Offline evaluation                                       | `npm run eval`              | Every floor in `evaluation/thresholds.json` held: the analyst's gate refused no answerable question and 43% (dev) and 86% (test) of unanswerable ones, 1 of 3 labelled conflicts was found, injection warnings caught 80% of 18 labelled samples (in-sample). See [evaluation/README.md](../evaluation/README.md)                   |
| UI audit at four viewports                               | `npm run audit:ui`          | 44 states: 0 console errors, 0 axe violations, no overflow, small text, small targets, unnamed controls or label collisions, and a visible focus indicator on every Tab stop                                                                                                                                                        |
| Container build and health                               | CI                          | Builds, answers its health check and serves the UI, and the console smoke flow passes inside it                                                                                                                                                                                                                                     |
