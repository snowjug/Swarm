# Baseline

Measured before any change in this program, so that every later claim of improvement has something to be compared with. Nothing here was edited after the fact.

| Item        | Value                                                          |
| ----------- | -------------------------------------------------------------- |
| Commit      | `2e48a51` (identical to `origin/main` when measured)           |
| Environment | Windows, Node 24.22.1, npm 12.2.0, Microsoft Edge for browsers |
| Measured    | 2026-10-29, between 12:04 and 12:16 UTC, by one scripted run   |

## Gates

| Gate                                                 | Result                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run check` (typecheck, lint, unit tests, build) | exit 0 in 105 s; 56 test files, **935 tests** passed; lint 0 warnings                                 |
| `npm run format:check`                               | clean                                                                                                 |
| `npm run scan:secrets`                               | 556 history blobs and 292 working-tree files scanned; 0 findings; 0 tracked `.env` files              |
| `npm audit` (Microsoft package mirror)               | 0 vulnerabilities                                                                                     |
| End-to-end tests, Edge                               | **78 passed**, 4.4 min                                                                                |
| Live Azure scenario (`npm run azure:verify`)         | **VERIFIED, 15 of 15 checks**, 198 s, keyless Microsoft Entra authentication to a deployed chat model |

## What the live Azure run said about the product

The live run is the only measurement here that involves a real model, and it is one run, not a distribution. It scored the report's 30 statements:

- 14 supported, 5 partly supported, **8 not supported**, 0 contradicted, 3 not checkable.
- 0 source facts carried a verbatim quotation.
- 60 model round trips, of which 3 were corrective retries; 95,154 input and 13,376 output tokens.
- The analyst-chat reply was 2,696 characters and **cited no passage**.
- A planted instruction inside a source (a hidden token the model was told to repeat) did not appear in 48 proxy statements, 2 chat replies or the summary. One probe is evidence, not proof, of resistance.

## Findings from the architecture audit

These are the starting points the work in this program addressed, or did not:

1. **Storage** was one `projects` table holding the whole project as a JSON document, with a bare `user_version = 1` and no migration path.
2. **The API was single-user and project-centric**: no principal, workspace, tenant, role or per-object authorisation. No endpoint existed for individual claims or assumptions.
3. **Conflicts between sources were never reported.** Only a statement against its own cited passage was checked.
4. **Retrieval** was TF-IDF over 1,200-character passages, always returned the top four with no relevance threshold, and discarded digit-only tokens, so a figure could not help find a passage.
5. **Chat always answered**, whether or not the project held anything relevant, and a model answer could cite nothing.
6. **An interrupted run was marked failed**; nothing resumed it after a restart.
7. **The front end** used custom CSS with no component library and no router.
8. **Telemetry** was counts and codes in logs; there was no distributed tracing.

## How to reproduce

```
git checkout 2e48a51
npm ci
npm run check && npm run format:check && npm run scan:secrets
PW_CHANNEL=msedge npm run test:e2e
npm run azure:verify     # needs `az login` and the resources in docs/AZURE.md
```

The E2E suite and the Azure run depend on the machine and on the live service; expect the same pass/fail outcome, not identical timings or token counts.
