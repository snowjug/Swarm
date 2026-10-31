# 0013. A project has a model budget, held before every model call

Status: Accepted. Built; its rules, its five places of use, its routes and its access are tested and
mutation-checked, and the page is tested in a browser against the fake provider. **Not run against a live
model or a deployed pilot**, and not a per-tenant or a money budget.

## Context

The model is the one variable cost of a hosted pilot. Until now the controls were a call budget for each
operation (`maxCalls`, 16 by default), a 15-minute limit on a run, a rate limiter and a limit on projects per
tenant. None of them says how much one project may spend in all: a person who runs scenarios and rewrites
chapters, or a script that does, could spend without limit, and the first anyone would know was the invoice.
The records of use (`execution`, on the project) are the run's: they start again at zero when a run does, and
two workers writing them can lose an update, so they cannot be what a limit is held against.

## Decision

1. **The budget is the project's own, in a table of its own** (`project_usage`, migration 8, on SQLite and
   PostgreSQL). Calls that completed, and their input and output tokens, are added in the statement that adds
   them, so that concurrent workers do not lose each other's calls, and the counters never go back when a run
   starts again. The row is deleted with its project, and is copied by `db:copy` and checked by `db:drill`.
2. **Two limits, each 0 for none.** Calls and tokens. The deployment sets a default for every project
   (`PROJECT_MODEL_CALL_LIMIT`, `PROJECT_MODEL_TOKEN_LIMIT`, 0 unless set); a project may have its own, `null`
   meaning "the deployment's default" and `0` meaning "lifted".
3. **Every model is made with the project's budget.** A client reports tokens to a usage sink, and the sink may
   also refuse the next call (`admit`), which the client asks before every call, repairs included. The
   repository makes that sink (`modelUse(projectId)`), and each of the five places that make a model (a quick
   run, a stage of a guided run, an answer from the analyst or an actor, a generated interview, a chapter
   written again in the studio) is made with it, so that a way to reach the model without the budget has to be
   written on purpose. Each is tested to hold the budget of its own project and of no other.
4. **A refusal is a refusal.** `PROJECT_BUDGET` (HTTP 429, no `Retry-After`: waiting does not help) stops the
   operation like any other failure that does not pass. It is never repaired, never retried by the queue, and
   sends no request to the provider. The stage that stopped is run again, from its last saved round if it is a
   simulation, once the limit is lifted. The audit log hears of it once for each client, with counts and no
   actor: `model.budget.exhausted`.
5. **Who sets it.** Anyone who can read a project sees what it has used. Only a workspace owner or
   administrator changes the limits: a new capability, `budget`, which no project role holds, a lead
   included, so that the person who runs the work is not the one who lifts the limit on it. A change is
   audited with the numbers: `project.budget.changed`.
6. **The page says it before it is asked.** A project that is running low (four fifths of a limit, the worse of
   the two) or has used up its budget says so above the work, in words and not by colour alone, and says what
   stops and what does not. Reading, editing and exporting never use the model and are never affected.
7. **The pilot sets a default**: 1,500 calls and 4,000,000 tokens a project (`projectModelCallLimit`,
   `projectModelTokenLimit` in `infra/pilot`), about seven demonstration scenarios and, at the price of the
   existing deployment, a few US dollars at most.

## Consequences

- A call is counted when the provider answers, whatever the answer turns out to be: one that is then refused,
  cut short or fails validation and is repaired used tokens, and counts. One that never gets an answer (the
  network, a timeout, a rate limit, a server error) does not. A token limit is known only then, so the call
  that crosses a limit is the last one, calls already in flight may finish over it, and a round that asks for
  several calls at once may go a few over. This is a guard against a project that runs away, not a meter that
  bills to the call.
- It is per project. There is no workspace or tenant total, no limit per day, no alert (only the audit entry and
  the warning on the page) and no money: tokens are not priced, because the price belongs to the deployment.
- A branch is a project with a budget of its own, so a person with several branches has several budgets. A
  tenant that must be held to a total needs a workspace budget, which does not exist.
- It does not limit the rules engine, which makes no model call, or any other cost of the pilot.

## Evidence

`backend/test/usage.test.ts` (the counters, the limits and where they come from, the boundary of each, the audit
entries), `backend/test/model-budget.test.ts` (the client is asked and sends nothing once refused; the five
places each hold their own project's budget; a whole run is stopped, says why, and carries on when the limit is
lifted), `backend/test/budget-routes.test.ts`, `backend/test/membership.test.ts` (every role, the capability, and
who is told they may), `frontend/src/lib/budget.test.ts`, `frontend/src/components/console/BudgetDialog.test.tsx`,
`e2e/model/budget.spec.ts`, and 17 mutations of its rules (`npm run mutation:security -- --area=budget`), each of
which a test catches.
