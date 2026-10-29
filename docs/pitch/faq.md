# Questions and answers

**Is it production ready?** No. Eight of 28 gates are met; see
[the gates](../production-readiness.md). It is a pitch-ready prototype.

**Does it predict the future?** No. It explores possible scenarios, and says so.

**Why trust the support classes?** Only as far as their checks go. A class is assigned by
deterministic checks (quote found verbatim, word overlap, figures compared with the data), and a
model check can lower or confirm it, never raise it. Those checks accepted 3 of 8 unsupported
statements in the labelled set, because word overlap cannot read meaning. They are there to stop a
model from grading its own work, not to be an oracle.

**Can a model or a reviewer talk a weak statement into a finding?** No, by construction: the
publication policy is a function of type and class, a model check can only weaken, and accepting a
statement records that a person looked without changing its class. A test asserts it.

**What if my sources are wrong?** Swarm cannot know. It shows what the sources say and where they
disagree.

**What leaves my machine?** In rules mode, nothing. In model mode, documents and prompts go to the
Azure OpenAI deployment you configure, in your tenant. No key is stored; the call uses an Entra token.

**Does it work with Entra sign-in?** The API verifies Entra tokens, enforces roles and separates
tenants, tested against a local test provider with sixteen kinds of bad token. It has never been used
with a real tenant, and the browser has no sign-in screen.

**What does a run cost?** The live scenario used about 105,000 to 121,000 input and 14,000 to 17,000
output tokens across the last two runs. At public list prices for the deployed model that is roughly
six to eight US cents. See the [cost model](./cost-model.md) for the assumptions; it is an estimate.

**What did the evaluation find wrong with Swarm itself?** The first conflict detector found none of
the three labelled conflicts; injection warnings caught 30% of samples; the abstention threshold sat on
a cliff; the analyst was never shown the grounding review it was asked about, which an end-to-end test
caught; and the first version of the harness overstated abstention recall. Each was fixed or
corrected, and the corrections are in the commit messages and the [evaluation README](../../evaluation/README.md).

**Why SQLite?** It suits a local-first tool. A hosted, multi-user shape needs PostgreSQL, which is
proposed in [ADR 0006](../adr/0006-postgres-adapter-proposed.md) and not built.

**What happens when the model is down?** The failure is named without showing a prompt or a key, and
the run can be retried or switched to rules mode.

**Can analysts add their own assumptions?** Not yet. The register is derived from the scenario and
read-only.

**How does it compare with the reference project?** See [the comparison](./comparison-with-reference.md).

**What is the licence?** AGPL-3.0-only. If you offer a modified version as a network service you must
offer its source to its users. It needs a licensing review before any hosted pilot.

**What was tested?** See the [requirement matrix](../program/requirement-matrix.md) for counts and
the evidence for each requirement.
