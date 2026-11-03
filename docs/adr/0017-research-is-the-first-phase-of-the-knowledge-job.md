# 0017. Research is the first phase of the job that grounds a project

Status: Accepted. Built and tested through the whole application, with a fake web on a virtual clock, a
scripted stand-in for a model and the real job queue and storage. **Not run on the real internet, with a real
model, across two real processes or against a deployed server.**

## Context

Automatic research finds, reads and chooses sources for a question. It reads the network, so it can take
minutes, can fail halfway and must not be lost when the server restarts. The lab's comparisons are not jobs:
they run in the request process and are marked `interrupted` if it stops ([0014](./0014-scenario-lab.md)), which
is acceptable for a computation that is reproducible from its seeds and not for reading pages that may change.
The stages of the older workflow already are durable jobs, with a lease, a heartbeat, cancellation, bounded
retries and recovery ([0010](./0010-durable-jobs-leased-from-the-database.md)). A new kind of job would be
a change to `jobs.kind`, which is a database constraint, on two dialects, to run the same machinery.

## Decision

1. **Research is not a job of its own.** It is the first phase of the `knowledge` step. `POST
/api/projects/:id/research` writes a `queued` run and queues that step; the worker calls
   `ResearchService.beforeKnowledge` before the knowledge is built, which carries out the run that is waiting
   or, for a project with no evidence at all, makes one. When the run is `completed` the step goes on to build
   the knowledge as it always did. A project that has sources of its own and no run waiting is grounded exactly
   as it always was.
2. **A run that ends with nothing to use holds the stage; it does not fail it.** A run that is `blocked` (no
   search provider for a question alone, or every address refused by a rule) leaves the stage waiting, so that
   a person can name a page or a site or add sources of their own. A run that fails (the provider refused, a
   search provider that could not be reached) fails the stage, so that it can be run again.
3. **The record is an artifact written whole** ([0016](./0016-research-and-constraints-are-artifacts.md)),
   so a restart finds a state the run was in and never half of one.
4. **Pause is a gate in the process that carries the run.** The job keeps its lease while paused, so a pause
   costs no work and loses none. It is bounded (`RESEARCH_MAX_PAUSE_SECONDS`, 300 by default, 420 at most,
   because a job is held to fifteen minutes in all): a run left paused ends by itself with what it had read.
   **Finish** stops reading and goes on with what was read. **Cancel** goes through the job, ends the run and
   leaves no half-written state: the sources are appended in one transaction with the run's record.
5. **A server that stops puts a cut-off run back in the queue.** The next worker carries it out from its start;
   it is not resumed. When the server starts, a run that is not finished and has no job is marked ended (`failed`,
   or `cancelled` when its job was), so that no run stays `running`.
6. **The routes are like any other.** Looking needs `read`; starting, adding a page or a site, pausing,
   resuming, finishing and cancelling need `run`. Each is in the default-deny route table, is scoped to the
   tenant and writes an audit entry (`research.started`, `research.paused` and so on) with counts and no
   address, question or page text.

## Consequences

- Research and the graph share one job and its 15-minute hold, and a process has one worker, so a long run
  keeps every other stage of that process waiting. The queue holds at most three waiting jobs, and nothing yet
  shares the worker fairly between workspaces.
- Pause and finish act only on a run that **this process** is carrying out; sent to another instance they are
  refused with `409`. Cancel works from any instance, because it goes through the job.
- A crash costs the run's work: it starts again from its start, and a page that was read before is read again.
- A `GET` of the project's research may mark an abandoned run as ended, which is how a run that nobody carries
  out is found when no one restarts the server.
- Only a guided project can be researched. A quick project with no source is refused, because a quick run has no
  research phase.

## Evidence

`backend/test/research-service.test.ts` (the modes, the stages, the stops, the limits and determinism),
`backend/test/research-service-control.test.ts` (pause, finish, cancel, two requests at once and a server that
stops), `backend/test/research-service-hostile.test.ts`, `backend/test/research-service-model.test.ts`,
`backend/test/research-store.test.ts`, `backend/test/research-routes.test.ts` (who may call what, tenants, CSRF,
rate limits and the audit log) and `backend/test/research-manual.test.ts` (a person's own text added to a
project that research found nothing for). They read a fake web (`backend/test/support/research-web.ts`) through
the fetcher seam of `buildApp`, which only code can set. The specification of the run is
[backend/src/research/README.md](../../backend/src/research/README.md#automatic-research-for-a-project).
