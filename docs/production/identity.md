# Identity, access and the deployment guards

How a person is identified, what they may do, how a session ends, and what a pilot or production
deployment must be set up like before it will start. It reviews what is built; it does not describe a
live tenant, because none has been used. **UNVERIFIED** marks every statement that needs one.

Read with [ADR 0005](../adr/0005-identity-roles-and-tenancy.md) (tokens, default-deny routes),
[ADR 0007](../adr/0007-workspace-and-project-membership.md) (membership) and
[ADR 0008](../adr/0008-browser-sign-in.md) (browser sign-in). The commands that register the application
are in [the pilot plan](../azure/pilot-plan.md#entra-app-registration); this page says which choices
matter and why, and what the server checks at start-up.

## 1. Deployment modes

`DEPLOYMENT_MODE` is `local` (the default), `pilot` or `production`, in any case and with any spacing. A
value that is not one of the three stops the start: it is never read as `local`.

| Mode         | What it is                                      | What start-up does                                                                |
| ------------ | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `local`      | One person on their own machine                 | Exactly what it always did: no new requirement, nothing refused                   |
| `pilot`      | A controlled group on a hosted server           | Refuses an unsafe configuration, with one error that lists every reason           |
| `production` | The same, and stricter where a pilot may choose | The same, and refuses a database password, a SQLite file, a model key, debug logs |

`DEPLOYMENT_LABEL` is what the product says it is (plain text, 80 characters at most, no control,
formatting, line-break or angle-bracket characters, judged after Unicode normalisation so that
full-width letters are not a way round it). A pilot's default is `PRODUCTION-CANDIDATE CONTROLLED PILOT`;
a pilot label must say pilot and must not call it production, generally available or public, so a pilot
is never labelled as the broad public release. A production deployment must give a label and must not
call itself a pilot. `BUILD_SHA` (7 to 40 hexadecimal characters) names the commit that was built.
Both are in `/api/config` for a signed-in caller as `deployment` and `build`, and in the monitoring as
`swarm.deployment.info`. `/api/config` needs sign-in, so neither is shown to an anonymous caller.

**A local run that looks hosted** (a host name that is not this machine in `ALLOWED_HOSTS`, an https
sign-in address, a database on another machine) still starts, exactly as before, and logs one warning
saying the pilot and production checks did not run. That is the guard against the commonest mistake: a
deployment whose template never set `DEPLOYMENT_MODE`. The release check should read `deployment.mode`
from `/api/config` after sign-in and fail if it is not the one the template says.

### The guard matrix

The checks are in `backend/src/deployment.ts`, one function per topic. Each returns every problem it
finds, and the refusal repeats no credential, address or connection string (a test plants a canary in
every setting and reads the message). A setting that loosens a rule is on unless it is plainly off
(`false`, `0`, `no`, `off`, empty), so `TRUE`, `yes` and `1` do not slip past a check for `true`.

| Rule                                                                                                           | Pilot                             | Production | Settings                                                      |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------- | ------------------------------------------------------------- |
| Sign-in is Microsoft Entra, never `none`                                                                       | refused                           | refused    | `AUTH_MODE`                                                   |
| Browser sign-in is configured                                                                                  | refused                           | refused    | `AUTH_ENTRA_CLIENT_ID`, `AUTH_ENTRA_REDIRECT_URI`             |
| The sign-in address is https (so the cookie is `Secure` and `__Host-`) and not a loopback address              | refused                           | refused    | `AUTH_ENTRA_REDIRECT_URI`                                     |
| A session idles for at most 60 minutes and lasts at most 12 hours                                              | refused                           | refused    | `AUTH_SESSION_IDLE_MINUTES`, `AUTH_SESSION_ABSOLUTE_HOURS`    |
| Signing keys are fetched from Microsoft's endpoint only                                                        | refused                           | refused    | `AUTH_ENTRA_JWKS_URI` (leave it unset)                        |
| The model is not reached with an API key                                                                       | unless `ALLOW_MODEL_API_KEY=true` | refused    | `AI_PROVIDER`, `AZURE_OPENAI_AUTH`                            |
| No model key is held that is not used                                                                          | warned                            | refused    | `AZURE_OPENAI_API_KEY`, `OPENAI_API_KEY`                      |
| The model endpoint is https                                                                                    | refused                           | refused    | `AZURE_OPENAI_ENDPOINT`, `OPENAI_BASE_URL`, `OLLAMA_BASE_URL` |
| The database requires TLS: exactly one `sslmode`, and it is `require`, `verify-ca` or `verify-full`            | refused                           | refused    | `DATABASE_URL`                                                |
| The database is PostgreSQL                                                                                     | warned (SQLite)                   | refused    | `DATABASE_URL`                                                |
| The database is signed in to with a managed identity                                                           | warned                            | refused    | `DATABASE_AUTH=entra`                                         |
| Allowed hosts are listed: no wildcard, no `localhost` or loopback address in any spelling                      | refused                           | refused    | `ALLOWED_HOSTS`                                               |
| Allowed origins are listed, https, not loopback, and include the origin of the sign-in address                 | refused                           | refused    | `ALLOWED_ORIGINS`                                             |
| A proxy is trusted (the number in front of the server; 1 behind one ingress)                                   | refused                           | refused    | `TRUST_PROXY`                                                 |
| Telemetry is configured with a valid Application Insights connection string                                    | refused                           | refused    | `APPLICATIONINSIGHTS_CONNECTION_STRING`                       |
| Pages are read over HTTPS only (port 80 is refused; the default is 443)                                        | refused                           | refused    | `URL_INGEST_ALLOWED_PORTS`                                    |
| No research or ingestion switch allows plain HTTP, loopback or private addresses (`*_ALLOW_HTTP` and the like) | refused                           | refused    | `RESEARCH_ALLOW_*`, `URL_INGEST_ALLOW_*`                      |
| The host allow-list for page reads names no private suffix (`.local`, `.internal`, `.corp`, `.home.arpa`, …)   | refused                           | refused    | `URL_INGEST_ALLOWED_HOSTS`                                    |
| Logging is not at debug level                                                                                  | allowed                           | refused    | `LOG_LEVEL`                                                   |
| The per-address rate limits are not raised                                                                     | refused                           | refused    | `RATE_LIMIT_SCALE`                                            |
| No test or demonstration seam is set (`SWARM_TEST_*`, `SWARM_DEMO_*`, `E2E_*`, `DEMO_MODE`, …)                 | refused                           | refused    | any such name, in any case                                    |
| Certificate checking is not switched off                                                                       | refused                           | refused    | `NODE_TLS_REJECT_UNAUTHORIZED`                                |
| `BUILD_SHA`, when set, is a commit id                                                                          | refused                           | refused    | `BUILD_SHA`                                                   |
| The label is what the mode says it is                                                                          | refused                           | refused    | `DEPLOYMENT_LABEL`                                            |

Two defaults differ in a hosted mode: with no `URL_INGEST_ALLOWED_PORTS`, pages are read from 443 only
(a local run keeps 80 and 443). Warnings (a SQLite file in a pilot, a database password in a pilot, a
model key that is not used, a client secret, silent logs, no `BUILD_SHA`) do not stop the start; they are
logged once, never with a value.

Naming a new switch: any setting that lets a fetch use plain HTTP, a loopback or a private address should
be called `RESEARCH_ALLOW_<WHAT>` or `URL_INGEST_ALLOW_<WHAT>` with `<WHAT>` one of `HTTP`, `INSECURE`,
`PLAINTEXT`, `CLEARTEXT`, `DOWNGRADE`, `PRIVATE`, `LOOPBACK`, `LOCALHOST`, `INTERNAL`, `METADATA`; the guard
refuses it when it is on without knowing its name. A switch that is named otherwise needs a line in
`backend/src/deployment.ts`. The code that reads such a switch must read it strictly, so that only the
word `true` turns it on: a parser that makes any non-empty text true (`z.coerce.boolean()` reads `false`
as true) disagrees with the guard in the one direction it cannot see.

What the guard cannot know: that `TRUST_PROXY` is the true number of proxies (set higher than the truth, a
caller can name its own address in `X-Forwarded-For`), that the database host is the right one, or that a
connection string is the application's own. `local` can always be chosen by whoever sets the
environment, which is why the warning above exists and why the release check reads the mode back.

## 2. The Entra application

Two things are registered, and the pilot plan registers them as one application: a **Web** application that
people sign in to, and the **API** that tokens are issued for (the same registration, with app roles).

**Single tenant or several.** `AUTH_ENTRA_TENANT_ID` names the one tenant whose people may sign in, and the
sign-in goes to that tenant's authority. `AUTH_ENTRA_ALLOWED_TENANTS` (a comma-separated list of tenant ids)
adds more; with more than one, the sign-in goes to `organizations` and the registration must be
multi-tenant. Every token's tenant is checked against the list in the server, whichever the registration
says, and the issuer is derived from the token's own tenant only after the list agrees. Prefer one tenant
for a pilot. **UNVERIFIED**: sign-in from a second tenant, and what the other tenant's administrator must
consent to.

**Redirect URI.** Exactly `https://<the deployed host name>/auth/callback`, registered on the **Web**
platform, and derived from the deployed address, not typed twice: the template builds `ALLOWED_HOSTS`,
`ALLOWED_ORIGINS` and `AUTH_ENTRA_REDIRECT_URI` from one host name. The server refuses a redirect address
that is not https (a local run may use `http://localhost`), has another path, or carries a query or a
credential; and its host must be in `ALLOWED_HOSTS`. Entra matches the address exactly, so a trailing slash
or another host is a failed sign-in, not a redirect somewhere else.

**Permissions and scopes.** The sign-in asks for `openid profile` and nothing else: no API permission, no
`offline_access`, so there is no refresh token and the access token the token endpoint returns is thrown
away unread. Leave the implicit-grant boxes unchecked and add no single-page-app or public-client
platform. The API takes bearer tokens whose audience is `AUTH_ENTRA_AUDIENCE` and whose issuer is the v2
endpoint of an allowed tenant; the server does not check a scope, because who may do what comes from
membership (below). **UNVERIFIED**: that the registration issues v2 tokens (`requestedAccessTokenVersion`
is 2, or a v1 token is refused for its issuer), and which form of the audience (the client id or the
application ID URI) Entra puts in a token for this registration: `AUTH_ENTRA_AUDIENCE` must equal it.

**How the application proves itself.** Preferably `AUTH_ENTRA_CLIENT_ASSERTION=managed-identity`: the
container's managed identity is the credential (a federated credential on the registration whose issuer
is the tenant's v2 endpoint, whose subject is the identity's **principal** id and whose audience is
`api://AzureADTokenExchange`), so nothing is stored. A client secret (`AUTH_ENTRA_CLIENT_SECRET`, from a
secret store, never from source) works, is warned about in a hosted mode, and is mutually exclusive with
the assertion. **UNVERIFIED** against a real tenant: the federated exchange, key roll-over and the consent
screen.

**Require assignment.** Set `appRoleAssignmentRequired` on the enterprise application, so that only people
who were assigned a role can sign in at all. The server also refuses a signed-in person with no Swarm app
role (`/?signin=norole`).

## 3. Roles: least privilege

An Entra **app role** only lets a person in. What they may do is their **membership**, read from the
database on every request, so removing someone takes effect on their next call whatever their token says.

| App role                                                             | Give it to                                      | What it does                                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Swarm.User` (and `Swarm.Reader`, `Swarm.Analyst`, `Swarm.Reviewer`) | Everyone who may sign in                        | Lets them in. Confers no access to any workspace or project                                      |
| `Swarm.Admin`                                                        | **One named person**, first, and then remove it | If a workspace has no owner, the first holder to make a request becomes its owner, once, audited |
| `Swarm.PlatformAdmin`                                                | Whoever runs the platform, and no one else      | A paid model check and the audit chain's integrity. Sees no project content                      |

| Membership                                 | May                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace owner                            | Everything in the workspace, including appointing owners                                                                                      |
| Workspace admin                            | Everything in the workspace except the owners                                                                                                 |
| Workspace member                           | Create projects; sees only the projects they were added to                                                                                    |
| Project lead / analyst / reviewer / viewer | Lead: run, edit, review, delete and share (not set the budget). Analyst: run, edit, ask. Reviewer: read, export, review. Viewer: read, export |

Reviewing is a separate duty from running; the person who runs a project's work cannot lift its model
budget. A project in another tenant, or one the caller was not added to, is reported as not found, so
its existence is not disclosed.

## 4. Sessions, sign-out and CSRF

- **A session** is a random 256-bit value in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` and
  `__Host-` prefixed on https). Only its hash is stored. It ends after the idle limit (30 minutes by
  default, at most 60 in a hosted mode) and at the absolute limit (8 hours by default, at most 12), and a
  removed member's sessions are deleted in the same transaction.
- **Signing in** is the Authorization Code flow with PKCE (S256), run by the server. `state`, a nonce and
  a binding cookie make an attempt usable once, by one browser, within ten minutes; the ID token is
  verified (signature, issuer from the allowed tenant, audience, expiry, nonce); an ID token cannot be
  presented as an access token.
- **Signing out** is `POST /auth/logout` with `X-Swarm-CSRF: 1`: it ends Swarm's session and clears the
  cookie. It does not end the person's Microsoft session, and there is no front-channel or back-channel
  logout and no Continuous Access Evaluation: a person disabled in Entra keeps their Swarm session until
  it ends or an owner removes them from the workspace.
- **CSRF.** A change made with a cookie must carry `X-Swarm-CSRF: 1`, which another site cannot make a
  browser add, and must come from an allowed origin; the server sends no CORS header and refuses a
  cross-origin preflight. A bearer token is exempt, because a browser does not send one unasked. The
  value is constant, not per session: that rests on the absence of CORS and on `SameSite=Lax`, and has
  only been tested with the test browser and the in-process requests, **UNVERIFIED** against other browsers.
- **Every route** has an authorization policy and an audit policy, and a test holds both to the routes the
  server really registers. A refusal of a signed-in caller is audited as `access.refused`; an anonymous one
  is not, because it would fill the log and the rate limiter already counts it.

### Rate limits

Every route has the general limit of 120 requests a minute per address, and every route that changes
something has a limit of its own, except five that are held to the general limit and listed, with the
reason, in `backend/test/security.test.ts` (which fails if the list and the routes disagree):
`POST /api/projects/:id/cancel`, `DELETE /api/projects/:id`, `PUT /api/projects/:id/intervention`,
`PATCH /api/projects/:id/environment` and `POST /api/projects/:id/surveys/:surveyId/cancel`. The
sign-in routes (`/auth/login`, `/auth/callback`, `/auth/logout`) are outside `/api`, do their own checks
and have a limit of 30 a minute. The environment edit (a body of up to 600 kB, written whole) is the
one that deserves a limit of its own.

## 5. Azure dependencies use the managed identity

| Dependency             | How the application authenticates                                                     | Setting                                                              |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| PostgreSQL             | A Microsoft Entra access token as the password, fetched for each connection           | `DATABASE_AUTH=entra`                                                |
| Azure OpenAI / Foundry | A token from the managed identity; no key is read                                     | `AZURE_OPENAI_AUTH=entra` or `FOUNDRY_AUTH=entra`, `AZURE_CLIENT_ID` |
| Application Insights   | The telemetry is signed with the identity; the component refuses local authentication | `APPLICATIONINSIGHTS_CONNECTION_STRING`, `AZURE_CLIENT_ID`           |
| Entra (token endpoint) | The identity's assertion, not a secret                                                | `AUTH_ENTRA_CLIENT_ASSERTION=managed-identity`                       |

Production refuses a database password and a model key; a pilot is warned about the first and refuses the
second unless `ALLOW_MODEL_API_KEY=true` records the decision.

## 6. A local, rules-only run does not weaken any of this

`AUTH_MODE=none`, `HOST=127.0.0.1`, `AI_PROVIDER=none` and no `DEPLOYMENT_MODE` is the development path: one
local user, no model, the deterministic rules for every step. Nothing in it relaxes a hosted check,
because the checks are in the loader and a hosted mode cannot be reached without passing them; there is
no setting that disables them, only the choice of `local`, which refuses nothing and warns when the
configuration looks hosted. To exercise browser sign-in without a tenant, use the in-process identity
provider of the tests (`backend/test/support/entra-idp.ts` and `e2e/support/microsoft.ts`), or an `http`
sign-in address on `localhost`, which only a local run accepts.

## 7. The owner's checklist

Before the first person is let in:

1. The registration is single-tenant (or the allowed tenants are written down), a **Web** platform with
   the exact redirect URI, no implicit grant, and the three app roles.
2. The enterprise application requires assignment; `Swarm.Admin` is assigned to one named person and
   `Swarm.User` to nobody else yet.
3. `DEPLOYMENT_MODE=pilot` (or `production`) is in the template, the label says what it is, and
   `BUILD_SHA` names the commit.
4. The container starts. If it does not, the error lists every setting to fix; none of them repeats a
   value. A start that is refused is the guard working.
5. After the first owner signs in: remove `Swarm.Admin` from that person if they do not need it again, and
   assign `Swarm.User` to the rest. Add people to the workspace by their Entra object id.
6. `/api/config` (signed in) says the mode and the build that were meant, and `swarm.deployment.info` shows
   them in the monitoring.
7. Someone has signed in, signed out, and been refused a project they were not added to.

## 8. What is not covered, and gaps found but not changed

- **No live tenant.** Everything marked **UNVERIFIED** above; Conditional Access, multi-factor prompts,
  group claims and the consent screen have not been seen.
- **Tenant isolation is application code.** Every query filters by tenant and an id outside the path has to
  be checked by its handler (a test lists every such field), but the database has no row-level security.
  A second layer would sit there.
- **The platform administrator role is read at sign-in,** so a removed role lasts until the session ends
  (12 hours at most in a hosted mode).
- **No limit on the number of sessions** a person may hold, and no "sign out everywhere".
- **A bearer token is not checked for the calling application or a scope.** Any application that can get a
  token for the API's audience, for a person or a service principal that holds a Swarm app role, is
  accepted; requiring assignment is what keeps that set small.
- **`Swarm.Admin` is a standing way to become an owner** of a workspace that has none, so assigning it
  and removing it is part of the setup, not an afterthought.
- **The `Host` header is logged as received,** because the host allow-list refuses on it; a path is logged
  as sent (see [privacy and telemetry](./privacy-telemetry.md)).
- **Five mutating routes have only the general rate limit** (above).
- **The answer headers** are Helmet's defaults with a content security policy of `'self'` (and inline
  styles), a one-year `Strict-Transport-Security` and `Referrer-Policy: no-referrer`; they have not been
  reviewed against the ingress, which may add or replace some.
