# 0015. The interface is a set of scenes on a design system

Status: Accepted. Built. The rules below that a test can hold are held by tests (see Evidence), and
the engine, the API and the data model did not change. **The interface is new and has been used far
less than the one it replaces.** No screen reader, no real touch device and no Windows high-contrast
session was used to check it; the browser's emulation of forced colours stands in for the last.

## Context

The interface Swarm shipped with was a console built around the engine's five stages: Graph Build,
Env Setup, Simulation, Report and Interaction, laid out as Graph, Split or Workbench. The scenario
lab ([ADR 0014](./0014-scenario-lab.md)) was added to it as panels mounted at seams inside those
stages, and a twelve-step strip and a next-step bar pointed from the stage a person was in to the
stage where the work had got to. It worked and it was tested, and it had three costs.

- **The structure belonged to the engine.** The journey the product is about, a question to a
  decision, was drawn over a layout that named the engine's stages, so a person met the engine's
  vocabulary before they met their own question.
- **The simulation was a panel in a stage.** What a person has come to see, how a change lands on the
  parties around it and how that moves, was a table and a chart among others.
- **There was no system under the look.** The last record of that design says that the older
  stylesheets (the stages, the report, the charts, the ledger, the studio and others) were not
  restyled, and that only the shared radii, the focus and the colour palette reached them. The dark
  and high-contrast palettes were computed from the light one by a script.

## Decision

1. **Rebuild the interface as scenes along the journey.** The journey is Ask, Ground, Map, Simulate,
   Compare, Decide. It is one page, and the address holds the state:
   `/?project=<id>&scene=<scene>&view=<view>`. A scene is a lazily loaded module with a default export
   and no props, in `frontend/src/scenes/<scene>/`. It reads the open project and drives it through
   one context, `useWorkspace()`. The shell (`frontend/src/app/`) owns what no scene should: the
   polling, the engine operations, the address, the focus, the page title and the command palette
   (Ctrl or ⌘ K) that reaches every scene and setting. A scene that the
   project's record cannot yet support is locked, and says what opens it.
2. **Build every scene on one design system**, `frontend/src/design/`. Tokens live in one file with
   three themes (light, dark, high contrast), the cascade has a fixed order
   (`@layer tokens, base, components, scenes, utilities`), and primitives, a motion system and an
   ambient background are shared. Glass is for things that float (the top bar, the dock, popovers,
   sheets, dialogs, toasts and the composer) and never for content.
3. **Show only what the engine holds.** Every number, shape and movement comes from the project's
   record. Nothing is mocked: an empty list, a run with no events and a figure not yet known are said
   to be so. The wording that keeps a result honest stays on the screen where it matters: Swarm
   explores scenarios and does not guarantee or precisely predict real-world behavior, the actors are
   synthetic stand-ins, and a count is a count of simulated members.
4. **Keep the engine and its contracts.** `backend/src/` and `shared/` are as they were, and so are
   the routes, the validation, the provenance of evidence, the audit log and the security model. The
   data layer of the front end (`api/`, `hooks/`, `lib/`) is reused. What moved is pure logic that
   the old components had held (the stakeholder review rules, now `lib/stakeholders/`).
5. **Hold these constraints, each by a guard that fails when it is broken:**
   - the content-security policy is unchanged: scripts, connections, fonts and images from this
     origin only (images also as `data:`), and styles from this origin and inline. Fonts are bundled
     with the application, and no source of the interface may load a resource of another origin;
   - no raw HTML sink anywhere in the interface: server text is rendered as text;
   - colour is a token. A hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()` or `oklch()`
     literal outside `design/tokens.css` (and the browser-chrome colours in `lib/theme.ts`) fails the
     colour check;
   - every rule of every stylesheet is in a cascade layer, and `!important` appears only in
     `design/base.css`, for the utilities that hide things and the reset that stops motion;
   - no text is smaller than 12 pixels, and every class is prefixed `sw-` (apart from `is-` states
     and two utilities);
   - the contrast of every text, meaning and graphic colour is computed from the tokens in each
     theme, with translucent surfaces laid over the lightest and darkest backdrop they can sit on;
   - a person's choice about motion and transparency is honoured: `prefers-reduced-motion` and the
     setting in the menu stop animation and transitions, `prefers-reduced-transparency`, the
     high-contrast theme and a browser that cannot blur what is behind a surface make glass opaque,
     and no keyframe animates a property that costs layout;
   - the interface imports nothing from the one it replaced.
6. **Draw the stakeholder ecosystem as SVG, from one loop.** The map is the hero of the Map scene and
   of the live view of Simulate. Every party is a real button, arrow keys move between parties, and
   the same parties are offered as a list. One animation loop writes positions straight to the
   elements, so that lines stay attached to the parties as they move.
7. **Take the engine's stage names out of the structure.** Graph Build, Env Setup, Simulation,
   Report and Interaction remain the engine's and the API's (`console.steps`: `knowledge`,
   `environment`, `simulation`, `report`, `interaction`). The interface names none of them in its
   journey, its navigation or its buttons. They are shown only where the engine's own record is the
   subject: the engine records of the deep dive, the Advanced status line of Ground, and the line in the
   deep dive that says what preparing its environment waits for. The slower
   agent-by-agent engine, its pause, scheduled event, branching and run comparison, its report and its
   chat stay whole, one gesture from Simulate (the deep dive) and from Decide (the detailed report
   and the studio).

## Rejected

- **Restyling the old console.** It would have kept the structure that named the engine's stages and
  the seams that panels were mounted in, and it would have had to reach a large body of stylesheets
  that the previous design had already left untouched. A new palette and new radii on the same
  structure answer none of the three costs above.
- **A component library as the visual layer.** A library brings its own look, and that look then has
  to be fought wherever Swarm needs its own: the glass rule, the editorial type, the motion
  vocabulary. The design system takes behaviour from Radix primitives (dialogs, popovers, menus,
  tabs, sliders and tooltips: focus is trapped and returned, escape and arrows work) and writes every
  surface itself, from tokens.
- **Canvas or WebGL for the map.** A canvas has no buttons: every party would need a second, hidden
  layer of elements to be reachable from the keyboard and by a screen reader, and its colours would
  have to be read from the tokens by script. The map holds tens of parties, not thousands (the
  stakeholder review holds at most 40), so drawing is not the limit. The one canvas in the interface
  is the ambient field behind the question, which is decoration and never imitates data.

## Consequences

- The journey is the navigation. A link, a reload and the browser's Back button land where a person
  was, and a link to a scene that is not yet open lands on the scene the project's record has
  reached.
- A scene is a chunk of its own, fetched when it is opened or about to be, so a person who has opened
  the first screen has not fetched the map or the report.
- A feature adds a scene, a view or a panel by a contract (the address, `useWorkspace()`, the tokens,
  the primitives), not by editing another feature. [UX.md](../UX.md) says how.
- The interface now depends on `motion` and on six Radix packages, and bundles three typefaces
  (Geist, Geist Mono and Instrument Serif). They are libraries and fonts that this repository ships
  with itself, so the policy above did not have to change.
- The policy still allows inline styles, because the interface sets some styles inline (a stagger
  index, the colour of a progress ring). That is a standing cost of how it is drawn.
- The browser tests, the demonstration scripts and most of the documents that described the old
  screens had to be written again, and the engine's stage names in them are now the engine's.
- Nothing about the engine's fidelity changed. A result is still a simulation of synthetic actors
  under stated assumptions, and a more beautiful screen is not more evidence about the world.
- **Not done** (each item, and where it is checked, is in [UX.md](../UX.md#not-done)): a screen reader
  has not been used on it, nor a real touch device or Windows high contrast, and backdrop blur was judged
  at a device-pixel ratio of 1 only; the themes were written by hand and checked by computed contrast, not
  reviewed by a designer; the browser's Back button is not asked about where the Map or the studio holds work
  that is not saved, and the first screen's question, the Simulate setup's alternatives and the deep dive's setup
  are not held as unsaved work at all; the People and Who has access dialogs close with Done and have no close
  mark; Export snapshot is the engine's record of the project as JSON and not the decision brief, whose
  export is in Decide; the Compare point on the journey stays "ready"; the actor API refuses to add,
  remove, rename or regroup an actor; full motion does not reach two component rules; and the
  database-location warning is not shown.

## Evidence

What each guard holds is in [UX.md](../UX.md#guards). The results of a run are not recorded here; the
[testing guide](../TESTING.md) is where they are kept.

- `frontend/src/test/ui-guards.test.ts` (type floor, cascade layers, `!important`, the `sw-` prefix,
  layout-free keyframes, reduced motion and transparency, no import of the old interface, no
  raw-HTML sink, no resource of another origin), `frontend/src/test/design-contrast.test.ts` with
  `design-palette.ts` (contrast in each theme), and `scripts/ui/colours.mjs` with
  `scripts/ui/colours.test.ts` (no colour literal outside the tokens).
- `frontend/src/app/scenes.test.ts` (what opens each scene and what the journey says of it), the
  scene tests beside each scene, and the interaction tests that click, type and tab through the
  first screen, the map, the playback, the command palette and the primitives in a simulated DOM
  (`frontend/src/app/commands.test.ts` holds what the palette offers and how it searches).
- `backend/test/stakeholders-neutrality.test.ts` and `backend/test/brief-neutrality.test.ts`, which
  now read the sources of the scenes that show stakeholders and the brief, and keep every market,
  product and industry word out of them.
- The browser projects in `e2e/` (axe-core in each theme, keyboard use, reduced motion, responsive
  layout and the journey from the question to the brief) and `npm run audit:ui`, which records
  screenshots and layout and accessibility metrics of every scene and asserts nothing.
