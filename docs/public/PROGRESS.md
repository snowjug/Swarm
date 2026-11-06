# Public edition: progress

If the context of the person or agent doing this work is lost, read this file, then continue from the last phase
that is marked done. Each phase ends with an entry here and a commit.

Branch: `feat/swarm-public-edition`, from `feat/swarm-production-v1` at `3926bd9e5afb203e393d41cbbf602f21377cc7c9`.
Owner decisions are collected in [DECISIONS-FOR-OWNER.md](DECISIONS-FOR-OWNER.md).

## Phase 0: preflight

**Done**

- The tree was clean at the start. `gh` was already signed in as `snowjug`.
- Branch created. Baseline of typecheck, lint, unit tests and build written to [baseline.md](baseline.md).

**Next**: Phase 1, read and design: `DESIGN.md`, committed before any code.

**Decisions**: lint means `eslint` with `.scratch/**` ignored, because that scratch directory is not in git.

**Open issues**: the end-to-end suites were not re-run for the baseline (see baseline.md for why).
