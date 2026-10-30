# 0005. Entra bearer tokens verified in the API, four roles, a default-deny route table, tenant scoping

Status: Accepted (backend). The browser has no sign-in yet, and no real tenant has been used. Its
role model (decision 3) and owner rule (decision 6) are superseded by
[0007](./0007-workspace-and-project-membership.md); the rest stands.

## Context

The baseline API was single-user: no principal, role or per-object authorisation, bound to loopback.
Hosting for more than one person needs to know who is calling, what they may do, and whose data a
request may touch, without trusting the browser.

## Decision

1. **Modes.** `AUTH_MODE=none` (default) keeps the local behaviour exactly: one local administrator in
   a `local` tenant. `AUTH_MODE=entra` requires a Microsoft Entra bearer token on every `/api`
   request except `GET /api/health`. A misconfigured entra mode fails closed at start-up.
2. **Verification** (`backend/src/auth/tokens.ts`, using the `jose` library): signature against the
   tenant's published keys, RS256 only, audience, expiry and not-before, and a tenant that is on the
   configured allow-list. The expected issuer is derived from the token's own tenant id **after** the
   allow-list has accepted it, so a token cannot choose its own issuer. Every failure returns the
   same 401 body; a key-service outage returns 503, never a pass.
3. **Roles** come from Entra app roles on the token: `Swarm.Reader`, `Swarm.Analyst`,
   `Swarm.Reviewer`, `Swarm.Admin`, ordered so that "at least analyst" is one comparison. A token
   with none of them can call nothing but health.
4. **Default deny.** `backend/src/auth/policy.ts` is a table keyed by route (`GET /api/projects/:id`).
   A route that is not in the table is refused, and a test enumerates every route the server
   registered and fails if one is missing, so adding an endpoint without deciding who may call it is
   a build failure.
5. **Authentication happens before the body is read** (an `onRequest` hook), so an unauthenticated
   caller cannot make the server parse a large payload.
6. **Tenant and owner scoping.** Projects carry `tenant_id` and `owner_id`. Lists, counts and every
   by-id lookup are filtered by the caller's tenant; a project in another tenant returns the same
   404 as one that does not exist. Mutations need the owner or an administrator. Branches belong to
   whoever branched. Health shows no counts in entra mode. The guard vouches only for the project
   named by `:id` in the path. A handler that is given another project's identifier elsewhere must
   call `ownerInTenant` on it. Only one does today: `GET /api/projects/:id/compare?with=`. It did
   not at first, and an independent code review, run after these documents were written, found that
   a reader could read another tenant's run through it. That was fixed, with a test, and is the
   reason this paragraph exists: the review of routes the author did by hand had looked at the
   path parameter and not at the query. A tripwire test now lists every UUID field the routes
   accept, so a new one fails the build until someone has looked at it; it cannot tell whether the
   handler checked it.
7. The model call itself still uses Entra (the user's or a managed identity) and never a key; that is
   unchanged and separate from who may call the API.

## Consequences

- Not built: a **browser sign-in** (MSAL.js and a token acquisition flow in the SPA), so a person
  cannot use hosted mode from the console yet; only API clients that already hold a token can.
- Not validated: **a real Entra tenant**. Verification was tested against a local test identity
  provider that signs tokens with a key pair; that exercises the code paths, not Entra's actual claims
  (group overage, multiple audiences, certificate rollover timing). It needs an app registration and
  app roles, which only a tenant administrator can create.
- Roles are coarse. There are no per-project shares, groups or workspaces: a project has one owner.
- Tenant filtering is in application code. With PostgreSQL ([0006](./0006-postgres-adapter-proposed.md))
  row-level security would add a second layer.
- The decision for a pilot is whether to require sign-in at the edge (Container Apps built-in
  authentication) **in addition**, so that the API is never reachable unauthenticated at all.

## Evidence

`backend/test/auth.test.ts`: 42 tests against a local test provider. One table refuses sixteen kinds
of bad token with an identical 401 (no token, oversized, expired, wrong audience, wrong issuer,
another tenant's issuer, a tenant not on the allow-list, missing object id or issued-at, signed by
another key, tampered claims, an HS256 algorithm-confusion token, and an unsigned `alg: none`
token). Others cover role ordering, a key-service outage returning 503, tokens never reaching the
logs, cross-tenant access returning the same 404 as a missing project (including a comparison
that names the other tenant's run in its query), the route-table coverage test, and an upgrade of
an old database. Four mutations (remove the tenant check, remove the ownership check, remove
default deny, move authentication after body parsing) were each caught by a failing test.
