# Release and rollback

> **Status: authored offline and exercised only against a fake `az`.** `npm run azure:release` and
> `npm run azure:rollback-drill` have never touched Azure, because no Azure authorization exists on the machine they
> were written on. **The rollback drill has NOT been executed live. Nobody may say that rollback works until the owner
> has run it and kept the record** ([The rollback drill](#the-rollback-drill)). Every statement below about what Azure
> does is marked **UNVERIFIED** where it is a claim about Azure's behaviour rather than about this repository's code.

This is how a new version of the **controlled pilot** reaches the hosted app, and how it is taken back. It is for the
Container Apps app that [`infra/pilot`](../../infra/pilot/main.bicep) creates. Deployment is an **owner action**: no
workflow in this repository deploys, releases or holds a credential, and both commands refuse to run live when the `CI`
environment variable is set (to anything but empty, `0` or `false`).

## Contents

- [The model in one picture](#the-model-in-one-picture)
- [Rules the tooling enforces](#rules-the-tooling-enforces)
- [Releasing](#releasing)
- [The release record](#the-release-record)
- [Canary, promote, finalize](#canary-promote-finalize)
- [Rolling back](#rolling-back)
- [Database schema changes](#database-schema-changes)
- [Two revisions, two job runners](#two-revisions-two-job-runners)
- [The first release](#the-first-release)
- [The rollback drill](#the-rollback-drill)
- [What is unverified](#what-is-unverified)

## The model in one picture

```
 commit 3f9c…(40 hex)                         az acr build                     tag swarm:3f9c…  (locked: read-only)
        │                                           │                                   │
        └── working tree is clean and == HEAD ──────┴──▶ image, identified by DIGEST ◀──┘
                                                                  │
   revision r3f9c…  (new, 0% traffic) ◀── az containerapp update --image <registry>/swarm@sha256:… --revision-suffix r<12 hex>
        │  Running? ready on its own address? ──▶ shift: new 100% / previous 0% ──▶ smoke test ──▶ record
        │                                                         │ fails
        │                                                         └──▶ traffic back to the previous revision, by itself
   previous revision (warm: still running at 0%) ── the rollback target for the warm window (default 4 h) ──▶ finalize
```

- **The image tag is the commit.** `swarm:<40-character commit hash>`, never `latest`. The tag is **locked** in the
  registry (`--write-enabled false --delete-enabled false`) so that a commit hash keeps meaning one image. The app is
  told to run the image **by digest** (`<registry>/swarm@sha256:…`), so what runs cannot change under the same name.
- **A release is a new revision.** The app runs in `activeRevisionsMode: Multiple` ([`infra/pilot`](../../infra/pilot/modules/container-app.bicep)
  sets it). A new revision starts beside the serving one and takes **no traffic** until it has proved itself.
- **A rollback is a traffic change**, as long as the previous revision is still running (warm). After `finalize` it is
  stopped, and going back to it is a _start_, which takes longer ([Rolling back](#rolling-back)).
- **Everything is dry-run by default.** Without `--execute` the tools read Azure and print the exact commands they would
  run. Nothing else.

## Rules the tooling enforces

| Rule                                                                                                                               | Where it is tested                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| No `--execute` means no change: every mutating command is printed, none is run, and no record is written                           | `release-flow.test.ts`, `drill-flow.test.ts` ("a dry run is the default") |
| A live run needs `--execute` **and** `--confirm-resource-group <the group's exact name>`, checked before any call                  | `release-flow.test.ts`, `drill-flow.test.ts`                              |
| A live run is **refused when `CI` is set** (anything but empty, `0` or `false`): deploying is not something a pipeline may do here | the same files                                                            |
| `--subscription <guid>` is required; the CLI's default subscription is never used                                                  | `release-flow.test.ts` ("requires an explicit subscription")              |
| The subscription must pass the same naming guard as provisioning, and the group must carry the tag `app=swarm-lab`                 | `release-flow.test.ts`                                                    |
| The app must be in multiple-revision mode and `Succeeded`                                                                          | `release-flow.test.ts`                                                    |
| Building needs a clean working tree that **is** `--commit` (HEAD); otherwise `--skip-build` and an image that exists               | `release-flow.test.ts`                                                    |
| A commit whose schema is **older** than the database's is refused (no build can use it)                                            | `release-flow.test.ts` ("schema migrations only go forward")              |
| A commit that carries a migration is refused until `--accept-schema-change` is given                                               | the same describe block                                                   |
| Traffic that is split or unset is refused: finish or roll back the release in progress first                                       | `release-flow.test.ts`                                                    |
| A release record that does not hold together (not a commit hash, not a digest, a credential-shaped value) is **not written**       | `release-flow.test.ts` ("the release record")                             |

The exit code of both commands: **0** done (or a dry run); **1** a step failed, the release was rolled back, or a drill
criterion failed; **2** refused or misused before anything was changed (and "`az` is not installed").

## Releasing

Prerequisites: [the first-deploy sequence](./azure-preflight.md#what-the-owner-must-do) is done; `az login` as a person
(or identity) holding **Contributor** on the resource group and **AcrPush**/build rights on the registry; Node 24 and a
clean checkout of the commit to ship; the previous release, if any, is `finalize`d or rolled back.

```bash
# 1. See what it would do. Reads Azure; changes nothing; writes no record.
npm run azure:release -- release \
  --subscription <guid> --resource-group <group> --app <container app> --registry <registry name> \
  --current-schema-version <n>          # only when no earlier release record exists on this machine

# 2. Do it.
npm run azure:release -- release  …the same…  --execute --confirm-resource-group <group>
```

What a live release does, in order (each step is written into the record as it happens):

| #   | Step                | Command (abridged)                                                                                                  | If it fails                                                                            |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Read and refuse     | `az account show`, `az group show`, `az containerapp show`, `az containerapp revision list`                         | Nothing was changed                                                                    |
| 2   | Build               | `az acr build --registry … --image swarm:<sha> --file Dockerfile .`                                                 | Nothing serves it                                                                      |
| 3   | Read the digest     | `az acr repository show … --query digest`                                                                           | Refused: "no image swarm:<sha>"                                                        |
| 4   | Lock the tag        | `az acr repository update … --write-enabled false --delete-enabled false`                                           | The tag stays writable; the record says `tagLocked: false`                             |
| 5   | Pin traffic         | `az containerapp ingress traffic set --revision-weight <serving>=100` (only if traffic named "the newest revision") | Nothing else has run yet                                                               |
| 6   | Create the revision | `az containerapp update --image <registry>/swarm@sha256:… --revision-suffix r<12 hex>`                              | Nothing serves it                                                                      |
| 7   | Wait                | polls `az containerapp revision list` up to `--ready-timeout-minutes` (default 10)                                  | The new revision is **deactivated**; traffic never moved                               |
| 8   | Prove it dark       | `GET https://<revision address>/api/health/ready` while it has 0% (`--no-revision-precheck` skips)                  | The new revision is deactivated; traffic never moved                                   |
| 9   | Shift               | `az containerapp ingress traffic set --revision-weight <new>=100 <previous>=0`                                      | Traffic stays where the failed command left it: run `status`                           |
| 10  | Smoke test          | the existing [`pilot-smoke`](../azure/pilot-plan.md) checks against the public address                              | **Traffic goes back to the previous revision by itself** (unless `--no-auto-rollback`) |
| 11  | Record              | writes `.azure/releases/<id>.json`                                                                                  | the record is written first as `in-progress`, so a crash leaves evidence               |

A first step that must not be skipped when reading the output: **a failed smoke test exits 1 and says the release was
rolled back**. A passing one prints when the previous revision's warm window ends.

`--skip-build` releases an image that is already in the registry for that commit (a re-run after a failure; a commit
built elsewhere). `--commit <sha>` names the commit; building needs it to be HEAD.

## The release record

`.azure/releases/<UTC time>-<12 hex>.json`, written locally (`--record-dir` changes it), **git-ignored** and mode `0600`.
It is the only evidence of what ran, so **copy it to wherever the change is tracked**. Fields:

| Field                                                             | Meaning                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit.sha`, `commit.shortSha`                                   | The commit that was built, in full                                                                                                                                                                                        |
| `image.tag`, `image.digest`, `image.reference`, `image.tagLocked` | `swarm:<sha>`, the content digest, the reference the app runs (by digest), and whether the lock took                                                                                                                      |
| `revision.name`, `revision.suffix`, `revision.trafficWeight`      | The new revision and the share it holds when the record was last written                                                                                                                                                  |
| `lastKnownGood`                                                   | The revision that served all traffic when the release began, its image, and why it is the rollback target. `null` on a first release                                                                                      |
| `migrations`                                                      | Schema version before and after, the migrations applied, whether the person accepted them, and **the restore point** (a UTC time, taken before the release) when migrations came with it                                  |
| `config`                                                          | CPU, memory, replica bounds and the environment **by name**: values only when they are not credential-shaped; a Container Apps secret reference by its secret name; anything that looks like a secret is `redacted: true` |
| `smoke`                                                           | Each smoke check, its status and detail, and the address it ran against                                                                                                                                                   |
| `warmWindow`                                                      | When the previous revision may be retired (`deactivateAfter`)                                                                                                                                                             |
| `steps[]`                                                         | Every command in order with its time and outcome: the exact `az` arguments (never a secret)                                                                                                                               |
| `rollbacks[]`                                                     | Each rollback: when, to which revision, on what basis, whether it was cold, whether the smoke test passed                                                                                                                 |
| `rollback.command`                                                | The command that goes back                                                                                                                                                                                                |

The record never holds a secret: environment values are redacted by **name** (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`,
`CONNECTION_STRING`, …) and by **shape** (JWTs, `Bearer`, URLs with credentials, `InstrumentationKey=`, SAS signatures),
and `validateRecord` refuses to write one that still contains such a shape (tested). Application Insights connection
strings therefore appear as `redacted: true`.

## Canary, promote, finalize

- **Canary.** `--canary-percent 10` sends 10% of requests to the new revision and stops. Nothing is smoke-tested yet
  (the share is too small to prove anything); watch the dashboard ([observability.md](./observability.md)), then:
  `promote` (moves everything, runs the smoke test, goes back by itself if it fails) or `rollback`.
- **Warm window.** After a promotion the previous revision keeps running at 0% for `--warm-hours` (default 4), so that
  rolling back is a traffic change. A replica of 0.5 vCPU / 1 GiB that serves nothing is billed at the idle rate,
  0.5 × 0.000003 + 1 × 0.000003 = US$0.0000045 a second = **US$0.0162 an hour** (US$0.065 for four hours), and at most
  0.5 × 0.000024 + 1 × 0.000003 = US$0.000015 a second = US$0.054 an hour if it were busy (list prices,
  [azure-preflight.md](./azure-preflight.md#unit-prices); free grants ignored; whether a warm revision at 0% is billed as
  idle is **UNVERIFIED**).
- **Finalize.** `finalize` deactivates the previous revision after the window (or at once with `--force`). It refuses
  while the new revision is not the only one serving. After it, the rollback target is _cold_.

## Rolling back

```bash
# Dry run first (omit --execute): shows which revision it would return to and the exact commands.
npm run azure:release -- rollback --subscription <guid> --resource-group <group> --app <app> \
  --execute --confirm-resource-group <group>
# A specific revision (not the one in the record): --to <revision name>
```

It returns traffic to the **last known good** named in the latest release record (or `--to`), then runs the smoke test,
records the rollback, and **exits 1 if the revision it returned to is not healthy either** ("escalate").

- **Warm** (the previous revision is still running): one `az containerapp ingress traffic set`. This is the path the
  warm window exists for.
- **Cold** (it was deactivated by `finalize`): the tool runs `az containerapp revision activate`, waits for it to run,
  then shifts. **That is a start, not an instant switch**: the time is whatever Azure takes to start a replica and pass
  the probes, which has not been measured ([`--cold` drill](#the-rollback-drill) measures it).
- **If the tool itself is the problem**, the one command that goes back is plain `az`:

  ```bash
  az containerapp ingress traffic set --name <app> --resource-group <group> --subscription <guid> \
    --revision-weight <last known good>=100 <bad revision>=0
  # cold target: az containerapp revision activate --revision <last known good> …  first, and wait until it runs
  ```

A rollback of the **image** is not a rollback of the **database**: see below.

## Database schema changes

The application migrates its database **at startup** with its own connection (`migrate()` in
`backend/src/storage/migrations.ts`; the schema version is one row in `swarm_schema`). Properties that matter here, all
from the code, none from a deployed system:

- Migrations **only go forward** and are written to be additive. An image that finds a database **newer** than it knows
  **refuses to start** (`STORAGE_VERSION`). So a rollback across a migration can leave the previous image unable to
  _restart_, although while it stays up it keeps working with the additive schema.
- On PostgreSQL an advisory lock makes replicas that start together take turns, so two revisions starting is safe for the
  migration itself.
- A failed step rolls back its own transaction ("the database is unchanged").
- **PostgreSQL takes no copy before an upgrade** (only a SQLite file does). The point-in-time restore is the way back.

What the tool does about it:

1. It compares the schema version in the commit's `migrations.ts` with the one in the **last release record** (or
   `--current-schema-version`). If it cannot tell, it **refuses** rather than guess.
2. If migrations come with the release it **refuses until `--accept-schema-change`**, and records the **restore point**
   (the UTC time just before the release) so that a point-in-time restore has a target.
3. A **rollback across a migration** is refused until `--accept-schema-change` (or `--to` is named): read
   [the runbook](./runbook.md#restore-the-database-to-a-new-server) first, because the previous image may refuse to
   _restart_ against the newer schema.

Before a release that carries a migration, **write down the time and check the restore capability** (the runbook says
how). That the PITR restore works has **not** been rehearsed.

## Two revisions, two job runners

The embedded job runner (`SWARM_ROLE=all`) runs in **every active revision**, so during the warm window both the new and
the previous revision claim jobs. Facts from the code (`backend/src/storage/jobs.ts`): a job is claimed by one atomic
update with a lease; a worker that loses its lease cannot write a result; any worker claims any due job of any kind.

The risk this leaves, **not tested anywhere**: the _previous_ build may claim a job that the _new_ build created and
run it with old code (a job kind or a column it does not know). With additive migrations that should degrade to a failed
and retried job, not a corrupt one, but that is reasoning, not evidence. What to do: keep `--warm-hours` short for a
release that carries a migration, `finalize` as soon as the smoke test and the dashboard are good, and never run a drill
(which adds a third runner) during a warm window (the drill refuses to).

## The first release

The first deployment of `infra/pilot` starts a **placeholder image** (a public Microsoft sample on port 80, without
probes). The first `release` replaces it: there is **no last known good and nothing to roll back to**, no schema flag is
needed (the database is empty), and a failing first smoke test exits 1 without an automatic rollback. The tool says so.

## The rollback drill

**This drill has not been run.** `scripts/azure/rollback-drill.ts` exists, is dry-run by default, and passes against a
fake `az`. The numbers a real run would produce (how long the control plane takes, whether the warm revision drops a
request) are exactly what is unknown. **Run it before any real data is entrusted to the deployment**, and again after
any change to the ingress, the revision mode, the probes or the container app module.

**What it does** (live, same explicit flags as a release):

1. Refuses unless exactly one revision is active, serving 100%, `Running`, with a replica (so it measures a known state),
   and the app is not on the placeholder image.
2. Runs the smoke test (the baseline). Stops, having changed nothing, if it fails.
3. Creates `<app>--drill<UTC YYMMDDHHMMSS>`: **the same image as the serving revision** plus one environment variable,
   `SWARM_DRILL_ID`, that the application does not read. No new code is deployed. Waits for it to run, then checks
   readiness on its own address at 0% traffic.
4. Shifts traffic to it, then polls `/api/health/ready` on the public address once a second for `--observe-seconds`
   (default 45) and counts failures.
5. **Rolls back** (`traffic set <previous>=100 <drill>=0`), timing how long the control plane takes to show it
   (limit `--rollback-deadline-seconds`, default 60), polls readiness for another `--observe-seconds`, and runs the smoke test.
6. With **`--cold`**: shifts to the copy again, deactivates the previous revision (what `finalize` does), reactivates
   it, times how long it takes to run, rolls back to it, and smoke-tests. This is the slow way back, and its time is the
   number to know.
7. Deactivates the drill revision, reads back that the previous revision serves everything, writes
   `.azure/drills/drill-<time>.json`.

If anything fails part-way it puts traffic back on the previous revision and stops the copy when that is safe; if it
cannot (for example, a retired revision that will not restart), it **leaves traffic where it is** (on the copy, which is
the same image) and prints the commands to finish by hand.

**Pass criteria** (all must hold; each is a row in the record with its measurement):

| Id                               | Criterion                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseline-smoke`                 | The smoke test passed on the serving revision before anything changed                                                                                               |
| `drill-revision-ready`           | The copy started and answered readiness on its own address while it had no traffic                                                                                  |
| `shift-continuity`               | At most `--max-failed-polls` (default **0**) failed readiness polls in the window after the shift                                                                   |
| `previous-revision-warm`         | The previous revision stayed active, `Running`, with ≥ 1 replica after the shift and after the rollback                                                             |
| `rollback-time`                  | The control plane showed the previous revision at 100% within `--rollback-deadline-seconds` (default **60**) of the command being issued, command duration included |
| `rollback-continuity`            | At most `--max-failed-polls` failed readiness polls in the window after the rollback                                                                                |
| `smoke-after-rollback`           | The smoke test passed after the rollback                                                                                                                            |
| `cleanup`                        | The copy is deactivated and the previous revision serves all traffic                                                                                                |
| `cold-rollback-ready` (`--cold`) | A deactivated previous revision was started and ran within `--ready-timeout-minutes`; the seconds are recorded                                                      |
| `cold-rollback-smoke` (`--cold`) | The smoke test passed after the cold rollback                                                                                                                       |

**What a pass does not prove.** A readiness poll does not say _which_ revision answered, so the drill shows that the app
stayed available through the shift and the rollback and that the control plane agrees where traffic is; it cannot show
which revision served a given request. It runs the same image twice, so it does not test a rollback across a code or
schema change. It runs against an idle app with one caller; under load, in-flight requests on the revision losing
traffic are not measured. A pass means: _on this date, with this image, the mechanism worked once._

**Drill log** (the owner fills this in; an empty table means the drill has not been run):

| Date (UTC)  | Image digest | Warm drill | `--cold` drill | Seconds (control plane / cold start) | Record kept at |
| ----------- | ------------ | ---------- | -------------- | ------------------------------------ | -------------- |
| _never run_ |              |            |                |                                      |                |

The same applies to the **database restore drill**, which has also not been run: [runbook.md](./runbook.md#restore-the-database-to-a-new-server).

## What is unverified

Everything below is a claim about Azure, not about this repository's code. Each is a reason the drill exists.

- That `az containerapp update` in multiple-revision mode with **explicit** traffic leaves traffic where it is when it
  creates a revision (the tool pins first for the case where traffic named "the newest revision", and a test shows it
  does).
- That a revision's **own address** (`<revision>.<environment domain>`) answers while the revision has 0% traffic, and
  that the health routes answer for that `Host` (they answer for any `Host` in the application's code; the ingress is the
  question). `--no-revision-precheck` skips the step, leaving the smoke test and the automatic rollback.
- That `az containerapp ingress traffic set` is immediate, and that a revision with traffic cannot be deactivated (the
  tool never tries).
- That a deactivated revision can be activated again, how long that takes, and that traffic weights may name only
  active revisions.
- The behaviour of the CLI itself: argument names (`--revision-weight`, `--revision-suffix`, `--set-env-vars`), JSON
  shapes (`properties.runningState`, `properties.healthState`, `properties.replicas`, `properties.fqdn`), and output of
  `az acr repository show --query digest`. They follow the documentation as remembered; the parser treats a missing
  field as "unknown" and does not act on it.
- That ACR lets a tag be locked on the registry SKU in use, and that `az acr build` from a working tree with the repo's
  `.dockerignore` produces the image the Dockerfile describes. The build context is the **working tree**, not
  `git archive`: tracked files are checked clean, ignored files are kept out only by `.dockerignore`.
- Build cost: ACR Tasks bills "Task vCPU Duration" at US$0.0001 per vCPU-second (list price, `centralindia`, fetched
  3 November 2026); a five-minute build on an _assumed_ 2 vCPU agent is 300 × 2 × 0.0001 = **US$0.06**, a free tier
  exists that was not sized, and the agent size and build time are not known. It is not in the monthly estimate.
