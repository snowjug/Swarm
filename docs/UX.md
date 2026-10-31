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
  on a phone the introduction is shorter so that the field starts on the first screen.
  The project name is optional: when it is empty, it is the start of the question
  (`nameFromQuestion` in `lib/entryValidation.ts`).
- **Examples** (`ExamplePicker.tsx`) are read from `EXAMPLE_SCENARIOS` in
  `shared/example-scenarios.ts`. Choosing one fills the project name, the question and the
  documents with their provenance, clears any scenario read from an earlier question, says what was
  loaded, and moves focus to the question. An example brings a question and evidence, nothing
  else: no scenario, stakeholder or result comes with it. With an empty list the picker still
  offers the fictional starter input, so it is never an empty box.
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
| Stage steps          | The engine's name, its state, and a line of help | The engine's name and state only |
| Entry: readiness     | One line, details a click away                   | Details open                     |
| Entry: engine stages | One click away                                   | Open                             |
| Project details      | Project ID and usage a click away                | Open                             |
| Operation log        | One line, expandable                             | Expanded                         |

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
- **The journey** (`JourneyStrip.tsx`) shows twelve steps: Question, Evidence, Stakeholders, Actors,
  Scenarios, Run, Progress, Results, Explore, Change, Compare, Export. It follows the stage in view
  and is not navigation. A step is marked done only when the project's own record shows it:
  evidence when Graph Build is ready; stakeholders, actors and scenarios when Env Setup is ready; run
  when the simulation has started; progress when it is ready; results when the report is ready;
  change when the project is a branch or carries an intervention. Explore, Compare and Export leave
  no mark on a project, so they are never shown as done.
- **Project tools** groups Audit log, Access (when people sign in), Budget (model projects),
  Duplicate as guided and Export JSON.

## Seams: where a feature adds a panel

A seam is a place in the shell where a feature's component is mounted. Each renders nothing today
or until its feature fills it in, and the layout does not reserve room for it.

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

1. Replace the body of the placeholder in the feature's own folder and keep its props.
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

The shell changes layout at these widths: 1239px (the journey keeps only the current label), 1100px
(the path on the first screen takes two rows of four; the hero is one column), 1050px (the form and
the side column stack), 900px (project tools take their own row), 700px and 640px (phone: two-column
path without captions, 44px touch targets) and 470px. No page scrolls sideways at 390px; the
end-to-end specs check it. Pointer targets are at least 24px, and 44px on a phone.

## Accessibility rules

- Text is 12px or larger, and in every theme meets 4.5:1 (7:1 in the high-contrast theme) on the
  surface it is on.
- Colour is never the only signal: a done step has a check, a state has a word, a selected button
  has an outline.
- Every control has a visible keyboard focus (a 2px outline in the accent colour) and is reachable
  in a sensible order; the question is within the first ten tab stops of the entry page.
- Headings do not skip a level: one h1 per page, the form's heading is an h2.
- A disclosure is a native `details` element, so it works from the keyboard and without script.
- Changes of state that a person must hear about are in a `role="status"` or `role="alert"` region.

## Not done

- No new screenshots were made for the README or `docs/assets`.
- The seams render nothing until the features behind them are merged, so how they look inside the
  shell is not seen here.
- The examples list is filled by another part of the work; the picker was seen with test examples
  only.
- Windows forced-colours mode has rules but was not exercised in a browser.
- The older stylesheets (stages, report, charts, ledger, studio and others) were not restyled; only
  the shared radii, the focus and the colour palette reach them.
