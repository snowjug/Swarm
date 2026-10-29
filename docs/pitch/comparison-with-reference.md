# Comparison with the reference project

Swarm is an independent implementation inspired by the publicly documented behaviour of a reference
project that simulates reactions to a scenario with many agents. It copies none of that project's
code, assets, prompts or demo cases; see [NOTICE.md](../../NOTICE.md). The row-by-row comparison, with
the evidence for every EQUIVALENT and BETTER rating, is the [parity matrix](../parity-matrix.md). This is
the short version. It compares observable, publicly documented behaviour only, and does not assume
anything about the reference that its public material does not say.

## The count

Of 26 observable capabilities in the matrix: **4 better, 6 equivalent, 9 partial, 3 not implemented,
4 intentionally different.**

## Where Swarm is behind

- **Scale.** The reference describes thousands of agents. Swarm runs 4 to 24 proxies locally and 4 to
  10 with a model. Not implemented, and not planned for a pilot.
- **Hosted graph memory.** The reference writes agent memory back into a hosted graph service. Swarm
  keeps a local graph and a lexical index, by choice (local first), so memory write-back is partial.
- **Multi-language interface, automatic parsing of "prediction requirements".** Not implemented.
- **Agent-level activity schedules and a live-feeling simulation view.** Partial.

## Where Swarm is the same

Seed intake of PDF, Markdown and text; graph visualisation with inspection; report viewing and
download; the five-stage console; any OpenAI-compatible provider at the protocol level; Docker and
source deployment.

## Where Swarm is better, with evidence

- Start, stop and status of a running simulation, including pause, intervention and resume.
- Counterfactual branches from a checkpoint with a run comparison.
- Runs with no hosted service at all.
- Accessibility of the console, by automated measurement at four viewports.

## Where it is deliberately different

It does not frame itself as predicting anything, uses no hosted graph service, and uses its own
fictional demonstration cases.

## What the reference does not document, and Swarm adds

The following have no counterpart in the reference's public material, so no rating applies; an
observer cannot say whether it is better or worse, only that it is present here:

- Statement-level types and support classes, and a deterministic publication policy.
- Conflict candidates between sources, with human confirmation.
- An assumption register.
- Abstention and cite-or-abstain in the analyst chat.
- A hash-chained audit log, and sign-in with roles and tenant isolation in the API.
- An offline evaluation with published limits.

These are the reasons to build on Swarm rather than only to reproduce the reference's workflow. They
are also the least battle-tested parts of it: see [what is built](./what-is-built.md).
