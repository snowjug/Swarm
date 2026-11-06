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
