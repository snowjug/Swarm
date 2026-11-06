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
