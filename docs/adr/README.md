# Architecture decision records

Short records of decisions that shape Swarm and that a reviewer should be able to challenge. Each
states what was decided, what it costs, and what evidence exists. A record marked **Proposed** has
not been built.

| Record                                            | Status   | Decision                                                                                        |
| ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| [0001](./0001-evidence-integrity-model.md)        | Accepted | Every statement carries a type and a support class; a deterministic policy decides publication  |
| [0002](./0002-abstention-and-citation-rule.md)    | Accepted | The analyst declines, without a model call, when the project's evidence cannot answer           |
| [0003](./0003-schema-migrations-and-audit-log.md) | Accepted | Versioned migrations with a backup, and an append-only hash-chained audit log                   |
| [0004](./0004-evaluation-approach.md)             | Accepted | Hash-pinned labelled datasets, a dev/test split and floors, not targets                         |
| [0005](./0005-identity-roles-and-tenancy.md)      | Accepted | Entra bearer tokens verified in the API, four roles, a default-deny route table, tenant scoping |
| [0006](./0006-postgres-adapter-proposed.md)       | Proposed | A repository interface and a PostgreSQL implementation for multi-user hosting                   |

New records take the next number and never rewrite an accepted one; a reversed decision gets a new
record that says so.
