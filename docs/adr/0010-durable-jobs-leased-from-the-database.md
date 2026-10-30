# 0010. Durable jobs, leased from the database

Status: Accepted. Built, and tested on SQLite and on PostgreSQL running in-process (PGlite). **Not
run with workers in separate containers against a deployed Azure PostgreSQL server.** The hosted
pilot's worker container is described in `docs/azure/`; it is not deployed.

## Context

Until now a run lived in the memory of the process that took the request: a queue of at most three,
one task at a time, and a start-up pass that marked whatever was "running" as failed. A restart
therefore lost every queued run and cut every running one, and a second process could not help. A
hosted pilot needs the opposite: browser refresh, an API restart or a deploy must not destroy a run,
a worker that dies must not leave a run stuck, and two workers must never both do the same stage.

## Decision

1. **The queue is a table.** A `jobs` row is one stage of one project (`quick`, `knowledge`,
   `environment`, `simulation`, `report`). Its state is one of `queued`, `running`, `paused`,
   `cancelling`, `cancelled`, `completed`, `partial`, `retrying`, `failed`, `expired`. The run and its
   job are written in one transaction, so a queued run without a job cannot exist.
2. **A worker takes a job with one atomic update** that sets `running`, an owner and a lease. Two
   workers cannot take the same job; the update is the only way in.
3. **Leases and heartbeats.** The holder renews its lease every quarter of the lease time
   (`JOB_LEASE_SECONDS`, default 30). `reap()` hands a job whose lease ran out to the queue again as
   `retrying`, after a delay that doubles from 15 seconds to 5 minutes and is spread at random so that
   retries do not arrive together. Attempts are bounded (three; one for the unstructured quick run). A
   job that has used them all is `failed` with `JOB_POISONED` and is not tried again.
4. **A worker that lost its lease cannot write.** Everything a job does to the repository runs inside
   an `AsyncLocalStorage` context that names the job and its owner. `Repository.update` and
   `Repository.addEvent` check, inside their own transaction, that this owner still holds the lease,
   and throw `LEASE_LOST` if not; the worker then stops and records nothing. This is what keeps a
   stalled worker that wakes up from writing a stale round over its successor's. It covers the
   project's state, events and usage. It does **not** cover ledger writes made by the stage itself: a
   stale worker can finish the ledger call it is in, and stops at its next write or heartbeat.
5. **Resuming.** A simulation that is run again (after a crash, a lease expiry, a hand-back at
   shutdown or a retry) continues from its last saved, consistent round instead of computing the
   rounds again; the other stages run again from the start, as they do after a manual retry.
6. **Idempotency.** A job has a key, unique within its project. A request with an `Idempotency-Key`
   header that the project has already seen returns the project and queues nothing; without a header
   the key is the job's own id.
7. **Stopping a run from another process.** Cancel and pause write a flag on the job; the worker
   reads it with its heartbeat and stops. A job that had not started is cancelled or paused at once.
   A cancelling job whose worker died is finished as cancelled by the reaper.
8. **Graceful shutdown hands the job back.** A stopping backend aborts the run, marks the project
   `queued` and returns the job to the queue **without charging the attempt**, so that a deploy does
   not use up a job's retries. Jobs that were waiting stay in the table.
9. **Failures.** A provider failure that may pass (`MODEL_UNREACHABLE`, `MODEL_TIMEOUT`,
   `MODEL_RATE_LIMIT`) is retried by the queue only for a simulation that has saved rounds, from the
   saved round. Every other failure is final and visible, as before. A simulation that fails with
   saved rounds ends as `partial`: some work is kept and it can be resumed.
10. **Roles.** `SWARM_ROLE` is `all` (serve and run, the default), `api` (serve and queue only) or
    `worker` (run, and answer health probes). Any number of each may share one PostgreSQL database;
    the SQLite file is for one process.
11. **Upkeep.** Every process that runs jobs, every two seconds, reaps lapsed leases, expires jobs that
    waited longer than two hours (so that old requests are not started late), and takes work that is due.
12. **Start-up.** A project that has a live job is not marked failed by a restart. A project that is
    `queued` or `running` and has no job (a database from before this change) is, as before.

## Consequences

- **A restart that is quicker than the lease waits for it.** A process killed outright leaves its
  job `running` until the lease runs out (up to 30 seconds), then the retry delay (7.5 to 15 seconds
  for the first retry) applies. A graceful stop does not wait.
- **`QUEUE_FULL` is global**: three jobs may wait for any worker. That is a pilot limit, not a
  fairness policy; per-project and per-tenant quotas are still to do.
- **The heartbeat is a timer in the worker's event loop.** A loop blocked longer than the lease (the
  PostgreSQL bridge blocks it for the length of a query) can lose its lease; the fence then stops the
  worker, and the job is run again from its last saved round.
- **Ledger writes are not fenced** (see 4). Fencing every write needs a lease check in the ledger
  store as well.
- **Nothing here has run across containers.** The tests model a second worker as a second
  `Orchestrator` over one repository, with the clock set by hand. Two real processes racing for one
  PostgreSQL row, and the pilot's worker revision, remain to be shown on a deployed server.

## Evidence

`backend/test/jobs.test.ts` (the queue and the fence), `backend/test/durable-jobs.test.ts` (stalled
worker, crash, poison, expiry, graceful stop, cross-process cancel and pause, retry, idempotency,
branch lineage), each run on SQLite and on PostgreSQL, and 19 mutations of the rules above
(`npm run mutation:security -- --area=jobs`), each of which a test catches.
