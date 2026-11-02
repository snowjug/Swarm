import type { Verdict } from './scenarios';

/** What the share the page leads with is the share of, in the words every part of the page uses for it. */
export const ADVERSE_WORDS = 'look for an alternative or resist';

/** Said once near the top, and short: what the numbers are. */
export const SIMULATED_NOTE = 'Simulated members and seeded runs. An exploration, not a forecast.';

/** Said once, where repeatability first appears. */
export const REPEATABILITY_NOTE =
  'Repeatable means steady under the simulation’s own randomness. It is not a likelihood.';

/** What a stance is, beside the first number on a stance scale. */
/** The one hidden sentence that says what the two scenario names, and the pill in the bar, open. */
export const PAIR_HINT = 'Opens the choice of which two scenarios are set against each other.';
export const PAIR_HINT_ID = 'sw-cmp-pair-hint';

export const STANCE_WORDS = 'Stance runs from −1 (clearly against) to +1 (clearly in favour).';

export const verdictWords = (verdict: Verdict): string =>
  verdict === 'less'
    ? 'less favourable'
    : verdict === 'more'
      ? 'more favourable'
      : 'about the same';

export interface SectionInfo {
  id: string;
  no: string;
  nav: string;
  title: string;
  lede: string;
}

/** The parts of the page, in order: their anchors, the label in the contents and the line each opens with. */
export const SECTIONS: readonly SectionInfo[] = [
  {
    id: 'futures',
    no: '01',
    nav: 'Futures',
    title: 'Where simulated members end up',
    lede: 'Every scenario, run on the same seeds.',
  },
  {
    id: 'movers',
    no: '02',
    nav: 'Who moves',
    title: 'Who moves, and how far',
    lede: 'Each simulated actor’s stance in the two scenarios.',
  },
  {
    id: 'time',
    no: '03',
    nav: 'Over time',
    title: 'How it unfolds',
    lede: 'The middle run and the spread of runs, round by round.',
  },
  {
    id: 'holds',
    no: '04',
    nav: 'What holds',
    title: 'What holds across the seeded runs',
    lede: 'Statements that are true of a run or not, and how often they held.',
  },
  {
    id: 'depends',
    no: '05',
    nav: 'Depends on',
    title: 'What the result depends on',
    lede: 'The headline when one assumption is moved at a time.',
  },
  {
    id: 'sets-off',
    no: '06',
    nav: 'Sets off',
    title: 'What it sets off',
    lede: 'One run, read event by event.',
  },
  {
    id: 'rely',
    no: '07',
    nav: 'How far to rely',
    title: 'How far to rely on this',
    lede: 'What drove the behaviour, and what was not measured.',
  },
];

export const sectionInfo = (id: string): SectionInfo => {
  const found = SECTIONS.find((section) => section.id === id);
  if (!found) throw new Error(`Unknown section ${id}`);
  return found;
};

/** What each kind of finding is about, as a small label above it. */
export const FINDING_KIND_LABELS: Record<string, string> = {
  'direction-vs-baseline': 'Direction',
  'majority-response': 'Response',
  'threshold-crossing': 'Threshold',
  ordering: 'Order',
  'second-order-event': 'Follow-on event',
};

/** What the page says of a share of paired runs when the engine made no finding of it. */
export const pairedCountText = (higher: number, paired: number): string =>
  `Higher in ${higher} of ${paired} paired seeded runs`;
