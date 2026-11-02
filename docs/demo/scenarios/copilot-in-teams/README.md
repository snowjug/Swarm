# Copilot in Teams

> What could happen if Microsoft integrates Copilot more deeply into Teams and enables additional AI
> capabilities by default?

An invented professional-services firm of about 4,200 employees prepares for a hypothetical change:
more assistant features in its chat and meetings app, switched on by default. The evidence is five
short documents. Microsoft, Copilot and Teams are named only because the question names them; the
premise is hypothetical and nothing here describes a real plan.

Back to the [example scenarios](../README.md). The text the example chip loads is in
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

**Two source conflicts** that the evidence ledger flags (a test pins them), and that **Conflicts** in
Ground and **Evidence base and quality** in the brief show:

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
Rules mode reads for generic role words, so it finds the groups the text names that way and misses the
others; the review is where you add them.

Alternatives worth adding by hand if the form has none: switched on only for people who already have
the assistant; a staged rollout that starts with volunteers; per-feature switches with a notice
period; left off by default.

## Five-minute script

Run it once before you present and read the real screens. This guide contains no result. Do not
quote a figure from it as one.

**0:00 Choose the example (30 s).** First screen, then the **Copilot in Teams** chip under **Start from
an example**. Say: "Swarm explores scenarios. It does not guarantee or precisely predict real-world
behavior. This question is about a deeper, default-on assistant in a chat and meetings app. Everything
in it is invented: five short documents about an imaginary firm, each labelled synthetic." Point at the
question and at the evidence: the count on **Evidence** and the five documents in the tray, each a
sample (open one: "Sample evidence: invented, describes no real case"; in Ground it carries the licence
`Synthetic, CC0`).

**0:30 Your scenario (40 s).** **Explore**. Say: "It reads my question into a scenario I can edit before
anything runs." Point at **What changes**, **If nothing changes**, and **Assumed**, where a dot says
who made each assumption. Read the open points it raises under **Swarm asks**; this question leaves open
for whom the default applies and over what period. Answer one (**Answer**), then **Ground it**.

**1:10 Ground (30 s).** Open the poll under **Sources**. Say: "Every passage keeps its source. Ground
compares the sources and shows where they disagree." If **Conflicts** lists the poll's 44% against the
partner's 16%, open it now and come back to it in the brief.

**1:40 Map: stakeholders and actors (60 s).** **Map the stakeholders**, **Find who is affected**. Point
at the parties on the map, "N to review", the chip that says how they were found (rules or model), one
party opened to its cited quotes and confidence, and the **Nobody found for** prompts. Say: "These are
discovered from the evidence, with the passage shown. They are roles, not people." Then **Create
actors**, open an actor's **Traits**, and point at one trait with its origin chip: "Every number
the actors run on says where it came from."

**2:40 Simulate and Compare (60 s).** **Simulate**, **Run the simulation**. Watch the replay in **Live**
(the scrubber, and the flag where the change lands), then choose **Compare**. Point at the baseline and
the proposed change side by side on the gap chart, a tick for each seeded run, one finding with how
often it held ("It held in N of 30 seeded runs") and its class, and **Depends on** with the assumption
that has no evidence behind it. Say: "A single run is never the answer. These are simulated members and
seeded runs, not a rate in the real world."

**3:40 Decide: the decision brief (50 s).** **Decide**, **Write the brief**. Read the verdict and the
numbers under **What happened**, and the origin mark on a statement. The evidence base is closed until
you open it from the contents: this pack was built with two source conflicts, so look for them under
**Evidence base and quality**, open one (the poll's 44% against the partner's 16%) and say: "Two sources
disagree. Swarm shows both quotes and does not pick one." Then show the **Validation plan**, which is
open just after the recommendations: each check says what to observe, what to compare it with, how, and
who runs it, and leaves the decision rule to you.

**4:30 One objection (20 s).** Choose **Review**, then **Run the independent review**, and read one
objection with its basis. Say: "A critic challenges; it never edits the analysis. I can respond, accept
or dispute, and the disagreement stays visible."

**4:50 Close (10 s).** "Invented evidence, a repeatable method, assumptions on the table, and a plan to
check them. It supports a person's analysis. It does not make the decision."

## Ten-minute script

The five-minute script, slower, with the parts that show how it works.

**0:00 to 1:00 Open.** As above. Add: "The real names are in the question only because the question
names them. The documents describe an invented firm and a hypothetical change." Open the IT office
brief from the tray and read the premise paragraph aloud.

**1:00 to 2:30 The question and the scenario.** Edit one field of **Your scenario** (the horizon, or
**If nothing changes**) and point at the chip at the top: it now reads "Edited by you". Add one
alternative by hand with **Add a way**: for example, default-on only for people who already have the
assistant. Say why: "The alternatives are what we compare against the baseline, so they are mine to
define."

**2:30 to 3:30 Ground: the evidence.** **Ground it**, then the poll and the partner's notes under
**Sources**. Choose the **Passages** figure, search for "default" and open two passages. Say: "A
paraphrase is never shown as a quote. Quotes are checked against the passage."

**3:30 to 5:00 Map: stakeholders and actors.** **Map the stakeholders**, **Find who is affected**. Open
three parties and read their cited quotes under **Evidence**. Edit one (**Edit** on the party, or
**Modelled as** for its priority) and **Merge** or **Remove** one; bring it back from **Removed** in the
**List** view with **Restore**. Read the prompts about roles nobody was found for and say what you would
do: add them by hand (**Add a stakeholder…**), or collect evidence. **Create actors**, open an
actor, move one trait with its slider and show the chip change to "you"; **Save** keeps it. Say:
"Population sizes are assumptions used as weights. They are not measured counts."

**5:00 to 6:30 Simulate and Compare.** **Run the simulation** and watch **Live**. Then **Compare**: show
the gap chart and the two shares, **How it unfolds** (the spread of runs over the rounds), and two
findings under **What holds** with their intervals. If one finding is unstable, open **What this means
and how it was tested** and say what that means: it did not hold in enough runs to rely on. Read **Sets
off** aloud (what each event acted on, and what only came before it); say that competitor, partner and
regulator reactions come from generic rules and not from a script written for this example.

**6:30 to 7:30 What the result depends on.** Under **Depends on**, point at the assumptions the result
moves with. Find one that is sensitive and unevidenced and say: "This is what we would test first."
Change that assumption on the actor's **Traits** and simulate again if there is time; otherwise say what
you would change and why.

**7:30 to 9:00 Decide: review and brief.** **Decide**, **Write the brief**, then **Review** and **Run the
independent review**. Read one evidence objection and one assumption objection, and respond to one.
Open the brief: the verdict first, then the chapters that are open (the decision evaluated, the reaction
patterns, the alternative outcomes, the effects, the risks, the recommendations, each resting on the
findings it cites with an owner function and a way to check it, and the validation plan), then, from the
contents, the closed reference chapters (the assumptions, uncertainty and sensitivity, the sources, the
limitations). Look for the licence-terms gap (this pack leaves it open on purpose): if your brief shows
it, say "Nothing in the evidence answers who pays, so the brief shows it as unresolved"; if it does not,
say so.

**9:00 to 10:00 Exports and questions.** **Export** → **Markdown**, **JSON, with the data behind the
charts** or **Printable page**. **Ask about this** opens once a detailed report exists, so run the deep
dive first (**Simulate** → **More** → **Deep dive**, **Prepare the environment**, **Start the
simulation**, **Write the detailed report**), or leave this step out. Then ask the analyst one question
the sources answer ("How many seats were in the pilot and how long did it run?") and one they cannot
("What was the firm's revenue in 2019?"). Say that rules mode returns the nearest passages and does not
compose an answer.

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
