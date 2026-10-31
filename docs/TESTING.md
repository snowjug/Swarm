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
redaction gate of telemetry (which names and values may leave the process) and for Report Studio (who may
edit and who may approve, locks and versions, what an approval is of, what a memo may call a finding),
each rule is listed in
[`scripts/mutation/mutants.json`](../scripts/mutation/mutants.json) as one small edit that breaks it:
a check replaced by `false`, a capability added to a role, a `DELETE` that no longer deletes, a
nonce that is no longer compared. The runner applies one edit at a time to the working copy, runs the
tests that should notice, and restores the file.

```powershell
npm.cmd run mutation:security                     # all 105; about an hour and a half on a busy machine
npm.cmd run mutation:security -- --area=sign-in   # or membership, storage, jobs, telemetry or studio
npm.cmd run mutation:security -- --only=M3,S8     # named ones
npm.cmd run mutation:security -- --list
```

Result when each area was last run: **15 of 15 membership, 27 of 27 sign-in, 10 of 10 storage, 19 of 19
job, 9 of 9 telemetry and 25 of 25 studio mutations were caught.** One studio mutation survived the first run
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
node scripts/load-test.mjs # latency, queue back-pressure and memory on this machine
```

`test:e2e` drives a real browser against three isolated servers with throwaway data
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

The suite sets `RATE_LIMIT_SCALE=100`; the production limiter itself is tested in
`backend/test/security.test.ts` (including that a genuinely rate-limited request
returns HTTP 429 `RATE_LIMITED` with `Retry-After`).

Automated checks do not replace a manual assistive-technology review (screen reader,
200 % zoom, forced colors), which has not been done. `scripts/load-test.mjs`
reports numbers for the machine it runs on; see
[requirements-matrix.md](./requirements-matrix.md) for the measured results and
their limits.

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
