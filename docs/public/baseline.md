# Baseline before the public edition

Taken on branch `feat/swarm-public-edition` at its base commit `3926bd9e5afb203e393d41cbbf602f21377cc7c9`
(the head of `feat/swarm-production-v1`), before any change. Whatever fails here is **pre-existing** and is not
caused by the public edition.

The machine is a shared 4 vCPU / 16 GB VM that other people's jobs were also using (load average 11 to 17), so
the timings below are slow and a test that measures time can fail for that reason alone.

| Check     | Command                            | Result                                                       |
| --------- | ---------------------------------- | ------------------------------------------------------------ |
| Install   | `npm install --no-audit --no-fund` | No change: the lockfile and the tree stayed clean            |
| Typecheck | `npm run typecheck`                | Pass (exit 0, 2 m 44 s)                                      |
| Lint      | `npm run lint`                     | Fails on `.scratch/**` only; clean once that is ignored      |
| Unit      | `npx vitest run`                   | 344 of 345 files pass; 8,848 tests pass, 2 skipped, 1 failed |
| Build     | `npm run build`                    | Pass (exit 0, 39 s)                                          |
| E2E       | not re-run for the baseline        | See below                                                    |

## Lint

`npm run lint` exits 1 with 725 problems, **all** under `.scratch/**`. That directory holds scratch files and is
excluded from git (`.git/info/exclude`), so it is not part of the repository. Without it the lint is clean:

```bash
npx eslint . --ignore-pattern ".scratch/**" --ignore-pattern "frontend/dist/**" --max-warnings 0
```

That command is what "lint" means for the rest of this work.

## Unit tests

One test failed in the full run, and passes when it is run alone (13 of 13):

- `backend/test/stakeholders-speed.test.ts`: "keeps a project of ten full documents, a graph of forty people and
  organisations and twenty named groups to a few …". It asserts a time, and the machine was busy.

The full run took 11 m 31 s here; it takes about 5 minutes on an idle machine.

## End-to-end

The Playwright suites take between 8 minutes and about an hour each on this machine, so they were not run again for
the baseline. Their results at this same commit come from the verification of the previous piece of work:

| Suite                        | Result at `3926bd9`                                     |
| ---------------------------- | ------------------------------------------------------- |
| Production journey           | 22 of 22                                                |
| Playwright `model`           | 52 of 52                                                |
| Playwright `lab`             | 610 of 614; 4 pre-existing failures (below)             |
| Playwright `local` (partial) | 142 of 142 for the provider panel, shell, accessibility |

The four known failures in the `lab` suite fail on the older commit `bf7da24` as well:

- `ask-composer.spec.ts` lines 174, 852 and 941 (the Ask screen)
- `ground.spec.ts` line 1257 (Ground on a phone: head room of the synthetic samples)

Phase 8 of this work runs the suites again and compares with this list.
