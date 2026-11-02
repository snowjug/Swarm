/** The arithmetic of the charts, kept apart from the drawing so that it can be tested. */

export interface Linear {
  (value: number): number;
  invert: (position: number) => number;
}

/** A straight map from a range of values to a range of positions. A range of no width maps to the middle. */
export function linear(
  domain: readonly [number, number],
  range: readonly [number, number],
): Linear {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = ((value: number): number =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)) as Linear;
  scale.invert = (position: number): number =>
    r1 === r0 ? d0 : d0 + ((position - r0) / (r1 - r0)) * span;
  return scale;
}

/** The smallest of 1, 2, 2.5 or 5 times a power of ten that is at least `raw`: a step a person would choose. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (factor * power >= raw - 1e-12) return factor * power;
  }
  return 10 * power;
}

/** Rounds away the dust of floating-point steps, and never returns a negative zero. */
const clean = (value: number): number => Math.round(value * 1e6) / 1e6 || 0;

/** Round values from `min` to `max` at a nice step, aiming for about `target` of them. */
export function ticksBetween(min: number, max: number, target = 5): number[] {
  const step = niceStep((max - min) / Math.max(1, target));
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step * 1e-6; value += step) ticks.push(clean(value));
  return ticks;
}

/** The axis of a share that starts at nothing: it ends at a round figure just past the largest value. */
export function shareAxis(largest: number): { max: number; ticks: number[] } {
  const target = Math.max(largest, 0.01) * 1.08;
  const step = niceStep(target / 4);
  const max = clean(Math.ceil(target / step - 1e-9) * step);
  return { max, ticks: ticksBetween(0, max, 4) };
}

/**
 * A tight axis around some stance values, for reading small differences: round limits just outside the
 * data, never wider than the scale of -1 to 1, and always through zero when zero is near enough to matter.
 */
export function fitAxis(values: readonly number[]): { min: number; max: number; ticks: number[] } {
  const low = values.length ? Math.min(...values, 0) : -0.1;
  const high = values.length ? Math.max(...values, 0) : 0.1;
  const step = niceStep(Math.max(high - low, 0.02) / 4);
  const min = Math.max(-1, clean(Math.floor((low - step * 0.1) / step) * step));
  const max = Math.min(1, clean(Math.ceil((high + step * 0.1) / step) * step));
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step - 1e-9) * step; value <= max + step * 1e-6; value += step) {
    ticks.push(clean(value));
  }
  return { min, max, ticks };
}

export interface Point {
  x: number;
  y: number;
}

const at = (value: number): string => (Math.round(value * 10) / 10).toString();

/** A line through points, as the `d` of a path. */
export function linePath(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${at(point.x)},${at(point.y)}`)
    .join(' ');
}

/** The area between two lines over the same x positions, as the `d` of a closed path. */
export function bandPath(upper: readonly Point[], lower: readonly Point[]): string {
  if (upper.length === 0 || lower.length === 0) return '';
  const top = upper.map(
    (point, index) => `${index === 0 ? 'M' : 'L'}${at(point.x)},${at(point.y)}`,
  );
  const bottom = [...lower].reverse().map((point) => `L${at(point.x)},${at(point.y)}`);
  return `${top.join(' ')} ${bottom.join(' ')} Z`;
}

/** Which of `values` (ascending) is nearest to `position`; the round under a pointer. */
export function nearest(values: readonly number[], position: number): number {
  let best = values[0] ?? 0;
  for (const value of values)
    if (Math.abs(value - position) < Math.abs(best - position)) best = value;
  return best;
}

/**
 * Spreads labels that would sit on top of one another: given where each wants to be, it returns where each
 * can be with at least `gap` between neighbours, keeping their order and staying inside `[min, max]`.
 */
export function spreadLabels(
  wanted: readonly number[],
  gap: number,
  min: number,
  max: number,
): number[] {
  const order = wanted.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
  const placed = order.map((entry) => Math.min(Math.max(entry.value, min), max));
  for (let at = 1; at < placed.length; at += 1) {
    placed[at] = Math.max(placed[at]!, placed[at - 1]! + gap);
  }
  const overflow = (placed[placed.length - 1] ?? 0) - max;
  if (overflow > 0) {
    placed[placed.length - 1] = max;
    for (let at = placed.length - 2; at >= 0; at -= 1) {
      placed[at] = Math.min(placed[at]!, placed[at + 1]! - gap);
    }
  }
  const result = new Array<number>(wanted.length).fill(0);
  order.forEach((entry, at) => {
    result[entry.index] = Math.max(placed[at]!, min);
  });
  return result;
}
