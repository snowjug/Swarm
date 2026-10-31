# Copilot in Teams

> What could happen if Microsoft integrates Copilot more deeply into Teams and enables additional AI
> capabilities by default?

An invented professional-services firm of about 4,200 employees prepares for a hypothetical change:
more assistant features in its chat and meetings app, switched on by default. The evidence is five
short documents. Microsoft, Copilot and Teams are named only because the question names them; the
premise is hypothetical and nothing here describes a real plan.

Back to the [example scenarios](../README.md). The text the picker loads is in
[`shared/examples/copilot-in-teams.ts`](../../../../shared/examples/copilot-in-teams.ts), and the
files in this folder are readable copies of it.

## The evidence

| File                                                                   | What it is                                                               | Why it is in the pack                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [01-it-office-brief.md](./01-it-office-brief.md)                       | The firm's IT office: the premise, how the app is used, what was raised  | Context that names many roles in ordinary sentences, with an open licence question and a review date     |
| [02-admin-poll-summary.md](./02-admin-poll-summary.md)                 | A self-selected poll of 212 administrators                               | Numbers with their own caveats: who answered, who is over-represented                                    |
| [03-pilot-and-helpdesk-summary.md](./03-pilot-and-helpdesk-summary.md) | An eight-week pilot on 600 seats and its effect on the helpdesk          | Usage and ticket figures, and a short list of what the pilot left out                                    |
| [04-security-and-records-note.md](./04-security-and-records-note.md)   | Security reviewers and the records manager on what worries them          | The risk note: oversharing, retention, guest consent, steering by shared content, regulators             |
| [05-partner-and-market-notes.md](./05-partner-and-market-notes.md)     | A managed-service partner's figures and an analyst's note on competitors | Figures that disagree with the poll and the pilot, and a plain statement of what the pack does not cover |

## Built in on purpose

**Two source conflicts** that the evidence ledger flags (a test pins them):

- The poll says 44% of administrators would turn new features off by default until a review was
  finished. The partner says 16% of its client tenants did. One is a stated intention among
  self-selected forum readers, the other is observed behaviour in about 60 tenants.
- The pilot reached 41% weekly use of the meeting recap feature. The partner reports 68% in its
  early-adopter tenants, which it chose itself and which are mostly technology companies.

**Tensions only a reader will notice.** The security reviewers read the documentation as saying that
permissions are respected, and a pilot ticket still describes a recap that referred to a folder the
employee never opened. The poll puts written AI policies at 37% of organisations; the partner says
few of its small clients have one. Time saved is self-reported, and nobody measured it.

**Evidence gaps the brief should show as uncertainty:** no licence terms for features that arrive by
default (so finance cannot say who pays, or whether people without a licence would see anything); no
figures for frontline or shift workers; no regulator or works council position; no record of how
external guests reacted; recap quality never compared with a human record; steering by shared content
never tested; nothing about what the platform vendor actually intends. Check on your run that the
brief shows them, and say so if one is missing.

**Open points in the question itself.** The question does not say for whom "by default" applies,
how deep "more deeply" is, over what period, or what counts as a good outcome. The intake step
should raise these as questions to answer, not fill them in silently.

Roles you can expect discovery to find and cite, depending on the mode: administrators, the security
team and reviewers, the records manager, the helpdesk and support teams, department managers, power
users, employee representatives, the finance team, clients and external guests, the managed-service
partner, rival suites, internal auditors, the data protection officer, regulators and analysts.
Rules mode reads for generic role words and will find fewer and plainer ones than a model.

Alternatives worth adding by hand if the form has none: switched on only for people who already have
the assistant; a staged rollout that starts with volunteers; per-feature switches with a notice
period; left off by default.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** Entry page, **Try an example**, **Copilot in Teams**. Say: "Swarm
explores scenarios. It does not guarantee or precisely predict real-world behavior. This question is
about a deeper, default-on assistant in a chat and meetings app. Everything in it is invented: five
short documents about an imaginary firm, each labelled synthetic." Point at the question and at the
document list: sample provenance, licence `Synthetic, CC0`.

**0:30 The question (40 s).** **Understand my question**. Say: "It reads my question into a form I
can edit before anything runs." Point at the changed variable, the baseline, and the assumptions
with their origin. Read the open points it raises; this question leaves open for whom the default
applies and over what period. Answer one, then **Use this scenario**.

**1:10 The evidence (30 s).** **Build Graph**. Open the poll document and its chip. Say: "Every
passage keeps its source. The ledger later compares sources and shows where they disagree."

**1:40 Stakeholders and actors (60 s).** **Env Setup**, **Find stakeholders**. Point at the note on
how they were found (rules or model), a few cited quotes, the uncertainty chips, and the prompt about
roles nobody was found for. Say: "These are discovered from the evidence, with the passage shown.
They are roles, not people." Then **Approve stakeholders and create actors** and point at one trait
with its origin badge: "Every number the actors run on says where it came from."

**2:40 Compare scenarios (60 s).** **Simulation**, **Compare scenarios**. Point at the baseline and
the proposed change side by side, the spread across the seeded runs, and one finding with how often it
held ("N of 30 seeded runs") and its stability chip. Say: "A single run is never the answer. This is
a count of simulated runs, not a rate in the real world." Point at the sensitivity view and the
assumption with no evidence behind it.

**3:40 The decision brief (50 s).** **Report**, **Generate decision brief**. Read the executive
answer and its origin chips, then the evidence base: two source conflicts. Open one (44% against 16%)
and say: "Two sources disagree. Swarm shows both quotes and does not pick one." Then show the
uncertainty section and the validation plan: one experiment, what to measure, what would count as a
signal.

**4:30 One objection (20 s).** In the independent review, run it and read one objection with its
basis. Say: "A critic challenges; it never edits the analysis. I can respond, accept or dispute, and
the disagreement stays visible."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table, and a plan to
check them. It supports a person's analysis. It does not make the decision."

## Ten-minute script

The five-minute script, slower, with the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "The real names are in the question only because the question
names them. The documents describe an invented firm and a hypothetical change." Open the IT office
brief and read the premise paragraph aloud.

**1:00 to 2:30 The question and the scenario.** Edit one field of the scenario form (the horizon, or
the baseline wording) and point at the label that shows you changed it. Add one alternative by hand:
for example, default-on only for people who already have the assistant. Say why: "The alternatives
are what we compare against the baseline, so they are mine to define."

**2:30 to 3:30 Evidence.** **Build Graph**, then the poll and the partner's notes. Search the
evidence for "default" and open two passages. Say: "A paraphrase is never shown as a quote. Quotes
are checked against the passage."

**3:30 to 5:00 Stakeholders and actors.** Open three stakeholders and read their cited quotes
(for example administrators, the security reviewers, a partner). Edit one stakeholder (change its
priority) and merge or remove one. Read the prompt about roles nobody was found for and say what
you would do: add them by hand, or collect evidence. Approve, then open the actor table: change one
trait with a slider and show the badge change to "you". Say: "Population sizes are assumptions used
as weights. They are not measured counts."

**5:00 to 6:30 Compare scenarios.** Run the comparison. Show the response distribution per scenario,
the trajectory band, and two findings with their intervals. If one finding is unstable, open it and
say what that means: it did not hold in enough runs to rely on. Open the second-order chain and read
it aloud ("because ... then ..."); say that competitor, partner and regulator reactions come from
generic rules and not from a script written for this example.

**6:30 to 7:30 Sensitivity.** Point at the assumptions the result moves with. Find one that is
sensitive and unevidenced and say: "This is what we would test first." Change that assumption in the
actor table and run again if there is time; otherwise say what you would change and why.

**7:30 to 9:00 Review and brief.** Run the independent review. Read one evidence objection and one
assumption objection, and respond to one. Open the brief: the executive answer, the assumptions
register, uncertainty, risks, recommendations (each linked to a finding, with an owner function and a
validation step), the validation plan and the limitations. Point out where the licence-terms gap
appears and say: "Nothing in the evidence answers who pays, so the brief shows it as unresolved."

**9:00 to 10:00 Exports and questions.** Export Markdown, JSON or the printable page. Ask the
analyst one question the sources answer ("How many seats were in the pilot and how long did it
run?") and one they cannot ("What was the firm's revenue in 2019?"). Say that rules mode returns the
nearest passages and does not compose an answer.

## Points specific to this example

- "The security note states concerns, not findings."
- "The poll asked people what they would do. The partner counted what its clients did. They are
  different kinds of evidence about the same behaviour."
- "Nothing in this pack says what Microsoft intends. The premise is hypothetical."
- "The firm has no figure for who pays, and that gap is deliberate."

## Objections specific to this example

**"Is this what Microsoft will do?"** No. The question names a hypothetical change and the documents
describe an invented firm reacting to it. Nothing here comes from or describes Microsoft.

**"The pilot says 41%. Is that the adoption rate?"** It is one invented pilot, counted as at least
one recap opened in a week, in a group that was a third volunteers. The partner's 68% comes from
tenants it chose. Swarm shows both and does not reconcile them.

**"Would administrators really switch features off?"** The pack holds two answers that disagree
(44% intending to, 16% observed). A scenario run explores both under declared assumptions; it does
not settle which is closer to the truth. The validation plan says how to find out.

**"What about privacy and regulators?"** The pack records concerns and says that no regulator or
works council has stated a position. That is a gap, not reassurance, and the brief's uncertainty
section is where to look for it.
