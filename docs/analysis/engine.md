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
`simulationSpecSchema`. Validating a cast of 20 actors takes about 0.6 ms, roughly a quarter of a run of
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
  correlations between traits. With a spread of 0.1 to 0.15, which is what generated actors usually
  have, the members of a cohort end in different responses (see "Where a member settles").
- The variant's `traitEdits` replace trait values (kept within range) before the draw, and
  `impactOverrides` replace the actor's `impact` value and win over an edit. The spread stays.

## One round

Every member has a stance `x` from -1 (against the change) to 1 (in favour), starting at the member's
`priorStance`, and is anchored to a stance of its own. Each round all members are updated at once from
the state of the round before: each closes a share of the gap to its anchored stance, is drawn toward
what it listens to, and is nudged by noise.

```
x(t) = clamp( x(t-1) + rate x (target - x(t-1)) + social + noise )

rate     = RATE_MIN + RATE_SPAN x reactivity                      0.2 to 0.6, and 0.4 at 0.5
target   = clamp( anchored - amplify x max(0, -anchored) - concern x (1 - riskTolerance) )
anchored = prior + CHANGE_GAIN x intensity x group x sensitivity x impact x trustAdoption
           from round r, when the variant's change lands; the prior before it
social   = SOCIAL_RATE x openness x (T - x(t-1))
noise    = NOISE x (0.5 + reactivity) x (2u - 1)

trustAdoption = 1 + sign(impact) x (0.8 x (trust - 0.5) + 0.4 x (adoptionTendency - 0.5))
```

- **anchored.** The stance the change leaves a member at when nothing else acts on it. `impact` (-1
  harms, 1 benefits) comes from the actor's trait unless the variant overrides it; trust and readiness
  to take something new soften a harm and strengthen a benefit when high. `group` is how strongly the
  actor as a whole reacts in this run: 1 plus a draw with a standard deviation of `GROUP_SPREAD`
  (0.15), kept between 0.5 and 1.5. Members of a group are not independent draws, they share
  circumstances, so one run's group reacts a little more or less strongly than another's. A change
  whose round is after the last round never lands.
- **target.** The anchored stance as shifted by external responders' events (below): `amplify` is what
  alternatives that have appeared (`SWITCH_PULL`) add to the discontent of members anchored below 0,
  less what help (`ENABLE_LIFT`) takes from it; `concern` is what scrutiny (`SCRUTINY_PULL`) adds for
  members who tolerate little risk. They last for the rest of the run.
- **social.** `T` is the influence-weighted stance of what the actor listens to: its own cohort (when it
  has more than one member) and the actors related to it, weighted by relation strength, by the
  other actor's influence and by its population weight. A relation is a channel in both directions,
  except `influences` and `regulates`, which carry from the first actor to the second, and
  `competes-with` and `substitutes-for`, which carry none. This is the pull of the existing
  opinion-dynamics engine, `openness x (peer mean - stance)`, at a lower rate (0.1) so that listening
  does not pull a cohort into one view.
- **noise.** A seeded uniform draw per (actor, member, round), about the size of the noise in the
  existing engine (plus or minus 0.02 at average reactivity).

Every update is a weighted mean of the member's old stance, its target and what it listens to (the
weights are not negative and add to one) plus a bounded nudge, and is then clamped, so a stance cannot
leave [-1, 1] or become NaN (the tests fuzz this). Without events the update is monotone: raising any
stance never lowers a stance in the next round, and a stronger change moves every anchored stance in
the direction of its impact. So when the change harms every member it touches, a stronger change never
leaves anyone more favourable on the same seed.

### Where a member settles

The member does not drift with each round's push: it relaxes toward where the change leaves it. With
nothing to listen to, its stance settles at its **target**,

```
x* = clamp( prior + CHANGE_GAIN x intensity x group x sensitivity x impact x trustAdoption )
```

(before any events), reached by closing `rate` of the gap each round. A member with a rate of 0.4 is
within 5% of it after six rounds; one with 0.2, after fourteen; one with 0.6, after four. A moderate
change gives a moderate resting stance, and only a strong one, or a group that reacts strongly in that
run, reaches the end of the scale: an impact of -1 at full sensitivity and intensity moves the anchored
stance by `CHANGE_GAIN`, and the clamp is what holds it at -1.

When a member listens to others, it settles between its target and what it hears:

```
x* = ( rate x target + SOCIAL_RATE x openness x T ) / ( rate + SOCIAL_RATE x openness )
```

Members of a cohort have different traits and so different resting stances, and which side of a
response threshold each falls on is what makes a cohort's response shares interior. For the fixture's
subscribers (sensitivity 0.7, impact -0.6, trust and readiness 0.5, prior 0, every spread 0.1) the
anchored stance of an average member is `-1.25 x intensity x 0.7 x 0.6 = -0.525 x intensity` times the
group factor, and the members' anchored stances have a standard deviation of 0.10 at intensity 0.2
rising to 0.16 at 1.0:

| Intensity | Resting stance of the average member | Where the cohort's members end (mean over 30 seeds)                  |
| --------- | ------------------------------------ | -------------------------------------------------------------------- |
| 0.2       | -0.11                                | Half wait, half adapt defensively; 1% clearly against.               |
| 0.4       | -0.21                                | Three in four adapt defensively; 8% clearly against.                 |
| 0.6       | -0.32                                | Over half adapt defensively; 39% clearly against.                    |
| 0.7       | -0.37                                | 39% adapt defensively; 59% clearly against (51% without responders). |
| 1.0       | -0.53                                | 90% clearly against; the rest adapt defensively.                     |

The right-hand column is the fixture cast over seeds 100 to 129 and 12 rounds (see "Calibration on the
fixture cast"); it includes the effect of external responders unless stated.

### What each trait does

| Trait              | Where it enters                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `priorStance`      | The member's starting stance, and the stance it is anchored to until the change lands.                                                            |
| `impact`           | Direction and size of what the change does to the anchored stance; which actors it harms or benefits.                                             |
| `influence`        | A member's weight in what its actor "says" to others; with population, the actor's voice.                                                         |
| `openness`         | How far a member moves toward what it listens to.                                                                                                 |
| `sensitivity`      | Scales what the change does to the anchored stance.                                                                                               |
| `riskTolerance`    | Whether a member counts as risk averse (risk-concern signal); scrutiny's pull; a responder's threshold.                                           |
| `switchingCost`    | Whether a member who is clearly against looks for an alternative or resists; lowered by alternatives.                                             |
| `trust`            | Softens a harm, strengthens a benefit (about twice as strongly as readiness below).                                                               |
| `adoptionTendency` | The same, more weakly.                                                                                                                            |
| `authority`        | A responder's threshold and the strength of its events. Not used by other actors.                                                                 |
| `reactivity`       | How much of the gap to its anchored stance a member closes each round, and the size of its noise; how many rounds late a responder sees a signal. |

### Constants

All are in [`parameters.ts`](../../backend/src/simulation/parameters.ts). None is measured: they are
modelling choices, and changing one changes results.

| Constant                           | Value    | Role                                                                                                                           |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `RATE_MIN`, `RATE_SPAN`            | 0.2, 0.4 | Share of the gap to its anchored stance a member closes per round: `RATE_MIN` at reactivity 0, plus `RATE_SPAN` at 1.          |
| `CHANGE_GAIN`                      | 1.25     | How far the change moves the anchored stance, per unit of intensity x sensitivity x impact.                                    |
| `GROUP_SPREAD`                     | 0.15     | Run-to-run standard deviation, around 1, of how strongly a whole group reacts.                                                 |
| `SOCIAL_RATE`                      | 0.1      | Pull toward what an actor listens to, per round at openness 1.                                                                 |
| `NOISE`                            | 0.02     | Half-width of the noise at reactivity 0.5.                                                                                     |
| `TRUST_WEIGHT`, `ADOPTION_WEIGHT`  | 0.8, 0.4 | How strongly trust and readiness scale what the change does.                                                                   |
| `AFFECTED_MIN`                     | 0.05     | An actor with impact smaller than this is neither harmed nor benefited.                                                        |
| `COHORT_TIE`                       | 1        | Weight of an actor's own cohort in what it listens to.                                                                         |
| `RISK_AVERSE_BELOW`                | 0.5      | A member below this risk tolerance is risk averse.                                                                             |
| `SWITCH_PULL`, `ENABLE_LIFT`       | 0.5, 0.5 | Share of a member's anchored discontent (its stance below 0) that alternatives add, and help takes away, per unit of pressure. |
| `SCRUTINY_PULL`                    | 0.3      | How far scrutiny lowers the stance of a member who tolerates no risk, per unit of pressure.                                    |
| `RELIEF_STEP`, `RELIEF_CAP`        | 0.4, 0.6 | How much an alternative lowers switching cost, per unit of pressure, and the most.                                             |
| `PRESSURE_CAP`                     | 1        | Most pressure an actor can carry from events.                                                                                  |
| `DEFAULT_TIE`, `FALLBACK_TIE`      | 0.5, 0.3 | Tie strength of a responder's default and fallback reach.                                                                      |
| `MAX_EVENTS`, `MAX_EARLIER_CAUSES` | 200, 3   | Events a run can hold; earlier events an event lists as a cause.                                                               |
| `DEFAULT_SAMPLE_CAP`               | 200      | Default cap on members per cohort.                                                                                             |

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

| Signal               | Share of an actor's members that...                                                       | About actors the change...       |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| `adverse-share`      | are clearly against: a stance of -0.35 or lower, so they would `switch` or `resist`       | harms (impact -0.05 or lower)    |
| `switching-pressure` | would `switch`                                                                            | harms                            |
| `adoption`           | would `adopt`                                                                             | benefits (impact 0.05 or higher) |
| `risk-concern`       | are clearly against, among the members who tolerate little risk (below 0.5); 0 if none is | harms                            |

The value reported in a round is the mean over the actors the signal is about, each counting once (0
when there are none). External responders read the same per-actor values.

## External responders

Actors in `EXTERNAL_RESPONDER_CATEGORIES` react to the actors around them, not to the change itself.
Each follows one generic rule. No scenario, product or market is named anywhere in the engine (a test
searches its source for such words).

| Category     | Watches              | Emits              | Effect on the actors it reaches                                                         |
| ------------ | -------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `competitor` | `adverse-share`      | `counter-move`     | Lowers switching cost (up to 0.6); discontented members settle further from the change. |
| `substitute` | `switching-pressure` | `substitute-offer` | The same.                                                                               |
| `partner`    | `adverse-share`      | `enablement`       | Discontented members settle closer to neutral.                                          |
| `regulator`  | `risk-concern`       | `scrutiny`         | Members settle lower, in proportion to how little risk they tolerate.                   |

- **Lag.** A responder sees a signal `1 + round(2 x (1 - reactivity))` rounds late: 1 round above a
  reactivity of 0.75, 3 at 0.25 or below, otherwise 2.
- **Threshold.** `0.15 + 0.35 x riskTolerance + 0.25 x (1 - authority)`, from 0.15 (bold, powerful) to
  0.75 (tolerant, weak). It acts the first time the signal it sees (the mean over its reach of the
  signal as it stood `lag` rounds ago) is at or above it, and only once. It never acts if the signal
  is about none of the actors it reaches. Because the signals rise gradually as members relax toward
  their anchored stances, whether a responder reaches its threshold depends on how strong the change
  is and on the seed: that is what makes second-order events appear in some runs and not others.
- **Strength.** `(0.4 + 0.6 x excess) x (0.5 + 0.5 x authority)`, where `excess` is how far past the
  threshold the signal it saw was (0 at the threshold, 1 at the top), so from 0.2 to 1. A responder
  that acts the moment the signal crosses its threshold therefore acts less strongly than one that
  sees it well past. An event adds pressure to each actor it reaches, that strength times the relation
  strength, from the round after it is emitted, and the pressure lasts for the rest of the run.
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
Alpha is a cohort of 40 that the change harms hard (impact -0.9, sensitivity 0.9) and whose switching
cost is just above the line (0.56, so without help its members resist rather than switch); Beta is a
competitor related to Alpha, and Gamma a substitute related to Alpha. The change lands in round 2 at
intensity 0.7, over 12 rounds, seed 3:

| Round | What happens                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| 2     | The change lands; Alpha's members begin to move toward their anchored stance, and `adverse-share` is 0.15.                     |
| 3     | `adverse-share` is 0.80, above Beta's threshold of 0.31.                                                                       |
| 5     | **e1** `counter-move` by Beta, `causedBy: ["adverse-share"]`: Beta sees the signal 2 rounds late (its reactivity is 0.5).      |
| 6     | Alpha's effective switching cost falls below 0.5, so its members move from `resist` to `switch`: `switching-pressure` is 1.00. |
| 7     | **e2** `substitute-offer` by Gamma, `causedBy: ["switching-pressure", "e1"]`: Gamma sees the signal 1 round late and acts.     |

Beta acts in round 5 and Gamma in round 7 on all but one of seeds 1 to 20 (rounds 4 and 6 on the other).
Averaged over those seeds, Alpha's final mean stance is -0.93 with the responders and -0.68 without them
(`signals: false`); its members all end as `switch` with the responders and all but a few as `resist`
without. Without Beta there is no pressure to switch and so no second move: Gamma's event exists only
because of Beta's. These are consequences of the assumptions in that cast, shown to explain the
mechanism; Alpha is harmed harder than any actor in the fixture cast, so that every seed shows the chain.

## Reproducibility and common random numbers

Every random number is a pure function of the seed and labels: the draw for a trait is addressed by
(seed, actor id, member, trait), an actor's group factor by (seed, actor id) and the noise by
(seed, actor id, member, round) ([`random.ts`](../../backend/src/simulation/random.ts)). Nothing is
drawn from a shared sequence, so:

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
- The group factor does not depend on the variant, so on one seed an actor's group reacts equally
  strongly under every variant (tested): a paired comparison differs by the variant, not by that draw.
  Across seeds it is part of the spread that repeated runs measure.
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

|                          | Existing engine                                       | This simulator                                                                                                                        |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Who is simulated         | Agents, each with its own opinion                     | Actors: key actors and cohorts of sampled members                                                                                     |
| Whom a member listens to | Four or five peers chosen each round                  | The actor's own cohort and related actors, as one weighted mean                                                                       |
| Rate of the social pull  | `openness`                                            | `0.1 x openness`                                                                                                                      |
| The change               | One push, once: `strength x (target - opinion) x 0.6` | Sets an anchored stance, `prior + 1.25 x intensity x group x sensitivity x impact`, which each member closes on at 0.2 to 0.6 a round |
| Noise                    | Uniform, plus or minus 0.02                           | Uniform, plus or minus 0.01 to 0.03 by reactivity                                                                                     |
| Second-order effects     | None                                                  | External responders                                                                                                                   |

Both are bounded, both pull toward influence-weighted means, and a stronger push moves the mean further
in the pushed direction in both (a test runs the two side by side and checks directions, not values).
The two are not calibrated against each other and will not agree numerically; the cross-check in an
analysis only asks whether the deep-dive result falls inside the spread of the ensemble.

## Calibration on the fixture cast

This is a check of the shape of the model's behaviour, not a calibration against the world. The test
[`simulation-calibration.test.ts`](../../backend/test/simulation-calibration.test.ts) runs the cast of
`actorSetFixture()` (five actors: a key decision-maker, a cohort of 30 sampled subscribers who bear the
cost of the change, a key competitor, a key regulator and a cohort of 10 sampled partners) over 12
rounds and seeds 100 to 129, with the change of `FIXTURE_VARIANTS[1]` landing in round 2 at several
intensities. It asks that the results are usable by a repeated-run analysis: shares are interior rather
than all or nothing, they differ between seeds, they rise gradually with intensity, and second-order
events happen in some runs and not in others.

"Overall" is the share of actors' members that would `switch` or `resist`, each actor weighing the
same; "subscribers" is the same for the cohort of subscribers alone.

| Intensity | Overall share: mean (SD) | Subscribers against: mean (SD) | Subscribers wait or adapt | Runs with an event | `counter-move` | `enablement` | `scrutiny` |
| --------- | ------------------------ | ------------------------------ | ------------------------- | ------------------ | -------------- | ------------ | ---------- |
| 0         | 0.000 (0.000)            | 0.000 (0.000)                  | 0.86                      | 0%                 | 0%             | 0%           | 0%         |
| 0.2       | 0.002 (0.003)            | 0.008 (0.017)                  | 0.98                      | 0%                 | 0%             | 0%           | 0%         |
| 0.4       | 0.017 (0.015)            | 0.083 (0.075)                  | 0.92                      | 0%                 | 0%             | 0%           | 0%         |
| 0.5       | 0.038 (0.028)            | 0.190 (0.138)                  | 0.81                      | 13%                | 10%            | 0%           | 7%         |
| 0.6       | 0.078 (0.040)            | 0.388 (0.202)                  | 0.61                      | 47%                | 37%            | 23%          | 47%        |
| 0.7       | 0.120 (0.041)            | 0.598 (0.204)                  | 0.40                      | 80%                | 77%            | 60%          | 73%        |
| 0.8       | 0.148 (0.039)            | 0.742 (0.197)                  | 0.26                      | 87%                | 87%            | 83%          | 83%        |
| 1.0       | 0.181 (0.024)            | 0.898 (0.112)                  | 0.10                      | 100%               | 100%           | 97%          | 100%       |

"Runs with an event" is the share of the 30 runs with at least one event of any kind; the next three
columns are the share with at least one of that kind. At intensity 0 the subscribers are not all at
wait or adapt because the members' own prior stances (spread 0.1) already put some of them in other
responses; that is not a result of the change. Each row is one set of seeds, so a rate or SD has a
sampling error of a few points: the same measurement on seeds 1 to 30, 1000 to 1029 and 5000 to 5029
put the any-event rate at 0.7 between 67% and 83% and the overall SD between 0.034 and 0.044.

What the table shows about the engine:

- **A moderate change gives a moderate share.** Subscribers' share rises from 0.01 at 0.2 to 0.60 at
  0.7 and 0.90 at 1.0, and the overall share, which includes actors the change does not harm, from 0
  to 0.18. Every one of the intensities 0.2, 0.4, 0.6, 0.8 and 1.0 gives a different overall share.
- **Seeds differ.** A cohort of 30 members gives a share a sampling error of about 0.09; the group
  factor adds how strongly the whole group reacts in that run. The overall SD is 0.03 to 0.04 at
  intensities 0.5 to 0.8, and falls again at 1.0 as the shares approach their ceiling.
- **Thresholds matter.** Responders act when the signal they watch reaches their threshold (0.40 for
  the fixture's competitor and regulator, 0.525 for the partner), so how often a second move happens
  depends on how strong the change is: almost never at 0.4 and below, in some runs but not all at 0.5
  to 0.8, and in nearly all at 1.0. Below about 0.5 the harmed cohort does not get far enough for a
  responder to act, which is a property of this cast and these thresholds, not of the engine. The rate
  against intensity is an S-curve whose steep part, here 0.5 to 0.8, is where the choice of seeds
  changes the findings.
- **Second-order events move the result.** At 0.7 the subscribers' share is 0.60 with the responders
  and 0.51 without them (`signals: false`).
- **A baseline stays at its prior.** At intensity 0 the overall share is 0.

The calibration is on this cast. A cast with a harsher change or more sensitive actors still saturates,
as it should: heavy harm leaves members all the way against. The test also holds the shape at 8 and
24 rounds. An earlier version of the engine added the change's push every round with nothing pulling
members back, so every harmed cohort ended at the end of the scale (an overall share of 0.200 on
average and 0.193 to 0.200 across 30 seeds at 0.7, with second-order events in every run). That was
replaced by the relaxation above.

## What it cannot tell you

- **Whether any assumption is true.** The traits, the relations and the constants above are assumptions.
  Where a trait is a system assumption the result is as unfounded as that assumption. The sensitivity
  analysis shows which assumptions the outcome depends on; it does not make them right.
- **Magnitudes in the world.** Nothing here is calibrated against observed behaviour, and no backtest
  has been done. The calibration above checks the shape of the model on one cast. The size of a share
  depends on the assumed spread of the traits, the gain, the rate, the group factor and the response
  thresholds, none of which is measured.
- **Anything not modelled.** A stance is one number about one change. Members have no memory, learn
  nothing and share no information beyond the stance. Traits are independent. The change lands once and
  its anchor lasts for the whole run: there is no habituation, recovery or escalation, and staged or
  repeated interventions are separate variants. A responder acts once, watches one signal and does not
  escalate; its strength reflects the moment it acted, and the effect it has lasts for the run.
  Responders see one another only through the population. Relation types have no meaning beyond the
  channel rules above.
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
  relaxation equation toward the anchored stance, the resting stance and the compromise with what a
  member listens to, the group factor, heterogeneity within a cohort, overrides and edits, relations,
  weights, work counters and the cap, the signals, and the direction of the existing engine.
- `simulation-calibration.test.ts`: the table above on the fixture cast: interior and varying shares,
  gradual and monotone growth with intensity, the share of runs with second-order events at each
  intensity, and the effect of those events.
- `simulation-chain.test.ts`: lag, threshold and strength of responders, the Alpha, Beta and Gamma
  chain with and without relations, what each kind of responder does, and event bounds.
- `simulation-neutrality.test.ts`: the engine source contains no scenario words and no clock, network
  or `Math.random`.
