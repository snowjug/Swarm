# Questions and answers

**Is it ready for production use?** No. It runs locally and is not hosted. Browser sign-in exists but has only been\ntested against a test identity provider. [The gates](../production-readiness.md) say which are met and which\nare not.

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

**Does it work with Entra sign-in?** The server verifies Entra tokens, signs a person in through the browser
(Authorization Code with PKCE, a server-side session, no token in the page), enforces seven roles through
workspace and project membership, and separates tenants. All of it is tested against a local test identity
provider, with sixteen kinds of bad token among the cases. It has never been used with a real tenant: that
needs an app registration only a tenant administrator can create. Owners, administrators and project leads
manage who has access from the browser, by Entra object ID; there is no directory lookup.

**What does a run cost?** The live scenario used about 105,000 to 121,000 input and 14,000 to 17,000
output tokens across the last two runs. At public list prices for the deployed model that is roughly
six to eight US cents. See the [cost model](./cost-model.md) for the assumptions; it is an estimate.

**What did the evaluation find wrong with Swarm itself?** The first conflict detector found none of
the three labelled conflicts; injection warnings caught 30% of samples; the abstention threshold sat on
a cliff; the analyst was never shown the grounding review it was asked about, which an end-to-end test
caught; and the first version of the harness overstated abstention recall. Each was fixed or
corrected, and the corrections are in the commit messages and the [evaluation README](../../evaluation/README.md).

**Why SQLite?** It suits a local-first tool. A hosted, multi-user shape uses PostgreSQL: an adapter behind the\nsame stores is built (see [ADR 0009](../adr/0009-postgres-through-a-synchronous-bridge.md)), and the whole unit\nsuite passes on it in-process. It has never been run against a deployed server.

**What happens when the model is down?** The failure is named without showing a prompt or a key, and
the run can be retried or switched to rules mode.

**Can analysts add their own assumptions?** Not yet. The register is derived from the scenario and
read-only.

**Can someone correct the report and approve it?** Yes, in Report Studio: they edit a copy section by section, a
reviewer approves or sends it back, and the approval is of the exact words. Edited text is shown as written by a
person, and the statements checked against the earlier text are never presented as checking the new. See
[ADR 0011](../adr/0011-report-studio.md); an approval is a record in the application, not an attestation.

**How does it compare with the reference project?** See [the comparison](./comparison-with-reference.md).

**What is the licence?** AGPL-3.0-only. If you offer a modified version as a network service you must
offer its source to its users. It needs a licensing review before any hosted pilot.

**What was tested?** See the [requirement matrix](../program/requirement-matrix.md) for counts and
the evidence for each requirement.
