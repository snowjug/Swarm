# 0009. PostgreSQL through a synchronous bridge

Status: Accepted. Built, and tested against PostgreSQL running in-process (PGlite) and over the
PostgreSQL wire protocol with the real `pg` driver; the race tests and the measurements of
[docs/production/database.md](../production/database.md) also ran against a PostgreSQL 16.15 server in a
container (the measurements over TLS, with a certificate that was verified). **Not run against a deployed
Azure PostgreSQL server**, so Microsoft Entra authentication, Azure's own TLS settings and behaviour under a
real network are untested.
It carries out the intent of [0006](./0006-postgres-adapter-proposed.md) by a cheaper route, and
changes one of its decisions (the asynchronous interface) for a reason stated below.

## Context

[0006](./0006-postgres-adapter-proposed.md) proposed an asynchronous `Repository` interface and a
second implementation for PostgreSQL, and estimated the first step in weeks because every caller of
the synchronous repository and every test that touches it would change. What a hosted pilot needs
now is a database that more than one instance can use, with transactions that hold when instances
race, and a way to move an existing installation onto it. It does not yet need the throughput that an
asynchronous interface buys.

## Decision

1. **The stores keep their synchronous interface.** `Repository`, `MemberStore`, `SessionStore`,
   `AuditLog` and `LedgerStore` are written against `SqlDatabase` (`prepare().run/get/all`, `exec`,
   `transaction`). `SqliteDatabase` wraps `node:sqlite` and `PostgresDatabase` implements the same
   interface, so no caller changes.
2. **The driver runs in a worker thread.** `pg` is asynchronous. A call is posted to a worker that owns
   the connection, and the calling thread sleeps on a shared flag (`Atomics.wait`) until the answer
   is on the port, then reads it. One connection per process serves all calls, one at a time.
3. **One dialect of SQL, translated at the edge.** Statements are written once, in the SQLite dialect
   with `?` placeholders. `toPostgres` rewrites only what differs (placeholders, `INSERT OR IGNORE`,
   `BEGIN IMMEDIATE`, `IFNULL`, mixed-case aliases) and **refuses** what it cannot translate safely
   (`INSERT OR REPLACE`). Migrations are written out for each dialect at the same version numbers
   (`postgres/schema.ts`): identity columns, plpgsql triggers and `ADD COLUMN IF NOT EXISTS` are not
   translations.
4. **Transactions are `SERIALIZABLE`, and retried.** A transaction that loses a race (SQLSTATE 40001 or
   40P01) is run again, up to six times, with a growing random pause. Every operation given to
   `transaction` therefore reads and writes only the database and is safe to run again. This is what
   keeps "a workspace keeps one owner" and the audit chain true when two instances share a database.
   The audit log reads the last entry and writes the next one inside a transaction of its own unless
   the caller is already in one.
5. **Migrations take an advisory lock** on PostgreSQL, so instances that start together take turns.
6. **The audit log stays append-only in the database itself**: triggers refuse update, delete and
   truncate.
7. **Moving data** is one tool, `npm run db:copy`: SQLite to PostgreSQL to migrate an installation,
   PostgreSQL to a SQLite file for a logical backup, and the reverse to restore. The destination must
   be empty, the copy is one transaction, and it is kept only if row counts match and the audit chain
   verifies. The source is read in one snapshot (`SqlDatabase.readSnapshot`: a SQLite read transaction, or
   a read-only repeatable-read transaction on PostgreSQL), because counts and a chain cannot show a copy
   that mixes two moments. Sign-in state is not copied.
8. **Authentication.** `DATABASE_AUTH=entra` uses a Microsoft Entra access token as the password,
   fetched through `DefaultAzureCredential` (a managed identity when hosted) for each connection.
   No password is then configured anywhere.

## Consequences

- **The process blocks for the length of every query.** One process serves one query at a time, so a
  slow database slows every request, and a call that never returns blocks until the bridge times out
  (30 seconds of statement time, plus five). This suits a pilot of a handful of people; it does not
  suit load. Measured on a busy shared machine, with the database in a container beside it, one process
  opens about 10 projects a second when each round trip takes 2 ms more and about 2 a second when it takes
  20 ms more, because opening one takes 12 round trips ([the numbers and how far to trust
  them](../production/database.md#5-measurements-noisy-shared-vm)). Making the stores asynchronous remains the right follow-up, and `SqlDatabase` is the
  seam where it would start.
- **A dead worker is not noticed until a call times out.** The bridge then marks itself broken and
  every later call fails at once with `STORAGE_UNAVAILABLE`; the readiness probe reports it and the
  container should be restarted.
- **No row-level security yet.** Tenant isolation is still in application code. The tables are
  where a second layer would go.
- **Concurrency across instances was argued and is now measured, for five rules, on a container and not on
  Azure.** The first version of this record said that the tests proved only that a lost race is retried and
  that the SQL runs on PostgreSQL, and that two instances against one server were validated by reasoning.
  `backend/test/concurrency.test.ts` now races four writers on one revision of one document, on creating one
  document, on the last place under the project limit, on twelve queued jobs and on extending the audit
  chain, and asserts every writer's outcome: SQLite with a connection for each writer, and a real PostgreSQL
  16.15 server when `SWARM_TEST_POSTGRES_URL` names one (PGlite has one connection, so its writers take
  turns). It found two defects, both fixed: the project limit was counted outside the transaction that
  inserts, and two writers creating one document at once failed one of them with a raw unique violation on
  PostgreSQL. Not shown: more than four writers, writers for long, the rolling start of two processes that
  both migrate, or anything against a deployed server. The rate limiter and the other in-memory state are
  still per process ([the measurements](../production/database.md#7-concurrency-what-the-race-tests-show)).
- **Whole numbers are BIGINT.** Timestamps stay text, so the stores convert nothing.
- **No soft-delete or retention columns yet,** and no optimistic-concurrency version on a project:
  a project's read-modify-write is one serializable transaction instead.

## Evidence

`backend/test/postgres.test.ts` covers the translation, the retry logic with a transport that can be
made to fail, and the repository on PGlite (migration, reopen, a newer schema refused untouched,
numeric ordering, aliases, rollback, the append-only triggers, a unique violation's SQLSTATE).
`backend/test/postgres-driver.test.ts` runs the repository through the real `pg` driver against a
PGlite server in another process. `backend/test/copy.test.ts` copies both ways and checks equality
of every table, the audit chain and its next entry, refusal of a non-empty destination and of a
tampered source, and rollback of a copy that fails. `backend/test/concurrency.test.ts` races four writers
on five rules (above), and [docs/production/database.md](../production/database.md) has the round trips of
a request, the timeouts and the measurements, each marked as taken on a noisy shared machine and not on
Azure. **`npm run test:postgres` runs the entire unit
suite with every in-memory database made a PostgreSQL one**; it passes in full, and CI runs it as its
own job. Mutation results for these rules are in
[the test guide](../TESTING.md#mutation-checks-on-security-code).
