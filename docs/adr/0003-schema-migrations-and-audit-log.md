# 0003. Versioned migrations with a backup, and an append-only hash-chained audit log

Status: Accepted

## Context

The baseline stored each project as one JSON document in a `projects` table with a bare
`user_version = 1`, so there was no way to evolve the schema without risking a user's data. It also
had no record of who changed what, and a per-project event log that a project deletion removed.

## Decision

1. **Migrations** (`backend/src/storage/migrations.ts`) are numbered, run one transactional step at a
   time, and are idempotent. Version 1 is the schema as shipped. Version 2 adds the claim ledger,
   source conflicts, ledger state and the audit table. Version 3 adds `tenant_id` and `owner_id` to
   projects, guarded by `PRAGMA table_info`, defaulting to `local` and `local-user`.
2. Before an **existing** database file is upgraded it is copied; a failed step rolls back; a
   database newer than the running build is refused untouched.
3. The **audit log** is append-only. Triggers refuse `UPDATE` and `DELETE`. Each entry stores the
   hash of the previous entry and its own SHA-256 over the previous hash and its content, so removing
   or altering an entry breaks `verify()`. Entries are written inside the transaction of the change
   they describe, so the two commit together or not at all.
4. Audit rows hold **identifiers, counts and short labels only**: never source text, model output or
   a credential. Detail values are sanitised to bounded keys and scalar strings. For that reason
   they are not deleted with a project; they can still prove what happened after the content is
   gone.
5. An administrator can call `GET /api/audit/verify`; a reviewer can read one project's audit trail.

## Consequences

- The chain detects a silent edit. It does **not** stop someone with write access to the database
  file from rebuilding the whole chain, because nothing outside the database anchors it. Anchoring
  the head hash in an external immutable store (for example Azure Blob immutable storage) is a
  production step and is not built.
- The `actor` of an entry is a principal id (an Entra object id in hosted mode), which is personal
  data. Keeping audit rows after a project is deleted is a deliberate choice for accountability,
  and it needs a **retention decision** from privacy and legal reviewers before any pilot with real
  users. None exists yet.
- A backup copy is a file next to the database. It is a safety net for an upgrade, not a backup
  strategy.
- SQLite is single-writer. See [0006](./0006-postgres-adapter-proposed.md) for multi-user hosting.

## Evidence

`backend/test/storage.test.ts` (upgrade from a version-1 file, refusal of a newer database,
rollback), `ledger-service.test.ts` and `auth.test.ts` (audit entries for reviews, branches and
deletes), and tests that tamper with a row and expect `verify()` to report where it broke.
