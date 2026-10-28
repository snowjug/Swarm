# Testing, linting and formatting

Back to the [README](../README.md).

```powershell
npm.cmd run check
npm.cmd run format:check
```

`check` runs strict backend/test/frontend TypeScript checks, ESLint, Vitest, and
production backend/frontend builds. Tests cover input thresholds, exact source
offsets, real retrieval, deterministic state transitions, measurable intervention
effects, stage prerequisites, editable preparation, separate platform state,
memory, tool/citation validation, PDF extraction/bounds, asynchronous surveys,
persistence/restart recovery, cancellation/queue bounds, HTTP boundaries, exports,
frontend graph/console helpers, provider protocol/error handling, the per-proxy
simulation (context isolation, validation, concurrency and cancellation), the
grounding review (quote matching, verdict table, entailment validation), Entra token
handling with a fake credential, and the Azure provisioning scripts with a fake Azure CLI.

Provider tests use explicitly labeled fixture HTTP responses; they do **not**
establish live model connectivity or reasoning quality. Live evidence comes only from
`npm run azure:verify` against a real deployment (see
[AZURE.md](./AZURE.md#live-evidence)).

## End-to-end, accessibility, security and load evidence

```powershell
npm.cmd run build          # the E2E servers run the built output in dist/
$env:PW_CHANNEL = 'msedge' # reuse the installed Edge; CI installs Chromium instead
npm.cmd run test:e2e       # npx playwright install chromium first if you do not use Edge
npm.cmd run audit:ui       # screenshots + layout/axe metrics for four viewports (see scripts/ui-audit.mjs)
node scripts/load-test.mjs # latency, queue back-pressure and memory on this machine
```

`test:e2e` drives a real browser against two isolated servers with throwaway data
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
