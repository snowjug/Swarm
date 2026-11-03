# The database: how a request is served, what it costs, and what is known

How the stores reach SQLite and PostgreSQL, where one query stops the whole process, what has been
measured and how far to trust it, what a migration and a restore do, and what the application's database
role may do. It describes the storage layer as built.

**Every number below is marked "noisy, shared VM": it was taken on a four-CPU virtual machine that other
work was using (load average 10 to 13 throughout), against a PostgreSQL 16.15 container on the same
machine. Nothing was taken against Azure Database for PostgreSQL, over a real network, or with a
Microsoft Entra token.** The numbers show where the ceiling is and what moves it. They are not a
capacity guarantee, and the integrator has to take them again on a quiet machine and on the real server
([section 12](#12-running-it-again)).

Read with [ADR 0009](../adr/0009-postgres-through-a-synchronous-bridge.md) (why the stores are
synchronous), [ADR 0003](../adr/0003-schema-migrations-and-audit-log.md) (migrations, the audit log),
[the runbook](../operations/runbook.md) and [the pilot plan](../azure/pilot-plan.md).

## 1. What to know first

| Question                                    | Answer                                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How many queries does a process run at once | One. On PostgreSQL the thread that serves requests sleeps until each answer arrives, so nothing else in the process runs meanwhile: no other request, no timer, no health probe                                     |
| What does a request cost                    | Round trips: 2 for any signed-in request (session, workspace role), 4 to list projects, **12 to open one**, 28 to create one and delete it again                                                                    |
| Ceiling of one process                      | About 1000 / (round trips × milliseconds per round trip) requests a second. Opening a project: about 10 a second with the database 2 ms away and about 2 a second with it 20 ms away (noisy, shared VM; section 6)  |
| Timeouts                                    | The server cancels a statement after 30 s (fixed). The calling thread gives up after 35 s and the process is then marked broken for good. Nothing a person does cancels a running statement                         |
| More than one replica                       | Four connections raced against one PostgreSQL server keep every rule that was tried (section 7). Rate limits and the other in-memory state stay per process. The template keeps `maxReplicas` at 1                  |
| Two defects the race tests found            | The project limit was checked outside the transaction that inserts (fixed). Two writers creating one document at once failed one of them with a raw unique violation on PostgreSQL (fixed). Both are in section 7   |
| The application's role                      | Owns its database, is not a superuser, cannot create roles or databases. Because it owns the tables it can also switch off the audit triggers; the hash chain then shows the edit but nothing stops it (section 10) |
| Health                                      | `/api/health/live` does not touch the database; `/api/health/ready` runs `SELECT 1` through the same single connection                                                                                              |

## 2. How a request is served

A request is handled on one thread. The stores (`Repository`, `MemberStore`, `SessionStore`, `AuditLog`,
the ledger and the rest) are synchronous: they call `prepare().run/get/all`, `exec` and `transaction` on a
`SqlDatabase`, and a handler runs all of its statements one after another.

- **SQLite** (`node:sqlite`) runs the statement on the calling thread: write-ahead log, `busy_timeout` of
  5 s, `BEGIN IMMEDIATE` so that writers take turns. A trivial statement took a few microseconds; a write
  waits for the disk at commit (about 30 ms for a create and a delete here).
- **PostgreSQL** is reached through `SyncBridge` (`backend/src/storage/postgres/bridge.ts`). A worker
  thread owns one `pg.Client`. The calling thread posts the statement to it and sleeps on a shared flag
  (`Atomics.wait`) until the answer is ready, then reads it. That is **one connection per process and one
  statement at a time**, and while a statement is on its way to the server and back the process does
  nothing else.
- **PGlite** is PostgreSQL built to run inside the process, behind the same bridge. It is for tests
  (`npm run test:postgres` runs the whole unit suite on it); it has one connection per process, so it can
  show what a rule produces but not how writers interleave.

What follows, each part measured in section 5:

1. A request that makes N statements holds the process for N round trips, however many people wait. The
   ceiling is 1 / (N × time per statement) and does not grow with CPU or with more clients; they only
   make the queue longer.
2. A distant or slow database lowers the ceiling in proportion. The job worker shares the process
   (`SWARM_ROLE=all`) and so shares the connection and the stalls.
3. A health probe waits behind the requests in flight, because answering it needs the same thread.
4. A transaction is held across its statements: the create of a project is one transaction of about a
   dozen round trips, and the process does nothing else for its whole length.

## 3. Where a query stops the process: timeouts and cancellation

| Case                                     | What is in place                                                                                                                                                                                                                                           | Longest the process is stopped  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| A slow statement                         | The server cancels it after `statement_timeout`, 30 s, set on the connection. Not configurable by the environment: `Repository` does not pass an option, the default is in the adapter                                                                     | 30 s                            |
| A server that stops answering            | The calling thread waits at most the statement timeout plus 5 s. After that the bridge is marked broken for good: every later call fails at once with `STORAGE_UNAVAILABLE` (503), `/api/health/live` answers 503, and the platform restarts the container | 35 s, then a restart            |
| The first connection                     | Worker start, connect, TLS and authentication together get 60 s                                                                                                                                                                                            | 60 s                            |
| A lost race (`40001`, `40P01`)           | The whole transaction runs again, up to six times, after a random pause of up to 40 ms the first time and doubling each time (`sleepSync`, which also stops the process); then the failure is reported                                                     | about 1.2 s of sleeping at most |
| A connection that was dropped while idle | The next plain statement outside a transaction reconnects once and runs again. Inside a transaction it is a failure                                                                                                                                        | one reconnect                   |
| SQLite lock contention                   | `busy_timeout` 5 s on the calling thread                                                                                                                                                                                                                   | 5 s                             |

Not in place: a configurable statement timeout, `lock_timeout`, `idle_in_transaction_session_timeout`, a
connect timeout or TCP keep-alive on the driver, and **cancellation**. Closing a browser tab, a client
timeout, or `POST /api/projects/:id/cancel` (which cancels a run) does not interrupt a
statement, and nothing in the process could ask the server to: the only thread that could is the one that
is waiting. The server's own timeout is the cancel.

Nothing was added here. A configurable timeout touches `config.ts` and is a decision for whoever runs the
database; cancellation would need a watchdog thread and a second connection, which is the design change
that the asynchronous stores of [ADR 0009](../adr/0009-postgres-through-a-synchronous-bridge.md) would
bring anyway. This is the limit; section 13 lists what would raise it.

## 4. What a request costs: round trips

Counted by wrapping the bridge while one signed-in request is served (`scripts/db/measure.ts`). The count
is exact, not a measurement of time.

| Request                             | Round trips | Where they go                                                                                                                                                                                                                                                                |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any signed-in request               | 2           | The session row, the role in the workspace                                                                                                                                                                                                                                   |
| `GET /api/projects?limit=20`        | 4           | The two above, the page of projects, the count                                                                                                                                                                                                                               |
| `GET /api/projects/:id`             | 12          | The two above; the project's tenant and owner; the caller's project role; the project; its events; **four lists of artifact keys and two artifact reads**                                                                                                                    |
| `POST /api/projects`, then `DELETE` | 28 (both)   | Create: the guard, `BEGIN`, the count for the limit, five inserts, the audit read and insert, `COMMIT`, then the project and its events read back. Delete: the guard, access checks, the project, its events, running jobs, the delete in a transaction with its audit entry |

Two of the twelve to open a project are the guard, which every request pays, and six are artifact reads
that could be one query. These are where the ceiling can be raised without changing the design (section 13).

## 5. Measurements (noisy, shared VM)

**What was run.** `scripts/db/measure.ts` drives the whole application (guard, routes, stores) with
`inject`, signed in with a session cookie as a person in a hosted deployment is, on SQLite, on PGlite and on
PostgreSQL. It counts round trips, times each request, watches the event loop and a health probe, and can
put a delay on every round trip through a proxy that runs as a process of its own. Four seconds a phase,
one run each, a small project (one short document), 20 projects to read from. The existing
`scripts/load-test.mjs` was run against a built server on SQLite, on PGlite behind the PostgreSQL wire
protocol and on PostgreSQL, reduced to 200 reads, 8 creates and 3 workflows.

**Where.** Linux x64, 4 vCPUs shared with other engineers' builds and test runs (load average 10 to 13
the whole time), Node 24.22.2. PostgreSQL 16.15 in Docker on the same machine, published on 127.0.0.1
through Docker's userland proxy, TLS 1.3 with a self-signed certificate that was verified, the application
connecting as a role that is not a superuser. The runs were at `nice -n 10`, so they got less of the CPU
than what else was running: read these as a floor. An added delay is a TCP proxy: it has no loss or
jitter, and it is not a real network.

**One process, requests going through the whole application** (noisy, shared VM). "Opens" are
`GET /api/projects/:id`; "lists" are `GET /api/projects?limit=20`; a "pair" is a create and a delete.

| Database                      | Added round trip | Opens a second, one at a time (median ms) | Opens a second, 16 in flight (median / 95th ms) | Lists a second, 16 in flight | Pairs a second, 4 in flight | One trivial query: fastest / median ms | Slowest health probe, 16 in flight |
| ----------------------------- | ---------------- | ----------------------------------------- | ----------------------------------------------- | ---------------------------- | --------------------------- | -------------------------------------- | ---------------------------------- |
| SQLite file                   | none             | 208 (1.1)                                 | 454 (0.8 / 7)                                   | 136                          | 35                          | 0.002 / 0.006                          | 0.2 s                              |
| PGlite in the process         | none             | 35 (18)                                   | 42 (20 / 195)                                   | 89                           | 21                          | 0.36 / 0.52                            | 0.7 s                              |
| PostgreSQL 16.15, Docker, TLS | none             | 28 (12)                                   | 36 (12 / 499)                                   | 56                           | 20                          | 0.29 / 0.41                            | 1.1 s                              |
| PostgreSQL 16.15, Docker, TLS | 2 ms             | 10.8 (53)                                 | 8.9 (129 / 2 148)                               | 38                           | 7.8                         | 1.6 / 3.1                              | 3.9 s                              |
| PostgreSQL 16.15, Docker, TLS | 20 ms            | 1.9 (497)                                 | 2.2 (607 / 7 267)                               | 6.9                          | 0.7                         | 21.3 / 34.6                            | 14 s                               |

On PostgreSQL and PGlite the process spent 76 to 99 % of every run waiting for the database (the share
rises with the added delay), and made exactly 12, 4 and 28 round trips per open, list and pair in every
run. The slowest probe is a `/api/health/live` request timed from when it fell due, so it includes the
wait behind the 16 requests in flight and, at the start of each phase, the burst of 16 arriving together.

**The existing load tool over HTTP, 64 at a time** (noisy, shared VM; `--reads 200 --creates 8
--workflows 3`; local mode, so `/api/health` here makes three database calls and is not the probe route):

| Database                      | `GET /api/health` median / 95th ms | `GET /api/projects?limit=100` median / 95th ms | 8 creates, median ms | 3 guided workflows, wall | Eight people save one section | 5xx | Peak memory |
| ----------------------------- | ---------------------------------- | ---------------------------------------------- | -------------------- | ------------------------ | ----------------------------- | --- | ----------- |
| SQLite file                   | 137 / 421                          | 174 / 372                                      | 118                  | 14 s                     | 1 accepted, 7 told it changed | 0   | 271 MB      |
| PGlite behind the wire        | 940 / 2 275                        | 1 010 / 1 407                                  | 447                  | 27 s                     | 1 accepted, 7 told it changed | 0   | 390 MB      |
| PostgreSQL 16.15, Docker, TLS | 599 / 7 548                        | 1 157 / 3 203                                  | 613                  | 73 s                     | 1 accepted, 7 told it changed | 0   | 373 MB      |

**What the numbers say.**

- The slowdown from SQLite to PostgreSQL is mostly the round trips: the same application code made 12
  round trips instead of none, and each cost what a trip to the server costs on a busy machine (a trivial
  query took 0.3 ms at best and 0.4 ms in the middle; the queries of a real request took about 3 ms each,
  because they carry rows and the machine was loaded).
- The ceiling follows the formula. From no added delay to 2 ms the opens fell from 28 to 11 a second, and
  from 2 ms to 20 ms from 11 to 2. The measured values are lower than the formula gives for a quiet
  machine (about half at 20 ms: 2 a second against 4), which is the scheduling noise of the shared VM in
  the proxy and the driver thread, and why the formula is a bound and the measurement a floor.
- Adding clients does not add throughput: 16 in flight gave about the same opens a second as one (36 and
  28, 9 and 11, 2.2 and 1.9) and moved the 95th percentile of an open from 0.14 s to 0.5 s with no added
  delay, to 2.1 s at 2 ms and to 7.3 s at 20 ms.
- A saturated process answers its health probe late. At 20 ms and 16 in flight the slowest probe took 14 s,
  past the 5 s timeout in the pilot template; three failures in a row are needed to restart, so a busy
  process is a risk rather than a certainty, and it is a reason to watch the probe's latency.
- The load tool's correctness checks held on every engine: every workflow finished, eight people saving
  the same section at once gave exactly one winner and seven who were told it changed, and there were
  no server errors.

## 6. The documented load ceiling

Per process, with one replica:

> **requests a second ≈ 1000 / (N × (round trip + the server's time) + the application's own time)**,
> with N the round trips the request makes and every time in milliseconds

The application's own time is about 1 to 2 ms for a read (SQLite, which has no round trips, served an open
in a median 1.1 ms). The server's time for a trivial query is about 0.3 ms (the fastest seen). The round
trip is the variable that matters.

| The database is | Opens a project, formula (N = 12) | Lists projects, formula (N = 4) | Measured here, noisy, shared VM (opens / lists a second) |
| --------------- | --------------------------------- | ------------------------------- | -------------------------------------------------------- |
| on the machine  | about 200 a second                | about 350 a second              | 28 to 36 / 56                                            |
| 2 ms away       | about 35 a second                 | about 90 a second               | 9 to 11 / 38                                             |
| 20 ms away      | about 4 a second                  | about 12 a second               | 2 / 7                                                    |

The two middle columns are the formula for a quiet machine and **were not measured**; the right-hand column
is what the busy machine gave. **Take the right-hand column as the documented ceiling for one replica until
it has been measured again on a quiet machine and on the real server: about 10 project opens a second at
2 ms, about 2 at 20 ms.**

In people, which is arithmetic and not a measurement: the page reads the project again every 2 s while a
comparison runs and every 5 s while one could be started (`LAB_POLL_MS` in
`frontend/src/hooks/useLabRefresh.ts`), so each person watching a run costs about 0.5 opens a second. Ten
opens a second is about twenty people watching runs at once at a 2 ms round trip, and about four at 20 ms,
before anyone does anything else. A pilot of a handful of people is well inside this. A hundred is not.

What moves the ceiling, in order of effect: the round trip (the database in the same region as the app,
and nothing between them that adds time); the round trips each request makes (section 13); more replicas,
if the database is shared safely (section 7), remembering that each replica rate-limits on its own;
asynchronous stores with a pool, which is the real fix and is a design change.

## 7. Concurrency: what the race tests show

`backend/test/concurrency.test.ts` races four writers on the same thing, and asserts every writer's outcome
(not only that one won). SQLite is raced for real: each writer is a thread with its own connection to one
file. PGlite has one connection per process, so its writers take turns. A real PostgreSQL server is raced
the same way as SQLite when `SWARM_TEST_POSTGRES_URL` names an empty database
(`node scripts/db/with-postgres.mjs -- npx vitest run backend/test/concurrency.test.ts` starts one).

| Four writers at once                                                                        | SQLite                        | PGlite (in turn) | PostgreSQL 16.15, four connections |
| ------------------------------------------------------------------------------------------- | ----------------------------- | ---------------- | ---------------------------------- |
| Edit one document from the same revision: one wins, three get `ARTIFACT_CONFLICT`           | pass                          | pass             | pass                               |
| Create one document that none has yet, five rounds: one wins, three get `ARTIFACT_CONFLICT` | pass                          | pass             | pass, **after the fix below**      |
| Take the last place under the project limit: one wins, three get `PROJECT_LIMIT`            | pass, **after the fix below** | pass             | pass                               |
| Take 12 queued jobs: each taken once, one lease, first attempt                              | pass                          | pass             | pass                               |
| Extend the audit chain, six entries each: one chain, every entry once                       | pass                          | pass             | pass                               |

The race on the audit chain was checked to be able to fail: with the transaction taken out of
`AuditLog.record`, the SQLite race forks the chain at the seventh entry and the test says so.

**Defect 1: the project limit.** `Repository.create` and `importSnapshot` counted a tenant's projects
before they opened the transaction that inserts. On SQLite four writers released together all created what
each had counted as the 100th project, and the tenant ended at 102 of 100 (a rival connection that
committed between the count and the insert left it at 101). The count is now taken inside the
transaction (`requireRoom`), where SQLite's write lock and PostgreSQL's serializable isolation make it
hold. The limit is a soft quota per tenant and not a security boundary.

**Defect 2: the first write of a document.** `ArtifactStore.put` read that the document was absent and
then inserted it. On PostgreSQL the losers were told `duplicate key value violates unique constraint
"project_artifacts_pkey"` instead of `ARTIFACT_CONFLICT`, which reaches a person as a 500 and which no
caller can act on (both runs of the race failed). The insert is now `ON CONFLICT DO NOTHING`: under
serializable isolation PostgreSQL reports a conflict with a row the transaction could not see as a
serialization failure, which the adapter already retries, and the retry reads the new row and answers
`ARTIFACT_CONFLICT`. The adapter's rule that a unique violation is not retried is unchanged.

Not shown: more than four writers, writers for long, or the rolling start of two processes that both
migrate (the advisory lock is unit tested; nothing raced it). In-memory state is per process, and so is
the rate limiter (`@fastify/rate-limit` with its default store): with several replicas a client's limit
is the limit times the replicas. [ADR 0009](../adr/0009-postgres-through-a-synchronous-bridge.md) says
concurrency across instances was "argued, not measured"; it is now measured for these five rules, on a
container and not on Azure.

## 8. Migrations: order, rollback and forward fix

How they run (`backend/src/storage/migrations.ts`, `postgres/schema.ts`):

- Numbered versions, the same numbers in both dialects (nine today), each applied in a transaction of its
  own that also writes the new version, so a step is whole or not there.
- A failed step is rolled back and the process stops with `STORAGE_MIGRATION`; the database is unchanged.
- A database newer than the build is refused untouched (`STORAGE_VERSION`).
- On PostgreSQL a session advisory lock (`727001`) makes instances that start together take turns; the
  second finds nothing left to do. On SQLite the file is copied to `<file>.v<N>.bak` first.
- The migration runs when the process starts, as the role the application connects as.

Rules for a new migration:

1. **Additive.** New tables, new nullable or defaulted columns, new indexes. The old build keeps running
   on the new schema for as long as a rolling deployment overlaps them, so it must not break on one.
2. **Both dialects, the same version number,** and run on both (`npm run test:postgres` runs the whole unit
   suite on PostgreSQL code).
3. **Never rename or drop in the release that stops using the thing.** Release one stops reading it; a
   later release drops it, once nothing that could run still reads it.
4. A change that rewrites a big table or builds an index locks writers for as long as it takes. None of
   today's tables is big; check before adding one that is.

**Rollback or forward fix.** Rolling the image back does not undo a migration, and an older build refuses a
newer database, so the platform keeps restarting it and the rollback silently does not happen
(`STORAGE_VERSION` in the console log). **The strategy is to fix forward**: ship a corrected build on the
new schema. Going back to an old build means restoring the database from before the migration (a
point-in-time restore to a new server and `DATABASE_URL` repointed, or the `.bak` file on SQLite) and
losing what was written since. So before a release that carries a migration: note the time or take a
logical copy (`npm run db:copy`), do it at a quiet hour, and run the smoke check straight after. The steps
are in [the runbook](../operations/runbook.md#roll-back).

## 9. Backups, point-in-time restore and retention

- **The pilot's server** (Azure Database for PostgreSQL flexible server, version 16, Burstable B1ms, 32 GiB
  in the template) keeps automated backups and its transaction log, so it can be restored to any point
  within `backupRetentionDays` (7 by default, 7 to 35). A restore always creates a **new** server: add
  the application's identity as its Entra administrator and point `DATABASE_URL` at it. The parameters
  are in `infra/pilot`, and the production [runbook](./runbook.md#restore-the-database-to-a-new-server)
  and [release process](./release-process.md) have the procedure;
  [the pilot plan](../azure/pilot-plan.md#backup-restore-and-rollback) and
  [the runbook](../operations/runbook.md#restore-the-database) have the commands.
- **No restore of a hosted server has been rehearsed.** Do one before it is needed, and record how long it
  took and what was lost. `npm run db:drill -- --from postgres://...` rehearses the logical path (a
  backup into a SQLite file, a new database made from that file alone, and a check of every table, the
  audit chain and every project) and says nothing about a point-in-time restore.
- **Retention in the application.** Nothing expires a project or a document on its own. Sessions are purged
  on a timer and a queued job expires after two hours; neither is a retention policy for the data.
  Deleting a project removes it from the live database at once; **it stays in the backups until they age
  out**, up to the retention window. The audit log is never deleted and holds identifiers and counts, not
  content, so it outlives the projects it describes.
- A logical copy, for moving an installation or taking a backup that does not depend on the platform:
  `npm run db:copy`, in either direction, into an empty destination, checked before it is kept.

## 10. The database role

What was run: a role created with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` that **owns** an empty
database. The application connected as it over TLS 1.3 (verified), migrated the schema, and ran every
test and measurement above. Checked on PostgreSQL 16.15 with the tool that starts the server:

| As that role                                                     | Result                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Superuser, create role, create database, replication, bypass RLS | None of them                                                        |
| `CREATE ROLE`, `CREATE DATABASE`, `pg_read_file`                 | Refused                                                             |
| Tables in `public`                                               | 17, all owned by the role                                           |
| `UPDATE`, `DELETE`, `TRUNCATE` on `audit_events`                 | Refused by the append-only triggers: "audit events are append-only" |
| `ALTER TABLE audit_events DISABLE TRIGGER USER`, then `UPDATE`   | **Allowed**                                                         |
| `AuditLog.verify()` after that edit                              | `ok: false, brokenAt: 1`: the chain shows it                        |

So the role needs to be the owner of the database, because the application creates and migrates its
tables with it at start, and nothing cluster-wide. **The triggers stop a bug or an injected statement, not
the role that owns the table:** what protects the audit log from that role is the hash chain, which
detects an edit, and a copy of the log kept elsewhere, which is what makes the edit provable. In the pilot
template the application's identity is the server's Microsoft Entra **administrator** (`azure_pg_admin`),
which is a broader role than the one tested here: on Azure it manages roles and databases (**UNVERIFIED**:
not tried against a server).

The stricter design is two identities: one that migrates, as a release step, and one that only reads and
writes, with `INSERT` and `SELECT` alone on `audit_events`. The application cannot run that way today,
because it migrates at start (section 13).

## 11. Health checks

| Probe               | Touches the database                  | Fails when                                                                          | In the pilot template                                                                      |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/api/health/live`  | No                                    | The bridge is broken for good (503): the connection was lost and a restart cures it | Liveness every 30 s, 3 failures, 5 s timeout; startup 15 s delay, 10 s period, 10 failures |
| `/api/health/ready` | Yes: `SELECT 1` on the one connection | The database does not answer (503 `not-ready`, with `checks.database`)              | Readiness every 15 s, 3 failures, 5 s timeout: traffic stops, nothing restarts             |

A database that is merely down makes the instance not ready and does not restart it. Both routes are
served by the thread that the database stops, so a saturated process answers them late (section 5), and
the readiness probe queues behind the requests in flight like any other query.

## 12. Running it again

```
# the race tests on a real server (Docker; the container, its data and its certificate are removed after)
node scripts/db/with-postgres.mjs -- npx vitest run backend/test/concurrency.test.ts

# the measurement: SQLite, PGlite, and PostgreSQL at 0, 2 and 20 ms added to every round trip
npx tsx scripts/db/measure.ts --engine sqlite
npx tsx scripts/db/measure.ts --engine pglite
node scripts/db/with-postgres.mjs -- npx tsx scripts/db/measure.ts --engine postgres --rtt 0,2,20

# the existing load tool against a built server (npm run build:backend first)
node scripts/load-test.mjs --reads 200 --creates 8 --workflows 3
```

`scripts/db/with-postgres.mjs` starts a PostgreSQL 16 container that listens on 127.0.0.1 only, on a port
Docker picks, with TLS on (a certificate made inside the container) and an empty database owned by a
role that is not a superuser. The command it runs is given `SWARM_TEST_POSTGRES_URL`, a `PGPASSWORD` made
up for that run (in no file, no argument list and no output) and `NODE_EXTRA_CA_CERTS` for the
certificate. To point the load tool at a database, give the server `DATABASE_URL`. To measure the real
server, run `scripts/db/measure.ts --engine postgres --url postgres://...` with `PGPASSWORD` set, from a
machine placed as the application is; the address is never printed.

What the integrator should repeat: all of section 5 on a quiet machine; the PostgreSQL run against the
pilot's server from the application's own environment, which adds what this could not (Azure's round
trip, Entra tokens, `sslmode=require` against a real certificate); and the restore rehearsal of section 9.

## 13. What would raise the ceiling, and what has not been done

Not done, in the order they would pay:

1. **Fewer round trips for a read.** Fold the session and workspace-role lookups into one query (2 trips on
   every request), and list a project's artifacts in one query (6 of the 12 to open one). Opening a project
   would cost about 6 trips instead of 12 and the ceiling would roughly double. This changes the stores,
   and has not been done.
2. **Asynchronous stores with a pool of connections** (the follow-up in ADR 0009). It removes the blocking
   itself, and with it the probe delay and the single-statement ceiling. It is the design change.
3. **Timeouts the operator can set:** `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`
   from the environment, and a connect timeout and keep-alive on the driver.
4. **Two database identities** (section 10), and migrations run as a release step.
5. **A request limit of its own** on the routes that carry the most (see the exemptions in
   [the identity review](./identity.md)), since the ceiling is shared by everyone.
6. Reviewing the query plans (`EXPLAIN`) on a database with real rows. The tables here were small.
