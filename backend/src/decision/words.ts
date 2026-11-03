import { EPISTEMIC_LABELS, type EpistemicLabel, type Labelled } from '../../../shared/decision.js';
import { lintText } from '../brief/lint.js';
import { clip, oneLine } from '../brief/text.js';

export {
  approx,
  clip,
  decimals,
  embed,
  listed,
  oneLine,
  perHundred,
  plural,
  signed,
} from '../brief/text.js';

/** What stands in for a sentence of ours whose wording broke the guard. It says nothing about the project. */
export const WITHHELD_TEXT =
  'A statement was withheld here because its wording broke the guard against forecasts and unattributed figures.';

/** Said of the simulation: a statement with one of these labels must say that it is simulated. */
const SIMULATED_LABELS: ReadonlySet<EpistemicLabel> = new Set([
  'simulation-event',
  'scenario-possibility',
]);
const SIMULATED = /\bsimulat(?:ed|ion|ions)\b/iu;

/**
 * Holds every sentence the canvas writes to the same wording rules as the brief: no forecast, no
 * overclaim, no percentage and no figure about the world that is not attributed to the simulation, and
 * a sentence that sums up the simulation says so. A sentence that fails is replaced by a plain one and
 * counted, so that the canvas can never carry a claim the product does not make. A person’s own words
 * only ever enter a sentence inside curly quotation marks (`embed`), which the guard leaves alone.
 */
export class Guard {
  withheld = 0;

  /** Whether the text is one the canvas may say. */
  allows(text: string, label?: EpistemicLabel): boolean {
    if (lintText(text).length > 0) return false;
    return !(label && SIMULATED_LABELS.has(label) && !SIMULATED.test(text));
  }

  /** A sentence, as it is when it passes and as `WITHHELD_TEXT` when it does not. */
  say(text: string, max: number, label?: EpistemicLabel): string {
    const plain = clip(oneLine(text), max);
    if (this.allows(plain, label)) return plain;
    this.withheld += 1;
    return clip(WITHHELD_TEXT, max);
  }

  /** A statement with its label. */
  statement(text: string, label: EpistemicLabel, basis?: string, max = 700): Labelled {
    return {
      text: this.say(text, max, label),
      label,
      ...(basis ? { basis: clip(basis, 80) } : {}),
    };
  }
}

export const isLabel = (value: string): value is EpistemicLabel =>
  (EPISTEMIC_LABELS as readonly string[]).includes(value);

/** `decision-owner` as "Decision owner". */
export const humanize = (value: string): string => {
  const words = value.replaceAll('-', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A share from 0 to 1 as a number of simulated members in 100, for a sentence. */
export const inHundred = (share: number): string => {
  const points = share * 100;
  const size = Math.abs(points);
  return String(size >= 10 ? Math.round(points) : Number(points.toFixed(size >= 1 ? 1 : 2)));
};

/** A signed difference of shares, in simulated members in 100: "+9", "-0.5". */
export const signedInHundred = (share: number): string => {
  const shown = inHundred(share);
  return Number(shown) > 0 ? `+${shown}` : shown;
};

export const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
