import type { Critique } from '../../../shared/critique.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  type StakeholderCategory,
} from '../../../shared/stakeholders.js';
import { clip, draft, names, overlap, plural, tokens, whole } from './text.js';
import type { Resolved, RoleCritic } from './types.js';

/** Who is missing, and who was assumed rather than found? */
const ROLE = 'stakeholder-coverage' as const;

/**
 * Word stems that point to a kind of stakeholder. They are a lens for asking "who else?" and only
 * decide whether the scenario's own words imply a kind that nobody was found for.
 */
const CATEGORY_CUES: Partial<Record<StakeholderCategory, readonly string[]>> = {
  competitor: ['compet', 'rival'],
  substitute: ['substitut', 'replacement'],
  regulator: ['regulat', 'complian', 'oversight', 'legislat', 'licens'],
  partner: ['partner', 'alliance', 'supplier', 'vendor'],
  channel: ['channel', 'distribut', 'intermediar'],
};
const CHECKED_CATEGORIES = Object.keys(CATEGORY_CUES) as StakeholderCategory[];

/** A cohort that stands for at least this many members... */
const LARGE_POPULATION = 100;
/** ...but simulates no more than this many is thinly sampled. */
const THIN_SAMPLE = 5;

interface Piece {
  text: string;
  /** Written as a likely stakeholder, as opposed to appearing somewhere in the scenario's text. */
  likely: boolean;
}

function scenarioPieces(scenario: ScenarioFrame): Piece[] {
  const text = [
    scenario.decision,
    scenario.system,
    scenario.baseline,
    scenario.requestedDecision ?? '',
    ...scenario.changes.flatMap((change) => [
      change.name,
      change.from ?? '',
      change.to ?? '',
      change.note,
    ]),
    ...scenario.alternatives.flatMap((alternative) => [alternative.label, alternative.description]),
    ...scenario.assumptions.map((assumption) => assumption.text),
    ...scenario.evidenceAvailable,
    ...scenario.evidenceMissing,
  ];
  return [
    ...scenario.likelyStakeholders.map((entry) => ({ text: entry, likely: true })),
    ...text.filter((entry) => entry.trim() !== '').map((entry) => ({ text: entry, likely: false })),
  ];
}

const cueIn = (text: string, stems: readonly string[]): boolean =>
  tokens(text).some((token) => stems.some((stem) => token.startsWith(stem)));

/** A short stretch of the text around the first word that carries the cue. */
function around(text: string, stems: readonly string[]): string {
  const found = new RegExp(`\\b(?:${stems.join('|')})\\p{L}*`, 'iu').exec(text);
  if (!found) return clip(text, 120);
  const start = Math.max(0, found.index - 50);
  return clip(text.slice(start, found.index + found[0].length + 60), 120);
}

function missingCategories(input: Resolved): Critique[] {
  if (!input.scenario || !input.stakeholders) return [];
  const present = new Set(input.facts.stakeholders.map((stakeholder) => stakeholder.category));
  const pieces = scenarioPieces(input.scenario);
  return CHECKED_CATEGORIES.flatMap((category) => {
    if (present.has(category)) return [];
    const stems = CATEGORY_CUES[category] ?? [];
    const named = pieces.find((piece) => piece.likely && cueIn(piece.text, stems));
    const pointer = named ?? pieces.find((piece) => cueIn(piece.text, stems));
    if (!pointer) return [];
    const label = STAKEHOLDER_CATEGORY_LABELS[category].toLowerCase();
    return [
      draft(input.now, {
        id: `coverage-missing-${category}`,
        role: ROLE,
        target: whole(input.analysis.id),
        severity: named ? 'major' : 'minor',
        objection: `The scenario ${named ? 'lists' : 'mentions'} a ${label}, but no stakeholder in that category is in the set.`,
        basis: [
          `Stakeholders in the ${label} category: 0 of ${input.facts.stakeholders.length}.`,
          `Scenario text that points to it: "${around(pointer.text, stems)}"`,
        ],
        impact: `If this stands, how a ${label} would react is missing from the simulation, so second-order effects may be understated.`,
      }),
    ];
  });
}

function unmatchedLikely(input: Resolved): Critique[] {
  const { scenario } = input;
  if (!scenario || !input.stakeholders || scenario.likelyStakeholders.length === 0) return [];
  const known = input.facts.stakeholders.map(
    (stakeholder) =>
      new Set([
        ...tokens(stakeholder.name),
        ...tokens(stakeholder.id),
        ...tokens(STAKEHOLDER_CATEGORY_LABELS[stakeholder.category]),
      ]),
  );
  const unmatched = scenario.likelyStakeholders.filter(
    (likely) => !known.some((available) => overlap(tokens(likely), available) > 0.5),
  );
  if (unmatched.length === 0) return [];
  const total = scenario.likelyStakeholders.length;
  return [
    draft(input.now, {
      id: 'coverage-unmatched-likely',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: unmatched.length * 2 >= total ? 'major' : 'minor',
      objection: `${unmatched.length} of the ${total} stakeholders the scenario lists as likely match no stakeholder in the set.`,
      basis: [
        `Listed in the scenario but not found in the set: ${names(unmatched)}.`,
        `Stakeholders in the set: ${input.facts.stakeholders.length}.`,
      ],
      impact:
        'If this stands, groups the question itself points to are absent from the simulation; add them or say why they are left out.',
    }),
  ];
}

function uncertainKeyStakeholders(input: Resolved): Critique[] {
  const uncertain = input.facts.stakeholders.filter(
    (stakeholder) => stakeholder.priority === 'key' && stakeholder.uncertainty.level === 'high',
  );
  if (uncertain.length === 0) return [];
  return [
    draft(input.now, {
      id: 'coverage-uncertain-key-stakeholders',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'minor',
      objection: `${plural(uncertain.length, 'key stakeholder')} ${uncertain.length === 1 ? 'is' : 'are'} marked as highly uncertain, yet ${uncertain.length === 1 ? 'it drives' : 'they drive'} the simulation as individual actors.`,
      basis: uncertain
        .slice(0, 4)
        .map(
          (stakeholder) =>
            `${stakeholder.name}: ${stakeholder.uncertainty.reason || 'no reason given'}`,
        ),
      impact:
        'If this stands, the results about these stakeholders are the least certain part of the model; collect evidence about them first.',
    }),
  ];
}

function thinCohorts(input: Resolved): Critique[] {
  const thin = input.actors.actors.filter(
    (actor) =>
      actor.kind === 'cohort' && actor.size >= LARGE_POPULATION && actor.sampleSize <= THIN_SAMPLE,
  );
  if (thin.length === 0) return [];
  return [
    draft(input.now, {
      id: 'coverage-thin-cohorts',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'minor',
      objection: `${plural(thin.length, 'cohort')} stand${thin.length === 1 ? 's' : ''} for a large population but ${thin.length === 1 ? 'simulates' : 'simulate'} only a handful of members.`,
      basis: thin
        .slice(0, 4)
        .map(
          (actor) =>
            `${actor.name}: stands for ${actor.size} members, simulates ${actor.sampleSize}.`,
        ),
      impact:
        'If this stands, the spread of behaviour inside those groups is thinly sampled and their results are coarse; raise the sample before reading them closely.',
    }),
  ];
}

export const coverageCritic: RoleCritic = (input) => [
  ...missingCategories(input),
  ...unmatchedLikely(input),
  ...uncertainKeyStakeholders(input),
  ...thinCohorts(input),
];
