# Swarm design system

How the interface is built. Read this before adding or changing a screen.

## The idea

Swarm should feel like a calm, expensive instrument: one idea per screen, the answer first, depth on request.

- **Whitespace and type group things, not boxes.** Before adding a card, border or panel, ask whether it needs a
  visible rectangle. Content that sits on the page (charts, lists, text) is _not_ put in a container. Use a
  hairline (`.sw-rule`, `border-bottom: 1px solid var(--hairline)`) or space instead.
- **Glass is for things that float:** the top bar, the dock, popovers, sheets, dialogs, toasts and the composer.
  Never nest glass in glass. Never put long text on glass without checking its contrast over the aurora.
- **The simulation is the hero.** Data visualisation is drawn straight onto the page, large, with light and motion.
- **Little English.** Default screens speak through hierarchy, numbers, state and direct manipulation. Method,
  provenance and caveats live in `Disclosure`, tooltips, popovers and sheets — one gesture away, never gone.
  Responsible-use wording that matters (not a forecast; synthetic actors; simulated counts) stays visible, short.
- **Nothing is faked.** Every number, shape and movement comes from the engine's data. Decorative motion (the
  ambient field, the aurora) never imitates data.

## Using it

```ts
import './design/fonts'; // once, in main.tsx
import './design/index.css'; // once, in main.tsx
import { Button, Chip, Sheet, … } from '../design/ui';
```

- **Layers.** Every stylesheet puts its rules in `@layer components` (shared pieces), `@layer scenes` (one scene) or
  `@layer utilities`; `tokens.css` alone is outside the layers, and holds nothing but custom properties. Class names
  are prefixed `sw-` and named for the component (`sw-ground__rail`); a state is a second class, `is-on`, `is-open`.
  Do not use `!important` (only `.sr-only` and the reduced-motion reset do). `src/test/ui-guards.test.ts` holds all of this.
- **Tokens.** Colour, space, radius, type, shadow, blur, duration and easing all come from `tokens.css`. Do not write a
  raw colour or a magic duration. Pairs the tests hold: `--ink`/`--ink-2`/`--ink-3` on `--bg` and on glass (≥ 4.5:1,
  7:1 in high contrast); the data colours ≥ 3:1 as graphics. Font sizes are never below `--fs-micro` (12px).
- **Meaning is never colour alone.** Pair `--c-against` (ember) / `--c-favor` (teal) / `--c-neutral` / `--c-caution` /
  `--c-critical` with a word, an icon or a shape. Stance runs on a diverging scale (against ↔ in favour).
- **Type.** `.sw-hero` / `.sw-display` / `.sw-title` are the serif (Instrument Serif) for what is _said_ — the question, the
  answer, a number that matters (`.sw-numeral`). The grotesque (Geist) is for everything that is _done_. `.sw-eyebrow`
  is the small uppercase label. Reading text uses `.sw-read` (17px, 68ch).
- **Layout.** The document scrolls (no nested scrollers except sheets). Content width: `--w-content` (72rem) for most
  scenes, `--w-wide` for the theatre; horizontal padding `--gutter`. The fixed top bar is `--topbar-h` tall and the
  mobile dock `--dock-h`; scenes pad their top with `calc(var(--topbar-h) + var(--s-6))`.
- **Touch.** Controls are ≥ 2.75rem on `(pointer: coarse)`; the primitives do this for you.

## Motion

Motion is a system, not decoration. See `motion/tokens.ts` and `motion.css`.

| Use                        | Curve                        | Time       |
| -------------------------- | ---------------------------- | ---------- |
| hover, press, focus        | `--ease-spring-snappy`       | 90–260 ms  |
| content arriving           | `.sw-rise` (+ `--i` stagger) | 480 ms     |
| panels, sheets, popovers   | spring `smooth` / `snappy`   | 260–480 ms |
| scene change               | crossfade + 24px travel      | ≤ 420 ms   |
| numbers the engine reports | `useTween` (ease-out)        | 700 ms     |
| a thing that just happened | `sw-pulse-ring`              | once       |

Rules: only `transform` and `opacity`; springs for things that are moved, short ease-outs for things that appear;
every animation interruptible (re-target, never queue); entrances ≤ 0.5 s except user-started cinematic ones;
stagger step 40 ms, capped at 360 ms. **Reduced motion:** the CSS reset makes durations ~0; `useReducedMotion()` for
script/canvas; `m` components follow `MotionConfig` automatically. Ambient loops stop; the change itself is still shown.

## Components (`design/ui`)

`Button` (variants `primary` — the one action; `accent` — the single "go"; `glass`; `ghost`; `danger`) · `IconButton`
(needs `label`) · `Tooltip` · `Chip` / `ChipButton` · `Segmented` (one of few) · `Tabs` (views of one thing, with panels) ·
`Field` + `Input` / `Textarea` (autosizing) / `Select` / `Switch` · `Slider` · `Popover` · `Menu` · `Sheet` (side / bottom on
phones) · `Dialog` · `Meter` · `Ring` · `Skeleton` · `Disclosure` · `Toast` (`useToast`) · `Notice` · `EmptyState` · `Stat`
(number + label, tweens) · `Orbit` (loader) · `Mark` (logo). Ambient: `Aurora`, `SwarmField`. See `/gallery.html` in dev.

## Accessibility

Every interactive thing is a real button/link/input with a name. Every chart has a text alternative (`role="img"` +
`aria-label` summarising it) and the same data as a table or list for keyboard and screen-reader use. Focus is visible
(`--focus-ring`). Dialogs/sheets/popovers are Radix: focus is trapped and returned. Live status uses `role="status"`
(polite) and `role="alert"` for failures that need action. Respect `prefers-reduced-motion`,
`prefers-reduced-transparency`, `forced-colors` and the high-contrast theme (glass becomes opaque and outlined).
