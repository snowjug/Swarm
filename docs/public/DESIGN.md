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

All public-edition code lives under `backend/src/public/` and is imported only when the edition is `public`, so the
pilot's module graph is unchanged. Small, reviewed seams touch shared code:

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

| Variable                                      | Default       | Meaning                                                                                  |
| --------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `SWARM_EDITION`                               | `pilot`       | `pilot` or `public`                                                                      |
| `PUBLIC_BASE_URL`                             | **required**  | `https://…` origin of the site (`http` only for localhost). Redirect URIs derive from it |
| `PUBLIC_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET`  | unset         | Google sign-in is offered only when both are set                                         |
| `PUBLIC_GITHUB_CLIENT_ID` / `_CLIENT_SECRET`  | unset         | GitHub sign-in likewise. At least one provider is required                               |
| `PUBLIC_ADMIN_EMAILS`                         | empty         | Comma-separated verified e-mails that are platform administrators                        |
| `PUBLIC_SIGNUPS_ENABLED`                      | `true`        | Starting value of the "signups open" switch (the admin can flip it at run time)          |
| `PUBLIC_BLOCKED_EMAIL_DOMAINS`                | empty         | Comma-separated domains that cannot sign up (disposable mail)                            |
| `PUBLIC_MAX_PROJECTS`                         | `10`          | Projects per workspace                                                                   |
| `PUBLIC_STORAGE_QUOTA_MB`                     | `20`          | Stored text per workspace                                                                |
| `PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS`       | `30`          | How long the keyed counter of a deleted account is kept (section 4.6)                    |
| `PUBLIC_ALLOW_RESEARCH`                       | `false`       | Allow the web-research crawler                                                           |
| `PUBLIC_DB_RUNTIME_ROLE`                      | `swarm_app`   | The role that row security is enforced on (section 5)                                    |
| `PUBLIC_ALLOW_UNSAFE_SQLITE`                  | `false`       | Development only: SQLite has no row security, so public mode refuses it without this     |
| `PUBLIC_OPS_KEY_SHA256`                       | unset         | SHA-256 (hex) of the key the budget automation presents (section 6.6)                    |
| `FREE_TIER_ENABLED`                           | `true`        | Hard switch from the environment; `false` wins over the run-time switch                  |
| `FREE_USER_DAILY_TOKENS`                      | `60000`       | Tokens (input + output + hidden reasoning) one person may use per UTC day                |
| `FREE_USER_DAILY_CALLS`                       | `40`          | Model round trips one person may make per UTC day                                        |
| `FREE_USER_LIFETIME_TOKENS`                   | `300000`      | Tokens one account may ever use on the free tier                                         |
| `FREE_USER_CONCURRENT_RUNS`                   | `1`           | Runs (queued or running jobs) one workspace may have at once                             |
| `FREE_USER_CONCURRENT_CALLS`                  | `3`           | Model round trips one person may have in flight                                          |
| `FREE_GLOBAL_DAILY_TOKENS`                    | `2000000`     | Tokens all free users together may use per UTC day                                       |
| `FREE_GLOBAL_DAILY_COST_USD`                  | `5`           | Estimated spend all free users together may cause per UTC day                            |
| `FREE_TOKENS_PER_RUN`                         | `15000`       | Only for the meter: what "one run" is taken to cost                                      |
| `FREE_ROLE_MAX_OUTPUT_TOKENS`                 | table in code | JSON, per model role, at most these output tokens on the free tier                       |
| `BYOK_ENABLED`                                | `true`        | Allow people to bring a key                                                              |
| `BYOK_MAX_CONCURRENT_CALLS`                   | `4`           | Round trips one person may have in flight on their own key                               |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | unset         | Bot protection is on only when both are set                                              |

The model for the free tier is configured with the settings that exist: `AI_PROVIDER=foundry`, `AI_MODEL` (the
non-reasoning deployment, for example a `gpt-4.1-mini` deployment), `FOUNDRY_DEPLOYMENT_PROFILES` declaring it
`reasoning: false`, and `MODEL_PRICES` with a price for it. In public mode **start-up fails** if `FOUNDRY_DEPLOYMENT_REASONING`
is set, if the free deployment is declared as reasoning or its name is one of a known reasoning family (`o1`, `o3`,
`o4`, `gpt-5`) without `PUBLIC_ALLOW_REASONING_DEPLOYMENT=1`, or if it has no price: a cost cap is never enforced
from a guessed price. `MODEL_CACHE` is forced `off`.

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
- **Policies** (created by an idempotent `applyRowSecurity` step, never by a numbered pilot migration; it enables and
  **forces** row security on every table below, so the owner role is bound as well):

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

1. **The database boundary, without the application** (`public-rls.test.ts`). With two tenants' data in every table,
   as tenant A: `SELECT *` on **each** table returns none of B's rows; `UPDATE` and `DELETE` of B's rows affect 0
   rows; `INSERT` and `UPDATE` that would write a row into B's tenant fail with `42501`; a child row cannot be
   attached to B's project. With no context set, every statement fails closed.
2. **The routes, through the application** (`public-isolation.test.ts`). User B creates a project with documents,
   messages, claims, a studio report, stakeholders, a budget and a research record. User A, signed in, calls
   **every** `/api` route in the registry (`app.routes`) with B's project id in the path, in the query (`compare?with=`),
   and in the body where a route accepts one, and with every other path parameter taken from B's data. Each must answer
   as if the thing does not exist (404 or a refusal) and must return none of B's content. List routes must not
   contain B's rows and counts must not include them. The test is **generated from the registry**: a route that
   appears without being classified fails it, exactly as `auth.test.ts` fails for a route with no policy.
3. **The application check removed** (`public-isolation.test.ts`). The same attacks run with the application-level
   tenant check **disabled** (a test seam that makes `ownerInTenant` and the membership check say yes), and must
   still return nothing, because the database refuses. This is the test that shows RLS is the boundary and not a decoration.
4. **The docs list the routes.** [ISOLATION.md](ISOLATION.md), generated in Phase 8, lists every route that was
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
  settle(used: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number | null;
    reported: boolean;
  }): void;
  release(): void; // the call failed before it used anything
}
```

The public model factory (`createPublicModelFactory`) wraps the base factory. For each model it makes, it reads the
**funding** of the current context (free tier, or the person's own key) and builds the client with the right provider
configuration and the right gate. With **no funding context**, the model it returns refuses every call
(`NO_FUNDING_CONTEXT`): there is no path to the operator's credits that does not go through a signed-in person.

### 6.2 The ledger

A public-track table `usage_daily(day, subject, calls, input_tokens, output_tokens, reasoning_tokens,
reserved_tokens, cost_micro_usd, reserved_micro_usd, blocked)`, one row per UTC day per `subject`:
`u:<workspace id>` for a person and `global` for everyone. `usage_lifetime` holds each account's total.
`usage_reservations` holds what is reserved and not yet settled, so that a crashed process's reservations can be
released. The unit of cost is a millionth of a dollar.

### 6.3 Reserve, then settle

`begin` is one transaction, and **every cap is checked by a conditional `UPDATE`**, so the check and the reservation
are one atomic statement that cannot be passed by concurrent requests, in this process or in another:

1. Refuse if the kill switch is off (environment or run-time), or the person's account is disabled.
2. Estimate the call: `inputTokens` from the characters about to be sent, plus the **whole** `maxOutputTokens`
   (a reasoning model's hidden tokens are inside that limit), priced from `MODEL_PRICES`.
3. In order, each as `UPDATE … SET reserved_* = reserved_* + ? WHERE … AND used + reserved + ? <= cap`
   with a check of the changed row count; a failure rolls back the whole transaction:
   - the **person's day**: calls, and tokens (`FREE_USER_DAILY_*`);
   - the person's **lifetime** tokens (`FREE_USER_LIFETIME_TOKENS`);
   - the **global day**: tokens and estimated dollars (`FREE_GLOBAL_DAILY_*`);
   - the person's calls **in flight** (`FREE_USER_CONCURRENT_CALLS`).
4. Insert the reservation and return a ticket.

`settle` replaces the reservation with the real usage, in one transaction: `input + output` tokens as the provider
reported them (hidden reasoning tokens are inside `output`, and are also kept in their own column), priced the same
way. A provider that reports nothing is charged at the estimate, never at zero. `release` returns the reservation
when the call failed before it used anything. A reservation older than an hour is released by the upkeep timer, so a
crash cannot lock a cap.

Because the **whole worst case** is reserved before the request is sent, the sum of what is settled and what is
reserved can never pass a cap, however many calls are in flight. Settling after the fact, which is what the
per-project limit does, would let a burst through; that is why the free tier does not use it.

### 6.4 Defaults and the cap states

The defaults are in section 3. At the defaults a person can run roughly four small model-assisted runs a day (about
15,000 tokens each), at a worst-case cost of about $0.10 a day at `gpt-4.1-mini` list prices, and the whole free tier
stops at **2 million tokens or $5 a day**, whichever comes first. They are conservative on purpose and meant to be
changed by the owner (decision 2). The existing per-project caps stay in force, with public defaults of 300 calls and
400,000 tokens when `PROJECT_MODEL_*` is unset, and the free tier runs with `MODEL_OPERATION_TOKEN_LIMIT` unset or
lower.

What a person sees is a **state**, never an error:

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
(`ROLE_PARAMETERS`) is capped further by `RoutingConfig.maxTokensByRole` (new, optional, unset in the pilot), by
default `extraction 1500, actor 1200, scenario 1500, critic 1500, synthesis 2000, research-planner 1000`. A
deployment that reasons is refused at start-up, so hidden reasoning tokens cannot eat the cap.

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
opaque id), blocked requests by reason, and the state of the switches.

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
that key can use. The default is chosen from that list by rule: a `gemini-*` model that is a text model (not
`image`, `tts`, `live`, `audio`, `embedding`, `transcribe`, `veo`, `imagen`, `robotics`, `computer-use`), preferring
`flash` over others, the highest version number, and a stable name over a `preview` or `exp` one; the person can pick
any listed model. Model names change quickly, which is why none is written in code or configuration.

### 7.3 Key handling, all mandatory

| Rule                                                                             | How it is met                                                                                                                                                                               | Test                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The key lives only in the browser                                                | `sessionStorage` (cleared when the tab closes), never `localStorage`; held in memory by the page and sent per request in the header `X-Swarm-Provider-Key`                                  | UI test: nothing in `localStorage`; e2e                                       |
| Sent over HTTPS only                                                             | Same origin, `Secure` deployment, HSTS (helmet); the key is accepted only on a request that arrived over TLS in public mode (`x-forwarded-proto` from a trusted proxy)                      | test                                                                          |
| The server uses it for that request only                                         | Read by a hook into the request's context and **deleted from `request.headers`**; never put in a `Repository` call or any object that is stored                                             | test                                                                          |
| Never stored: database, logs, traces, metrics, errors, analytics, exports, cache | A **redaction layer** (`redactSecrets`) on the log stream, the error handler, provider error text, audit detail and telemetry attributes; no code path writes the key. `MODEL_CACHE` is off | canary test over logs, responses, exports and **every column of every table** |
| Sent only to the provider's fixed host                                           | The base URL is a constant in code. A header or body that names a URL, host or proxy is ignored. `redirect: 'error'`; the client's `fetch` target is asserted in tests                      | test                                                                          |
| Validated with one tiny request on "Connect"                                     | `POST /api/byok/connect` does one `GET …/models` (no tokens used) and answers a plain status: `valid`, `invalid`, `rate-limited`, `quota`, `region`, `unreachable`. It never echoes the key | fake Gemini                                                                   |
| Only the last 4 characters are shown                                             | Computed in the page from the key it holds. The server does not return any part of the key                                                                                                  | UI test                                                                       |
| "Forget key"; cleared on sign-out                                                | Clears `sessionStorage` and memory, and the server forgets any in-memory copy for the person's projects                                                                                     | e2e                                                                           |
| A notice                                                                         | "Your key is used only for your requests and is never saved. Use a key with a spend limit."                                                                                                 | e2e                                                                           |
| Not a key-validity oracle                                                        | `connect` needs a signed-in account and is limited to 10 a hour per account and per address                                                                                                 | test                                                                          |

**A key is short-lived server memory, not storage.** A run is a queued job and may outlive the request that started it.
So that a person's run can use their key, the key is kept in an **in-process map** (`EphemeralKeys`), keyed by
workspace and project, with a 90-minute idle and 4-hour absolute lifetime, never written anywhere, dropped on
"Forget key", on sign-out, on account deletion and when the process stops. This is the one deviation from "that
request only" and is decision 4. What keeps it safe: a project records a **non-secret funding marker**
(`project_funding`: `free` or `byok`), so a BYOK run whose key has gone **stops** with "your key is not saved, so the
run paused when the server restarted; reconnect your key and resume" and **never falls back to the owner's credits**.
Because the map is per process, the public deployment runs **one replica** (decision 4).

### 7.4 Limits for BYOK

A BYOK request is exempt from the free tier's caps (and from the global cap), and so can never be blocked by it. It
still has: the per-IP and per-account rate limits, `BYOK_MAX_CONCURRENT_CALLS`, one concurrent run per workspace, the
per-project caps (`PROJECT_MODEL_*`, which exist to bound the size of a project), the workspace project and storage
quotas, and the body and upload limits. Its calls are counted in `usage_daily` under `b:<workspace id>` for the
person's own meter and the admin's view, and are never added to `global`.

### 7.5 Errors in plain words

One next action each; provider text is never repeated. The mapping covers: bad key (`401`, `403`: "Google did not accept this
key. Check that you copied all of it, or make a new one in AI Studio"), rate limited (`429`: "Your Google quota is used
up for the moment. Wait a minute, or try a different model"), quota or billing (`RESOURCE_EXHAUSTED` with a quota
message, `402`: "Your Google quota or billing does not allow this. Check your plan in AI Studio"), region (`403` with
a location message, or "not available in your location": "Google does not offer this key's service from where the
server is. Try another key"), model not found (`404`: pick another model), safety block (the reply was blocked:
"Google blocked this request for safety reasons. Change the text and try again"), truncated and schema-invalid
(the existing outcomes, reworded), timeout and unreachable.

## 8. Abuse protection (e, Phase 5)

| Control                     | Design                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limits                 | Per IP (the existing limiter, with the real client address behind the trusted proxy) **and** per account, on sign-in start, sign-in callback, project creation, model runs, URL fetch and document extraction, key connect, account deletion. In-process; with one replica that is exact. `RATE_LIMIT_SCALE` still scales them for tests                                                                       |
| Request size and uploads    | The existing 600 KB body limit; PDF extraction 2.7 MB with a page cap and the isolated worker; a public cap on the number and size of documents per project; unknown content types refused with 415                                                                                                                                                                                                            |
| Per-workspace quotas        | `PUBLIC_MAX_PROJECTS` projects; `PUBLIC_STORAGE_QUOTA_MB` of stored text (project payloads, chunks, messages); both enforced on create and on adding documents, with a plain message                                                                                                                                                                                                                           |
| Account-creation throttling | Per IP per day and global per hour, from a table of hashed addresses (a daily-rotating salt) so that no address is stored; blocked e-mail domains; a lifetime cap on free tokens                                                                                                                                                                                                                               |
| Bot-protection hook         | Cloudflare Turnstile, **off by default, implemented and tested with a fake**. When both keys are set, `POST /auth/start/:provider` must carry a token, which the server checks once against the fixed host `https://challenges.cloudflare.com/turnstile/v0/siteverify`. The CSP is widened for that host only when it is on                                                                                    |
| Strict CORS, CSP, headers   | No CORS headers are ever sent; the origin allow-list refuses other origins. CSP as today plus `form-action 'self'`, `base-uri 'self'`, `frame-ancestors 'none'`, `object-src 'none'`; `Referrer-Policy: no-referrer`, a `Permissions-Policy` that denies everything the app does not use, HSTS, `X-Content-Type-Options: nosniff`, COOP and CORP, `Cache-Control: no-store` on every `/api` and `/auth` answer |
| No open redirects           | `safeReturnTo`; the provider is a path segment checked against the configured list; the redirect URIs are built from `PUBLIC_BASE_URL`                                                                                                                                                                                                                                                                         |
| Errors without internals    | The existing error body, plus: in public mode a model or storage failure never names a deployment, an endpoint, a host, a table or a path, and no stack trace is ever sent. A test scans error bodies for them                                                                                                                                                                                                 |
| Admin switches              | "Disable user" (the account is refused at sign-in and on every request, its sessions are deleted) and "disable signups" (new accounts refused; existing people can still sign in), both audited, both effective at once                                                                                                                                                                                        |
| Security audit log          | The existing audit chain, with events `public.signup`, `public.signin`, `public.signin.refused` (reason code), `public.signout`, `public.account.deleted`, `public.byok.connect` (status code), `public.free.blocked` (reason), `public.admin.*`, `public.rate.limited`. **Identifiers, codes and counts only**: no e-mail, no key, no document text, no IP                                                    |
| Cost-based abuse            | Section 6                                                                                                                                                                                                                                                                                                                                                                                                      |

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

| Route                          | Answer                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/public/session`      | `{ edition: "public", signedIn, providers: [{id, label}], signupsOpen, bot: { kind: "turnstile", siteKey } \| null, freeTier: { available, reason }, byokEnabled, legal: { terms, privacy }, user: null \| { emailMasked, provider, isAdmin, createdAt }, session: null \| { idleExpiresAt, expiresAt } }` |
| `GET /api/public/status`       | `{ status: "ok" \| "degraded" \| "maintenance", freeTier: { available, reason, resetsAt }, byokEnabled, signupsOpen, message: string \| null, checkedAt }`: for the status page                                                                                                                            |
| `GET /api/public/legal/:doc`   | `doc` is `terms` or `privacy`: `{ title, text, reviewed: boolean }`                                                                                                                                                                                                                                        |
| `POST /auth/start/:provider`   | body `{ returnTo?, turnstileToken? }` → `{ url }` and the binding cookie. 404 for an unknown provider, 429 when limited, 403 `BOT_CHECK_FAILED`                                                                                                                                                            |
| `GET /auth/callback/:provider` | `?code&state` → 302 to the return path with the session cookie, or to `/?signin=failed\|closed\|unverified\|disabled\|blocked`                                                                                                                                                                             |
| `POST /auth/logout`            | 204, cookie cleared                                                                                                                                                                                                                                                                                        |
| `POST /api/ops/free-tier/off`  | `Authorization: Bearer <key>` or `?key=` → `{ freeTier: "off" }`. Off only. Rate limited                                                                                                                                                                                                                   |

### Signed in

| Route                                                  | Answer                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/account`                                     | `{ emailMasked, provider, createdAt, isAdmin, projects: { count, limit }, storage: { usedBytes, limitBytes } }`                                                                                                                                                                                        |
| `DELETE /api/account`                                  | body `{ confirm: "delete my account" }` → 204, everything deleted (section 4.6), cookie cleared                                                                                                                                                                                                        |
| `GET /api/usage`                                       | `{ funding: "free" \| "byok", free: { available, reason, resetsAt, today: { calls, callLimit, tokens, tokenLimit, runsLeft, tokensPerRun }, lifetime: { tokens, limit }, inFlight: { calls, limit } }, byok: { enabled, today: { calls, tokens } } }`. `funding` is what **this request** would use    |
| `POST /api/byok/connect`                               | headers `X-Swarm-Provider: gemini`, `X-Swarm-Provider-Key` → `{ status: "valid"\|"invalid"\|"rate-limited"\|"quota"\|"region"\|"unreachable"\|"disabled", message, models: [{id, label}], defaultModel }`. HTTP 200 for every status. 400 only for a malformed request. The key is never in the answer |
| `GET /api/provider/status`, `POST /api/provider/check` | existing routes. In public mode: the caller's funding only (`{ configured, provider: "free-tier"\|"gemini", model: label, … }`), no endpoint, deployment or global counters; `check` runs only for BYOK, and for the free tier answers from the ledger without a model call                            |
| every other existing `/api` route                      | unchanged, and funded by the request's funding                                                                                                                                                                                                                                                         |

BYOK headers (read on any signed-in request, only in public mode, then deleted from the request):
`X-Swarm-Provider: gemini`, `X-Swarm-Provider-Key: <key>`, `X-Swarm-Provider-Model: <model id>` (optional). The page
attaches them to changes and to `GET /api/usage`.

### Platform administrator

| Route                               | Answer                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/usage?days=14`      | `{ days: [{ day, calls, tokens, reasoningTokens, costUsd, blocked }], topUsers: [{ id, emailMasked, tokens, calls }], blocked: { byReason }, switches: { freeTierEnv, freeTierRuntime, signups }, today: { global: {...}, limits: {...} } }` |
| `POST /api/admin/free-tier`         | `{ enabled: boolean }` → the switches                                                                                                                                                                                                        |
| `POST /api/admin/signups`           | `{ enabled: boolean }` → the switches                                                                                                                                                                                                        |
| `POST /api/admin/users/:id/disable` | `{ disabled: boolean }` (id as in `topUsers`, or `{ email }` in the body instead) → `{ id, disabled }`                                                                                                                                       |
| `GET /api/admin/audit?limit=50`     | recent public security events (codes only)                                                                                                                                                                                                   |

Refused in public mode with 404 `NOT_AVAILABLE`: `GET|PUT|DELETE /api/workspace/members…` and
`GET|PUT|DELETE /api/projects/:id/members…`. Bearer tokens get 401.

## 10. Threat model for public mode (f)

Test files are in `backend/test/` and, for the browser, `e2e/`. "Pilot" threats that are already covered
(`docs/production/threat-model.md`) are not repeated.

| Threat                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Test                                                                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SSRF through URL fetch**                    | The existing policy (`ingest/url/policy.ts`, `fetcher.ts`): scheme, user-info, internal names, unusual IP forms, ports 80 and 443 only, every DNS answer checked and the connection pinned to those answers, redirects followed by hand (5) and re-checked, `169.254.0.0/16` (metadata), loopback, link-local, private, CGNAT, multicast, IPv6 (only global unicast), IPv4-mapped. Size, time, content-type and decompression caps, concurrency 8 and a queue. **Public additions**: a per-account limit, ports fixed, `URL_INGEST_ALLOWED_HOSTS` supported, and the research crawler off | `public-ssrf.test.ts`: through the public routes, as a signed-in public user, every address class, a name that resolves private, a redirect to the metadata address, a rebinding name, an oversize body, a slow body, a wrong content type |
| **SSRF through document extraction**          | Extraction reads uploaded bytes only and never follows a link. PDFs go to the isolated worker with a size, page and time cap; CSV and JSON are parsed as text with limits                                                                                                                                                                                                                                                                                                                                                                                                                 | `public-ssrf.test.ts`: a PDF with remote references triggers no request; oversize and malformed files are refused cleanly                                                                                                                  |
| **SSRF through BYOK**                         | The provider host is a constant; no setting, header or body field changes it; `redirect: 'error'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `public-byok.test.ts`: the fake transport sees only the Gemini host, whatever the request says                                                                                                                                             |
| **Prompt injection**                          | The existing defences: user data is fenced as `untrustedScenarioData`, injected instructions are detected, the reply must validate against a schema, a reply that repeats an injected payload is rejected, and the model has no tools, no network and no other tenant's data in context. RLS means that even a fully hijacked model call cannot read another tenant                                                                                                                                                                                                                       | `public-injection.test.ts`: an injection in a document does not change the shape, leak the system prompt, or surface another user's text                                                                                                   |
| **Malicious uploads**                         | Body and file limits, content-type allow-list, the PDF worker's isolation, parse limits, no file kept (only the extracted text), text rendered by React and never as HTML                                                                                                                                                                                                                                                                                                                                                                                                                 | `public-abuse.test.ts`: oversize (413), wrong type (415), script content stays text                                                                                                                                                        |
| **Key theft (BYOK)**                          | Section 7.3: never stored, redacted, header only, `sessionStorage`, no cache, CSP, `no-store`. A stolen session cookie does not reveal a key, because the server does not have it after the request                                                                                                                                                                                                                                                                                                                                                                                       | canary tests: logs, responses, exports, every row of every table                                                                                                                                                                           |
| **Key-validation oracle**                     | `connect` needs an account, is limited per account and per IP, and is audited by status code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `public-byok.test.ts`                                                                                                                                                                                                                      |
| **Account farming**                           | Verified e-mail through a real provider, per-IP and global signup throttles, blocked domains, Turnstile hook, a lifetime free cap that survives deletion for 30 days, a global daily cap, admin disable and "signups off"                                                                                                                                                                                                                                                                                                                                                                 | `public-abuse.test.ts`, `public-ledger.test.ts`                                                                                                                                                                                            |
| **Cost exhaustion**                           | Section 6: reservation of the worst case, per-user, lifetime and global caps, kill switch (environment, run time, budget webhook), non-reasoning model, per-role output caps, project caps, one replica and a CPU and memory cap in the template                                                                                                                                                                                                                                                                                                                                          | `public-ledger.test.ts`: a race that cannot pass the cap, the used-up state, the kill switch, BYOK unaffected                                                                                                                              |
| **Data leaks between users**                  | Section 5: policies in the database plus the application checks, opaque ids, uniform 404, masked e-mail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `public-rls.test.ts`, `public-isolation.test.ts`, the browser journeys                                                                                                                                                                     |
| **Session theft, fixation, CSRF, login CSRF** | Section 4.4: a new identifier at every sign-in, hashed storage, expiry, revocation, `SameSite`, the custom header, the origin allow-list, `state` plus the binding cookie plus PKCE                                                                                                                                                                                                                                                                                                                                                                                                       | `public-auth.test.ts`                                                                                                                                                                                                                      |
| **Open redirect**                             | `safeReturnTo`, fixed redirect URIs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `public-auth.test.ts`                                                                                                                                                                                                                      |
| **Stack traces and internals in errors**      | Section 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `public-abuse.test.ts`: error bodies scanned for frames, paths, SQL, table names, hosts                                                                                                                                                    |
| **XSS, clickjacking, MIME sniffing**          | Strict CSP without inline script, `frame-ancestors 'none'`, `nosniff`, React escaping, the legal text rendered as text                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `public-abuse.test.ts` (headers), the UI tests                                                                                                                                                                                             |
| **Enumeration of accounts or projects**       | Opaque random ids, the same 404 for "not yours" and "not there", no e-mail in any response but the person's own (masked), the same sign-in failure page whatever failed                                                                                                                                                                                                                                                                                                                                                                                                                   | `public-isolation.test.ts`, `public-auth.test.ts`                                                                                                                                                                                          |
| **Incomplete deletion**                       | One transaction; a test lists every table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `public-account.test.ts`                                                                                                                                                                                                                   |
| **A platform administrator reading projects** | An administrator is a normal account with the flag; the admin routes read the ledger only; RLS gives no route a way to ask for system context                                                                                                                                                                                                                                                                                                                                                                                                                                             | `public-isolation.test.ts`: the admin account as attacker                                                                                                                                                                                  |
| **Denial of service**                         | Body and time limits, rate limits, concurrency caps, a CPU and memory cap and a replica cap in the template; the free tier's global cap bounds model load                                                                                                                                                                                                                                                                                                                                                                                                                                 | `public-abuse.test.ts`                                                                                                                                                                                                                     |
| **Secrets in the repository**                 | No key, token or `.env` is committed; `scripts/secret-scan.mjs` runs on the tree, the tests and the snapshots                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase 8 secret scan                                                                                                                                                                                                                        |

## 11. What cannot be verified here

Nothing in this work calls a real model, signs in with a real Google or GitHub account, or deploys. So, to be proven
by the owner after deploying (the exact checks are in [DEPLOY.md](DEPLOY.md)):

- Row security on the real Azure Database for PostgreSQL (the start-up self-check refuses to run if it is not in
  force, and PGlite is real PostgreSQL code but not the managed service).
- Gemini's compatibility endpoint accepting `max_completion_tokens` and every strict schema (the client adapts, and
  the fake server in the tests encodes what the documentation says, not what the live service does).
- Google and GitHub sign-in against the real providers, including the redirect URIs and the GitHub e-mail scope.
- The model deployment, its quota and its real prices, the budget alert and the action-group webhook (Azure cost data
  is late, and a budget does not stop spend).
- The Bicep against a subscription (only `bicep build`, and a what-if if it could be done read-only, was run).
- Behaviour under real load: the single replica, the synchronous database bridge and one connection per process
  are the pilot's design and are not changed here.
