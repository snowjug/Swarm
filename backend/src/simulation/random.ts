/**
 * Seeded random numbers for the simulator.
 *
 * Every number is a pure function of a run seed and a set of labels (which actor, which member, which
 * purpose, which round). Nothing is drawn from a shared sequence, so the numbers one entity receives
 * never depend on how many numbers another entity used. That is what makes common random numbers
 * possible: two runs on the same seed that differ in one assumption give every unrelated entity the
 * very same draws, and the difference between them is the effect of the assumption, not of the dice.
 *
 * `derive` turns (seed, labels) into the seed of an independent stream; `uniformAt` reads the n-th
 * number of a stream directly. A stream is therefore also a counter, which is what the engine uses:
 * the draw for (actor, member, trait) or (actor, member, round) is addressed, never advanced.
 */

const GOLDEN = 0x9e3779b1;
const TWO_POW_32 = 4_294_967_296;

/** Murmur3's 32-bit finaliser: a bijection in which every input bit affects every output bit. */
export function mix32(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a over the UTF-16 code units, finished with the mixer so that similar labels end up far apart. */
export function hashLabel(label: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    h ^= label.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

export type Label = string | number;

function labelPart(label: Label): number {
  if (typeof label === 'string') return hashLabel(label);
  return Number.isInteger(label) ? mix32((label | 0) ^ 0x1b873593) : hashLabel(String(label));
}

/**
 * The seed of an independent stream for this seed and these labels. The order of the labels matters,
 * and a text label never stands in for a number.
 */
export function derive(seed: number, ...labels: readonly Label[]): number {
  let state = mix32(seed);
  for (const label of labels) state = mix32((state ^ labelPart(label)) + GOLDEN);
  return state;
}

/** The `counter`-th number of a stream, in the open interval (0, 1). Pure in both arguments. */
export function uniformAt(streamSeed: number, counter: number): number {
  return (mix32(streamSeed + Math.imul(counter, GOLDEN)) + 0.5) / TWO_POW_32;
}

/** The same numbers one after another, for code that wants a sequence. */
export function stream(streamSeed: number): () => number {
  let counter = 0;
  return () => uniformAt(streamSeed, counter++);
}

// ---------------------------------------------------------------------------------------------
// Normal distribution
// ---------------------------------------------------------------------------------------------

/** Complementary error function to a relative error below 1.2e-7 (Numerical Recipes, `erfcc`). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const polynomial =
    -z * z -
    1.26551223 +
    t *
      (1.00002368 +
        t *
          (0.37409196 +
            t *
              (0.09678418 +
                t *
                  (-0.18628806 +
                    t *
                      (0.27886807 +
                        t *
                          (-1.13520398 +
                            t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const value = t * Math.exp(polynomial);
  return x >= 0 ? value : 2 - value;
}

export function normalCdf(x: number): number {
  return 0.5 * erfc(-x * Math.SQRT1_2);
}

// Coefficients of Acklam's rational approximation, kept as plain constants: this is called once per
// drawn trait, thousands of times per run.
const A1 = -3.969683028665376e1;
const A2 = 2.209460984245205e2;
const A3 = -2.759285104469687e2;
const A4 = 1.38357751867269e2;
const A5 = -3.066479806614716e1;
const A6 = 2.506628277459239;
const B1 = -5.447609879822406e1;
const B2 = 1.615858368580409e2;
const B3 = -1.556989798598866e2;
const B4 = 6.680131188771972e1;
const B5 = -1.328068155288572e1;
const C1 = -7.784894002430293e-3;
const C2 = -3.223964580411365e-1;
const C3 = -2.400758277161838;
const C4 = -2.549732539343734;
const C5 = 4.374664141464968;
const C6 = 2.938163982698783;
const D1 = 7.784695709041462e-3;
const D2 = 3.224671290700398e-1;
const D3 = 2.445134137142996;
const D4 = 3.754408661907416;
const QUANTILE_SPLIT = 0.02425;

/** The inverse of `normalCdf` (Acklam's rational approximation, relative error about 1e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0)) return p === 0 ? -Infinity : Number.NaN;
  if (!(p < 1)) return p === 1 ? Infinity : Number.NaN;
  if (p < QUANTILE_SPLIT) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((C1 * q + C2) * q + C3) * q + C4) * q + C5) * q + C6) /
      ((((D1 * q + D2) * q + D3) * q + D4) * q + 1)
    );
  }
  if (p > 1 - QUANTILE_SPLIT) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((C1 * q + C2) * q + C3) * q + C4) * q + C5) * q + C6) /
      ((((D1 * q + D2) * q + D3) * q + D4) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A1 * r + A2) * r + A3) * r + A4) * r + A5) * r + A6) * q) /
    (((((B1 * r + B2) * r + B3) * r + B4) * r + B5) * r + 1)
  );
}

/**
 * A sampler for a normal distribution cut off at `lo` and `hi`, driven by one uniform number. It maps
 * the number through the inverse distribution function, so the sample moves smoothly and in step with
 * the number when the mean or the spread is changed. That smoothness is what keeps paired runs close.
 * A spread of 0 gives the mean every time.
 */
export function truncatedNormalSampler(
  mean: number,
  spread: number,
  lo: number,
  hi: number,
): (u: number) => number {
  const fixed = Math.min(hi, Math.max(lo, mean));
  if (!(spread > 0)) return () => fixed;
  const below = normalCdf((lo - mean) / spread);
  const mass = normalCdf((hi - mean) / spread) - below;
  if (!(mass > 1e-9)) return () => fixed;
  return (u) => {
    const value = mean + spread * normalQuantile(below + u * mass);
    return value < lo ? lo : value > hi ? hi : value;
  };
}
