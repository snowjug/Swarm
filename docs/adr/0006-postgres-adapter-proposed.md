# 0006. A repository interface and a PostgreSQL implementation for multi-user hosting

Status: **Proposed. Not built.** It needs a decision, and it is the largest piece of work between
the current prototype and a hosted pilot.

## Context

Swarm stores state in one SQLite file through Node's built-in `node:sqlite`. That is the right
choice for a local-first tool: nothing to install, one file to back up, and a synchronous API that
keeps the code simple. It does not suit a hosted service that more than one instance serves.
SQLite allows one writer, and its write-ahead log relies on file locking that network file shares
(including Azure Files over SMB) do not provide reliably.

The storage layer today is `backend/src/storage/repository.ts` plus the ledger and audit stores. Its
methods are **synchronous**, and callers across the routes and the orchestrator depend on that.

## Options

| Option                                                   | For                                                                                                                                           | Against                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Stay on SQLite, one replica, local disk                  | No code change. Enough for one team on one dev machine.                                                                                       | One instance only; a container restart can lose the disk unless a volume is attached.     |
| SQLite on Azure Files                                    | Smallest change.                                                                                                                              | Locking and write-ahead-log behaviour over SMB is unreliable. Not recommended.            |
| **PostgreSQL (Azure Database for PostgreSQL, flexible)** | JSONB fits the existing project documents; transactions for the audit chain; Entra authentication and private networking; row-level security. | An async interface throughout; a second dialect of the migrations; a billed server.       |
| Azure SQL                                                | Mature, Entra authentication.                                                                                                                 | The project documents are JSON, so the fit is poorer than JSONB.                          |
| Cosmos DB                                                | Elastic.                                                                                                                                      | The audit chain, migrations and relational ledger want transactions and joins. Not a fit. |

## Proposed decision

1. Introduce a `Repository` interface and make it **asynchronous**. This is the expensive part:
   every caller of the synchronous repository changes, and the tests that call it directly change
   with them. It should be done as its own change, with the full test suite as the safety net, before
   any PostgreSQL code is written.
2. Keep SQLite as the default for local use and tests. Implement the interface a second time for
   PostgreSQL with the `pg` driver, the same numbered migrations, project documents in `jsonb`, and
   the audit chain written in the same transaction as the change it describes.
3. Every query carries `tenant_id`. Add row-level security as a second layer, so that a missing
   filter in application code does not expose another tenant.
4. Authenticate to the database with Entra (a managed identity) and not a password; reach it over a
   private endpoint.
5. Run the **same** repository test suite against both implementations, so that behaviour cannot
   diverge.

## Consequences

- Until this is done, a hosted deployment is limited to one instance with local storage, which is a
  demo, not a pilot platform.
- The change touches nearly every file that reads a project. Estimate it in weeks, not days.
- A billed PostgreSQL server is **not** provisioned by this repository, and nothing here creates one.
  A cost estimate is in [the cost model](../pitch/cost-model.md).

## What would change this decision

If the pilot is one team sharing one instance, "SQLite, one replica, local disk, scheduled copy of
the file to Blob storage" may be enough, and this record can wait. The question to ask the sponsor is
how many people, in how many tenants, need to use a single hosted instance at the same time.
