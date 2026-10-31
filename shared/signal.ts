import type { Variant } from './analysis.js';
import { SIGNED_TRAIT_KEYS, TRAIT_KEYS, type Actor, type TraitKey } from './stakeholders.js';

/** What the decision reads of an actor. A caller that cannot say whether it is a key actor is read as a cohort. */
type CastMember = Pick<Actor, 'id' | 'traits'> & Partial<Pick<Actor, 'kind'>>;
/** What it reads of a scenario. One without edits is read as having none. */
type Scenario = Pick<Variant, 'kind' | 'intensity' | 'impactOverrides'> &
  Partial<Pick<Variant, 'traitEdits'>>;

const SIGNED: ReadonlySet<string> = new Set(SIGNED_TRAIT_KEYS);
const NOTHING: Scenario = { kind: 'baseline', intensity: 0, impactOverrides: {}, traitEdits: [] };

/**
 * What a scenario sets for one trait of an actor, resolved as the simulator resolves it: the last edit
 * of that trait, else the actor's own value, kept to the scale of the trait; and for `impact` the
 * scenario's own override of it wins over both. This is the value that governs a run, which is not
 * always the one the actor carries.
 */
export function effectiveTrait(
  actor: Pick<CastMember, 'id' | 'traits'>,
  scenario: Pick<Scenario, 'impactOverrides' | 'traitEdits'>,
  trait: TraitKey,
): number {
  const clamp = (value: number): number => Math.min(1, Math.max(SIGNED.has(trait) ? -1 : 0, value));
  const override = trait === 'impact' ? scenario.impactOverrides[actor.id] : undefined;
  if (override !== undefined) return clamp(override);
  const edits = scenario.traitEdits ?? [];
  for (let at = edits.length - 1; at >= 0; at -= 1) {
    const edit = edits[at];
    if (edit && edit.actorId === actor.id && edit.trait === trait) return clamp(edit.value);
  }
  return clamp(actor.traits[trait].value);
}

/** Members of a cohort are drawn around its impact with its spread; a key actor is one member at the value. */
const impactVaries = (actor: CastMember): boolean =>
  actor.kind !== 'key' && actor.traits.impact.spread > 0;

/** Whether the change lands on someone: it has a strength, and some member can be given an impact that is not 0. */
const lands = (cast: readonly CastMember[], scenario: Scenario): boolean =>
  scenario.intensity > 0 &&
  cast.some((actor) => effectiveTrait(actor, scenario, 'impact') !== 0 || impactVaries(actor));

/**
 * Whether anything an actor is simulated from differs between the scenario and the one it is compared
 * with. A difference in impact that harms no one on either side is left out: until a change lands, an
 * impact that is not negative is read as nothing, while an actor that is harmed is something others
 * react to even when nothing lands, so that is not left out.
 */
const sets = (cast: readonly CastMember[], scenario: Scenario, reference: Scenario): boolean =>
  cast.some((actor) =>
    TRAIT_KEYS.some((trait) => {
      const own = effectiveTrait(actor, scenario, trait);
      const other = effectiveTrait(actor, reference, trait);
      return own !== other && (trait !== 'impact' || own < 0 || other < 0);
    }),
  );

/**
 * Whether the declared assumptions give a change any way to move anyone. It is false only when the
 * simulator is certain to give the same outcome with the change as without it, on every seed: neither
 * lands on anyone (the strength is nothing, or the impact is 0 for every actor after the scenario's
 * override and edits, and no cohort's members differ in it), and the scenario sets nothing about
 * anyone that no change would. In every other case it is true, including when it is only unsure: a
 * cohort whose members differ in how the change lands on them can be moved in either direction while
 * no stakeholder has an expected direction, and an edit to a scenario can move whoever it names.
 */
export function changeCanMoveAnyone(
  actors: readonly CastMember[],
  variants: readonly Scenario[],
): boolean {
  const reference = variants.find((variant) => variant.kind === 'baseline') ?? NOTHING;
  return variants.some(
    (variant) =>
      variant.kind !== 'baseline' &&
      (lands(actors, variant) || lands(actors, reference) || sets(actors, variant, reference)),
  );
}

/** The actors that some scenario other than the baseline gives an expected direction of impact: one that is not 0 once the scenario's own settings are applied. */
export function actorsWithDirection<T extends CastMember>(
  actors: readonly T[],
  variants: readonly Scenario[],
): T[] {
  const changes = variants.filter((variant) => variant.kind !== 'baseline');
  return actors.filter((actor) =>
    changes.some((variant) => effectiveTrait(actor, variant, 'impact') !== 0),
  );
}

const DIRECTION_ACTION =
  'Say who is helped or harmed in the stakeholder review, or read the evidence with a model, before reading anything into the results.';

/** What a person should be told when the change provably cannot move anyone, in the words every page and report uses. */
export const NO_DIRECTION_NOTICE = `No stakeholder has an expected direction of impact, so the change cannot move anyone in the simulation and every difference from no change is noise. ${DIRECTION_ACTION}`;

/**
 * What a person should be told when no stakeholder has an expected direction of impact but the change
 * still can move members, so that nothing may be said of it that is only true of a change that cannot.
 */
export const UNDIRECTED_CLAIM =
  'No stakeholder has an expected direction of impact, so nobody is set as helped or harmed by the change. A comparison can still show differences, where members of a group are assumed to differ in how it lands on them or where a scenario edits a trait, but they come from those assumptions and not from a direction of impact.';
export const UNDIRECTED_NOTICE = `${UNDIRECTED_CLAIM} ${DIRECTION_ACTION}`;

/**
 * The one notice a comparison of these actors and scenarios needs before anything is read into it, or
 * null when someone has an expected direction. Every page, report and review takes it from here.
 */
export function directionNotice(
  actors: readonly CastMember[],
  variants: readonly Scenario[],
): string | null {
  if (actorsWithDirection(actors, variants).length > 0) return null;
  return changeCanMoveAnyone(actors, variants) ? UNDIRECTED_NOTICE : NO_DIRECTION_NOTICE;
}
