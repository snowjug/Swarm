# Decision brief

The decision brief is the answer-first document of a project. It puts the answer to the question
first and then shows what the answer rests on: the evidence, the stakeholders, the simulated
outcomes, the assumptions and how much they matter, what to do and how to check it before doing it.

Swarm explores possible scenarios. It does not predict the future. Every figure in the brief is a
count of simulated members or of seeded runs. None is a rate in a real population.

## How it is made

The brief is assembled by rules, in code, from the artifacts a project already holds: the question
and scenario, the stakeholders, the synthetic actors, the evidence ledger and the source documents,
the completed analysis (variants, seeded runs, findings, sensitivity rows, fidelity) and the
critiques recorded against it. No model writes any of its wording, so the same inputs always give
the same brief, apart from the time it was made. The contract marks this as `generatedBy: rules`.

Text that comes from outside the code (the question, names, quotations, the analysis's own finding
statements, critique objections) is quoted inside the sentence that uses it and clipped to a
length. It is data, not instruction, and it is never executed or followed.

The brief is stored with the project as the artifact `brief`; generating it again replaces it. The
charts and tables are not stored. They are worked out again from the analysis and the project's
other documents every time the brief is read or exported, so they always agree with the data.

## The seventeen sections

The order is fixed. The first section is the answer.

| #   | Section                             | What it holds                                                                                                           |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Executive answer                    | One or two sentences, the main caveat in order of how much it can change the answer, and what the brief cannot tell you |
| 2   | Decision evaluated                  | The question, the scenario's decision, changes, baseline, alternatives and open points, and the variants simulated      |
| 3   | Evidence base and quality           | Sources by kind, cited passages, conflicts between sources, and which actors no cited passage supports                  |
| 4   | Stakeholder landscape               | Stakeholders grouped by category, who is harmed or benefited, how much is cited for each                                |
| 5   | Main reaction patterns              | What the simulated groups did, as counts of simulated members                                                           |
| 6   | Alternative outcomes                | How the outcomes spread over the seeded runs of each variant                                                            |
| 7   | First-order effects                 | The direct response of the most affected groups, against the baseline                                                   |
| 8   | Second-order and competitor effects | Second-order findings, responses by actors outside the organisation, and the chain of events in the representative run  |
| 9   | Behavioural drivers                 | The assumptions the simulated result moved with, and those it did not                                                   |
| 10  | Important assumptions               | The assumption register, with who set each and whether a cited passage backs it                                         |
| 11  | Uncertainty and sensitivity         | Findings that were not repeatable, sensitivity rows, open critiques                                                     |
| 12  | Risks and opportunities             | Groups set as harmed that ended up adverse, actions by outside actors, and groups set as benefited that went along      |
| 13  | Prioritised recommendations         | A table of recommendations that follow from findings (see below)                                                        |
| 14  | Validation plan                     | A table of real-world checks that would settle what the result most depends on                                          |
| 15  | Sources and provenance              | Each source, how it was supplied, and whether the server fetched it                                                     |
| 16  | Limitations                         | What this analysis cannot tell you                                                                                      |
| 17  | Technical appendix                  | Seeds, runs, rounds, variants, engine, cost, and the trait values of every simulated actor                              |

## Origins

Every statement carries exactly one of ten origins and the references it rests on. The brief never
shows a statement under an origin it cannot stand behind: if the references an origin needs are
missing, the statement is shown as unresolved uncertainty instead.

| Origin                    | Used for                                                                         | Must rest on                              |
| ------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| Supplied evidence         | A passage from a document that was uploaded or pasted                            | A cited passage or a source document      |
| Retrieved public evidence | A passage from a document the server fetched from a web address                  | A cited passage or a source document      |
| User assumption           | A setting a person typed, edited or added                                        | The assumption itself                     |
| System assumption         | A default Swarm filled in, a setting of the scenario or a property of the method | The assumption itself                     |
| Inferred stakeholder      | A stakeholder worked out from the sources                                        | A stakeholder                             |
| Actor behaviour           | What a simulated actor did in the simulation                                     | A stakeholder or a finding                |
| Simulation aggregation    | A count or comparison over seeded runs                                           | A finding, a sensitivity row or a variant |
| Model interpretation      | A reading of a finding                                                           | A finding                                 |
| Historical comparison     | A document that records what happened before                                     | A cited passage or a source document      |
| Unresolved uncertainty    | What is not known                                                                | Nothing: it names what is missing         |

A few rules decide the evidence origins. A document is retrieved public evidence only when its
provenance is a web address and the server fetched it; a document marked as historical is a
historical comparison; everything else is supplied evidence. A trait that is labelled as resting on
evidence is shown as evidence only when a passage is cited for it; otherwise it is shown as a system
assumption or as unresolved uncertainty. A trait proposed by a model that no one has changed is a
system assumption.

The page and the exports show each statement's references, so a reader can open the quotation with
its passage id, the finding with how often it held, the assumption, the variant or the stakeholder.

## Reliance

A statement that rests on a finding also says how far to rely on it. The level comes from how often
the finding held across seeded runs and whether a cited passage supports the actors it is about:

| Finding                                         | Reliance |
| ----------------------------------------------- | -------- |
| Repeatable, and the actors have a cited passage | High     |
| Repeatable, and the actors have none            | Moderate |
| Mostly repeatable                               | Moderate |
| Unstable or rare                                | Low      |

A statement is only as reliable as the least reliable finding it rests on. A statement about a
stakeholder is moderate if a passage supports it and nothing contradicts it, and low otherwise.
Statements that do not rest on a finding carry no reliance. These levels describe how stable a
simulated result is. They are not probabilities and say nothing about the real world.

## Numbers

Counts of simulated members are worked out from the runs: the members of each actor, times the
share that gave each response, added up per run and then averaged over the seeded runs of a
variant, with the lowest and highest shown. Members who ended up looking for an alternative or
resisting are counted as adverse. A comparison with the baseline is paired by seed, so the same
random draws sit on both sides and the difference is the change, not the noise. Population sizes
are assumptions that weight each group. They were not measured.

## Recommendations

Every recommendation links to at least one finding and carries its impact, effort, reversibility,
a time horizon, an owner function, leading indicators, the assumptions it depends on and how to
check it before committing. They come from a few generic rules that know nothing about the subject:

- An adverse, repeatable finding for a harmed group: mitigate, or stage the change.
- An assumption the result is sensitive to that nothing cited backs: validate it first.
- Key actors, or evidence the question named, that nothing cited supports: collect evidence.
- A repeatable event from an actor outside the organisation: prepare a response.
- An unstable finding: repeat the analysis before relying on it.
- A favourable, repeatable finding for a benefited group: build on it.
- Serious open critiques: resolve them first.

At most twelve are listed. They are ordered by impact times repeatability divided by effort.
Impact is the size of the simulated shift (at least 0.3 is high, at least 0.1 is medium, measured as
a share of a group's simulated members or a change of stance on the scale from -1 to 1).
Repeatability is the largest lower bound of the Wilson interval among the findings the
recommendation follows from. Effort is a planning default for the kind of action, and low, medium and
high weigh 1, 2 and 3. Ties go to the higher impact, then the lower effort, then the order they were
found in. The owner function comes from the stakeholder category the recommendation is about. These
are lenses, not a list of answers for any one case, and the effort values are not estimates.

## Validation plan

The plan has at most eight checks, chosen in this order: the assumptions the runs were sensitive to
that nothing cited backs (the five that moved the result most), the findings that were not stable
across seeded runs (up to three), and the key actors that no cited passage supports (up to two).
Each check names its targets, the question, the method, the signal that would count as success, the
effort and the duration. The method is a generic real-world check (a survey, interviews, a data
pull, an expert review or a staged rollout) adapted only by the trait and the kind of group.

## Wording guard

Every statement is checked before it is kept. The words of the statement itself, outside any
quotation, may not predict ("will"), overclaim (certainly, definitely, guarantee, proves, proven,
inevitable) or put a number on a real population as a percentage. A statement about the simulation
must say that it is simulated, and so must the headline and the recommendations. A statement that
fails is withheld and replaced by a notice, its origin is shown as unresolved, and the count is
recorded in the methodology notes of the brief. Quotations from the sources are not rewritten.

## Reading it

- The origin chip tells you where a statement comes from. Start with the reliance of the executive
  answer and the line "what this does not tell you".
- A finding that held in few seeded runs, or whose actors no cited passage supports, is a hypothesis
  to check, not a result. The validation plan says how.
- Each chart has a table behind it with the same numbers.
- "This brief may be out of date" means a scenario, stakeholders, actors, critiques or the analysis
  changed after it was made, or a newer completed analysis exists. Generate it again.

## Charts

The page draws six visuals from the analysis data: a stakeholder map by category, the outcome
distribution over seeded runs, a comparison of each variant with the baseline, sensitivity bars,
the assumption register and the evidence map. Each is HTML or SVG made for this page, uses only the
theme's colour variables, is described in words, and has a table alternative. The exports carry the
same data as tables. The contract also names an influence network, a risk and impact chart and a
timeline. They are not drawn, because the analysis does not hold the data to draw them without
inventing it.

## Routes

| Route                                | Who may call it                   | What it does                                                         |
| ------------------------------------ | --------------------------------- | -------------------------------------------------------------------- |
| `GET /api/projects/:id/brief`        | Anyone who may read the project   | The stored brief (or none), the chart data, what has changed since   |
| `POST /api/projects/:id/brief`       | Anyone who may edit the project   | Makes the brief from the newest completed analysis, or the one named |
| `GET /api/projects/:id/brief/export` | Anyone who may export the project | `format=md` (the default), `json` or `html`                          |

`POST` takes an optional `analysisId` and answers 201 with the same view as `GET`. It answers 409
when there is no completed analysis (`NO_ANALYSIS`), when the named analysis has not finished
(`ANALYSIS_NOT_COMPLETED`) or recorded no runs (`ANALYSIS_EMPTY`), and 404 when the named analysis
is not in the project. An export answers 409 `BRIEF_NOT_GENERATED` before a brief exists. Who holds
which capability is described in [roles and tenancy](../adr/0005-identity-roles-and-tenancy.md) and
[workspace and project membership](../adr/0007-workspace-and-project-membership.md). Generating and
exporting are recorded in the audit trail as `brief.generated` and `brief.exported`, with the
format and ids only and never a question, a statement, a name or a passage.

## Exports

- **Markdown** and **Printable** (HTML) are written from the same list of blocks, so they say the
  same things. Every piece of text from a source, a name, a quotation or a finding is escaped as
  data, so markup, links and HTML in it stay as text.
- The printable page has no script and loads nothing. It is served with the policy
  `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'`, together with `x-content-type-options: nosniff` and `cache-control:
no-store`. Print it from the browser to get a paper or PDF copy.
- **JSON** is the stored brief and the chart data, with a notice and a schema version.

## What it does not do

- It does not forecast. It describes what happened in a simulation of synthetic actors under
  stated assumptions.
- It does not give a rate, a share of a real population or a financial figure.
- It does not verify its sources. A cited passage shows where a statement came from, not that it is
  true.
- It does not use a model to word anything. A later version could let a model word interpretations
  of findings; until then every sentence is built from data by rules.
- It does not compare the simulation with past outcomes.
- It does not produce a PDF or a Word file. The printable page is the print route.
- It does not keep earlier versions of the brief. Generating it again replaces the stored one.
- It is not a substitute for the checks in its own validation plan.
