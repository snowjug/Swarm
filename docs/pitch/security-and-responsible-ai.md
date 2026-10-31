# Security and responsible AI

What is in place, what is open, and what only a reviewer can sign off. Nothing here says Swarm is
secure. The detailed records are the [threat model](../threat-model.md), the
[security review](../security-review.md) (written by the author, so not independent) and the
[risk register](../program/risk-register.md).

## Controls in place, with their evidence

| Area                          | Control                                                                                                                                                                                                 | Evidence                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Prompt injection              | Sources, questions and model output are treated as data. Models have no tools, shell, file or web access. Outputs are schema-checked. Echoing an embedded payload is rejected. Patterns raise a warning | `security.test.ts`, `injection.test.ts`, `e2e/model/verify.spec.ts`; one live probe                                    |
| Secrets                       | No key is stored: the model call uses a Microsoft Entra token. Secret-shaped text is redacted from logs and reports                                                                                     | `security.test.ts`, `auth.test.ts` (no token in logs); `npm run scan:secrets` (working tree and all reachable commits) |
| Sign-in and authorisation     | Entra bearer tokens verified in the API; four roles; a default-deny route table; tenant and owner scoping; the same 404 for a foreign project as for a missing one                                      | `auth.test.ts` (42 tests); four mutations caught ([ADR 0005](../adr/0005-identity-roles-and-tenancy.md))               |
| SSRF                          | Two outbound calls: the configured model endpoint (HTTPS), and one public web page a person asks Swarm to read, through an address policy, pinned connections and re-checked redirects                  | `config.test.ts`, `security.test.ts`, `client.test.ts`, `url-policy.test.ts`, `url-fetcher.test.ts`                    |
| Path traversal, file handling | Filenames validated; PDF parsed in a resource-limited worker with no environment or credentials; body and page limits                                                                                   | `contracts.test.ts`, `pdf.test.ts`, `app.test.ts`                                                                      |
| SQL injection                 | Every statement is parameterised                                                                                                                                                                        | `repository.test.ts`                                                                                                   |
| Browser origin                | Host and Origin allow-lists on every request; no CORS headers are emitted                                                                                                                               | `app.test.ts`, `security.test.ts`                                                                                      |
| Cross-site scripting          | Server text is rendered as text; no raw-HTML sink exists in the front end; Markdown export escapes statement text                                                                                       | `markup-sinks.test.ts`, `ledger-service.test.ts`                                                                       |
| Tamper evidence               | Append-only, hash-chained audit log                                                                                                                                                                     | `storage.test.ts` ([ADR 0003](../adr/0003-schema-migrations-and-audit-log.md))                                         |
| Dependencies                  | A small set, a lockfile with integrity hashes, `npm audit` in CI                                                                                                                                        | `npm audit`; the CI workflow                                                                                           |

## Open

- **Sign-in has never met a real tenant**, and the browser cannot sign in.
- **Prompt injection is an active risk and cannot be considered solved.** The warning patterns caught
  80% of labelled samples (in-sample) and miss obfuscated and non-English text. The structural
  defences above do not depend on detection.
- **Tenant isolation is in application code.** There is no row-level security, and the database is
  one shared file.
- **The audit log is not anchored outside the database**, so someone with the file could rebuild it,
  and it keeps principal ids after a project is deleted. A retention decision is needed.
- No software bill of materials, no signed provenance, and no independent penetration test.

## Responsible AI

What the product does:

- **It says what it is.** Every simulated result is labelled as simulation. Personas are fictional
  proxies with assumed goals, explicitly not digital copies of real people. The product states that
  it explores scenarios and does not predict.
- **It separates evidence from invention.** The type and support class on every statement, and a
  deterministic rule for how each may be shown.
- **It keeps a person in charge.** Conflicts are candidates until someone decides; reviewers can
  reject and withhold; a review cannot raise an unsupported statement into a finding.
- **It declines.** The analyst abstains in fixed words when the evidence cannot answer.
- **It records what happened,** by identifier and never by content.
- **It states its own limits** next to its numbers ([evaluation results](./evaluation-results.md)).

What has **not** been done, and needs a reviewer:

- A Responsible-AI impact assessment, including who could be harmed by a misread scenario.
- Fairness and bias testing of generated personas.
- Red-teaming beyond one planted-instruction probe.
- Content-safety measures beyond the model provider's own filter.
- A data-handling agreement for the documents a pilot would use: with the model provider's
  endpoint, documents leave the machine and go to the Azure OpenAI deployment of the operator's tenant.

The [human review checklist](./human-review-checklist.md) lists what to put in front of each
reviewer.
