# Guest mode (no sign-in)

`PUBLIC_GUEST_MODE=true` lets anyone with the link use the public edition **without signing in**. A visitor presses
"Try it now" and gets a temporary private workspace. Google and GitHub sign-in stay in the code and are offered only when
their client ID and secret are configured, so a site can run with no OAuth app at all. Everything else in
[DESIGN.md](DESIGN.md) holds: a guest goes through the same guard, row-level security, spend gate and kill switch as a person
who signed in. With the setting off the edition is exactly what it was, and a pilot (`SWARM_EDITION` unset) never reads any of it.

## How it works

1. The landing page asks `GET /api/public/session`. `guestMode: true` means a visitor can start as a guest (the owner turned it
   on **and** new visitors are being let in). Nothing is made by a visit alone.
2. "Try it now" calls `POST /auth/guest` with the header `X-Swarm-CSRF: 1`. The server checks, in this order: the header (and
   that the request is not cross-site), that guest mode is on, that new visitors are let in (the same switch as for any new
   account: `PUBLIC_SIGNUPS_ENABLED` and the run-time switch), the optional bot check, and the **throttle by address**.
3. It then makes, in one transaction, a `public_users` row with provider `guest`, a random subject, a synthetic address that is
   never sent to anyone (`guest-<random>@guest.invalid`), a private workspace and the one membership that makes the guest its
   owner. A session of the usual kind is created and set as an opaque cookie (`__Host-` prefix, `Secure`, `HttpOnly`,
   `SameSite=Lax`, no `Domain`, over https). The page asks for the session again and opens the application.
4. A guest is a person like any other to the database: **row-level security is keyed by the workspace**, the server still refuses
   to start without it, and no route can reach another guest's rows (`backend/test/public/guest.test.ts` shows it through the
   API and in the database).

No schema change: guests are `public_users` rows, their last use is `last_login_at`, and the throttle shares `signup_log` (a
record there has an identifier that begins `g_`, a sign-up's begins `s_`, and each is counted only by its own throttle).

## What a guest may do

| Limit                            | Guest (default) | Signed in (unchanged) | Variable                                                    |
| -------------------------------- | --------------- | --------------------- | ----------------------------------------------------------- |
| Tokens a day                     | 80,000          | 60,000                | `FREE_GUEST_DAILY_TOKENS`, `FREE_USER_DAILY_TOKENS`         |
| Model calls a day                | 60              | 40                    | `FREE_GUEST_DAILY_CALLS`, `FREE_USER_DAILY_CALLS`           |
| Tokens for the life of the guest | 240,000         | 300,000               | `FREE_GUEST_LIFETIME_TOKENS`, `FREE_USER_LIFETIME_TOKENS`   |
| Runs at once                     | 2               | 1                     | `FREE_GUEST_CONCURRENT_RUNS`, `FREE_USER_CONCURRENT_RUNS`   |
| Calls at once                    | 4               | 3                     | `FREE_GUEST_CONCURRENT_CALLS`, `FREE_USER_CONCURRENT_CALLS` |
| Size of a "run" (the meter only) | 15,000 tokens   | 15,000 tokens         | `FREE_GUEST_TOKENS_PER_RUN`, `FREE_TOKENS_PER_RUN`          |

The caps that bind everyone together are unchanged and shared: `FREE_GLOBAL_DAILY_TOKENS` and `FREE_GLOBAL_DAILY_COST_USD`
(2,000,000 tokens and US$5 by default; the demonstration deployment sets 5,000,000 and US$15). The ledger is the same atomic
one: a guest's limits replace the four per-person limits in the same conditional `UPDATE`s (`UsageLedger.limitsFor`), so the check
and the reservation are still one statement that concurrent requests cannot pass together. A person's own key (BYOK) works for
a guest as for anyone, lives only in the browser tab and in server memory for the length of a run, and is never counted against
the free tier.

## Abuse

Anyone with the link can use the free tier; that is the point, and what bounds it is:

- **New guests by address**: `PUBLIC_GUESTS_PER_IP_PER_HOUR` (10) for one address, and `PUBLIC_GUESTS_PER_HOUR` (300) in all. An
  address is stored only as a keyed hash that changes every UTC day (never the address), in the table that already throttles
  sign-ups. A refusal is `429 RATE_LIMITED`, counted as `guest-rate-limited` and written once in ten minutes to the audit log.
- **The global daily cap** and the kill switch, as before. A guest cannot be an administrator: the platform-admin flag is
  decided from a verified address, and a guest has none.
- **Rates and quotas**: per account and per address, on every route that costs something (`abuse.ts`), and 10 projects and
  20 MB per workspace, as for anyone.
- **Deleting and starting again** gives a fresh allowance. That is what the address throttle is for, and why the global cap stays.
- **Many people behind one address** share the throttle above and the general request limit of one address
  (`PUBLIC_IP_REQUESTS_PER_MINUTE`, 120 a minute, the page's own files included). A deployment for a room raises both on purpose.
- Turnstile is off by default and, when both keys are set, is asked for on `POST /auth/guest` too.

## Data

A guest's data is deleted **24 hours after it was last used** (`PUBLIC_GUEST_RETENTION_HOURS`): every ten minutes the housekeeping
deletes the guests whose last use is older, with their projects, sessions, membership and usage rows, and writes
`public.guest.purged` with a count. Use is written when a request is authenticated, at most once in five minutes. A guest can
delete its data at any time (`DELETE /api/account`, the page says "Delete my data"); nothing is kept for a guest afterwards,
because there is no one to recognise. Signed-in accounts are never touched by this.

## The owner's key

With no sign-in there is no administrator session, and the budget webhook can only turn the free tier **off**. The owner key
(`PUBLIC_OWNER_KEY_SHA256`, the SHA-256 of a key you keep in a file; sent only in the header `X-Swarm-Owner-Key`, never in an
address) is the way to operate the site:

| Call                          | Does                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `POST /api/ops/free-tier/off` | turns the free tier off (the kill switch)                        |
| `POST /api/ops/free-tier/on`  | turns it on again                                                |
| `POST /api/ops/signups/off`   | stops new guests and new accounts (close)                        |
| `POST /api/ops/signups/on`    | lets them in again                                               |
| `GET /api/ops/usage`          | the usage meter: spend by day, top users, refusals, the switches |

Each is rate limited, compared by hash in constant time, answers 404 when no owner key is configured, and is recorded without the
key. The key is in no log, answer or audit entry (tested).

## Configuration

| Variable                        | Default | Meaning                                             |
| ------------------------------- | ------- | --------------------------------------------------- |
| `PUBLIC_GUEST_MODE`             | `false` | visitors may start with no sign-in                  |
| `PUBLIC_GUESTS_PER_IP_PER_HOUR` | `10`    | new guests one address may make in an hour          |
| `PUBLIC_GUESTS_PER_HOUR`        | `300`   | new guests in all in an hour                        |
| `PUBLIC_GUEST_RETENTION_HOURS`  | `24`    | hours without use before a guest's data is deleted  |
| `PUBLIC_IP_REQUESTS_PER_MINUTE` | `120`   | requests one address may make in a minute (30-1200) |
| `FREE_GUEST_*`                  | above   | the guest allowance                                 |
| `PUBLIC_OWNER_KEY_SHA256`       | unset   | turns the owner's routes on                         |

With guest mode on, `PUBLIC_GOOGLE_*` and `PUBLIC_GITHUB_*` are optional (the server refuses to start with neither only when guest
mode is off). The Bicep template follows ([DEPLOY.md](DEPLOY.md)): the guard that wants a sign-in provider holds when guest mode is on.

## Not covered

Real Google and GitHub sign-in is untested here (as before). Guest mode is open to anyone with the link by design: the daily caps,
the address throttle and the kill switch are what bound it. The terms and privacy texts are still unreviewed stubs.
