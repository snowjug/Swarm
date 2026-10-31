import { describe, expect, it } from 'vitest';
import { actorSetFixture, FIXTURE_VARIANTS } from '../../shared/lab-fixtures.js';
import { changeCanMoveAnyone } from '../../shared/signal.js';

const cast = actorSetFixture().actors;
const variants = FIXTURE_VARIANTS;

const flat = cast.map((actor) => ({
  ...actor,
  traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0 } },
}));

describe('whether a change can move anyone', () => {
  it('can when some actor is affected by a scenario that has an intensity', () => {
    expect(changeCanMoveAnyone(cast, variants)).toBe(true);
  });

  it('cannot when no actor is helped or harmed, however strong the scenario', () => {
    expect(changeCanMoveAnyone(flat, variants)).toBe(false);
  });

  it('can again when the scenario itself sets an impact on an actor', () => {
    const first = flat[0]!.id;
    const withOverride = variants.map((variant) =>
      variant.kind === 'baseline' ? variant : { ...variant, impactOverrides: { [first]: -0.4 } },
    );
    expect(changeCanMoveAnyone(flat, withOverride)).toBe(true);
  });

  it('cannot when the only scenario with an effect has no intensity, or is the baseline', () => {
    const quiet = variants.map((variant) => ({ ...variant, intensity: 0 }));
    expect(changeCanMoveAnyone(cast, quiet)).toBe(false);
    const baselineOnly = variants.filter((variant) => variant.kind === 'baseline');
    expect(changeCanMoveAnyone(cast, baselineOnly)).toBe(false);
  });
});
