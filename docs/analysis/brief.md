# Decision brief

The decision brief is the answer-first document of a project. It puts the answer to the question
first and then shows what the answer rests on: the evidence, the stakeholders, the simulated
outcomes, the assumptions and how much they matter, what to do and how to check it before doing it.

Swarm explores possible scenarios. It does not predict the future. Outcome counts are synthetic;
other figures are model scores, seeded-run proportions or stated assumptions; none is a measured
population rate.

## How it is made

The brief is assembled by rules, in code, from the artifacts a project already holds: the question
and scenario, the stakeholders, the synthetic actors, the evidence ledger and the source documents,
the completed analysis (variants, seeded runs, findings, sensitivity rows, fidelity) and the
critiques recorded against it. No model writes any of its wording, so the same inputs always give
the same brief, apart from the time it was made. The contract marks this as `generatedBy: rules`.

Text that comes from outside the code (the question, names, quotations, the analysis's own finding
statements, critique objections) is quoted inside the sentence that uses it and clipped to a
length. It is data, not instruction, and it is never executed or followed.

The brief is stored with the project as the artifact `brief`; generating it again replaces it. The
data behind its charts and tables is worked out when the brief is made and stored with it (the
`snapshot`), so that what the page draws and what the exports tabulate agree with the brief's own
words even after the stakeholders, the scenario or the critiques have changed. The routes hand it
out as `visuals`. A brief stored before that was kept has its charts worked out from the project's
documents as they are when it is read or exported, and the page and every export say so
(`visualsFrom: "current"`).

## The seventeen sections

The order is fixed. The first section is the answer.

| #   | Section                             | What it holds                                                                                                                                                                                  |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Executive answer                    | The decision and a conditional recommendation, the paired comparison, the groups moved most, the three doubts that could change it, what would settle them, and what the brief cannot tell you |
| 2   | Decision evaluated                  | The question, decision, changes, baseline, alternatives, open points and the variants, with what each sets for whom                                                                            |
| 3   | Evidence base and quality           | Sources by kind, cited passages, conflicts between sources (and, where the search for them was cut short, how far it read), and which actors no cited passage supports                         |
| 4   | Stakeholder landscape               | Stakeholders grouped by category, who is harmed or benefited, how much is cited for each                                                                                                       |
| 5   | Main reaction patterns              | What the simulated groups did, as shares of each group's simulated members with every group counting equally, and the counts of sampled members beside them                                    |
| 6   | Alternative outcomes                | How each variant compares with the baseline on the same seeds, in that share and its paired difference, ranked by share and never by counts                                                    |
| 7   | First-order effects                 | The direct response of the most affected groups, against the baseline                                                                                                                          |
| 8   | Second-order and competitor effects | Second-order findings, responses by actors outside the organisation, and the chain of events in the representative run                                                                         |
| 9   | Behavioural drivers                 | The assumptions the simulated result moved with, and those it did not                                                                                                                          |
| 10  | Important assumptions               | The assumption register, with who set each and whether a cited passage backs it                                                                                                                |
| 11  | Uncertainty and sensitivity         | Findings that were not repeatable, sensitivity rows, critiques not yet closed                                                                                                                  |
| 12  | Risks and opportunities             | Groups set as harmed that ended up adverse, actions by outside actors, and groups set as benefited that went along                                                                             |
| 13  | Prioritised recommendations         | A table of recommendations that follow from findings (see below)                                                                                                                               |
| 14  | Validation plan                     | A table of real-world checks that would settle what the result most depends on                                                                                                                 |
| 15  | Sources and provenance              | Each source, how it was supplied, and whether the server fetched it                                                                                                                            |
| 16  | Limitations                         | What this analysis cannot tell you                                                                                                                                                             |
| 17  | Technical appendix                  | Seeds, runs, rounds, variants, engine, cost, and the trait values of every simulated actor                                                                                                     |

## The executive answer

The first section is written to be read in a minute, in this order, each statement with its own
origin and references:

1. The decision that was evaluated.
2. A recommendation that is conditional on the premises: if the checks of the validation plan confirm
   the premises behind the simulated result, the actions the recommendations name (mitigating for the
   groups that moved most, preparing a response to the outside actors that answered, building on a
   favourable response); if they do not, run the analysis again with the measured values. When the
   headline result did not hold in most seeded runs, it says not to decide yet and to repeat the
   analysis.
3. The headline comparison, in the engine's own measure: the mean share of simulated members looking
   for an alternative or resisting under the change and under the baseline, every group counting
   equally, the paired difference with its standard error, and how the paired runs divided: higher under
   the change in so many, lower in so many, or the same in all of them. A share that did not move
   is steady when it was the same in every pair; a tie is never counted as a rare rise, and the analysis
   is not repeated for it. Where the overall stance, a different measure, moved while the share did not
   (or the other way), the headline says what the stance did.
4. The groups moved most, each with its own share against its share under the baseline. They are
   ranked by that share and never by member counts.
5. Up to three doubts that could change the answer, the biggest first, from the sensitivity rows, the
   critiques, the conflicts between sources and the groups no cited passage supports: for example how
   the change lands on the group the answer moves most, how large the change is in practice, or an
   open major objection.
6. What would settle them, by id of the checks of the validation plan, with the note that the
   decision thresholds are left for the person to set.
7. How steady the comparison was across seeded runs, with the Wilson interval described as
   descriptive of these runs (see [methodology](methodology.md#reading-a-repeatability-interval)).
8. What the brief does not tell you: how many real people act this way, how fast, or whether the
   assumptions hold.

The headline repeats the comparison, the groups moved most and the biggest doubt in one paragraph. When
nobody has a direction of impact, the doubt is kept ahead of the names of the groups, in a short form,
so that the length of a scenario's name cannot push it out.
When the comparison cannot be read as a result, the answer says so first instead (see below), and
the order above applies to the `clear` state.

## Origins

Every statement carries exactly one of ten origins and the references it rests on. The brief never
shows a statement under an origin it cannot stand behind: if the references an origin needs are
missing, the statement is shown as unresolved uncertainty instead.

| Origin                    | Used for                                                                         | Must rest on                              |
| ------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| Supplied evidence         | A passage from a document that was uploaded or pasted                            | A cited passage or a source document      |
| Retrieved public evidence | A passage from a document the server fetched from a web address                  | A cited passage or a source document      |
| User assumption           | A setting a person typed, edited or added                                        | The assumption itself                     |
| System assumption         | A default Swarm filled in, a setting of the scenario or a property of the method | The assumption itself                     |
| Inferred stakeholder      | A stakeholder worked out from the sources                                        | A stakeholder                             |
| Actor behaviour           | What a simulated actor did in the simulation                                     | A stakeholder or a finding                |
| Simulation aggregation    | A count or comparison over seeded runs                                           | A finding, a sensitivity row or a variant |
| Model interpretation      | A reading of a finding                                                           | A finding                                 |
| Historical comparison     | A document that records what happened before                                     | A cited passage or a source document      |
| Unresolved uncertainty    | What is not known                                                                | Nothing: it names what is missing         |

A few rules decide the evidence origins. A document is retrieved public evidence only when its
provenance is a web address and the server fetched it; a document marked as historical is a
historical comparison; everything else is supplied evidence. A trait that is labelled as resting on
evidence is shown as evidence only when a passage is cited for it now (what the stakeholder cites in the set
as it stands, not the label the cast was saved with); otherwise it is shown as a system
assumption or as unresolved uncertainty. The size of an impact is never shown as evidence: a passage can
give its direction, so a statement about an impact says that the direction rests on a cited passage and
the size is an assumption. A trait proposed by a model that no one has changed is a
system assumption. The settings a scenario makes for particular groups (an impact override or an edit
to a trait) are a statement of their own and a user assumption: the scenarios Swarm proposes never carry
any, so one that is present was put there by a person. How strongly and how soon a scenario lands is
the system's assumption unless the scenario's description says that a person set it.

The page and the exports show each statement's references, so a reader can open the quotation with
its passage id, the finding with how often it held, the assumption, the variant or the stakeholder.

## Reliance

A statement that rests on a finding also says how far to rely on it. The level comes from how often
the finding held across seeded runs and whether a cited passage supports the actors it is about:

| Finding                                         | Reliance |
| ----------------------------------------------- | -------- |
| Repeatable, and the actors have a cited passage | High     |
| Repeatable, and the actors have none            | Moderate |
| Mostly repeatable                               | Moderate |
| Unstable or rare                                | Low      |

A statement is only as reliable as the least reliable finding it rests on. A statement about a
stakeholder is moderate if a passage supports it and nothing contradicts it, and low otherwise.
Statements that do not rest on a finding carry no reliance. The headline is about the share of
simulated members who look for an alternative or resist, and the analysis's finding about the direction
against the baseline is about the overall stance, a different measure. The headline therefore cites that
finding, and takes its reliance from it, only when the stance points the same way as the comparison;
when it does not, the comparison is rated by its own paired steadiness (in how many paired runs the
share was higher) and the stability statement says that the stance does not point the same way. A
steady stance is never offered as support for a share that moved the other way. These levels describe how stable a
simulated result is. They are not probabilities and say nothing about the real world. The one
exception is a comparison that [cannot tell the change from no change](#when-the-comparison-cannot-tell-the-change-from-no-change)
because the simulator gives the same outcome with the change as without it: every finding then
describes only the runs themselves, so every statement that rests on one is low, however often it held.

## Numbers

The brief leads with the engine's own measure: the share of simulated members whose final response
is to look for an alternative or to resist, with every group counting equally. Each group's own
share is worked out first, and the shares are averaged over the groups, so a group of 20 sampled
members counts as much as a group of 1. It is the same measure as the engine's overall response
shares, and it is written as members in every 100, never with a percent sign, always with the word
"simulated" and the denominator named. The comparison with the baseline is paired by seed: the same
random draws sit on both sides, so the difference is the change and not the noise. It is stated
with its paired standard error and in how many of the paired runs the share was higher under the
change. The groups most affected are the ones whose own share moved most against the baseline,
read from each group's own share, never from how many members were sampled for it.

Counts of simulated members are worked out too, and are shown beside the shares: the members of each
actor, times the share that gave each response, added up per run and averaged over the seeded runs
of a variant. How many members are sampled for a group is a numerical resolution set when the actors
were made, not a population, so a count rises and falls with the sampling: sampling five times as many
members of one group gives about five times as many of its members in each response, with its own
share moved only as far as a finer sample can move it. For that reason options are never ranked by
member counts. Population sizes are assumptions that weight each group where a weight is used. They
were not measured. Shares and counts are simulated: none is a rate in a real population.

A sub-0.01 shift or error is printed with enough decimals to show that it is not zero. A shift that
sensitivity calls robust is described as below the chosen materiality threshold of 0.02 on that
measure, which is a choice of this method, not as lying within noise: a shift can be many standard
errors from zero and still be too small to matter. The register words a sensitivity row for what it
changed: a row that moves how widely the members of a group differ is described as how varied its
members are, not as a change in the size of the group, and a shift below the threshold is "less than"
it, "not the same as no change", never "within noise".

### When the analysis kept less than every run

A comparison that a person may ask for in full (200 seeded runs of several variants of a large cast)
can be larger than one stored document may be. The server then keeps what each run said overall and
drops the per-actor result of every individual run, and keeps instead each actor's totals over the
runs (its members, its mean share in each response and its mean stance), and says so in the
analysis. The brief reads the totals that were kept. Where something can only be worked out from
each run's own results, such as the number of paired runs in which one group's share was higher, the
brief states no figure and says why, and it never reads an absent result as zero members. Where the
analysis kept neither (an older stored analysis), the headline still states the overall comparison,
which every run keeps, and the statements about single groups are withheld with the reason.

## When the comparison cannot tell the change from no change

A comparison with no change only means something if the change can move someone. Two situations
are named. The brief stores which one applies as `signal` (`clear` when neither does), says it first
on the page and in the Markdown and printable exports, and changes what it writes as follows. A third
situation, where nobody has a direction but members can still be moved, is read on the findings under a
note (see below).

**No direction of impact (`no-direction`).** The simulator is certain to give the same outcome with the
change as without it, on every seed: no stakeholder has an expected direction of impact, no scenario
sets one for anyone (after its own overrides and edits), the members of a cohort do not differ in
impact, and no scenario sets anything else about anyone that no change would. The change then moves no
one in the simulation, so no difference from no change is a result, whatever counts the runs show. The
test is the shared decision `changeCanMoveAnyone` (in `shared/signal.ts`, see
[methodology.md](./methodology.md#a-change-that-cannot-move-anyone-and-one-that-has-no-direction))
together with a check that no actor has a direction under any change, so that a change with no
strength is not mistaken for a missing direction. A cast whose members do differ in impact is not this
state, even when nobody has a direction: it can move members. Then:

- The headline and the executive answer say that the simulated comparison could not tell the change
  from no change, in the shared wording of the notice: say who is helped or harmed in the stakeholder
  review, or read the evidence with a model. No count of adverse members is put forward as a result,
  and the answer is itself the main caveat. The statement is unresolved uncertainty. The finding that
  the two ended up about the same is quoted with its stability, as a description of the simulation
  repeating itself.
- The first recommendation is to say who is helped or harmed, in the stakeholder review, or to read
  the evidence with a model, and then to run the comparison again. It comes first whatever its score
  (its impact is high and its effort low, because nothing else can be read until it is done), links to
  the finding about the direction against the baseline, and is an assumption of the system, not a
  result. Nothing is built on it: no mitigation, no building on a favourable response, and no
  repeating of runs that cannot help.
- The first check of the validation plan confirms the direction of impact with the stakeholders
  themselves.
- The first limitation is the notice, and every statement that rests on a finding is low reliance.
- The sections that set variants side by side begin with a note to read nothing in them as an effect
  of the change. No comparison with the baseline is written as an effect, no variant is ranked, and no
  risk or opportunity is attributed to the change.

**Nobody has a direction, but members can still move.** A cohort is drawn around an actor's impact with a
spread, so with an impact of 0 and a spread some members are moved each way, and a scenario can edit a
trait; the default cast gives every cohort a spread of 0.15. The change can move members, so this is not
the state above, and the brief does not say that it cannot or that a difference is noise: it reads on its
findings like any other comparison (and may be `clear` or `no-difference`), and the two sections that set
scenarios side by side open with a note that nobody has an expected direction, that a difference
follows from how widely members are assumed to differ in how the change lands on them or from an edit
to a scenario and not from anyone being helped or harmed, and to say who is, in the stakeholder review,
before reading it as an effect of the change. The note's origin is an assumption of the system when the
brief is `clear`, and unresolved uncertainty when it is `no-difference`. The limitations list the shared
notice for it (`UNDIRECTED_NOTICE`) after the one that says what the comparison found, as an assumption
of the system. The review raises it as its own criticism (see [critics.md](./critics.md)).

Because the headline still states a comparison in this state, the brief does not leave the missing
direction to the limitations. It is the answer's first doubt (the biggest caveat); the executive
answer's recommendation is not to decide on the comparison until the direction is said ("Recommendation:
do not decide…"), instead of the usual conditional go-ahead; the first recommendation is to say who is
helped or harmed, in the stakeholder review (`SAY_DIRECTION_UNDIRECTED`, an assumption of the system); and the first check of the
validation plan confirms the direction of impact with the stakeholders themselves, ahead of the checks
on how large the change is. The headline's number is still what the simulation produced under these
assumptions, and the page says that it follows from the assumed spread or from an edit.

**No measurable difference (`no-difference`).** The change can move members, and the comparison still found
the two about the same. It is said of the proposed change only (the first alternative, which the
headline is about), and it is worked out for each alternative on its own. Three things must hold. The
analysis's finding that simulated members ended up about the same under the scenario as under no
change, on the same seeds, is repeatable or mostly repeatable. No other direction finding for the same
scenario that is repeatable or mostly repeatable says otherwise. And nothing moved clearly: neither the
members together nor any actor has a mean final stance, or a share of simulated members looking for an
alternative or resisting, that differs from the baseline's by 0.1 or more on the same seeds (the medium
cut-off of an impact), nor a share that differs by 0.05 or more (what sensitivity calls too small to
matter) in the same direction in most of the paired runs. The last test is there because the overall
stance is a mean over groups, so groups moving in opposite ways, or members moving each way at once,
could hide in it, and because a small shift that holds in nearly every paired run is measured and is not
no difference. Where the runs kept no per-actor detail (see the size limit in
[methodology.md](./methodology.md#what-is-kept)), the totals kept for each scenario are compared
instead, and with neither the brief does not claim that no group moved.

When it holds for the proposed change, the headline says that there is no measurable difference under
these assumptions between the proposed change and no change, leads with how often the two ended up
about the same instead of with counts, and keeps the main caveat after it. It says that this is a
result about the assumptions, not about the world. No mitigation and no building-on recommendation is
made for the proposed change, no first-order effect, risk or opportunity is singled out for it, and the
first limitation says what the result does not show. A different scenario whose own findings show a
repeatable, favourable response of a group set as helped still gets advice to build on it, naming that
scenario, because the result is said of the proposed change only. The notice, the note and the limitation say that it is
said of the proposed change only, and none of them calls a difference noise. **Every other scenario is
read against no change on its own findings** in "Alternative outcomes": one whose own findings say it
ended up about the same is worded so (stance, "which the comparison reads as about the same"), and any
other is worded by its counts and the number of paired runs in which it was worse, as in a brief that
can be read, so a scenario whose own finding says it was less favourable in every paired run is never
called about the same because the proposed change was. The executive answer says so too: after the
stability of the finding it has one statement, outside the headline, for each (at most two) other scenario
whose own finding says it differed from no change, saying that no difference is said of the proposed
change only and quoting that finding. The chart of each alternative against the
baseline and the caption of the same table in the exports do the same: only the first row, the proposed
change, is not read as an effect.

What this relies on, and where it stops:

- The finding about the direction is recognised by its wording ("ended up about the same under"),
  because the contract has no field for it. If the analysis changes that wording, the second state
  stops being detected; the first does not depend on it.
- When no baseline was run, or the headline variant is not an alternative, there is nothing to
  compare, neither state applies, and the brief says so as before.
- The state of the brief is the headline variant's, the first alternative's; the others are only
  worded on their own findings in "Alternative outcomes". The rest of the brief (first-order effects,
  risks and opportunities, recommendations) is about the headline variant, so "no first-order effect
  is singled out" does not say that a later scenario has none.

## Recommendations

Every recommendation carries its impact, effort, reversibility, a time horizon, an owner function,
leading indicators, the assumptions it depends on and how to check it before committing. They come
from a few generic rules that know nothing about the subject:

- A repeatable finding that a harmed group the answer names ended up looking for an alternative or
  resisting as its largest response: mitigate, or stage the change. A finding about another response
  of the group does not stand for it. Only the proposed change is mitigated, and the groups come in
  the order the answer names them.
- An assumption the result is sensitive to that nothing cited backs: validate it first.
- Key actors, or evidence the question named, that nothing cited supports: collect evidence.
- Sources that disagree: resolve the conflicts, by getting the underlying data from the owner of each
  source.
- A repeatable event from an actor outside the organisation (a competitor, partner, regulator or
  substitute): prepare a response. Event findings are made for each acting actor, so the advice names
  that actor and quotes how often it acted in the seeded runs ("In 11 of 12 seeded runs, a simulated
  counter-move event by this actor occurred"), one piece of advice for each actor.
- A headline result that did not hold in most seeded runs: repeat the analysis before relying on it.
  A headline result that seldom or never held is its own case: the runs agree that it is rare, which
  is not the same as disagreeing, so the advice is not to plan around it and not to read its absence
  as safety.
- A favourable, repeatable finding for a benefited group: build on it. The group counts as helped by the
  scenario the finding is about, and its own stance has to have moved up, whatever its share looking for an
  alternative did. Where the proposed change came out about the same, an alternative whose own findings
  show such a response still gets this advice, naming that alternative; the proposed change gets none.
- Serious critiques that are not yet closed (anything but accepted: open, responded or disputed):
  resolve them first.

Each recommendation has the origin it can stand behind and the ids it rests on. A group counts as
harmed, helped or unaffected the way the engine reads it for the scenario the answer is about: a
scenario's own setting of the group's impact (an override, or an edit to the impact trait) wins over
the group's own default. The same reading is used for the recommendations, the risks and opportunities,
the first-order effects, the doubts of the answer and the validation plan, so one section never calls a
group harmed that another calls unaffected. The executive answer's conditional advice takes only advice
whose findings belong to the proposed change; advice about how a group would respond to a different
scenario stays in its own recommendation, named there. What follows from a
count over seeded runs (mitigate, prepare a response, build on, repeat) is a simulation aggregation,
carries the reliance of the findings it rests on and links them. Advice about the evidence (collect
evidence, resolve conflicts) or the critiques (resolve them) is unresolved uncertainty: it rests on
the passages, the actors, the sources or the critiques it is about, and carries no reliance, because
how often a finding about a group held says nothing about whether two sources agree. Validating an
assumption is a simulation aggregation on the sensitivity rows it is about. Saying who is helped or
harmed is a system assumption. A recommendation never inherits the reliance of an unrelated finding.

At most twelve are listed. They are ordered by impact times repeatability divided by effort.
Impact is the size of the simulated shift (at least 0.3 is high, at least 0.1 is medium, measured as
a share of a group's simulated members or a change of stance on the scale from -1 to 1).
Repeatability is the largest lower bound of the Wilson interval among the findings the
recommendation follows from; advice that rests on no finding of its own takes that of the headline
result it protects. Effort is a planning default for the kind of action, and low, medium and
high weigh 1, 2 and 3. Ties go to the higher impact, then the lower effort, then the order they were
found in. The owner function comes from the stakeholder category the recommendation is about. These
are lenses, not a list of answers for any one case, and the effort values are not estimates. The
only exception to the order is the recommendation to say who is helped or harmed, which comes first
when the comparison could not tell the change from no change (see above).

## Validation plan

The plan tests what the headline decision depends on, not the order of groups in a table. It has at
most eight checks, ranked by how much of the answer rests on the premise and placed in this order:

1. The premises of the headline that nothing measured: how large the change is in practice and how
   widely and soon it reaches the groups, how it lands on the groups the answer names, the
   assumptions the runs were sensitive to that nothing cited backs, how widely members of a group
   differ, and the population sizes that weight a group.
2. Open conflicts between sources. Each names both sources and their figures; the method is to get
   the underlying data and its definition from both owners and compare like with like.
3. What triggers an outside actor (a competitor, partner, regulator or substitute) that responded
   in most seeded runs.
4. The key actors that no cited passage supports.
5. Repeating the analysis with more seeded runs, only for a headline result that did not hold in
   most seeded runs: the answer's own direction, its threshold, or the adverse response of a group it
   names. An ordering of groups, which of two responses is the largest for a group, or a single event
   is never a reason to repeat runs.

Every check except the last names the actual group and the change in the scenario's own words, and
says four things: what would be observed in the world, in the scenario's own words (for example "the
proportion of this group who start using an alternative, reduce their use of it or formally object",
the time or the money it takes, the weeks before they see the change), without stating any value for
it, and never in the word "share", which the brief keeps for the simulated shares of simulated
members; what it is compared with (a comparable group that is not exposed, the same group before the
change, or the two sources against each other); how long it takes and how much effort it is; and a
decision rule that is left for the person to set before the check starts, because nothing in the
simulation supplies one. Each also names the function that would run it. A check never asks a pilot
to match an internal score, a setting such as the strength of the change, or a share the simulation
produced. The check of the size, reach and timing of the change sets them from what was delivered
and not from the reaction that was seen, and compares the simulated reaction with the observed one
only for a group or a period that was not used to set them: a pilot that tunes a setting is not also
the test of it. The check of how the change lands on a group points to what that group's own evidence
says: it quotes the passage the group cites, as context and not as an outcome, because a passage can
state a worry, a gap in the data or a proposal and not something that was seen, and it says that someone
who knows the group makes it countable before the check starts. It asks, beside that, who starts using
an alternative, reduces their use or formally objects. A group that cites nothing keeps a general
measure that names no outcome of its own. The passage quoted is the one that supports the group and says
the most about it: a passage that is not a statement of what nobody has counted comes before one that is,
one that names the group (by a word of its name) before one that does not, and one that names it sooner
before one that names it later. The check is also made for a group that
the advice builds on because it is helped, since a benefit that nothing measured is not something to build
on yet; for a group helped by another scenario it is asked in that scenario's own words and links to it,
apart from the premise of the proposed change.
Checks that settle the same premise are merged. The method is a generic real-world check (a survey,
interviews, a data pull, an expert review or a staged rollout) filled in with the groups, the change
and the sources of this analysis, so two analyses of different questions get visibly different plans.
When no stakeholder has a direction of impact, the first check confirms it with the stakeholders
themselves, and no check proposes repeating runs that cannot tell the change from no change.

The answer-first section points at the checks that settle its three doubts, by id, and the table on
the page and in the exports has a column each for what to observe, what to compare with, the method,
the decision rule and the owner.

## Wording guard

Every statement is checked before it is kept. The words of the statement itself, outside any
quotation, may not predict ("will", "shall", "is expected to", "are bound to", "is certain to" and
other forms of "to be" with a word of forecast, and a verb of forecast with what is forecast, as in
"analysts forecast a rise", unless it is denied, as in "does not predict the future"), overclaim
(certainly, definitely, guarantee, proves,
proven, inevitable), put a number on a real population as a percentage, or put a figure on a measure
of the real world (a conversion, a share, a level of adoption or of sentiment, revenue) or
on real customers, unless the figure itself says whose it is: "18 of 40 simulated members" does, and
"conversion increased by 18 real customers" and "18 customers actually left" do not, however many times the sentence says
"simulated" elsewhere. A statement about the simulation must say that it is simulated, and so must the
headline and the recommendations. A statement that fails is withheld and replaced by a notice, its
origin is shown as unresolved, and the count is recorded in the methodology notes of the brief. A
recommendation that fails is withheld whole: its time horizon and owner function are reset to "Not
stated." along with its text, so that nothing the guard rejected is left in a neighbouring field.
Quotations from the sources are not rewritten.

## Reading it

- The origin chip tells you where a statement comes from. Start with the reliance of the executive
  answer and the line "what this does not tell you".
- A finding that held in few seeded runs, or whose actors no cited passage supports, is a hypothesis
  to check, not a result. The validation plan says how.
- A notice above the executive answer means the comparison cannot be read as a result about the
  change: either it could not tell the change from no change, or it found no measurable difference
  for the proposed change under these assumptions (other scenarios are read on their own). Read the
  notice before the counts.
- Each chart has a table behind it with the same numbers.
- "This brief may be out of date" lists what changed, and what to do depends on what it is. A comparison
  records the revision of the scenario, the stakeholders, the actors and the constraints it was run on
  (a comparison saved before the constraints were recorded is read as made when the project had none), and
  the brief is judged against that record, not against when it was written. If one of them changed after the
  comparison ran, writing the brief again would describe the new decision with the old runs, so the
  notice asks for the comparison to be run again in the Simulation stage, then the brief to be written
  again; the brief written from such a comparison says so in its own methodology notes and keeps the
  notice. A change to the critiques, or a newer completed analysis, is brought up to date by writing
  the brief again.

## Charts

The page draws six visuals from the analysis data: a stakeholder map by category, the outcome
distribution over seeded runs, a comparison of each variant with the baseline, sensitivity bars,
the assumption register and the evidence map. Each is HTML or SVG made for this page, uses only the
theme's colour variables, is described in words, and has a table alternative. The exports carry the
same data as tables. The contract also names an influence network, a risk and impact chart and a
timeline. They are not drawn, because the analysis does not hold the data to draw them without
inventing it.

## Routes

| Route                                | Who may call it                   | What it does                                                         |
| ------------------------------------ | --------------------------------- | -------------------------------------------------------------------- |
| `GET /api/projects/:id/brief`        | Anyone who may read the project   | The stored brief (or none), the chart data, what has changed since   |
| `POST /api/projects/:id/brief`       | Anyone who may edit the project   | Makes the brief from the newest completed analysis, or the one named |
| `GET /api/projects/:id/brief/export` | Anyone who may export the project | `format=md` (the default), `json` or `html`                          |

`POST` takes an optional `analysisId` and answers 201 with the same view as `GET`. It answers 409
when there is no completed analysis (`NO_ANALYSIS`), when the named analysis has not finished
(`ANALYSIS_NOT_COMPLETED`) or recorded no runs (`ANALYSIS_EMPTY`), and 404 when the named analysis
is not in the project. An export answers 409 `BRIEF_NOT_GENERATED` before a brief exists. Who holds
which capability is described in [roles and tenancy](../adr/0005-identity-roles-and-tenancy.md) and
[workspace and project membership](../adr/0007-workspace-and-project-membership.md). Generating and
exporting are recorded in the audit trail as `brief.generated` and `brief.exported`, with the
format and ids only and never a question, a statement, a name or a passage.

## Exports

- **Markdown** and **Printable** (HTML) are written from the same list of blocks, so they say the
  same things. Every piece of text from a source, a name, a quotation or a finding is escaped as
  data, so markup, links and HTML in it stay as text.
- The printable page has no script and loads nothing. It is served with the policy
  `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'`, together with `x-content-type-options: nosniff` and `cache-control:
no-store`. Print it from the browser to get a paper or PDF copy.
- **JSON** is the stored brief and the chart data, with a notice and a schema version. Its `changedSince`
  (empty when the brief is current), `warning`, `provenance.inputRevisions` (what the brief was made
  from), `provenance.currentRevisions` (what the project holds at the export) and `provenance.dataFrom`
  (`snapshot`, or `current` for a brief stored before its data was kept) carry the freshness with it.
- Every export says so before anything else when what the brief rests on has changed since: Markdown
  with a quoted warning, the printable page with a boxed one, ahead of the headline, naming what changed
  and the revisions it was made from beside the ones the project holds now. The tables are the ones
  the brief was made with. A brief stored before they were kept says, in the same place, that its
  tables show the project as it is at the export. A brief that rests on a comparison saved before it
  recorded what it was made from says in the same place that whether it is current cannot be told, and
  asks for the comparison to be run again; making the brief again does not clear that.
- When the comparison cannot be read as a result, the Markdown opens with a quoted notice and the
  printable page with a boxed one, both ahead of the headline, and the caption of the table that sets
  variants side by side says that its differences are not read as effects of the change.

## What it does not do

- It does not forecast. It describes what happened in a simulation of synthetic actors under
  stated assumptions.
- It does not give a rate, a share of a real population or a financial figure.
- It does not verify its sources. A cited passage shows where a statement came from, not that it is
  true.
- It does not use a model to word anything. A later version could let a model word interpretations
  of findings; until then every sentence is built from data by rules.
- It does not compare the simulation with past outcomes.
- It does not produce a PDF or a Word file. The printable page is the print route.
- It does not keep earlier versions of the brief. Generating it again replaces the stored one. It
  keeps the data behind its charts, not earlier versions of the scenario or the stakeholders, so it
  can say that something changed and which revisions it was made from, not show what they were.
- It is not a substitute for the checks in its own validation plan.
