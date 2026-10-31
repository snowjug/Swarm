# Interface design and patterns

How the interface is built, and how a feature adds a panel to it without breaking what is already
there. This describes the code in `frontend/src` as it is; where something is not done, it says so.

## What a first-time visitor sees

The aim is that a person who has never seen Swarm understands what it does in about thirty seconds
and can ask a what-if question at once.

- **The first screen** (`components/console/LandingHero.tsx`). One heading, the only h1 on the page:
  "What could happen if…?". Under it a short description, the sentence the product is never to be
  read without, and the path Swarm takes: Evidence, Scenario, Stakeholders, Actors, Interactions,
  Alternative outcomes, Analysis, Decision. The sentence is
  `Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.`; it
  lives in `lib/product.ts` (`POSITIONING_STATEMENT`) and unit and end-to-end tests assert its exact
  words.
- **The question** is the first field of the form and is on the first screen at 1366×768 and larger;
  on a phone the introduction is shorter so that the field starts on the first screen, and the
  path under the heading runs on like a sentence instead of sitting in columns.
  The project name is optional: when it is empty, it is the start of the question
  (`nameFromQuestion` in `lib/entryValidation.ts`).
- **Examples** (`ExamplePicker.tsx`) are read from `EXAMPLE_SCENARIOS` in
  `shared/example-scenarios.ts`, and the fictional starter is one more card, so the picker is never an
  empty box. Each card's button is named "Use this example: <title>" (the last is **Use this example:
  Fictional library hours**). Choosing one fills the project name, the question and the documents with
  their provenance, clears any scenario read from an earlier question, says what was loaded, and moves
  focus to the question. An example brings a question and evidence, nothing else: no scenario,
  stakeholder or result comes with it. Once something is loaded the cards fold into one line, "Example
  loaded: <title> (N documents · sample evidence)" (the starter says "Fictional starter INPUT loaded: …"
  and that its input is invented), so that the question and the evidence are what is on the screen.
  **Change example** brings the cards back and puts focus on the first; **Keep “<title>”** folds them
  again. On a phone the cards sit in one row that scrolls sideways, so that six of them do not push the
  evidence far down the page.
- **The scenario** is read by `ScenarioIntake`, mounted between the question and the evidence. The
  frame it returns is held in the entry form and sent as `scenario` in the create request when
  present; the request is validated with the same schema as any other. Rules on the server read the
  question and it goes nowhere else, unless the form's mode is **Model assisted**: then the page asks
  for a model (`useModel`) and the question goes to the provider. The line under the button says which
  of the two applies, and a model that fails or takes more than 170 seconds ends in a reading by rules
  with a note. What was read opens as a review that a person checks and edits (**Check and edit the
  scenario**: alternatives and changes can be added, removed or edited, and so can the decision). Its
  **Use this scenario** and **Discard** buttons sit in a bar that stays in reach until the end of the
  review; focus goes to the review's heading when it appears.
- **Evidence** is `SourceInput` (files and pasted text) and, when the server reports
  `urlIngestion: true`, the `UrlEvidence` panel (a plain `div`, not a form: it sits inside the entry
  form, and Enter in its address field fetches the page and never submits the form around it). A
  fetched page is added to the same list of documents with its provenance. There is exactly one file
  input on the page.
- **Run settings** (mode, fictional proxies, rounds, random seed) stay visible under the evidence, in
  a quiet group. They were not put behind a disclosure because the end-to-end specs fill them in
  directly.
- **Building** is one button, **Build Graph**, in a bar at the foot of the form that stays in reach
  (sticky inside the form, never fixed) once the question has ten characters. Beside it a line says where
  the form stands, from the same rules that accept or refuse the form when it is sent
  (`components/console/entryReadiness.ts`): "N documents attached · ready to build", or what is still
  missing ("Write your question first: 10 characters or more", "No documents attached yet · attach at
  least one to build"). An error from the server ("Cannot build this project") appears in that bar. A
  note above the bar says what the button does and does not: it saves a draft and starts Graph Build only.
  While a scenario is being checked the bar stops sticking, because the review has its own; a field that
  takes focus is scrolled clear of the bar, and on a phone with its keyboard open the bar is one row.
- Below the form: the recorded demonstration workspace, which is unchanged.

## Guided and Advanced

The header has a two-button switch named "Interface mode". The choice is kept in the browser under
`localStorage['swarm.mode']` and is `guided` or `advanced`; nothing stored yet, or anything else
stored, means Guided.

| Where                | Guided (default)                                 | Advanced                         |
| -------------------- | ------------------------------------------------ | -------------------------------- |
| Stage steps          | The engine's name, its state, a line of help     | The engine's name and state only |
| A locked stage       | Says `locked` and, under its help, what it needs | Says `locked`                    |
| Next step bar        | Shown from the lab's record                      | The same                         |
| Entry: readiness     | One line, details a click away                   | Details open                     |
| Entry: engine stages | One click away                                   | Open                             |
| Project details      | Project ID and usage a click away                | Open                             |
| Operation log        | One line, expandable                             | Expanded                         |

A screen reader is told what a locked stage needs in both modes, whatever is drawn.

Neither mode removes or hides a control or a capability. Audit log, Access, Budget, Duplicate and
Export stay where they were, grouped as "Project tools" in a quieter style, because the end-to-end
specs click them directly. Not done: a Guided mode that hides technical controls behind an
"Advanced" area. That needs the affected specs to change, and was left out on purpose.

## The workspace

- **The five stages keep their names**: Graph Build, Env Setup, Simulation, Report, Interaction. The
  stage regions are named "<name> workbench" and the step list "Guided workflow steps", as the
  end-to-end specs expect. Each step's accessible name starts with the engine's name, then its state
  and "step N of 5", and the help line after that.
- **Help** under each step (`stepHelp` in `lib/console.ts`): Understand the evidence; Review
  stakeholders and actors; Run and compare scenarios; Decision brief; Ask questions.
- **Project tools** groups Audit log, Access (when people sign in), Budget (model projects),
  Duplicate as guided and Export JSON. The audit log names every action in plain words ("Stakeholders
  found", "Decision brief generated", "Public web page refused", "Signed in"), and shows the recorded
  code under the label only when it differs from it (`lib/audit.ts`; `audit.test.ts` reads the backend
  for every action it records and fails when one has no label, so there are no unlabelled entries).
- **A project opens at the stage the engine is at**, which for a project made in the lab is usually
  Graph Build, whatever the lab has done since. The next step bar below is what says where the work
  has got to.
- **A stage opens in the view that suits it** (`defaultView` in `lib/console.ts`). The console has a
  report-or-graph pane, a workbench and both beside each other; the control named "Console view" says
  **Graph** (or **Report**), **Split** and **Workbench**. Graph Build and Interaction open in Split, so that
  the graph, or the report, sits beside the stage. Env Setup opens in the Workbench, because the
  stakeholders and actors are tables that need the whole width, so approving the stakeholders moves
  nothing. Simulation opens in the Workbench once there are actors, and Report once a comparison has
  finished; before that, and for a guided project with only the engine's own record, they open in Split
  with the engine's graph and report reader beside them. The view does not change while the person works
  in a stage, and one the person chose is kept when they move on. Under 900px there is one pane at a
  time (the control is named "Console pane"): Split shows the Workbench, and a pane the person opened on
  its own (the graph) is let go of when they move to another stage, so that a narrow screen does not pin
  the Workbench for good.
- **Interaction**'s tab **Any fictional agent** lists the proxies of the agent-by-agent deep dive, in a
  group named "Deep-dive proxies (N)", with a line saying that these are not every actor approved in Env
  Setup: Report chat answers from the report, and Env Setup shows each actor's traits.
- **History** lists each saved project as a card with an **Open** button (named "Open <project name>", so
  that an icon is not the only cue), a small **Compare** beside it for a guided project that has a saved
  round, and a delete control that asks before it deletes.

### What opens a stage, and what the page says when it is locked

A stage opens when the engine's own order allows it, or, for two of them, when the scenario lab's
record does (`stepAvailable` in `lib/console.ts`). The record comes from `GET /api/projects/:id`,
which adds `lab` (`shared/lab.ts`, worked out in `backend/src/lab/progress.ts`): whether a scenario
was stored, whether the stakeholders are `none`, `proposed` or `approved`, how many simulated actors
there are, whether the comparison of scenarios is `none`, `running`, `completed` or `failed`, and
whether a review and a brief exist. A `running` comparison is one that is queued or running;
`failed` means every comparison there is stopped without a result (a finished one earlier is not
forgotten because a later one was cancelled).

| Stage       | Opens when                                                      | What it says under its name                                             |
| ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Graph Build | Always                                                          | The engine's state                                                      |
| Env Setup   | Graph Build is ready                                            | `actors ready` once there are simulated actors, else the engine's       |
| Simulation  | There are simulated actors, or the engine's Env Setup is ready  | `ready to compare`, `comparing`, `compared`, `stopped`, or the engine's |
| Report      | A comparison has finished, or the engine's Simulation is ready  | `ready to write`, `brief written`, or the engine's                      |
| Interaction | The engine's Report is ready. The lab's record does not open it | The engine's state                                                      |

A stage that cannot be opened is a disabled button, so it is not a tab stop. It says `locked` with
a lock icon in place of its state and, in Guided, a line under its help says what it needs
(`stepLock`): "Needs Graph Build first", "Needs actors from Env Setup", "Needs a finished
comparison", "Needs the detailed report". Nothing opens it from a click or from the keyboard. Once
the record allows it, it opens without a reload and without pressing Refresh.

The workspace is told when the stakeholders or the actors change (`onChanged` of the stakeholder
panel), but not when a comparison starts, finishes or is stopped, or when the brief is written: those
panels keep their own state. So the workspace looks for the change itself (`labWatch` in
`lib/console.ts`, `useLabRefresh`), and reads the project again:

- when Simulation or Report is opened;
- every two seconds while a comparison runs, in every stage but Interaction, since the stage in view
  may be naming it;
- every five seconds in Simulation, while there are actors and no comparison has finished, and in
  Report, while the comparison has finished and no brief is written, which ends of itself;
- 0.8 seconds after a click in a stage it is watching, so that what the click started (a
  comparison, a brief) is seen at once and not at the next five seconds.

These reads are quiet: the refresh button does not spin and a screen reader is told nothing. Nothing
is read in Interaction. A comparison started again after one has finished is not noticed until
Simulation or Report is opened again or Refresh is pressed; the page then shows what the server
says, which is that the newest comparison, if it is running, decides. The brief and the review in the
Report stage also read again when the lab's record changes and when **Refresh project from server** is
pressed (`briefRefreshToken` and `reviewRefreshToken` in `ReportSeam`), so that a change made in another
tab shows up as a notice that the brief is out of date and not as a silent difference.

### The next step

`NextStepBar` sits above the stage and names the one next piece of work from the lab's record
(`nextStep` in `lib/console.ts`), with one button. It is shown from any stage that can be opened
except the one where that work is done, and never in Interaction, in the comparison of two runs or
in Report Studio.

| The record says                                  | The bar says                                                    | The button              |
| ------------------------------------------------ | --------------------------------------------------------------- | ----------------------- |
| Stakeholders proposed, not approved              | They are proposed from the evidence: review and approve them    | Review the stakeholders |
| Approved, no actors yet                          | The actors are made from the approved stakeholders              | Make the actors         |
| Actors, and no comparison, or only stopped ones  | Compare no change with the change, under the stated assumptions | Compare the scenarios   |
| A comparison is running                          | Its progress is shown in Simulation; the brief opens after it   | Follow the comparison   |
| A comparison has finished                        | The brief says what it shows and what to do about it            | See the decision brief  |
| A comparison has finished, and Report is in view | The brief is written from the comparison                        | Back to the comparison  |

The bar offers a stage only when it can be opened (Env Setup needs a built graph), and says nothing
before the lab has recorded anything: until then the stage's own button leads on. The button names
what it does and never a stage's name, so that it is not mistaken for the stage list. Following it
moves focus to the stage it opens (the region named "<name> workbench", which takes focus without
being a tab stop) and, if only the graph or the report was showing, gives that pane up so that the stage
opens in its own view; the keyboard then
continues inside the stage. **See the decision brief** is the one exception: it moves focus to the
brief itself (the document, named by its title, or the region named "Decision brief" while there is
none), so that a screen reader starts at the answer, and a brief that has just been made from the
stage's own button takes focus the same way. Where the work is more than a click, the stage still has its own
primary button: the bar only says where to go.

### The journey

`JourneyStrip` shows twelve steps: Question, Evidence, Stakeholders, Actors, Scenarios, Run,
Progress, Results, Explore, Change, Compare, Export. It follows the stage in view and is not
navigation. Every step's name is read by a screen reader at every width, with whether it is done and
which is in view; below 1500px the names are hidden from the eye, not removed. A step is marked done
only when the project's own record shows it, by the engine's
record or the lab's (`journeyItems` in `lib/console.ts`):

| Step         | Done when                                                                       |
| ------------ | ------------------------------------------------------------------------------- |
| Question     | Always: the project exists                                                      |
| Evidence     | Graph Build is ready                                                            |
| Stakeholders | The stakeholders are approved, or Env Setup is ready                            |
| Actors       | There are simulated actors, or Env Setup is ready                               |
| Scenarios    | A comparison is running or has finished, or Env Setup is ready                  |
| Run          | A comparison is running or has finished, or the engine's simulation has started |
| Progress     | A comparison has finished, or the engine's simulation is ready                  |
| Results      | A comparison has finished, or the engine's report is ready                      |
| Explore      | Never: it leaves no mark on a project                                           |
| Change       | The project is a branch or carries an intervention                              |
| Compare      | Never: it leaves no mark on a project                                           |
| Export       | A decision brief is written                                                     |

Proposed stakeholders are not ticked, and neither are approved stakeholders with no actors made, a
stopped comparison or a review with no brief: nothing is ticked that a person or the server has not
done. Exactly one step is current: the first of the stage's own steps that is not done, or the last
of them when all are.

### The stakeholder review

`StakeholderPanel` mounts `StakeholderWorkspace` (`components/stakeholders/`). The panel is a view of one
`StakeholderState` (`hooks/useStakeholders.ts`) and asks for nothing itself, so that a project that never
used the feature makes no call that can fail. It is compact on purpose: the lab's work in Env Setup must not
push the engine's own **Start Simulation** button off the screen, and the browser specs hold that at
1366×768 and 1440×900.

- **Small until opened.** Before anything is found the panel is a title, one line saying that actors are
  synthetic stand-ins, **Find stakeholders by reading the text** (with its twin **Find stakeholders with the
  model** when the project has one), **Or add stakeholders yourself** and a toggle, **How stakeholders are
  found**. After finding it is a title with four counts as text (**found**, **need review**, **approved**,
  **actors**), one button for the next step and two toggles, **Stakeholders** and **Actors**, that open the
  list and the actors. Finding opens the list and moves focus to its heading; approving shuts it and moves
  focus to the next step's button.
- **One next step.** The button says what it will do (`nextAction` in `review.ts`): **Review N
  stakeholders**, **Add a stakeholder** when there are fewer than two, **Approve and create actors**
  (**Approve stakeholders** when actors a person edited are kept), **Make the actors**, **Review the N
  actors** (a way to look, not the next step) or **Read the N stakeholders** for a person who may only
  read. The panel has one main (orange) button at a time. While the list is open and some stakeholders
  still need review, the person is reading and the way on is the approval at the foot of the list, so the
  bar offers a secondary **Go to approval**, which moves focus to **Approve stakeholders and create
  actors**. Once everything is reviewed and the list is open, the bar's **Approve and create actors**
  is a secondary shortcut and the approval card's button is the main one; with the list shut the bar's
  button is the main one. It is one element from step to step, so focus stays on it as its label
  changes.
- **Rows to scan.** A stakeholder is one line, key actors first and then the cohorts, in an order that never
  depends on the review status, so a row does not move when it is accepted: the name and role, the direction
  of impact in words with where it came from, the uncertainty in words, whether it cites a quote or is an
  assumption with no cited evidence, and whether it needs review. Opening a row shows the quotes, word for
  word with the passage they are from, what is assumed, and the means to act on it (accept, edit, merge,
  remove, priority). What is an assumption and not evidence says so in words, and an assumed direction or a
  stakeholder with no cited evidence also has a dashed edge, so that colour is never the only signal. The
  actors are rows too, with a slider for each trait and where its value came from.
- **What a change takes away.** An accepted row loses **Accept**, a removed one leaves the list for
  **Removed**, from which it is restored, an added one appears, and approving replaces the button that was
  pressed. Each change is said to a screen reader and focus goes to the row, its neighbour or the next step
  (`focus.ts`), never back to the top of the page.
- **Headings and targets.** The panel's title is a third-level heading, its parts the fourth and the rows the
  fifth. Every control has a name, and on a phone the counts come before the buttons and every toggle, row and
  disclosure is at least 44px high.
- **The fixed proxies are a deep dive, not a step.** Under the panel Env Setup has a heading "Deep dive
  (optional): fixed proxies" and a line saying that the setup for the slower agent-by-agent simulation runs
  on a small fixed set of fictional proxies, that it is separate from the stakeholder actors above, and that
  the comparison does not need it. Its status reads "Fixed proxies · pending" or "· ready", and its buttons
  (**Prepare fictional environment**, **Save environment**, **Review saved checkpoint recovery**, and
  **Start Simulation**) are secondary, so that the stakeholder step has the page's one main button. The
  Simulation stage frames the engine's own run the same way, as "Deep dive (optional): agent-by-agent
  simulation" below the comparison, with **Start Simulation**, **Generate Report** and **Inspect report
  stage** secondary. A project with no stakeholder panel (the engine's own record only) keeps them as the
  main action. Graph Build's **Prepare environment** and **Inspect environment** follow the same rule for
  a guided project, so that the journey bar's button is the main one there.
- **The actors' traits** are a table of four columns; when its own pane is narrower than 640px (the split
  view, or a phone) each trait is stacked, so that the reason is never squeezed into a strip.

`e2e/lab/stakeholders.spec.ts` holds this at desktop, laptop and phone size, from the keyboard alone and in
all three themes. The method is in [stakeholders.md](./stakeholders.md#reviewing) and the steps are in the
[user guide](./USER_GUIDE.md#reviewing-the-stakeholders-and-the-actors).

### The Report stage

The Report stage is a page to read, not a stack to scroll through. `ReportSeam` puts three things in
order: a bar, the decision brief (`DecisionBriefView`) and the independent review (`CriticPanel`); the
engine's own report follows under the heading "Detailed report".

- **A bar that stays in view.** The navigation named "Jump within the report" sticks under the header and
  has three links: **Decision brief**, **Independent review** and **Detailed report and studio**. The
  review's link says where the review stands, from what the page has already read and with no request of
  its own (`reviewStatus`): "not run yet", "no analysis to review yet", "N not yet closed" (a criticism is
  closed when it has been accepted, as the brief counts it), "all N closed", "no criticism raised" (the last
  three may end ", of an earlier analysis") or "could not be read". On a phone the words read Brief, Review
  and Details to the eye, and the accessible names stay whole. A link scrolls to its target without leaving
  it under the bar or the header.
- **The brief is a document with a contents.** Its sections are native collapsible `details`, so they work
  from the keyboard and without script, and what is closed is still in the page: find in the page, print and
  a screen reader all reach it. These are open when the report opens: the executive answer, the decision
  evaluated, the main reaction patterns, alternative outcomes, first-order and second-order effects,
  behavioural drivers, risks and opportunities, the prioritised recommendations and the validation plan.
  These are closed until wanted, and listed in the contents with the others: the evidence base, the
  stakeholder landscape, the assumptions, uncertainty and sensitivity, the sources, the limitations and the
  technical appendix. A heading is the toggle and says how many statements the section holds ("N
  statements"). The contents card has **Expand all sections** and **Collapse all sections**, each section
  has **Back to contents**, and an address of the form `#brief-<id>` or `#brief-<number>` opens its section
  before it scrolls to it. A test holds the page with the reference closed to under 60% of the height it
  has with everything open. The Markdown, JSON and printable exports are unchanged and still contain
  everything.
- **Printing** (Ctrl+P on this stage) prints the project's name and question, the whole brief, whatever is
  closed on the screen, and the review. It leaves out the application's header and footer, the journey, the
  bar, the contents, the review's controls, the detailed report, and the "Show this as a table" copies of
  charts (the one chart with no visible numbers keeps its table). The other stages print as they always did.
- **What is current.** The page says when a brief or a review no longer matches what it was made from. A
  comparison records the revision of the scenario, the stakeholders and the actors it ran on. When any of
  them has changed since, the brief says so and asks for the comparison to be run again and then the brief
  written again; when only the review changed, or a newer comparison exists, it asks only for the brief to
  be written again. A review of an earlier comparison says so, and the exports carry the same notice. A
  response to a criticism carries the revision of the review it answers and is refused (409
  `CRITIQUES_CHANGED`) when another person changed it; the page then reads the review again and keeps the
  words that were typed ([the brief](./analysis/brief.md#reading-it), [the review](./analysis/critics.md),
  [the API](./API.md#independent-review)).

`e2e/lab/report-page.spec.ts` holds the first three at desktop, laptop and phone size, and
`e2e/lab/freshness.spec.ts` the last.

## Seams: where a feature adds a panel

A seam is a place in the shell where a feature's component is mounted. The layout reserves no room
for one that has nothing to show.

| Component           | Where                                                 | Props                                                   | Only for             |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------- | -------------------- |
| `ScenarioIntake`    | Entry form, between the question and the evidence     | question, frame, onFrame, disabled, documents, useModel | New projects         |
| `UrlEvidence`       | Entry form, under the evidence                        | onAdd, disabled, remainingDocuments                     | `urlIngestion: true` |
| `StakeholderPanel`  | Env Setup, under the stage heading                    | project, onChanged                                      | Guided projects      |
| `AnalysisPanel`     | Simulation, under the heading, above the run controls | project                                                 | Guided projects      |
| `DecisionBriefView` | Report, under the jump bar, above the report          | project                                                 | Guided projects      |
| `CriticPanel`       | Report, after the brief                               | project                                                 | Guided projects      |

The Report seams (`ReportSeam`) are a jump bar, then a stack (`.seam-stack`) above the existing report;
the review is read once, by the seam, so that the bar and the panel show the same read. When the stack
has content, the heading "Detailed report" appears between it and the report; when it is empty, neither
takes any room. `onChanged` of the stakeholder panel refreshes the project from the server.

To add a panel at a seam:

1. Change the component in the feature's own folder and keep its props.
2. Render nothing when there is nothing to show, and make no API call for a project that never used
   the feature: the end-to-end specs fail on a console error or a failed request in any stage.
3. Keep the styles in the feature's own stylesheet, with theme tokens only and no text below 12px.
4. Mind what the specs assert about the screen: one `input[type=file]` on the entry; the primary
   button of a stage (Prepare environment, Start Simulation, Generate Report) is inside the viewport
   at 1366px and wider, so a panel above it should be compact or collapsed to start with; no button
   named exactly "Graph" or "Report" and none whose name contains "History"; in Env Setup the first
   `summary` containing "Synthetic" is the persona list.
5. Test it the way `ConsoleWorkspace.test.tsx` tests the mount points: replace the panel with a
   marker and check where it is mounted and with what.

## Design tokens

Colours are tokens, not literals. `frontend/src/styles/theme-tokens.css` is generated by
`scripts/ui/themes.mjs`; do not edit it by hand.

- A token is named for its role and its light value: `--t-bg-ffffff` (a background), `--t-fg-24282e`
  (text, icons, strokes), `--t-bd-cdd1d5` (a border). The three themes give each token its value.
- The dark and high-contrast values are derived from the light one. In the dark theme the page is
  the lowest surface, the panel (white in the light theme) one step above it, and what is a little
  darker than white in the light theme (hover, wells, chips) a little lighter than the panel; a state
  tint is made stronger so that it can be seen; body text is nearly white and dimmer greys keep
  their order; a border sits one step above the surface it is on. In the high-contrast theme every
  surface is black, text and borders are white, and a saturated fill is darkened until white text on
  it reads at 7:1.
- Meaning has a name in `styles.css` (`--text`, `--muted`, `--panel`, `--border`, `--orange`,
  `--orange-fill`, the `--verdict-*` set, `--chart-*`): style with those, not with the tokens.
- To change a colour: change its light value, or use a new `var(--t-bg-xxxxxx)` in a stylesheet,
  then run `node scripts/ui/themes.mjs tokens`. `node scripts/ui/themes.mjs check` fails on a hex,
  `rgb()`, `hsl()` or `color-mix()` literal in a stylesheet or a source file, and on a generated
  value that was edited by hand. What a derivation gets wrong is corrected in `theme.css`.
- Guards: `frontend/src/test/theme-contrast.test.ts` (WCAG contrast of the token pairs in all three
  themes, and that the themes define the same tokens), `accessibility.test.ts` (no text below 12px,
  every declared text colour readable on its surface, restrained decoration and motion) and
  `scripts/ui/themes.test.ts`. In the browser, `e2e/journey/themes.spec.ts` and
  `e2e/lab/shell.spec.ts` run axe in every theme.

### The scale

| Thing     | Variables in `styles.css`                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Type      | `--fs-xs` 12px, `--fs-sm` 13px, `--fs-md` 14px, `--fs-lg` 16px, `--fs-xl` 20px, `--fs-2xl` 26px, `--fs-hero` 34–54px |
| Spacing   | `--space-1` 4px, 2 8px, 3 12px, 4 16px, 5 24px, 6 32px, 7 48px                                                       |
| Radius    | `--radius-xs` 4px, `--radius-sm` 6px, `--radius-md` 8px, `--radius-lg` 12px                                          |
| Elevation | `--elevation-1` (a hairline lift), `--elevation-2` (a raised card or a dialog)                                       |
| Motion    | `--dur-fast` 120ms, `--dur-base` 200ms, `--ease`                                                                     |

Elevation is a solid shadow colour with a wide blur, so it needs no transparency. The colour is
`--shadow`: a light grey in the light theme, a dark surface in the dark theme and none in the
high-contrast theme. Not every existing rule uses the scale yet: the older, denser stylesheets keep
their own sizes where they were not part of this work.

## Decoration and motion

- A gradient and a grid appear on the landing hero and nowhere else. They are dropped in the
  high-contrast theme and under forced colours. Dense work areas never get either. A test fails
  if a gradient is added elsewhere.
- Motion is short and answers something the person did: a hover, a state change, a step marked
  done. It is on transform, border and background colours, never on text opacity, so that no scan or
  screenshot catches text half drawn.
- Under `prefers-reduced-motion: reduce` every transition stops and every animation is cut to a
  single frame (a global rule in `styles.css`); the card lift and the loading pulse are also not
  declared at all. Tests check both.

## Responsive

The shell changes layout at these widths:

- 1499px: the journey keeps numbers and draws the name of only the current step; at 1500px and wider
  all twelve names show. The names of the others stay in the page for a screen reader.
- 1199px: the header, which is one row from 1200px, takes two rows or, with a project's back
  button, sometimes three.
- 1120px: the stage list and the view control take their own rows. 1100px: the hero is one column
  and the path takes two rows of four. 1050px: the form and the side column stack.
- 900px: the console shows one pane at a time (Graph | Workbench; a Split view shows the Workbench), the
  header drops "LOCAL · SINGLE USER" and "/ CONSOLE" to save a row, and the project tools take their own
  row.
- 700px: the header's padding tightens.
- 640px (phone): 44px touch targets. Every custom control has one: the stakeholder toggles and rows, the
  disclosures of the intake, the comparison, the brief and the review, the brief's contents links, the
  entries of the history and the review's checkbox. The header is not sticky and its controls flow after
  the brand in the order of the page, with the model chip on a row of its own. The path runs on like a
  sentence and wraps between whole steps. The examples and the project tools are one row each that
  scrolls sideways. The five stage names share the width by what they need, so none is broken in
  two. A button that stands alone is as wide as its words on a desktop and takes the whole column on a
  phone. The Report page's bar reads Brief, Review and Details.
- 470px and 390px: the form's groups become one column.

No page scrolls sideways at 390px; the end-to-end specs check it. Pointer targets are at least 24px,
and 44px on a phone (`shell.spec.ts` measures them in the first stage, the stakeholders, the comparison,
the report and the dialogs). The actors' traits stack by the width of their own pane, not the window's.

## Accessibility rules

- Text is 12px or larger, and in every theme meets 4.5:1 (7:1 in the high-contrast theme) on the
  surface it is on.
- Colour is never the only signal: a done step has a check, a state has a word, a selected button
  has an outline.
- Every control has a visible keyboard focus (a 2px outline in the accent colour) and is reachable
  in a sensible order; the question is within the first ten tab stops of the entry page.
- Headings do not skip a level: one h1 per page, the form's heading is an h2.
- A disclosure is a native `details` element, so it works from the keyboard and without script.
- The header is sticky from 641px, so `html` has a `scroll-padding-top` (72px, and 140px below 1200px,
  where the header takes more rows) and a control that takes focus is never left under it. On a
  phone the header scrolls away instead of keeping a quarter of the screen.
- A control that moves the person to another stage moves focus to that stage, so that it is never
  lost to the page when the control goes away.
- Under forced colours (Windows high contrast) the fills that tell the stage in view and the chosen mode
  apart are gone, so each stage and each choice has a plain 2px edge; the current one has a 3px double edge
  in the system's highlight colour, which says it by its shape as well as its colour, and a stage that
  cannot be opened has a dashed one.
- A locked stage says that it is locked in words and says what it needs; the reason is also in the
  accessible name, in both modes.
- Changes of state that a person must hear about are in a `role="status"` or `role="alert"` region.

## Guards

- `frontend/src/lib/console.test.ts`: what opens each stage, the label and the lock under it, the
  journey, the view each stage opens in, and the next step for every state of the record.
- `ConsoleWorkspace.test.tsx` and `ConsoleAccessibility.test.tsx`: what the workspace renders from
  the record (including the view it starts in), and the stage names and their hidden context.
- `e2e/lab/journey-gates.spec.ts`: projects made through the API at each point of the way (nothing,
  graph built, stakeholders proposed, approved, actors, a comparison stopped, finished, reviewed,
  brief written) and read in the browser: what is locked and why, the path, the next step and where
  it leads, a comparison started, stopped and finished in the page, and the brief written there,
  each without a reload or a press of Refresh (these fail if the workspace stops looking for the
  change), Guided and Advanced, the keyboard and focus, a reload, the view each stage opens in and a narrow
  screen that does not keep the Workbench for good, three themes on a laptop and a
  phone, and the phone's header and stage names. `e2e/lab/shell.spec.ts` covers the first screen, the
  examples, the modes and the workspace in every theme.
- `e2e/lab/stakeholders.spec.ts`: the stakeholder review through the real screens, for three examples, with
  the stage's own button on the screen at laptop size, on a phone, from the keyboard, and in every theme.
- `e2e/lab/analysis.spec.ts`: the Simulation stage, its progress, its refusals and what it says and must
  not say. `e2e/lab/examples.spec.ts`: the flagship demonstrations and a question of the person's own, from
  the first screen to the exported brief, in the page. `e2e/lab/deep-dive.spec.ts`: the engine's own stages
  on the approved actors, with the report below the brief.
- `e2e/lab/entry-screen.spec.ts` and `e2e/lab/intake.spec.ts`: the first screen (the bar that keeps Build
  Graph in reach, the folded cards, the starter card, the scenario's own bar) and the edits to the scenario
  that was read. `components/console/ExamplePicker.test.tsx`, `entryReadiness.test.ts` and
  `components/intake/ScenarioIntake.interaction.test.tsx` hold the same at the component.
- `e2e/lab/report-page.spec.ts`: the Report page (open and closed sections, the contents, the addresses
  that open a section, the bar, the review's status, printing, axe) and `e2e/lab/freshness.spec.ts` (what a
  change made in another tab or on the same page does to the brief and the review).
  `components/brief/ReportSeam.test.tsx`, `reportNavigation.test.ts` and `components/critics/reviewStatus.test.ts`
  hold the bar, the choice of what is open and the review's words at the component.
- `frontend/src/test/accessibility.test.ts` and `components/brief/briefStyles.test.ts`: no text below 12px in
  any stylesheet, readable pairs in every theme, and the brief's layouts for a narrow screen and for print.
  `components/console/HistoryDrawer.test.tsx` and `lib/audit.test.ts`: a saved project opens by a button that
  says so, and every action the backend records has a plain label.

## Not done

- No new screenshots were made for the README or `docs/assets`.
- The opening stage is the engine's, not the lab's: a project with a finished comparison still opens
  in Graph Build, and the next step bar is what points on. Choosing the opening stage from the
  record was left out so that where a project opens does not change under the specs and the people
  that rely on it.
- Run settings (mode, proxies, rounds, seed) are still in front of every first-time visitor, in a
  quiet group. Putting them behind a disclosure needs the specs that fill them in to change.
- The names and reasons of the stages were checked with accessible-name queries, axe and keyboard
  tests, not with a screen reader.
- Windows forced-colours mode has rules, and `e2e/lab/shell.spec.ts` reads the computed edges of the stages
  and of the Guided and Advanced choice under the browser's emulation of forced colours; Windows high
  contrast itself was not tried.
- The older stylesheets (stages, report, charts, ledger, studio and others) were not restyled; only
  the shared radii, the focus and the colour palette reach them.
