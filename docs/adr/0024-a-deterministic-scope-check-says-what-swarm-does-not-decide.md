# 0024. A deterministic scope check says what Swarm does not decide

Status: Accepted. Built and tested through the check (a table of 135 rows), the status rules, the canvas, the
exports, the page and a browser. **It is a reading of words by rules, and it is not complete:** it misses other
phrasings and other languages, it reads some organisations as a person, and its cue lists were written against
tables by their own author. It is not a screen at the first step: it runs when the Decision view is read, and it
refuses nothing.

## Context

Swarm explores scenarios and does not decide: every recommendation lists the human approval it needs, and Swarm
contacts no one and executes nothing. But some questions are of a kind where a recommendation is itself the harm:
"Should we fire this employee?", "Should the bank approve John Smith's mortgage application?", "Should this patient
be admitted?". A simulated role stands for a group and not for one person, and nothing in a project knows what is
right, fair or lawful for one person. The Decision Canvas ([ADR 0023](./0023-the-decision-canvas-is-derived.md))
first flagged such matters with a few regular expressions over the question and the scenario, put a sentence in the
approvals, and left the status to the simulation, so a decision about one person could still read "Robust option",
name a preferred option and recommend going ahead. The evaluation of the AI-assisted setup had also found that those
stages have no screen of their own for such requests: when the provider did not block, every unsafe request of its
safety set was answered, the consequential ones included
([docs/production/evaluation.md](../production/evaluation.md)). The setup stages still have none: the scope check
reads the Decision view, not them.

## Decision

1. **A pure function reads the words.** `consequentialScope(question, scenario)` in
   `backend/src/decision/scope.ts`, with its word tables as data in `scope-cues.ts` and its sentences in
   `scope-words.ts`, reads the question and the scenario's decision, requested decision, system and the labels and
   descriptions of its alternatives, one clause at a time (a clause ends at a sentence, a list item, a comma or a
   word such as _if_, _because_ or _but_). It returns `{ domains, aboutIndividual, basis }`. It uses no model and no
   network, gives the same answer every time (a test runs it again and with other case, spacing and apostrophes),
   and its basis is the few words it found, never a name.
2. **Two readings, with different consequences.** A matter of employment, credit, legal, medical or safety in
   general calls only for a notice, so its cues are generous and include words for a field and for a policy
   ("recruitment", "hiring policy", "lending criteria"). A decision about one person forces a status, so it is read
   narrowly: an act of a matter (to dismiss, to approve a loan, to diagnose) and a reference to one person ("this
   employee", "these named applicants", a name after the act, "him", "my") must stand together in one clause. A
   policy, a process, a group or a market ("the credit card market") is never one person, whoever else the sentence
   mentions.
3. **A notice for any matter.** A note in the header of the Decision view that names the matters; the approval point
   `approve-qualified`, which names a reviewer for each matter (a human resources or employment-law professional, a
   credit decision-maker, a lawyer, a clinician, a safety professional) and stays open; a note on the bridge to the
   full report; and a paragraph in every export. It is there in every state of the page, a view with no comparison
   included. The status is whatever the simulation gave.
4. **A human decision for one person.** The first status rule, `individual-decision` (the table is eleven rules),
   gives `needs-human-decision` before any other rule is read, with or without a comparison. No option is named: the
   options read "Not ranked" (one that a confirmed hard constraint rules out still reads "Blocked"). The recommended
   next move is "A qualified person decides this; here is what the exploration can and cannot tell them.", with what
   the exploration can tell them (how the simulated roles responded under the stated assumptions, and what the result
   is most sensitive to) and what it cannot (what is right, fair or lawful for this person, how this person
   responds, whether a decision follows the rules that apply). The first check of the validation plan and the first
   stop condition say the same, and no view or assumption is said to reverse a choice that is not made.
5. **It is read where a recommendation is made.** The check runs when `GET /api/projects/:id/decision` is read, over
   the question and the scenario as they are then, at every read. It does not run when a project is made or in the
   Ask step, and the Ask scene reads nothing from it.
6. **It refuses nothing.** Project creation is not touched, and the picture is still shown, as exploration.
7. **A constraint adds a reviewer too.** A hard legal, regulatory or safety constraint puts the qualified-person
   approval point on the canvas whether or not the question touched the matter. The notice is about what the
   question asks, and stands only for that.

## Alternatives considered

- **A model reads the question.** It would recognise any phrasing and any language. Not chosen: rules mode must work
  end to end with no model, every other part of the canvas is built by rules and no model writes any of it, and a
  model's reading cannot be pinned by a table in a test or say which words it rested on. The check lists its cues
  instead.
- **Refuse at project creation or in the Ask step.** It would stop the question before anything is made. Not
  chosen: the check is not complete, so a refusal would block questions that only share a word (a hiring policy, a
  lender's published criteria) or an organisation's name read as a person, and would reassure about the phrasings it
  misses; the question is a scenario to explore, and what is harmful is a recommendation about one person, which the
  canvas withholds.
- **A notice for every matter and nothing more.** It is calm and is never wrong in the harmful direction. Not
  chosen for a decision about one person: the canvas would still name a leader and recommend going ahead, and a note
  beside that does not change what the page recommends.
- **A note at the Ask step.** Not done. It is possible, since the check is a pure function of the question, but
  nothing there reads it.

## Consequences

- **It misses what it has no words for.** “Is he well enough to be discharged?”, “Should I report my manager to
  HR?” and “What should we do about our employee who keeps stealing?” are not recognised, and a question in another
  language is not read; `NOT_CAUGHT` in `backend/test/decision-scope.test.ts` keeps the known misses on record.
  Then the canvas is what it was before: the status comes from the simulation.
- **It reads some things as a person that are not.** A single capitalised organisation after _hire_ or _sue_
  ("Should we hire Northwind?") and “hire a replacement for him” are read as one person. The design accepts this:
  a notice, or a human decision, that is not needed was judged to cost less than a missed decision about a person.
  The cues are listed under human approval so that a reader can see why.
- **What does not depend on the words is the approval point.** A qualified person's review is listed, and stays
  open, for every matter the check finds and for any legal, regulatory or safety constraint, and a named approver
  is always open. The status says it can be mistaken "in either direction", and the page says that the rules read
  words and are not complete.
- **The full report is unchanged.** The brief beneath the Decision view is the brief as it was written, and for a
  question about one person it may still carry its own conditional recommendation. Only the notice, the note on the
  bridge and the export's notice say that what Swarm does not decide applies to everything under it.
- **Nothing measures it well.** The cue lists were written and widened against tables of questions by their author.
  Read through the check once, outside the evaluation, the 7 consequential requests of the evaluation's safety set
  were all read as about one person (3 of 3 on dev, 4 of 4 on test), but the 3 on dev are also rows of that table and
  7 is too few to say anything about recall. The evaluation does not run it.
- **It costs a read, not a store.** It is a regular-expression pass over a bounded text (at most 2,400 characters of
  a paragraph and 80 clauses of a text are read) and is part of the canvas's own build.

## Evidence

`backend/test/decision-scope.test.ts` (a table of 135 questions: one person's matter, a policy or a group, and a
word in common, across all five matters; the basis, the same answer every time, the framing, speed on hostile text,
the section of the canvas, and the known misses), `decision-status.test.ts` (rule 1 before every other rule),
`decision-build.test.ts` (a decision about one person end to end: the status, no option named, the next move, the
approvals, the checks, the labels and the wording guard), `decision-routes.test.ts` (a real project with no
comparison, with a finished one, and a policy question) and `decision-export.test.ts` (the notice in Markdown, HTML
and JSON, and its absence where no matter is found); on the page, `frontend/src/scenes/decide/canvas/*.test.tsx`;
and in a browser, `e2e/lab/decide-canvas.spec.ts`. The specification is
[docs/analysis/decision-canvas.md](../analysis/decision-canvas.md#what-swarm-does-not-decide).
