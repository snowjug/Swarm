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
  `shared/example-scenarios.ts`. Choosing one fills the project name, the question and the
  documents with their provenance, clears any scenario read from an earlier question, says what was
  loaded, and moves focus to the question. An example brings a question and evidence, nothing
  else: no scenario, stakeholder or result comes with it. With an empty list the picker still
  offers the fictional starter input, so it is never an empty box. On a phone the examples sit in
  one row that scrolls sideways, so that six of them do not push the evidence far down the page.
- **The scenario** is read by `ScenarioIntake`, mounted between the question and the evidence. The
  frame it returns is held in the entry form and sent as `scenario` in the create request when
  present; the request is validated with the same schema as any other.
- **Evidence** is `SourceInput` (files and pasted text) and, when the server reports
  `urlIngestion: true`, the `UrlEvidence` panel. A fetched page is added to the same list of documents
  with its provenance. There is exactly one file input on the page.
- **Run settings** (mode, fictional proxies, rounds, random seed) stay visible under the evidence, in
  a quiet group. They were not put behind a disclosure because the end-to-end specs fill them in
  directly.
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
  Duplicate as guided and Export JSON.
- **A project opens at the stage the engine is at**, which for a project made in the lab is usually
  Graph Build, whatever the lab has done since. The next step bar below is what says where the work
  has got to.

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
the record allows it, it opens without a reload: opening Simulation or Report reads the project
again, and while a comparison runs and either is in view the page reads it again every four
seconds (`useLabRefresh`).

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
being a tab stop) and, if only the graph was showing, shows the workbench; the keyboard then
continues inside the stage. Where the work is more than a click, the stage still has its own
primary button: the bar only says where to go.

### The journey

`JourneyStrip` shows twelve steps: Question, Evidence, Stakeholders, Actors, Scenarios, Run,
Progress, Results, Explore, Change, Compare, Export. It follows the stage in view and is not
navigation. A step is marked done only when the project's own record shows it, by the engine's
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

## Seams: where a feature adds a panel

A seam is a place in the shell where a feature's component is mounted. The layout reserves no room
for one that has nothing to show.

| Component           | Where                                                 | Props                               | Only for             |
| ------------------- | ----------------------------------------------------- | ----------------------------------- | -------------------- |
| `ScenarioIntake`    | Entry form, between the question and the evidence     | question, frame, onFrame, disabled  | New projects         |
| `UrlEvidence`       | Entry form, under the evidence                        | onAdd, disabled, remainingDocuments | `urlIngestion: true` |
| `StakeholderPanel`  | Env Setup, under the stage heading                    | project, onChanged                  | Guided projects      |
| `AnalysisPanel`     | Simulation, under the heading, above the run controls | project                             | Guided projects      |
| `DecisionBriefView` | Report, above the report, full width                  | project                             | Guided projects      |
| `CriticPanel`       | Report, after the brief                               | project                             | Guided projects      |

The Report seams sit in a stack (`.seam-stack`) above the existing report. When the stack has
content, the heading "Detailed report" appears between it and the report; when it is empty, neither
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

- 1499px: the journey keeps numbers and names only the current step; at 1500px and wider all twelve
  names show.
- 1199px: the header, which is one row from 1200px, takes two rows or, with a project's back
  button, sometimes three.
- 1120px: the stage list and the view control take their own rows. 1100px: the hero is one column
  and the path takes two rows of four. 1050px: the form and the side column stack.
- 900px: the console shows one pane at a time (Graph | Workbench), the header drops "LOCAL · SINGLE
  USER" and "/ CONSOLE" to save a row, and the project tools take their own row.
- 700px: the header's padding tightens.
- 640px (phone): 44px touch targets. The header is not sticky and its controls flow after the brand
  in the order of the page, with the model chip on a row of its own. The path runs on like a
  sentence and wraps between whole steps. The examples and the project tools are one row each that
  scrolls sideways. The five stage names share the width by what they need, so none is broken in
  two.
- 470px and 390px: the form's groups become one column.

No page scrolls sideways at 390px; the end-to-end specs check it. Pointer targets are at least 24px,
and 44px on a phone.

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
- A locked stage says that it is locked in words and says what it needs; the reason is also in the
  accessible name, in both modes.
- Changes of state that a person must hear about are in a `role="status"` or `role="alert"` region.

## Guards

- `frontend/src/lib/console.test.ts`: what opens each stage, the label and the lock under it, the
  journey, and the next step for every state of the record.
- `ConsoleWorkspace.test.tsx` and `ConsoleAccessibility.test.tsx`: what the workspace renders from
  the record, and the stage names and their hidden context.
- `e2e/lab/journey-gates.spec.ts`: projects made through the API at each point of the way (nothing,
  graph built, stakeholders proposed, approved, actors, a comparison stopped, finished, reviewed,
  brief written) and read in the browser: what is locked and why, the path, the next step and where
  it leads, a comparison from running to finished without a reload, Guided and Advanced, the
  keyboard and focus, a reload, three themes on a laptop and a phone, and the phone's header and
  stage names. `e2e/lab/shell.spec.ts` covers the first screen, the examples, the modes and the
  workspace in every theme.

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
- Windows forced-colours mode has rules but was not exercised in a browser.
- The older stylesheets (stages, report, charts, ledger, studio and others) were not restyled; only
  the shared radii, the focus and the colour palette reach them.
