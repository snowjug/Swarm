# The population simulator

The simulator turns a cast of actors (key actors and cohorts) into the outcome of one scenario
variant on one seed. It is the engine under repeated-run analysis: the analysis calls it many times
with different seeds and variants and reports what holds across the runs. This page says what the
simulator assumes, how a round works, and what its results cannot tell you.

Code: [`backend/src/simulation/`](../../backend/src/simulation/). Contract: `Simulator`,
`SimulationSpec`, `Variant` and `RunOutcome` in [`shared/analysis.ts`](../../shared/analysis.ts).
Speed and memory: [engine-benchmark.md](engine-benchmark.md).

## What an outcome is, and is not

- **A mechanical consequence of declared assumptions.** Every number follows from the actors' traits,
  the relations between actors and the variant. Nothing is looked up, learned from data or decided by a
  model. The traits keep their own origin labels (evidence, user, system assumption, model); an outcome
  is exactly as well founded as the assumptions it was run on.
- **Not a forecast.** Swarm explores scenarios. It does not guarantee or precisely predict real-world
  behaviour, and one run is one draw of a seeded process, never "the answer".
- **Synthetic actors are not people.** A share in an outcome is the share of an actor's _simulated_
  members in a response category. It is not a conversion, churn, adoption or sentiment rate for any
  real population. The population an actor stands for (`size`) is a modelling assumption; it is never
  reported (see "Weights").
- **Origin of what comes out:** simulation aggregation of actor behaviour. Each actor behaves
  according to its traits (user, system or evidence assumptions), and external responders react
  according to the generic rules below.

## Using it

```ts
import { simulate } from './backend/src/simulation/simulate.js';
const outcome = simulate(spec, seed, { sampleSizeCap: 50, signals: true });
```

| Input                   | Meaning                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `spec`                  | Actors (1 to 60), relations (up to 240), rounds (3 to 36), one variant. Validated with the schema.    |
| `seed`                  | A whole number from 1 to 2,147,483,647. The only source of variation between runs.                    |
| `options.sampleSizeCap` | Most members any cohort simulates (default 200). The cost of a run is linear in members times rounds. |
| `options.signals`       | `false` turns off the signals and the external responders: plain stance dynamics. On by default.      |

The outcome holds, for each round, the overall mean stance, the overall response shares, the mean
stance of each actor and the aggregate signals; at the end, the same per actor with the number of
members simulated; the events (below); and `work`, which counts the members simulated and the member
updates (members times rounds). Individual members are never kept.

`simulateValidated(spec, seed, options)` is the same for a spec that has already been through
`simulationSpecSchema`. Validating a cast of 20 actors takes about 0.5 ms, roughly a fifth of a run of
that size, so a caller that runs one spec on many seeds can parse once and call this.

The simulator throws `SimulationInputError` (with a sentence a person can act on) for a seed or cap
out of range, two actors with one id, and a variant that sets the impact of, or edits a trait of, an
actor that is not in the cast or edits something that is not a trait. A spec that fails the schema
throws the schema's error. Relations that name an actor that is not in the cast, name one actor twice,
or have no strength are ignored.

## From actors to members

- A **key** actor is one member at the actor's trait values, with no spread.
- A **cohort** has `min(sampleSize, cap)` members. Each member's trait is drawn from a normal
  distribution around the actor's trait value with the trait's `spread`, cut off at the trait's range
  (0 to 1, or -1 to 1 for `priorStance` and `impact`). Traits are drawn independently; there are no
  correlations between traits.
- The variant's `traitEdits` replace trait values (kept within range) before the draw, and
  `impactOverrides` replace the actor's `impact` value and win over an edit. The spread stays.

## One round

Every member has a stance `x` from -1 (against the change) to 1 (in favour), starting at the member's
`priorStance`. Each round all members are updated at once from the state of the round before:

```
x(t) = clamp( x(t-1) + social + change + events + noise )

social = SOCIAL_RATE x openness x (T - x)
change = intensity x PERSISTENCE^(t - r) x sensitivity x impact x trustAdoption          for t >= r
events = (ENABLE_LIFT x lift - SWITCH_PULL x pullSwitch) x max(0, -x)
         - SCRUTINY_PULL x scrutiny x (1 - riskTolerance)
noise  = NOISE x (0.5 + reactivity) x (2u - 1)

trustAdoption = 1 + sign(impact) x (0.8 x (trust - 0.5) + 0.4 x (adoptionTendency - 0.5))
```

- **social.** `T` is the influence-weighted stance of what the actor listens to: its own cohort (when it
  has more than one member) and the actors related to it, weighted by relation strength, by the
  other actor's influence and by its population weight. A relation is a channel in both directions,
  except `influences` and `regulates`, which carry from the first actor to the second, and
  `competes-with` and `substitutes-for`, which carry none. This is the pull of the existing
  opinion-dynamics engine, `openness x (peer mean - stance)`, at a lower rate so that a cohort does
  not collapse into one view within a run.
- **change.** The variant's change lands in round `r` (`variant.round`) with strength `intensity`. It
  is felt in full that round and half as much each round after (`PERSISTENCE`); what it moved stays
  moved. How it lands on a member is the member's `impact` (-1 harms, 1 benefits) times its
  `sensitivity`; trust and readiness to take something new soften a harm and strengthen a benefit when
  high. A change whose round is after the last round never lands.
- **events.** Pressures that external responders' events have added to the actor (below), which fade
  by half each round. Discontented members (`x < 0`) are drawn toward leaving by an alternative that
  has appeared, or lifted back toward neutral by help; scrutiny weighs on members in proportion to how
  little risk they accept.
- **noise.** A seeded uniform draw per (actor, member, round), about the size of the noise in the
  existing engine (plus or minus 0.02 at average reactivity).

Every term is bounded and every division is guarded, so a stance cannot leave [-1, 1] or become NaN
(the tests fuzz this). Without events the update is monotone in every stance, so when the change harms
every member it touches, a stronger change never leaves anyone more favourable on the same seed.

### What each trait does

| Trait              | Where it enters                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `priorStance`      | The member's starting stance.                                                                           |
| `impact`           | Direction and size of the change's push; which actors the change harms or benefits (signals).           |
| `influence`        | A member's weight in what its actor "says" to others; with population, the actor's voice.               |
| `openness`         | How far a member moves toward what it listens to.                                                       |
| `sensitivity`      | Scales the push of the change.                                                                          |
| `riskTolerance`    | Whether a member counts as risk averse (risk-concern signal); scrutiny's pull; a responder's threshold. |
| `switchingCost`    | Whether a member who is clearly against looks for an alternative or resists; lowered by alternatives.   |
| `trust`            | Softens a harm, strengthens a benefit (about twice as strongly as readiness below).                     |
| `adoptionTendency` | The same, more weakly.                                                                                  |
| `authority`        | A responder's threshold and the strength of its events. Not used by other actors.                       |
| `reactivity`       | The size of a member's noise; how many rounds late a responder sees a signal.                           |

### Constants

All are in [`parameters.ts`](../../backend/src/simulation/parameters.ts). None is measured: they are
modelling choices, and changing one changes results.

| Constant                           | Value    | Role                                                                                 |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `SOCIAL_RATE`                      | 0.15     | Pull toward what an actor listens to, per round at openness 1.                       |
| `PERSISTENCE`                      | 0.5      | Share of the change's push (and of an event's pressure) felt one round later.        |
| `NOISE`                            | 0.02     | Half-width of the noise at reactivity 0.5.                                           |
| `TRUST_WEIGHT`, `ADOPTION_WEIGHT`  | 0.8, 0.4 | How strongly trust and readiness scale the push.                                     |
| `AFFECTED_MIN`                     | 0.05     | An actor with impact smaller than this is neither harmed nor benefited.              |
| `COHORT_TIE`                       | 1        | Weight of an actor's own cohort in what it listens to.                               |
| `RISK_AVERSE_BELOW`                | 0.5      | A member below this risk tolerance is risk averse.                                   |
| `SWITCH_PULL`, `ENABLE_LIFT`       | 0.1, 0.1 | Pull of an alternative, and of help, on a discontented member, per unit of pressure. |
| `SCRUTINY_PULL`                    | 0.08     | Pull of scrutiny, per unit of pressure.                                              |
| `RELIEF_STEP`, `RELIEF_CAP`        | 0.4, 0.6 | How much an alternative lowers switching cost, per unit of strength, and the most.   |
| `PRESSURE_CAP`                     | 1        | Most pressure an actor can carry from events.                                        |
| `DEFAULT_TIE`, `FALLBACK_TIE`      | 0.5, 0.3 | Tie strength of a responder's default and fallback reach.                            |
| `MAX_EVENTS`, `MAX_EARLIER_CAUSES` | 200, 3   | Events a run can hold; earlier events an event lists as a cause.                     |
| `DEFAULT_SAMPLE_CAP`               | 200      | Default cap on members per cohort.                                                   |

## Responses

At the end of each round a member's response is read from its stance and its effective switching cost
(its own cost less the relief that alternatives have brought to its actor):

| Stance                  | Response                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| 0.35 or more            | `adopt`                                                              |
| 0.1 up to 0.35          | `accept-with-conditions`                                             |
| above -0.1, below 0.1   | `wait`                                                               |
| above -0.35, up to -0.1 | `adapt-defensively`                                                  |
| -0.35 or less           | `switch` if the effective switching cost is below 0.5, else `resist` |

`classifyResponse(stance, traits)` is this rule as a pure function, tested at every boundary. The wording
shown to people is `RESPONSE_MEANINGS` in `shared/analysis.ts`. The response is a reading of the
simulation, never an observed behaviour.

## Signals

Four aggregate readings of the members, computed per actor each round:

| Signal               | Share of an actor's members that...                       | About actors the change...       |
| -------------------- | --------------------------------------------------------- | -------------------------------- |
| `adverse-share`      | are at a stance of -0.1 or lower                          | harms (impact -0.05 or lower)    |
| `switching-pressure` | would `switch`                                            | harms                            |
| `adoption`           | would `adopt`                                             | benefits (impact 0.05 or higher) |
| `risk-concern`       | are at -0.1 or lower and tolerate little risk (below 0.5) | harms                            |

The value reported in a round is the mean over the actors the signal is about, each counting once (0
when there are none). External responders read the same per-actor values.

## External responders

Actors in `EXTERNAL_RESPONDER_CATEGORIES` react to the actors around them, not to the change itself.
Each follows one generic rule. No scenario, product or market is named anywhere in the engine (a test
searches its source for such words).

| Category     | Watches              | Emits              | Effect on the actors it reaches                                               |
| ------------ | -------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `competitor` | `adverse-share`      | `counter-move`     | Lowers switching cost (up to 0.6); draws discontented members toward leaving. |
| `substitute` | `switching-pressure` | `substitute-offer` | The same.                                                                     |
| `partner`    | `adverse-share`      | `enablement`       | Lifts discontented members back toward neutral.                               |
| `regulator`  | `risk-concern`       | `scrutiny`         | Pulls members down in proportion to how little risk they tolerate.            |

- **Lag.** A responder sees a signal `1 + round(2 x (1 - reactivity))` rounds late: 1 round above a
  reactivity of 0.75, 3 at 0.25 or below, otherwise 2.
- **Threshold.** `0.15 + 0.35 x riskTolerance + 0.25 x (1 - authority)`, from 0.15 (bold, powerful) to
  0.75 (tolerant, weak). It acts the first time the signal it sees (the mean over its reach of the
  signal as it stood `lag` rounds ago) is at or above it, and only once. It never acts if the signal
  is about none of the actors it reaches.
- **Strength.** `(0.4 + 0.6 x excess) x (0.5 + 0.5 x authority)`, where `excess` is how far past the
  threshold the signal was (0 at the threshold, 1 at the top), so from 0.2 to 1. An event lands on each
  actor it reaches with that strength times the relation strength, from the round after it is emitted.
  Pressures fade by half each round; the lowering of switching costs stays.
- **Reach.** The actors the responder is related to, in either direction, weighted by relation
  strength (and, when watching, by the actor's population weight). With no relations, the actors in
  the categories in `DEFAULT_REACH` (for example, for a competitor: end users, cost bearers,
  beneficiaries and channels) at a tie of 0.5. If none of the actors it reaches, by relation or by
  default, is harmed by the change, the harmed actors are added at a tie of 0.3, because there would
  otherwise be nothing to watch or act on.
- **Chains.** Every event has `causedBy`: first the signal it saw, then up to three earlier events that
  had already landed on an actor it was watching. The engine does not say which of those mattered;
  running the same seeds with `signals: false` shows what they did together. Because a responder acts
  once, there is at most one event per actor, so (kind, actor, round) is unique and a run holds at
  most 60 events (the cap is 200).

### Reading a chain

The abstract cast in [`backend/test/support/simulation-cast.ts`](../../backend/test/support/simulation-cast.ts):
Alpha is a cohort of 40 that the change harms (impact -0.6, switching cost 0.65, so without help its
members resist rather than switch); Beta is a competitor related to Alpha, and Gamma a substitute
related to Alpha. The change lands in round 2 at intensity 0.7, over 12 rounds, seed 3:

| Round | What happens                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | The change lands; Alpha's `adverse-share` is 1.00 from this round.                                                                                              |
| 4     | **e1** `counter-move` by Beta, `causedBy: ["adverse-share"]`: Beta sees the signal 2 rounds late (its reactivity is 0.5) and it is above its threshold of 0.34. |
| 5     | Alpha's effective switching cost falls below 0.5, so its members move from `resist` to `switch`: `switching-pressure` is 1.00.                                  |
| 6     | **e2** `substitute-offer` by Gamma, `causedBy: ["switching-pressure", "e1"]`: Gamma sees the signal 1 round late and acts.                                      |

Beta acts in round 4 and Gamma in round 6 on all of seeds 1 to 20. Averaged over those seeds, Alpha's
final mean stance is -0.84 with the responders and -0.67 without them (`signals: false`); its members
all end as `switch` with the responders and all but a few as `resist` without. Without Beta there is
no pressure to switch and so no second move: Gamma's event exists only because of Beta's. These are
consequences of the assumptions in that cast, shown to explain the mechanism.

## Reproducibility and common random numbers

Every random number is a pure function of the seed and labels: the draw for a trait is addressed by
(seed, actor id, member, trait) and the noise by (seed, actor id, member, round)
([`random.ts`](../../backend/src/simulation/random.ts)). Nothing is drawn from a shared sequence, so:

- The same spec and seed give byte-identical JSON, also from a copy of the spec or after a round trip
  through JSON (tested).
- Changing one actor's trait, adding or removing an actor, or reordering the cast leaves every unrelated
  actor's draws, and so its outcome, exactly as they were (tested). Actors are related when a relation
  or a responder's reach links them; an external responder with no relations reaches actors by
  default, so adding one can change those.
- Traits are drawn through the inverse distribution function, so a changed trait moves each sample
  smoothly with its draw. Paired runs on the same seeds are therefore far steadier than independent
  runs (tested: the standard deviation of paired differences is under a third of the independent one),
  which is what the sensitivity analysis depends on.
- A cap on the sample keeps the first members of a cohort as they were; it only drops the rest
  (tested).
- Reproducibility is for one build of Node. Drawing a cohort's traits uses `Math.exp` and `Math.log`,
  and a different build could in principle round them differently in the last digit, which could in
  rare cases move a member across a threshold. Re-running an analysis on another build can therefore
  differ slightly; it was not tested across builds.

## Weights

- Every overall figure (mean stance, response shares, signals) gives each **actor** the same weight,
  whatever its `size` or its number of members. Overall figures are not rates in any population.
- `size` is used for one thing: how much an actor counts in what other actors listen to and in what a
  responder watches, as `1 + log10(size)` (so a cohort standing for a million counts about seven times
  one standing for one). With no relations and no responders `size` changes nothing (tested). It is
  never reported.
- `sampleSize` is the diversity and the cost of a cohort. A smaller sample makes a cohort's mean noisier
  (by about the square root of the ratio) without changing what it stands for.

## Relation to the existing opinion-dynamics engine

The deep-dive run ([`agents/local.ts`](../../backend/src/agents/local.ts)) moves each agent's opinion by
`openness x (influence-weighted mean of a few peers - opinion)`, plus a push toward a target stance in
the round of an intervention, plus noise of plus or minus 0.02. The simulator keeps those terms and
changes how they are applied:

|                          | Existing engine                                       | This simulator                                                                     |
| ------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Who is simulated         | Agents, each with its own opinion                     | Actors: key actors and cohorts of sampled members                                  |
| Whom a member listens to | Four or five peers chosen each round                  | The actor's own cohort and related actors, as one weighted mean                    |
| Rate of the social pull  | `openness`                                            | `0.15 x openness`                                                                  |
| The change               | One push, once: `strength x (target - opinion) x 0.6` | `intensity x sensitivity x impact`, in full in its round and half each round after |
| Noise                    | Uniform, plus or minus 0.02                           | Uniform, plus or minus 0.01 to 0.03 by reactivity                                  |
| Second-order effects     | None                                                  | External responders                                                                |

Both are bounded, both pull toward influence-weighted means, and a stronger push moves the mean further
in the pushed direction in both (a test runs the two side by side and checks directions, not values).
The two are not calibrated against each other and will not agree numerically; the cross-check in an
analysis only asks whether the deep-dive result falls inside the spread of the ensemble.

## What it cannot tell you

- **Whether any assumption is true.** The traits, the relations and the constants above are assumptions.
  Where a trait is a system assumption the result is as unfounded as that assumption. The sensitivity
  analysis shows which assumptions the outcome depends on; it does not make them right.
- **Magnitudes in the world.** Nothing here is calibrated against observed behaviour, and no backtest
  has been done. A harmed cohort under a strong change usually ends at the end of the scale, where
  shares say little beyond "all of the simulated members".
- **Anything not modelled.** A stance is one number about one change. Members have no memory, learn
  nothing and share no information beyond the stance. Traits are independent. The change lands once;
  staged or repeated interventions are separate variants. A responder acts once, watches one signal and
  does not escalate; responders see one another only through the population. Relation types have no
  meaning beyond the channel rules above.
- **Why.** The events say which signal a responder saw and which earlier events had landed on the actors
  it watched; they are a record of the mechanism, not an explanation of any real organisation.

## Tests

Focused tests under `backend/test/` (run with `npx vitest run backend/test/simulation-*.test.ts`):

- `simulation-random.test.ts`: streams are addressed, independent and uniform; the normal functions match
  known values; truncated samples stay in range and move smoothly.
- `simulation-response.test.ts`: every threshold boundary, and agreement with the rule above across the
  whole scale.
- `simulation-engine.test.ts`: byte-identical runs, seeds that differ, bounds and NaN fuzzing over
  random specs, common random numbers, a baseline near its prior, monotonicity in intensity, the
  persistence equation, overrides and edits, relations, weights, work counters and the cap, the signals,
  and the direction of the existing engine.
- `simulation-chain.test.ts`: lag, threshold and strength of responders, the Alpha, Beta and Gamma
  chain with and without relations, what each kind of responder does, and event bounds.
- `simulation-neutrality.test.ts`: the engine source contains no scenario words and no clock, network
  or `Math.random`.
