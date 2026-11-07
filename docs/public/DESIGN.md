# Public edition: design

Status: design only, written and committed before any code (Phase 1). It is the contract the later phases build to
and are tested against. Where a later phase has to differ, it changes this file in the same commit and says why in
[PROGRESS.md](PROGRESS.md).

Contents

1. [Goal and scope](#1-goal-and-scope)
2. [How sign-in, roles and membership work today (a)](#2-how-sign-in-roles-and-membership-work-today-a)
3. [Public mode (b)](#3-public-mode-b)
4. [The sign-in choice (c)](#4-the-sign-in-choice-c)
5. [Data isolation (d)](#5-data-isolation-d)
6. [Free tier, quota and cost (e, Phase 3)](#6-free-tier-quota-and-cost-e-phase-3)
7. [Bring your own key (e, Phase 4)](#7-bring-your-own-key-e-phase-4)
8. [Abuse protection (e, Phase 5)](#8-abuse-protection-e-phase-5)
9. [HTTP contract](#9-http-contract)
10. [Threat model for public mode (f)](#10-threat-model-for-public-mode-f)
11. [What cannot be verified here](#11-what-cannot-be-verified-here)

## 1. Goal and scope

A "public edition" of Swarm that anyone on the internet can use:

1. **Free tier**: a signed-in person runs the app on the owner's Azure OpenAI / Foundry credits, under strict
   per-user and global limits and a spend kill-switch.
2. **Bring your own key (BYOK)**: a person pastes their own Google AI Studio (Gemini) key and uses the app on
   their own quota, without touching the owner's credits.
3. **Public sign-in**: anyone can sign up and sign in without being in the owner's Microsoft Entra tenant.

The existing tenant-only pilot keeps working **unchanged**. The public edition is a separate deployment mode of the
same code, chosen by configuration, with its own resource group, database and secrets (Phase 7). Nothing here is
deployed by this work.

Not in scope: payments, teams or shared workspaces, e-mail or password accounts, other model providers than Gemini
(the provider seam is there; only Gemini is built), moderation of what people write, and any change to what the
pilot does.

## 2. How sign-in, roles and membership work today (a)

Everything below is the **pilot**, read from the code at the base commit. File paths are relative to `backend/src/`
unless they start with `docs/`.

### Sign-in

- **Two ways in** (`auth/guard.ts`, `authenticate`): an `Authorization: Bearer` access token for API clients, or a
  server session cookie for the browser. Nothing else; with no credential the answer is 401 `SIGN_IN_REQUIRED`.
  `AUTH_MODE=none` (the default, for a loopback address) skips all of it: one local user owns everything.
- **Browser sign-in** (`routes/session.ts`, `auth/oidc.ts`): Microsoft Entra, Authorization Code with PKCE (S256),
  run on the server. `/auth/login` stores a login attempt (state, a browser-binding value, nonce, verifier) as
  hashes and redirects; `/auth/callback` consumes the attempt once, redeems the code, verifies the **ID token**
  (`auth/tokens.ts`, `verifyIdToken`), creates a session (`storage/sessions.ts`) and sets the cookie. The browser
  never sees a token. The access token Entra may return is discarded unread.
- **Token checks** (`auth/tokens.ts`): signature against Microsoft's key set (RS256), issuer, audience, expiry,
  `oid` and `tid`, and for an ID token the nonce. The **tenant must be in `AUTH_ENTRA_ALLOWED_TENANTS`**, and the
  issuer is derived from the token's own tenant only after that allow-list agrees. A bearer token that carries a
  nonce is refused, so an ID token cannot be replayed as an access token.
- **The role requirement** (`auth/tokens.ts`, `principal`): a token without a Swarm app role in `roles`
  (`Swarm.User` and the others, `auth/roles.ts`) is refused with 403 `NO_ROLE`. The app role only lets a person in;
  what they may do comes from membership.
- **The session cookie** (`auth/cookies.ts`, `routes/session.ts`): an opaque 256-bit random identifier; only its
  SHA-256 is stored (`sessions` table). `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` and the `__Host-` prefix
  unless the redirect is plain-http loopback. Lifetime: 30 minutes idle, 8 hours absolute (`AUTH_SESSION_*`).
- **CSRF**: every change made with a cookie must carry `X-Swarm-CSRF: 1`, which another site cannot make a browser
  send without a pre-flight that the origin allow-list refuses (`auth/guard.ts`, `app.ts`). `safeReturnTo` keeps a
  redirect on the site.

### Roles and membership

- **A workspace is a tenant** (`auth/roles.ts`, `docs/production/identity.md`): the principal's `tenantId` is the
  Entra tenant. Workspace roles `owner | admin | member` are rows in `workspace_members(tenant_id, principal_id,
role)`; project roles `lead | analyst | reviewer | viewer` are rows in `project_members`. Each role maps to
  capabilities (`create-project`, `manage-members`, `check-provider`, and per project `read`, `run`, `edit`,
  `review`, `export`, `delete`, `members`, `budget`, `chat`).
- **The first owner** (`auth/access.ts`, `workspaceRoleOf`): a principal with the bootstrap-admin app role may
  become the owner of a workspace that has none.
- **Adding a person to a project adds them to the workspace** (`storage/members.ts`, `setProjectMember`), and
  removing a workspace member removes their project roles and sessions. Members are addressed by Entra object id.
- **The platform administrator** (`Swarm.PlatformAdmin`) runs the platform (a paid model check, the audit chain's
  integrity) and gets **no** access to any workspace's projects.
- **The route table** (`auth/policy.ts`, `ROUTE_POLICY`): every `/api` route has an entry of kind `public`,
  `signed-in`, `platform`, `workspace` (a capability) or `project` (a capability). A route without an entry is
  refused (403 `ROUTE_NOT_AUTHORIZED`), and `backend/test/auth.test.ts` fails if a route and the table disagree.
- **The guard** (`auth/guard.ts`, `registerAuth`): an `onRequest` hook for `/api`. Policy lookup, authentication,
  workspace role, project role, in that order. A project of another tenant, or one the caller was not added to, is
  reported as 404 `PROJECT_NOT_FOUND`. Membership is read from the database on every request.
- **Limits that exist** (`app.ts`, `config.ts`): per-IP rate limit (`@fastify/rate-limit`, 120 a minute, scaled by
  `RATE_LIMIT_SCALE`, tighter on expensive routes), host and origin allow-lists, 600 KB body limit (2.7 MB for PDF
  extraction), helmet with a strict CSP, `cache-control: no-store` on `/api`, error bodies that carry a code, a
  message and a request id only, a per-project model budget (`PROJECT_MODEL_CALL_LIMIT`, `PROJECT_MODEL_TOKEN_LIMIT`)
  and per-operation budgets (`MODEL_OPERATION_*`), 100 projects, 500 workspace members and 100 project members.
- **Known gaps** (`docs/production/identity.md`): **no database row-level security** (tenant isolation is
  application code), no "sign out everywhere", a platform-admin role read once at sign-in, and per-process rate
  limits.

### Where a model is reached

Every model use goes through one function, `ModelFactory(onUsage, options)` (`models/factory.ts`), and almost every
caller passes `repository.modelUse(projectId)` as the usage sink. The factory builds a `ModelClient`
(`models/client.ts`), which owns the retry, truncation and repair loop, and whose `request()` is the one place that
makes an HTTP call to a provider (`redirect: 'error'`, bounded reads). The router (`models/router.ts`) picks the
deployment and per-role output budget from configuration; `FOUNDRY_DEPLOYMENT_*`, `FOUNDRY_DEPLOYMENT_PROFILES` and
`MODEL_PRICES` already let an operator name a non-reasoning deployment and its prices.

## 3. Public mode (b)

### The switch

`SWARM_EDITION=pilot|public`. Default `pilot`. In `pilot` **no public code runs**: no route, no table, no hook, no
header handling, no database role. That is the property the tests prove (section 3.5).

### What changes in `public`

| Concern                | Pilot (today)                                         | Public                                                                      |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Who may sign in        | Members of `AUTH_ENTRA_ALLOWED_TENANTS` with a role   | Anyone whose Google or GitHub account has a **verified** e-mail address     |
| Tenant allow-list      | Required                                              | Not used: there is no tenant. Each person has a private workspace           |
| Role requirement       | An app role is required (`NO_ROLE`)                   | None. Every account is the owner of its own workspace                       |
| Principal              | `{oid, tid}` from the token                           | `{id: u_…, tenantId: w_…}` made by the server at sign-up                    |
| Bearer tokens          | Accepted                                              | **Refused**. The cookie is the only way in                                  |
| Members and sharing    | Workspace and project member routes                   | **Refused** (404): nobody can be added to a workspace or a project          |
| Platform administrator | App role `Swarm.PlatformAdmin`                        | A verified e-mail listed in `PUBLIC_ADMIN_EMAILS`                           |
| Model                  | One deployment, paid by the operator, no per-user cap | Free tier on a non-reasoning deployment under caps, or the person's own key |
| Database               | App-level tenant checks                               | App-level checks **and** Postgres row-level security                        |
| Research crawler       | On by default                                         | Off unless `PUBLIC_ALLOW_RESEARCH=1`                                        |
| Provider status        | Operator's deployment and counters                    | The caller's own funding only; operator internals only for the admin        |
| Replicas               | Not limited by the code                               | One (a BYOK key lives in memory), enforced in the infrastructure template   |

A person's workspace is created in the same transaction as the account, with one `workspace_members` row that makes
them its `owner`. Because every route already scopes by `tenantId` and by membership, **the existing
authorization table, guard and storage queries keep working unchanged**; public mode only changes how a principal
is made, what is refused outright, and what funds a model call.

### Modules

All public-edition code lives under `backend/src/public/`. The modules that do any work are loaded with a dynamic
`import()` only when the edition is `public` (`backend/src/app.ts`), so a pilot never reads them; the one public module
a pilot does import is `public/config.ts`, a pure parser that runs only when `SWARM_EDITION=public`. Small, reviewed
seams touch shared code:

| Seam                                   | Change                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `config.ts`                            | `SWARM_EDITION`, a `PublicConfig` built only when public, `AuthConfig.mode` gains `public`             |
| `auth/guard.ts`                        | a `public` authenticator (cookie only, user row checked on every request), member routes refused       |
| `storage/sql.ts`, `storage/postgres/*` | an optional row-security context (section 5); a no-op for SQLite and for pilot                         |
| `storage/repository.ts`                | opens the public schema track and row security **only** when asked to                                  |
| `models/client.ts`                     | an optional `spend` gate per round trip; the `gemini` provider name; no change when the gate is absent |
| `models/factory.ts`                    | `createPublicModelFactory` wraps the base factory                                                      |
| `app.ts`                               | registers the public hooks and routes when public                                                      |

### 3.5 Proving that pilot is unchanged

- A pilot `Repository` has no `public_*`, `usage_*` or `project_funding` table, the schema version is still
  `LATEST_SCHEMA_VERSION` (9), and no `set_config`, `SET ROLE`, `CREATE POLICY` or `ENABLE ROW LEVEL SECURITY`
  statement is ever sent (a recording `SqlDatabase`).
- A pilot app registers **no** `/auth/start/*`, `/auth/callback/*`, `/api/public/*`, `/api/account`, `/api/usage`,
  `/api/byok/*`, `/api/admin/*` or `/api/ops/*` route, and `ROUTE_POLICY` has exactly the keys it has today
  (snapshot test).
- A pilot app ignores the BYOK headers entirely and never creates a Gemini client.
- The existing suites (`auth`, `security`, `members`, `session`, `app`, the model tests) pass unchanged. Phase 8
  runs them again and compares with [baseline.md](baseline.md).
- The public schema is a **separate migration track** (its own version row, not `PRAGMA user_version`), so it
  never bumps the pilot's schema version and never blocks the pilot's roll-back story
  (`docs/production/release-process.md`, "Schema migrations only go forward").

### Configuration

New names, all read in `config.ts`. A bad value stops start-up and names the variable, never repeating its value.
Defaults are deliberately conservative. A value marked **required** must be set in public mode.

| Variable                                        | Default       | Meaning                                                                                                                                                                                   |
| ----------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SWARM_EDITION`                                 | `pilot`       | `pilot` or `public`                                                                                                                                                                       |
| `PUBLIC_BASE_URL`                               | **required**  | `https://…` origin of the site (`http` only for localhost). Redirect URIs derive from it                                                                                                  |
| `PUBLIC_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET`    | unset         | Google sign-in is offered only when both are set                                                                                                                                          |
| `PUBLIC_GITHUB_CLIENT_ID` / `_CLIENT_SECRET`    | unset         | GitHub sign-in likewise. At least one provider is required                                                                                                                                |
| `PUBLIC_ADMIN_EMAILS`                           | empty         | Comma-separated verified e-mails that are platform administrators                                                                                                                         |
| `PUBLIC_SIGNUPS_ENABLED`                        | `true`        | Starting value of the "signups open" switch (the admin can flip it at run time)                                                                                                           |
| `PUBLIC_GUEST_MODE`                             | `false`       | Guest mode: "Try it now" gives a visitor a temporary private workspace with no sign-in, and then no OAuth provider is required. New guests obey `PUBLIC_SIGNUPS_ENABLED`                  |
| `PUBLIC_BLOCKED_EMAIL_DOMAINS`                  | empty         | Comma-separated domains that cannot sign up (disposable mail)                                                                                                                             |
| `PUBLIC_MAX_PROJECTS`                           | `10`          | Projects per workspace                                                                                                                                                                    |
| `PUBLIC_STORAGE_QUOTA_MB`                       | `20`          | Stored text per workspace                                                                                                                                                                 |
| `PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS`         | `30`          | How long the keyed counter of a deleted account is kept (section 4.6)                                                                                                                     |
| `PUBLIC_ALLOW_RESEARCH`                         | `false`       | Allow the web-research crawler                                                                                                                                                            |
| `PUBLIC_DB_RUNTIME_ROLE`                        | `swarm_app`   | The role that row security is enforced on (section 5)                                                                                                                                     |
| `PUBLIC_ALLOW_UNSAFE_SQLITE`                    | `false`       | Development only: SQLite has no row security, so public mode refuses it without this                                                                                                      |
| `PUBLIC_OPS_KEY_SHA256`                         | unset         | SHA-256 (hex) of the key the budget automation presents (section 6.6)                                                                                                                     |
| `PUBLIC_OWNER_KEY_SHA256`                       | unset         | SHA-256 (hex) of the owner's key, sent only in the header `X-Swarm-Owner-Key`: turns the free tier and sign-ups (guests included) on or off and reads the usage with no sign-in           |
| `PUBLIC_PEPPER`                                 | **required**  | A secret of at least 32 characters. Keys the hashes of addresses (sign-up throttling) and of deleted accounts. Keep it in Key Vault; changing it forgets the counters of deleted accounts |
| `PUBLIC_SIGNUPS_PER_IP_PER_DAY`                 | `5`           | New accounts one address may make in 24 hours                                                                                                                                             |
| `PUBLIC_SIGNUPS_PER_HOUR`                       | `60`          | New accounts the whole site may make in an hour                                                                                                                                           |
| `PUBLIC_IP_REQUESTS_PER_MINUTE`                 | `120`         | What one address may request in a minute (30 to 1,200), the page's own files and the polling of a run included. Raise it for a room behind one address; `RATE_LIMIT_SCALE` stays 1        |
| `PUBLIC_GUESTS_PER_IP_PER_HOUR`                 | `10`          | New guests one address may make in an hour                                                                                                                                                |
| `PUBLIC_GUESTS_PER_HOUR`                        | `300`         | New guests the whole site may make in an hour                                                                                                                                             |
| `PUBLIC_GUEST_RETENTION_HOURS`                  | `24`          | A guest's data is deleted after this many hours without use                                                                                                                               |
| `PUBLIC_ALLOW_REASONING_DEPLOYMENT`             | `false`       | Lets a deployment that reasons serve the free tier. Off: start-up refuses one                                                                                                             |
| `AUTH_SESSION_IDLE_MINUTES` / `_ABSOLUTE_HOURS` | `30` / `8`    | A session ends after this long idle, and this long after sign-in (a hosted deployment allows at most 60 and 12)                                                                           |
| `FREE_TIER_ENABLED`                             | `true`        | Hard switch from the environment; `false` wins over the run-time switch                                                                                                                   |
| `FREE_USER_DAILY_TOKENS`                        | `60000`       | Tokens (input + output + hidden reasoning) one person may use per UTC day                                                                                                                 |
| `FREE_USER_DAILY_CALLS`                         | `40`          | Model round trips one person may make per UTC day                                                                                                                                         |
| `FREE_USER_LIFETIME_TOKENS`                     | `300000`      | Tokens one account may ever use on the free tier                                                                                                                                          |
| `FREE_USER_CONCURRENT_RUNS`                     | `1`           | Runs (queued or running jobs) one workspace may have at once                                                                                                                              |
| `FREE_USER_CONCURRENT_CALLS`                    | `3`           | Model round trips one person may have in flight                                                                                                                                           |
| `FREE_GLOBAL_DAILY_TOKENS`                      | `2000000`     | Tokens all free users together may use per UTC day                                                                                                                                        |
| `FREE_GLOBAL_DAILY_COST_USD`                    | `5`           | Estimated spend all free users together may cause per UTC day                                                                                                                             |
| `FREE_TOKENS_PER_RUN`                           | `15000`       | What "one run" is taken to cost: the meter's "runs left" is what is left divided by it, and a cap counts as reached (the tier "used up") when less than this is left of it                |
| `FREE_GUEST_DAILY_TOKENS`                       | `80000`       | Tokens one guest may use per UTC day (`0`: none, never no limit)                                                                                                                          |
| `FREE_GUEST_DAILY_CALLS`                        | `60`          | Model round trips one guest may make per UTC day (`0`: none)                                                                                                                              |
| `FREE_GUEST_LIFETIME_TOKENS`                    | `240000`      | Tokens one guest may ever use on the free tier (`0`: none)                                                                                                                                |
| `FREE_GUEST_CONCURRENT_RUNS`                    | `2`           | Runs (queued or running jobs) one guest's workspace may have at once                                                                                                                      |
| `FREE_GUEST_CONCURRENT_CALLS`                   | `4`           | Model round trips one guest may have in flight                                                                                                                                            |
| `FREE_GUEST_TOKENS_PER_RUN`                     | `15000`       | What "one run" is taken to cost on a guest's meter                                                                                                                                        |
| `FREE_ROLE_MAX_OUTPUT_TOKENS`                   | table in code | JSON, per model role, at most these output tokens on the free tier                                                                                                                        |
| `BYOK_ENABLED`                                  | `true`        | Allow people to bring a key                                                                                                                                                               |
| `BYOK_MAX_CONCURRENT_CALLS`                     | `4`           | Round trips one person may have in flight on their own key                                                                                                                                |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`   | unset         | Bot protection is on only when both are set                                                                                                                                               |

The model for the free tier is configured with the settings that exist: `AI_PROVIDER=foundry`, `AI_MODEL` (the
non-reasoning deployment, for example a `gpt-4.1-mini` deployment), `FOUNDRY_DEPLOYMENT_PROFILES` declaring it
`reasoning: false`, and `MODEL_PRICES` with a price for it. In public mode **start-up fails** if `FOUNDRY_DEPLOYMENT_REASONING`
is set, if the free deployment is declared as reasoning or its name is one of a known reasoning family (`o1`, `o3`,
`o4`, `gpt-5`) without `PUBLIC_ALLOW_REASONING_DEPLOYMENT=1`, or if it has no price: a cost cap is never enforced
from a guessed price. `MODEL_CACHE` is forced `off`. `FREE_USER_CONCURRENT_CALLS` is at most 50 and
`FREE_USER_CONCURRENT_RUNS` at most 20. `PROJECT_MODEL_CALL_LIMIT` and `PROJECT_MODEL_TOKEN_LIMIT` (the pilot's
per-project caps, which stay as they are there: 0 is no limit) default to **300 calls and 400,000 tokens** in public
mode, and an explicit `0` is refused at start-up: a project that is left to run is how a free tier is spent.

How a deployment is made to hold to this section is in [DEPLOY.md](DEPLOY.md) and `infra/public/`. Four things it relies on
are part of the contract:

- **`AUTH_MODE` stays unset.** The public edition has its own sign-in, and start-up refuses any other value
  (`SWARM_EDITION=public does not use AUTH_MODE`), so none of the pilot's `AUTH_*` variables except the two session limits
  is set.
- **A `FREE_*` cap of `0` means nothing is allowed, never "no limit"** (the pilot reads `0` as no limit for a project's
  budget, which is why a project's `0` is refused here). `FREE_USER_DAILY_TOKENS=0` turns the free tier away for everybody
  at the first call. The template does not allow a `0` for a signed-in person's caps; it does for the three per-guest caps of
  tokens and calls (`FREE_GUEST_DAILY_TOKENS`, `FREE_GUEST_DAILY_CALLS`, `FREE_GUEST_LIFETIME_TOKENS`), where `0` turns guests
  away from the free tier and never means "no limit".
- **`PUBLIC_PEPPER` is never changed once people have signed up.** It keys the hashes of addresses and the counters of
  deleted accounts, so a new value would make every counter of a deleted account unreachable (a deleted account could then
  start over with a full allowance) and would start the sign-up throttle again.
- **The budget automation's webhook** is `POST /api/ops/free-tier/off`, with its key in the query (an action group cannot set a
  header) and a JSON body that is not read. It can only turn the free tier off. Tests send what a budget notice carries,
  with no anti-forgery header and no cookie, and check that the key is in no log line, answer or audit entry
  (`freetier.test.ts`, `abuse.test.ts`).

`scripts/azure` (`azure:release`) is the pilot's tooling: it expects the pilot's Microsoft sign-in redirect and its
multi-revision mode, so for this edition only its `status`, `check` and `build` commands are of use. The public template
runs one revision and at most one replica, and DEPLOY.md gives the commands.

## 4. The sign-in choice (c)

### 4.1 Evaluation

| Question                                    | (1) Microsoft Entra External ID                                                                                                                                                                   | (2) App-level OIDC with Google and GitHub                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Needs a new tenant of the owner's           | **Yes**: an external tenant, created in the owner's subscription                                                                                                                                  | No. Two OAuth client registrations                                                               |
| Can it be created from this situation       | **Unknown and probably not**: the owner works at Microsoft, and creating a tenant, or linking one to the corporate subscription, is a tenant-policy and billing decision that is not theirs alone | Yes, with a personal Google Cloud project and a GitHub OAuth app                                 |
| Who holds the passwords                     | Microsoft (local accounts) or the social providers                                                                                                                                                | Google and GitHub; Swarm holds none                                                              |
| Sign-up UI, MFA, password reset, user flows | Provided                                                                                                                                                                                          | Provided by Google and GitHub                                                                    |
| Cost                                        | Free monthly active users tier, then per user                                                                                                                                                     | Free                                                                                             |
| Verified e-mail                             | Depends on the flow configured                                                                                                                                                                    | Google: the `email_verified` claim. GitHub: the primary **verified** address from `/user/emails` |
| Work in this repository                     | A provider class plus tenant setup that cannot be tested here                                                                                                                                     | Two provider classes, fully testable with fake providers                                         |
| Lock-in and blast radius                    | Tied to Azure                                                                                                                                                                                     | Portable. A provider can be added or removed by configuration                                    |

**Recommendation: (2).** The owner may not be allowed to create a tenant, tenant creation is outside what can be
verified or done from here, and (2) needs nothing from Azure to be tested end to end. The code is written behind an
`IdentityProvider` interface, so External ID (or Apple, or Microsoft personal accounts) is one more class and one
more registration, not a redesign. This is recorded as decision 1 in [DECISIONS-FOR-OWNER.md](DECISIONS-FOR-OWNER.md).

### 4.2 The provider interface (`backend/src/public/identity/`)

```ts
interface VerifiedIdentity {
  provider: 'google' | 'github';
  subject: string; // the provider's stable id for the person: Google `sub`, GitHub numeric id
  email: string; // lower-case, and verified by the provider
}
interface IdentityProvider {
  readonly id: 'google' | 'github';
  readonly label: string;
  authorizeUrl(input: {
    state: string;
    nonce: string;
    verifier: string;
    redirectUri: string;
  }): string;
  complete(input: {
    code: string;
    verifier: string;
    nonce: string;
    redirectUri: string;
  }): Promise<VerifiedIdentity>;
}
```

`complete` throws a `SignInRefused` with a closed-set reason (`provider-error`, `invalid-token`,
`unverified-email`), which the callback turns into a redirect to `/?signin=<reason>`; the reason is for the log and
the audit record, and the page shows a plain sentence. Nothing a provider says is repeated to the person.

- **Google** (OpenID Connect). Endpoints are fixed in code and were checked against Google's discovery document
  (`https://accounts.google.com/.well-known/openid-configuration`): authorization
  `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`, keys
  `https://www.googleapis.com/oauth2/v3/certs`, issuer `https://accounts.google.com`, `RS256`, PKCE `S256`.
  Scope `openid email`. The ID token is verified with `jose` (signature, issuer, audience = our client id, expiry,
  `iat`, `nonce` equal to the one this browser started, `sub`), and **`email_verified` must be `true`**.
  `hd`/Workspace domains are not trusted for anything.
- **GitHub** (OAuth 2.0, not OIDC, so there is no ID token). Authorization `https://github.com/login/oauth/authorize`
  with `code_challenge` (`S256`), token `https://github.com/login/oauth/access_token` with `code_verifier`
  (GitHub's documentation, "Authorizing OAuth apps"). The access token is used for exactly two calls to the fixed host
  `https://api.github.com`: `/user` for the numeric `id`, and `/user/emails` (scope `user:email`) for the address
  that is both `primary` and `verified`. The token is then dropped. There is no nonce in the protocol; the
  login is bound to the browser by `state` and the binding cookie, and to the code by PKCE.

Hosts are constants. A test double replaces the injected `fetch`, never a URL setting; there is no configuration
that points sign-in at another host.

### 4.3 The flow

1. The page calls `POST /auth/start/:provider` (a change, so it needs `X-Swarm-CSRF`). The server checks the
   per-IP sign-in limit and, if enabled, the Turnstile token; makes `state`, `nonce`, a PKCE verifier and a browser
   binding value (256 bits each); stores only their hashes (the verifier and nonce are needed again, so they are kept
   with the attempt, which lives 10 minutes and is deleted on first use); sets the short-lived binding cookie
   (`HttpOnly; SameSite=Lax; Secure; __Host-`); and answers `{ url }`. The page navigates to it.
2. The provider returns the browser to `GET /auth/callback/:provider?code&state`. The attempt is **consumed once**
   whatever follows. The binding cookie must match, the attempt must be under 10 minutes old, and the provider in
   the path must be the one that started it.
3. `complete()` redeems the code with PKCE and returns a verified identity, or the flow ends.
4. The server finds the account by `(provider, subject)`. **A new account is made only if signups are open, the
   e-mail domain is not blocked, the per-IP and global signup limits allow it, and the address is verified.** The
   account, its workspace and its `owner` row are made in one transaction.
5. A **new session** is created (a new identifier every time, so a fixed one cannot be planted), the cookie is set
   and the browser is redirected to a `safeReturnTo` path. A disabled account is refused here and on every request.

There is **no automatic linking across providers**: the same e-mail address through Google and through GitHub is two
accounts, because linking on an address is how accounts are taken over. This is stated on the sign-in page.

### 4.4 Session cookie and CSRF

- **Cookie**: the existing `serializeCookie`/`cookieName` (`auth/cookies.ts`): opaque random value, `HttpOnly`,
  `Secure`, `SameSite=Lax`, `Path=/`, and the `__Host-` prefix, which a browser accepts only for a Secure,
  host-only cookie scoped to `/`. In public mode the cookie is **always** Secure and prefixed, except on a
  `http://localhost` base URL used in development and tests.
- **Server session**: the existing `sessions` table and `SessionStore` (hash stored, idle and absolute expiry, the
  last-seen time written at most once a minute). `AUTH_SESSION_IDLE_MINUTES` / `_ABSOLUTE_HOURS` apply.
- **Revocation**: sign-out, account deletion and "disable user" delete the person's sessions, and the guard re-reads
  the user row on every request, so a disabled or deleted account stops at once whatever its cookie says.
- **CSRF**, in three layers: `SameSite=Lax` (the cookie is not sent on a cross-site POST); a custom
  `X-Swarm-CSRF: 1` header on every change, which a cross-site page cannot add without a CORS pre-flight; and the
  existing origin allow-list, which refuses any request whose `Origin` is not this site. In public mode a cookie-
  authenticated change that also arrives with `Sec-Fetch-Site: cross-site` is refused outright. The login attempt
  adds `state`, a browser-binding cookie and PKCE, which is what protects the sign-in itself from login CSRF.
- **Open redirects**: `safeReturnTo` only ever returns a path on this site.

### 4.5 Accounts, workspaces and who can see what

- `public_users(id, workspace_id, provider, subject, email, …)`; `id` is `u_` plus 128 random bits, `workspace_id`
  is `w_` plus 128 random bits. Neither is derived from the e-mail address or the provider's id.
- Every account is the `owner` of **exactly one** private workspace and has no other membership. The member routes
  are refused in public mode, the sessions can only carry the workspace they were made for, and nothing accepts a
  workspace id from the client. So **a person cannot join another workspace, and there is no shared owner
  workspace to join**: the owner of the deployment signs in like anyone else and is a platform administrator only
  because their verified address is in `PUBLIC_ADMIN_EMAILS`. A platform administrator can see usage and switch
  things off, and, as in the pilot, sees no one's projects.
- The e-mail address is stored because the person is shown it, an administrator can find an account by it, and
  admin status is decided by it. It is never in a log line, an audit record, an export or an error, and every
  response that carries it for anyone but the person themselves masks it (`a***@example.com`).

### 4.6 Deleting an account

`DELETE /api/account` with `{ "confirm": "delete my account" }` (and the CSRF header) deletes, in one transaction:
every project of the workspace (and by cascade its chunks, events, messages, claims, conflicts, ledger, studio
documents, usage, artifacts, jobs, project members and funding marker), the workspace's members, the person's
sessions, their usage rows, and the `public_users` row, then clears the cookie. A test enumerates **every** table
and asserts no row remains that names the workspace, the user id, the e-mail address or the provider subject.

Two things are kept, and are written on the account page and in the privacy stub:

1. **The audit log** is an append-only hash chain; deleting its rows would break the chain that proves nothing was
   tampered with. Its rows hold the opaque user id, an action word and counts, never content or an address, and
   after deletion nothing maps the id to a person.
2. **A keyed counter**: `HMAC(server key, provider:subject)` and the free-tier tokens that account had used, for
   `PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS` (default 30), so that deleting and re-registering is not a way to reset
   the lifetime cap. It holds no address and cannot be reversed without the server key. If the owner prefers a
   literal "nothing at all is kept", set the retention to `0`; that is decision 5 in
   [DECISIONS-FOR-OWNER.md](DECISIONS-FOR-OWNER.md), because it is a legal call.

### 4.7 Terms and privacy

`legal/terms.md` and `legal/privacy.md` ship as **stubs the owner must fill in**, each beginning with a clearly
marked "NOT YET REVIEWED: replace this before opening to the public" block. The sign-in page links to them and says
that signing in means accepting them; the server serves them as plain text at `/api/public/legal/:doc`, and the page
renders them as text (never as HTML).

## 5. Data isolation (d)

### 5.1 What is being defended, and what is not

The known gap is that tenant isolation is application code: every query carries a tenant predicate, and one that is
missing leaks. In public mode, where a stranger can try identifiers against every route, that is not enough. The
boundary has to hold **even if an application check is missing**.

Row-level security (RLS) in PostgreSQL does that. It defends against **a missing or wrong tenant predicate and against
an identifier belonging to someone else** (insecure direct object reference), in code that runs through the
application's database role. It does **not** defend against someone who can run arbitrary SQL as that role (the role
can `RESET ROLE` or set the session variable); that needs a different design (a separate non-owner login role, or a
schema per tenant), and is listed as a remaining risk, not claimed.

### 5.2 Design

- **Two roles.** The connection role (the owner, which also runs migrations) and `swarm_app`
  (`NOLOGIN NOSUPERUSER NOBYPASSRLS`, created by the public bootstrap and granted to the connection role). After the
  schema is ready, every public-mode statement runs as `swarm_app` (`SET ROLE`), a role that is not the table owner and
  therefore **is subject to the policies**.
- **A context per call.** Each statement is sent with `{role, tenant, system}`. The worker thread that owns the
  connection applies it before the statement with `set_config('swarm.tenant', …, false)` and
  `set_config('swarm.system', …, false)`, **only when it changed**, and forgets what it applied on a rollback or a
  reconnect, because PostgreSQL undoes a `SET` made in a transaction that rolls back and a new connection starts empty.
  (This was verified against PGlite: the setting reverts on `ROLLBACK`.)
- **Where the tenant comes from.** An `AsyncLocalStorage` store, created by the **first** `onRequest` hook with
  `als.run(store, done)` (the form Fastify documents for context that must reach later hooks and the handler), and
  filled in by the guard right after authentication: `store.tenant = principal.tenantId`. Nothing in the request
  body, query or headers can set it.
- **Fail closed.** With row security on, a statement sent with **no** store is refused with `DB_CONTEXT_MISSING`;
  it is never treated as "system". Code that legitimately has no request must say what it is:
  `database.asSystem(fn)` for work that is about the platform and not about one tenant (sessions and login attempts
  before the tenant is known, the audit chain's tip, the usage ledger and settings, the job queue's claim and
  upkeep, start-up recovery, telemetry gauges), and `database.asTenant(tenantId, fn)` for a job body, which runs
  in the tenant of the project it works on.
- **Policies** (created by an idempotent `applyRowSecurity` step, never by a numbered pilot migration; it enables row
  security on every table below and gives the runtime role only the grants it needs. It does **not** `FORCE` row
  security: the owner has to be able to migrate data, and the runtime role is never the owner, so the policies bind it
  all the same, which the start-up self-check proves on the real database):

| Table                                                                                                                                                                                       | Policy (`USING` and `WITH CHECK`)                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `projects`, `workspace_members`, `sessions`, `public_users`                                                                                                                                 | the row's tenant (`tenant_id`, or `workspace_id`) equals `swarm.tenant`, or system                         |
| `chunks`, `events`, `messages`, `claim_records`, `source_conflicts`, `ledger_state`, `project_members`, `jobs`, `studio_documents`, `project_usage`, `project_artifacts`, `project_funding` | the project it belongs to is in `swarm.tenant`, or system                                                  |
| `audit_events`                                                                                                                                                                              | reading: system, or a row of a project of `swarm.tenant`. Writing: the chain is written by `asSystem` only |
| `login_attempts`, `public_login_attempts`, `public_settings`, `usage_daily`, `usage_lifetime`, `usage_reservations`, `usage_blocked`, `signup_log`, `deleted_accounts`                      | system only                                                                                                |

- **A completeness test** reads every table in the schema and fails if one is in neither the policy list nor an
  explicit "holds no user data" list, so a future migration cannot add a table that skips this.
- **Self-check at start-up.** In public mode on PostgreSQL the server checks, before it listens, that the runtime role is
  not a superuser and does not have `BYPASSRLS`, and that every table in the policy list has row security enabled and
  forced. If not, it **refuses to start** with a message naming the problem. This is also how the owner learns, on
  the first deploy, whether the managed Postgres honours the setup, which cannot be tested here.
- **SQLite has no row security.** Public mode refuses it unless `PUBLIC_ALLOW_UNSAFE_SQLITE=1`, which exists for
  development and for the tests that do not concern isolation. Isolation tests, and the browser journeys, run on PGlite
  (PostgreSQL compiled to WebAssembly, already used by `npm run test:postgres`).

### 5.3 What the tests prove

1. **The database boundary, without the application** (`rls.test.ts`). With two tenants' data in every table,
   as tenant A: `SELECT *` on **each** table returns none of B's rows; `UPDATE` and `DELETE` of B's rows affect 0
   rows; `INSERT` and `UPDATE` that would write a row into B's tenant fail with `42501`; a child row cannot be
   attached to B's project. With no context set, every statement fails closed.
2. **The routes, through the application** (`isolation.test.ts`). User B creates a project with documents,
   messages, claims, a studio report, stakeholders, a budget and a research record. User A, signed in, calls
   **every** `/api` route in the registry (`app.routes`) with B's project id in the path, in the query (`compare?with=`),
   and in the body where a route accepts one, and with every other path parameter taken from B's data. Each must answer
   as if the thing does not exist (404 or a refusal) and must return none of B's content. List routes must not
   contain B's rows and counts must not include them. The test is **generated from the registry**: a route that
   appears without being classified fails it, exactly as `auth.test.ts` fails for a route with no policy.
3. **The application check removed** (`isolation.test.ts`). The same attacks run with the application-level
   tenant check **disabled** (a test seam that makes `ownerInTenant` and the membership check say yes), and must
   still return nothing, because the database refuses. This is the test that shows RLS is the boundary and not a decoration.
4. **The docs list the routes.** [ISOLATION.md](ISOLATION.md), generated from the registry by `isolation-doc.test.ts`
   (`UPDATE_ISOLATION_DOC=1` rewrites it), lists every route that was
   checked and how; a test fails if a registered route is missing from it.

### 5.4 Cost of the design

Child-table policies are an `EXISTS` on `projects`, an indexed primary-key lookup per row. The bridge sends one extra
statement when the context changes, which in a request that touches one tenant is once. Both are acceptable for the
load a public free tier is capped to; they are measured in Phase 8.

## 6. Free tier, quota and cost (e, Phase 3)

### 6.1 Where it is enforced

Every model round trip passes through `ModelClient`. A new optional **spend gate** (`deps.spend`) is asked
immediately before each provider request, in the one place that knows a call is about to be made, and told what
happened after:

```ts
interface SpendGate {
  begin(call: { deployment: string; inputTokens: number; maxOutputTokens: number }): SpendTicket; // throws to refuse
}
interface SpendTicket {
  settle(used: { inputTokens: number; outputTokens: number; reasoningTokens: number | null }): void;
  settleAtWorstCase(): void; // the request was sent and nothing is known of what it used
  release(): void; // the request never reached the provider
}
```

What a round trip is charged is decided in the client, once, whatever happens to it: a reply is charged **as the provider
reported it**, a reply cut off at its limit or refused for its content too (the provider bills them); a request that was
sent and not answered (timeout, abort) is charged at its **worst case**, because the provider may be billing for all of
it; a request the provider refused with an HTTP error (a bad request, a refused parameter, a failed sign-in, a rate
limit) or that could not be reached is **released**, because nothing was used; a provider that answers without usage is
charged at the estimate. The pilot gives its clients no gate and nothing here runs.

The public model factory (`createPublicModelFactory`) wraps the base factory. For each model it makes, it reads the
**funding** of the current context (free tier, or the person's own key) and builds the client with the right provider
configuration and the right gate. With **no funding context**, the model it returns refuses every call
(`NO_FUNDING_CONTEXT`): there is no path to the operator's credits that does not go through a signed-in person.

### 6.2 The ledger

A public-track table `usage_daily(day, subject, calls, input_tokens, output_tokens, reasoning_tokens,
reserved_tokens, cost_micro_usd, reserved_micro_usd, reserved_calls)`, one row per UTC day per `subject`:
`u:<workspace id>` for a person, `b:<workspace id>` for what a person did on their own key (never counted against any
cap) and `global` for everyone on the free tier. `usage_lifetime` holds each account's total. `usage_reservations`
holds what is reserved and not yet settled, so that a crashed process's reservations can be released. `usage_blocked`
counts refused calls by day and reason. The unit of cost is a millionth of a dollar.

### 6.3 Reserve, then settle

`begin` is one transaction, and **every cap is checked by a conditional `UPDATE`**, so the check and the reservation
are one atomic statement that cannot be passed by concurrent requests, in this process or in another:

1. Refuse if the kill switch is off (environment or run-time), or the person's account is disabled.
2. Estimate the call: `inputTokens` from the characters about to be sent (the messages, the strict schema the model is
   asked to answer in, and the framing of each message), **padded** by half again and 64 (`heldInputTokens`), because
   the estimate is from characters and a provider counts more than that; plus the **whole** `maxOutputTokens` (a
   reasoning model's hidden tokens are inside that limit), priced from `MODEL_PRICES`. The padding is given back at
   settlement, and a call that used more than it held is still charged for all it used.
3. In order, each as `UPDATE … SET reserved_* = reserved_* + ? WHERE … AND used + reserved + ? <= cap`
   with a check of the changed row count; a failure rolls back the whole transaction:
   - the **person's day**: calls, tokens (`FREE_USER_DAILY_*`) and calls **in flight** (`FREE_USER_CONCURRENT_CALLS`);
   - the person's **lifetime** tokens (`FREE_USER_LIFETIME_TOKENS`);
   - the **global day**: tokens and estimated dollars (`FREE_GLOBAL_DAILY_*`).
4. Insert the reservation and return a ticket.

`settle` replaces the reservation with the real usage, in one transaction: `input + output` tokens as the provider
reported them (hidden reasoning tokens are inside `output`, and are also kept in their own column), priced the same
way. A reservation settles or is released **once** (the reservation row is what is deleted, so a second settle or a
release of the same one changes nothing). A reservation older than an hour is released by the upkeep timer (`sweep`), so
a crash cannot lock a cap.

Because the **whole worst case** is reserved before the request is sent, the sum of what is settled and what is
reserved can never pass a cap, however many calls are in flight, except by what a provider counts beyond the padded
estimate of its input, which is bounded by one call's input and is what the Azure budget alert is the second line
for. Settling after the fact, which is what the per-project limit does, would let a burst through; that is why the free
tier does not use it. The statements are conditional updates, which PostgreSQL re-evaluates against the latest committed
row after waiting for its lock (`READ COMMITTED`), so the same holds across processes and replicas; the tests race
real writers on one SQLite file and, when `SWARM_TEST_POSTGRES_URL` is set, on PostgreSQL (section 6.8).

### 6.4 Defaults and the cap states

The defaults are in section 3. At the defaults a person can run roughly four small model-assisted runs a day (about
15,000 tokens each), at a worst-case cost of about $0.10 a day at `gpt-4.1-mini` list prices, and the whole free tier
stops at **2 million tokens or $5 a day**, whichever comes first. They are conservative on purpose and meant to be
changed by the owner (decision 2). The existing per-project caps stay in force, with public defaults of 300 calls and
400,000 tokens when `PROJECT_MODEL_*` is unset, and the free tier runs with `MODEL_OPERATION_TOKEN_LIMIT` unset or
lower.

What a person sees is a **state**, never an error. The state is read from the same ledger rows as the reservation, and a
token cap counts as reached when **less than one run** (`FREE_TOKENS_PER_RUN`) is left of it, so that "0 free runs left"
and "used up" are one thing and the tier says so before a run is begun that could not finish. The call-level check
above is what actually refuses a call, on the worst case of that call, and is always the last word:

| State (`free.reason`) | Message (one next action)                                                                |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `null` (available)    | "N free runs left today"                                                                 |
| `user-cap`            | "You have used today's free runs. They come back at 00:00 UTC, or use your own key now." |
| `global-cap`          | "The free tier is used up for today. Bring your own key, or come back tomorrow."         |
| `lifetime-cap`        | "You have used the free allowance for this account. Bring your own key to keep going."   |
| `disabled`            | "The free tier is switched off right now. You can still use your own key."               |
| `concurrent`          | "A run is already in progress. It will finish soon."                                     |

A refused call stops the run with that state in its message (HTTP 429 `FREE_TIER_*` with `{state}`), the project
stays intact, and a run that already finished its model work is not touched. A request on **BYOK** never reads the
free-tier rows (section 7), so a used-up free tier never blocks it.

### 6.5 Non-reasoning model, and output caps

The free tier is configured on a non-reasoning deployment (section 3). The router's per-role output budget
(`ROLE_PARAMETERS`) is capped further, on the free tier only, by a wrapper around the free-tier client that clamps the
`maxTokens` of each call to the cap of its role (the router already passes the role with every call), by
default `extraction 1500, actor 1200, scenario 1500, critic 1500, synthesis 2000, research-planner 1000` and 2000 for a
call that names no role. A person on their own key gets the router's ordinary budget. A
deployment that reasons is refused at start-up, so hidden reasoning tokens cannot eat the cap. The operator's
declaration is believed: the client is told at start-up (`CapabilityMemory`'s `declared` map) that these deployments
take no `reasoning_effort`, so the first call to one is not a request that is bound to be refused (a pilot still learns
it from a refusal, as before).

### 6.6 Kill switch and budget automation

- **Environment**: `FREE_TIER_ENABLED=false` turns the free tier off for the process; it cannot be turned on at run
  time.
- **Run time**: `public_settings.free_tier_enabled`, read on every `begin`, so it is **instant** and shared by every
  replica. `POST /api/admin/free-tier { "enabled": false }` (a platform administrator) flips it and is audited.
- **Automation**: `POST /api/ops/free-tier/off`, authenticated by `Authorization: Bearer <key>` whose SHA-256 must
  equal `PUBLIC_OPS_KEY_SHA256` (constant-time), also accepted as `?key=` because an Azure action-group webhook cannot
  set headers (the query string is never logged). It can only turn the free tier **off** (an attacker who learns the
  key can disable the free tier, not enable it or read anything), is rate limited, and is audited. Phase 7 wires an
  Azure budget alert to it through an action group.
- **Honesty**: Azure budgets alert; they do not stop spend, and cost data arrives hours late. The real-time
  protection is the ledger's daily cap, which does not depend on Azure at all. The budget alert is the second line.

### 6.7 Meter and admin view

`GET /api/usage` (section 9) drives a small "free runs left today" meter with a hint to bring a key.
`GET /api/admin/usage` (platform administrator) gives spend by day, the top accounts by tokens (masked e-mail and
opaque id), blocked requests by reason, and the state of the switches. The page treats `runsLeft === 0` as the
limit-reached state, which is the same moment the server reports `available: false`.

### 6.8 What a stranger is told about the model, and the tests

The pilot's `GET /api/provider/status` answers with the process's own counters (every caller's calls and tokens, its last
error) and `GET /api/config` names the deployment. In public mode both are replaced:

- `GET /api/provider/status` and `POST /api/provider/check` tell **this person** what their funding can do and what
  they have used today (`counters` are their own ledger row, `model` is the label "Free tier", `lastError` is the
  state's message when the free tier cannot be used). **`check` makes no model call**: the free tier's state is read
  from the ledger, so pressing it cannot spend the operator's credits. A person's own key is tried by
  `POST /api/byok/connect` (section 7), which says what it found.
- `GET /api/config` leaves the deployment name and set-up notes out (`provider.model` is null, `provider.reason` is a
  fixed sentence), and says a model is available when the operator's is set up **or** a person's own key is allowed.
- **What does name the model is the label on a result.** A reading, a proposal or a run says which model wrote it
  ("Read by a model · gpt-4.1-mini"), and for the free tier that is the name of the operator's deployment, so the deployment
  is to be named after its model (DEPLOY.md, section 3). On a person's own key it is the model they chose, and never the
  operator's. The label is a name, not a credential or an address.

The tests (`backend/test/public/`): `ledger.test.ts` (the ledger on SQLite and PGlite: settle once, every cap, a person's
own key never counted against them, refusals leave nothing held, ledger accuracy), `ledger-race.test.ts` (writers that
run at once, each with a connection of its own to one database, released together; the caps are read **while they
run** as well as at the end, and the test fails if a cap is weakened), `freetier.test.ts` (the gate through a fake
Azure deployment: caps, the cap-reached state, the kill switch in all three forms, the meter, the admin view, one run
at a time, the model chip, the configuration). A call on a person's own key while the free tier is used up or
switched off is tested end to end with the BYOK tests (section 7).

## 7. Bring your own key (e, Phase 4)

### 7.1 The provider

**Gemini through its OpenAI-compatible endpoint**, because it fits the existing provider layer (`ModelClient` already
speaks Chat Completions, with strict JSON schema output, `reasoning_effort`, `finish_reason`, retries and the
truncation and repair loop), so that BYOK gets exactly the handling the Azure path has. Checked against Google's
current documentation:

- "OpenAI compatibility" (<https://ai.google.dev/gemini-api/docs/openai>, which redirects to
  <https://aistudio.google.com/docs/openai>): base URL `https://generativelanguage.googleapis.com/v1beta/openai/`;
  `POST …/chat/completions` with `Authorization: Bearer <key>`; `reasoning_effort` (`minimal`, `low`, `medium`,
  `high`, and `none` for 2.5 models; it cannot be turned off for 2.5 Pro and 3.x models); structured output through
  `response_format`; `GET …/models` to list models.
- "Troubleshooting guide" (<https://aistudio.google.com/docs/troubleshooting.md>): Gemini 4 and 3.6+ ignore
  `temperature`, `top_p` and `top_k` (and will reject them in a future release), so the client **sends no
  temperature to Gemini**; retry only `429`, `408` and `5xx`, never `400`, `402` or `403`; a safety block is
  reported, not an error to retry.
- Google's page says the compatibility layer is still beta. Two details could not be confirmed from the
  documentation without a key: that `max_completion_tokens` is accepted, and that strict `json_schema` takes every
  schema Swarm sends. The client is built to **adapt** (it already leaves out a refused `reasoning_effort` or falls back
  from `json_schema` to `json_object`, and now also falls back from `max_completion_tokens` to `max_tokens`), and
  the reply is always validated against the schema with the same bounded repair rounds. Both are recorded in section 11
  as not verified against the live API.

### 7.2 Which model

The model list is **asked of the API**, not hard-coded: at "Connect", `GET …/models` with the person's key lists what
that key can use (`chooseModels`, `backend/src/public/byok/connect.ts`). A model is offered if it is a `gemini-*` text
model (not `image`, `tts`, `live`, `audio`, `embed`, `transcribe`, `veo`, `imagen`, `robotics`, `computer-use`, `aqa`,
`learnlm` or `dialog`) with a name that is a name. They are ranked: `flash` first, then `flash-lite`, then `pro`, then the
rest; within a family a **stable** name before a `preview` or `exp` one; then the highest version. The first is the
default, so the default is the newest stable flash model the key can use, and a preview is the default only for a
family that has nothing else. The person can pick any listed model (at most 40 are shown). Model names change quickly,
which is why none is written in code or configuration.

### 7.3 Key handling, all mandatory

| Rule                                                                             | How it is met                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Test                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The key lives only in the browser                                                | `sessionStorage` (cleared when the tab closes), never `localStorage`; held in memory by the page and sent per request in the header `X-Swarm-Provider-Key`                                                                                                                                                                                                                                                                                                                                                          | UI test: nothing in `localStorage`; e2e                                       |
| Sent over HTTPS only                                                             | Same origin, `Secure` deployment, HSTS (helmet); the key is accepted only on a request that arrived over TLS: `request.protocol` must be `https` (behind the platform's proxy that is its `X-Forwarded-Proto`, from the one trusted hop, so a hosted deployment needs `TRUST_PROXY=1`); on anything else the request is refused with `INSECURE_TRANSPORT` and the key is not used                                                                                                                                   | test                                                                          |
| The server uses it for that request only                                         | The very first `onRequest` hook (`takeByokHeaders`) reads the three headers, registers the key for redaction, and **deletes them from `request.raw.headers` and the raw header list**, so that no later hook, plugin, handler or request log sees it; it lives on only in the funding of the request (an `AsyncLocalStorage` value), and for runs in `EphemeralKeys` (below); never put in a `Repository` call or any object that is stored                                                                         | test                                                                          |
| Never stored: database, logs, traces, metrics, errors, analytics, exports, cache | A **redaction layer** (`byok/secrets.ts`): every key the server is handed is registered, and recognised in its URL, JSON and base64 forms; Google's key shape, a bearer token, the key header and a `key=` parameter are recognised by shape. It is applied to the log stream, the error handler's message, **every string response** (`onSend`) and audit detail; Google's own error text is never passed on at all (provider failures are raised in our words); no code path writes the key. `MODEL_CACHE` is off | canary test over logs, responses, exports and **every column of every table** |
| Sent only to the provider's fixed host                                           | The base URL is a constant in code, and the key check builds its address from it and asserts the host. A header, query or body field that names a URL, host or proxy is ignored. `redirect: 'error'`, so a redirect cannot carry the key elsewhere; the client's `fetch` target is asserted in every test                                                                                                                                                                                                           | test                                                                          |
| Validated with one tiny request on "Connect"                                     | `POST /api/byok/connect` does one `GET …/models` (no tokens used) and answers a plain status: `valid`, `invalid`, `rate-limited`, `quota`, `region`, `unreachable`, `disabled`, always with HTTP 200 (400 only for a request that carries no usable key). It never echoes the key or any text of Google's                                                                                                                                                                                                           | fake Gemini                                                                   |
| Only the last 4 characters are shown                                             | Computed in the page from the key it holds. The server does not return any part of the key                                                                                                                                                                                                                                                                                                                                                                                                                          | UI test                                                                       |
| "Forget key"; cleared on sign-out                                                | Clears `sessionStorage` and memory; `DELETE /api/byok` makes the server forget its in-memory copy; sign-out and deleting the account do too                                                                                                                                                                                                                                                                                                                                                                         | e2e                                                                           |
| A notice                                                                         | "Your key is used only for your requests and is never saved. Use a key with a spend limit."                                                                                                                                                                                                                                                                                                                                                                                                                         | e2e                                                                           |
| Not a key-validity oracle                                                        | `connect` needs a signed-in account; it and the model chip's check on a key share one limit of 10 an hour per account, and `connect` has the per-address route limit as well                                                                                                                                                                                                                                                                                                                                        | test                                                                          |

**A key is short-lived server memory, not storage.** A run is a queued job and may outlive the request that started it.
So that a person's run can use their key, the key is kept in an **in-process map** (`EphemeralKeys`), keyed by
workspace (a person has one key at a time: the last one their page sent), with a 90-minute idle and 4-hour absolute
lifetime (the same key is not extended past 4 hours by being used), never written anywhere, dropped on "Forget key",
on sign-out, on account deletion and when the process stops. This is the one deviation from "that request only" and is
decision 4. What keeps it safe: a project records a **non-secret funding marker** (`project_funding`: `free` or `byok`),
set by a request that changes the project when the project is **not working** (a queued or running project keeps what it
began with, so a later request cannot move a run to another payer), so a BYOK run whose key has gone **stops** with
"your own key is not saved, so it is needed again" (`BYOK_KEY_NEEDED`) and **never falls back to the owner's credits**.
Because the map is per process, the public deployment runs **one replica** (decision 4).

### 7.4 Limits for BYOK

A BYOK request is exempt from the free tier's caps (and from the global cap), and so can never be blocked by it. It
still has: the per-IP and per-account rate limits, `BYOK_MAX_CONCURRENT_CALLS`, one concurrent run per workspace, the
per-project caps (`PROJECT_MODEL_*`, which exist to bound the size of a project), the workspace project and storage
quotas, and the body and upload limits. Its calls are counted in `usage_daily` under `b:<workspace id>` for the
person's own meter and the admin's view, and are never added to `global`.

### 7.5 Errors in plain words

One next action each; provider text is never repeated. Google's errors are not OpenAI's (`code` is a number, `status` is a
word such as `RESOURCE_EXHAUSTED`, and the error may come in a list), so they are read by `byok/errors.ts` for the kind of
trouble they name, from the message, the status word, the reasons and the quota's own name, and raised as our own failure
(`ModelClientDeps.failure`). The mapping: bad key (Google answers **400** `API_KEY_INVALID` for a key it does not know,
and 401 or 403 for others: `BYOK_KEY_REJECTED`, "Google did not accept this key. Check that you copied all of it, or
make a new one in AI Studio."), limit per minute (`429`: `BYOK_RATE_LIMITED`, "Your Google quota is used up for the
moment. Wait a minute, or try a different model."; asked again after the wait), a limit per day or a plan that does not
allow it (`429` with a per-day quota, "check your plan and billing", `402`, or "the free tier is not available in your
country, enable billing": `BYOK_QUOTA`, "Your Google quota or billing does not allow this. Check your plan in AI
Studio."; **not asked again**), region (`400` "User location is not supported": `BYOK_REGION`, "Google does not offer
this key's service from where the server is. Try another key."), model not found (`404`: `BYOK_MODEL_NOT_FOUND`, "The
model you chose is not available to your key. Pick another model in settings."), a block (the reply ended with
`content_filter`: `BYOK_BLOCKED`, "Google blocked this request for safety reasons. Change the text and try again."; a
refusal in every other way: never answered from rules), a setting Google's compatibility layer does not know (`Unknown
name "max_completion_tokens"`, `reasoning_effort`, `response_format`: left out, or asked as `max_tokens`, once, and
remembered for that model), and Google being overloaded or unreachable (`MODEL_HTTP_ERROR` in our words). Truncated and
schema-invalid replies keep the existing outcomes and wording. The HTTP status of a failure is never 401 or 403, so that
the page does not take a key problem for an expired session.

### 7.6 Results are labelled with who wrote them

The pilot labels a run, a proposal and a regeneration with the server's configured provider and model. With a person's own
key that would say the operator's deployment wrote what Gemini wrote, and would let a project be moved from one provider
to the other without being told (a pilot refuses that: `MODEL_CHANGED`). `models/identity.ts` is an
`AsyncLocalStorage` that the funding sets when it is a person's own key; every place that records or compares the
provider and model asks it (`modelIdentity`), and it answers the configured ones when nothing is set, as a pilot always
did. So a run on a key is recorded as `gemini` and the model the person chose, the proposals say so, and a project that
was started on one funding is refused (`MODEL_CHANGED`) when it is continued on the other, exactly as a pilot's is.

### 7.7 Kept apart from the operator's

A person's own key gets its **own** memory of what its models refuse (`CapabilityMemory`), its **own** routing
(`byok/routing.ts`: one model, the one they chose, treated as a thinking model so that each task gets an effort and room
to finish, no price, no dollar limit), and its **own** counters (`ProviderTelemetry`). So neither can teach the other a
refusal (a person cannot make the operator's deployment look as if it refuses structured output by choosing a model with
its name), and a stranger's failures are not the operator's. `GET /api/provider/status` and `POST /api/provider/check`
describe the key when the request carries one: the provider is `gemini`, the model is the one they chose, the counters
are their own, and `check` is the one request `connect` makes (it shares its limit).

### 7.8 What the tests do

`byok-parts.test.ts` (33, no server): the redaction layer (exact, encoded and by shape, forgetting, bounded), what a
request says about a key and how the key is taken out of it, the key store's lifetimes, Google's errors read for their
kind, the model choice, the key check against the fake Gemini, and the limiter. `byok.test.ts` (34, through the whole
app with a fake Azure and a fake Gemini, on PostgreSQL with row security): trying a key, running on it (to Google's host
only, a strict schema, no temperature, the effort, the token field and its fallback, labels), a reply cut off, a reply
that fails the schema, every plain-language failure and which of them is asked again, a block, the free tier used up or
switched off (a key is never blocked by it, and the free tier says why it is not available), a key that is gone (the run
stops and never uses the free tier), transport that is not encrypted, bringing a key switched off, the concurrency cap,
and a canary key over a whole session in **every log line, every response, every audit entry and every column of every
table**, with the scan shown to find a key planted in a table and the log shown to remove one written to it. With the
redaction layer removed, three of those fail, which was checked.

## 8. Abuse protection (e, Phase 5)

| Control                     | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limits                 | Four layers, all in this process (exact with the one replica the infrastructure allows). The pilot's per-address limiter (120 a minute) and per-route limits, both scaled by `RATE_LIMIT_SCALE`; 30 a minute per address on the sign-in routes; and, after the guard knows who is asking, `backend/src/public/abuse.ts`: every change an account makes (300 in five minutes) and, for the five kinds of request that cost something, a limit for the account and one of three times that for the address: project creation 20 an hour, adding text 60, work by a model 120, reading a web page 30, reading a file 30 (`PUBLIC_RATE_*`). Key checks are held to 10 an hour for an account, and account deletion to 5. A refusal is `429 RATE_LIMITED` with `Retry-After` and "Wait N minutes", is counted as a blocked request, and is written as `public.rate.limited` once in ten minutes for an account and a kind. The limits are checked together and only a request that is let in is counted, so being turned away by the address or by a quota never uses up an account's own limits |
| Request size and uploads    | The pilot's: a 600 KB body limit; 2.7 MB and the isolated PDF worker for a file (a page limit, a text limit, a signature check, no network, no scripts); at most 10 documents of 40,000 characters and 200,000 in all for a project. Another content type is `415`, a body over its limit `413`, in plain words                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Per-workspace quotas        | `PUBLIC_MAX_PROJECTS` (10) projects and `PUBLIC_STORAGE_QUOTA_MB` (20) MB of stored text, measured by `storage/quota.ts` over what a workspace's projects hold (their payloads, passages, messages, report documents, artifacts, claims and conflicts). Both are checked when a project is made or text is added, and refused with `PROJECT_LIMIT` (409) or `STORAGE_LIMIT` (413) and a sentence that says what to delete. Taking away is never refused, which is how a workspace gets back under its limits. The account page shows both, and each refusal is written as `public.quota.refused`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Account-creation throttling | Per address per day (`PUBLIC_SIGNUPS_PER_IP_PER_DAY`, 5) and everywhere per hour (`PUBLIC_SIGNUPS_PER_HOUR`, 60), from a table of keyed hashes that change every UTC day, so that an address is never stored and one day cannot be linked to the next; `PUBLIC_BLOCKED_EMAIL_DOMAINS`; and a lifetime cap on free tokens that deleting an account does not reset (the count is kept for `PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS`, 30)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Bot-protection hook         | Cloudflare Turnstile, **off by default, implemented and tested with a fake** (`abuse.test.ts`). When both keys are set, `POST /auth/start/:provider` must carry `turnstileToken`, which the server checks once against the fixed host `https://challenges.cloudflare.com/turnstile/v0/siteverify`, with no redirect followed. It fails closed: a missing, wrong or unverifiable token, or a Cloudflare that cannot be reached, is `403 BOT_CHECK_FAILED`. The CSP is widened for that host only when it is on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Strict CORS, CSP, headers   | No CORS header is ever sent. An `Origin` that is not the site's own is `403 ORIGIN_NOT_ALLOWED` and a `Host` that is not on `ALLOWED_HOSTS` is `403 HOST_NOT_ALLOWED`. CSP as the pilot's (`default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`); `Referrer-Policy: no-referrer`; HSTS; COOP and CORP `same-origin`; `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` on every `/api` answer; and, in public mode only, a `Permissions-Policy` that denies every feature the page does not use. With Turnstile on, `script-src`, `connect-src` and `frame-src` add `https://challenges.cloudflare.com`, and nothing else is ever added                                                                                                                                                                                                                                                                                                                                                          |
| No open redirects           | `safeReturnTo`; the provider is a path segment checked against the configured list; the redirect URIs are built from `PUBLIC_BASE_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Errors without internals    | The pilot's error body `{ code, message, requestId }`. In public mode the operator's model failures are reworded (`freeFailureWords`: one sentence of what to do, the code kept for the page to decide by), and why the operator's model is not set up is replaced by "The free tier is not set up on this site."; an unexpected failure is a `500` with a request id, and its log line holds a code and a type, never a stack, a path or a query. `abuse.test.ts` scans every answer, header and log line for paths, stacks, SQL, table names, the deployment, the endpoint's host and setting names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Admin switches              | "Disable user" (the account is refused at sign-in and on every request, its sessions are deleted) and "disable signups" (new accounts refused; existing people can still sign in), both audited, both effective at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Security audit log          | The pilot's audit chain, with `public.signup`, `.signin`, `.signin.refused` (reason code), `.signout`, `.account.deleted` (counts), `.csrf.refused`, `.byok.connect` (status code), `.byok.forget`, `.admin.free-tier`, `.admin.signups`, `.admin.user` and `.ops.free-tier.off`; and, written once in ten minutes for an account and a kind, `.free.blocked` and `.byok.blocked` (the reason), `.rate.limited` (the kind and whether it was the account or the address) and `.quota.refused` (projects or storage). The pilot's `evidence.url.refused` (the host and the reason, never the path or the query) and `access.refused` are kept as they are. **Identifiers, codes and counts only**: no e-mail, no key, no document text, no IP. `abuse.test.ts` scans the record                                                                                                                                                                                                                                                                                                              |
| Cost-based abuse            | Section 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reading the web and files   | A web page is read by the pilot's hardened fetcher, unchanged, and only on ports 80 and 443 whatever the operator sets (`config.ts`); the crawler is off unless `PUBLIC_ALLOW_RESEARCH`; a PDF is read by the isolated worker, which makes no request; an address that is only written in a document is never fetched. Section 10 and `ssrf.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 9. HTTP contract

JSON throughout. A change (`POST`, `PUT`, `PATCH`, `DELETE`) from the browser carries `X-Swarm-CSRF: 1`. Every answer
carries `Cache-Control: no-store`. The errors are `{ "error": { "code", "message", "requestId" } }`. The frontend
and the infrastructure are built to this section.

The shapes below are written as TypeScript in [`shared/public.ts`](../../shared/public.ts), which both sides import.
In public mode the server adds `<meta name="swarm-edition" content="public">` to `index.html` (and to the single-page
fallback), and **only then**: the page makes no public-edition request unless it finds that tag, so the pilot's page is
exactly what it was, with no extra request. The paths `/status`, `/legal/terms` and `/legal/privacy` are pages of the
single-page app (the server already falls back to `index.html` for any other `GET` that accepts HTML, outside `/api`
and `/auth/`).
The page decides what to show from the error **code**, never from the message. The codes of the public edition are
`FREE_TIER_USER_CAP`, `FREE_TIER_GLOBAL_CAP`, `FREE_TIER_LIFETIME_CAP`, `FREE_TIER_DISABLED` and
`FREE_TIER_CONCURRENT` (all HTTP 429: the free tier cannot be used by this request, and the reason is the code);
`BYOK_KEY_NEEDED`, `BYOK_KEY_REJECTED`, `BYOK_RATE_LIMITED`, `BYOK_QUOTA`, `BYOK_REGION`, `BYOK_MODEL_NOT_FOUND` and
`BYOK_BLOCKED` (the person's own key, on a run); `PROJECT_LIMIT`, `STORAGE_LIMIT`, `RUN_IN_PROGRESS`,
`BOT_CHECK_FAILED`, `NOT_AVAILABLE` and `ACCOUNT_DISABLED`.

### Public (no session)

| Route                          | Answer                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/public/session`      | `{ edition: "public", signedIn, providers: [{id, label}], signupsOpen, bot: { kind: "turnstile", siteKey } \| null, freeTier: { available, reason }, byokEnabled, retentionDays, legal: { terms, privacy }, user: null \| { emailMasked, provider, isAdmin, createdAt }, session: null \| { idleExpiresAt, expiresAt } }` |
| `GET /api/public/status`       | `{ status: "ok" \| "degraded" \| "maintenance", freeTier: { available, reason, resetsAt }, byokEnabled, signupsOpen, message: string \| null, checkedAt }`: for the status page                                                                                                                                           |
| `GET /api/public/legal/:doc`   | `doc` is `terms` or `privacy`: `{ title, text, reviewed: boolean }`                                                                                                                                                                                                                                                       |
| `POST /auth/start/:provider`   | body `{ returnTo?, turnstileToken? }` → `{ url }` and the binding cookie. 404 for an unknown provider, 429 when limited, 403 `BOT_CHECK_FAILED`                                                                                                                                                                           |
| `GET /auth/callback/:provider` | `?code&state` → 302 to the return path with the session cookie, or to `/?signin=failed\|closed\|unverified\|disabled\|blocked`                                                                                                                                                                                            |
| `POST /auth/logout`            | 204, cookie cleared                                                                                                                                                                                                                                                                                                       |
| `POST /api/ops/free-tier/off`  | `Authorization: Bearer <key>` or `?key=` → `{ freeTier: "off" }`. Off only. Rate limited                                                                                                                                                                                                                                  |

### Signed in

| Route                                                  | Answer                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/account`                                     | `{ emailMasked, provider, createdAt, isAdmin, projects: { count, limit }, storage: { usedBytes, limitBytes } }`                                                                                                                                                                                                               |
| `DELETE /api/account`                                  | body `{ confirm: "delete my account" }` → 204, everything deleted (section 4.6), cookie cleared                                                                                                                                                                                                                               |
| `GET /api/usage`                                       | `{ funding: "free" \| "byok", free: { available, reason, resetsAt, today: { calls, callLimit, tokens, tokenLimit, runsLeft, tokensPerRun }, lifetime: { tokens, limit }, inFlight: { calls, limit } }, byok: { enabled, today: { calls, tokens } } }`. `funding` is what **this request** would use                           |
| `POST /api/byok/connect`                               | headers `X-Swarm-Provider: gemini`, `X-Swarm-Provider-Key` → `{ status: "valid"\|"invalid"\|"rate-limited"\|"quota"\|"region"\|"unreachable"\|"disabled", message, models: [{id, label}], defaultModel }`. HTTP 200 for every status. 400 only for a malformed request. The key is never in the answer                        |
| `GET /api/provider/status`, `POST /api/provider/check` | existing routes. In public mode: the caller's funding only (`{ configured, provider: "foundry"\|"gemini", model: "Free tier"\|<their model>, … }`), no endpoint, deployment or global counters; `check` makes no model call on the free tier (it answers from the ledger), and on a key makes the one request `connect` makes |
| `DELETE /api/byok`                                     | 204. The server forgets the key it holds in memory for this person's runs (the page clears its own copy)                                                                                                                                                                                                                      |
| every other existing `/api` route                      | unchanged, and funded by the request's funding                                                                                                                                                                                                                                                                                |

BYOK headers (read on any signed-in request, only in public mode, taken out of the request by its first hook):
`X-Swarm-Provider: gemini`, `X-Swarm-Provider-Key: <key>`, `X-Swarm-Provider-Model: <model id>` (optional). The page
attaches them to changes and to `GET /api/usage`. A request whose headers are not in a form this server reads is
refused (`INVALID_INPUT`), one sent over a connection that is not encrypted is refused (`INSECURE_TRANSPORT`), and one
that carries a key while bringing a key is switched off is refused (`NOT_AVAILABLE`; only `connect` answers `disabled`),
so that a key is never silently taken for a request on the free tier.

### Platform administrator

| Route                               | Answer                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/usage?days=14`      | `{ days: [{ day, calls, tokens, reasoningTokens, costUsd, blocked }], topUsers: [{ id, emailMasked, tokens, calls, disabled }], blocked: { byReason }, switches: { freeTierEnv, freeTierRuntime, signups }, today: { global: {...}, limits: {...} } }` |
| `POST /api/admin/free-tier`         | `{ enabled: boolean }` → the switches                                                                                                                                                                                                                  |
| `POST /api/admin/signups`           | `{ enabled: boolean }` → the switches                                                                                                                                                                                                                  |
| `POST /api/admin/users/:id/disable` | `{ disabled: boolean }` (id as in `topUsers`, or `email:` and an address in its place) → `{ accounts: [{ id, disabled }] }`                                                                                                                            |
| `GET /api/admin/audit?limit=50`     | recent public security events (codes only)                                                                                                                                                                                                             |

Refused in public mode with 404 `NOT_AVAILABLE`: `GET|PUT|DELETE /api/workspace/members…` and
`GET|PUT|DELETE /api/projects/:id/members…`. Bearer tokens get 401.

## 10. Threat model for public mode (f)

Test files are in `backend/test/` and, for the browser, `e2e/`. "Pilot" threats that are already covered
(`docs/production/threat-model.md`) are not repeated.

| Threat                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSRF through URL fetch**                    | The existing policy (`ingest/url/policy.ts`, `fetcher.ts`): scheme, user-info, internal names, unusual IP forms, ports 80 and 443 only, every DNS answer checked and the connection pinned to those answers, redirects followed by hand (5) and re-checked, `169.254.0.0/16` (metadata), loopback, link-local, private, CGNAT, multicast, IPv6 (only global unicast), IPv4-mapped. Size, time, content-type and decompression caps, concurrency 8 and a queue. **Public additions**: a per-account limit, ports fixed, `URL_INGEST_ALLOWED_HOSTS` supported, and the research crawler off | `ssrf.test.ts`, through the public routes as a signed-in person: 25 written forms of an address inside the network (loopback in every notation, metadata, Azure's platform address, private, CGNAT, link-local, multicast, IPv4-mapped IPv6) and seven internal name forms are refused without a lookup; names that resolve inside, alone or among public answers, are answered as a name that is not there, and the refusal is kept by host and reason only; ports 80 and 443 only, whatever the operator sets; nothing connects to a canary server on this machine. The fetcher's own rules (every DNS answer, the pinned connection, redirects re-checked, size, time, type, decompression) are held by `url-policy.test.ts`, `url-fetcher.test.ts` and `url-route.test.ts`, and `ingest/url/` is not changed in this branch |
| **SSRF through document extraction**          | Extraction reads uploaded bytes only and never follows a link. PDFs go to the isolated worker with a size, page and time cap; CSV and JSON are parsed as text with limits                                                                                                                                                                                                                                                                                                                                                                                                                 | `ssrf.test.ts`: a PDF with a link, an open action, a script, a launch action and a remote go-to, all aimed at a canary server on this machine, is read and the canary sees nothing; addresses that are only written in a document, a project, its export or a data file are never fetched; the crawler answers `RESEARCH_DISABLED`. `abuse.test.ts`: an oversize file and a file that is not a PDF are refused cleanly                                                                                                                                                                                                                                                                                                                                                                                                          |
| **SSRF through BYOK**                         | The provider host is a constant; no setting, header or body field changes it; `redirect: 'error'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `byok.test.ts`: the fake transport sees only the Gemini host, whatever a header, a query or a body says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Prompt injection**                          | The existing defences: user data is fenced as `untrustedScenarioData`, injected instructions are detected, the reply must validate against a schema, a reply that repeats an injected payload is rejected, and the model has no tools, no network and no other tenant's data in context. RLS means that even a fully hijacked model call cannot read another tenant                                                                                                                                                                                                                       | `injection.test.ts`: a model that obeys a planted instruction is refused, on the free tier and on a person's own key, and nothing is kept; the planted text is only ever in the untrusted part of a request; what a model is sent is the caller's own text, none of another person's, and no credential                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Malicious uploads**                         | Body and file limits, content-type allow-list, the PDF worker's isolation, parse limits, no file kept (only the extracted text), text rendered by React and never as HTML                                                                                                                                                                                                                                                                                                                                                                                                                 | `abuse.test.ts`: a body over the limit is `413`, another content type `415`, a file that is not a PDF is refused cleanly, and a script in a document stays text in an answer that is JSON with `nosniff`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Key theft (BYOK)**                          | Section 7.3: never stored, redacted, header only, `sessionStorage`, no cache, CSP, `no-store`. A stolen session cookie does not reveal a key, because the server does not have it after the request                                                                                                                                                                                                                                                                                                                                                                                       | canary tests: logs, responses, exports, every row of every table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Key-validation oracle**                     | `connect` needs an account, is limited per account and per IP, and is audited by status code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `byok.test.ts`: tries per account and per address, audited by status code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Account farming**                           | Verified e-mail through a real provider, per-IP and global signup throttles, blocked domains, Turnstile hook, a lifetime free cap that survives deletion for 30 days, a global daily cap, admin disable and "signups off"                                                                                                                                                                                                                                                                                                                                                                 | `auth.test.ts` (throttles, blocked domains, sign-ups off, disabled accounts, the counter that survives deletion), `abuse.test.ts` (the bot check, with a fake), `freetier.test.ts` (the lifetime cap)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Cost exhaustion**                           | Section 6: reservation of the worst case, per-user, lifetime and global caps, kill switch (environment, run time, budget webhook), non-reasoning model, per-role output caps, project caps, one replica and a CPU and memory cap in the template                                                                                                                                                                                                                                                                                                                                          | `ledger.test.ts`, `ledger-race.test.ts` (a race that cannot pass the cap, with real threads), `freetier.test.ts` (the used-up state, the kill switch, the budget webhook), `byok.test.ts` (a person's own key is unaffected)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Data leaks between users**                  | Section 5: policies in the database plus the application checks, opaque ids, uniform 404, masked e-mail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `rls.test.ts`, `isolation.test.ts` (every route, as every other person; the list is generated), the browser journeys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Session theft, fixation, CSRF, login CSRF** | Section 4.4: a new identifier at every sign-in, hashed storage, expiry, revocation, `SameSite`, the custom header, the origin allow-list, `state` plus the binding cookie plus PKCE                                                                                                                                                                                                                                                                                                                                                                                                       | `auth.test.ts` (the state, the nonce and PKCE, the binding cookie, the cookie's flags, a new identifier at every sign-in, expiry, sign-out, the anti-forgery header, a cross-site change)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Open redirect**                             | `safeReturnTo`, fixed redirect URIs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `auth.test.ts` ('never redirects off the site after signing in': an address on another site, `//`, a backslash)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Stack traces and internals in errors**      | Section 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `abuse.test.ts`: every answer, header and log line scanned for frames, paths, SQL, table names, the deployment and the endpoint's host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **XSS, clickjacking, MIME sniffing**          | Strict CSP without inline script, `frame-ancestors 'none'`, `nosniff`, React escaping, the legal text rendered as text                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `abuse.test.ts` (the headers, on every kind of answer), `frontend/src/test/ui-guards.test.ts` (no dynamic-code sink in the page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Enumeration of accounts or projects**       | Opaque random ids, the same 404 for "not yours" and "not there", no e-mail in any response but the person's own (masked), the same sign-in failure page whatever failed                                                                                                                                                                                                                                                                                                                                                                                                                   | `isolation.test.ts`, `auth.test.ts`, and `abuse.test.ts` (another person's project is answered exactly as one that does not exist)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Incomplete deletion**                       | One transaction; a test lists every table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `auth.test.ts` ('deleting an account': it lists every table)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **A platform administrator reading projects** | An administrator is a normal account with the flag; the admin routes read the ledger only; RLS gives no route a way to ask for system context                                                                                                                                                                                                                                                                                                                                                                                                                                             | `isolation.test.ts`: the admin account as attacker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Denial of service**                         | Body and time limits, rate limits, concurrency caps, a CPU and memory cap and a replica cap in the template; the free tier's global cap bounds model load                                                                                                                                                                                                                                                                                                                                                                                                                                 | `abuse.test.ts`: the limits per account and per address, the quotas, the size limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Secrets in the repository**                 | No key, token or `.env` is committed; `scripts/secret-scan.mjs` runs on the tree, the tests and the snapshots                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase 8 secret scan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 11. What cannot be verified here

Nothing in this work calls a real model, signs in with a real Google or GitHub account, or deploys. So, to be proven
by the owner after deploying (the exact checks are in [DEPLOY.md](DEPLOY.md)):

- Row security on the real Azure Database for PostgreSQL (the start-up self-check refuses to run if it is not in
  force, and PGlite is real PostgreSQL code but not the managed service).
- Gemini's compatibility endpoint accepting `max_completion_tokens` and every strict schema (the client adapts, and
  the fake server in the tests encodes what the documentation says, not what the live service does). Likewise the shape
  of Google's errors (an invalid key is read as HTTP 400 `API_KEY_INVALID`, a limit per minute is told from one per day
  by the quota's name in the details, a location problem by its message): they are from Google's troubleshooting guide
  and from what is known of the service, not from a live key, so the classification is the most likely to need a change
  once real keys are tried. Whether `GET …/models` on the compatibility endpoint lists ids with a `models/` prefix (both
  forms are read), and whether Gemini counts hidden thinking tokens in `completion_tokens`, which only changes a
  person's own meter.
- Google and GitHub sign-in against the real providers, including the redirect URIs and the GitHub e-mail scope.
- The model deployment, its quota and its real prices, the budget alert and the action-group webhook (Azure cost data
  is late, and a budget does not stop spend).
- The Bicep against a subscription (only `bicep build`, and a what-if if it could be done read-only, was run).
- Behaviour under real load: the single replica, the synchronous database bridge and one connection per process
  are the pilot's design and are not changed here.
- Cloudflare Turnstile against the real service (only a fake of its verification endpoint was used, so the form of
  the request and of the answer is from its documentation), and the widget in a browser under the widened policy.
- The rate limits and the audit throttle are in the memory of one process. With the single replica the template allows
  they are exact; a second replica would give each its own counts, and the limits would double.
- That the security headers are what a browser is sent through the platform's proxy (they were read from the
  application's own answers), and that `X-Forwarded-For` is what the platform says it is, which `TRUST_PROXY` relies on:
  an address limit is only as good as the address it is given.
- Redirects, DNS rebinding, and the size, time and content-type limits of reading a web page were not tried again
  through the public routes: they are the fetcher's own, held by the pilot's tests, and the code is not changed here. A
  web page was never fetched on port 80 or 443 in a test, because a test cannot listen there; the port rule is shown by
  what is refused.

## 12. Self-review against the threat model (Phase 8)

Done after everything else was written, by reading the code and the tests again and by running them, not by restating
section 10. A "verdict" is about the code and the tests in this branch; none of it has met a real provider, a real model
or a real database server (section 11).

### What was run

On the machine of this work (four shared vCPUs, load average 12 to 17), on the tree of `bd8f9e1` and the documents of
the commit that follows it. Nothing was run against Azure, a real model, Google or GitHub.

| Check                   | Result                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types, lint, format     | `npm run typecheck` (five projects), ESLint with no warnings and Prettier on every tracked file: clean. (`npm run format:check` also reads `.scratch/`, which is not in the repository)                               |
| Unit and integration    | `npx vitest run`: 371 files, **9,322 passed, 2 skipped, 2 failed**. 475 of the passed tests are the public edition's. The two failures are listed below                                                               |
| Build                   | `npm run build`: clean. The public page's chunks are not referenced by `index.html`, so a pilot never fetches them                                                                                                    |
| Secret scan             | `npm run scan:secrets`: 0 findings in 5,860 history blobs and 3,328 working files; no tracked `.env`                                                                                                                  |
| Infrastructure, offline | `npm run iac:validate`: 83 checks passed. The what-if was not run                                                                                                                                                     |
| Mutation checks         | The 44 of the `public` area: all caught (40 on the first run, four more after a test was added for each). The 40 pilot mutations that target a file this branch changed: all 40 caught                                |
| Pilot unchanged         | `pilot-unchanged.test.ts` (7), the whole pilot suite, `ROUTE_POLICY` (`backend/src/auth/policy.ts`) and the URL fetcher are identical to the base, and the production journey passes 22 of 22                         |
| Browser, public edition | `public` 4 of 4: sign up, a free run, the cap reached, a key added, a run on it, the key forgotten, the account deleted; the administrator's switch with two browsers; one person against another's project; sign-out |
| Browser, the rest       | `model` 52 of 52, production journey 22 of 22, `local` 353 of 354, `signin` 19 of 20, `lab` 609 of 614, demonstration journey 1 of 8                                                                                  |

**Failures, and why they are not this branch's**

- `lab`: the four that were there before (`ask-composer.spec.ts` 174, 852 and 941 on the Ask screen; `ground.spec.ts` 1257,
  Ground on a phone), also failing at `bf7da24` and recorded in `baseline.md`. A fifth, `ask-scenario-review.spec.ts:125`
  (a popover that did not close within 15 s), passes alone.
- Demonstration journey (`journey`): fails at `demo-journey.spec.ts:263` with the same measurement at the base commit
  (a statement 936.9 px down a screen that is 900 px high); the six tests after it do not run.
- `signin/access.spec.ts:170`: the test presses Escape and opens the same menu again at once. In ten alternating runs it
  failed 4 times at the base commit and 5 times on this branch.
- `local/panels.spec.ts:210` (a button of 42 px against a minimum of 44 px, in a panel this branch does not change)
  failed once, and passed alone at the base, alone here, and in order in the first 129 tests of the suite.
- Unit: `foundry-client.test.ts` ("stops at once when it is cancelled mid-flight", which saw two requests to its fake
  where it expected one) and `scripts/mutation/run.test.ts` (which compares the scratch folder while other tests write
  their cache into it) failed once in the full run and pass alone; neither touches the public edition.

### The review against section 10

| Threat                               | Verdict                         | What was checked in this review                                                                                                                                                                                                                                                                                                                                                                                                        | What is left open                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF through URL fetch               | Held                            | `ssrf.test.ts` through the public routes (8 tests); mutations E43 (ports) and E44 (crawler) are caught. `backend/src/ingest/` and the evidence and guided routes are identical to the base (`git diff 3926bd9` is empty), so the pilot's fetcher tests apply as they were                                                                                                                                                              | Redirects, DNS rebinding and size limits were not exercised through the public routes; a test cannot listen on port 80                                                                                                                                                                 |
| SSRF through document extraction     | Held                            | A PDF with a link, an open action, a script and a remote go-to, all aimed at a canary server, is read and the canary sees nothing                                                                                                                                                                                                                                                                                                      | Nothing known                                                                                                                                                                                                                                                                          |
| SSRF through BYOK                    | Held                            | The provider host is one constant (`GEMINI_HOST`, the only place `googleapis.com` appears in `backend/src`), `redirect: 'error'`, and no setting, header or body field names a host; the fake transport sees only that host whatever a request says                                                                                                                                                                                    | Nothing known                                                                                                                                                                                                                                                                          |
| Prompt injection                     | Held, as far as a test can show | `injection.test.ts` (5): an obedient model is refused on both funding paths and nothing is kept; planted text is only in the untrusted part of a request; a model is sent none of another person's data                                                                                                                                                                                                                                | A model can still say something wrong or rude to the person who asked. Nothing else is reachable from it: no tools, no network, no other person's data                                                                                                                                 |
| Malicious uploads                    | Held                            | `abuse.test.ts`: over-size `413`, other content types `415`, a file that is not a PDF refused cleanly, a script in a document stays text in an answer that is JSON with `nosniff`                                                                                                                                                                                                                                                      | Parser bugs in the PDF worker are the pilot's, behind its isolation, size, page and time caps                                                                                                                                                                                          |
| Key theft (BYOK)                     | Held                            | No `localStorage`, `innerHTML`, `eval` or `console.*` in the public code (a search in this review); the canary key is absent from logs, answers, exports and every row of every table; E32 to E34 (redaction, header stripping) are caught; in a real browser the key is kept only in the tab (`sessionStorage`), is in no address, and goes only in headers to this site's own origin (`journey.spec.ts`)                             | A key is in the memory of the one server process while a run that uses it is carried out. A dump of that memory would show it. It also passes through the platform's TLS and proxy, which this design trusts                                                                           |
| Key-validation oracle                | Held                            | `connect` needs an account and is limited per account and per address; the answer is a status word, never the provider's text                                                                                                                                                                                                                                                                                                          | Nothing known                                                                                                                                                                                                                                                                          |
| Account farming                      | Held, with a limit              | Sign-up throttles per address and per hour, blocked domains, signups-off, a lifetime cap that survives deletion for the retention period; E17 to E20 are caught                                                                                                                                                                                                                                                                        | One determined person with many provider accounts and many addresses can use up the **shared** daily free pool every day. That denies the free tier to others; it cannot cost more than the global cap. Turnstile is off by default                                                    |
| Cost exhaustion                      | Held, in the app                | The worst case is reserved before a call and settled with the real usage; races are tested with real threads (`ledger-race.test.ts`); the kill switch, the global cap and the webhook are tested; E23 to E29 are caught                                                                                                                                                                                                                | Azure's budget alerts and does not stop spend. The price table in the configuration must match the real prices, or the cost cap is wrong. Hidden reasoning tokens are counted only if the provider reports them, which is why the free tier refuses a reasoning deployment at start-up |
| Data leaks between people            | Held                            | Every table is classified and has a policy (`rls.test.ts`, 11); every route is tried as every other person (`isolation.test.ts`, with `ISOLATION.md` generated from the route table); E1 to E3 are caught, and E3 now fails each test with the reason the edition gave                                                                                                                                                                 | Row security on the managed PostgreSQL service is proven only by the start-up check on the first deploy                                                                                                                                                                                |
| Session theft, fixation, CSRF        | Held                            | `routes/auth.ts`, `identity/google.ts` and `storage/login.ts` were read again line by line: the state and the binding are hashed, an attempt is spent on first use and expires, the nonce is compared in constant time, only `RS256` is accepted with a fixed issuer and audience, `email_verified` is required, a new session is made at every sign-in, and the return address is held on the server. E5, E6 and E8 to E15 are caught | No real Google or GitHub has been tried                                                                                                                                                                                                                                                |
| Open redirect                        | Held                            | E16 (the return address) is caught                                                                                                                                                                                                                                                                                                                                                                                                     | Nothing known                                                                                                                                                                                                                                                                          |
| Stack traces and internals in errors | Held                            | `abuse.test.ts` looks for a stack, a path, a query, a table, a host and a setting in every kind of error                                                                                                                                                                                                                                                                                                                               | Nothing known                                                                                                                                                                                                                                                                          |
| XSS, clickjacking, MIME sniffing     | Held                            | No sink of dynamic HTML or code in the public page (`ui-guards.test.ts` and a search); the headers on every kind of answer; the bot check's host is allowed in the content policy only when it is configured (E42)                                                                                                                                                                                                                     | The headers were read from the application's own answers, not through the platform's proxy                                                                                                                                                                                             |
| Enumeration                          | Held                            | Another person's project is answered exactly as one that does not exist; the same sign-in failure page whatever failed                                                                                                                                                                                                                                                                                                                 | Nothing known                                                                                                                                                                                                                                                                          |
| Incomplete deletion                  | Held                            | The test lists every table and text column for the person's address, text and subject, and now also counts the sessions left, on two devices (E22)                                                                                                                                                                                                                                                                                     | The audit log keeps that a deletion happened, with an opaque id and counts, and the keyed counter of free tokens for the retention period. Both are on the account page                                                                                                                |
| An administrator reading projects    | Held                            | The administrator is an ordinary account with a flag, decided from the verified address on every request; the admin routes read the ledger only; `isolation.test.ts` tries every route as the administrator                                                                                                                                                                                                                            | The list of administrator addresses must be addresses whose mailbox the owner controls, at a provider that verifies them                                                                                                                                                               |
| Denial of service                    | Held, with a limit              | Limits per account and per address, body and time limits, quotas, one replica with a CPU and memory cap                                                                                                                                                                                                                                                                                                                                | The limits are in the memory of one process: exact with one replica, doubled with two. A flood that the platform does not absorb before it reaches the process is not something this code can stop                                                                                     |
| Secrets in the repository            | Held                            | `npm run scan:secrets`: 0 findings in 5,860 history blobs and 3,328 working files, no tracked `.env`. The key-shaped strings that exist are fixtures (`canary`, `TESTKEY`), and no dependency was added                                                                                                                                                                                                                                | Nothing known                                                                                                                                                                                                                                                                          |

### What the review found, and what was done

- **Four security rules had a second layer hiding them from the tests** (found by the mutation checks, below). A
  switched-off account's session is deleted with it, so nothing tested the guard that refuses one that was not; the
  sessions of a deleted account were not counted, only shown to be unusable; no test asked what a run on a person's own
  key would be given once the key was gone, and the failure it guards against (a keyless run falling through to the
  operator's deployment) is the costliest one in this design; and a start-up refusal was reported by Vitest as a failed
  suite with every test skipped, which the runner does not count as a catch. A test for each was added.
- **A refusal of the free tier was swallowed.** The reading of a question catches a model failure and falls back to the
  rules, which is right, but a "free tier is used up" or "your key is needed" answer then looked like an ordinary
  fallback. The note on the reading now says that the model was not used and why (`scenario/parse.ts`,
  `reading.test.ts`). In a pilot nothing changes.
- **A bug in the mutation runner's reach check** (`mutants.ts` did not follow `import('./x')`, so the public edition's
  lazily loaded files looked unreachable) was fixed.

### Remaining risks before opening to the public

1. **None of it has met the real world.** No real sign-in, no real model call, no real Gemini key, no real Turnstile, no
   Azure deployment and no what-if. Deploy it closed first (ingress limited to your own address, DEPLOY.md section 11),
   use it alone, and run the first-run checks of section 10 before opening it.
2. **Cost control is the application's, not Azure's.** The budget alerts and its webhook help, but the daily cap and the
   price table are what act in real time. Start with low caps and look at `/api/admin/usage` daily.
3. **The free pool is shared, so one person can drain it each day.** Consider turning Turnstile on before the page is
   public (it is off by default, decision 10), keep the sign-up throttles, and decide whether to ask for more than an
   e-mail address.
4. **The legal text is a stub.** The terms and the privacy notice have not been reviewed, there is no export of a
   person's data, and the processors (Microsoft for the free tier, Google for a person's own key) must be named. This is
   the owner's decision (DECISIONS-FOR-OWNER.md, 5 and 6).
5. **One process holds what must not be lost, and what must not be shared.** Rate limits, the audit throttle and every
   key held for a run are in memory: a restart makes people paste their key again, and a second replica would double the
   limits and not share the keys. Do not scale out without moving them. The managed PostgreSQL's row security and role
   setup are proven only by the start-up check on the first deploy.
