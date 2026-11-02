/** The geometry of the round charts, kept apart from the drawing so that it can be tested. */

export interface Point {
  x: number;
  y: number;
}

/** A straight map from a domain to a range. A flat domain maps to the middle of the range. */
export function linear(domain: readonly [number, number], range: readonly [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value: number): number =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** `M x y L x y …`, to two places, for a run of points. Nothing for fewer than one. */
export function linePath(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round2(point.x)} ${round2(point.y)}`)
    .join(' ');
}

/** The smallest of a few round limits that holds the value: 0.4 fits in 0.5, 0.04 in 0.05. */
export function niceLimit(
  value: number,
  steps: readonly number[] = [0.02, 0.05, 0.1, 0.2, 0.5, 1],
): number {
  const found = steps.find((step) => step >= value);
  return found ?? steps[steps.length - 1] ?? 1;
}

/** A symmetric domain around zero that holds every value, for inclinations. Never wider than −1 to 1. */
export function fitSymmetric(values: readonly number[], floor = 0.05): [number, number] {
  const widest = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const limit = Math.max(floor, niceLimit(widest * 1.2 || floor));
  return [-limit, limit];
}

/** A domain from zero that holds the largest value, for polarization. */
export function fitFromZero(values: readonly number[], floor = 0.05): [number, number] {
  const widest = values.reduce((max, value) => Math.max(max, value), 0);
  return [0, Math.max(floor, niceLimit(widest * 1.2 || floor, [0.05, 0.1, 0.2, 0.5, 1]))];
}

/** The top of a count axis: at least one, and a little above the largest count. */
export function countLimit(values: readonly number[]): number {
  const widest = values.reduce((max, value) => Math.max(max, value), 0);
  return Math.max(1, Math.ceil(widest));
}

/**
 * Which rounds get a label on the axis: every round where they fit, otherwise every second, third… one,
 * always including the first and the last.
 */
export function axisRounds(total: number, width: number, minGap = 44): number[] {
  if (total <= 0) return [0];
  const fit = Math.max(1, Math.floor(width / minGap));
  const stride = Math.max(1, Math.ceil((total + 1) / fit));
  const shown: number[] = [];
  for (let round = 0; round <= total; round += stride) shown.push(round);
  if (shown[shown.length - 1] !== total) {
    // The last round is always named; the one before it gives way when they would touch.
    if (total - (shown[shown.length - 1] ?? 0) < stride / 2) shown.pop();
    shown.push(total);
  }
  return shown;
}

/** The round nearest to a position across a plot that runs from `left` to `right`. */
export function roundAtX(x: number, left: number, right: number, total: number): number {
  if (right <= left || total <= 0) return 0;
  const share = Math.min(1, Math.max(0, (x - left) / (right - left)));
  return Math.round(share * total);
}

export interface Band {
  /** Lower and upper edge of the band at each round. */
  lower: number[];
  upper: number[];
}

/** The three shares as bands stacked from 0 to 1: opposed at the bottom, undecided between, in favour on top. */
export function stackShares(
  points: readonly { opposition: number; undecided: number; support: number }[],
): { opposition: Band; undecided: Band; support: Band } {
  const opposition: Band = { lower: [], upper: [] };
  const undecided: Band = { lower: [], upper: [] };
  const support: Band = { lower: [], upper: [] };
  for (const point of points) {
    opposition.lower.push(0);
    opposition.upper.push(point.opposition);
    undecided.lower.push(point.opposition);
    undecided.upper.push(point.opposition + point.undecided);
    support.lower.push(point.opposition + point.undecided);
    support.upper.push(point.opposition + point.undecided + point.support);
  }
  return { opposition, undecided, support };
}
