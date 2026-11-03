# 0019. One output policy for what a model's reply may become

Status: Accepted. Built for three steps: the participants (a proposal and the regeneration of one), the
constraints and the planning of a research run. The older steps that ask a model for JSON are not moved to it.
Tested against scripted stand-ins and against an in-process fake of the Foundry endpoint. **Never run against a
live model**, so how often a real model's reply passes is unmeasured.

## Context

Every step that asks a model for structured data had its own way of dealing with a reply that is wrong:
bounded repairs in the client (`jsonValidated`), its own checks, and its own choice between a failure the
person sees and an answer from the rules. For the steps added for the pilot one rule was wanted, so that a
reviewer can check it once: what a model's reply may become, what happens when it cannot be used, and what is
never hidden.

## Decision

1. **A step asks through `runStructuredTask`** (`backend/src/models/task.ts`). A task names its **role**
   and never a model, a versioned name (`participant-proposal.v1`, `participant-regeneration.v1`), the schema
   a reply must fit, trusted `instructions`, `data` that is untrusted and is labelled so by the gateway, an
   optional server-side `validate` (references, bounds and uniqueness, and for the constraints an echo of an
   injected payload) and a `fallback`: the answer the rules give for the same input.
2. **A reply is checked twice.** The schema and `validate` are handed to the client as the repair hook, and
   the policy checks the value it keeps again itself, so a gateway that skipped a check cannot let a reply
   through. A reply that fails is never repaired by hand and never read by pattern: it is valid or it is not
   used.
3. **One correction round** (`TASK_REPAIRS = 1`), as the product rule says: retry once, then fall back.
4. **Then the rules answer, and the reason is recorded without the model's words.** The result says whether it
   came from the model or from the rules, and when a model was asked and could not be used it carries a failure:
   a code (`MODEL_OUTPUT_INVALID`, `MODEL_TIMEOUT`, `MODEL_RATE_LIMIT`, `MODEL_AUTH`, the budgets and so on) and
   a fixed sentence for that class, such as "The model did not answer in time, so rules were used." The
   fallback must itself pass the schema and the checks, or it is refused too.
5. **Three things are never answered from rules**: a provider's refusal (`MODEL_REFUSED`), a cancelled run
   (`RUN_CANCELLED`) and a client that has left (`CLIENT_DISCONNECTED`). Answering from rules would hide that a
   person or a safety rule said no.
6. **With no model the rules answer and nothing is asked.** The rules' answer is held to the same schema and
   the same checks as a model's, and carries no failure, because none was asked.
7. **The task runner is a layer above it, and is a separate decision.** The router, the allowances, the cache and
   the failover are in `models/runner.ts` and call `runStructuredTask` ([0020](./0020-the-foundry-provider-on-the-v1-api.md)).
   Only the planning of a research run goes through the runner today. Participants and constraints call
   `runStructuredTask` directly and are sent to the default deployment.

## Consequences

- Two ways to ask a model remain, `runStructuredTask` and `jsonValidated`, and the older steps keep their own
  rules or their own visible failure. [Foundry models](../models/foundry.md#where-it-is-used-today) has the table
  of which step uses which. Moving the rest is a change of behaviour for each, and is not done.
- A good reply with one bad field costs a correction, and then the whole answer is the rules'. There is no
  partial salvage here, unlike the repairs that only remove, shorten or weaken in the report's grounding.
- The checks show that a quote exists in the passage it names, not that the passage supports the statement. A
  scripted reply that attached a real quote from another passage was accepted in the evaluation (0 of 12 caught
  for each of participants and constraints).
- The roles `extraction`, `critic` and `synthesis` have settings and no caller.
- A model critique, which does not use this policy, is held to forecast and certainty wording only by its
  prompt: a scripted critique saying a change "will certainly fail" was accepted (a limit the evaluation recorded).
- The person sees why: a participant set, a constraint set and a research plan say that the rules were used and
  give the sentence for the class of failure.

## Evidence

`backend/test/model-task.test.ts` (no model: rules and no failure; a valid reply and exactly one correction; the
policy checks again itself; the server-side validator; a refusal and a cancellation are never answered from rules;
a rules answer that fails its own checks is refused), `model-runner.test.ts`,
`participants-model.test.ts`, `constraints-discovery.test.ts`, `constraints-hardness.test.ts`,
`research-plan.test.ts` and `research-service-model.test.ts` (each step with a scripted model), and
`evaluation/test/ai-fake-foundry.test.ts` (the real client and the policy against corrupted replies, in the
`fake-foundry` mode of `npm run eval:ai`: every rules answer that stood in for a model that failed passed the
schema, 167 of 167). Not measured: the schema-valid rate of a live model after one correction
([docs/production/evaluation.md](../production/evaluation.md)).
