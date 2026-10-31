# 0011. Report Studio: a person works on a copy of the report

Status: Accepted. Built, and tested with unit, access, storage and browser tests and 25 mutations of
its rules. **Writing a chapter again has been run only against a stand-in for the provider that
speaks the real protocol, never against a live model. An approval is a record in this application,
not an external attestation.** Nothing is deployed.

## Context

The generated report was read-only. Reviewers could record a decision on one statement in the
evidence ledger, but nobody could correct a sentence, keep what the report said before, have a
second person approve the report as a whole, or print a memo that says what was approved. A report
that cannot be corrected is copied into another tool and corrected there, which loses the
statements, the evidence and the record.

Letting people edit has its own danger: an edited sentence is no longer the sentence the server
checked against the sources, and a reader who sees a check mark beside it is misled.

## Decision

1. **The generated report is never changed.** A person opens it in the studio, which makes a
   _document_: one JSON row per project in `studio_documents` (migration 7, on SQLite and on
   PostgreSQL), with the sections, their versions, locks and notes, regenerated text waiting for a
   decision, the review decisions, the approval and an archive of earlier documents. Deleting the
   project deletes it; restoring a snapshot replaces it.
2. **Sections and versions.** The sections are the executive summary, each chapter (`S1`…`Sn`) and
   the limitations. Every save is a new version with who made it, when and an optional reason; a
   version is never rewritten or removed, and bringing an earlier text back is a new version too. A
   change in line endings or surrounding blank space is not an edit, and an edit that changes
   nothing is refused. Sizes are bounded (12,000 characters a section, 100 versions, 50 notes, and
   3,000,000 characters for the document, which is refused with `413`).
3. **States.** `draft` and `changes-requested` can be edited. Submitting makes the report
   `in-review`, which is frozen so that a reviewer approves what they read; approving makes it
   `approved`, which is frozen so that nothing changes an approved report until a person reopens
   it. Requesting changes and reopening need a reason of at least three characters. A reviewer's
   note is allowed in any state because it changes no text.
4. **Who may do what.** This extends the capability table of [ADR 0007](./0007-workspace-and-project-membership.md),
   which said report edits would join it. A new project capability, `edit`, belongs to analysts and leads; `review`
   to reviewers and leads. A reviewer cannot edit and an analyst cannot approve. A lead can do both,
   because a pilot with one lead must be usable; the approval therefore records `alsoEdited` when the
   approver wrote any version of the text, and the memo and the toolbar say so. The record does not
   forbid it; it makes it visible. Every studio route is in the default-deny route table and the
   audit table.
5. **An approval is of exact text.** It stores a SHA-256 over every section's identifier and text.
   The printable memo prints it, and a memo for an approval that no longer matches says
   `APPROVAL NOT CURRENT` instead of `APPROVED`.
6. **Concurrency is refused, not merged.** A save names the section version the person was looking at
   and a transition names the document revision; another current version is `409`. The row is saved
   with `WHERE revision = ?`, and a change that does not touch what someone else changed is applied
   again to what they saved (up to four times), so two people editing different sections both
   succeed. There is no merge and no live co-editing.
7. **Edited text is not shown as checked.** The statements of generated text are the ledger's. The
   statements are tied to the hash of the text they were checked against. When a person changes a
   section, its statements are still shown, marked as describing an earlier text; the memo does not
   list them as findings, and the review summary counts the chapter as not current. Bringing the
   exact text back re-attaches them. Text a person wrote is not checked statement by statement, and
   the interface says so beside it.
8. **Writing a chapter again is a proposal.** The model rewrites one chapter with the report
   writer's own prompt and its editing rules. What the person asks for is passed as data that asks
   for emphasis and wording; it cannot loosen a rule. The new text goes through the same grounding
   review as the report (quotations, wording, figures and, where a model is configured, an
   independent check), and what it found is shown with the text. The result is a proposal, one per
   section, that changes nothing until a person accepts it; the person sees a word-level comparison
   first. Model calls are capped per request (10), recorded as project usage, and run one at a time
   per project (`409 PROJECT_BUSY` while a stage or the analyst is using the model). Only chapters can
   be written again, and only with the provider and model that wrote the report.
9. **A document can go stale.** It records a hash of the generated report it was made from. If the
   report is replaced, the document can be read and exported but not changed; starting again makes a
   new document from the new report, asks for confirmation if the old one holds anyone's work, and
   keeps the old text in an archive (three at most).
10. **Exports.** Markdown and JSON carry the status, every section as it stands, the statements, the
    notes and the record. The memo is one HTML page with no script and no external resource, every
    piece of text escaped, served with `default-src 'none'; style-src 'unsafe-inline'` and no
    caching. Anything that is not approved is stated at the top and in a dashed border, so a printed
    draft cannot be taken for a decision.
11. **Audit.** Each change is recorded in the audit log in the same transaction as the change, with
    identifiers and counts only; the text of a section, a note or a reason is never written to it.

## Consequences

- **An approval is not a verification.** It says a person with the review capability read this text and
  accepted it. A supported statement still means only that a passage backs it.
- **The hash is not a signature.** Someone who can write to the database can change the document and
  recompute the hash. The audit chain would show the entries around it, but an approval is not
  attested by anything outside the application.
- **Regeneration quality is unknown.** The checks catch quotations that are not in the passages,
  wording that no passage supports and figures that match nothing; they do not catch a wrong
  statement that cites a passage that says something else. The path has run against a fake provider
  only.
- **No real-time collaboration, comments or merge.** Two people editing one section: the second is
  refused and sees the first's text. Comparison is between a version and the current text.
- **One row grows.** A heavily edited report approaches the document limit; the limit refuses
  further edits rather than losing history, and exporting then starting again is the way out.
- **PostgreSQL** has been exercised in-process only, as the rest of the adapter has.

## Evidence

`backend/test/studio-model.test.ts` (the rules as pure functions), `studio.test.ts` (the service,
the routes, the memo and the exports), `studio-access.test.ts` (every role, hidden and cross-tenant
projects, anonymous callers, removal taking effect on the next request), `studio-regenerate.test.ts`
(the provider protocol, hostile instructions, concurrency, availability), `studio-store.test.ts`
(the store, migration 7 and its backup), `frontend/src/components/studio/studio.test.tsx` and
`frontend/src/lib/studio.test.ts` (what the page shows for each state and capability),
`e2e/journey/studio.spec.ts` (the whole workflow in a real browser on the demonstration, in each
theme and on a phone), and 25 mutations of the rules above (`npm run mutation:security -- --area=studio`),
each of which a test catches.
