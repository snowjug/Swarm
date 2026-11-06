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

## Phase 4: bring your own key (Google AI Studio / Gemini)

**Done**

- **The provider**: Gemini through its OpenAI-compatible endpoint, host a constant (`byok/provider.ts`), reached by the
  existing `ModelClient` (strict schema, a reasoning effort, no temperature, the same retry, truncation and repair
  handling as the Azure path), with `max_completion_tokens` falling back to `max_tokens` once if Google does not know
  it. Google's errors are read for their kind (`byok/errors.ts`) and raised in our words with a code the page knows;
  a quota or a bad key is not asked again, a limit per minute is. The models are asked of the API at "Connect" and the
  default is chosen by rule (`byok/connect.ts`), never named in code.
- **Key handling**: the first `onRequest` hook takes the three headers out of the request and registers the key; it
  lives only in the funding of the request and, for a queued run, in an in-memory store per workspace
  (`byok/keys.ts`: 90 minutes idle, 4 hours absolute, forgotten on "Forget key", sign-out, deletion and shutdown). A key is
  refused over a connection that is not encrypted, and is never taken as a request for the free tier when bringing a key
  is off. A **redaction layer** (`byok/secrets.ts`) removes a key from every log line, error message, string response
  and audit entry, by what the server was handed and by shape.
- **Routes**: `POST /api/byok/connect` (one request that uses no tokens, five plain statuses, limited per account),
  `DELETE /api/byok`, and `/api/provider/status|check` that describe the key.
- **Funding**: a run on a key finds the key in memory, or stops with `BYOK_KEY_NEEDED` and never uses the free tier. A
  project's funding marker only changes while it is not working. Calls are counted for the person's own meter and
  concurrency, never against the free tier, so a used-up or switched-off free tier never blocks a key.
- **Honest labels** (`models/identity.ts`): results, runs and proposals made with a key say `gemini` and the model the
  person chose, and a project is not moved between funding sources without `MODEL_CHANGED`. The operator's deployment name
  was in those labels, and is not any more for a key.
- **Kept apart**: its own memory of refusals, routing and counters, so neither funding teaches the other.
- The free tier's failures are worded for a stranger (no deployment, endpoint or setting names), with the codes kept.
- `docs/public/ISOLATION.md` lists every route and what isolates it, generated from the registry and checked by a test.

**Tests**: `byok-parts.test.ts` (33) and `byok.test.ts` (34, through the whole app with a fake Azure and a fake Gemini): a
valid, invalid, rate-limited, over-quota and wrong-region key, a reply cut off, a reply that fails the schema, a block,
the token-field and effort fallbacks, the free tier used up and switched off, a run whose key is gone, an unencrypted
connection, bringing a key switched off, the concurrency cap, and a canary key over a whole session in every log line,
response, audit entry and table column (with the scan shown to find a planted key and three of the tests shown to fail
without the redaction layer). The full suite was run once: 9,275 passed; 4 failed, of which two were environmental (a port
in use; a temporary-folder snapshot while another process wrote there) and passed alone, and two were real and are fixed
(two security-mutation anchors that Phase 2's indentation had moved, and a link in the deploy guide).

**Next**: Phase 5, abuse protection: rate limits per account and per address, project and storage quotas, headers,
errors without internals, the bot-check test, SSRF and prompt-injection tests through the public routes.

**Decisions**: one key per person (per workspace), not per project. A key that fails a check is not kept. The default model
is the newest stable flash model the key lists. Google's quota errors are told apart by the quota's own name (per minute
or per day), and an unknown 429 is read as a plan limit when it says so and as a limit to wait out when it does not.

**Open issues**: nothing was tried against Google: the compatibility layer's acceptance of `max_completion_tokens` and of
each strict schema, and the exact shapes of its errors, are from its documentation (section 11 of DESIGN.md). The page does
not yet call `DELETE /api/byok` on "Forget key" (the key is forgotten by the server after at most 90 idle minutes), and its
model chip does not send the key with `GET /api/provider/status`: both to be settled when the page is reviewed.

## Phase 5: abuse protection

**Done**

- **Rate limits** (`public/abuse.ts`, an `onRequest` hook after the guard): every change an account makes is held to 300
  in five minutes, and the five kinds of request that cost something (a project made, text stored, work by a model, a web
  page read, a file read) each have a limit for the account and one of three times that for the address. Defaults:
  20, 60, 120, 30 and 30 an hour (`PUBLIC_RATE_*`, scaled by `RATE_LIMIT_SCALE`). A refusal is `429 RATE_LIMITED` with
  `Retry-After` and "Wait N minutes", is counted as a blocked request, and is written as `public.rate.limited`.
- **Quotas**: `PROJECT_LIMIT` (409) and `STORAGE_LIMIT` (413) when a project is made or text is added; deleting is never
  refused. Recorded as `public.quota.refused`.
- **Audit**: `context.auditOnce` writes an event once in ten minutes for an account and a kind, so a hammered button
  cannot fill the log. `public.free.blocked` and `public.byok.blocked` (the reason) are new, and refusals while the free
  tier is off or a model cannot be priced are now counted among the blocked requests (they were not).
- **Headers**: a `Permissions-Policy` that denies every feature the page does not use, in public mode only; the policy
  is widened for Cloudflare's host only when Turnstile is configured.
- **Config**: in public mode why the operator's model is not set up is the plain "The free tier is not set up on this
  site.", and the web is read on ports 80 and 443 only, whatever `URL_INGEST_ALLOWED_PORTS` says.
- The bot check, the open-redirect rules, the CORS and origin rules, the free-tier failure wording and the admin switches
  were already built in Phases 2 to 4; they are now tested through the whole stack (below).

**Tests** (`backend/test/public/`): `abuse.test.ts` (20: the limits per account and per address, a window that ends, a
refused request that counts for nothing, the kinds, the audit throttle and its contents; the quotas; the headers and the
policy on every kind of answer, CORS, origin
and host; the bot check with a fake, including a Cloudflare that is down; errors scanned for frames, paths, SQL, table
names, the deployment and the endpoint's host, in answers, headers and the log; size, type and file limits; a script in a
document staying text; the record scanned for e-mail, address, key and document text), `ssrf.test.ts` (8: 25 written forms
of an address inside the network and seven internal names, names that resolve inside, ports, a PDF with every kind of
reference aimed at a canary, addresses only written in documents, the crawler off; the canary is never reached) and
`injection.test.ts` (5: a model that obeys a planted instruction is refused on both fundings, the planted text is only
ever data, a model is sent the caller's own text and nothing of anyone else or any credential). The pilot's suites for the
files this phase touched (config, deployment, app, auth, url-config, url-route, foundry-config) still pass.

**Next**: Phase 6, the page (built by a helper, to be reviewed and committed), then Phase 7 (infrastructure, built by a
helper) and Phase 8.

**Decisions**: limits are held in the memory of one process, which is exact with the one replica the template allows
(DESIGN §11). An address limit is three times an account's, so people who share an address (an office, a school) are not
held to one person's limit. A refused request counts for nothing: the limits are checked together, and only a request that
is let in is counted, so being turned away by the address, or by a quota, never uses up an account's own limits.

**Open issues**: the redirect, rebinding and size rules of reading a web page are the fetcher's own and were not tried
again through the public routes (a test cannot listen on port 80); the rate limits are per process; Turnstile was only
tried against a fake.
