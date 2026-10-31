# Scenario intake

Back to the [README](../README.md).

Intake turns an ordinary question, such as "What could happen if we raise the monthly charge from
$10 to $12 next quarter?", into a **scenario frame**: a plain structure that the person reads, edits
and keeps or throws away before anything runs. It is not written for any industry, product or place.
It reads a question. It does not run a simulation, discover stakeholders or store anything on its
own.

## The frame

The frame is `ScenarioFrame` in `shared/scenario.ts`. Every field can be edited.

| Field                                | What it holds                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `decision`                           | The decision or event being explored, in one sentence. A frame with an empty decision is refused when it is saved or sent with a new project. |
| `system`, `geography`, `horizon`     | The affected market, organisation or system, where, and over what period. Empty or null when the question does not say.                       |
| `changes`                            | The variables that change, each with a `from`, a `to` and a note. `from` and `to` are null unless the question states them.                   |
| `baseline`                           | What is expected without the change. "The current situation continues without the change." unless the question says otherwise.                |
| `alternatives`                       | Options to compare. Only those the question states, plus (rules reading only) labelled suggestions for a single numeric change.               |
| `requestedDecision`, `desiredOutput` | What the person wants to decide, and the kind of answer they want. Null unless the question says.                                             |
| `evidenceAvailable`                  | The names and sizes of the documents the person supplied. The server writes this, never a model.                                              |
| `evidenceMissing`                    | Generic kinds of evidence that would help.                                                                                                    |
| `assumptions`                        | What had to be assumed to read the question. `system` means Swarm wrote it, `user` means a person wrote or edited it.                         |
| `likelyStakeholders`                 | Generic roles or groups that the question names or implies, such as customers or regulators. Seeds for a later step, not a result.            |
| `ambiguities`                        | At most three things the question leaves open, each with one short question that would settle it.                                             |
| `origin`                             | How the first version was made: `rules` or `model`. It becomes `user` as soon as the person changes anything.                                 |

`origin` says where a version came from. It never says that the content is right.

## How a question is read

`POST /api/scenario/parse` returns `{ frame, notes, mode, model }`. `mode` is `rules` or `model`,
`model` is the name of the model that read it (or null), and `notes` is what the page shows beside the
frame.

1. **A model**, when one is configured. The server sends the question and the names and sizes of the
   documents (never their text), with instructions to stay neutral about the setting, to state no
   fact or number the question does not state, and to describe how it read the question rather than
   what will happen. The reply must pass the checks below. A reply that fails is sent back with the
   reasons, at most twice. If it still fails, or the model cannot be reached or declines, the
   **rules** read the question instead and the notes say why, with the error code.
2. **Rules**, always available. They need no network and no model, never throw, and always return a
   valid frame. The notes say "Read by rules, not a model."

Nothing is silent: a person can always tell which reader made the frame, and whether a model was
tried and failed.

### What the rules read

- An "if", "when", "after", "once", "whether" or "should" clause, as the decision or event.
- About a hundred common verbs that say something is being changed (raise, cut, add, remove, launch,
  integrate, enable, disable, replace, make the default, shut down, and so on), with their other
  forms, and the things they act on.
- Amounts with currency, percent, magnitudes and units; "from X to Y"; "by N%"; "X or Y" options.
- A place ("in a selected region", "across the country", worldwide, a large named area, a named place
  after an amount or "across") and a period ("within six months", "over the next two quarters",
  "next quarter", "by 2027").
- Groups the question names, from a small generic list of roles (customers, users, administrators,
  engineers, managers, employees, partners, suppliers, competitors, regulators, investors, analysts
  and similar), and whoever makes the change.
- Alternatives only from what the question states. When it states one numeric change, two
  alternatives (smaller and larger) are added, labelled "(suggestion)", with an assumption saying so.
- Up to three questions back, only for what is missing: what exactly changes or by how much, who or
  what is affected, over what period, and how a good outcome would be judged.

### What the rules cannot do

- They read English only. When the text does not look like English a note says so, and they still try.
- They find patterns; they do not understand. A verb outside their list gives no change (the question
  is kept as the decision and the person is asked what changes). Unusual sentence shapes, several
  interacting changes and implied changes are read badly or not at all.
- They name a place only in clear patterns. A capitalised word after a bare "in" is not taken as a
  place, because it is as likely to be a product.
- They never fill in what a variable is now ("from") unless the question says it.
- They know no industry and no product. That is deliberate: the vocabulary is generic and a test keeps
  subject-matter words out of the source.
- Nothing is checked against the world. A place is not looked up and a figure is not judged.

### What the server checks in a model's reply

- The shape: field lengths, a non-empty decision and baseline, at most three questions back, ids that
  are valid and unique within a list.
- That no text in it reads as an instruction to an AI model (the same detector that inspects documents).
- That every number in a horizon, a place or a change appears in the question.
- That a variable's `from` is one the question gives: the question has to say what something is now
  ("from", "currently", "existing", and similar) and the words have to be the question's own, or the
  `from` only restates the variable's name. Otherwise it is sent back and, if it comes back again,
  the rules read the question.

After the checks the server sets what is not the model's to say: `origin` is `model`, every
assumption is `system`, `evidenceAvailable` is the list of documents the person supplied, and the field
a question back is about is given its standard name (`horizon`, `changes`, `system`, `success`, and so
on) whatever the model called it.

These checks are about words. They cannot tell a sound paraphrase from an invention, and they cannot
check a model's claim about a baseline or a group. A model can still misread a question, so the notes
say to check every field.

## Privacy

- The question goes to the configured model provider when there is one, as every other model call in
  Swarm does. With no model configured nothing leaves the server. Do not put secrets in a question.
- The question and the text of documents are never written to the audit trail or the logs. The audit
  entry for a reading holds counts only (mode, documents, model calls, tokens, and the number of
  changes, alternatives, assumptions, stakeholders and questions). An edit records counts only too.
- A page may pass each document's name, its size and its first 5,000 characters. The start of the
  text is only inspected in memory for text aimed at an AI model, and is never stored, logged or sent
  to a model. A model is told only each document's name and size.
- Reading stores no frame and keeps no copy of the question. A frame is stored when the person uses
  it: it is sent with the project when the project is created, or saved with `PUT`. It is then a
  document of the project (kind `scenario`), removed with the project and copied to its branches.
- Text in a question that reads as an instruction to an AI model is treated as data. The rules leave
  that sentence out of the frame, a model's reply that repeats it is rejected, and a note tells the
  person. A provider's own content filter may decline a question outright; the rules then read it
  and the notes say that the provider declined. See the [threat model](./threat-model.md).

## Routes and limits

| Method | Path                         | Behavior                                                                                                                                                                                                                       |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/scenario/parse`        | Reads a question. Body `{ "question", "documents"? }`: a question of 3 to 2,000 characters and up to 10 documents (`name`, `characters`, optional `excerpt`). Stores nothing. Needs the right to create projects. 10 a minute. |
| GET    | `/api/projects/:id/scenario` | `{ "scenario", "revision" }`. A project with no scenario answers `null` and revision 0, so a page can ask without failing. Needs the right to read the project.                                                                |
| PUT    | `/api/projects/:id/scenario` | Body `{ "scenario", "expectedRevision"? }`. With `expectedRevision`, a change made on a page that is out of date is refused with 409 `ARTIFACT_CONFLICT`. Needs the right to edit the project. 60 a minute.                    |

`POST /api/projects` also accepts an optional `scenario`, checked against the same schema, and keeps
it with the project. `POST /api/projects/:id/branches` copies it to the branch. Who may call each
route is in `backend/src/auth/policy.ts`, and what is recorded is in `backend/src/auth/audit-policy.ts`.
The general table of routes is in the [HTTP API](./API.md).

Limits: the request body may be up to 300,000 bytes, and a reading makes at most three model calls
(the first reading and two repairs). The route refuses a question of more than 2,000 characters; the
parser itself reads at most 2,000 characters of whatever it is given, and says so.

Cost and time: a project does not exist yet when a question is read, so no project budget applies. What
bounds the cost is the rate limit, the three calls, and the size of the question; the audit entry
records the calls and tokens used. In a manual check a reading took 13 to 23 seconds, and 43 seconds
when a first reply had to be repaired. The page shows that it is reading and offers Cancel.

## In the page

`frontend/src/components/intake/ScenarioIntake.tsx` takes the question, the current frame (or null),
`onFrame`, `disabled` and, optionally, the documents attached so far. The person chooses "Understand
my question", sees an editable form with plain labelled fields and add and remove rows, answers or
skips the questions back, reads the notes, and chooses "Use this scenario", which calls `onFrame`.
Every step is optional, nothing is sent until the person asks, and nothing is kept until they say so.
It works with the keyboard, and does not submit the form it sits in.

## What was observed with a real model

Three runs against a deployed chat model, eight requests in all: seven were answered and one was
declined by the provider's content filter (a question with a planted instruction), which was read by
the rules with the notes shown. The first run showed what the checks above are for: a model gave a
starting value that the question never states, used its own names for the questions back, and wrote
predictions of outcomes as assumptions. The instructions and the checks were tightened. In the last
run the same question was read in one call with no starting values invented. That is one question
read once, not a measurement of how often a model does this.

## What is not done

- There is no page for editing the scenario of an existing project. The `GET` and `PUT` routes and the
  component are there for one.
- The rules read English only, and know no place, product or industry beyond the patterns above.
- A reading is not checked against the world, and the checks on a model's reply are about words.
- No budget applies to a reading, because there is no project yet; only the limits above do.
- Reading does not use the text of documents. A model is told their names and sizes only.
- Intake does not discover stakeholders, run anything or judge the question. It prepares a frame.

## Tests

`backend/test/scenario-parser.test.ts` reads a table of 36 questions (25 from different settings and 11
nonsense, very long, non-English or hostile inputs) and checks that no subject-matter word is in the
parser's source. `backend/test/scenario-model.test.ts` uses a scripted model: a valid
reply, a reply repaired after being sent back, a reply that never passes, an injection in the question,
and each failure that falls back to the rules. `backend/test/scenario-routes.test.ts` covers who may
call each route, validation, that the audit holds no question text, storage and revisions, and that
creating a project stores the scenario and a branch copies it. The page logic, the render and the client
are tested in `frontend/src/lib/intake.test.ts`, `frontend/src/components/intake/ScenarioIntake.test.tsx`
and `frontend/src/api/scenario.test.ts`. None of this is evidence about how a real model reads a
question.
