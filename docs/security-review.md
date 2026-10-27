# Security review — Swarm Lab

Date of review: 27 Oct 2026. Scope: the repository at the commit that contains this file, running as
a local single-user application. This is an evidence log, not an assurance claim: **the application is
not claimed to be secure.** Each section says what was run, what it showed, and what remains.

See [threat-model.md](./threat-model.md) for the full threat table and residual risks.

## What was run

| Check                                       | Command / method                                                                                                                                                                                                                                       | Result                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Known dependency advisories                 | `npm audit` (through the corporate registry mirror; the public advisory endpoint fails TLS from this machine)                                                                                                                                          | **0 vulnerabilities.** An earlier run found 5 moderate advisories in `fast-uri` (transitive via `ajv`/Fastify); `npm audit fix` moved it to 3.1.9 / 4.2.3 and they cleared |
| Secrets in source and history               | Regex scan of every commit (`git log -p --all`, lockfile excluded) for OpenAI-style keys, AWS keys, GitHub tokens, Slack tokens, private-key blocks, Azure storage keys and `api_key = "..."` assignments; plus a check that no `.env` file is tracked | **0 hits.** `.env` is git-ignored and was never committed; only `.env.example` (placeholders) is tracked                                                                   |
| Dangerous API usage                         | Static search of `backend/`, `frontend/`, `shared/` for `child_process`, `exec`/`spawn`, `eval`, `new Function`, `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, and file read/write APIs                                                    | **None present.** The only `exec` calls are fixed SQLite DDL and transaction statements (no interpolation); no SQL is built by string concatenation                        |
| Automated security regression tests         | `backend/test/security.test.ts` plus the existing `app`, `client`, `config`, `contracts`, `pdf`, `repository` suites                                                                                                                                   | All 101 backend tests pass (see the requirements matrix)                                                                                                                   |
| Browser accessibility and error-state audit | `scripts/ui-audit.mjs` and `e2e/**/*.spec.ts` (48 tests, real Edge)                                                                                                                                                                                    | All pass; axe reports 0 violations of any impact over 45 states at two viewports (see [requirements-matrix.md](./requirements-matrix.md))                                  |
| Load and resource behaviour                 | `scripts/load-test.mjs` (one run, development laptop)                                                                                                                                                                                                  | 0 server errors; clean `QUEUE_FULL` back-pressure; read latency rises while simulations run (see the findings below)                                                       |

## What the automated tests actually prove

- **Prompt-injection boundary** (`security.test.ts`): with a hostile source document and question, 10
  model calls across the knowledge, environment and simulation stages carried the hostile text **only**
  in the untrusted `data` argument and **never** in the trusted `instructions`. The wire format
  (`client.test.ts`) places `data` under an `untrustedScenarioData` key behind a system boundary that
  states the model has no tools.
- **Hostile provider output** (`security.test.ts`): invented citations (`S999`), decisions for proxies
  outside the population, and out-of-range opinion values are each rejected with `MODEL_OUTPUT_INVALID`;
  the stage ends `failed` and nothing is persisted as complete.
- **Log hygiene** (`security.test.ts`): with a provider that returns 401 containing the API key and a
  marker, debug logs, the project JSON and the JSON export contain none of: the key, the provider body,
  the source-text marker, a query-string secret, or an `Authorization` header value.
- **Browser boundary** (`security.test.ts`, `app.test.ts`): foreign Origins and spoofed Host headers are
  refused (including preflights); no permissive CORS header is ever emitted; non-JSON bodies are
  rejected; provider requests use `redirect: 'error'`.
- **Input handling** (`contracts.test.ts`, `pdf.test.ts`): traversal-style and control-character
  filenames, binary content, oversize and corrupt PDFs are rejected before use.
- **Integrity** (`whatif.test.ts`): checkpoints are accepted only when the history and every platform
  agree; tampered checkpoints are refused; branches never modify their parent.
- **Rate limiting** (`security.test.ts`): the 21st request in a minute to a 20-per-minute route returns
  HTTP 429 `RATE_LIMITED` with a request ID and `Retry-After`; the new `RATE_LIMIT_SCALE` setting is
  validated (integer 1–1000) and defaults to 1. **This test found a real defect:** the limiter previously
  answered HTTP 500 `INTERNAL_ERROR`, so users never saw the intended message and the server logged
  false errors. Fixed in `backend/src/app.ts`.
- **Hostile HTTP in a real browser stack** (`e2e/local/errors.spec.ts`): foreign Origin → 403
  `ORIGIN_NOT_ALLOWED`; a 700 KB body → 413; a `text/plain` body → 4xx and nothing created.

## Findings

| #   | Finding                                                                                                     | Severity                                                 | Status                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `fast-uri` advisories (5 moderate)                                                                          | Moderate                                                 | **Fixed** (dependency bump); CI gate is `npm audit --audit-level=high`                                                                                |
| 2   | No authentication or authorisation; any local process can use the API                                       | High _if exposed_; low on loopback by design             | **Open by design.** Loopback bind plus Host/Origin allowlists are the only controls. Never expose the port. Entra ID, tenancy and RBAC are P2         |
| 3   | The PDF worker is a thread with resource limits, not an OS sandbox                                          | Medium                                                   | **Open.** A memory-safety bug in the PDF library would execute as the app user. Mitigations: size/page/time/heap limits, no credentials in the worker |
| 4   | Prompt-injection resilience of a _live_ model is unverified                                                 | Medium                                                   | **Open.** Structural defences are tested with doubles; a live-model red-team run is blocked on a provider credential                                  |
| 5   | CSP permits `style-src 'unsafe-inline'`                                                                     | Low                                                      | **Open** (inline styles used by the UI)                                                                                                               |
| 6   | No cross-project tamper-evident audit log; no token or cost budget                                          | Medium for production                                    | **Open** (P1/P2)                                                                                                                                      |
| 7   | No SBOM, provenance attestation or automated dependency updates                                             | Low                                                      | **Open** (P2)                                                                                                                                         |
| 8   | The `data-sync-check` SQLite files seen in local agent checkpoint refs                                      | Informational                                            | They exist only in local, unpushed tooling refs (an empty test database); nothing was pushed to GitHub                                                |
| 9   | Rate-limited requests returned HTTP 500 `INTERNAL_ERROR` instead of 429                                     | Low (availability messaging and false server-error logs) | **Fixed**; regression test asserts status, code, request ID and `Retry-After`                                                                         |
| 10  | Reads slow to p95 ≈ 570 ms (max ≈ 1.8 s) while simulations run: the API and the rounds share one event loop | Low locally; Medium if exposed to many users             | **Open.** A user-driven denial of service within the queue and rate limits; simulation should move off the API process (roadmap P2)                   |
| 11  | `RATE_LIMIT_SCALE` can raise every request limit up to 1000×                                                | Low                                                      | **Accepted.** It is operator configuration only (environment), validated, defaults to 1, and is documented as for tests and load tests                |

## Not covered by this review

Penetration testing, fuzzing of the PDF parser, sustained (soak) and distributed load/DoS testing,
review of provider-side data handling, and any behavior of a live model. One local load run exists
(`scripts/load-test.mjs`); it is a measurement for one machine, not a capacity guarantee. These gaps
are listed in the roadmap.
