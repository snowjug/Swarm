# Security and privacy notes

Back to the [README](../README.md). The evidence behind these statements is in [security-review.md](./security-review.md); the threats considered are in [threat-model.md](./threat-model.md).

- **Local, single-user application; no user authentication or tenant isolation.**
  Loopback binding, explicit host/origin allowlists, CSP, request limits and rate
  limits do not replace authentication. Do not expose this server directly online.
- **Hosted-mode identity boundary.** With `AUTH_MODE=entra` a person signs in with Microsoft in the
  browser (the server runs the Authorization Code flow with PKCE and keeps an opaque, HttpOnly,
  server-side session; no token reaches the page), or an API client sends a verified Microsoft Entra
  bearer token. Every route is then authorised from workspace and project membership (seven roles,
  read from the database on every request, so removing someone takes effect on their next call). A
  project a person was not added to, or that belongs to another tenant, is reported as not found. The
  audit log records sign-ins, sign-outs, membership changes and refusals. This has only met a test
  identity provider, never a real tenant, and there has been no independent review
  ([ADR 0007](./adr/0007-workspace-and-project-membership.md),
  [ADR 0008](./adr/0008-browser-sign-in.md)).
- Source names never become filesystem paths. Text input is type/size checked on
  both sides and stored with parameterized SQLite statements. PDFs use bounded
  in-memory bytes and a disposable worker; no original upload is written to disk.
- PDF workers do not inherit model credentials, execute embedded PDF scripts,
  render forms/images, or fetch user-supplied URLs. Byte/page/text/time/heap limits
  and one-worker concurrency protect the main API. This is not OCR or a guarantee
  against every parser vulnerability; keep the parser dependency current.
- Source text, webpage-looking text, memories and outputs are untrusted data.
  No arbitrary URL fetch, shell, code execution, plugins or filesystem tools are
  available to agents. Prompt boundaries reduce risk but do not prove immunity
  to prompt injection or hallucination.
- A person may ask the server to read one public web page as evidence
  (`POST /api/evidence/url`). That is the only place the server fetches an address it
  was given: it refuses private, local and cloud-metadata addresses however they are
  written, connects only to addresses it checked, re-checks every redirect, obeys
  robots.txt, bounds size and time, and reads the page as text without running any of
  it. What a page says is still untrusted and unverified
  ([URL ingestion](./security/url-ingestion.md)).
- Model output is schema-validated; agent/node/peer/citation IDs are checked.
  Valid citation IDs do not establish factual truth or semantic entailment.
- Source citations (`S...`), synthetic memories (`M...`) and generated fictional
  interviews (`I...`) have distinct provenance and are validated against the
  actual context supplied to the model. Operation traces record bounded task/tool
  input/output, never provider authorization headers or private chain-of-thought.
- React renders source/model text as text, not raw HTML. Markdown exports escape
  untrusted HTML/Markdown. Downloaded JSON remains sensitive data if sources are.
- Model endpoints are administrator-configured, not selected by input documents.
  HTTPS is required except for explicitly local Ollama addresses. Redirects are
  rejected. Keys stay server-side and provider bodies/request content are not logged.
- Local mode makes no model requests even if a provider is configured. Model mode
  sends bounded source/persona context to that provider; review its privacy policy.
- `.env`, SQLite data, node_modules, build output and caches are Git-ignored.
  Use OS access controls/disk encryption for sensitive local sources.

## Dependency advisory status

`npm audit` (run through the corporate registry mirror, because the public
advisory endpoint fails TLS from the development machine) reports **0
vulnerabilities** as of the last review. Earlier moderate `fast-uri` advisories
were cleared by updating to `3.1.9` / `4.2.3`. AJV 8 is constrained to a patched
compatible release without replacing ESLint's separate AJV 6 API, and the maintained
static-file plugin replaces an initially vulnerable older major.

This is a point-in-time result, not a guarantee. Run `npm audit` against your
approved registry before every deployment. CI fails on new high/critical findings.
See [security-review.md](./security-review.md) and
[threat-model.md](./threat-model.md) for what was checked and what remains open.
