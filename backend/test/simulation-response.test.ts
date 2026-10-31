import { describe, expect, it } from 'vitest';
import {
  RESPONSE_CATEGORIES,
  RESPONSE_MEANINGS,
  type ResponseCategory,
} from '../../shared/analysis.js';
import { classifyIndex, classifyResponse } from '../src/simulation/response.js';

/** The rule as written in docs/analysis/engine.md, restated independently of the implementation. */
function documented(stance: number, switchingCost: number): ResponseCategory {
  if (stance >= 0.35) return 'adopt';
  if (stance >= 0.1) return 'accept-with-conditions';
  if (stance > -0.1) return 'wait';
  if (stance > -0.35) return 'adapt-defensively';
  return switchingCost < 0.5 ? 'switch' : 'resist';
}

describe('classifyResponse', () => {
  const cheap = { switchingCost: 0.2 };
  const costly = { switchingCost: 0.8 };

  it('puts every threshold on the side the documentation gives it', () => {
    expect(classifyResponse(1, cheap)).toBe('adopt');
    expect(classifyResponse(0.35, cheap)).toBe('adopt');
    expect(classifyResponse(0.3499999, cheap)).toBe('accept-with-conditions');
    expect(classifyResponse(0.1, cheap)).toBe('accept-with-conditions');
    expect(classifyResponse(0.0999999, cheap)).toBe('wait');
    expect(classifyResponse(0, cheap)).toBe('wait');
    expect(classifyResponse(-0.0999999, cheap)).toBe('wait');
    expect(classifyResponse(-0.1, cheap)).toBe('adapt-defensively');
    expect(classifyResponse(-0.3499999, cheap)).toBe('adapt-defensively');
    expect(classifyResponse(-0.35, cheap)).toBe('switch');
    expect(classifyResponse(-1, cheap)).toBe('switch');
    expect(classifyResponse(-0.35, costly)).toBe('resist');
    expect(classifyResponse(-1, costly)).toBe('resist');
  });

  it('splits a clear stance against by the cost of switching, which is cheap below 0.5', () => {
    expect(classifyResponse(-0.6, { switchingCost: 0.4999 })).toBe('switch');
    expect(classifyResponse(-0.6, { switchingCost: 0.5 })).toBe('resist');
    expect(classifyResponse(-0.6, { switchingCost: 0 })).toBe('switch');
    expect(classifyResponse(-0.6, { switchingCost: 1 })).toBe('resist');
  });

  it('ignores the cost of switching for every stance that is not clearly against', () => {
    for (const stance of [0.9, 0.2, 0, -0.2]) {
      expect(classifyResponse(stance, cheap)).toBe(classifyResponse(stance, costly));
    }
  });

  it('reads the cost from a trait as well as from a number', () => {
    expect(classifyResponse(-0.6, { switchingCost: { value: 0.3 } })).toBe('switch');
    expect(classifyResponse(-0.6, { switchingCost: { value: 0.7 } })).toBe('resist');
  });

  it('refuses a stance that is not a number rather than calling it a response', () => {
    expect(() => classifyResponse(Number.NaN, cheap)).toThrow(RangeError);
    expect(() => classifyResponse(Infinity, cheap)).toThrow(RangeError);
  });

  it('agrees with the documented rule everywhere on the scale, and uses every category', () => {
    const seen = new Set<ResponseCategory>();
    for (let step = -1000; step <= 1000; step += 1) {
      for (const switchingCost of [0, 0.25, 0.4999, 0.5, 0.75, 1]) {
        const stance = step / 1000;
        const category = classifyResponse(stance, { switchingCost });
        expect(category, `${stance}, ${switchingCost}`).toBe(documented(stance, switchingCost));
        expect(RESPONSE_CATEGORIES[classifyIndex(stance, switchingCost)]).toBe(category);
        seen.add(category);
      }
    }
    expect([...seen].sort()).toEqual([...RESPONSE_CATEGORIES].sort());
  });

  it('keeps to the wording shown to people', () => {
    expect(RESPONSE_MEANINGS.adopt).toMatch(/clearly favourable/u);
    expect(RESPONSE_MEANINGS['accept-with-conditions']).toMatch(/mildly favourable/u);
    expect(RESPONSE_MEANINGS.wait).toMatch(/near neutral/u);
    expect(RESPONSE_MEANINGS['adapt-defensively']).toMatch(/mildly unfavourable/u);
    expect(RESPONSE_MEANINGS.switch).toMatch(/clearly unfavourable.*cheap/u);
    expect(RESPONSE_MEANINGS.resist).toMatch(/clearly unfavourable.*costly/u);
  });
});
