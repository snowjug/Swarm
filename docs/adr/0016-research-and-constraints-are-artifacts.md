# 0016. Research and constraints are artifacts, not tables

Status: Accepted. Built. A research run, a set of constraints and the views of what the change does without
one are project artifacts; the schema is still at version 9. Tested on SQLite, with the command that runs the
store tests on PGlite as well given in the research README. **Not run against a deployed database.**

## Context

[0014](./0014-scenario-lab.md) decided that what a project carries beyond its own record is a validated JSON
document in `project_artifacts`, so that a new feature needs a schema and no table. Two features then arrived
that look as if they deserve tables of their own. A research run has sources, events and stages. A set of
constraints has many fields, and a person changes it one constraint at a time. A table for each would be a
migration on two dialects, an entry in the backup and copy lists, a rule for deleting with the project and for
tenants, and a schema version that an older build refuses. Nobody queries a run or a set by its parts: a
person reads one as a whole, and the server writes one as a whole.

## Decision

1. **Three kinds are added to `shared/artifacts.ts`, and no table.** `research` has one document for each
   run, keyed by the run's id (`rr-` and a sequence number, so that ids sort in the order the runs were made),
   and a project may hold several. `constraints` and `constraint-counterfactuals` have one document each,
   under the key `default`. A write is checked against the kind's schema, a stale write is refused with
   `409 ARTIFACT_CONFLICT`, the document goes when its project does, and `db:copy` carries it, as for every
   other kind.
2. **A run record holds a record of each address, not its text.** For every address tried it keeps the address
   with secret-looking query values removed, what became of it, the content hash, a title, the warnings and
   whether it was flagged for text aimed at an AI; at most 80 sources (what became evidence is kept first,
   then what was read, then what was turned away) and the last 80 events. For each passage that came from a
   page it also keeps where the passage sat (the page's heading path and a kind; at most 600). The text of the pages
   that were chosen becomes documents and passages of the project (`Repository.appendDocuments`), and the
   record points at them. A page that was not chosen is listed with the reason and its text is not kept.
3. **A run is written whole, with the revision it was read at.** A write made for a job is also held to the
   job's lease, and one whose job went to another worker is refused with `LEASE_LOST`, so a worker that lost
   its job cannot write over what the new holder wrote.
4. **The Decision Canvas is not an artifact.** It is worked out from these at every read
   ([0023](./0023-the-decision-canvas-is-derived.md)), so there is no second copy that can go stale.
5. **Runs are not pruned.** `analysis` keeps the newest twelve. Nothing removes a research run but the removal
   of its project, and of a run that the queue refused, which is deleted again so that no run waits for a job.

## Consequences

- No query across runs or constraints in SQL: to answer "which runs ended blocked" the server reads the
  documents. Nothing in the product asks that.
- A document may not exceed 2,000,000 bytes. A run that has read more than its record holds is cut when it
  is saved (the sources and events above), not refused by the database.
- A constraint set is written whole by `PUT` and changed one action at a time by the review route, both with
  the revision a person was looking at. Two people editing the same set meet `ARTIFACT_CONFLICT`, not a merge.
- Moving to tables later would be a migration that reads the documents; the schemas in `shared/` are the
  contract either way.

## Evidence

`backend/test/research-store.test.ts` (the record, written whole, with the revision check and the job's
lease, and `appendDocuments`), `backend/test/constraints-schema.test.ts` and
`backend/test/constraints-routes.test.ts` (the contract, and a stale write refused),
`backend/test/artifacts.test.ts` (kinds, keys and revisions in general) and
`backend/test/concurrency.test.ts` (the first write of a document, raced on SQLite and on a PostgreSQL
server in a container: [docs/production/database.md](../production/database.md#7-concurrency-what-the-race-tests-show)).
