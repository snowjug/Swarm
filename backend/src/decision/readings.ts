import type { Analysis, ResponseShares } from '../../../shared/analysis.js';
import {
  LENS_MIN_RUNS,
  PRIMARY_LENS,
  dominantGroup,
  labelOf,
  type ActorReading,
  type DecisionCanvas,
  type FutureReading,
  type GroupShares,
  type LensReading,
  type Labelled,
  type ResponseGroup,
} from '../../../shared/decision.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import { directionOrigin, type TraitOrigin } from '../../../shared/stakeholders.js';
import { isSetByPerson } from '../../../shared/analysis-plan.js';
import { classifyStability, mean } from '../analysis/stats.js';
import type { EvidenceIndex } from '../brief/evidence.js';
import {
  ADVERSE_CATEGORIES,
  AFFECTED_MIN,
  FAVOURABLE_CATEGORIES,
  adverseShareOf,
  shareIn,
  type Headline,
  type VariantMeasure,
} from '../brief/measures.js';
import type { ParticipantOrigin, ParticipantReading } from './participants.js';
import { Guard, clip, decimals, embed, inHundred, round4 } from './words.js';

/** The parts of the canvas that read the runs themselves: the futures, the actors, the risks and the timing. */

export const groupSharesOf = (shares: ResponseShares): GroupShares => ({
  favourable: shareIn(shares, FAVOURABLE_CATEGORIES),
  neutral: shares.wait,
  defensive: shares['adapt-defensively'],
  adverse: shareIn(shares, ADVERSE_CATEGORIES),
});

const PHRASES: Record<ResponseGroup, string> = {
  favourable: 'going along or accepting with conditions',
  neutral: 'waiting and seeing',
  defensive: 'adapting to limit the impact',
  adverse: 'looking for an alternative or resisting',
};

const DIRECTION_WORDS: Record<TraitOrigin, string> = {
  evidence: 'a cited source passage, for its direction only; its size is a default',
  user: 'a setting made by a person',
  'system-assumption': 'a default Swarm set from the role’s category',
  model: 'a model’s reading',
};

export interface ReadingWorld {
  analysis: Analysis;
  scenario: ScenarioFrame | null;
  measures: readonly VariantMeasure[];
  headline: Headline | null;
  baseline: VariantMeasure | null;
  evidence: EvidenceIndex;
  participants: ReadonlyMap<string, ParticipantReading>;
  /** How the list of participants was made, said beside the roles that came from it. */
  origin: ParticipantOrigin;
}

// ---------------------------------------------------------------------------------------------
// Futures
// ---------------------------------------------------------------------------------------------

export function readFutures(
  world: ReadingWorld,
  lenses: readonly LensReading[],
  blocked: ReadonlySet<string>,
  guard: Guard,
): DecisionCanvas['futures'] {
  const candidates = world.measures.filter((measure) => !blocked.has(measure.variant.id));
  const runs =
    candidates.length === 0 ? 0 : Math.min(...candidates.map((measure) => measure.runs.length));
  if (candidates.length === 0 || runs < LENS_MIN_RUNS) {
    return {
      supported: false,
      note: guard.say(
        candidates.length === 0
          ? 'No option that can be chosen has recorded runs, so no future is described.'
          : `The simulation has ${runs} seeded ${runs === 1 ? 'run' : 'runs'} for an option. At least ${LENS_MIN_RUNS} are needed before Swarm describes how the futures vary, so none is shown.`,
        500,
      ),
      items: [],
    };
  }
  const leads = (id: string): number =>
    lenses.filter((lens) => lens.computable && lens.leaderId === id).length;
  const primary = lenses.find((lens) => lens.id === PRIMARY_LENS);
  const valueOf = (id: string): number =>
    primary?.results.find((result) => result.alternativeId === id)?.value ?? 1;
  const ranked = [...candidates].sort(
    (a, b) =>
      leads(b.variant.id) - leads(a.variant.id) ||
      valueOf(a.variant.id) - valueOf(b.variant.id) ||
      a.variant.id.localeCompare(b.variant.id),
  );
  const chosen = ranked.slice(0, 3);
  const reference = ranked.find((measure) => measure.variant.kind === 'baseline');
  // The option that changes nothing is always one of them, so that every other is read against it.
  if (reference && !chosen.includes(reference)) chosen[chosen.length - 1] = reference;
  const items: FutureReading[] = chosen.map((measure) => {
    const perRun = measure.runs.map((run) => groupSharesOf(run.responseShares));
    const shares: GroupShares = {
      favourable: mean(perRun.map((entry) => entry.favourable)),
      neutral: mean(perRun.map((entry) => entry.neutral)),
      defensive: mean(perRun.map((entry) => entry.defensive)),
      adverse: mean(perRun.map((entry) => entry.adverse)),
    };
    const dominant = dominantGroup(shares);
    const heldIn = perRun.filter((entry) => dominantGroup(entry) === dominant).length;
    const adverse = measure.runs.map((run) => adverseShareOf(run.responseShares));
    const standing = primary?.results.find(
      (result) => result.alternativeId === measure.variant.id,
    )?.standing;
    return {
      alternativeId: measure.variant.id,
      label: clip(measure.variant.label, 120),
      kind: measure.variant.kind,
      statement: guard.statement(
        `Under ${embed(measure.variant.label, 60)} the largest group of simulated members ended up ${PHRASES[dominant]}, in ${heldIn} of ${measure.runs.length} seeded runs.`,
        'scenario-possibility',
        'run:responses',
      ),
      dominant,
      shares: {
        favourable: round4(shares.favourable),
        neutral: round4(shares.neutral),
        defensive: round4(shares.defensive),
        adverse: round4(shares.adverse),
      },
      adverseRange: { low: round4(Math.min(...adverse)), high: round4(Math.max(...adverse)) },
      heldIn,
      of: measure.runs.length,
      repeatability: classifyStability(heldIn, measure.runs.length),
      standing: standing ?? 'not-assessed',
    };
  });
  return {
    supported: true,
    note: guard.say(
      `Each future is a simulated pattern over ${runs} or more seeded runs of that option, and “held in” counts runs. They are scenarios to examine, not forecasts, and none is a probability.`,
      500,
    ),
    items,
  };
}

// ---------------------------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------------------------

export function readActors(
  world: ReadingWorld,
  focus: VariantMeasure | null,
  guard: Guard,
): DecisionCanvas['actors'] {
  const baseline = world.baseline && world.baseline !== focus ? world.baseline : null;
  const items: ActorReading[] = [];
  for (const actor of world.analysis.actors) {
    const own = focus?.actors.find((entry) => entry.actorId === actor.id);
    if (!own) continue;
    const before = baseline?.actors.find((entry) => entry.actorId === actor.id);
    const shares = groupSharesOf(own.shares);
    const adverseChange = before ? shares.adverse - groupSharesOf(before.shares).adverse : null;
    const participant = world.participants.get(actor.id);
    const origin = directionOrigin(actor.traits.impact);
    items.push({
      actorId: actor.id,
      name: clip(actor.name, 120),
      kind: actor.kind,
      category: actor.category,
      role: participant?.role ?? clip(actor.role || actor.category, 120),
      synthetic: true,
      influence: participant?.influence ?? 'medium',
      position: participant?.position ?? 'none',
      alignment: dominantGroup(shares),
      stance: round4(own.stance),
      stanceChange: before ? round4(own.stance - before.stance) : null,
      adverseShare: round4(shares.adverse),
      adverseChange: adverseChange === null ? null : round4(adverseChange),
      moves:
        adverseChange === null
          ? 'unknown'
          : Math.abs(adverseChange) < AFFECTED_MIN * 2
            ? 'little'
            : adverseChange > 0
              ? 'toward-resistance'
              : 'toward-support',
      directionBasis: guard.statement(
        `Which way the change lands on this role rests on ${DIRECTION_WORDS[origin]}.`,
        labelOf('trait-origin', origin),
        `trait-origin:${origin}`,
      ),
      uncertainty: actor.uncertainty.level,
      cited: world.evidence.supports(actor),
      plausibleActions: participant?.plausibleActions ?? [],
    });
  }
  const weight = { high: 0, medium: 1, low: 2 } as const;
  items.sort(
    (a, b) =>
      Math.abs(b.adverseChange ?? 0) - Math.abs(a.adverseChange ?? 0) ||
      weight[a.influence] - weight[b.influence] ||
      a.name.localeCompare(b.name),
  );
  return {
    focusAlternativeId: focus?.variant.id ?? null,
    focusLabel: focus ? clip(focus.variant.label, 120) : null,
    baselineLabel: baseline ? clip(baseline.variant.label, 120) : null,
    items: items.slice(0, 12),
    note: guard.say(
      'Roles are simulated: Swarm made them up from the question and the sources, and what they do here is what the simulation does under its assumptions, not what any real person would do.',
      400,
    ),
    origin: {
      source: world.origin.source,
      label: guard.say(world.origin.label, 80),
      detail: guard.say(world.origin.detail, 400),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Risks and opportunities
// ---------------------------------------------------------------------------------------------

const AT_LEAST = 0.05;

export function readMovement(
  world: ReadingWorld,
  guard: Guard,
): { risks: Labelled[]; opportunities: Labelled[] } {
  const { headline } = world;
  if (!headline || !headline.baseline || !headline.groupsKnown)
    return { risks: [], opportunities: [] };
  const here = embed(headline.variant.variant.label, 50);
  const there = embed(headline.baseline.variant.label, 50);
  const runs = headline.variant.runs.length;
  const names = new Map(world.analysis.actors.map((actor) => [actor.id, actor.name]));
  const sentence = (shift: (typeof headline.groups)[number], more: boolean): string => {
    const name = embed(names.get(shift.actorId) ?? shift.actorId, 50);
    const word = more ? 'more' : 'less';
    if (shift.members === 1) {
      return `Under ${here} compared with ${there}, the one simulated member of ${name} ended up looking for an alternative or resisting ${word} often: in about ${Math.round(shift.share * runs)} of ${runs} seeded runs against ${Math.round((shift.baselineShare ?? 0) * runs)}.`;
    }
    return `Under ${here} compared with ${there}, ${name} ended up looking for an alternative or resisting ${word} often in the simulation: ${inHundred(shift.baselineShare ?? 0)} to ${inHundred(shift.share)} in 100 of its simulated members${shift.higherIn !== null && shift.pairs ? `, with the share ${more ? 'higher' : 'lower'} in ${more ? shift.higherIn : shift.pairs - shift.higherIn} of ${shift.pairs} paired runs` : ''}.`;
  };
  const risks: Labelled[] = [];
  const opportunities: Labelled[] = [];
  for (const shift of headline.groups) {
    if (shift.delta === null) continue;
    if (shift.delta >= AT_LEAST && risks.length < 5) {
      risks.push(guard.statement(sentence(shift, true), 'simulation-event', 'run:group-shift'));
    } else if (shift.delta <= -AT_LEAST && opportunities.length < 5) {
      opportunities.push(
        guard.statement(sentence(shift, false), 'simulation-event', 'run:group-shift'),
      );
    }
  }
  return { risks, opportunities };
}

// ---------------------------------------------------------------------------------------------
// Interventions: how each option was set up
// ---------------------------------------------------------------------------------------------

export function readInterventions(
  world: ReadingWorld,
  guard: Guard,
): DecisionCanvas['interventions'] {
  const { scenario } = world;
  const origin = scenario ? labelOf('frame-origin', scenario.origin) : 'assumption';
  return world.analysis.config.variants
    .filter((variant) => variant.kind === 'alternative')
    .slice(0, 8)
    .map((variant, index) => {
      // The proposed change is what the scenario itself says changes; every other option names its own changes.
      const changes =
        index === 0 && scenario && scenario.changes.length > 0
          ? scenario.changes
          : (scenario?.alternatives.find((alternative) => alternative.id === variant.id)?.changes ??
            []);
      return {
        alternativeId: variant.id,
        label: clip(variant.label, 120),
        changes: changes
          .slice(0, 6)
          .map((change) =>
            guard.statement(
              `${embed(change.name, 60)}${change.from ? ` from ${embed(change.from, 50)}` : ''}${change.to ? ` to ${embed(change.to, 50)}` : ''}`,
              origin,
              'scenario:change',
            ),
          ),
        setting: guard.statement(
          `In the simulation it lands in round ${variant.round} with a strength of ${decimals(variant.intensity)}, ${isSetByPerson(variant) ? 'a setting made by a person' : 'a default Swarm set'}. Neither was measured.`,
          'assumption',
          isSetByPerson(variant) ? 'variant:user' : 'variant:system',
        ),
      };
    });
}

export const strengthSetBy = (world: ReadingWorld): 'you' | 'system' | null => {
  const proposed = world.headline?.variant.variant;
  if (!proposed || proposed.kind !== 'alternative') return null;
  return isSetByPerson(proposed) ? 'you' : 'system';
};
