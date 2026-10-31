# Risks and limitations

The short version. The full register, with what is in place and what remains for each, is the
[risk register](../program/risk-register.md).

## Limits of what the product does today

- **It explores scenarios; it does not predict.** A simulated result is a labelled simulation.
- **A support class is not a truth value.** It says how well the project's own documents back a
  statement. If the documents are wrong, the class cannot tell.
- **The checks are heuristics.** The deterministic check accepted 3 of 8 unsupported statements in the
  labelled set. A model-assisted check can lower or confirm a verdict, and is observed only in live
  runs.
- **The analyst can still answer what it should not.** Its first check refuses off-topic questions
  and unknown years but passes 3 of 4 plausible questions about something absent, and questions that
  mix an unrelated topic with a word the project uses.
- **Conflict detection is partial.** It found 1 of 3 labelled conflicts, and raises false alarms on
  some real material. A person decides every candidate.
- **Prompt injection cannot be considered solved.** Warnings catch 80% of labelled samples,
  in-sample.
- **Rules mode has no statements in its ledger,** because it produces no grounding review.

## Limits of the evidence for it

- The labelled sets are small, in one fictional domain, and written by the person who wrote the
  rules. A figure of 100% means no failure among those examples.
- Nothing has been measured on real documents.
- Live model evidence is one run per milestone against one deployment, not a distribution.
- The author's own review missed four defects, one of them a cross-tenant read through a query
  parameter. A separate automated code review of the branch found them after this package was
  written; all four were fixed with tests that failed first
  ([the list](../program/requirement-matrix.md#defects-found-by-an-independent-review-after-these-documents-were-written)).
  That review was also a single pass, so it is evidence that review finds things, not that nothing
  remains.
- One evaluation figure was found to be overstated and was corrected (abstention recall 57% to 43%
  on the development split). That is the kind of error that remains possible elsewhere.

## Limits of the platform

- By default one SQLite file: one instance, no sharing between hosts. The PostgreSQL adapter that lifts this
  passes the unit suite in-process and has never run against a deployed server.
- Sign-in, in the API and in the browser, is verified against a local test provider only. No real tenant. People are
  added by Entra object ID, because there is no directory lookup: the screens cannot say who an ID belongs to.
- Telemetry reaches no real Application Insights resource, so there are no live traces or alerts. Each project has a
  model budget, but there is no per-tenant total or spend alert. Durable jobs and their automatic resume have not run across separate containers.
- Report Studio has run on a recording; writing a chapter again has run only against a stand-in for the provider.
- Dark and high-contrast themes are derived from the light one and checked by computation and axe, not by a designer or by someone using assistive technology.
- No SBOM, no signed provenance, no independent penetration test.

## Open items that are not engineering

An AGPL-3.0 licence review; a privacy decision on how long audit entries (which carry user ids) are
kept; a Responsible-AI review; approval for any chargeable Azure resource, including the persistent
development machine prepared earlier and not provisioned.
