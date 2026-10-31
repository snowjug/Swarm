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
(`markup-sinks.test.ts`). The job queue has two files: `jobs.test.ts` drives the queue rules directly (claims, leases, retries, poison, cancel, pause, the lease fence on repository writes), and `durable-jobs.test.ts` drives the orchestrator with a scripted model and a clock the test sets: a stalled worker, a crash, a stopped backend, cancel and pause from another process, retries, idempotency and branch lineage. Both run on PostgreSQL as part of `npm run test:postgres`. Report Studio has five files: `studio-model.test.ts` drives its rules as pure functions of a document, `studio.test.ts` drives the service and routes over HTTP (the memo, the exports, the audit entries, a report that has been replaced), `studio-access.test.ts` drives every studio route as every kind of caller against the test identity provider, `studio-regenerate.test.ts` runs writing a chapter again against a provider that speaks the real protocol (including hostile instructions and concurrency), and `studio-store.test.ts` covers the store, migration 7 and its backup. Security-critical rules, the queue's rules and the studio's rules are mutation-checked, as described next.

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
npm.cmd run mutation:security                     # all 150; 19 minutes on a laptop when last run, longer on a busy one
npm.cmd run mutation:security -- --area=sign-in   # or membership, storage, jobs, telemetry, studio, analyst, budget or access
npm.cmd run mutation:security -- --only=M3,S8     # named ones
npm.cmd run mutation:security -- --list
```

Result of the last full run: **all 150 were caught** (15 of 15 membership, 27 of 27 sign-in, 22 of 22 storage, 19 of 19
job, 9 of 9 telemetry, 25 of 25 studio, 7 of 7 analyst, 17 of 17 budget and 9 of 9 access mutations). One studio mutation survived the first run
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

Three files, all in `npm test` (and in `npm run test:postgres`):

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
  that a database in use is read as a snapshot including its write-ahead log, and that the database
  it is run on and its folder are not changed.

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
(there is no browser test for them), or what a person using a screen reader or a magnifier makes of any
theme.

## End-to-end, accessibility, security and load evidence

```powershell
npm.cmd run build          # the E2E servers run the built output in dist/
$env:PW_CHANNEL = 'msedge' # reuse the installed Edge; CI installs Chromium instead
npm.cmd run test:e2e       # npx playwright install chromium first if you do not use Edge
npm.cmd run audit:ui       # starts its own local-mode server on a free port; screenshots + layout/axe metrics for four viewports (see scripts/ui-audit.mjs)
npm.cmd run test:load       # latency, queue back-pressure, memory, and the newer endpoints, on this machine
npm.cmd run test:resilience # kills a real server mid-simulation, restarts it, and checks the run finishes intact
```

`test:e2e` drives a real browser against four isolated servers with throwaway data
directories (never your own data):

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

The suite sets `RATE_LIMIT_SCALE=100`; the production limiter itself is tested in
`backend/test/security.test.ts` (including that a genuinely rate-limited request
returns HTTP 429 `RATE_LIMITED` with `Retry-After`).

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
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format
```

CI performs these checks, dependency auditing at high severity, a Playwright
end-to-end run in Chromium (both projects above), Compose validation,
and an actual Docker build/health/UI smoke test, including PDF parsing and the full
staged local workflow inside the container. Local Docker image execution
requires a running engine and is separate from native validation.

Run the same real HTTP smoke flow against a local **0.3.0** backend:

```powershell
npm.cmd run smoke:console -- http://127.0.0.1:3001
```

It creates its own fictional PDF/scenario, verifies every gated stage and both
platforms, checks a real report/state survey, and deletes that scenario on success.
It never selects a model or spends provider quota. On failure, a scenario may remain
for diagnosis; the container CI removes its own container in all cases.
