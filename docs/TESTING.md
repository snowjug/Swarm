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
demonstration packs (`demos.test.ts`) and the front end's guards, which include one against raw-HTML and
dynamic-code sinks (`frontend/src/test/ui-guards.test.ts`). The job queue has two files: `jobs.test.ts` drives the queue rules directly (claims, leases, retries, poison, cancel, pause, the lease fence on repository writes), and `durable-jobs.test.ts` drives the orchestrator with a scripted model and a clock the test sets: a stalled worker, a crash, a stopped backend, cancel and pause from another process, retries, idempotency and branch lineage. Both run on PostgreSQL as part of `npm run test:postgres`. Report Studio has five files: `studio-model.test.ts` drives its rules as pure functions of a document, `studio.test.ts` drives the service and routes over HTTP (the memo, the exports, the audit entries, a report that has been replaced), `studio-access.test.ts` drives every studio route as every kind of caller against the test identity provider, `studio-regenerate.test.ts` runs writing a chapter again against a provider that speaks the real protocol (including hostile instructions and concurrency), and `studio-store.test.ts` covers the store, migration 7 and its backup. The built console is tested as it is served: `static-assets.test.ts` runs `scripts/precompress.mjs` on a fixture (a Brotli and a gzip copy beside each text asset that gets smaller, and nothing else, and nothing compressed twice, and a second run over the same folder that neither fails nor compresses its own copies) and the server over HTTP (the copy the browser accepts, with the original type, the security headers and `Vary: Accept-Encoding`, and a dotfile still refused). Security-critical rules, the queue's rules and the studio's rules are mutation-checked, as described next.

Commands are written for Windows PowerShell (`npm.cmd`, which avoids the script-policy problem without
changing it); on macOS and Linux write `npm`. Run a focused part of the unit suite with
`npx vitest run <file or pattern>` and a focused browser run with
`npx playwright test --project=<name> <spec file>`.

## Test layers at a glance

| Layer                    | Command                                | Where                                                                          | Establishes                                                                                                                                                                                                                                                           | Does **not** establish                              |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Types, lint, unit, build | `npm run check`                        | `backend/test`, `frontend/src`, `evaluation/test`, `scripts/**` tests          | Business rules, contracts, state machines, security boundaries, the lab pipeline on the real engine                                                                                                                                                                   | Browser rendering, real networks, any live model    |
| Formatting               | `npm run format:check`                 | The whole repository, documents included                                       | Prettier formatting of code and docs                                                                                                                                                                                                                                  | Anything about behaviour                            |
| Unit suite on PostgreSQL | `npm run test:postgres`                | The same files, with every in-memory database made a PostgreSQL one (PGlite)   | The stores behave the same on both dialects                                                                                                                                                                                                                           | A deployed PostgreSQL server                        |
| Browser, `local`         | `npm run test:e2e`                     | `e2e/local`                                                                    | The shell and its command palette, the three themes, reduced motion, errors, responsive layout, axe, keyboard                                                                                                                                                         | Model behaviour                                     |
| Browser, `model`         | `npm run test:e2e`                     | `e2e/model`, against `e2e/support/fake-provider.ts`                            | Orchestration of the model path, budget, grounding and chapter regeneration; that a question is read by a model only when the project is Model assisted                                                                                                               | The quality or safety of a live model               |
| Browser, `journey`       | `npm run test:e2e`                     | `e2e/journey`, on a server holding the recorded Larkholm demonstration         | The 26-step presentation, the recorded run's detailed report and branch comparison, the demonstration screens at five sizes                                                                                                                                           | A live model (see `npm run demo:journey`)           |
| Browser, `signin`        | `npm run test:e2e`                     | `e2e/signin`, on `backend/test/support/signin-e2e-server.ts`                   | Browser sign-in and access management against a test identity provider                                                                                                                                                                                                | A real Microsoft Entra tenant                       |
| Browser, `lab`           | `npm run test:e2e`                     | `e2e/lab`, on rules-mode servers of their own, one with a web of fixture pages | The lab through its pages: the first screen, Ground, Map, the journey from question to brief, the simulation and comparison, what opens a scene, the decision brief, its review and its print, Report Studio, the detailed report, what is out of date, the deep dive | Model behaviour, or any page on the real internet   |
| Live presentation        | `npm run demo:journey`                 | `e2e/journey/demo-journey.spec.ts` against a server you started                | The recorded presentation against the real model that will be shown                                                                                                                                                                                                   | Anything in the lab, which it does not visit        |
| Offline evaluation       | `npm run eval`                         | `evaluation/`                                                                  | The gate, retrieval, conflicts and injection warnings against labelled sets                                                                                                                                                                                           | Anything on real documents                          |
| Mutation checks          | `npm run mutation:security`            | `scripts/mutation`                                                             | That the tests for security rules fail when a rule is broken                                                                                                                                                                                                          | That the rules are right                            |
| Load and crash recovery  | `npm run test:load`, `test:resilience` | `scripts/`                                                                     | Latency, back-pressure, memory and recovery on this machine                                                                                                                                                                                                           | Capacity of any deployment                          |
| UI audit                 | `npm run audit:ui`                     | `scripts/ui-audit.mjs`                                                         | Screenshots and layout and axe metrics at five viewports in light and dark                                                                                                                                                                                            | Design quality                                      |
| Live Azure verification  | `npm run azure:verify`                 | `scripts/azure`                                                                | Fifteen checks of the whole engine journey against your own deployment                                                                                                                                                                                                | Quality beyond the counts it reports                |
| Secret scan              | `npm run scan:secrets`                 | `scripts/secret-scan.mjs`                                                      | No credential shape in any reachable commit or in the working tree                                                                                                                                                                                                    | That none exists in a form the patterns do not know |

## The scenario lab

Every piece of the lab has its own unit tests, and one test walks them together. They all run on the
rules engine with no model, and none reaches the network (a test that reads a page serves it from this
machine).

| What                                           | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reading a question into a scenario             | `scenario-parser.test.ts`, `scenario-model.test.ts`, `scenario-routes.test.ts`, `frontend/src/scenes/ask/ask.test.tsx`, `ask.interaction.test.tsx` (what a person's actions do: asking for a reading, `useModel`, adding, removing and editing what was read), `frontend/src/lib/intake.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Public web evidence                            | `url-policy.test.ts`, `url-fetcher.test.ts`, `url-robots.test.ts`, `url-extract.test.ts`, `url-normalize.test.ts`, `url-provenance.test.ts`, `url-route.test.ts`, `url-limiter.test.ts` (the limit on pages read at once by the whole server, and `503 URL_BUSY`), `url-config.test.ts`, `url-upload.test.ts`, `url-server.test.ts` (the fixture web server of these tests listens on loopback addresses only), `frontend/src/hooks/useUrlEvidence.test.ts`, and the page named in a question, the web-page way of the evidence menu and an edited page in `frontend/src/scenes/ask/ask.test.tsx` and `ask.interaction.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Sources attached to a question                 | `frontend/src/scenes/ask/useEvidence.test.tsx` (sources attached in the same moment are all kept, a pasted source added while a file is read stays, a source taken away or corrected while a file is read is not brought back or lost, a file that no longer fits once it has been read is refused and what filled the room stays; a page the server fetched is attached and the answer says so, is not attached past what a project or the sources together may hold, and is counted with the pages and pasted texts attached in the same moment)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Source conflicts and text that instructs an AI | `contradictions.test.ts` (the conflicts between sources, and the bounds of the scan: a word held by too many sentences is not read, a sentence is compared with a limited number of partners), `injection.test.ts` (the detector behind the notes on a page, a source, a question and the stakeholder step)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Stakeholders and actors                        | `stakeholders-discover.test.ts`, `-tone`, `-review`, `-actors`, `-environment`, `-routes`, `-packs`, `-neutrality`, `-noise`, `-speed` and `-docs` (all `stakeholders-*.test.ts`), `frontend/src/scenes/map/*.test.ts(x)` (the model, and a person's actions on the list and on a party), `frontend/src/lib/stakeholders/review.test.ts` and `frontend/src/viz/ecosystem/*.test.ts(x)` (the picture)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The population simulator                       | `simulation-engine.test.ts`, `-calibration`, `-chain`, `-random`, `-response`, `-explain` (an earlier event is listed as a cause only where the same seed without it shows it was needed) and `-neutrality` (all `simulation-*.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Repeated runs, findings, sensitivity           | `analysis-runset.test.ts`, `analysis-findings.test.ts`, `analysis-sensitivity.test.ts`, `analysis-stats.test.ts`, `analysis-routes.test.ts`, `signal.test.ts`, `frontend/src/lib/analysis.test.ts`, `frontend/src/scenes/compare/*.test.ts(x)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The simulation's screens                       | `frontend/src/scenes/simulate/model.test.ts` (the colour scale of a run, the replay of the run kept in detail, what happens in a round, what a running simulation has done), `pages.test.tsx` (the story of a simulation that kept no run in detail says there is nothing to watch and which views are not offered), `running.test.tsx` (a screen that has not begun says it is waiting and not that it is running, runs are counted as they are saved, a stop waits for the run in progress) and `engineOnly.interaction.test.tsx` (a run the engine made on its own opens in the deep dive for every view, never says there are no actors and has no way back to a comparison it does not have; a project the lab holds something for is left as it was)                                                                                                                                                                                                                                                                                                                                                                                       |
| The stage: the scrubber and the dock           | `frontend/src/scenes/simulate/scrubber.interaction.test.tsx` (the slider is named and says where it is in words, steps by the arrows and the page keys, jumps with Home and End and is set by a press; playing, pausing, playing again, stopping when the person steps, the speed, and never playing for a person who asked for less motion) and `dock.test.tsx` (the dock is only the controls on a wide screen and one line that opens on a narrow one; what is folded away is out of the tab order and the reading order until it is opened; the card beside the picture is a named region)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The deep dive                                  | `frontend/src/scenes/simulate/deep/render.test.tsx` (the deep dive by where the run stands: nothing prepared, ready, running, paused, stopped, cancelled and finished; the parent of a branch and every declared change; a quick run as it was saved, with no platform invented; the controls off when the staged record did not come back), `model.test.ts` (how numbers are said, where the run stands, what may be done, progress from saved rounds only), `validation.test.ts` (the environment as it is edited, a scheduled event and a branch, each flagged in its own field with the limit and not a schema message), `chart.test.ts` (the geometry of the charts) and `frontend/src/lib/whatIf.test.ts` (the checkpoint and branch guards: pause is not an error, recovery needs a real checkpoint, an event only in a future round, branch bounds and duplicate rows, declared changes said without causal words)                                                                                                                                                                                                                       |
| The comparison's screens                       | `frontend/src/scenes/compare/scene.test.tsx` (the finished comparison leads with what the runs show, has every part addressable, gives every chart a text alternative and its numbers as a table and never calls a share a probability; a change that cannot move anyone claims nothing about it; a change that can move members though nobody is set as helped or harmed says where the differences come from; one scenario alone; every state says what it means and never overclaims), `model.test.ts`, `movement.test.ts`, `pair.test.ts`, `scenarios.test.ts` (one scenario set against another, paired by seed), `runs.test.ts` (the recorded runs that can be compared and two runs coming apart, with no value filled in that was not recorded) and `engineOnly.test.tsx` (the comparison of a run the engine made on its own opens on its recorded runs for every view; a project the lab holds a comparison for, or one with no rounds, is left alone)                                                                                                                                                                                 |
| Which comparison is on show                    | `frontend/src/hooks/useAnalysis.interaction.test.ts` (the comparison chosen last is on show whatever order the server answers in, an earlier failure is silent, a replaced choice stops being read, nothing of a project that was left is shown, and one just started stays on show) beside `useAnalysis.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The tools for the detailed report              | `frontend/src/scenes/decide/model/report-tool.test.ts` (the studio is offered only for a report that is written, to a reviewer as well; one that is not written is offered to be written wherever the deep dive stands, and offered again when it stopped before anything was kept; nothing for a role that cannot write it or a record that cannot make one; a report being written, or stopped part-way, leads to what was kept), the tools in `frontend/src/scenes/decide/scene.test.tsx`, `frontend/src/scenes/decide/model/model.test.ts` (the notes on how a review was made: the ones that speak of conflicts between the sources are found) and the studio with no report in `frontend/src/scenes/studio/scene.test.tsx` (it offers to write it and says what that costs, says who can to someone who cannot, leads to the deep dive when the report cannot be written before it, shows how far the writing has got with a way to stop it, says why it stopped, and says that the report is written while it reads)                                                                                                                      |
| Independent critics                            | `critics-rules.test.ts`, `critics-model.test.ts`, `critiques-routes.test.ts`, `frontend/src/lib/critics.test.ts` (how a review is summarised, grouped and led, and when it is out of date), `frontend/src/scenes/decide/model/model.test.ts` (the review's standing as the brief says it, and where a criticism stands in the document), `frontend/src/hooks/useCritiques.test.ts` (a response says which review it answers, and what the page does when the server says it changed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The decision brief                             | `brief-build.test.ts`, `brief-rules.test.ts`, `brief-text.test.ts`, `brief-signal.test.ts` (including the undirected state: the first doubt, the do-not-decide recommendation and the direction check first), `brief-measures.test.ts` (the paired headline measure: pairing by seed and not by position), `brief-export.test.ts`, `brief-routes.test.ts`, `brief-neutrality.test.ts`, `brief-packs.test.ts` (what the brief says for the example packs on the real engine: the paired share first, the advice on the actors the runs name, a plan of checks that belongs to its pack), `brief-size-limit.test.ts` (a comparison of the largest size a person may ask for, whose per-run detail is dropped to fit: the brief reads what was kept and never reads a missing result as no members), `wording-guards.test.ts`, `frontend/src/scenes/decide/scene.test.tsx` (the first screen and the states before there is a brief, the document and the review in it) and `frontend/src/scenes/decide/model/model.test.ts` (the answer the page leads with, which chapters open by default, which chapter an address names, what the charts need) |
| Storage and progress                           | `artifacts.test.ts` (the store, both dialects, copy and restore), `lab-progress.test.ts`, `lab-fixtures.test.ts`, `lineage.test.ts` (what each document was made from: a comparison records the scenario, stakeholders and actors it ran on, a stale cast cannot start one, the brief and the review say when they predate a change, an exported brief carries that, and a response to a review that has changed is refused)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The workspace around the lab                   | `frontend/src/lib/console.test.ts` (what opens each stage, what it says when locked, the journey, the next step, the view each stage opens in), `frontend/src/app/scenes.test.ts` (what opens each scene, what the journey says of it, where a project opens, a run the engine made on its own), `frontend/src/app/commands.test.ts` and `palette.interaction.test.tsx` (the command palette), `frontend/src/panels/panels.test.tsx` (the overlays: history, the audit log, the budget, who has access, the provider, the sign-in problem and the error boundary), `frontend/src/scenes/ask/ask.test.tsx` (the examples, in an order that leads with no company, and what each brings), `frontend/src/lib/audit.test.ts` (every action the backend records has a plain label), and `frontend/src/hooks/useLabRefresh.test.ts` and `useAnalysis.test.ts` (the page reads what the server did, without a reload)                                                                                                                                                                                                                                   |
| Leaving work that is not saved                 | `frontend/src/app/unsaved.test.tsx` (a way out goes at once when nothing is held; otherwise it asks first, says what would be lost and stays on Keep editing, which has focus; Leave anyway goes on; it stops asking once the scene lets go; and the browser is asked to confirm closing the tab only while work is held) and `frontend/src/scenes/studio/leaving.interaction.test.tsx` (the studio asks before the ways out that only change the view: the detailed report, from its header and from the menu of a phone, the bar of the brief and its own way back, and each goes where it was asked to go; the shell asks for its own ways out with the studio's words, once; the question follows the count of sections that hold words; nothing is asked when words were saved or put back; and the browser is warned while words are not saved and no longer once they are)                                                                                                                                                                                                                                                                |
| The whole path                                 | `lab-pipeline.test.ts` (comparison, review and brief joined by the real engine) and `lab-journey.test.ts` (every route a person uses, from the question to the brief, for each example and for a question that no example knows, then repeated to show the same findings)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The example packs                              | `example-packs.test.ts` (the readable copies match `shared/examples`; which source conflicts the ledger finds) and `frontend/src/lib/examples.test.ts` (sizes, labels, provenance, nothing predicted)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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
rules-mode servers (`AI_PROVIDER=none`) of their own and reaches no page on the real internet. Its twenty-two
specs are described under [End-to-end, accessibility, security and load
evidence](#end-to-end-accessibility-security-and-load-evidence). `ask-pipeline.spec.ts` walks the flagship
demonstrations and a question that no example knows, with a public page as evidence, through the question,
Ground and Map; `journey.spec.ts` walks one question from the first screen to the decision;
`lab-journey.test.ts` walks the same path through the routes the pages use, on the real engine and with no
browser.

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
- **The page** (`frontend/src/lib/budget.test.ts`, `frontend/src/panels/panels.test.tsx`,
  `frontend/src/api.test.ts`) and a browser test against the fake provider (`e2e/model/budget.spec.ts`): the
  project stops at its budget with the reason, the page says so before it is asked, a limit that is not a
  number is refused in the form, lifting the limit is saved and recorded and the stage runs again, a project
  just short of its limit is warned, and the dialog passes axe in each theme and on a phone.

## Who has access

- **The server** (`backend/test/membership.test.ts`): every project route as every kind of person, the member
  routes and their invariants (the last owner, the last lead, an administrator and an owner), and what the page is
  told it may offer (`may.manage` on a project's member list) checked against what the same people are then
  refused.
- **The page** (`frontend/src/lib/members.test.ts`, `frontend/src/panels/panels.test.tsx`,
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
- **The page** (`frontend/src/scenes/studio/scene.test.tsx`, `frontend/src/lib/studio.test.ts`): what
  each state, capability and refusal looks like, including that edited text is shown as written by a
  person and its old statements as describing an earlier text, and that text with markup in it stays text.
- **A real browser** (`e2e/lab/report-studio.spec.ts` on a rules-mode project, `e2e/model/studio-regenerate.spec.ts`
  on a model-assisted project made through the fake provider): open the report, edit, compare, lock,
  note, submit, send back, restore, approve, open the memo and check what it says and how it is served,
  export both formats, reopen, read the audit log; a save made on a section someone else changed is
  refused and the page shows their text; the keyboard, dialogs that return focus to what opened them, every
  way out of the studio asking before words that are not saved are lost (the journey with the studio's own
  words, the detailed report, which goes to the report and not to the brief, the bar of the brief and the
  menu of a phone), once for each exit, going where the person was heading, and not asking about words that
  were saved; a studio with no report to work on, which says so, writes the report from there with its
  progress in view and opens on the result, readably in each theme and on a phone; the whole working copy
  on paper, and a phone-sized screen; axe-core in the light, dark and high-contrast themes on every state of
  the controls; a chapter written again is a proposal that changes nothing until accepted, and a provider
  that fails leaves the document as it was.

```powershell
npm.cmd run build
$env:PW_CHANNEL = 'msedge'   # locally; CI uses Chromium
npx.cmd playwright test --project=lab e2e/lab/report-studio.spec.ts
npx.cmd playwright test --project=model e2e/model/studio-regenerate.spec.ts
```

Every browser action in these files has a 30-second limit, so an element that never appears fails with
its locator and does not wait out the test. A regular expression given to Playwright's text locator is
matched against the text as written, spaces included, so a summary that begins with an icon is not found
by `^`; the specs find summaries by string.

## Colour themes

The interface has three themes: light, dark and high contrast. Every colour is a custom property in
`frontend/src/design/tokens.css`, which is the one place a colour is written, once for each theme.
Anywhere else a colour is a `var(--token)`, a named colour or a `color-mix()` of those, so that it
follows the theme and cannot fall out of the contrast the tokens keep. The colours that the charts and
the ecosystem picture draw from script are `var(--token)` strings too (`frontend/src/viz/palette.ts`).
The only colour literals outside the token file are the browser-chrome colours in
`frontend/src/lib/theme.ts`, because the address bar cannot read a custom property. The design is
described in [the UX guide](./UX.md) and in `frontend/src/design/README.md`.

```powershell
node scripts/ui/colours.mjs check   # what the unit tests run: no colour literal outside the token file
```

What guards them:

- `scripts/ui/colours.test.ts` runs the checker on small trees of its own: a hex, `rgb()`, `hsl()`,
  `hwb()`, `lab()`, `lch()`, `oklab()` or `oklch()` colour in a stylesheet or a source file is refused
  and named, a hash that is not a colour, a comment and a test are not mistaken for one, the
  browser-chrome colours in `lib/theme.ts` are allowed and nowhere else, and the real tree passes.
- `frontend/src/test/design-contrast.test.ts`, with `design-palette.ts`, reads `tokens.css` itself and
  computes the WCAG contrast of the colours the interface is made from in each theme, with every
  translucent surface laid over the lightest and the darkest backdrop it can sit on. The three inks must
  reach 4.5:1 on every surface in light and dark and 7:1 in high contrast, and the main ink 7:1 in every
  theme. The accent as text and as a fill, the colours of meaning as text and a chip's colour on its own
  tint are held to the same ratio, every data colour as a graphic to 3:1. It also holds that the three
  themes define the same tokens, that dark and high contrast are different palettes from light, and that
  high contrast is opaque. A degraded token makes it fail, and it names the pair.
- `frontend/src/test/ui-guards.test.ts` holds what the tokens depend on: glass turns solid for a person who
  asked for less transparency, in the high-contrast theme and in a browser that cannot blur what is
  behind it, so that text on it stays legible. Its other rules (no text below 12px, every rule in a
  layer, no resource of another origin) are listed under "Guards" in [the UX guide](./UX.md).
- `frontend/src/lib/theme.test.ts` covers the rule that picks the theme (a choice beats the device; more
  contrast beats dark beats light; an unknown stored value is ignored) and runs the real pre-paint
  script, `frontend/public/theme-init.js`, against the same cases.
- `e2e/local/themes.spec.ts` uses a real browser: the page follows a changed device setting without a
  reload, keeps a choice across a reload, takes a choice from the settings menu and keeps it through
  every scene, paints three palettes that really differ, is themed before the application's own scripts
  run, and falls back to the device for a stored value it does not know. axe-core, contrast rule
  included, finds nothing in any of the three themes on thirteen screens (the first screen, Ground, Map
  in four states, Simulate in five views, Compare and Decide), on the first screen filled in from an
  example, on the scenario read from a question, on the history and a notice, and on the settings menu.
  In dark and high contrast no control is left in the browser's own colours.

What they do not show: a pair of colours that the lists in `design-contrast.test.ts` leave out, which
is held only once it is added there and otherwise only by axe-core on the screens above; the
forced-colours rules beyond one check (`e2e/local/themes.spec.ts` emulates the browser's forced colours
and reads the computed borders that tell the step in view from the rest; Windows high contrast itself
has not been tried); or what a person using a screen reader or a magnifier makes of any theme.

## End-to-end, accessibility, security and load evidence

```powershell
npm.cmd run build          # the E2E servers run the built output in dist/
$env:PW_CHANNEL = 'msedge' # reuse the installed Edge; CI installs Chromium instead
npm.cmd run test:e2e       # npx playwright install chromium first if you do not use Edge
npm.cmd run audit:ui       # starts its own local-mode server on a free port; screenshots + layout/axe metrics for five viewports in light and dark (see scripts/ui-audit.mjs)
npm.cmd run test:load       # latency, queue back-pressure, memory, and the newer endpoints, on this machine
npm.cmd run test:resilience # kills a real server mid-simulation, restarts it, and checks the run finishes intact
```

`test:e2e` runs five Playwright projects (`local`, `model`, `journey`, `signin` and `lab`; see
`playwright.config.ts`), each against an application server of its own with a throwaway data
directory (never your own data):

- **`e2e/local`**: the shell around the scenes, on the deterministic local engine (rules mode, no
  model). `shell.spec.ts` covers the top bar, the journey, the settings, the history, the notices, the
  page that stands when a screen cannot be drawn, and what the product says about itself on each scene.
  `palette.spec.ts` covers the command palette (Ctrl K from anywhere, steps that are not open yet,
  settings and other explorations, where the keyboard lands afterwards, a phone), `themes.spec.ts`
  the three colour themes and `motion.spec.ts` reduced motion, from the device and from the menu.
  `errors.spec.ts` covers what is left when making a project goes wrong (unsupported, corrupt or
  oversized uploads, an unreachable API, a rate limit or another refusal, a double click, a link to a
  project that does not exist or is not a project link): nothing misleading is created and what the
  person wrote is kept. `responsive.spec.ts` judges thirteen screens at five sizes by no sideways
  scroll, a top bar clear of the heading, text of 12 px or more, controls of 24 px or more (44 px where
  a finger presses) and graph labels of 11 px or more that never lie on one another. `a11y.spec.ts`
  runs **axe-core with no violation of any impact** on the same thirteen screens on a tablet, on a
  phone and on a phone in the dark, and on the decision as a report, its review, the comparison of two
  recorded runs and the report studio, and checks what axe cannot see: the skip link, one tab stop for a
  graph and the keys that move between its nodes, dialogs that keep focus off the page behind them and
  give it back, and a journey whose steps say what they are. `provider-badge.spec.ts` checks that the
  badge says rules mode and that the panel offers nothing to verify, and `whatif.spec.ts` is what-if in the
  deep dive of a run the engine made, on the seeded library scenario with no model. A change to a proxy made
  in a branch applies only after the checkpoint and the branch declares it; branching from the start begins a
  fresh run, a proxy can be changed once and nothing is created until something differs; an assumed event is
  scheduled in a paused branch, replaced and removed, and lands in the round it names; one press on a branch
  opens the comparison of its run and the one it came from, where they part; where the project's scenarios
  have not been compared, that comparison says it is not open yet and the row that offers it does nothing; a
  run the engine made on its own opens in its deep dive and its comparison in its recorded runs, with no
  comparison of scenarios offered; and a restart asks first, names the rounds it discards and can be declined.
- **`e2e/model`** — the model-assisted path against a **protocol-faithful fake Ollama
  provider** (`e2e/support/fake-provider.ts`): real Pause clicked while rounds run,
  resume (saved rounds are never requested again), intervention, one provider call
  per proxy per platform per round, injected mid-run provider failure with checkpoint
  recovery, invented-citation rejection, a grounding-checked report, actor chat and
  token accounting. The fake is a test double; it is **not** evidence about any live model.
  `deep-run.spec.ts` drives the run controls of the deep dive against a provider that takes its time: a run
  that is genuinely running is paused at its last saved round, takes an assumed event and resumes with only
  the rounds that are left, and a provider that fails in the middle leaves a checkpoint from which the run
  resumes once the provider answers again.
  `scenario-privacy.spec.ts` watches the provider while a person asks Swarm to read a question into a
  scenario: with Local rules chosen in the options the request says `useModel: false` and the provider is
  never called, and in Model assisted it is called once and the page says that a model read it; changing the
  engine back changes where the next reading goes. `grounding.spec.ts` reads a model's work through the
  Ground scene: entities that carry the quote the server checked against the passage, statements with how well
  the sources back them (in words and an icon, with the server's counts), the filters, a review recorded
  with its note, a citation the record cannot place, and steps that fail or finish without a reload.
  `report-grounding.spec.ts` does the same for the detailed report written by a model: the checks said in
  words and numbers, a passage one press away, an identifier that points at no stored passage shown as
  nothing to rely on, and hostile markup or very long words that neither become markup nor break the page.
  `studio-regenerate.spec.ts` covers Report Studio (see [Report Studio](#report-studio)).
- **`e2e/journey`**: the 26-step presentation (see
  [Presenting Swarm](./demo/presentation.md)), on a server of its own that holds the
  committed real-model recording of the demonstration scenario, with no model. It
  checks every screen for console errors and warnings, failed API calls, credential-shaped
  strings and private cloud hosts, horizontal overflow, endless spinners, axe violations,
  undersized targets and unreadable text, and a guard test plants each of those to prove
  the checks can fail. The file also has a test that opens the recorded run's detailed report and the
  comparison of its recorded branches, and one test for each of five viewport sizes that checks that the
  demonstration's screens fit. The same file runs against a live server with a real model:
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
  changes what the others leave behind, and no test in it reaches a page on the real internet. Twenty-two specs:
  - `ask-composer.spec.ts`: the first ten seconds. Before a word is typed the page says in one heading
    what Swarm is for, asks one question, offers every example as a chip that is a button and keeps the
    responsible-use sentence in sight, and nothing on it claims to predict. A keyboard reaches the
    question and then what can be done with it, in reading order. The first press asks the server for
    nothing until the person asks, and for a model never unless told to. Nine characters are too few for
    a question and ten are enough; a pasted question over 2,000 characters is cut, not refused, and the
    room left is shown only when it is nearly gone; a question with no source asks for one, and the
    request goes once one is attached. Ctrl+Enter explores and Enter alone adds a line. A slow reading
    puts the keyboard on **Stop** (the button or Escape returns it to the question) and a failed one on
    **Try again**; a question read again after it changed gives a new scenario. The project's name, the
    size of its deep dive, the time frame and the assumptions are said before the question is read, are the
    person's own in the scenario, and re-read it when they change. The mark and the first step of the
    journey lead to a new question and list the one that was left; Back and Forward move between the
    first screen and the exploration; a link that names a scene but no project opens the first screen;
    recent explorations open from the list, **All explorations** opens the history, and **Duplicate as a
    new question** brings back the question, the evidence and the settings and nothing that was run. On a
    phone every control is a 44 px target, nothing is cut off, the evidence menu, the options and the
    sheets for the time frame and the assumptions fit, and focus never lands under the bar. axe-core
    finds nothing on the empty screen, with an example loaded, with each way of adding evidence open,
    with the options, a time frame and an assumption, and with a question that was refused.
  - `ask-evidence.spec.ts`: the three ways of bringing evidence in: files, pasted text and a public web
    page that the server fetches. A text file is read in the browser and sent nowhere; a table and a PDF
    are read by the server into text the person can read. What is refused is refused in words and
    attaches nothing: a kind of file Swarm does not read, a damaged PDF or one over 2 MB, text that is
    not UTF-8, a table with too little readable data, more than ten files at once, the file that would
    pass the limit on the sources together, and a text over what one source may hold; one bad file among
    good ones is named and the good ones stay. Reading can be stopped, files can be dropped on the
    composer, and a source taken away leaves the count right and the keyboard on the next one. Pasted
    text takes a name and at least 80 characters and goes to the server only when the project is made. A
    source is read, corrected and taken away where it stands, and the correction is what the project is
    made from. The page is fetched by the server, previewed with where it is from and added on request;
    an address named in the question is offered as a source and fetched only when the person says so;
    an address that is not public is refused in words and keeps nothing (twelve cases, from a loopback
    address and the cloud metadata service to a page that robots.txt forbids), without a connection ever
    being made to a private address; a page that tries to run
    something or to instruct the analysis is only text; a page the person then changes is no longer
    called a retrieved page. The page half runs on the server with fixture pages (`E2E_LAB_WEB_URL`, see
    [the ports](#running-one-project-and-the-ports)), and all of it fits every size, in each theme, under axe.
  - `ask-examples.spec.ts`: an example is a question and some evidence and nothing else; no scenario, no
    stakeholders and no result come with one. Choosing one fills the composer with its question and
    every one of its sources and says what came with it; the line that says so is dismissed with the
    question and the sources kept; another example takes the place of the first and nothing of it stays;
    a chip says what its example is about when it is pointed at or focused, and is chosen from the
    keyboard. The fictional starter loads like any other and says that it is invented. Each example is
    read into a scenario about its own question, and becomes a project whose sources are marked as
    samples and which has no result.
  - `ask-scenario-review.spec.ts`: the scenario Swarm reads from the question, laid out to be read and
    corrected before anything is made. It says how it was made, has stored nothing yet and claims
    nothing about the future. Every piece of text is edited where it stands (Enter keeps the edit, Escape
    drops it, and a long text takes Ctrl+Enter); the first edit makes the scenario the person's own and
    the label says so; a scenario without a decision, or a change without a name, cannot be used and the
    bar at the foot says what is missing. Ways, changes, groups and assumptions are added, renamed and
    taken away without disturbing the rows that were there, and the keyboard stays in the scenario after
    each.
    Answering a question puts the answer where it belongs, and skipping one does not answer it for the
    person. The project is made from the scenario that was edited, not from the one that was read, and
    going back and on again keeps the edits and does not read the question again. The sources can be
    changed there, and a project with none is not made. A slow reading shows a way to stop it, a failed one
    says why and offers to try again, and going on without the reading makes a project with no scenario.
    At every size the way forward stays in reach and nothing sits under the bar; every control is a 44 px
    target and axe is clean in each state.
  - `ask-pipeline.spec.ts`: the completion test for the first three scenes (Ask, Ground and Map). The
    same pipeline, through the pages, serves three flagship demonstrations and a question that none of
    them knows (a congestion charge): the question and the evidence go in, and the scenario, the
    stakeholders and the actors come out of code that knows no domain. It checks that the four journeys
    make the same calls and find different stakeholders from different evidence, that a question and its
    evidence alone reach the actors and the project says there was no scenario, that editing a source
    changes which groups are found, each in the words that changed, and that a page that tries to
    instruct the analysis is only text all the way to the stakeholders it is quoted for. Its wording guard
    catches a prediction and a rate in the world that is not the simulation's, and lets through what the
    product says. It runs on `backend/test/support/lab-e2e-server.ts`: the real application in rules mode
    with its data in memory, and the real public page reader with every check it has. Only two things around
    the reader are replaced, as a network lab replaces them: the lookup of a name is a table, and the
    connection goes to a fixture web server on this machine. Any other host, and every https request, fails,
    so the process cannot reach the network whatever the checks let through.
  - `ground.spec.ts`: the Ground scene on what the server holds (the documents, the passages they were cut
    into, the graph, the conflicts), never a number from a fixture. A project whose sources have not been
    read says so and reading them is one press; one whose sources were read shows the counts the server
    holds and one row for each source; a saved record that the guided flow did not make is read, never run.
    An address with `?view=` opens the page at its part and the part has the focus. The graph is one tab
    stop, walked, opened and closed from the keyboard; a topic says what it is, which passages it rests on
    and which sources they sit in, and can be searched by name; what is pointed at lights what it rests on and
    what rests on it, in the graph and in the sources. A source opens in a sheet with its whole text exactly
    as given and its passages marked; a passage can be found by its number or a word, and an id the record
    cannot place says that it is not there. A conflict shows both sides with their figures and the words they
    are in, can be confirmed, dismissed and changed (the trail and the export carry every decision, and
    a decision survives a reload), and is flagged on the two sources it is between. Sources that agree
    have nothing to settle, and the page says what it compared and what it can miss. How the sources were
    read is one press away and the operations behind the page are shown in Advanced mode only. A step
    that is under way shows the engine's own steps, one that failed says why in the engine's words and
    trying again really does it again, and one that was stopped says so. The page says what its figures
    are and are not and never says what will happen; it fits every size, in each theme, under axe, with every
    control large enough for a pointer and for a finger.
  - `map.spec.ts`: the Map scene on the stakeholders the server holds, never a number from a fixture.
    Before anything is found the page says what it will do, that no model is used and what its actors are.
    Finding them reads the text, one party for each stakeholder the engine found; every stakeholder that
    cites a passage cites words that really are in the sources and the others say that they are assumed,
    for any domain. A party is chosen by pressing it, shown in a panel named after it and let go by its
    close button or the background; from the keyboard the map is one tab stop, the arrows move between
    parties, Enter and Space choose and Escape lets go, and F turns focus mode on and off. Groups are hidden
    one by one, on the map and in the list, which has the same parties as the map and opens the same
    detail. A party says who it is, how the change lands on it and how sure Swarm is, and lists its
    connections. A stakeholder is edited (nothing is saved until Save, and what is saved is marked as the
    person's own), added by hand with no evidence, duplicated, removed and brought back, and merged into
    another and taken back; when nobody is left the page says so and does not say that everyone was
    reviewed. Approving needs two or more; the person reviews one party at a time from the pill, approves,
    and the actors are made from exactly what was approved. Wherever actors are shown the page says
    they are synthetic stand-ins and nothing it says of them is a forecast. An actor shows every number the
    engine will use for it, each with where it came from and why; a trait is moved, held until saved and
    can be discarded; what an actor wants, fears and is pushed by is written in place; a cohort cannot
    simulate more members than it stands for; an actor offers its stakeholder where it cannot be removed or
    copied itself. **Make them again** asks first, and when the stakeholders change after the actors were
    made the page says the actors are out of date. The whole of it works without a pointer, with focus
    shown by a ring of at least 2 px.
  - `map-responsive.spec.ts`: the Map at every size, in each theme: no sideways scroll, text that
    reads, parties in view and clear of what floats over them, and targets that can be reached (by a
    finger on a phone). The detail of a party is a panel beside the map where there is room, and a
    strip under it with the rest in a sheet from the bottom where there is not; the one thing to do next
    stays on the screen before, during and after the review.
  - `journey.spec.ts`: the whole way, in a real browser, as a person walks it: a question and its
    evidence from an example, Ground, who is affected, the actors, the simulation and the theatre, the
    comparison and the decision. At each point it reads which steps are open, which are locked and what
    each says it needs, and what the record on the server holds. It allows only the calls a page makes to
    walk the journey in rules mode, and none to a model. The same journey by the dock with a finger reaches
    the same decision, and a reload on the Map keeps the stakeholders found and the steps locked.
  - `journey-gates.spec.ts`: what opens each scene. Projects are made through the routes at each point
    of the way (new, evidence read, stakeholders proposed, approved, actors made, a comparison stopped,
    finished, reviewed, a brief written) and the page is read at each: which scenes are open and which are
    locked, the reason in the name of each locked step, the state each step carries (done, in progress,
    stopped and needing a look, locked), exactly one step in view, and where the project opens. Pressing a
    locked step says what is needed and stays where it is, and the keyboard reaches every step, locked or
    not. A scene that the record has not opened, named by its address, shows where the work is instead and
    replaces the address, so that Back does not return to a scene that was never shown; a view it does not
    know is never trusted; a record the guided journey did not make opens on Decide with Map and Compare
    shut, and says that it is not in the record when they are pressed. The page finds out without a
    reload that the actors were made and that a comparison finished, also elsewhere, and a comparison
    that runs keeps Compare and Decide locked while one that stops needs a look. Once a comparison has
    finished, Simulate is done and Compare is ready, and it stays ready (it is never ticked) through the
    review and the brief, while Decide is current and then done. After a reload the same
    scenes are open, Advanced opens nothing more, and on a phone the dock holds the five scenes, names
    the locked ones and is the only journey.
  - `simulate.spec.ts`: the simulation as a person meets it, from the page that sets the futures side by side
    to the first thing it says. For each of three examples (`copilot-in-teams`, `regional-price-change` and
    `ecommerce-experience`) the setup says what is compared and that every scenario runs on the same seeds,
    shows the baseline, the proposed change and what the simulation will cost, and a person makes the
    proposed change stronger and later and adds an alternative; the saved comparison holds the values that
    were run and says that the person set them, and the story says what the runs show and nothing that is
    forecast. A question of the person's own, in another domain, gets a smaller and a larger version marked
    as suggestions, and what its typical run set off is read back from the engine's record, in the round in
    which it happened. The button that starts a simulation stays in view at 1366 by 768, 1440 by 900 and 390
    by 844 with the most scenarios there can be, and a field that takes focus is not left behind it. A change
    that cannot move anyone, and a project where nobody has a direction though members still differ in how
    the change lands, are each said before the run and after it in their own words and never in the other's.
    Repeating a simulation on the same seeds gives the same numbers to the last digit, and another first seed
    does not. At a desktop, a laptop, a tablet and a phone, in the themes asked for, the setup passes axe,
    fits the page and is made for a finger or a pointer.
  - `simulate-running.spec.ts`: a simulation while it runs, and when it does not finish as it was asked to. A
    running simulation shows its progress where the person is looking (a progress bar that says its figures
    in words, the phase in the heading, the scenarios and the sensitivity runs with their counts), the server
    keeps answering `/api/health` in under half a second the whole time, and **Cancel** says so until it has
    stopped, shows no partial result and lets the simulation be run again with the same settings and stopped
    again. A second simulation for the same project is refused in a sentence and not in the engine's words; a
    request that is too large or not understood is refused with the limit (2,400 runs) in a sentence. The
    setup says what a simulation will cost before it is started, follows what is chosen and refuses a setup
    that is not allowed in words (a scenario with no name keeps it from starting). A failure that the engine
    reports (the server's answer is replaced by one that says `SPEC_NOT_ACCEPTED`, which the real engine is
    not made to give) is shown as its sentence and never its code, with no result and **Run it again with the
    same settings**. A simulation that the server did not finish is read on an open page: the spec starts a
    server of its own on a free port, ends it mid-run and starts it again, and checks that the page says it
    cannot read the progress, then that the run was interrupted, and that it can be run again. The progress
    passes axe, fits and is made for a finger or a pointer at a desktop, a tablet and a phone.
  - `simulate-theatre.spec.ts`: a finished simulation as it is looked at: the four views of one real run, the
    scrubber, the actor chosen in the picture and what each says of itself, all read back from the run the
    engine saved. It opens on the run and says its seed, plays by itself the first time from the first round
    to the last, and can be played again and paused; for someone who asked for less motion it opens on the
    last round and moves only when moved. The scrubber is a real slider: the arrows, the page keys, Home,
    End, Space, a press on the track and the buttons all move the same round. Each round says what the run
    recorded in it (where it starts, where the change lands, what was set off); an actor chosen in the picture
    says where it stands and how it got there and lets go again; the picture can be zoomed in and out and
    fitted again without losing the view. The story points to the deep dive, one press away. Each view has its
    own heading and address and says that it is not a prediction. The network says who moved most from the run
    itself and what each actor is joined to; the timeline spreads every run over the rounds, lays the watched
    run over it, has its figures as a table and plays its cursor from its own button. Every view passes axe,
    fits and is made for a finger or a pointer at a desktop, a laptop, a tablet and a phone.
  - `compare.spec.ts`: the comparison of scenarios, set side by side, every figure read back from the saved
    comparison and nothing said of the world. It says first what happened, why and how sure, and that it is
    not a forecast; sets every scenario's response next to the others; lets any two scenarios be set against
    each other, from the sentence and from the bar; shows who moves, the ones that moved most first; reads how
    the runs spread over the rounds, with a scale to choose and a cursor to move; lists what held, the
    steadiest first, with the others one press away, and says that repeatable is not a likelihood; says what
    the result depends on, one assumption at a time, and which assumptions have no evidence behind them; reads
    back what the typical run set off as one run and not the answer; says how far to rely on it (what drove
    the behaviour, which seeds, what it cost, and that no model was called); says nothing of a direction where
    nothing in the change can move anyone; and keeps the way on in the bar: the decision, the method and the
    setup again. With every disclosure opened, the whole page passes axe, fits and is made for a finger or a
    pointer at a desktop, a laptop, a tablet and a phone.
  - `deep-dive.spec.ts`: the engine's own run as the deep dive of a lab project (`?view=deep`), with no model.
    It is made from the actors that were approved (each proxy is one of them, a cohort by a representative),
    runs its rounds with no model call and writes a detailed report that sits one press from the brief; it can
    be run before the scenarios are compared, and then says that its report opens with the decision page and
    offers to set up the comparison; and every tab of a finished run (Setup, Run, Rounds and Memory) and the
    sheet that branches it pass axe, fit and are made for a finger or a pointer at a desktop, a tablet and a
    phone.
  - `report-page.spec.ts`: the decision brief as a page, with the answer first and the reference closed
    until it is wanted. It opens on what happened, why, what matters and what to consider next, and says
    that none of it is a forecast. The five reference chapters are closed and still in the page; a chapter
    opens and closes from the keyboard and its heading is still a heading; the contents list every chapter
    and open a closed one before they take the reader there; an address such as `#brief-limitations` opens
    the chapter it names, on the first visit and when the address changes; **Open every chapter** and
    **Close the reference** work from the contents. The tools stay in reach once the first screen has gone
    by and say where the reader is, the page says what to do next and leads to it, and nothing follows the
    brief but its end. A mark on the plot of impact and effort takes the reader to its recommendation, and
    the page glides there only for someone who has not asked for less motion. On a phone the answer comes
    first, the contents are a sheet, every control is big enough for a finger and the last line is clear of
    the dock. axe-core finds nothing with the reference closed and open.
  - `report-review.spec.ts`: the independent review, a sheet over the brief that opens from the tools, from
    the contents or from the note beside the statement it is about. It says what it is, counts what is
    open and gives focus back, has an address, and closing it leaves the brief where it was. It says that a
    critic that raised nothing does not show the analysis is right. A criticism is answered, accepted or
    disputed and the answer is kept with the review; an answer that the server refuses because the review
    changed is told, and what was written stays. A review that has not been run says so and runs when
    asked. A mark under a statement opens the review at its criticism, gliding there only where motion is
    wanted. Each note the server makes about what it could not check is a line of its own, and a note that
    says that conflicts between the sources were not checked has **Open the conflicts in Ground**, which
    closes the sheet and opens Ground at its conflicts; no other note has it. On a phone it is a sheet from
    the bottom with controls a finger can press, in light and dark.
  - `report-states.spec.ts`: every state the decision scene can be in. A comparison with no brief
    offers to write it and says what it will hold; writing it says that it is being written and takes the
    reader to the answer; a brief that could not be made or read says so, keeps the way to try again and
    recovers; a brief that is out of date says what changed, offers the one action that helps and is
    current again once it is written again; a review run after the brief was written is said not to be in
    it; a record with no comparison says there is nothing to decide from yet and leads to the comparison and
    to the report it does have; a review that is being made says so and cannot be started twice; and a very
    long word in the brief or its review breaks where it must and widens nothing.
  - `report-export.spec.ts`: what leaves the brief, in rules mode: a Markdown file, a JSON file with the data
    behind the charts, a page made for paper, and the page itself printed. Each says what it is, holds all of
    the brief (whatever was closed on the screen) and none of the controls. Markdown holds every section and
    statement and what is still open; the JSON carries the data behind every chart and where each came from;
    the printable page is sealed, has no script and holds the whole brief; **Print this page** opens the
    browser's print and nothing else; a role that may read the brief but not export it sees the files disabled
    and told why, and can still print. The printed brief (the browser's PDF, read back as text) holds the
    review too, is ink on white from every theme, fits the width of the paper, and prints from a phone as from
    a desktop; the check for text drawn over text is itself shown to fail when it should.
  - `report-detail.spec.ts`: the detailed report of the deep dive, beside the brief. It is reached from the brief,
    says what it is and holds the whole of what the engine wrote; it is read with a contents that follows the
    reader; the sources it cites open on press; it leads to the studio and back; Markdown and the project as
    JSON are saved and say what the report says; and it prints whole, with none of the controls of the
    screen and nothing drawn over anything else. A finished deep dive offers to write it, and writing it
    makes the report; without a deep dive the page says that the deep dive comes first and leads to the deep
    dive itself; a record that the guided flow did not make says there is nothing to write. The tools of a
    brief whose report is not written offer to write it in place of editing it, with the deep dive done or
    not, in the row and in the menu of a phone, and the offer leads to where it is written; a role that may
    read the brief but not write the report is offered neither the writing nor an editor, and the studio
    says who can. It fits every size in each theme.
  - `report-studio.spec.ts`: Report Studio, described under [Report Studio](#report-studio).
  - `freshness.spec.ts`: what a person is told when what a comparison, and the brief written from it, rest on
    changes somewhere else. "Elsewhere" is a second client of the same server, as a colleague's browser would
    be, and the page is opened again afterwards. The comparison says that it is out of date once the
    stakeholders changed, and the way to make it current is refused until they are approved again; running the
    comparison again and writing the brief again brings it up to date; the brief and the review rest on the
    newest finished comparison, and say that a newer one exists only once one has finished; and an older
    comparison says that a newer one exists and offers it, while a cancelled one is not newer.

The suite sets `RATE_LIMIT_SCALE=100`; the production limiter itself is tested in
`backend/test/security.test.ts` (including that a genuinely rate-limited request
returns HTTP 429 `RATE_LIMITED` with `Retry-After`).

### Running one project, and the ports

Playwright starts every server in `playwright.config.ts` even when you select one project, because the
servers are listed once for the whole run. Each listens on a port that an environment variable can move,
which is how two runs on one machine, or a run beside your own server, avoid each other:

| Variable                   | Default                | What listens there                                                                                                                     |
| -------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_LOCAL_PORT`           | 3111                   | The application for the `local` project (rules mode)                                                                                   |
| `E2E_MODEL_PORT`           | 3112                   | The application for the `model` project (`AI_PROVIDER=ollama`, the fake)                                                               |
| `E2E_JOURNEY_PORT`         | 3113                   | The application for the `journey` project (rules mode, the recording)                                                                  |
| `E2E_SIGNIN_PORT`          | 3114                   | The application for the `signin` project, with sign-in switched on                                                                     |
| `E2E_SIGNIN_IDP_PORT`      | 3115                   | The test identity provider that the `signin` project signs in against                                                                  |
| `E2E_LAB_PORT`             | 3116                   | The application for the `lab` project (rules mode)                                                                                     |
| `E2E_LAB_WEB_PORT`         | 3117                   | The application for `ask-evidence.spec.ts` and `ask-pipeline.spec.ts`: rules mode, data in memory, and a web of fixture pages to fetch |
| `E2E_LAB_WEB_FIXTURE_PORT` | 3118                   | The fixture web server on this machine that the connections to those pages end on                                                      |
| `E2E_PROVIDER_PORT`        | 11999                  | The fake Ollama-protocol provider that the `model` server talks to                                                                     |
| `E2E_DATA_ROOT`            | a new temporary folder | The folder that holds one throwaway data directory for each server (created for the run, and inherited by Playwright's workers)        |

`E2E_LAB_WEB_URL` and `E2E_LAB_WEB_FIXTURE_URL` are worked out from the two ports above for the workers (the
two specs that use the web of fixture pages read them), and you do not set them.

```powershell
npm.cmd run build   # the servers run the built output in dist/
$env:E2E_LOCAL_PORT = 3280; $env:E2E_MODEL_PORT = 3281; $env:E2E_JOURNEY_PORT = 3282
$env:E2E_SIGNIN_PORT = 3283; $env:E2E_SIGNIN_IDP_PORT = 3284; $env:E2E_LAB_PORT = 3285
$env:E2E_LAB_WEB_PORT = 3286; $env:E2E_LAB_WEB_FIXTURE_PORT = 3287; $env:E2E_PROVIDER_PORT = 3288
npx.cmd playwright test --project=lab e2e/lab/ground.spec.ts
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

| Capability                             | What you can do                                                                                                                                                                                                                                                                       | Exercised by                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source-grounded graph                  | Read numbered passages, inspect every entity and relation with its verified quote, browse and search the evidence                                                                                                                                                                     | `knowledge.test.ts`, `grounding-quotes.test.ts`, `pdf.test.ts`, `e2e/lab/ground.spec.ts`                                                                                                                                                     |
| Evidence ledger                        | Filter statements by type and support class, open a statement's supporting and contradicting passages, confirm or dismiss conflicts, see the assumptions behind simulated results                                                                                                     | `ledger.test.ts`, `ledger-service.test.ts`, `contradictions.test.ts`, `e2e/lab/ground.spec.ts`, `e2e/model/grounding.spec.ts`                                                                                                                |
| Fictional actors (engine)              | Read each proxy's profile and assumed traits; edit them before a run, or on a branch before it is resumed; records are read-only afterwards                                                                                                                                           | `actor.test.ts`, `guided.test.ts`, `e2e/journey/demo-journey.spec.ts`                                                                                                                                                                        |
| Multi-round simulation                 | Configure rounds and platforms, replay a run, read each decision with its stated reason, filter by proxy and round, pause and resume                                                                                                                                                  | `guided.test.ts`, `guided-model.test.ts`, `whatif.test.ts`, `frontend/src/scenes/simulate/deep/*.test.ts(x)`, `e2e/local/whatif.spec.ts`, `e2e/lab/deep-dive.spec.ts`, `e2e/model/deep-run.spec.ts`                                          |
| Intervention, branches, compare        | Schedule an assumed intervention, branch from a checkpoint with declared edits, compare a branch with its parent or sibling                                                                                                                                                           | `whatif.test.ts`, `whatif-model.test.ts`, `frontend/src/lib/whatIf.test.ts`, `e2e/local/whatif.spec.ts`, `e2e/model/deep-run.spec.ts`                                                                                                        |
| Grounded report                        | Read a chaptered report with a grounding review: verdicts, the checks that ran, and what the server repaired or withheld                                                                                                                                                              | `grounding-*.test.ts`, `report-plan.test.ts`, `e2e/model/report-grounding.spec.ts`                                                                                                                                                           |
| Report Studio                          | Open the generated report as a document and work on it: versions, locks, reviewer notes, submit, approve or send back with a reason, reopen, write a chapter again and accept or reject it, export Markdown, JSON and a printable memo. The generated report is never changed         | `studio-model.test.ts`, `studio.test.ts`, `studio-access.test.ts`, `studio-regenerate.test.ts`, `studio-store.test.ts`, `scenes/studio/scene.test.tsx`, `e2e/lab/report-studio.spec.ts`, `e2e/model/studio-regenerate.spec.ts`, 25 mutations |
| Analyst chat with abstention           | Ask a question the sources answer (cited, with a note when a source it cites is disputed by another) and one they do not (exact refusal sentence, no model call)                                                                                                                      | `evidence-gate.test.ts`, `model-workflow.test.ts`, `evaluation/test/evaluation.test.ts`, `e2e/model/model.spec.ts`                                                                                                                           |
| Actor chat and survey                  | Ask one fictional proxy a question, or survey all of them, against what that proxy was given                                                                                                                                                                                          | `model-workflow.test.ts`, `e2e/model/model.spec.ts`                                                                                                                                                                                          |
| Export and audit                       | Export Markdown and JSON; read and verify the append-only, hash-chained audit log                                                                                                                                                                                                     | `audit-trail.test.ts`, `storage.test.ts`, `snapshot.test.ts`, `e2e/journey/demo-journey.spec.ts`                                                                                                                                             |
| Themes                                 | Choose light, dark or high contrast in the settings menu, or follow the device; the choice is kept and applied before the page is drawn                                                                                                                                               | `theme.test.ts`, `design-contrast.test.ts`, `ui-guards.test.ts`, `scripts/ui/colours.test.ts`, `e2e/local/themes.spec.ts`                                                                                                                    |
| Identity and access                    | Sign in with Microsoft in the browser (PKCE, a server-side session, no token in the page) or call with an Entra bearer token; seven roles through workspace and project membership; default-deny routes; tenant isolation; People and Access screens (tested against a test provider) | `auth.test.ts`, `membership.test.ts`, `session.test.ts`, `panels/panels.test.tsx`, `e2e/signin/signin.spec.ts`, `e2e/signin/access.spec.ts`, `security.test.ts`, 9 access mutations                                                          |
| Real Azure AI, no key                  | Run every engine stage against an Azure model deployment with Entra authentication                                                                                                                                                                                                    | `npm run azure:verify` (15 checks), `scripts/azure/lib/*.test.ts`                                                                                                                                                                            |
| PostgreSQL storage (optional)          | Run the same stores on PostgreSQL (`DATABASE_URL`), with serializable transactions retried when they lose a race; copy a database between SQLite and PostgreSQL in either direction, checked                                                                                          | `postgres.test.ts`, `postgres-driver.test.ts`, `copy.test.ts`, `npm run test:postgres`                                                                                                                                                       |
| Durable stage jobs                     | A refresh or a restart does not lose a run: stages are queued in the database, taken under a lease, retried a bounded number of times, resumed from the last saved round, cancelled or paused from any process; the same `Idempotency-Key` is one job                                 | `jobs.test.ts`, `durable-jobs.test.ts` (each also on PostgreSQL), 19 job mutations                                                                                                                                                           |
| Observability                          | A correlation id on every answer; OpenTelemetry spans and metrics with a gate that keeps content, headers and credentials out; export to Application Insights signed by Entra (tested with in-memory exporters)                                                                       | `telemetry.test.ts`, `telemetry-start.test.ts`, 9 telemetry mutations                                                                                                                                                                        |
| Model budget per project               | A budget of model calls and tokens for each project: the deployment sets a default and only a workspace owner or administrator changes one project's limits; the next call is refused before anything is sent once it is used                                                         | `usage.test.ts`, `model-budget.test.ts`, `budget-routes.test.ts`, `membership.test.ts`, `panels/panels.test.tsx`, `e2e/model/budget.spec.ts`, 17 budget mutations                                                                            |
| Backup, rollback and restore rehearsal | A SQLite file is copied before an upgrade and a copy that is out of date is set aside, never overwritten; the release before refuses an upgraded database; `npm run db:drill` proves a restore from the backup alone                                                                  | `rollback.test.ts`, `storage-backup.test.ts`, `restore-drill.test.ts`, 12 storage mutations                                                                                                                                                  |
| Recorded demonstration                 | Restore a real-model recording of one scenario and two branches, and walk the 26-step presentation in a real browser                                                                                                                                                                  | `scripts/demo/lib/*.test.ts`, `e2e/journey/demo-journey.spec.ts`                                                                                                                                                                             |
| Accessibility checks                   | Use the product by keyboard; axe-core finds no violation on every screen at desktop size in each theme, and at tablet and phone size                                                                                                                                                  | `e2e/local/a11y.spec.ts`, `e2e/local/responsive.spec.ts`, `npm run audit:ui`                                                                                                                                                                 |

## Results recorded on earlier trees

Moved here from the README, with their dates. These are numbers from runs on the tree **before the
scenario lab was added**: the unit suite and the browser suite have grown since, and these figures have
not been recorded again. Re-run the commands for today's result; none of this shows that a model's
output is correct, that any scenario predicts the real world, that a manual screen-reader review has
been done (it has not), that sign-in works against a real Entra tenant, or that Swarm is ready for
production.

<!-- TEST COUNTS: the next three rows (npm run check, npm run test:e2e, npm run test:postgres) hold the recorded counts of the full run on the integrated tree named in them. Replace them after the next full run, and say which tree and date. -->

| Check                                                    | Command                     | Result recorded then                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Types, lint, unit and integration tests, build           | `npm run check`             | Passed on the final tree (commit `62e740d`, 2026-11-01): 4,918 tests in 209 files (Vitest), strict typecheck of five projects, ESLint with zero warnings, production build                                                                                                                                                                                                                                                                                                                                   |
| Formatting                                               | `npm run format:check`      | Passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Browser end-to-end tests                                 | `npm run test:e2e`          | 317 passed, 0 failed, 0 flaky (Chromium on Linux, one worker, 18.8 minutes; the same tree, 2026-11-01): 71 against the local engine, 42 model-assisted against a protocol-faithful fake provider (not a live model), 20 for the 32-step presentation, 13 for browser sign-in and access against a test identity provider, and 171 for the scenario lab (intake, stakeholders, actors, comparison, brief and review, and the example packs through the same pipeline), with axe-core on every reachable state |
| Unit tests on PostgreSQL                                 | `npm run test:postgres`     | The same 4,918 tests on PGlite: all passed. The real driver is also tested over the wire protocol; no deployed server has been used                                                                                                                                                                                                                                                                                                                                                                          |
| Mutation checks on the access, sign-in, storage and more | `npm run mutation:security` | 150 of 150 mutations caught in one run (19 minutes): 15 membership, 27 sign-in, 22 storage, 19 job, 9 telemetry, 25 studio, 7 analyst, 17 budget, 9 access screens. See [Mutation checks on security code](#mutation-checks-on-security-code)                                                                                                                                                                                                                                                                |
| Load on one machine                                      | `npm run test:load`         | One Windows run of 44 s: no 5xx, 3,000 health reads at p95 76 ms, 600 ledger reads at p95 177 ms, a burst of 12 workflows held back with `429 QUEUE_FULL`, peak memory 358 MB, eight simultaneous saves of one section with one accepted. Not a capacity claim. See [Load, and a killed process](#load-and-a-killed-process)                                                                                                                                                                                 |
| A server killed mid-simulation                           | `npm run test:resilience`   | 9 of 9 checks in two runs: the run finished by itself 22 s and 18 s after the restart, every platform had every round, 96 actions and none twice, saved rounds were not computed again, the budget counted both sides of the crash and the audit chain verified. SQLite, one machine, a stand-in provider                                                                                                                                                                                                    |
| Backup and restore rehearsal                             | `npm run db:drill`          | On the demonstration database (409 rows, 11 tables, 9 projects): backed up in 0.25 s, restored from the backup alone in 0.24 s, and every table, the audit chain and every project came back identical. Restoring a hosted server from a point-in-time backup has not been rehearsed                                                                                                                                                                                                                         |
| The presentation against a real model                    | `npm run demo:journey`      | Passed twice against the live server with the real Azure model (7.6 minutes each): once reading the recorded conversation, once asking the analyst and an actor new questions while checking that five private values appear on no page. A negative control made it fail as intended                                                                                                                                                                                                                         |
| Real Azure AI, Microsoft Entra only                      | `npm run azure:verify`      | 15 of 15 checks passed in 467 s with 59 round trips: every stage, per-proxy decisions, verbatim quotes, grounding, branching, both chats, an injection probe and a scan for credentials                                                                                                                                                                                                                                                                                                                      |
| Dependency audit                                         | `npm audit`                 | On 2026-10-31, through a corporate registry mirror: 0 high or critical and 14 moderate, all from two advisories published the day before (`minimatch`, and `glob` reached only through `@fastify/static`), neither reachable from a request. CI fails on high or above. A point-in-time result                                                                                                                                                                                                               |
| Secret scan, every reachable commit                      | `npm run scan:secrets`      | 0 findings (933 history blobs and 483 working-tree files at that run); no `.env` tracked. One history blob that holds only fake credentials made up for a redaction test is accepted by its hash, because history is not rewritten                                                                                                                                                                                                                                                                           |
| Offline evaluation                                       | `npm run eval`              | Every floor in `evaluation/thresholds.json` held: the analyst's gate refused no answerable question and 43% (dev) and 86% (test) of unanswerable ones, 1 of 3 labelled conflicts was found, injection warnings caught 80% of 18 labelled samples (in-sample). See [evaluation/README.md](../evaluation/README.md)                                                                                                                                                                                            |
| UI audit at four viewports                               | `npm run audit:ui`          | 44 states: 0 console errors, 0 axe violations, no overflow, small text, small targets, unnamed controls or label collisions, and a visible focus indicator on every Tab stop                                                                                                                                                                                                                                                                                                                                 |
| Container build and health                               | CI                          | Builds, answers its health check and serves the UI, and the console smoke flow passes inside it                                                                                                                                                                                                                                                                                                                                                                                                              |
