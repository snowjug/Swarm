# Public edition: progress

If the context of the person or agent doing this work is lost, read this file, then continue from the last phase
that is marked done. Each phase ends with an entry here and a commit.

Branch: `feat/swarm-public-edition`, from `feat/swarm-production-v1` at `3926bd9e5afb203e393d41cbbf602f21377cc7c9`.
Owner decisions are collected in [DECISIONS-FOR-OWNER.md](DECISIONS-FOR-OWNER.md).

## Phase 0: preflight

**Done**

- The tree was clean at the start. `gh` was already signed in as `snowjug`.
- Branch created. Baseline of typecheck, lint, unit tests and build written to [baseline.md](baseline.md).

**Next**: Phase 1, read and design: `DESIGN.md`, committed before any code.

**Decisions**: lint means `eslint` with `.scratch/**` ignored, because that scratch directory is not in git.

**Open issues**: the end-to-end suites were not re-run for the baseline (see baseline.md for why).

## Phase 1: read and design

**Done**

- Read the auth, session, role, guard and route-policy code, the storage layer (SQL interface, PostgreSQL bridge,
  migrations, sessions, usage, jobs), the model layer (factory, client, router, cost, routing config), the URL
  ingestion policy, `app.ts` hooks, the frontend entry, and the identity, cost, threat-model and pilot-plan docs.
- Verified against live documentation (read-only): Google's OIDC discovery document and key set, GitHub's OAuth web
  flow (PKCE `S256`, token endpoint) and `/user/emails`, Google's Gemini OpenAI-compatibility page, models resource
  and troubleshooting guide.
- Confirmed with a PGlite probe that roles, `SET ROLE`, `FORCE`-able policies with `WITH CHECK`, and the "a `SET`
  made in a transaction that rolls back is undone" behaviour all work, so row-level security can be tested here.
- Wrote [DESIGN.md](DESIGN.md) (sections a to f, the HTTP contract, the configuration table) and
  [DECISIONS-FOR-OWNER.md](DECISIONS-FOR-OWNER.md) (ten decisions with recommended defaults).

**Next**: Phase 2, public sign-in and isolation: edition config, the public schema track, the identity providers,
users and workspaces, the guard, row-level security with its context, account deletion, the legal stubs, the sign-in
page, and the tests.

**Decisions** (also in DESIGN.md)

- Sign-in: app-level OIDC with Google and GitHub, behind an `IdentityProvider` interface. External ID is not built.
- The public schema is a **separate migration track**, so the pilot's schema version and roll-back are untouched.
- Row security is applied by an idempotent step, only in public mode, on a non-owner role (`swarm_app`) that the
  connection `SET ROLE`s into. SQLite is refused in public mode except for development.
- BYOK uses Gemini's OpenAI-compatible endpoint through the existing `ModelClient`; the free-tier cap is a `spend`
  gate in the client that reserves the worst case before each round trip and settles after.
- A BYOK key is held in memory for the length of a run, with one replica (decision 4 for the owner).

**Open issues**: Gemini's `max_completion_tokens` and strict `json_schema` acceptance cannot be confirmed without a
key; the client adapts and the repair loop validates. Row security on the managed Postgres is checked at start-up, not
here.

## Phase 2: public sign-in and isolation (backend done; the pages are being built by a helper)

**Done**

- `SWARM_EDITION=public` and `PublicConfig` (`backend/src/public/config.ts`), with start-up refusals: no base URL, no
  provider, no pepper, a reasoning or unpriced free-tier deployment, `AUTH_MODE` set. Hosted checks for a public
  deployment (`deployment.ts`): https base URL, `TRUST_PROXY >= 1`, bounded sessions.
- A separate migration track for the public tables (`public/storage/migrations.ts`, version row `public_schema`), so
  the pilot's schema version stays 9.
- Row-level security: `storage/scope.ts` (an `AsyncLocalStorage` scope), `storage/postgres/row-security.ts` (classes
  for every table, an idempotent apply step, a start-up self-check that refuses to start if the isolation is not in
  force), a per-statement context applied by the connection's worker only when it changes and forgotten on rollback or
  reconnect, and `asSystem` / `asTenant` / `inProjectScope`. Without a scope the database refuses (fail closed).
  The platform's own work is explicitly system: sessions, the audit chain's writes, the job queue's claim and upkeep,
  start-up recovery (repository, research, analysis), the ping, and job bodies run in their project's workspace.
- Identity providers behind an interface: Google (OIDC, JWKS-verified ID token, nonce, `email_verified`) and GitHub
  (OAuth with PKCE, primary verified address). Sign-in start/callback/logout, new session at every sign-in, `__Host-`
  cookie, CSRF header plus `Sec-Fetch-Site`, open-redirect guard, signup switch, blocked domains, throttling by hashed
  address, Turnstile hook (off by default), disabled accounts.
- Accounts: a private workspace owned by one account, no member routes (404), no bearer tokens, administrators decided
  from the verified address on every request. `GET/DELETE /api/account`, `GET /api/public/{session,status,legal/:doc}`.
  Deletion removes every project, membership, session and usage row in one transaction, keeps only the audit log and a
  keyed counter (retention configurable, 0 keeps nothing).
- The terms and privacy stubs (`legal/`, copied into the image) are marked NOT YET REVIEWED.
- The page is told it is the public edition by a `<meta>` tag added to `index.html` in public mode only.

**Tests** (all on PostgreSQL via PGlite with row security in force): `rls.test.ts` (11, the database boundary without the
application), `auth.test.ts` (44), `isolation.test.ts` (10: every project route as another user, then the same with the
application-level checks removed), `pilot-unchanged.test.ts` (7). Existing suites that touch the shared code were run
unchanged: 737 tests in 19 files pass; the 20th passed on its own (a PGlite start-up timed out under load).

**Next**: Phase 3, the usage ledger and the free tier (reserve and settle in the model client, caps, kill switch,
admin usage, the meter endpoint).

**Decisions**: Row security is enabled but not forced (the owner must be able to migrate); the isolation proof is the
self-check plus the tests. The free tier's per-role output caps are a wrapper around the free client, not a router
change. A test seam (`wrapGuard`) lets a test remove the application's checks to see what the database alone does.

**Open issues**: the sign-in page, account page and landing page are in the frontend helper's hands; the browser journeys
are Phase 8.

## Phase 3: the free tier on the owner's credits, with hard caps

**Done**

- A **spend gate** in the model client (`models/spend.ts`, `models/client.ts`): asked before every provider round trip,
  told what happened after. A reply is charged as reported (a cut-off or refused reply too), a request sent and never
  answered at its worst case, a request the provider refused or that never reached it is released. Inert in the pilot
  (a pilot gives its clients no gate).
- The **usage ledger** (`public/storage/ledger.ts`): per person per UTC day, per account lifetime, and for the whole tier,
  updated by conditional `UPDATE`s in one transaction, so concurrent requests cannot pass a cap. It reserves the worst
  case (padded input estimate plus the whole output limit, which hidden reasoning tokens are inside), settles with the
  real usage once, counts blocked calls by reason, and sweeps reservations a crash left behind.
- **Funding**: every model made in public mode is made for a funding context (`public/funding.ts`, an
  `AsyncLocalStorage`): the free tier or the person's own key. With none, the model refuses (`NO_FUNDING_CONTEXT`), so
  there is no path to the owner's credits that does not go through a signed-in person. A project records a funding
  marker, and a queued run is paid for as its project says.
- **Free tier model**: the operator's non-reasoning deployment, declared to the client as taking no reasoning effort,
  held to a per-role output cap (`models/gateways.ts`). Per-project caps default to 300 calls and 400,000 tokens, and 0
  is refused at start-up.
- **Cap states**: user day, user lifetime, whole tier, in flight, and switched off, each a plain message with one next
  action (HTTP 429 `FREE_TIER_*`), never an ugly failure. The tier counts as used up when less than one run is left of a
  cap, which is also what the meter's "runs left" says.
- **Kill switch**: `FREE_TIER_ENABLED` (environment, wins), the run-time flag and `POST /api/admin/free-tier`, and
  `POST /api/ops/free-tier/off` for the budget automation (a key whose SHA-256 is compared in constant time; it can only
  turn the tier off). Admin: spend by day, top accounts, blocked calls, disable a user, disable sign-ups, audit.
- **What a stranger is told**: `GET /api/usage` (the meter), and in public mode `/api/provider/status`,
  `/api/provider/check` and `/api/config` describe the caller's own funding, with no deployment name, no endpoint and no
  other person's counters. `check` makes no model call.
- One workspace has at most one run at a time (`RUN_IN_PROGRESS`).

**Tests**: `ledger.test.ts` (20, on SQLite and PGlite), `ledger-race.test.ts` (writers on separate connections released
together, with the caps read while they run; it fails if a cap is weakened, which was checked), `freetier.test.ts` (20:
through a fake Azure deployment: caps, the cap-reached state, kill switch in three forms, the meter, admin view, the
model chip, configuration). All 114 public tests pass, and the 45 existing suites that touch the changed modules pass
unchanged (1,607 tests). One public test timed out once under load (a PGlite start-up) and passed alone.

**Next**: Phase 4, bring your own key with Gemini: the provider, the in-memory key store, header handling and
redaction, `POST /api/byok/connect`, plain-language errors, and the fake Gemini server tests including the no-leak
canary.

**Decisions**: the input estimate is padded by half again plus 64 so a provider that counts more than the characters
cannot slip past a cap; what is beyond it is bounded by one call's input and is what the budget alert backs up. The
indicator and the call-level refusal are separate: the indicator says "used up" when under one run is left, the ledger
refuses a call on that call's worst case.

**Open issues**: no real PostgreSQL server was raced (only SQLite threads and PGlite); the test is ready for one
(`SWARM_TEST_POSTGRES_URL`). Cost is estimated from `MODEL_PRICES`, not read from Azure.
